import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {migrateBooking,registerBooking} from '../src/booking/index.js'
import {allowed} from '../src/identity.js'

test('booking migration is repeatable and routes isolate organizations and roles',async()=>{
 const pg=new PGlite();const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 const pool={query,connect:async()=>({query,release(){}})}
 await query("CREATE TABLE admin_accounts(id INTEGER PRIMARY KEY,username TEXT,role TEXT,enabled BOOLEAN)")
 await query("INSERT INTO admin_accounts VALUES(1,'owner','owner',true),(2,'manager','manager',true),(3,'other','manager',true)")
 await migrateBooking(pool);await migrateBooking(pool)
 const app=Fastify();const requireAdmin=async req=>{const uid=req.headers['x-test-user'];if(!uid)throw app.httpErrors?.unauthorized?.()||Error('unauthorized');req.novaSession={user_id:uid,role:uid==='1'?'owner':'manager'}}
 registerBooking(app,pool,requireAdmin)
 const call=(method,url,payload,user='1')=>app.inject({method,url,payload,headers:{'x-test-user':user}})
 try{
  assert.equal(allowed('manager','GET','/api/admin/booking/organizations'),true)
  let res=await call('POST','/api/admin/booking/organizations',{name:'Клиника',profile:'dentistry'});assert.equal(res.statusCode,201,res.body);const org=res.json().id
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/branches`,{name:'Центр',timezone:'bad/time'})).statusCode,400)
  res=await call('POST',`/api/admin/booking/organizations/${org}/branches`,{name:'Центр',timezone:'Asia/Barnaul'});assert.equal(res.statusCode,201,res.body)
  const branchId=res.json().id
  const other=await call('POST','/api/admin/booking/organizations',{name:'Другой'});const otherId=other.json().id
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${org}`,{name:'Клиника 2',profile:'beauty'})).statusCode,200)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${org}`,{name:'Клиника',profile:'invalid'})).statusCode,400)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${otherId}/branches/${branchId}`,{name:'X',timezone:'UTC'})).statusCode,404)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${org}/branches/${branchId}`,{name:'Новый адрес',timezone:'UTC'})).statusCode,200)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${org}/branches`,undefined,'3')).statusCode,404)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/members`,{user_id:'2',role:'viewer'})).statusCode,200)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${org}/branches`,undefined,'2')).json().branches.length,1)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/branches`,{name:'X',timezone:'UTC'},'2')).statusCode,404)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${org}/branches/${branchId}`,{name:'X',timezone:'UTC'},'2')).statusCode,404)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${org}`,{name:'X',profile:'universal'},'2')).statusCode,404)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/members`,{user_id:'1',role:'manager'})).statusCode,409)
  assert.equal((await call('POST','/api/admin/booking/organizations',{name:'X'},'2')).statusCode,403)
 }finally{await app.close();await pg.close()}
})

test('booking uses NOVA sessions, CSRF, role checks and revocation immediately',async()=>{
 const {initIdentitySchema}=await import('../src/identity.js')
 const {registerAuth,hashPassword}=await import('../src/auth.js')
 const pg=new PGlite();const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}};let tail=Promise.resolve()
 const pool={query,connect:async()=>{const prev=tail;let release;tail=new Promise(r=>release=r);await prev;return {query,release}}}
 await query('CREATE TABLE admin_accounts(id INTEGER PRIMARY KEY CHECK(id=1),username VARCHAR(64) NOT NULL UNIQUE,password_hash TEXT NOT NULL)')
 await query('CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES admin_accounts(id),csrf_token TEXT,expires_at TIMESTAMPTZ,last_seen_at TIMESTAMPTZ DEFAULT NOW())')
 await query('CREATE TABLE auth_throttle(key TEXT PRIMARY KEY,attempts INTEGER,reset_at TIMESTAMPTZ)')
 await initIdentitySchema(pool);await migrateBooking(pool)
 const hash=await hashPassword('booking-password-2026')
 await query("INSERT INTO admin_accounts(id,username,password_hash,role) VALUES (1,'owner',$1,'owner'),(2,'manager',$1,'manager'),(3,'editor',$1,'editor')",[hash])
 const app=Fastify();const {requireAdmin}=registerAuth(app,pool,{setupKey:'booking-test-key-at-least-32-characters'});registerBooking(app,pool,requireAdmin)
 const call=(method,url,payload,headers={})=>app.inject({method,url,payload,headers:{'x-nova-request':'1',...headers}})
 const login=async username=>{const r=await call('POST','/api/auth/login',{username,password:'booking-password-2026'});assert.equal(r.statusCode,200,r.body);return {cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrf_token}}
 try{
  const owner=await login('owner'),manager=await login('manager'),editor=await login('editor')
  assert.equal((await call('GET','/api/admin/booking/organizations')).statusCode,401)
  assert.equal((await call('GET','/api/admin/booking/organizations',undefined,editor)).statusCode,403)
  assert.equal((await call('POST','/api/admin/booking/organizations',{name:'Denied'}, {cookie:owner.cookie})).statusCode,403)
  const orgResponse=await call('POST','/api/admin/booking/organizations',{name:'One'},owner);assert.equal(orgResponse.statusCode,201,orgResponse.body);const org=orgResponse.json().id
  const org2Response=await call('POST','/api/admin/booking/organizations',{name:'Two'},owner);const org2=org2Response.json().id
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/members`,{user_id:'2',role:'manager'},owner)).statusCode,200)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/branches`,{name:'A',timezone:'UTC'},manager)).statusCode,201)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${org2}/branches`,undefined,manager)).statusCode,404)
  assert.equal((await call('GET','/api/admin/booking/organizations?page=0',undefined,owner)).statusCode,400)
  await query("INSERT INTO nova_booking_branches(organization_id,name,timezone) SELECT $1,'Branch '||n,'UTC' FROM generate_series(1,51) n",[org])
  const first=(await call('GET',`/api/admin/booking/organizations/${org}/branches?page=1`,undefined,manager)).json(),second=(await call('GET',`/api/admin/booking/organizations/${org}/branches?page=2`,undefined,manager)).json()
  assert.equal(first.branches.length,50);assert.equal(first.has_more,true);assert.equal(second.branches.length,2);assert.equal(second.has_more,false)
  assert.equal(new Set([...first.branches,...second.branches].map(x=>x.id)).size,52)
  assert.equal((await call('DELETE',`/api/admin/booking/organizations/${org}/members/1`,undefined,owner)).statusCode,404)
  assert.equal((await call('DELETE',`/api/admin/booking/organizations/${org}/members/2`,undefined,owner)).statusCode,204)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${org}/branches`,undefined,manager)).statusCode,404)
 }finally{await app.close();await pg.close()}
})

test('booking rejects newer or broken migration history without changing data',async()=>{
 const db=new PGlite(),query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}},pool={query,connect:async()=>({query,release(){}})}
 try{
  await query('CREATE TABLE admin_accounts(id INTEGER PRIMARY KEY)')
  await migrateBooking(pool)
  await query("INSERT INTO nova_booking_organizations(name,profile) VALUES('Kept','universal')")
  await query('INSERT INTO nova_booking_migrations(version) VALUES(2)')
  await assert.rejects(migrateBooking(pool),/incompatible/)
  assert.equal((await query('SELECT name FROM nova_booking_organizations')).rows[0].name,'Kept')
  await query('DELETE FROM nova_booking_migrations WHERE version=1')
  await assert.rejects(migrateBooking(pool),/incompatible/)
 }finally{await db.close()}
})
