import {createHmac,createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'
import {defaultFormSettings,validateForm,cleanForm,validateFormSettings,formChannelsReady,validateFormValues,formId} from '../../../shared/forms.js'
import {secretVault,formTransports,deliveryFailure} from './formDelivery.js'
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{statusCode,contact:true})}
const sha=value=>createHash('sha256').update(value).digest('hex')
const number=id=>'F'+String(id).padStart(6,'0')
const receipt=row=>({accepted:true,number:number(row.id),message:row.snapshot.success})
export async function initForms(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS contact_settings(id INTEGER PRIMARY KEY CHECK(id=1),config JSONB NOT NULL,secret_box TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1)`)
 await pool.query('INSERT INTO contact_settings(id,config) VALUES(1,$1) ON CONFLICT(id) DO NOTHING',[JSON.stringify(defaultFormSettings)])
 await pool.query(`CREATE TABLE IF NOT EXISTS contact_forms(id UUID PRIMARY KEY,config JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`CREATE TABLE IF NOT EXISTS contact_submissions(id BIGSERIAL PRIMARY KEY,request_id UUID NOT NULL UNIQUE,payload_hash VARCHAR(64) NOT NULL,form_id UUID REFERENCES contact_forms(id),snapshot JSONB NOT NULL,values JSONB NOT NULL,source VARCHAR(250) NOT NULL DEFAULT '',status VARCHAR(16) NOT NULL DEFAULT 'new' CHECK(status IN ('new','read','closed')),revision INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`CREATE TABLE IF NOT EXISTS contact_deliveries(id UUID PRIMARY KEY,submission_id BIGINT NOT NULL REFERENCES contact_submissions(id) ON DELETE CASCADE,channel VARCHAR(16) NOT NULL CHECK(channel IN ('email','telegram')),state VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','partial','failed','uncertain')),secret_box TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,not_before TIMESTAMPTZ NOT NULL DEFAULT NOW(),started_at TIMESTAMPTZ,finished_at TIMESTAMPTZ,error_code VARCHAR(40) NOT NULL DEFAULT '',external_id VARCHAR(100) NOT NULL DEFAULT '',UNIQUE(submission_id,channel))`)
 await pool.query(`CREATE TABLE IF NOT EXISTS contact_throttle(key VARCHAR(64) PRIMARY KEY,attempts INTEGER NOT NULL,reset_at TIMESTAMPTZ NOT NULL)`)
 for(const sql of ['CREATE INDEX IF NOT EXISTS contact_submissions_created_idx ON contact_submissions(created_at DESC,id DESC)','CREATE INDEX IF NOT EXISTS contact_delivery_queue_idx ON contact_deliveries(state,not_before)','CREATE INDEX IF NOT EXISTS contact_throttle_expiry_idx ON contact_throttle(reset_at)'])await pool.query(sql)
}
export function formChallenges(secret,now=()=>Date.now()){
 const sign=value=>createHmac('sha256',secret).update('nova-contact-challenge-v1:'+value).digest('hex')
 return {issue:(id,revision)=>{const data=[id,revision,now(),randomBytes(16).toString('hex')].join('.');return data+'.'+sign(data)},verify:(token,id,revision)=>{
  if(typeof token!=='string'||token.length>250)return false
  const p=token.split('.');if(p.length!==5||p[0]!==id||p[1]!==String(revision)||!/^\d{13}$/.test(p[2])||! /^[a-f0-9]{32}$/.test(p[3])||! /^[a-f0-9]{64}$/.test(p[4]))return false
  const age=now()-Number(p[2]);return age>=2000&&age<=30*60000&&timingSafeEqual(Buffer.from(p[4],'hex'),Buffer.from(sign(p.slice(0,4).join('.')),'hex'))
 }}
}
export async function readFormSettings(pool,vault,lock=false){
 const row=(await pool.query('SELECT config,secret_box,revision FROM contact_settings WHERE id=1'+(lock?' FOR SHARE':''))).rows[0]
 let secrets={},secret_error=false
 if(row.secret_box)try{secrets=vault.open(row.secret_box)}catch{secret_error=true}
 return {config:{...row.config,revision:row.revision},secrets,secret_error}
}
function adminSettings(s){return {...s.config,smtp_password_set:!!s.secrets.smtp_password,bot_token_set:!!s.secrets.bot_token,secret_error:s.secret_error}}
function snapshotDelivery(s,channel){return channel==='email'?{email:s.config.email,smtp_password:s.secrets.smtp_password||''}:{telegram:s.config.telegram,bot_token:s.secrets.bot_token}}
const sourcePath=value=>typeof value==='string'&&/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?\/?$/.test(value)&&value.length<=250&&!/^\/(admin|api|uploads)(\/|$)/.test(value)?value:''
async function consumeLimit(db,key,limit,minutes){const r=await db.query(`INSERT INTO contact_throttle(key,attempts,reset_at) VALUES($1,1,NOW()+($2*INTERVAL '1 minute')) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN contact_throttle.reset_at<=NOW() THEN 1 ELSE contact_throttle.attempts+1 END,reset_at=CASE WHEN contact_throttle.reset_at<=NOW() THEN EXCLUDED.reset_at ELSE contact_throttle.reset_at END WHERE contact_throttle.attempts<$3 OR contact_throttle.reset_at<=NOW() RETURNING attempts`,[key,minutes,limit]);if(!r.rowCount)fail(429,'Слишком много обращений. Повторите позже.')}
export async function submitContact(pool,id,body,{vault,challenges,ipKey}){
 if(!formId(id)||!formId(body?.request_id))fail(400,'Обновите форму')
 if(typeof body.website==='string'&&body.website)return {accepted:true,message:'Сообщение принято.'}
 const hash=sha(JSON.stringify({form_id:id,values:body.values,consent:body.consent})),db=await pool.connect()
 try{
  await db.query('BEGIN')
  // Claim UUID first, then serialize retries. Roll back placeholder on any validation failure.
  const inserted=await db.query(`INSERT INTO contact_submissions(request_id,payload_hash,snapshot,values) VALUES($1,$2,'{}','{}') ON CONFLICT(request_id) DO NOTHING RETURNING id`,[body.request_id,hash])
  const row=(await db.query('SELECT id,payload_hash,snapshot FROM contact_submissions WHERE request_id=$1 FOR UPDATE',[body.request_id])).rows[0]
  if(!inserted.rowCount){if(row.payload_hash!==hash)fail(409,'Обращение изменилось. Начните новую отправку.');await db.query('COMMIT');return receipt(row)}
  const form=(await db.query('SELECT config,revision FROM contact_forms WHERE id=$1 FOR SHARE',[id])).rows[0]
  if(!form?.config.enabled)fail(404,'Форма недоступна')
  const s=await readFormSettings(db,vault,true)
  if(s.secret_error||!formChannelsReady(s.config,s.secrets,form.config.channels))fail(503,'Форма временно недоступна. Обратитесь в магазин другим способом.')
  const error=validateFormValues(form.config,body);if(error)fail(400,error)
  if(!challenges.verify(body.challenge,id,form.revision))fail(409,'Форма устарела или отправлена слишком быстро. Обновите её и повторите через пару секунд.')
  // A global daily budget also respects the default 1Gb.ru script-mail quota with headroom.
  await consumeLimit(db,ipKey,5,15);await consumeLimit(db,sha('nova-contact-daily'),100,1440)
  const values=Object.fromEntries(form.config.fields.map(f=>[f.key,typeof body.values[f.key]==='string'?body.values[f.key].trim():body.values[f.key]]))
  const snapshot={title:form.config.title,fields:form.config.fields,success:form.config.success,consent_label:form.config.consent_label,privacy_url:form.config.privacy_url,consent:true}
  await db.query('UPDATE contact_submissions SET form_id=$1,snapshot=$2,values=$3,source=$4 WHERE id=$5',[id,JSON.stringify(snapshot),JSON.stringify(values),sourcePath(body.source),row.id])
  for(const channel of form.config.channels)await db.query('INSERT INTO contact_deliveries(id,submission_id,channel,secret_box) VALUES($1,$2,$3,$4)',[randomUUID(),row.id,channel,vault.seal(snapshotDelivery(s,channel))])
  await db.query('COMMIT');return receipt({...row,snapshot})
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export async function deliverContactJob(pool,vault,{transports=formTransports}={}){
 const db=await pool.connect();let job
 try{
  await db.query('BEGIN')
  const s=await readFormSettings(db,vault),enabled=['email','telegram'].filter(c=>s.config[c]?.enabled)
  if(!s.config.enabled||s.secret_error||!enabled.length){await db.query('COMMIT');return false}
  job=(await db.query(`SELECT d.id,d.submission_id::text,d.channel,d.secret_box,d.attempts FROM contact_deliveries d WHERE d.state='queued' AND d.not_before<=NOW() AND d.channel=ANY($1::varchar[]) ORDER BY d.not_before,d.id FOR UPDATE SKIP LOCKED LIMIT 1`,[enabled])).rows[0]
  if(!job){await db.query('COMMIT');return false}
  await db.query("UPDATE contact_deliveries SET state='sending',attempts=attempts+1,started_at=NOW(),error_code='' WHERE id=$1",[job.id])
  await db.query('COMMIT')
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 const row=(await pool.query('SELECT snapshot,values,source FROM contact_submissions WHERE id=$1',[job.submission_id])).rows[0]
 let result,state='sent',errorCode='',delay=0
 try{
  let config;try{config=vault.open(job.secret_box)}catch{throw Object.assign(Error('Credential snapshot unavailable'),{code:'ESECRETS'})}
  result=await transports[job.channel](config,{...row.snapshot,values:row.values,source:row.source,number:number(job.submission_id),delivery_id:job.id})
  if(result?.partial)state='partial'
 }catch(error){const e=deliveryFailure(error);errorCode=e.code;if(e.uncertain)state='uncertain';else if(e.retry&&job.attempts<2){state='queued';delay=e.retry_after||[60,300,1800][job.attempts]}else state='failed'}
 await pool.query(`UPDATE contact_deliveries SET state=$1::text,error_code=$2,external_id=$3,finished_at=CASE WHEN $1='queued' THEN NULL ELSE NOW() END,not_before=NOW()+($4*INTERVAL '1 second'),secret_box=CASE WHEN $1 IN ('sent','partial') THEN '' ELSE secret_box END WHERE id=$5 AND state='sending'`,[state,errorCode,result?.external_id||'',delay,job.id])
 return true
}
export async function maintainContacts(pool,retention){
 // A process may die after a provider accepted a notification. Never blindly send it again.
 await pool.query("UPDATE contact_deliveries SET state='uncertain',error_code='WORKER_INTERRUPTED',finished_at=NOW() WHERE state='sending' AND started_at<NOW()-INTERVAL '2 minutes'")
 await pool.query("DELETE FROM contact_submissions s WHERE s.created_at<NOW()-($1*INTERVAL '1 day') AND NOT EXISTS(SELECT 1 FROM contact_deliveries d WHERE d.submission_id=s.id AND d.state='sending')",[retention])
 await pool.query('DELETE FROM contact_throttle WHERE reset_at<=NOW()')
}
export function registerForms(app,pool,requireAdmin,{secret,origins=[],worker=true,transports=formTransports,now=()=>Date.now()}={}){
 const vault=secretVault(secret),challenges=formChallenges(secret,now),protect=fn=>async(req,reply)=>{try{return await fn(req,reply)}catch(e){if(e.contact)return reply.code(e.statusCode).send({error:e.message});throw e}}
 const settings=()=>readFormSettings(pool,vault)
 app.get('/api/admin/forms/settings',{preHandler:requireAdmin},async()=>adminSettings(await settings()))
 app.put('/api/admin/forms/settings',{preHandler:requireAdmin,bodyLimit:16000},protect(async(req)=>{
  const b=req.body,error=validateFormSettings(b);if(error)fail(400,error)
  const db=await pool.connect();try{
   await db.query('BEGIN');const old=await readFormSettings(db,vault)
   const secrets={smtp_password:b.clear_smtp_password?'':b.smtp_password||old.secrets.smtp_password||'',bot_token:b.clear_bot_token?'':b.bot_token||old.secrets.bot_token||''}
   const config={enabled:b.enabled,retention_days:b.retention_days,email:{enabled:b.email.enabled,mode:b.email.mode,host:b.email.host.toLowerCase(),port:b.email.port,tls:b.email.tls,user:b.email.user,from:b.email.from,to:b.email.to},telegram:{enabled:b.telegram.enabled,chat_id:b.telegram.chat_id}}
   if(config.enabled){const channels=['email','telegram'].filter(c=>config[c].enabled);if(!channels.length||!formChannelsReady(config,secrets,channels))fail(400,'Заполните параметры включённых каналов, включая секреты и получателей')}
   const r=await db.query('UPDATE contact_settings SET config=$1,secret_box=$2,revision=revision+1 WHERE id=1 AND revision=$3 RETURNING revision',[JSON.stringify(config),vault.seal(secrets),b.revision]);if(!r.rowCount)fail(409,'Настройки изменились. Обновите страницу.')
   await db.query('COMMIT');return adminSettings({config:{...config,revision:r.rows[0].revision},secrets,secret_error:false})
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }))
 app.get('/api/admin/forms',{preHandler:requireAdmin},async()=>{const s=await settings();return (await pool.query('SELECT id::text,config,revision,updated_at FROM contact_forms ORDER BY updated_at DESC LIMIT 100')).rows.map(r=>({id:r.id,...r.config,revision:r.revision,ready:!s.secret_error&&!!formChannelsReady(s.config,s.secrets,r.config.channels)}))})
 for(const method of ['POST','PUT'])app.route({method,url:'/api/admin/forms'+(method==='PUT'?'/:id':''),preHandler:requireAdmin,bodyLimit:20000,handler:protect(async(req,reply)=>{
  const error=validateForm(req.body);if(error)fail(400,error)
  const c=cleanForm(req.body)
  if(method==='POST'){if((await pool.query('SELECT COUNT(*)::int AS n FROM contact_forms')).rows[0].n>=100)fail(409,'Максимум 100 форм');const id=randomUUID();await pool.query('INSERT INTO contact_forms(id,config) VALUES($1,$2)',[id,JSON.stringify(c)]);return reply.code(201).send({id,...c,revision:1})}
  if(!formId(req.params.id)||!Number.isInteger(req.body.revision))fail(400,'Обновите форму перед сохранением')
  const r=await pool.query('UPDATE contact_forms SET config=$1,revision=revision+1,updated_at=NOW() WHERE id=$2 AND revision=$3 RETURNING revision',[JSON.stringify(c),req.params.id,req.body.revision]);if(!r.rowCount)fail(409,'Форма изменена. Откройте её заново.');return {id:req.params.id,...c,revision:r.rows[0].revision}
 })})
 app.get('/api/forms/:id',protect(async(req)=>{
  if(!formId(req.params.id))fail(404,'Форма не найдена')
  const row=(await pool.query('SELECT config,revision FROM contact_forms WHERE id=$1',[req.params.id])).rows[0],s=await settings()
  if(!row?.config.enabled||s.secret_error||!formChannelsReady(s.config,s.secrets,row.config.channels))return {available:false}
  const {title,description,fields,button,consent_label,privacy_url}=row.config
  return {available:true,title,description,fields,button,consent_label,privacy_url,challenge:challenges.issue(req.params.id,row.revision)}
 }))
 app.post('/api/forms/:id/submit',{bodyLimit:32000,onRequest:async(req,reply)=>{if(req.headers['x-nova-form']!=='1'||req.headers.origin&&!origins.includes(req.headers.origin))return reply.code(403).send({error:'Запрос отклонён'})}},protect(async(req,reply)=>{
  const ipKey=createHmac('sha256',secret).update('nova-contact-ip-v1:'+req.ip).digest('hex')
  return reply.code(202).send(await submitContact(pool,req.params.id,req.body,{vault,challenges,ipKey}))
 }))
 const deliveries=id=>pool.query('SELECT id::text,channel,state,attempts,error_code,external_id,started_at,finished_at FROM contact_deliveries WHERE submission_id=$1 ORDER BY channel',[id])
 app.get('/api/admin/forms/messages',{preHandler:requireAdmin},protect(async(req)=>{
  const page=Number(req.query.page||1),status=req.query.status||'';if(!Number.isInteger(page)||page<1||page>10000||!['','new','read','closed'].includes(status))fail(400,'Некорректный фильтр')
  const total=(await pool.query("SELECT COUNT(*)::int AS n FROM contact_submissions WHERE ($1='' OR status=$1)",[status])).rows[0].n
  const rows=(await pool.query("SELECT id::text,snapshot->>'title' AS title,status,created_at,(SELECT jsonb_agg(jsonb_build_object('channel',d.channel,'state',d.state,'error_code',d.error_code)) FROM contact_deliveries d WHERE d.submission_id=s.id) AS deliveries FROM contact_submissions s WHERE ($1='' OR status=$1) ORDER BY id DESC LIMIT 25 OFFSET $2",[status,(page-1)*25])).rows.map(r=>({...r,number:number(r.id)}));return {rows,total,page}
 }))
 app.get('/api/admin/forms/messages/:id',{preHandler:requireAdmin},protect(async(req)=>{
  if(!/^[1-9][0-9]{0,17}$/.test(req.params.id))fail(400,'Неверный ID')
  const r=(await pool.query('SELECT id::text,form_id::text,snapshot,values,source,status,revision,created_at FROM contact_submissions WHERE id=$1',[req.params.id])).rows[0];if(!r)fail(404,'Обращение не найдено');return {...r,number:number(r.id),deliveries:(await deliveries(r.id)).rows}
 }))
 app.put('/api/admin/forms/messages/:id',{preHandler:requireAdmin},protect(async(req)=>{
  if(!/^[1-9][0-9]{0,17}$/.test(req.params.id)||!['new','read','closed'].includes(req.body?.status)||!Number.isInteger(req.body?.revision))fail(400,'Некорректный статус')
  const r=await pool.query('UPDATE contact_submissions SET status=$1,revision=revision+1 WHERE id=$2 AND revision=$3 RETURNING id',[req.body.status,req.params.id,req.body.revision]);if(!r.rowCount)fail(409,'Обращение изменилось. Обновите карточку.');return {ok:true}
 }))
 app.post('/api/admin/forms/deliveries/:id/retry',{preHandler:requireAdmin},protect(async(req)=>{
  if(!formId(req.params.id)||req.body?.acknowledge_duplicate!==true)fail(400,'Подтвердите риск повторного уведомления')
  // Explicit retry uses the currently configured destination and credentials, shown in settings.
  const s=await settings(),db=await pool.connect();try{
   await db.query('BEGIN');const job=(await db.query('SELECT channel,state FROM contact_deliveries WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0]
   if(!job||!['failed','uncertain','partial'].includes(job.state))fail(409,'Повтор для этого уведомления недоступен')
   if(s.secret_error||!formChannelsReady(s.config,s.secrets,[job.channel]))fail(400,'Канал не настроен или выключен')
   await db.query("UPDATE contact_deliveries SET state='queued',attempts=0,not_before=NOW(),started_at=NULL,finished_at=NULL,error_code='',secret_box=$1 WHERE id=$2",[vault.seal(snapshotDelivery(s,job.channel)),req.params.id]);await db.query('COMMIT');return {ok:true}
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }))
 app.post('/api/admin/forms/test',{preHandler:requireAdmin},protect(async(req,reply)=>{
  const channel=req.body?.channel,s=await settings();if(!['email','telegram'].includes(channel)||s.secret_error||!formChannelsReady(s.config,s.secrets,[channel]))fail(400,'Сначала сохраните и включите канал')
  const db=await pool.connect();try{
   await db.query('BEGIN');await consumeLimit(db,sha('nova-contact-admin-test'),5,15);await consumeLimit(db,sha('nova-contact-daily'),100,1440)
   const snapshot={title:'Проверка уведомлений',fields:[],success:'Тест поставлен в очередь',consent_label:'Тест администратора, без данных посетителя',test:true}
   const row=(await db.query("INSERT INTO contact_submissions(request_id,payload_hash,snapshot,values,status) VALUES($1,$2,$3,'{}','read') RETURNING id",[randomUUID(),sha(randomUUID()),JSON.stringify(snapshot)])).rows[0]
   await db.query('INSERT INTO contact_deliveries(id,submission_id,channel,secret_box) VALUES($1,$2,$3,$4)',[randomUUID(),row.id,channel,vault.seal(snapshotDelivery(s,channel))]);await db.query('COMMIT');return reply.code(202).send({number:number(row.id),accepted:true})
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }))
 if(worker){let active=false,lastClean=0
  const tick=async()=>{if(active)return;active=true;try{const s=await settings();if(Date.now()-lastClean>6*3600000){await maintainContacts(pool,s.config.retention_days);lastClean=Date.now()}await deliverContactJob(pool,vault,{transports})}catch{app.log.warn({event:'contact.worker_failed'})}finally{active=false}}
  const timer=setInterval(tick,5000);timer.unref();app.addHook('onClose',async()=>{clearInterval(timer);while(active)await new Promise(r=>setTimeout(r,50))})
 }
 return {vault,challenges}
}
