import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../src/db.js'
import {registerCustomerAccounts,deliverCustomerCode} from '../src/customerAccounts.js'
import {secretVault,notificationText} from '../src/formDelivery.js'
import {registerCommerce} from '../src/commerce.js'
import {publicErrorHandler} from '../src/security.js'
const secret='customer-account-test-secret-only-32-chars'
test('customer accounts: proof, isolation, addresses, checkout and safe reorder',async t=>{
 const pg=new PGlite(),query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve();const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}}
 pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify();app.setErrorHandler(publicErrorHandler)
 const module=registerCustomerAccounts(app,db,{secret,worker:false,origins:['http://shop.test'],mailSettings:async()=>({config:{enabled:true,email:{enabled:true,mode:'smtp',host:'smtp.example.com',from:'shop@example.com',to:['owner@example.com'],user:'shop'}},secrets:{smtp_password:'test-only'}})})
 registerCommerce(app,db,async(req,reply)=>reply.code(401).send({error:'admin only'}),{origins:['http://shop.test'],customerCheckout:module.checkout})
 const base={origin:'http://shop.test','x-nova-account':'1'},call=(method,url,payload,headers=base)=>app.inject({method,url,payload,headers})
 async function challenge(email){const r=await call('POST','/api/account/login/request',{email});assert.equal(r.statusCode,202,r.body);assert.equal(r.json().code,undefined);let code;await deliverCustomerCode(db,secretVault(secret),{send:async(config,message)=>{assert.deepEqual(config.email.to,[email]);code=message.values.code;assert.match(notificationText(message),new RegExp(code));return {}}});assert.match(code,/^\d{6}$/);return {...r.json(),code}}
 async function login(email){const c=await challenge(email),r=await call('POST','/api/account/login/verify',{challenge_id:c.challenge_id,code:c.code});assert.equal(r.statusCode,200,r.body);return {...base,cookie:r.headers['set-cookie'].split(';')[0],'x-customer-csrf':r.json().csrf_token}}
 try{
 let alice,bob,first,orderId
 await t.test('OTP is encrypted, single use, bounded and origin protected',async()=>{
  assert.equal((await call('POST','/api/account/login/request',{email:'a@example.com'},{...base,origin:'http://evil.test'})).statusCode,403)
  const c=await challenge('alice@example.com');const row=(await query('SELECT * FROM customer_login_codes WHERE id=$1',[c.challenge_id])).rows[0];assert.notEqual(row.code_hash,c.code);assert.equal(row.box,'')
  const r=await call('POST','/api/account/login/verify',{challenge_id:c.challenge_id,code:c.code});assert.equal(r.statusCode,200,r.body);alice={...base,cookie:r.headers['set-cookie'].split(';')[0],'x-customer-csrf':r.json().csrf_token};assert.match(r.headers['set-cookie'],/HttpOnly; SameSite=Lax/)
  assert.equal((await call('POST','/api/account/login/verify',{challenge_id:c.challenge_id,code:c.code})).statusCode,401)
  const locked=await challenge('locked@example.com');for(let i=0;i<5;i++)assert.equal((await call('POST','/api/account/login/verify',{challenge_id:locked.challenge_id,code:locked.code==='000000'?'111111':'000000'})).statusCode,401)
  assert.equal((await call('POST','/api/account/login/verify',{challenge_id:locked.challenge_id,code:locked.code})).statusCode,401)
  assert.equal((await call('POST','/api/account/login/request',{email:'alice@example.com'})).statusCode,429)
  const expired=await challenge('expired@example.com');await query("UPDATE customer_login_codes SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[expired.challenge_id]);assert.equal((await call('POST','/api/account/login/verify',{challenge_id:expired.challenge_id,code:expired.code})).statusCode,401)
  bob=await login('bob@example.com')
  assert.equal((await call('GET','/api/admin/orders',undefined,alice)).statusCode,401)
 })
 await t.test('profile and address mutations require CSRF, revisions and ownership',async()=>{
  const profile={name:'Алиса',phone:'+79991112233',revision:1}
  assert.equal((await call('PUT','/api/account/profile',profile,{...alice,'x-customer-csrf':'wrong'})).statusCode,403)
  assert.equal((await call('PUT','/api/account/profile',profile,alice)).statusCode,200)
  assert.equal((await call('PUT','/api/account/profile',profile,alice)).statusCode,409)
  const body={label:'Дом',name:'Алиса',phone:'+79991112233',address:'Новосибирск\nУлица 1',is_default:true}
  let r=await call('POST','/api/account/addresses',body,alice);assert.equal(r.statusCode,201,r.body);first=r.json()
  assert.equal((await call('PUT','/api/account/addresses/'+first.id,{...body,revision:first.revision},bob)).statusCode,409)
  r=await call('POST','/api/account/addresses',{...body,label:'Работа'},alice);assert.equal(r.statusCode,201,r.body)
  const rows=(await call('GET','/api/account/addresses',undefined,alice)).json();assert.equal(rows.filter(a=>a.is_default).length,1);assert.equal((await call('GET','/api/account/addresses',undefined,bob)).json().length,0)
  assert.equal((await call('DELETE','/api/account/addresses/'+first.id,{revision:first.revision},alice)).statusCode,409)
  for(let i=2;i<20;i++)assert.equal((await call('POST','/api/account/addresses',{...body,label:'Адрес '+i,is_default:false},alice)).statusCode,201)
  assert.equal((await call('POST','/api/account/addresses',body,alice)).statusCode,409)
 })
 await t.test('guest orders stay private; authenticated orders bind only to session',async()=>{
  await query('UPDATE products SET stock=20,price=10 WHERE id=1')
  const body={request_id:randomUUID(),customer:{name:'Алиса',phone:'+79991112233',email:'alice@example.com'},delivery:{method:'pickup',address:''},comment:'Для меня',items:[{product_id:1,variant_name:'',quantity:2}]}
  const checkoutHeaders={...alice,'x-nova-checkout':'1'}
  let r=await call('POST','/api/orders',body,{origin:base.origin,'x-nova-checkout':'1'});assert.equal(r.statusCode,201,r.body)
  assert.equal((await call('GET','/api/account/orders',undefined,alice)).json().items.length,0)
  body.request_id=randomUUID();body.account_id='999';r=await call('POST','/api/orders',body,checkoutHeaders);assert.equal(r.statusCode,201,r.body)
  const list=(await call('GET','/api/account/orders',undefined,alice)).json();assert.equal(list.items.length,1);orderId=list.items[0].id
  assert.equal((await call('GET','/api/account/orders/'+orderId,undefined,bob)).statusCode,404)
  assert.equal((await call('POST','/api/account/orders/'+orderId+'/reorder',{},bob)).statusCode,404)
  assert.equal((await call('POST','/api/orders',body,{...bob,'x-nova-checkout':'1'})).statusCode,409)
  await query("UPDATE orders SET admin_note='hidden' WHERE id=$1",[orderId]);const detail=(await call('GET','/api/account/orders/'+orderId,undefined,alice)).json();assert.equal(detail.admin_note,undefined);assert.equal(detail.account_id,undefined);assert.equal(detail.items[0].unit_cents,1000)
 })
 await t.test('reorder uses current stock and prices and never reserves or creates',async()=>{
  await query('UPDATE products SET price=15,stock=1 WHERE id=1')
  const r=await call('POST','/api/account/orders/'+orderId+'/reorder',{},alice);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().items[0].quantity,1);assert.equal(r.json().total_cents,1500);assert.equal(r.json().warnings.length,2)
  assert.equal((await query('SELECT stock FROM products WHERE id=1')).rows[0].stock,1)
  await query('UPDATE products SET variants=$1 WHERE id=1',[JSON.stringify([{name:'Новый',stock:3,price:15}])]);assert.equal((await call('POST','/api/account/orders/'+orderId+'/reorder',{},alice)).json().items.length,0)
 })
 await t.test('revocation blocks private reads and prevents silent guest checkout',async()=>{
  assert.equal((await call('POST','/api/account/logout-all',{},alice)).statusCode,204)
  assert.equal((await call('GET','/api/account/me',undefined,alice)).statusCode,401)
  assert.equal((await call('POST','/api/orders',{}, {...alice,'x-nova-checkout':'1'})).statusCode,401)
 })
 }finally{await app.close();await pg.close()}
})
