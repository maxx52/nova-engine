import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {registerAuth,hashPassword,verifyPassword} from '../src/auth.js'
const password='test-password-2026',key='test-setup-key-at-least-16'
async function fixture(secure=false){
 let account=null,time=Date.now();const sessions=new Map(),queries=[]
 const db={async query(sql,args=[]){
  queries.push(sql)
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {}
  if(sql==='SELECT id FROM admin_accounts LIMIT 1')return {rowCount:account?1:0,rows:account?[{id:1}]:[]}
  if(sql.startsWith('INSERT INTO admin_accounts')){if(account)return {rowCount:0,rows:[]};account={id:1,username:args[0],password_hash:args[1]};return {rowCount:1,rows:[{id:1,username:account.username}]}}
  if(sql.startsWith('SELECT id FROM admin_accounts WHERE id='))return {rowCount:account&&String(account.id)===String(args[0])&&account.password_hash===args[1]?1:0}
  if(sql.startsWith('SELECT id,username,password_hash FROM admin_accounts'))return {rows:account&&(sql.includes('username=')?account.username===args[0]:String(account.id)===String(args[0]))?[{...account}]:[]}
  if(sql.startsWith('UPDATE admin_accounts')){if(!account||String(account.id)!==String(args[1])||account.password_hash!==args[2])return {rowCount:0};account.password_hash=args[0];return {rowCount:1}}
  if(sql.startsWith('INSERT INTO admin_sessions')){sessions.set(args[0],{token_hash:args[0],user_id:String(args[1]),csrf_token:args[2],expires_at:args[3]});return {rowCount:1}}
  if(sql.startsWith('SELECT s.token_hash')){const row=sessions.get(args[0]);return {rows:row&&+row.expires_at>time?[{...row,username:account.username}]:[]}}
  if(sql.startsWith('DELETE FROM admin_sessions')){for(const [hash,row]of sessions){if(sql.includes('expires_at')?+row.expires_at<=time:sql.includes('user_id')?row.user_id===String(args[0]):hash===args[0])sessions.delete(hash)}return {rowCount:1}}
  throw Error('Unexpected query '+sql)
 },release(){}}
 const pool={...db,connect:async()=>db}
 const app=Fastify();const {requireAdmin,isAdmin}=registerAuth(app,pool,{setupKey:key,secure,now:()=>time})
 app.get('/private',{preHandler:requireAdmin},()=>({ok:true}))
 app.post('/private',{preHandler:requireAdmin},()=>({ok:true}))
 app.get('/session-valid',async req=>({admin:await isAdmin(req)}))
 const mutation=(url,payload={},cookie='',csrf='')=>app.inject({method:'POST',url,payload,headers:{'x-nova-request':'1',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})}})
 const cookie=r=>r.headers['set-cookie'].split(';')[0]
 return {app,mutation,cookie,sessions,queries,account:()=>account,advance:n=>time+=n}
}
test('passwords use unique salts and verify without storing plaintext',async()=>{
 const hash=await hashPassword(password),second=await hashPassword(password)
 assert.notEqual(hash,second);assert.ok(!hash.includes(password));assert.equal(await verifyPassword(password,hash),true);assert.equal(await verifyPassword('wrong-password',hash),false)
})
test('setup, login, session, CSRF, password change, revocation and logout',async()=>{
 const f=await fixture();const {app,mutation,cookie}=f
 try{
  assert.equal((await app.inject('/api/auth/status')).json().setup_required,true)
  assert.equal((await mutation('/api/auth/setup',{username:'admin',password,setup_key:'wrong'})).statusCode,401)
  const created=await mutation('/api/auth/setup',{username:'Admin',password,setup_key:key})
  assert.equal(created.statusCode,201);assert.match(created.headers['set-cookie'],/HttpOnly; SameSite=Strict/)
  assert.equal(created.headers['cache-control'],'no-store');assert.equal(created.json().user.username,'admin')
  const first=cookie(created),csrf=created.json().csrf_token
  assert.ok(!f.sessions.has(first.split('=')[1]));assert.equal(f.sessions.size,1)
  assert.equal((await app.inject('/api/auth/status')).json().setup_required,false)
  assert.equal((await mutation('/api/auth/setup',{username:'other',password,setup_key:key})).statusCode,409)
  assert.equal((await app.inject({url:'/private',headers:{'x-admin-key':key}})).statusCode,401)
  assert.equal((await app.inject({url:'/private',headers:{cookie:first}})).statusCode,200)
  assert.equal((await mutation('/private',{},first)).statusCode,403)
  assert.equal((await mutation('/private',{},first,csrf)).statusCode,200)
  assert.equal((await app.inject({method:'POST',url:'/private',payload:{},headers:{cookie:first,'x-csrf-token':csrf,'x-nova-request':'1',origin:'https://evil.example'}})).statusCode,403)
  const me=await app.inject({url:'/api/auth/me',headers:{cookie:first}});assert.equal(me.json().csrf_token,csrf)
  assert.equal((await mutation('/api/auth/login',{username:'admin',password:'wrong-password-123'})).statusCode,401)
  const login=await mutation('/api/auth/login',{username:'ADMIN',password})
  assert.equal(login.statusCode,200);const second=cookie(login),csrf2=login.json().csrf_token
  assert.notEqual(first,second)
  assert.equal((await mutation('/api/auth/password',{current_password:'wrong-password-123',new_password:'new-password-2026'},second,csrf2)).statusCode,400)
  assert.equal((await mutation('/api/auth/password',{current_password:password,new_password:'new-password-2026'},second,csrf2)).statusCode,204)
  for(const value of [first,second])assert.equal((await app.inject({url:'/private',headers:{cookie:value}})).statusCode,401)
  assert.equal((await mutation('/api/auth/login',{username:'admin',password})).statusCode,401)
  const fresh=await mutation('/api/auth/login',{username:'admin',password:'new-password-2026'});assert.equal(fresh.statusCode,200)
  assert.equal((await mutation('/api/auth/logout',{},cookie(fresh),fresh.json().csrf_token)).statusCode,204)
  assert.equal((await app.inject({url:'/private',headers:{cookie:cookie(fresh)}})).statusCode,401)
  assert.ok(f.queries.some(sql=>sql.endsWith('FOR UPDATE')))
 }finally{await app.close()}
})
test('auth refuses unmarked requests, limits attempts, expires sessions and sets Secure cookie',async()=>{
 const f=await fixture(true)
 try{
  const payload={username:'admin',password,setup_key:key}
  assert.equal((await f.app.inject({method:'POST',url:'/api/auth/setup',payload})).statusCode,403)
  const setup=await f.mutation('/api/auth/setup',payload);assert.equal(setup.statusCode,201)
  assert.match(setup.headers['set-cookie'],/^__Secure-nova_session=/);assert.match(setup.headers['set-cookie'],/; Secure/)
  f.advance(9*60*60*1000)
  assert.equal((await f.app.inject({url:'/private',headers:{cookie:f.cookie(setup)}})).statusCode,401)
  for(let i=0;i<10;i++)assert.equal((await f.mutation('/api/auth/login',{username:'admin',password:'short'})).statusCode,401)
  const blocked=await f.mutation('/api/auth/login',{username:'admin',password});assert.equal(blocked.statusCode,429);assert.equal(blocked.headers['retry-after'],'900')
  f.advance(16*60*1000)
  assert.equal((await f.mutation('/api/auth/login',{username:'admin',password})).statusCode,200)
 }finally{await f.app.close()}
})
