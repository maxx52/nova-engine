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
  assert.equal((await call('GET',`/api/admin/booking/organizations/${org}/branches`,undefined,'3')).statusCode,404)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/members`,{user_id:'2',role:'viewer'})).statusCode,200)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${org}/branches`,undefined,'2')).json().branches.length,1)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/branches`,{name:'X',timezone:'UTC'},'2')).statusCode,404)
  assert.equal((await call('POST',`/api/admin/booking/organizations/${org}/members`,{user_id:'1',role:'manager'})).statusCode,409)
  assert.equal((await call('POST','/api/admin/booking/organizations',{name:'X'},'2')).statusCode,403)
 }finally{await app.close();await pg.close()}
})
