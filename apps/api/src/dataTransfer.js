import {createHash,randomUUID} from 'node:crypto'
import {readTransfer,transferFields,transferKinds,transferFile} from '../../../shared/dataTransfer.js'
import {validateProduct} from '../../../shared/products.js'
import {normalizePhone,validEmail} from '../../../shared/commerce.js'
import {normalizedSeo} from '../../../shared/seo.js'
import {validatePage} from './pages.js'
import {validatePost} from './blog.js'
import {checkContentReferences} from './pageLibrary.js'
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{transfer:true,statusCode})}
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
const keyField={products:'sku',customers:'phone',pages:'slug',posts:'slug'}
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
export async function initDataTransfer(db){await db.query(`CREATE TABLE IF NOT EXISTS data_imports(id UUID PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,kind TEXT NOT NULL,plan JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 minutes',applied_at TIMESTAMPTZ,result JSONB)`);await db.query('CREATE INDEX IF NOT EXISTS data_imports_expiry_idx ON data_imports(expires_at)')}
function clean(kind,row){const r=Object.fromEntries(transferFields[kind].map(k=>[k,row[k]]));if(kind==='products')r.price=Number(r.price);if(kind==='posts')r.published_at=r.published_at?new Date(r.published_at).toISOString():null;return r}
async function rows(db,kind,keys){if(!Object.hasOwn(transferKinds,kind))fail(400,'Неизвестный тип данных');return (await db.query('SELECT id::text,revision::text AS _version,'+(['pages','posts'].includes(kind)?'deleted_at,':'')+transferFields[kind].join(',')+' FROM '+kind+' WHERE '+(kind==='products'?'btrim(sku)':keyField[kind])+'=ANY($1::text[]) ORDER BY id',[keys])).rows}
const fingerprint=(kind,row)=>hash({record:clean(kind,row),version:row._version})
const hasNull=v=>{const stack=[v];let nodes=0;while(stack.length){if(++nodes>100000)fail(400,'Слишком сложная структура записи');const x=stack.pop();if(typeof x==='string'&&x.includes('\0'))return true;if(x&&typeof x==='object')stack.push(...Object.values(x))}return false}
function canonical(kind,raw,existing){
 if(hasNull(raw))return {error:'Нулевой символ недопустим в данных'}
 const defaults={products:{description:'',sku:'',stock:0,image_url:'',published:false,images:[],attributes:[],variants:[],seo:normalizedSeo()},customers:{email:'',note:''},pages:{content:'',published:false,sections:[],seo:normalizedSeo()},posts:{excerpt:'',content:'',category:'',tags:[],cover_url:'',published:false,published_at:null,seo:normalizedSeo()}}
 const r={...defaults[kind],...(existing?clean(kind,existing):{}),...raw}
 if(kind==='customers'){r.phone=normalizePhone(r.phone);if(typeof r.name!=='string'||!r.name.trim()||r.name.length>150||!r.phone||!validEmail(r.email)||typeof r.note!=='string'||r.note.length>5000)return {error:'Проверьте имя, телефон, email и заметку покупателя'}}
 const validator={products:validateProduct,pages:validatePage,posts:validatePost}[kind],error=validator?.(r);if(error)return {error}
 for(const k of ['name','title','category','email','sku'])if(typeof r[k]==='string')r[k]=r[k].trim()
 if(kind==='posts'){if(r.published_at!==null&&(typeof r.published_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(r.published_at)||!Number.isFinite(Date.parse(r.published_at))||new Date(r.published_at).toISOString().slice(0,19)!==r.published_at.slice(0,19)))return {error:'published_at: укажите дату UTC в формате ISO или null'};if(r.published&&!r.published_at)r.published_at=new Date().toISOString();else if(r.published_at)r.published_at=new Date(r.published_at).toISOString()}
 if(kind!=='customers')r.seo=normalizedSeo(r.seo)
 return {record:r}
}
export async function previewImport(db,body){
 let records;try{records=readTransfer(body)}catch(e){fail(400,e.message)}if(!['create','merge'].includes(body.mode))fail(400,'Выберите режим импорта')
 const kind=body.kind,keys=records.map(r=>kind==='customers'?normalizePhone(r?.phone):typeof r?.[keyField[kind]]==='string'?r[keyField[kind]].trim():'').filter(Boolean),existing=await rows(db,kind,keys),seen=new Set(),plan=[],report=[]
 for(const [i,raw]of records.entries()){
  const row=i+1,errors=[],warnings=[];if(!object(raw)){report.push({row,action:'error',errors:['Ожидается объект'],warnings});continue}
  const unknown=Object.keys(raw).filter(k=>!transferFields[kind].includes(k));if(unknown.length)errors.push('Неизвестные поля: '+unknown.join(', '))
  let key=raw[keyField[kind]];if(kind==='customers')key=normalizePhone(key);else if(typeof key==='string')key=key.trim()
  if(kind!=='products'&&!key)errors.push('Не заполнено ключевое поле '+keyField[kind])
  if(key&&seen.has(key))errors.push('Повтор ключа в файле: '+key);if(key)seen.add(key)
  const matches=key?existing.filter(r=>(kind==='products'?r.sku.trim():r[keyField[kind]])===key):[];if(matches.length>1)errors.push('Несколько записей на сайте имеют ключ '+key)
  const current=matches.length===1?matches[0]:null;if(current?.deleted_at)errors.push('Запись находится в корзине. Сначала восстановите её или удалите окончательно');if(current&&body.mode==='create')errors.push('Запись уже существует. Выберите обновление совпадений или измените ключ')
  const {record,error}=canonical(kind,raw,current);if(error)errors.push(error)
  if(!errors.length){const missing=await checkContentReferences(db,record);if(missing)errors.push(missing)}
  if(kind==='products'&&!key)warnings.push('Нет артикула: будет создан новый товар; повторный импорт создаст ещё один')
  if(kind==='products'&&record&&current&&(record.stock!==current.stock||JSON.stringify(record.variants)!==JSON.stringify(current.variants)))warnings.push('Остатки и варианты будут заменены значениями из файла')
  if(record?.published)warnings.push('Запись будет опубликована или останется опубликованной')
  if(record?.sections?.some(s=>s.type==='code'))warnings.push('Секции содержат HTML/CSS/JavaScript; код не запускался при проверке')
  const changes=record?transferFields[kind].filter(k=>JSON.stringify(stable(current?clean(kind,current)[k]:undefined))!==JSON.stringify(stable(record[k]))).map(field=>({field,before:sample(current?.[field]),after:sample(record[field])})):[]
  const action=errors.length?'error':!current?'create':changes.length?'update':'unchanged';report.push({row,key:key||'',title:record?.name||record?.title||'',action,changes,errors,warnings})
  if(!errors.length)plan.push({row,key:key||'',action,id:current?.id||null,before:current?fingerprint(kind,current):null,record})
 }
 return {kind,mode:body.mode,plan,report,valid:report.every(r=>!r.errors.length),summary:{create:report.filter(r=>r.action==='create').length,update:report.filter(r=>r.action==='update').length,unchanged:report.filter(r=>r.action==='unchanged').length,errors:report.filter(r=>r.errors.length).length}}
}
const sample=v=>v===undefined?'—':typeof v==='string'?v.slice(0,300):JSON.stringify(v).slice(0,300)
async function writeRecord(db,kind,step){
 const record=step.record,fields=transferFields[kind],jsonFields=['images','attributes','variants','sections','tags','seo'],args=fields.map(k=>jsonFields.includes(k)?JSON.stringify(record[k]):record[k])
 if(step.action==='unchanged')return
 if(step.action==='create'){
  await db.query('INSERT INTO '+kind+' ('+fields.join(',')+') VALUES('+fields.map((_,i)=>'$'+(i+1)).join(',')+')',args)
 }else{
  const extra=kind==='products'||kind==='customers'?',revision=revision+1':''
  await db.query('UPDATE '+kind+' SET '+fields.map((k,i)=>k+'=$'+(i+1)).join(',')+extra+',updated_at=NOW() WHERE id=$'+(args.length+1),[...args,step.id])
 }
 if(kind==='products')await db.query('INSERT INTO categories(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[record.category])
}
export function registerDataTransfer(app,db,requireAdmin){
 const cleanup=setInterval(()=>db.query('DELETE FROM data_imports WHERE expires_at<=NOW()').catch(()=>app.log.warn({event:'transfer.cleanup_failed'})),60000);cleanup.unref();app.addHook('onClose',async()=>clearInterval(cleanup))
 const protect=fn=>async(req,reply)=>{try{return await fn(req,reply)}catch(e){if(e.transfer)return reply.code(e.statusCode).send({error:e.message});if(['23505','55P03','40001','40P01'].includes(e.code)||e.constraint==='nova_media_available')return reply.code(409).send({error:'Данные или ссылки изменились. Выполните проверку заново.'});throw e}}
 app.get('/api/admin/transfer/export',{preHandler:requireAdmin},protect(async(req,reply)=>{const kind=req.query.kind;if(!Object.hasOwn(transferKinds,kind))fail(400,'Неизвестный тип');const limit=['pages','posts'].includes(kind)?20:100,offset=Number(req.query.offset||0);if(!Number.isSafeInteger(offset)||offset<0)fail(400,'Некорректная часть выгрузки');const result=await db.query('SELECT '+transferFields[kind].join(',')+' FROM '+kind+(['pages','posts'].includes(kind)?' WHERE deleted_at IS NULL':'')+' ORDER BY id LIMIT $1 OFFSET $2',[limit+1,offset]);const records=[];let bytes=200;for(const row of result.rows.slice(0,limit)){const record=clean(kind,row),size=Buffer.byteLength(JSON.stringify(record),'utf8')+1;if(bytes+size>3900000)break;records.push(record);bytes+=size}if(result.rows.length&&!records.length)fail(413,'Одна запись превышает размер переносимого файла');return reply.header('Content-Disposition','attachment; filename="nova-'+kind+'-'+offset+'.json"').send({...transferFile(kind,records),next_offset:result.rows.length>records.length?offset+records.length:null})}))
 app.post('/api/admin/transfer/preview',{preHandler:requireAdmin,bodyLimit:5000000},protect(async(req)=>{
  const c=await db.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query('DELETE FROM data_imports WHERE expires_at<=NOW()');const result=await previewImport(c,req.body);let id=null
   if(result.valid){id=randomUUID();await c.query('DELETE FROM data_imports WHERE user_id=$1 AND applied_at IS NULL',[req.novaSession.user_id]);await c.query('INSERT INTO data_imports(id,user_id,kind,plan) VALUES($1,$2,$3,$4::jsonb)',[id,req.novaSession.user_id,result.kind,JSON.stringify(result)])}
   await c.query('COMMIT');return {id,valid:result.valid,summary:result.summary,rows:result.report,expires_in:1800}
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }))
 app.post('/api/admin/transfer/apply',{preHandler:requireAdmin,bodyLimit:1024},protect(async(req)=>{
  if(req.body?.confirm!==true||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.body?.id||''))fail(400,'Подтвердите проверенный импорт')
  const c=await db.connect();try{await c.query('BEGIN');const batch=(await c.query('SELECT * FROM data_imports WHERE id=$1 AND user_id=$2 AND expires_at>NOW() FOR UPDATE',[req.body.id,req.novaSession.user_id])).rows[0];if(!batch)fail(409,'Проверка устарела или принадлежит другой учётной записи');if(batch.applied_at){await c.query('COMMIT');return {...batch.result,duplicate:true}}
   // Lock against catalog edits, checkout stock changes and concurrently created keys.
   await c.query('LOCK TABLE '+batch.kind+' IN SHARE ROW EXCLUSIVE MODE');const current=await rows(c,batch.kind,batch.plan.plan.map(s=>s.key).filter(Boolean))
   for(const step of batch.plan.plan){const matches=step.key?current.filter(r=>(batch.kind==='products'?r.sku.trim():r[keyField[batch.kind]])===step.key):[];const target=step.id?current.find(r=>r.id===step.id):null;if(step.id?(!target||fingerprint(batch.kind,target)!==step.before||step.key&&matches.length!==1):matches.length)fail(409,'Данные изменились после проверки (строка '+step.row+'). Проверьте файл заново.');const missing=await checkContentReferences(c,step.record);if(missing)fail(409,missing)}
   await c.query("SELECT set_config('nova.content_actor',$1,TRUE),set_config('nova.content_action','import',TRUE)",[String(req.novaSession.user_id)])
   for(const step of batch.plan.plan)await writeRecord(c,batch.kind,step)
   const result={ok:true,kind:batch.kind,summary:batch.plan.summary};await c.query('UPDATE data_imports SET applied_at=NOW(),result=$1::jsonb,plan=$2::jsonb WHERE id=$3',[JSON.stringify(result),'{}',batch.id]);await c.query('COMMIT');return result
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }))
}
