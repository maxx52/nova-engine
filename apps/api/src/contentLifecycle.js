// Pages and posts share optimistic locking, a private work copy and retained versions.
const kinds = new Set(['pages', 'posts'])
export const contentRevision = value => typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value)
const idValid = contentRevision
const editable = {
 pages: ['title','slug','content','sections','seo','published'],
 posts: ['title','slug','excerpt','content','category','tags','cover_url','seo','published']
}
export async function initContentLifecycle(db) {
 await db.query(`CREATE TABLE IF NOT EXISTS content_versions (
  kind TEXT NOT NULL CHECK(kind IN ('pages','posts')), record_id BIGINT NOT NULL, revision BIGINT NOT NULL,
  snapshot JSONB NOT NULL, action TEXT NOT NULL, user_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(kind,record_id,revision))`)
 await db.query(`CREATE TABLE IF NOT EXISTS content_drafts (
  user_id INTEGER NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('pages','posts')), record_key TEXT NOT NULL,
  payload JSONB NOT NULL, base_revision BIGINT, revision BIGINT NOT NULL DEFAULT 1,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,kind,record_key))`)
 await db.query(`CREATE OR REPLACE FUNCTION nova_content_before() RETURNS TRIGGER LANGUAGE plpgsql AS $$
 BEGIN NEW.revision:=OLD.revision+1; NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$`)
 await db.query(`CREATE OR REPLACE FUNCTION nova_content_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
 DECLARE label TEXT;
 BEGIN
  IF TG_OP='DELETE' THEN
   DELETE FROM content_publications WHERE kind=TG_TABLE_NAME AND record_id=OLD.id;
   DELETE FROM content_versions WHERE kind=TG_TABLE_NAME AND record_id=OLD.id;
   DELETE FROM content_drafts WHERE kind=TG_TABLE_NAME AND record_key=OLD.id::text;
   RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
   UPDATE content_publications SET state='stale',failure='Материал изменён после отправки',revision=revision+1,updated_at=clock_timestamp()
    WHERE kind=TG_TABLE_NAME AND record_id=NEW.id AND base_revision<>NEW.revision AND state IN ('review','scheduled')
     AND id IS DISTINCT FROM NULLIF(current_setting('nova.content_publication_id',TRUE),'')::uuid;
  END IF;
  label:=COALESCE(NULLIF(current_setting('nova.content_action',TRUE),''),'save');
  IF TG_OP='INSERT' THEN label:='create';
  ELSIF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN label:='trash';
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN label:='restore'; END IF;
  INSERT INTO content_versions(kind,record_id,revision,snapshot,action,user_id)
   VALUES(TG_TABLE_NAME,NEW.id,NEW.revision,to_jsonb(NEW),label,NULLIF(current_setting('nova.content_actor',TRUE),'')::integer);
  DELETE FROM content_versions WHERE kind=TG_TABLE_NAME AND record_id=NEW.id
   AND revision NOT IN(SELECT revision FROM content_versions WHERE kind=TG_TABLE_NAME AND record_id=NEW.id ORDER BY revision DESC LIMIT 30);
  RETURN NEW;
 END $$`)
 for(const table of kinds) {
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1`)
  await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
  await db.query(`INSERT INTO content_versions(kind,record_id,revision,snapshot,action)
   SELECT '${table}',id,revision,to_jsonb(t),'initial' FROM ${table} t ON CONFLICT DO NOTHING`)
  await db.query(`DROP TRIGGER IF EXISTS nova_content_before ON ${table}`)
  await db.query(`CREATE TRIGGER nova_content_before BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION nova_content_before()`)
  await db.query(`DROP TRIGGER IF EXISTS nova_content_version ON ${table}`)
  await db.query(`CREATE TRIGGER nova_content_version AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION nova_content_version()`)
 }
}
export async function contentTransaction(pool, req, reply, fn, action='save') {
 const db=await pool.connect()
 let status=200,sent=false,payload
 // Do not acknowledge a write before PostgreSQL has committed it.
 const deferred={code(value){status=value;return this},send(value){sent=true;payload=value;return this}}
 try {
  await db.query('BEGIN')
  await db.query("SELECT set_config('nova.content_actor',$1,TRUE),set_config('nova.content_action',$2,TRUE)",[String(req.novaSession?.user_id||''),action])
  const result=await fn(db,deferred)
  await db.query('COMMIT');return sent?reply.code(status).send(payload):result
 } catch(e) {await db.query('ROLLBACK');throw e} finally {db.release()}
}
export async function contentConflict(db, kind, id, reply) {
 const current=(await db.query(`SELECT *,id::text,revision::text FROM ${kind} WHERE id=$1`,[id])).rows[0]
 return current ? reply.code(409).send({code:'content_conflict',error:'Содержимое изменилось. Сравните версии перед сохранением.',current}) : reply.code(404).send({error:'Запись не найдена'})
}
function draftPayload(kind, payload) {
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!editable[kind].includes(k)))return null
 const stack=[{value:payload,depth:0}];let nodes=0
 while(stack.length) {
  const {value,depth}=stack.pop()
  if(++nodes>50000||depth>12)return null
  if(typeof value==='string'&&value.includes('\0'))return null
  if(value&&typeof value==='object')for(const v of Object.values(value))stack.push({value:v,depth:depth+1})
 }
 if(Buffer.byteLength(JSON.stringify(payload))>1800000)return null
 for(const [key,value]of Object.entries(payload)) {
  if(key==='published'){if(typeof value!=='boolean')return null}
  else if(['sections','tags'].includes(key)){if(!Array.isArray(value)||value.length>(key==='sections'?50:20))return null}
  else if(key==='seo'){if(!value||typeof value!=='object'||Array.isArray(value))return null}
  else if(typeof value!=='string'||value.length>100000)return null
 }
 return payload
}
export function registerContentLifecycle(app,pool,requireAdmin,kind) {
 if(!kinds.has(kind))throw Error('Invalid content kind')
 const base='/api/admin/'+kind,auth={preHandler:requireAdmin}
 app.get(base+'/:id',auth,async(req,reply)=>{
  if(!idValid(req.params.id))return reply.code(400).send({error:'Неверный ID'})
  const row=(await pool.query(`SELECT *,id::text,revision::text FROM ${kind} WHERE id=$1 AND deleted_at IS NULL`,[req.params.id])).rows[0]
  return row||reply.code(404).send({error:'Запись не найдена'})
 })
 app.get(base+'/:id/versions',auth,async(req,reply)=>{
  if(!idValid(req.params.id))return reply.code(400).send({error:'Неверный ID'})
  return (await pool.query('SELECT revision::text,action,created_at,user_id FROM content_versions WHERE kind=$1 AND record_id=$2 ORDER BY content_versions.revision DESC',[kind,req.params.id])).rows
 })
 app.get(base+'/:id/versions/:revision',auth,async(req,reply)=>{
  if(!idValid(req.params.id)||!contentRevision(req.params.revision))return reply.code(400).send({error:'Неверная версия'})
  const row=(await pool.query('SELECT snapshot FROM content_versions WHERE kind=$1 AND record_id=$2 AND revision=$3',[kind,req.params.id,req.params.revision])).rows[0]
  // A version is data only; clients preview and save editable fields through the normal CAS endpoint.
  return row?{...Object.fromEntries(editable[kind].map(k=>[k,row.snapshot[k]])),published:false}:reply.code(404).send({error:'Версия больше не хранится'})
 })
 app.get(base+'/drafts/:key',auth,async(req,reply)=>{
  if(req.params.key!=='new'&&!idValid(req.params.key))return reply.code(400).send({error:'Неверный черновик'})
  return (await pool.query('SELECT payload,base_revision::text,revision::text,saved_at FROM content_drafts WHERE user_id=$1 AND kind=$2 AND record_key=$3',[req.novaSession.user_id,kind,req.params.key])).rows[0]||null
 })
 for(const method of ['PUT','DELETE'])app.route({method,url:base+'/drafts/:key',...auth,bodyLimit:2000000,handler:async(req,reply)=>{
  const {key}=req.params,b=req.body
  if(key!=='new'&&!idValid(key)||!b||!(b.revision==='0'||contentRevision(b.revision)))return reply.code(400).send({error:'Неверная версия черновика'})
  if(method==='PUT'&&(!draftPayload(kind,b.payload)||(key==='new'?b.base_revision!==null:!contentRevision(b.base_revision))))return reply.code(400).send({error:'Некорректный черновик'})
  return contentTransaction(pool,req,reply,async (db,reply)=>{
   if(method==='PUT'&&key!=='new'&&!(await db.query(`SELECT id FROM ${kind} WHERE id=$1 AND deleted_at IS NULL FOR SHARE`,[key])).rowCount)return reply.code(409).send({error:'Запись удалена. Скопируйте текст перед закрытием.'})
   const args=[req.novaSession.user_id,kind,key,b.revision]
   const r=method==='DELETE'
    ?await db.query('DELETE FROM content_drafts WHERE user_id=$1 AND kind=$2 AND record_key=$3 AND revision=$4 RETURNING revision',args)
    :b.revision==='0'
     ?await db.query('INSERT INTO content_drafts(user_id,kind,record_key,payload,base_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING revision::text,saved_at',[...args.slice(0,3),JSON.stringify(b.payload),b.base_revision])
     :await db.query('UPDATE content_drafts SET payload=$5,base_revision=$6,revision=revision+1,saved_at=clock_timestamp() WHERE user_id=$1 AND kind=$2 AND record_key=$3 AND revision=$4 RETURNING revision::text,saved_at',[...args,JSON.stringify(b.payload),b.base_revision])
   if(!r.rowCount)return reply.code(409).send({code:'draft_conflict',error:'Личный черновик изменён в другой вкладке. Скопируйте свой текст; затем откройте редактор заново.'})
   // Check even incomplete work copies against deleted media, taking the same row locks as content writes.
   if(method==='PUT')for(const url of new Set(JSON.stringify(b.payload).match(/\/uploads\/[a-f0-9-]{36}\.(?:png|jpg|webp)/g)||[]))await db.query('SELECT nova_media_check($1)',[url])
   return method==='DELETE'?reply.code(204).send():r.rows[0]
  })
 }})
 for(const operation of ['trash','restore','purge'])app.route({method:operation==='trash'||operation==='purge'?'DELETE':'POST',url:base+'/:id'+(operation==='trash'?'':'/'+operation),...auth,handler:async(req,reply)=>{
  if(!idValid(req.params.id)||!contentRevision(req.body?.revision))return reply.code(400).send({error:'Укажите текущую версию записи'})
  return contentTransaction(pool,req,reply,async (db,reply)=>{
   const args=[req.params.id,req.body.revision]
   const r=operation==='purge'?await db.query(`DELETE FROM ${kind} WHERE id=$1 AND revision=$2 AND deleted_at IS NOT NULL RETURNING id`,args):await db.query(`UPDATE ${kind} SET deleted_at=${operation==='trash'?'NOW()':'NULL'},published=FALSE WHERE id=$1 AND revision=$2 AND deleted_at IS ${operation==='trash'?'NULL':'NOT NULL'} RETURNING *,id::text,revision::text`,args)
   if(!r.rowCount)return contentConflict(db,kind,req.params.id,reply)
   return operation==='restore'?r.rows[0]:reply.code(204).send()
  },operation)
 }})
}
