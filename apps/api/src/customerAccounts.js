import {createHash,createHmac,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto'
import {normalizePhone,validEmail,orderNumber} from '../../../shared/commerce.js'
import {formChannelsReady} from '../../../shared/forms.js'
import {readFormSettings} from './forms.js'
import {secretVault,sendEmail} from './formDelivery.js'
const hash=v=>createHash('sha256').update(v).digest('hex')
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const id=v=>typeof v==='string'&&/^[1-9][0-9]{0,17}$/.test(v)
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{customerAccount:true,statusCode})}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'))
export function customerEmail(value){return typeof value==='string'&&value.length<=254&&validEmail(value.trim())&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,63}$/i.test(value.trim())&&!value.includes('..')?value.trim().toLowerCase():''}
export async function initCustomerAccounts(db){
 await db.query(`CREATE TABLE IF NOT EXISTS customer_accounts(id BIGSERIAL PRIMARY KEY,email VARCHAR(254) NOT NULL UNIQUE,name VARCHAR(150) NOT NULL DEFAULT '',phone VARCHAR(16) NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await db.query(`CREATE TABLE IF NOT EXISTS customer_sessions(token_hash TEXT PRIMARY KEY,account_id BIGINT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await db.query('CREATE INDEX IF NOT EXISTS customer_sessions_account_idx ON customer_sessions(account_id,expires_at)')
 await db.query(`CREATE TABLE IF NOT EXISTS customer_login_codes(id UUID PRIMARY KEY,email VARCHAR(254) NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ,state TEXT NOT NULL DEFAULT 'queued',box TEXT NOT NULL DEFAULT '',started_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await db.query("CREATE INDEX IF NOT EXISTS customer_login_codes_queue_idx ON customer_login_codes(created_at) WHERE state='queued'")
 await db.query(`CREATE TABLE IF NOT EXISTS customer_auth_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at TIMESTAMPTZ NOT NULL)`)
 await db.query(`CREATE TABLE IF NOT EXISTS customer_addresses(id UUID PRIMARY KEY,account_id BIGINT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,label VARCHAR(80) NOT NULL,name VARCHAR(150) NOT NULL,phone VARCHAR(16) NOT NULL,address TEXT NOT NULL,is_default BOOLEAN NOT NULL DEFAULT FALSE,revision INTEGER NOT NULL DEFAULT 1)`)
 await db.query('CREATE INDEX IF NOT EXISTS customer_addresses_account_idx ON customer_addresses(account_id)')
 await db.query('CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_default_idx ON customer_addresses(account_id) WHERE is_default')
 await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES customer_accounts(id) ON DELETE SET NULL')
 await db.query('CREATE INDEX IF NOT EXISTS orders_account_idx ON orders(account_id,id DESC)')
 await db.query('ALTER TABLE order_requests ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES customer_accounts(id) ON DELETE SET NULL')
}
async function transaction(pool,fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
async function limit(db,key,max,seconds){const r=await db.query(`INSERT INTO customer_auth_limits(key,attempts,reset_at) VALUES($1,1,NOW()+($2*INTERVAL '1 second')) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN customer_auth_limits.reset_at<=NOW() THEN 1 ELSE customer_auth_limits.attempts+1 END,reset_at=CASE WHEN customer_auth_limits.reset_at<=NOW() THEN EXCLUDED.reset_at ELSE customer_auth_limits.reset_at END WHERE customer_auth_limits.attempts<$3 OR customer_auth_limits.reset_at<=NOW() RETURNING attempts`,[key,seconds,max]);if(!r.rowCount)fail(429,'Слишком много попыток. Попробуйте позже.')}
const userView=r=>({id:String(r.id),email:r.email,name:r.name,phone:r.phone,revision:r.revision})
export async function deliverCustomerCode(db,vault,{send=sendEmail}={}){
 const job=await transaction(db,async c=>{await c.query("UPDATE customer_login_codes SET state='uncertain',box='' WHERE state='sending' AND started_at<NOW()-INTERVAL '1 minute'");const r=(await c.query("SELECT id,box FROM customer_login_codes WHERE state='queued' AND consumed_at IS NULL AND expires_at>NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(r)await c.query("UPDATE customer_login_codes SET state='sending',started_at=NOW() WHERE id=$1",[r.id]);return r})
 if(!job)return false
 let state='sent'
 try{const frozen=vault.open(job.box),result=await send(frozen.transport,frozen.message);if(result?.partial)state='failed'}catch{state='uncertain'}
 await db.query('UPDATE customer_login_codes SET state=$2,box=$3 WHERE id=$1 AND state=$4',[job.id,state,'','sending']);return true
}
export function registerCustomerAccounts(app,pool,{secret,secure=false,origins=[],worker=true,send=sendEmail,mailSettings}={}){
 if(typeof secret!=='string'||secret.length<16)throw Error('Customer accounts require a server secret')
 const vault=secretVault(secret),sign=value=>createHmac('sha256',secret).update('nova-customer-v1:'+value).digest('hex')
 const cookieName=secure?'__Host-nova_customer':'nova_customer'
 const mail=mailSettings||(()=>readFormSettings(pool,vault))
 const ready=s=>!s.secret_error&&!!formChannelsReady(s.config,s.secrets,['email'])
 const protect=fn=>async(req,reply)=>{try{return await fn(req,reply)}catch(e){if(e.customerAccount)return reply.code(e.statusCode).header('Retry-After',e.statusCode===429?'60':'0').send({error:e.message});if(['23505','55P03','40001','40P01'].includes(e.code))return reply.code(409).send({error:'Данные изменились. Обновите страницу и повторите действие.'});throw e}}
 function token(req){const values=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));const value=values.length===1?values[0].slice(cookieName.length+1):'';return /^[a-f0-9]{64}$/.test(value)?value:''}
 function cookie(reply,value,age){reply.header('Set-Cookie',`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`)}
 function trusted(req){if(req.headers['x-nova-account']!=='1'||req.headers.origin&&!origins.includes(req.headers.origin))fail(403,'Запрос отклонён')}
 async function session(req){
  if(req.customerSession!==undefined)return req.customerSession
  const value=token(req);req.customerSession=null;if(!value)return null
  const r=(await pool.query("SELECT a.id::text,a.email,a.name,a.phone,a.revision,s.token_hash,s.csrf FROM customer_sessions s JOIN customer_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND a.enabled=TRUE AND s.expires_at>NOW() AND s.last_seen_at>NOW()-INTERVAL '24 hours'",[hash(value)])).rows[0]||null
  if(r)await pool.query("UPDATE customer_sessions SET last_seen_at=NOW() WHERE token_hash=$1 AND last_seen_at<NOW()-INTERVAL '1 minute'",[r.token_hash])
  req.customerSession=r;return r
 }
 const requireCustomer=protect(async(req,reply)=>{const s=await session(req);if(!s){cookie(reply,'',0);fail(401,'Войдите в личный кабинет')};if(!['GET','HEAD'].includes(req.method)){trusted(req);if(!equal(req.headers['x-customer-csrf'],s.csrf))fail(403,'Обновите страницу и повторите действие')}})
 const auth={onRequest:requireCustomer}
 app.get('/api/account/config',protect(async()=>({available:ready(await mail())})))
 app.get('/api/account/me',{onRequest:requireCustomer},async req=>({user:userView(req.customerSession),csrf_token:req.customerSession.csrf}))
 app.post('/api/account/login/request',{bodyLimit:2048},protect(async(req,reply)=>{
  trusted(req);const email=customerEmail(req.body?.email);if(!email)fail(400,'Проверьте электронную почту')
  // Persistent limits survive restarts; no route reveals whether an email already owns an account.
  await limit(pool,sign('send-ip:'+req.ip),20,3600);await limit(pool,sign('send-email:'+email),5,3600);await limit(pool,sign('resend:'+email),1,60);await limit(pool,sign('send-global'),1000,3600)
  const settings=await mail();if(!ready(settings))fail(503,'Вход по email пока не настроен. Можно оформить заказ без личного кабинета.')
  const challenge=randomUUID(),code=String(randomInt(1000000)).padStart(6,'0')
  const message={purpose:'customer-login',title:'Код входа в личный кабинет',number:'Вход',delivery_id:challenge,fields:[],values:{code},consent_label:'Запрошен вход в личный кабинет',source:''}
  const frozen={transport:{email:{...settings.config.email,to:[email]},smtp_password:settings.secrets.smtp_password||''},message}
  await pool.query("INSERT INTO customer_login_codes(id,email,code_hash,expires_at,box) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes',$4)",[challenge,email,sign(challenge+':'+code),vault.seal(frozen)])
  return reply.code(202).send({challenge_id:challenge,expires_in:600,resend_after:60})
 }))
 app.post('/api/account/login/verify',{bodyLimit:2048},protect(async(req,reply)=>{
  trusted(req);await limit(pool,sign('verify-ip:'+req.ip),40,900)
  const b=req.body;if(!uuid(b?.challenge_id)||typeof b.code!=='string'||!/^\d{6}$/.test(b.code))fail(400,'Введите шестизначный код из письма')
  const result=await transaction(pool,async db=>{
   const challenge=(await db.query('SELECT *,expires_at>NOW() AS fresh FROM customer_login_codes WHERE id=$1 FOR UPDATE',[b.challenge_id])).rows[0]
   if(!challenge||!challenge.fresh||challenge.consumed_at||challenge.attempts>=5)return null
   await db.query('UPDATE customer_login_codes SET attempts=attempts+1 WHERE id=$1',[challenge.id])
   if(!equal(sign(challenge.id+':'+b.code),challenge.code_hash))return null
   await db.query("UPDATE customer_login_codes SET consumed_at=NOW(),box='' WHERE id=$1",[challenge.id])
   await db.query('INSERT INTO customer_accounts(email) VALUES($1) ON CONFLICT(email) DO NOTHING',[challenge.email])
   const user=(await db.query('SELECT *,id::text FROM customer_accounts WHERE email=$1 FOR UPDATE',[challenge.email])).rows[0]
   if(!user.enabled)return null
   const value=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex')
   const old=token(req);if(old)await db.query('DELETE FROM customer_sessions WHERE token_hash=$1',[hash(old)])
   await db.query("DELETE FROM customer_sessions WHERE account_id=$1 AND token_hash NOT IN (SELECT token_hash FROM customer_sessions WHERE account_id=$1 AND expires_at>NOW() ORDER BY expires_at DESC LIMIT 4)",[user.id])
   await db.query("INSERT INTO customer_sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '7 days')",[hash(value),user.id,csrf])
   return {user:userView(user),csrf_token:csrf,value}
  })
  if(!result)fail(401,'Код неверен, уже использован или срок его действия истёк')
  cookie(reply,result.value,7*86400);return {user:result.user,csrf_token:result.csrf_token}
 }))
 for(const all of [false,true])app.post('/api/account/'+(all?'logout-all':'logout'),auth,protect(async(req,reply)=>{await pool.query(all?'DELETE FROM customer_sessions WHERE account_id=$1':'DELETE FROM customer_sessions WHERE token_hash=$1',[all?req.customerSession.id:req.customerSession.token_hash]);cookie(reply,'',0);return reply.code(204).send()}))
 app.put('/api/account/profile',{...auth,bodyLimit:2048},protect(async(req)=>{
  const b=req.body;if(!b||Object.keys(b).some(k=>!['name','phone','revision'].includes(k))||typeof b.name!=='string'||b.name.length>150||/[\x00-\x1f]/.test(b.name)||typeof b.phone!=='string'||b.phone&&!normalizePhone(b.phone)||!Number.isInteger(b.revision))fail(400,'Проверьте имя и телефон')
  const r=await pool.query('UPDATE customer_accounts SET name=$1,phone=$2,revision=revision+1 WHERE id=$3 AND revision=$4 RETURNING *,id::text',[b.name.trim(),b.phone?normalizePhone(b.phone):'',req.customerSession.id,b.revision]);if(!r.rowCount)fail(409,'Профиль уже изменён. Обновите страницу.');return userView(r.rows[0])
 }))
 app.get('/api/account/addresses',auth,async req=>(await pool.query('SELECT id::text,label,name,phone,address,is_default,revision FROM customer_addresses WHERE account_id=$1 ORDER BY is_default DESC,label,id',[req.customerSession.id])).rows)
 for(const method of ['POST','PUT','DELETE'])app.route({method,url:'/api/account/addresses'+(method==='POST'?'':'/:id'),...auth,bodyLimit:5000,handler:protect(async(req,reply)=>{
  const b=req.body;if(method!=='POST'&&(!uuid(req.params.id)||!Number.isInteger(b?.revision)))fail(400,'Обновите список адресов')
  if(method!=='DELETE'&&(!b||Object.keys(b).some(k=>!['label','name','phone','address','is_default','revision'].includes(k))||['label','name','address'].some((k,i)=>typeof b[k]!=='string'||!b[k].trim()||b[k].length>[80,150,1000][i]||(k==='address'?/[\x00-\x08\x0b\x0c\x0e-\x1f]/:/[\x00-\x1f]/).test(b[k]))||!normalizePhone(b.phone)||typeof b.is_default!=='boolean'))fail(400,'Проверьте название, получателя, телефон и адрес')
  const result=await transaction(pool,async db=>{
   await db.query('SELECT id FROM customer_accounts WHERE id=$1 FOR UPDATE',[req.customerSession.id])
   if(method!=='POST'&&!(await db.query('SELECT id FROM customer_addresses WHERE id=$1 AND account_id=$2 AND revision=$3',[req.params.id,req.customerSession.id,b.revision])).rowCount)fail(409,'Адрес изменён или недоступен. Обновите список.')
   if(method==='DELETE'){await db.query('DELETE FROM customer_addresses WHERE id=$1 AND account_id=$2',[req.params.id,req.customerSession.id]);return null}
   if(method==='POST'&&Number((await db.query('SELECT COUNT(*) AS n FROM customer_addresses WHERE account_id=$1',[req.customerSession.id])).rows[0].n)>=20)fail(409,'Можно сохранить до 20 адресов')
   if(b.is_default)await db.query('UPDATE customer_addresses SET is_default=FALSE,revision=revision+1 WHERE account_id=$1 AND is_default=TRUE AND id<>$2',[req.customerSession.id,method==='POST'?randomUUID():req.params.id])
   const args=[b.label.trim(),b.name.trim(),normalizePhone(b.phone),b.address.trim(),b.is_default,req.customerSession.id,method==='POST'?randomUUID():req.params.id]
   return (await db.query(method==='POST'?'INSERT INTO customer_addresses(label,name,phone,address,is_default,account_id,id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text,label,name,phone,address,is_default,revision':'UPDATE customer_addresses SET label=$1,name=$2,phone=$3,address=$4,is_default=$5,revision=revision+1 WHERE account_id=$6 AND id=$7 RETURNING id::text,label,name,phone,address,is_default,revision',args)).rows[0]
  })
  return reply.code(method==='DELETE'?204:method==='POST'?201:200).send(result)
 })})
 app.get('/api/account/orders',auth,protect(async(req)=>{
  const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>10000)fail(400,'Неверная страница')
  const r=await pool.query('SELECT id::text,status,payment_state,total_cents,created_at FROM orders WHERE account_id=$1 ORDER BY id DESC LIMIT 26 OFFSET $2',[req.customerSession.id,(page-1)*25])
  return {items:r.rows.slice(0,25).map(r=>({...r,number:orderNumber(r.id),total_cents:Number(r.total_cents)})),page,has_more:r.rows.length>25}
 }))
 async function ownOrder(req){if(!id(req.params.id))fail(400,'Неверный номер заказа');const r=(await pool.query('SELECT id::text,status,payment_state,total_cents,delivery_cents,delivery_snapshot,delivery_method,address,customer_name,phone,email,comment,tracking_code,tracking_url,created_at FROM orders WHERE id=$1 AND account_id=$2',[req.params.id,req.customerSession.id])).rows[0];if(!r)fail(404,'Заказ не найден');return {...r,number:orderNumber(r.id),total_cents:Number(r.total_cents),delivery_cents:Number(r.delivery_cents)}}
 app.get('/api/account/orders/:id',auth,protect(async(req)=>{
  const order=await ownOrder(req),items=(await pool.query('SELECT product_id::text,name,variant_name,sku,quantity,unit_cents FROM order_items WHERE order_id=$1 ORDER BY id',[order.id])).rows.map(r=>({...r,unit_cents:Number(r.unit_cents)}))
  const history=(await pool.query('SELECT status,created_at FROM (SELECT status,created_at,id,LAG(status) OVER(ORDER BY id) AS previous FROM order_history WHERE order_id=$1) h WHERE previous IS DISTINCT FROM status ORDER BY id DESC LIMIT 100',[order.id])).rows
  return {...order,items,history}
 }))
 app.post('/api/account/orders/:id/reorder',{...auth,bodyLimit:1024},protect(async(req)=>{
  const order=await ownOrder(req)
  if(!(await pool.query('SELECT shop_enabled FROM site_settings WHERE id=1')).rows[0]?.shop_enabled)fail(409,'Магазин временно не принимает заказы')
  const original=(await pool.query('SELECT product_id::text,name,variant_name,quantity,unit_cents FROM order_items WHERE order_id=$1 ORDER BY id',[order.id])).rows
  const products=(await pool.query('SELECT id::text,name,price,stock,variants,image_url,published FROM products WHERE id=ANY($1::bigint[])',[original.filter(i=>i.product_id).map(i=>i.product_id)])).rows
  const items=[],warnings=[]
  for(const old of original){
   const p=products.find(p=>p.id===old.product_id),v=old.variant_name?p?.variants.find(v=>v.name===old.variant_name):null,source=old.variant_name?v:p
   if(!p?.published||!source||!old.variant_name&&p.variants.length||source.stock<=0){warnings.push('Недоступен товар: '+old.name+(old.variant_name?' — '+old.variant_name:''));continue}
   const quantity=Math.min(old.quantity,source.stock,100),unit_cents=Math.round(Number(source.price)*100)
   if(quantity!==old.quantity)warnings.push('Количество «'+old.name+'» уменьшено до '+quantity)
   if(unit_cents!==Number(old.unit_cents))warnings.push('Цена «'+old.name+'» изменилась')
   items.push({product_id:Number(p.id),variant_name:old.variant_name,name:p.name,quantity,available:source.stock,unit_cents,previous_unit_cents:Number(old.unit_cents),image_url:p.image_url})
  }
  return {items,warnings,total_cents:items.reduce((n,i)=>n+i.quantity*i.unit_cents,0)}
 }))
 const checkout=async(req,reply)=>{
  try{const s=await session(req),present=(req.headers.cookie||'').split(';').some(v=>v.trim().startsWith(cookieName+'='))
   if(!s){if(present||req.headers['x-customer-csrf'])fail(401,'Сессия покупателя завершена. Войдите снова или обновите страницу для гостевого заказа.');return null}
   if(!equal(req.headers['x-customer-csrf'],s.csrf))fail(403,'Обновите страницу перед оформлением заказа')
   return {id:s.id,token_hash:s.token_hash}
  }catch(e){if(e.customerAccount){reply.code(e.statusCode).send({error:e.message});return null}throw e}
 }
 if(worker){let timer,running
  const tick=()=>{if(running)return running;running=(async()=>{await pool.query('DELETE FROM customer_login_codes WHERE expires_at<=NOW()');await pool.query("DELETE FROM customer_sessions WHERE expires_at<=NOW() OR last_seen_at<NOW()-INTERVAL '24 hours'");await pool.query('DELETE FROM customer_auth_limits WHERE reset_at<=NOW()');await deliverCustomerCode(pool,vault,{send})})().catch(()=>app.log.warn({event:'customer.login_delivery_failed'})).finally(()=>{running=null});return running}
  app.addHook('onReady',async()=>{timer=setInterval(tick,3000);timer.unref()});app.addHook('onClose',async()=>{clearInterval(timer);if(running)await running})
 }
 return {checkout}
}
