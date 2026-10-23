import {createHash} from 'node:crypto'
import {validatePage} from './pages.js'
import {validatePost} from './blog.js'
import {normalizedSeo} from '../../../shared/seo.js'
import {checkContentReferences} from './pageLibrary.js'
import {contentRevision,contentTransaction,contentConflict} from './contentLifecycle.js'
const kinds={pages:['title','slug','content','sections','seo','published'],posts:['title','slug','excerpt','content','category','tags','cover_url','seo','published']}
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const publisher=req=>['owner','admin'].includes(req.novaSession?.role)
const active=['review','scheduled']
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{publication:true,statusCode})}
function time(value,now=new Date()) {
 if(value===null)return null
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)<+now+5000||Date.parse(value)>+now+366*86400000)fail(400,'Выберите время от 5 секунд до 366 дней вперёд')
 return new Date(value).toISOString()
}
function snapshot(kind,value) {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!kinds[kind].includes(k)))fail(400,'Некорректные поля публикации')
 const stack=[{value,depth:0}];let nodes=0
 while(stack.length){const {value:v,depth}=stack.pop();if(++nodes>50000||depth>12)fail(400,'Слишком сложная запись');if(typeof v==='string'&&v.includes('\0'))fail(400,'Нулевой символ недопустим');if(v&&typeof v==='object')for(const item of Object.values(v))stack.push({value:item,depth:depth+1})}
 if(Buffer.byteLength(JSON.stringify(value))>1800000)fail(413,'Слишком большой материал')
 const result={...value,published:true}
 if(kind==='pages'&&result.sections===undefined)result.sections=[]
 const error=(kind==='pages'?validatePage:validatePost)(result);if(error)fail(400,error)
 result.seo=normalizedSeo(result.seo);result.title=result.title.trim()
 if(kind==='posts'){result.category=result.category.trim();result.tags=result.tags.map(t=>t.trim())}
 return result
}
const columns='id::text,record_id::text,base_revision::text,revision::text,state,scheduled_at,requested_at,created_by,reviewed_by,note,failure,applied_revision::text,created_at,updated_at'
export async function initContentPublishing(db) {
 await db.query(`CREATE TABLE IF NOT EXISTS content_publications(
  id UUID PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('pages','posts')),record_id BIGINT NOT NULL,
  base_revision BIGINT NOT NULL,payload JSONB NOT NULL,request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('review','scheduled','published','rejected','cancelled','stale','failed')),
  revision BIGINT NOT NULL DEFAULT 1,requested_at TIMESTAMPTZ,scheduled_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',failure TEXT NOT NULL DEFAULT '',applied_revision BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await db.query("CREATE UNIQUE INDEX IF NOT EXISTS content_publications_active_idx ON content_publications(kind,record_id) WHERE state IN ('review','scheduled')")
 await db.query("CREATE INDEX IF NOT EXISTS content_publications_due_idx ON content_publications(scheduled_at) WHERE state='scheduled'")
}
// Editors may keep unpublished records, but changes to live content go through a review snapshot.
export async function allowEditorContentWrite(db,req,reply,kind) {
 if(req.novaSession?.role!=='editor')return true
 if(req.body?.published){reply.code(403).send({error:'Редактор отправляет публикацию на согласование'});return false}
 if(req.params?.id&&(await db.query(`SELECT published FROM ${kind} WHERE id=$1 FOR UPDATE`,[req.params.id])).rows[0]?.published){reply.code(403).send({error:'Изменения опубликованного материала сохраните личным черновиком и отправьте на согласование'});return false}
 return true
}
async function lockRecord(db,kind,id){return (await db.query(`SELECT *,id::text,revision::text FROM ${kind} WHERE id=$1 FOR UPDATE`,[id])).rows[0]}
async function mark(db,id,state,failure='') {await db.query('UPDATE content_publications SET state=$2,failure=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1',[id,state,failure])}
async function apply(db,job,record) {
 if(!record||record.deleted_at||String(record.revision)!==String(job.base_revision)){await mark(db,job.id,'stale','Материал изменён или удалён после отправки');return false}
 const approver=(await db.query("SELECT id FROM admin_accounts WHERE id=$1 AND enabled=TRUE AND role IN ('owner','admin') FOR SHARE",[job.reviewed_by])).rows[0]
 if(!approver){await mark(db,job.id,'failed','Учётная запись, одобрившая публикацию, недоступна');return false}
 const data=snapshot(job.kind,job.payload),missing=await checkContentReferences(db,data)
 if(missing){await mark(db,job.id,'failed',missing);return false}
 await db.query("SELECT set_config('nova.content_actor',$1,TRUE),set_config('nova.content_action','publish',TRUE),set_config('nova.content_publication_id',$2,TRUE)",[String(job.reviewed_by),job.id])
 const fields=kinds[job.kind],args=fields.map(k=>['sections','tags','seo'].includes(k)?JSON.stringify(data[k]):data[k])
 const extra=job.kind==='posts'?',published_at=COALESCE(published_at,NOW())':''
 // The source row is locked. Its revision is checked again by the UPDATE itself.
 const saved=await db.query(`UPDATE ${job.kind} SET ${fields.map((k,i)=>k+'=$'+(i+1)).join(',')}${extra} WHERE id=$${args.length+1} AND revision=$${args.length+2} AND deleted_at IS NULL RETURNING revision::text`,[...args,job.record_id,job.base_revision])
 if(!saved.rowCount){await mark(db,job.id,'stale','Материал изменён после отправки');return false}
 await db.query("UPDATE content_publications SET state='published',applied_revision=$2,revision=revision+1,failure='',updated_at=clock_timestamp() WHERE id=$1",[job.id,saved.rows[0].revision]);return true
}
export function registerContentPublishing(app,pool,requireAdmin,kind) {
 if(!Object.hasOwn(kinds,kind))throw Error('Invalid content kind')
 const base='/api/admin/'+kind+'/publications',auth={preHandler:requireAdmin}
 const protect=fn=>async(req,reply)=>{try{return await fn(req,reply)}catch(e){if(e.publication)return reply.code(e.statusCode).send({error:e.message});if(['23505','55P03','40001','40P01'].includes(e.code))return reply.code(409).send({error:'Заявка или данные изменились. Обновите очередь и повторите действие.'});throw e}}
 app.get(base,auth,protect(async(req)=>{
  const offset=Number(req.query.offset||0),record=req.query.record_id||null,state=req.query.state||'active'
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000||record&&!contentRevision(record)||!['active','all'].includes(state))fail(400,'Неверный фильтр очереди')
  const mine=publisher(req)?null:req.novaSession.user_id
  const rows=await pool.query(`SELECT ${columns},payload->>'title' AS title FROM content_publications WHERE kind=$1 AND ($2::bigint IS NULL OR record_id=$2) AND ($3::integer IS NULL OR created_by=$3) AND ($4='all' OR state IN ('review','scheduled')) ORDER BY created_at DESC,id LIMIT 21 OFFSET $5`,[kind,record,mine,state,offset])
  return {items:rows.rows.slice(0,20),next_offset:rows.rows.length>20?offset+20:null,can_approve:publisher(req)}
 }))
 app.get(base+'/:request_id',auth,protect(async(req,reply)=>{
  if(!uuid(req.params.request_id))fail(400,'Неверная заявка')
  const row=(await pool.query(`SELECT *,id::text,record_id::text,base_revision::text,revision::text,applied_revision::text FROM content_publications WHERE id=$1 AND kind=$2 AND ($3::integer IS NULL OR created_by=$3)`,[req.params.request_id,kind,publisher(req)?null:req.novaSession.user_id])).rows[0]
  if(!row)return reply.code(404).send({error:'Заявка не найдена'})
  const current=(await pool.query(`SELECT *,id::text,revision::text FROM ${kind} WHERE id=$1`,[row.record_id])).rows[0]||null
  return {...row,request_hash:undefined,current}
 }))
 app.route({method:'POST',url:'/api/admin/'+kind+'/:id/publications',...auth,bodyLimit:2000000,handler:protect(async(req,reply)=>{
  const b=req.body
  if(!contentRevision(req.params.id)||!contentRevision(b?.revision)||!uuid(b?.request_id)||!['review','schedule'].includes(b?.mode))fail(400,'Проверьте материал и версию заявки')
  if(b.mode==='schedule'&&!publisher(req))fail(403,'Назначить публикацию может администратор')
  const publishAt=time(b.publish_at??null)
  if(b.mode==='schedule'&&!publishAt)fail(400,'Выберите время публикации')
  const data=snapshot(kind,b.payload),hash=createHash('sha256').update(JSON.stringify(stable({kind,id:req.params.id,revision:b.revision,mode:b.mode,payload:data,publish_at:publishAt}))).digest('hex')
  return contentTransaction(pool,req,reply,async(db,reply)=>{
   const record=await lockRecord(db,kind,req.params.id)
   const previous=(await db.query(`SELECT ${columns},created_by,request_hash FROM content_publications WHERE id=$1`,[b.request_id])).rows[0]
   if(previous){if(String(previous.created_by)!==req.novaSession.user_id||previous.request_hash!==hash)fail(409,'Этот идентификатор уже использован другой заявкой');return {...previous,request_hash:undefined}}
   if(!record||record.deleted_at||String(record.revision)!==b.revision)return contentConflict(db,kind,req.params.id,reply)
   const missing=await checkContentReferences(db,data);if(missing)fail(400,missing)
   const result=await db.query(`INSERT INTO content_publications(id,kind,record_id,base_revision,payload,request_hash,state,requested_at,scheduled_at,created_by,reviewed_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) RETURNING ${columns}`,[b.request_id,kind,req.params.id,b.revision,JSON.stringify(data),hash,b.mode==='review'?'review':'scheduled',publishAt,b.mode==='schedule'?publishAt:null,req.novaSession.user_id,b.mode==='schedule'?req.novaSession.user_id:null])
   // Retain active requests and the latest 30 completed decisions for each material.
   await db.query("DELETE FROM content_publications WHERE kind=$1 AND record_id=$2 AND state NOT IN ('review','scheduled') AND id NOT IN (SELECT id FROM content_publications WHERE kind=$1 AND record_id=$2 AND state NOT IN ('review','scheduled') ORDER BY created_at DESC,id LIMIT 30)",[kind,req.params.id])
   return reply.code(201).send(result.rows[0])
  },'submission')
 })})
 app.route({method:'POST',url:base+'/:request_id/:action',...auth,bodyLimit:5000,handler:protect(async(req,reply)=>{
  const {request_id:id,action}=req.params,b=req.body
  if(!uuid(id)||!['approve','reject','cancel'].includes(action)||!contentRevision(b?.revision))fail(400,'Неверное действие или версия заявки')
  if(action!=='cancel'&&!publisher(req))fail(403,'Согласование доступно администратору')
  const note=b.note??'';if(typeof note!=='string'||note.length>2000||note.includes('\0')||action==='reject'&&!note.trim())fail(400,'Укажите комментарий до 2000 символов')
  const at=action==='approve'?time(b.publish_at??null):null
  return contentTransaction(pool,req,reply,async(db,reply)=>{
   // Always lock the material before its request, also in the scheduler and SQL triggers.
   const hint=(await db.query('SELECT record_id::text FROM content_publications WHERE id=$1 AND kind=$2',[id,kind])).rows[0]
   if(!hint)fail(404,'Заявка не найдена')
   const record=await lockRecord(db,kind,hint.record_id)
   const job=(await db.query('SELECT * FROM content_publications WHERE id=$1 AND kind=$2 FOR UPDATE',[id,kind])).rows[0]
   if(!job)fail(404,'Заявка не найдена')
   if(!publisher(req)&&String(job.created_by)!==req.novaSession.user_id)fail(404,'Заявка не найдена')
   if(String(job.revision)!==b.revision||!active.includes(job.state)||action!=='cancel'&&job.state!=='review')fail(409,'Решение уже принято или заявка изменилась. Обновите очередь.')
   if(action==='cancel')await mark(db,id,'cancelled')
   else if(!record||record.deleted_at||String(record.revision)!==String(job.base_revision))await mark(db,id,'stale','Материал изменён или удалён после отправки')
   else if(action==='reject')await db.query("UPDATE content_publications SET state='rejected',reviewed_by=$2,note=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[id,req.novaSession.user_id,note.trim()])
   else {
    job.reviewed_by=req.novaSession.user_id
    await db.query('UPDATE content_publications SET reviewed_by=$2,note=$3 WHERE id=$1',[id,job.reviewed_by,note.trim()])
    if(at)await db.query("UPDATE content_publications SET state='scheduled',scheduled_at=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[id,at])
    else await apply(db,job,record)
   }
   return (await db.query(`SELECT ${columns} FROM content_publications WHERE id=$1`,[id])).rows[0]
  },action)
 })})
}
export async function publishDueContent(pool,{now=new Date(),limit=10}={}) {
 const candidates=(await pool.query("SELECT id,kind,record_id::text FROM content_publications WHERE state='scheduled' AND scheduled_at<=$1 ORDER BY scheduled_at,id LIMIT $2",[now,limit])).rows
 let published=0
 for(const item of candidates) {
  if(!Object.hasOwn(kinds,item.kind))continue
  const db=await pool.connect()
  try {
   await db.query('BEGIN')
   const record=await lockRecord(db,item.kind,item.record_id)
   const job=(await db.query("SELECT * FROM content_publications WHERE id=$1 AND state='scheduled' AND scheduled_at<=$2 FOR UPDATE SKIP LOCKED",[item.id,now])).rows[0]
   const applied=job&&await apply(db,job,record)
   await db.query('COMMIT');if(applied)published++
  }catch(e){await db.query('ROLLBACK');if(!['55P03','40001','40P01'].includes(e.code)){
    // Failed snapshots stay inspectable, while SQL/provider details never enter the queue.
    await db.query("UPDATE content_publications SET state='failed',failure='Не удалось опубликовать. Проверьте адрес, изображения и формы.',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND state='scheduled'",[item.id])
   }}finally{db.release()}
 }
 return {published}
}
export function registerPublicationWorker(app,pool) {
 let timer,running
 const tick=()=>{if(running)return running;running=publishDueContent(pool).catch(()=>app.log.error({event:'content.publication_worker_failed'})).finally(()=>{running=null});return running}
 app.addHook('onReady',async()=>{await tick();timer=setInterval(tick,15000);timer.unref()})
 app.addHook('onClose',async()=>{clearInterval(timer);if(running)await running})
}
