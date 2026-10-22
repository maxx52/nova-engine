import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {initIdentitySchema,base32,totp,matchingStep,secretBox,allowed} from '../src/identity.js'
import {registerAuth,hashPassword} from '../src/auth.js'
const password='identity-test-password-2026',key='identity-test-setup-key-32-characters'
test('TOTP RFC 6238 vectors, clock window, replay rejection and authenticated secret encryption',()=>{
 const secret=base32(Buffer.from('12345678901234567890'))
 for(const [seconds,expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])assert.equal(totp(secret,Math.floor(seconds/30)),expected)
 const step=100;assert.equal(matchingStep(secret,totp(secret,step),step*30000),step)
 assert.equal(matchingStep(secret,totp(secret,step),step*30000,step),null)
 assert.equal(matchingStep(secret,totp(secret,step-2),step*30000),null)
 assert.equal(matchingStep(secret,123456,step*30000),null)
 const box=secretBox(key),sealed=box.seal(secret);assert.notEqual(sealed,box.seal(secret));assert.equal(box.open(sealed),secret);assert.throws(()=>secretBox('other').open(sealed))
})
test('role matrix denies sensitive routes and unknown roles',()=>{
 for(const role of ['editor','manager','admin'])for(const path of ['/api/admin/accounts','/api/admin/accounts/:id','/api/admin/audit','/api/admin/system/jobs'])assert.equal(allowed(role,'POST',path),false)
 assert.equal(allowed('editor','PUT','/api/admin/pages/:id'),true);assert.equal(allowed('editor','GET','/api/admin/orders'),false)
 assert.equal(allowed('manager','PUT','/api/admin/orders/:id'),true);assert.equal(allowed('manager','PUT','/api/admin/analytics/settings'),false)
 assert.equal(allowed('manager','GET','/api/admin/analytics/settings'),true);assert.equal(allowed('unknown','GET','/api/admin/posts'),false)
})
test('identity migration preserves legacy owner, accounts enforce roles, TOTP/recovery are atomic and audit excludes secrets',async()=>{
 const pg=new PGlite();let clock=Date.now(),tail=Promise.resolve()
 const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 const pool={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}}
 await query('CREATE TABLE admin_accounts(id INTEGER PRIMARY KEY CHECK(id=1),username VARCHAR(64) NOT NULL UNIQUE,password_hash TEXT NOT NULL)')
 const hash=await hashPassword(password);await query('INSERT INTO admin_accounts VALUES(1,$1,$2)',['owner',hash])
 await query('CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES admin_accounts(id),csrf_token TEXT,expires_at TIMESTAMPTZ,last_seen_at TIMESTAMPTZ DEFAULT NOW())')
 await query('CREATE TABLE auth_throttle(key TEXT PRIMARY KEY,attempts INTEGER,reset_at TIMESTAMPTZ)')
 await initIdentitySchema(pool);await initIdentitySchema(pool)
 assert.equal((await query('SELECT role FROM admin_accounts WHERE id=1')).rows[0].role,'owner')
 const app=Fastify(),{requireAdmin}=registerAuth(app,pool,{setupKey:key,now:()=>clock})
 app.put('/api/admin/pages/:id',{preHandler:requireAdmin},()=>({ok:true}))
 app.get('/api/admin/orders',{preHandler:requireAdmin},()=>({ok:true}))
 app.post('/api/admin/system/jobs',{preHandler:requireAdmin},()=>({ok:true}))
 const call=(method,url,payload,headers={})=>app.inject({method,url,payload,headers:{'x-nova-request':'1',...headers}})
 const login=()=>call('POST','/api/auth/login',{username:'owner',password})
 const headers=r=>({cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrf_token})
 try{
  const first=await login();assert.equal(first.statusCode,200,first.body);const owner=headers(first)
  const create=await call('POST','/api/admin/accounts',{username:'editor',password,role:'editor'},owner);assert.equal(create.statusCode,201,create.body);const editorId=create.json().id;assert.notEqual(editorId,'1')
  const el=await call('POST','/api/auth/login',{username:'editor',password}),editor=headers(el)
  assert.equal(el.json().user.role,'editor')
  assert.equal((await call('PUT','/api/admin/pages/17',{},editor)).statusCode,200)
  for(const path of ['/api/admin/accounts','/api/admin/audit','/api/admin/orders'])assert.equal((await call('GET',path,undefined,editor)).statusCode,403)
  assert.equal((await app.inject({method:'POST',url:'/api/admin/system/jobs',headers:{...editor,'content-type':'application/json'},payload:'{broken'})).statusCode,403)
  assert.equal((await call('POST','/api/admin/accounts',{username:'evil',password,role:'owner'},owner)).statusCode,400)
  assert.equal((await call('PATCH','/api/admin/accounts/1',{role:'editor',enabled:false},owner)).statusCode,403)
  assert.equal((await call('PATCH','/api/admin/accounts/'+editorId,{role:'manager',enabled:true},owner)).statusCode,200)
  assert.equal((await call('PUT','/api/admin/pages/17',{},editor)).statusCode,401)
  const ml=await call('POST','/api/auth/login',{username:'editor',password}),manager=headers(ml)
  assert.equal((await call('GET','/api/admin/orders',undefined,manager)).statusCode,200)
  assert.equal((await call('PUT','/api/admin/pages/17',{},manager)).statusCode,403)
  await call('PATCH','/api/admin/accounts/'+editorId,{role:'manager',enabled:false},owner)
  assert.equal((await call('GET','/api/admin/orders',undefined,manager)).statusCode,401)
  assert.equal((await call('POST','/api/auth/login',{username:'editor',password})).statusCode,401)
  const config=await call('POST','/api/auth/2fa/setup',{password},owner);assert.equal(config.statusCode,200,config.body);const secret=config.json().secret
  assert.ok(!JSON.stringify((await query('SELECT totp_pending FROM admin_accounts WHERE id=1')).rows).includes(secret))
  const enabled=await call('POST','/api/auth/2fa/enable',{code:totp(secret,Math.floor(clock/30000))},owner);assert.equal(enabled.statusCode,200,enabled.body);const recovery=enabled.json().recovery_codes;assert.equal(recovery.length,10)
  const challenge=await login();assert.equal(challenge.json().two_factor_required,true);assert.equal(challenge.headers['set-cookie'],undefined)
  assert.equal((await call('GET','/api/admin/accounts',undefined,{})).statusCode,401)
  const otp=(c,code)=>call('POST','/api/auth/2fa/login',{challenge:c,code})
  assert.equal((await otp(challenge.json().challenge,totp(secret,Math.floor(clock/30000)))).statusCode,400,'setup code cannot be replayed')
  clock+=30000
  const [a,b]=await Promise.all([otp(challenge.json().challenge,totp(secret,Math.floor(clock/30000))),otp(challenge.json().challenge,totp(secret,Math.floor(clock/30000)))])
  assert.deepEqual([a.statusCode,b.statusCode].sort(),[200,401])
  const again=await login(),challenge2=again.json().challenge
  const recovered=await otp(challenge2,recovery[0]);assert.equal(recovered.statusCode,200,recovered.body)
  assert.equal((await call('GET','/api/auth/security',undefined,headers(recovered))).json().recovery_remaining,9)
  const third=await login();assert.equal((await otp(third.json().challenge,recovery[0])).statusCode,400)
  clock+=6*60000;assert.equal((await otp(third.json().challenge,recovery[1])).statusCode,401)
  clock+=16*60000
  const fourth=await login();for(let i=0;i<5;i++)assert.equal((await otp(fourth.json().challenge,'wrong')).statusCode,400);assert.equal((await otp(fourth.json().challenge,recovery[1])).statusCode,401)
  const audit=await call('GET','/api/admin/audit',undefined,owner);assert.equal(audit.statusCode,200);const log=audit.body
  for(const privateValue of [password,secret,...recovery,hash,challenge.json().challenge,owner.cookie,owner['x-csrf-token']])assert.ok(!log.includes(privateValue))
  assert.ok(audit.json().events.some(e=>e.username==='editor'&&e.resource==='/api/admin/pages/17'))
  assert.ok(audit.json().events.some(e=>e.action==='auth.login'))
 }finally{await app.close();await pg.close()}
})
