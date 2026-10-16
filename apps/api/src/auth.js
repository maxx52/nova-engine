import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import {workLimiter} from './security.js'
import { promisify } from 'node:util'
const derive=promisify(scrypt)
const passwordWork=workLimiter(2)
const digest=value=>createHash('sha256').update(value).digest('hex')
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'))
export async function hashPassword(password) {
 return passwordWork(async()=>{
 const salt=randomBytes(16).toString('hex')
 const key=await derive(password,salt,64,{N:65536,r:8,p:1,maxmem:128*1024*1024})
 return 'scrypt$'+salt+'$'+key.toString('hex')
 })
}
export async function verifyPassword(password,stored) {
 const [algorithm,salt,key]=String(stored).split('$')
 if(algorithm!=='scrypt'||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(key))return false
 const actual=await passwordWork(()=>derive(password,salt,64,{N:65536,r:8,p:1,maxmem:128*1024*1024}))
 return timingSafeEqual(actual,Buffer.from(key,'hex'))
}
export function validPassword(value){return typeof value==='string'&&value.length>=12&&value.length<=256}
export function registerAuth(app,pool,{setupKey,secure=false,origins=['http://localhost:5174','http://127.0.0.1:5174'],now=()=>Date.now()}={}) {
 const cookieName=secure?'__Host-nova_session':'nova_session'
 const ttl=8*60*60*1000
 let cleanAt=0
 async function throttle(req,reply) {
  const time=now(),key=digest(req.ip)
  if(time>=cleanAt){await pool.query('DELETE FROM auth_throttle WHERE reset_at<=$1',[new Date(time)]);cleanAt=time+60000}
  const result=await pool.query(`INSERT INTO auth_throttle (key,attempts,reset_at) VALUES ($1,1,$2)
   ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN auth_throttle.reset_at<=$3 THEN 1 ELSE auth_throttle.attempts+1 END,
   reset_at=CASE WHEN auth_throttle.reset_at<=$3 THEN EXCLUDED.reset_at ELSE auth_throttle.reset_at END
   WHERE auth_throttle.attempts<10 OR auth_throttle.reset_at<=$3 RETURNING attempts`,[key,new Date(time+15*60*1000),new Date(time)])
  if(!result.rowCount){app.log.warn({event:'auth.rate_limited',requestId:req.id});reply.header('Retry-After','900').code(429).send({error:'Слишком много попыток. Повторите через 15 минут.'});return false}
  return true
 }
 async function clearAttempts(req){await pool.query('DELETE FROM auth_throttle WHERE key=$1',[digest(req.ip)])}
 function trustedMutation(req,reply) {
  if(req.headers['x-nova-request']!=='1' || (req.headers.origin&&!origins.includes(req.headers.origin))){reply.code(403).send({error:'Запрос отклонён'});return false}
  return true
 }
 function token(req){const match=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));const value=match?.slice(cookieName.length+1)||'';return /^[a-f0-9]{64}$/.test(value)?value:''}
 function setCookie(reply,value,maxAge){reply.header('Set-Cookie',`${cookieName}=${value}; Path=${secure?'/':'/api'}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`)}
 async function session(req) {
  if(req.novaSession!==undefined)return req.novaSession
  const value=token(req)
  if(!value){req.novaSession=null;return null}
  const result=await pool.query('SELECT s.token_hash,s.csrf_token,s.user_id::text,s.last_seen_at,a.username FROM admin_sessions s JOIN admin_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND s.last_seen_at>NOW()-INTERVAL \'30 minutes\'',[digest(value)])
  req.novaSession=result.rows[0]||null;if(req.novaSession && +new Date(req.novaSession.last_seen_at)<now()-60000)await pool.query('UPDATE admin_sessions SET last_seen_at=NOW() WHERE token_hash=$1',[req.novaSession.token_hash]);return req.novaSession
 }
 async function requireAdmin(req,reply) {
  const current=await session(req)
  if(!current)return reply.code(401).send({error:'Войдите в админку'})
  if(!['GET','HEAD'].includes(req.method)&&(!trustedMutation(req,reply)||!equal(req.headers['x-csrf-token'],current.csrf_token))){if(!reply.sent)return reply.code(403).send({error:'Обновите страницу и повторите запрос'})}
 }
 async function startSession(user,reply,db=pool) {
  const value=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex')
  await db.query('DELETE FROM admin_sessions WHERE expires_at<=NOW()')
  await db.query('INSERT INTO admin_sessions (token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)',[digest(value),user.id,csrf,new Date(now()+ttl)])
  setCookie(reply,value,ttl/1000)
  return {user:{username:user.username},csrf_token:csrf}
 }
 // Authenticate protected routes before body parsing (including multipart/large JSON).
 app.addHook('onRoute',options=>{
  const list=value=>value?(Array.isArray(value)?value:[value]):[]
  const pre=list(options.preHandler)
  if(pre.includes(requireAdmin)){
   options.onRequest=[...list(options.onRequest),requireAdmin]
   options.preHandler=pre.filter(handler=>handler!==requireAdmin)
  }
 })
 app.addHook('onSend',async(req,reply,payload)=>{if(req.url.startsWith('/api/auth/')||req.url.startsWith('/api/admin/')||req.novaSession)reply.header('Cache-Control','no-store');return payload})
 app.get('/api/auth/status',async()=>({setup_required:!(await pool.query('SELECT id FROM admin_accounts LIMIT 1')).rowCount}))
 app.get('/api/auth/me',async(req,reply)=>{const current=await session(req);if(!current)return reply.code(401).send({error:'Войдите в админку'});return {user:{username:current.username},csrf_token:current.csrf_token}})
 app.post('/api/auth/setup',{bodyLimit:4096},async(req,reply)=>{
  if(!trustedMutation(req,reply)||!await throttle(req,reply))return
  if((await pool.query('SELECT id FROM admin_accounts LIMIT 1')).rowCount)return reply.code(409).send({error:'Администратор уже создан'})
  const {username,password,setup_key}=req.body||{}
  if(!equal(setup_key,setupKey))return reply.code(401).send({error:'Неверный ключ первоначальной настройки'})
  if(typeof username!=='string'||!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)||!validPassword(password))return reply.code(400).send({error:'Логин: 3–64 латинских символа, цифры, _.-. Пароль: 12–256 символов.'})
  const result=await pool.query('INSERT INTO admin_accounts (id,username,password_hash) VALUES (1,$1,$2) ON CONFLICT (id) DO NOTHING RETURNING id,username',[username.toLowerCase(),await hashPassword(password)])
  if(!result.rowCount)return reply.code(409).send({error:'Администратор уже создан'})
  await clearAttempts(req);return reply.code(201).send(await startSession(result.rows[0],reply))
 })
 app.post('/api/auth/login',{bodyLimit:4096},async(req,reply)=>{
  if(!trustedMutation(req,reply)||!await throttle(req,reply))return
  const {username,password}=req.body||{}
  if(typeof username!=='string'||username.length>64||!validPassword(password))return reply.code(401).send({error:'Неверный логин или пароль'})
  const result=await pool.query('SELECT id,username,password_hash FROM admin_accounts WHERE username=$1',[username.toLowerCase()])
  const user=result.rows[0]
  // Derive a hash even for unknown usernames to avoid a cheap timing distinction.
  const valid=user?await verifyPassword(password,user.password_hash):(await hashPassword(password),false)
  if(!valid){app.log.warn({event:'auth.login_failed',requestId:req.id});return reply.code(401).send({error:'Неверный логин или пароль'})}
  const client=await pool.connect()
  try {
   await client.query('BEGIN')
   const locked=await client.query('SELECT id FROM admin_accounts WHERE id=$1 AND password_hash=$2 FOR UPDATE',[user.id,user.password_hash])
   if(!locked.rowCount){await client.query('ROLLBACK');return reply.code(401).send({error:'Неверный логин или пароль'})}
   const old=token(req);if(old)await client.query('DELETE FROM admin_sessions WHERE token_hash=$1',[digest(old)])
   const data=await startSession(user,reply,client)
   await client.query('COMMIT');await clearAttempts(req);app.log.info({event:'auth.login',userId:user.id});return data
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 })
 app.post('/api/auth/logout',{preHandler:requireAdmin},async(req,reply)=>{await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1',[req.novaSession.token_hash]);setCookie(reply,'',0);return reply.code(204).send()})
 app.post('/api/auth/logout-all',{preHandler:requireAdmin},async(req,reply)=>{await pool.query('DELETE FROM admin_sessions WHERE user_id=$1',[req.novaSession.user_id]);setCookie(reply,'',0);app.log.info({event:'auth.logout_all',userId:req.novaSession.user_id});return reply.code(204).send()})
 app.post('/api/auth/password',{bodyLimit:4096,preHandler:requireAdmin},async(req,reply)=>{
  if(!await throttle(req,reply))return
  const {current_password,new_password}=req.body||{}
  if(!validPassword(current_password)||!validPassword(new_password))return reply.code(400).send({error:'Пароль должен содержать от 12 до 256 символов'})
  const result=await pool.query('SELECT id,username,password_hash FROM admin_accounts WHERE id=$1',[req.novaSession.user_id]);const user=result.rows[0]
  if(!user||!await verifyPassword(current_password,user.password_hash))return reply.code(400).send({error:'Текущий пароль неверен'})
  const hash=await hashPassword(new_password)
  const client=await pool.connect()
  try {
   await client.query('BEGIN')
   const changed=await client.query('UPDATE admin_accounts SET password_hash=$1 WHERE id=$2 AND password_hash=$3 RETURNING id',[hash,user.id,user.password_hash])
   if(!changed.rowCount){await client.query('ROLLBACK');return reply.code(409).send({error:'Пароль уже изменён. Войдите заново.'})}
   await client.query('DELETE FROM admin_sessions WHERE user_id=$1',[user.id])
   await client.query('COMMIT')
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  await clearAttempts(req);setCookie(reply,'',0);return reply.code(204).send()
 })
 return {requireAdmin,isAdmin:async req=>Boolean(await session(req))}
}
