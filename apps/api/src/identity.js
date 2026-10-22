import {createHash,createHmac,createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto'
export const digest=value=>createHash('sha256').update(value).digest('hex')
export const roles=['owner','admin','editor','manager']
export function allowed(role,method,path){
 if(role==='owner')return true
 if(path.startsWith('/api/auth/'))return true
 if(role==='admin')return !/^\/api\/admin\/(system|accounts|audit)(\/|$)/.test(path)
 if(role==='editor')return /^\/api\/(admin\/(pages|posts|media)(\/|$)|products(\/|$)|categories(\/|$)|uploads$)/.test(path)
 if(role==='manager')return /^\/api\/admin\/(orders|customers|commerce)(\/|$)/.test(path)||['GET','HEAD'].includes(method)&&['/api/admin/analytics','/api/admin/analytics/settings'].includes(path)
 return false
}
export async function initIdentitySchema(db){
 await db.query('ALTER TABLE admin_accounts DROP CONSTRAINT IF EXISTS admin_accounts_id_check')
 await db.query('CREATE SEQUENCE IF NOT EXISTS admin_accounts_id_seq START 2')
 await db.query("ALTER TABLE admin_accounts ALTER COLUMN id SET DEFAULT nextval('admin_accounts_id_seq')")
 await db.query(`ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','admin','editor','manager'))`)
 await db.query("ALTER TABLE admin_accounts ALTER COLUMN role SET DEFAULT 'editor'")
 await db.query('ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE')
 await db.query('ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS totp_secret TEXT')
 await db.query('ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS totp_pending TEXT')
 await db.query('ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS totp_pending_until TIMESTAMPTZ')
 await db.query('ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT -1')
 await db.query("ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb")
 await db.query(`CREATE TABLE IF NOT EXISTS auth_challenges(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,password_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)`)
 await db.query('CREATE INDEX IF NOT EXISTS auth_challenges_expiry_idx ON auth_challenges(expires_at)')
 await db.query(`CREATE TABLE IF NOT EXISTS admin_audit(id BIGSERIAL PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),user_id INTEGER,username VARCHAR(64),role TEXT,action VARCHAR(120) NOT NULL,resource VARCHAR(200) NOT NULL,status INTEGER NOT NULL,request_id VARCHAR(100))`)
 await db.query('CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit(created_at DESC,id DESC)')
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32(bytes){let bits=0,value=0,result='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(value>>>bits)&31]}}if(bits)result+=alphabet[(value<<(5-bits))&31];return result}
function decode(secret){let bits=0,value=0,out=[];for(const c of secret){const n=alphabet.indexOf(c);if(n<0)throw Error('Invalid TOTP secret');value=(value<<5)|n;bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255)}}return Buffer.from(out)}
export function totp(secret,step){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const h=createHmac('sha1',decode(secret)).update(counter).digest(),offset=h[19]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')}
export function matchingStep(secret,code,time,last=-1){if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;const current=Math.floor(time/30000);for(const step of [current,current-1,current+1])if(step>Number(last)&&timingSafeEqual(Buffer.from(totp(secret,step)),Buffer.from(code)))return step;return null}
export function secretBox(key){const derived=createHash('sha256').update('nova:totp:v1\0'+key).digest();return {seal(secret){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',derived,iv);return Buffer.concat([iv,c.update(secret,'utf8'),c.final(),c.getAuthTag()]).toString('base64')},open(value){const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',derived,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString('utf8')}}}
export function registerIdentity(app,pool,{requireAdmin,session,startSession,throttle,trustedMutation,verifyPassword,hashPassword,validPassword,setupKey,now}){
 const box=secretBox(setupKey)
 const fail=(reply,message='Проверка не пройдена')=>reply.code(400).send({error:message})
 async function audit(req,status=200){const u=req.novaSession||req.novaAuditActor;await pool.query('INSERT INTO admin_audit(user_id,username,role,action,resource,status,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[u?.user_id||null,u?.username||null,u?.role||null,req.novaAuditAction||req.method,(req.novaAuditResource||req.routeOptions.url).replace(':id',/^[1-9]\d{0,18}$/.test(String(req.params?.id))?String(req.params.id):':id'),status,String(req.id).slice(0,100)])}
 app.addHook('onResponse',async(req,reply)=>{if(req.novaSession&&!['GET','HEAD','OPTIONS'].includes(req.method)||req.novaAuditAction)try{await audit(req,reply.statusCode)}catch{app.log.error({event:'audit.write_failed',requestId:req.id})}})
 async function consume(db,user,code){
  if(typeof code!=='string')return false
  const step=matchingStep(box.open(user.totp_secret),code,now(),user.totp_last_step)
  if(step!==null){await db.query('UPDATE admin_accounts SET totp_last_step=$1 WHERE id=$2',[step,user.id]);return true}
  const hashes=user.recovery_hashes||[],index=hashes.indexOf(digest(code.replaceAll('-','').toLowerCase()))
  if(index<0)return false
  hashes.splice(index,1);await db.query('UPDATE admin_accounts SET recovery_hashes=$1::jsonb WHERE id=$2',[JSON.stringify(hashes),user.id]);return true
 }
 async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}}
 const userView=u=>({id:String(u.id),username:u.username,role:u.role,enabled:u.enabled,two_factor:!!u.totp_secret})
 app.get('/api/admin/accounts',{preHandler:requireAdmin},async()=>({accounts:(await pool.query('SELECT id,username,role,enabled,totp_secret IS NOT NULL AS two_factor FROM admin_accounts ORDER BY id')).rows.map(u=>({...u,id:String(u.id)}))}))
 app.post('/api/admin/accounts',{preHandler:requireAdmin,bodyLimit:4096},async(req,reply)=>{
  if(!await throttle(req,reply))return
  const {username,password,role}=req.body||{}
  if(typeof username!=='string'||!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)||!validPassword(password)||!['admin','editor','manager'].includes(role))return fail(reply,'Проверьте логин, пароль (12–256 символов) и роль')
  const hash=await hashPassword(password)
  try{const r=await pool.query('INSERT INTO admin_accounts(username,password_hash,role) VALUES($1,$2,$3) RETURNING id,username,role,enabled',[username.toLowerCase(),hash,role]);req.novaAuditAction='account.create';req.novaAuditResource='/api/admin/accounts/'+r.rows[0].id;return reply.code(201).send(userView(r.rows[0]))}catch(e){if(e.code==='23505')return reply.code(409).send({error:'Логин уже занят'});throw e}
 })
 app.patch('/api/admin/accounts/:id',{preHandler:requireAdmin,bodyLimit:1024},async(req,reply)=>{
  const {role,enabled}=req.body||{}
  if(!/^[1-9]\d{0,9}$/.test(req.params.id)||!['admin','editor','manager'].includes(role)||typeof enabled!=='boolean')return fail(reply,'Проверьте роль и состояние учётной записи')
  return transaction(async db=>{const u=(await db.query('SELECT * FROM admin_accounts WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!u)return reply.code(404).send({error:'Пользователь не найден'});if(u.role==='owner'||String(u.id)===req.novaSession.user_id)return reply.code(403).send({error:'Учётную запись владельца и собственные права изменять нельзя'});await db.query('UPDATE admin_accounts SET role=$1,enabled=$2 WHERE id=$3',[role,enabled,u.id]);await db.query('DELETE FROM admin_sessions WHERE user_id=$1',[u.id]);await db.query('DELETE FROM auth_challenges WHERE user_id=$1',[u.id]);req.novaAuditAction='account.update';return {ok:true}})
 })
 app.get('/api/admin/audit',{preHandler:requireAdmin},async(req,reply)=>{const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>100000)return fail(reply,'Неверная страница');return {events:(await pool.query('SELECT id::text,created_at,user_id,username,role,action,resource,status,request_id FROM admin_audit ORDER BY id DESC LIMIT 50 OFFSET $1',[(page-1)*50])).rows,page}})
 app.get('/api/auth/security',{preHandler:requireAdmin},async req=>{const u=(await pool.query('SELECT totp_secret,recovery_hashes FROM admin_accounts WHERE id=$1',[req.novaSession.user_id])).rows[0];return {enabled:!!u.totp_secret,recovery_remaining:u.recovery_hashes.length}})
 app.post('/api/auth/2fa/setup',{preHandler:requireAdmin,bodyLimit:4096},async(req,reply)=>{
  if(!await throttle(req,reply))return
  return transaction(async db=>{const u=(await db.query('SELECT * FROM admin_accounts WHERE id=$1 FOR UPDATE',[req.novaSession.user_id])).rows[0];if(u.totp_secret)return fail(reply,'Двухфакторный вход уже включён');if(!validPassword(req.body?.password)||!await verifyPassword(req.body.password,u.password_hash))return fail(reply,'Неверный пароль');const secret=base32(randomBytes(20));await db.query('UPDATE admin_accounts SET totp_pending=$1,totp_pending_until=$2 WHERE id=$3',[box.seal(secret),new Date(now()+10*60000),u.id]);req.novaAuditAction='2fa.setup';return {secret,uri:`otpauth://totp/NOVA:${encodeURIComponent(u.username)}?secret=${secret}&issuer=NOVA&algorithm=SHA1&digits=6&period=30`}})
 })
 app.post('/api/auth/2fa/enable',{preHandler:requireAdmin,bodyLimit:1024},async(req,reply)=>{
  if(!await throttle(req,reply))return
  return transaction(async db=>{const u=(await db.query('SELECT * FROM admin_accounts WHERE id=$1 FOR UPDATE',[req.novaSession.user_id])).rows[0];if(u.totp_secret||!u.totp_pending||+new Date(u.totp_pending_until)<=now())return fail(reply,'Начните настройку заново');const step=matchingStep(box.open(u.totp_pending),req.body?.code,now());if(step===null)return fail(reply,'Неверный код');const codes=Array.from({length:10},()=>randomBytes(10).toString('hex'));await db.query('UPDATE admin_accounts SET totp_secret=totp_pending,totp_pending=NULL,totp_pending_until=NULL,totp_last_step=$1,recovery_hashes=$2::jsonb WHERE id=$3',[step,JSON.stringify(codes.map(digest)),u.id]);await db.query('DELETE FROM admin_sessions WHERE user_id=$1 AND token_hash<>$2',[u.id,req.novaSession.token_hash]);req.novaAuditAction='2fa.enable';return {recovery_codes:codes}})
 })
 app.post('/api/auth/2fa/disable',{preHandler:requireAdmin,bodyLimit:4096},async(req,reply)=>{
  if(!await throttle(req,reply))return
  return transaction(async db=>{const u=(await db.query('SELECT * FROM admin_accounts WHERE id=$1 FOR UPDATE',[req.novaSession.user_id])).rows[0];if(!u.totp_secret||!validPassword(req.body?.password)||!await verifyPassword(req.body.password,u.password_hash)||!await consume(db,u,req.body?.code))return fail(reply);await db.query("UPDATE admin_accounts SET totp_secret=NULL,totp_pending=NULL,totp_pending_until=NULL,totp_last_step=-1,recovery_hashes='[]'::jsonb WHERE id=$1",[u.id]);await db.query('DELETE FROM admin_sessions WHERE user_id=$1 AND token_hash<>$2',[u.id,req.novaSession.token_hash]);await db.query('DELETE FROM auth_challenges WHERE user_id=$1',[u.id]);req.novaAuditAction='2fa.disable';return {ok:true}})
 })
 app.post('/api/auth/2fa/login',{bodyLimit:1024},async(req,reply)=>{
  if(!trustedMutation(req,reply)||!await throttle(req,reply))return
  req.novaAuditAction='auth.2fa_failed'
  const challenge=req.body?.challenge;if(typeof challenge!=='string'||!/^[a-f0-9]{64}$/.test(challenge))return reply.code(401).send({error:'Войдите заново'})
  return transaction(async db=>{const c=(await db.query('SELECT * FROM auth_challenges WHERE token_hash=$1 FOR UPDATE',[digest(challenge)])).rows[0];if(!c||+new Date(c.expires_at)<=now()||c.attempts>=5)return reply.code(401).send({error:'Войдите заново'});await db.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=$1',[digest(challenge)]);const u=(await db.query('SELECT * FROM admin_accounts WHERE id=$1 FOR UPDATE',[c.user_id])).rows[0];if(!u?.enabled||u.password_hash!==c.password_hash||!u.totp_secret||!await consume(db,u,req.body?.code))return fail(reply,'Неверный или уже использованный код');await db.query('DELETE FROM auth_challenges WHERE token_hash=$1',[digest(challenge)]);await db.query('DELETE FROM auth_throttle WHERE key=$1',[digest(req.ip)]);req.novaAuditAction='auth.login';req.novaSession={user_id:String(u.id),username:u.username,role:u.role};return startSession(u,reply,db)})
 })
 return {audit,challenge:async(user,db)=>{const value=randomBytes(32).toString('hex');await db.query('DELETE FROM auth_challenges WHERE expires_at<=NOW()');await db.query('INSERT INTO auth_challenges(token_hash,user_id,password_hash,expires_at) VALUES($1,$2,$3,$4)',[digest(value),user.id,user.password_hash,new Date(now()+5*60000)]);return {two_factor_required:true,challenge:value}}}
}
