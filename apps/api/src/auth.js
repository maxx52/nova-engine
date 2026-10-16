import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const derive=promisify(scrypt)
const digest=value=>createHash('sha256').update(value).digest('hex')
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'))
export async function hashPassword(password) {
 const salt=randomBytes(16).toString('hex')
 const key=await derive(password,salt,64,{N:65536,r:8,p:1,maxmem:128*1024*1024})
 return 'scrypt$'+salt+'$'+key.toString('hex')
}
export async function verifyPassword(password,stored) {
 const [algorithm,salt,key]=String(stored).split('$')
 if(algorithm!=='scrypt'||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(key))return false
 const actual=await derive(password,salt,64,{N:65536,r:8,p:1,maxmem:128*1024*1024})
 return timingSafeEqual(actual,Buffer.from(key,'hex'))
}
export function validPassword(value){return typeof value==='string'&&value.length>=12&&value.length<=256}
export function registerAuth(app,pool,{setupKey,secure=false,origins=['http://localhost:5174','http://127.0.0.1:5174'],now=()=>Date.now()}={}) {
 const cookieName=secure?'__Secure-nova_session':'nova_session'
 const ttl=8*60*60*1000
 const attempts=new Map()
 function throttle(req,reply) {
  const key=req.ip;const time=now()
  for(const [key,value] of attempts)if(value.until<=time)attempts.delete(key)
  const bucket=attempts.get(key)||{count:0,until:time+15*60*1000}
  if(bucket.count>=10 || (!attempts.has(key)&&attempts.size>=10000)){reply.header('Retry-After','900').code(429).send({error:'Слишком много попыток. Повторите через 15 минут.'});return false}
  bucket.count++;attempts.set(key,bucket);return true
 }
 function trustedMutation(req,reply) {
  if(req.headers['x-nova-request']!=='1' || (req.headers.origin&&!origins.includes(req.headers.origin))){reply.code(403).send({error:'Запрос отклонён'});return false}
  return true
 }
 function token(req){const match=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));const value=match?.slice(cookieName.length+1)||'';return /^[a-f0-9]{64}$/.test(value)?value:''}
 function setCookie(reply,value,maxAge){reply.header('Set-Cookie',`${cookieName}=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`)}
 async function session(req) {
  if(req.novaSession!==undefined)return req.novaSession
  const value=token(req)
  if(!value){req.novaSession=null;return null}
  const result=await pool.query('SELECT s.token_hash,s.csrf_token,s.user_id::text,a.username FROM admin_sessions s JOIN admin_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',[digest(value)])
  req.novaSession=result.rows[0]||null;return req.novaSession
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
 app.addHook('onSend',async(req,reply,payload)=>{if(req.url.startsWith('/api/auth/')||req.url.startsWith('/api/admin/')||req.novaSession)reply.header('Cache-Control','no-store');return payload})
 app.get('/api/auth/status',async()=>({setup_required:!(await pool.query('SELECT id FROM admin_accounts LIMIT 1')).rowCount}))
 app.get('/api/auth/me',async(req,reply)=>{const current=await session(req);if(!current)return reply.code(401).send({error:'Войдите в админку'});return {user:{username:current.username},csrf_token:current.csrf_token}})
 app.post('/api/auth/setup',{bodyLimit:4096},async(req,reply)=>{
  if(!trustedMutation(req,reply)||!throttle(req,reply))return
  if((await pool.query('SELECT id FROM admin_accounts LIMIT 1')).rowCount)return reply.code(409).send({error:'Администратор уже создан'})
  const {username,password,setup_key}=req.body||{}
  if(!equal(setup_key,setupKey))return reply.code(401).send({error:'Неверный ключ первоначальной настройки'})
  if(typeof username!=='string'||!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)||!validPassword(password))return reply.code(400).send({error:'Логин: 3–64 латинских символа, цифры, _.-. Пароль: 12–256 символов.'})
  const result=await pool.query('INSERT INTO admin_accounts (id,username,password_hash) VALUES (1,$1,$2) ON CONFLICT (id) DO NOTHING RETURNING id,username',[username.toLowerCase(),await hashPassword(password)])
  if(!result.rowCount)return reply.code(409).send({error:'Администратор уже создан'})
  attempts.delete(req.ip);return reply.code(201).send(await startSession(result.rows[0],reply))
 })
 app.post('/api/auth/login',{bodyLimit:4096},async(req,reply)=>{
  if(!trustedMutation(req,reply)||!throttle(req,reply))return
  const {username,password}=req.body||{}
  if(typeof username!=='string'||username.length>64||!validPassword(password))return reply.code(401).send({error:'Неверный логин или пароль'})
  const result=await pool.query('SELECT id,username,password_hash FROM admin_accounts WHERE username=$1',[username.toLowerCase()])
  const user=result.rows[0]
  // Derive a hash even for unknown usernames to avoid a cheap timing distinction.
  const valid=user?await verifyPassword(password,user.password_hash):(await hashPassword(password),false)
  if(!valid)return reply.code(401).send({error:'Неверный логин или пароль'})
  const client=await pool.connect()
  try {
   await client.query('BEGIN')
   const locked=await client.query('SELECT id FROM admin_accounts WHERE id=$1 AND password_hash=$2 FOR UPDATE',[user.id,user.password_hash])
   if(!locked.rowCount){await client.query('ROLLBACK');return reply.code(401).send({error:'Неверный логин или пароль'})}
   const old=token(req);if(old)await client.query('DELETE FROM admin_sessions WHERE token_hash=$1',[digest(old)])
   const data=await startSession(user,reply,client)
   await client.query('COMMIT');attempts.delete(req.ip);return data
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 })
 app.post('/api/auth/logout',{preHandler:requireAdmin},async(req,reply)=>{await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1',[req.novaSession.token_hash]);setCookie(reply,'',0);return reply.code(204).send()})
 app.post('/api/auth/password',{bodyLimit:4096,preHandler:requireAdmin},async(req,reply)=>{
  if(!throttle(req,reply))return
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
  attempts.delete(req.ip);setCookie(reply,'',0);return reply.code(204).send()
 })
 return {requireAdmin,isAdmin:async req=>Boolean(await session(req))}
}
