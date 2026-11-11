import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import Fastify from 'fastify'
import {migrateBooking,registerBooking} from '../src/booking/index.js'
import {registerAuth,hashPassword} from '../src/auth.js'
const url=process.env.BOOKING_TEST_DATABASE_URL

test('PostgreSQL: migration, session, roles, branch isolation and update', {skip:!url},async()=>{
 if(new URL(url).pathname!=='/nova_booking_verify')throw Error('A dedicated nova_booking_verify database is required')
 const pool=new pg.Pool({connectionString:url,max:8}),app=Fastify()
 try{
  const exists=await pool.query("SELECT to_regclass('public.admin_accounts') AS name")
  if(!exists.rows[0].name)throw Error('Initialize the dedicated test database first')
  await Promise.all([migrateBooking(pool),migrateBooking(pool)])
  assert.equal(Number((await pool.query('SELECT count(*) FROM nova_booking_migrations WHERE version=1')).rows[0].count),1)
  const suffix=randomBytes(5).toString('hex'),pass='test-password-for-booking-2026',hash=await hashPassword(pass)
  const maximum=await pool.query('SELECT COALESCE(MAX(id),0)+1 AS next FROM admin_accounts'),first=maximum.rows[0].next
  await pool.query("INSERT INTO admin_accounts(id,username,password_hash,role) VALUES($1,$2,$3,'owner'),($4,$5,$3,'manager')",[first,'owner'+suffix,hash,first+1,'manager'+suffix])
  const {requireAdmin}=registerAuth(app,pool,{setupKey:'postgres-test-setup-key-32-characters'});registerBooking(app,pool,requireAdmin)
  const call=(method,path,payload,headers={})=>app.inject({method,url:path,payload,headers:{'x-nova-request':'1',...headers}})
  const login=async username=>{const r=await call('POST','/api/auth/login',{username,password:pass});assert.equal(r.statusCode,200,r.body);return {cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrf_token}}
  const owner=await login('owner'+suffix),manager=await login('manager'+suffix)
  assert.equal((await call('POST','/api/admin/booking/organizations',{name:'Denied'},{cookie:owner.cookie})).statusCode,403)
  const a=await call('POST','/api/admin/booking/organizations',{name:'A '+suffix},owner),b=await call('POST','/api/admin/booking/organizations',{name:'B '+suffix},owner)
  assert.equal(a.statusCode,201,a.body);assert.equal(b.statusCode,201,b.body)
  const aId=a.json().id,bId=b.json().id
  assert.equal((await call('POST',`/api/admin/booking/organizations/${aId}/members`,{user_id:String(first+1),role:'manager'},owner)).statusCode,200)
  const br=await call('POST',`/api/admin/booking/organizations/${aId}/branches`,{name:'Test',timezone:'Asia/Barnaul'},manager);assert.equal(br.statusCode,201,br.body)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${aId}/branches/${br.json().id}`,{name:'Updated',timezone:'UTC'},manager)).statusCode,200)
  assert.equal((await call('PUT',`/api/admin/booking/organizations/${bId}/branches/${br.json().id}`,{name:'Leak',timezone:'UTC'},owner)).statusCode,404)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${bId}/branches`,undefined,manager)).statusCode,404)
  assert.equal((await call('DELETE',`/api/admin/booking/organizations/${aId}/members/${first+1}`,undefined,owner)).statusCode,204)
  assert.equal((await call('GET',`/api/admin/booking/organizations/${aId}/branches`,undefined,manager)).statusCode,404)
 }finally{await app.close();await pool.end()}
})
