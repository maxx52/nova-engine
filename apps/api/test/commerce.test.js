import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {createOrder,updateOrder,registerCommerce} from '../src/commerce.js'
import {normalizePhone,validateCheckout} from '../../../shared/commerce.js'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {publicErrorHandler} from '../src/security.js'

const checkout=()=>({request_id:randomUUID(),customer:{name:'Тестовый покупатель',phone:'8 (999) 111-22-33',email:'test@example.invalid'},delivery:{method:'pickup',address:''},comment:'',items:[{product_id:1,variant_name:'',quantity:2}]})
test('checkout rejects malformed contacts, item quantities, duplicate variants and unsafe IDs',()=>{
 assert.equal(normalizePhone('8 (999) 111-22-33'),'+79991112233');assert.equal(normalizePhone('+49 12345678901'),'+4912345678901')
 assert.equal(normalizePhone('no phone'),'');assert.equal(validateCheckout(checkout()),null)
 for(const change of [b=>b.request_id='1',b=>b.request_id=[randomUUID()],b=>b.delivery.method=['pickup'],b=>b.customer.phone='123',b=>b.customer.name=' ',b=>b.customer.email='bad@',b=>b.delivery={method:'delivery',address:''},b=>b.items[0].quantity=0,b=>b.items[0].quantity=1.5,b=>b.items[0].product_id=Infinity,b=>b.items.push({...b.items[0]}),b=>b.items[0].quantity=101]){const b=checkout();change(b);assert.ok(validateCheckout(b))}
})

test('PostgreSQL commerce: atomic stock, snapshots, retries, status changes, privacy and CSRF',async t=>{
 const pg=new PGlite()
 const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 // PGlite has one SQL connection. Lease it exclusively to model transaction clients.
 let tail=Promise.resolve()
 const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;return {query,release}}}
 pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase() // migrations must be repeatable
 const app=Fastify();const {requireAdmin}=registerAuth(app,db,{setupKey:'commerce-test-setup-key-32-characters'})
 registerCommerce(app,db,requireAdmin,{origins:['http://localhost:5173']});app.setErrorHandler(publicErrorHandler)
 const mutation={'x-nova-request':'1',origin:'http://localhost:5174'}
 const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:mutation,payload:{username:'test_admin',password:'temporary-only-test-password',setup_key:'commerce-test-setup-key-32-characters'}})
 assert.equal(setup.statusCode,201,setup.body)
 const auth={...mutation,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token}
 const call=(method,url,payload,headers=auth)=>app.inject({method,url,payload,headers})
 const stock=async()=>Number((await query('SELECT stock FROM products WHERE id=1')).rows[0].stock)
 const count=async table=>Number((await query('SELECT COUNT(*) AS count FROM '+table)).rows[0].count)
 try{
  await query('UPDATE products SET stock=5,price=12.34,sku=$1 WHERE id=1',['SKU-1'])
  let receipt,orderId
  await t.test('prices come from SQL, duplicate submissions reserve once even when concurrent',async()=>{
   const b=checkout();b.total_cents=1;b.items[0].price=0.01
   const [a,c]=await Promise.all([createOrder(db,b),createOrder(db,b)])
   assert.deepEqual(a,c);assert.equal(a.total_cents,2468);assert.equal(await stock(),3);assert.equal(await count('orders'),1);assert.equal(await count('customers'),1)
   receipt=a;orderId=(await query('SELECT id::text FROM orders')).rows[0].id
   assert.deepEqual(Object.keys(a).sort(),['currency','number','total_cents'])
   await assert.rejects(createOrder(db,{...b,comment:'changed'}),e=>e.statusCode===409)
  })
  await t.test('concurrent purchases cannot oversell, multi-item failures roll back every change',async()=>{
   const b=checkout();b.items[0].quantity=2
   const r=await Promise.allSettled([createOrder(db,b),createOrder(db,{...b,request_id:randomUUID()})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(await stock(),1)
   const before=await count('orders'),requests=await count('order_requests')
   const bad=checkout();bad.items=[{product_id:1,variant_name:'',quantity:1},{product_id:2,variant_name:'',quantity:1}]
   await assert.rejects(createOrder(db,bad),e=>e.statusCode===409);assert.equal(await stock(),1);assert.equal(await count('orders'),before);assert.equal(await count('order_requests'),requests)
   await query('UPDATE products SET published=FALSE WHERE id=1');await assert.rejects(createOrder(db,checkout()),e=>e.statusCode===409);await query('UPDATE products SET published=TRUE WHERE id=1')
  })
  await t.test('admin detail preserves original product/contact snapshots and blocks guests',async()=>{
   await query('UPDATE products SET name=$1,price=99 WHERE id=1',['Changed name'])
   const r=await call('GET','/api/admin/orders/'+orderId);assert.equal(r.statusCode,200,r.body);const detail=r.json()
   assert.equal(detail.items[0].name,'Беспроводные наушники');assert.equal(detail.items[0].unit_cents,1234);assert.equal(detail.phone,'+79991112233')
   for(const url of ['/api/admin/orders','/api/admin/orders/'+orderId,'/api/admin/customers','/api/admin/customers/1','/api/admin/commerce/summary'])assert.equal((await call('GET',url,undefined,{})).statusCode,401,url)
   assert.equal((await call('GET','/api/orders/'+orderId,undefined,{})).statusCode,404)
   assert.equal((await call('PUT','/api/admin/orders/'+orderId,{revision:1,status:'cancelled',admin_note:''},{...auth,'x-csrf-token':'wrong'})).statusCode,403)
   assert.equal(await stock(),1)
  })
  await t.test('cancellation restores once, stale revisions and invalid transitions fail',async()=>{
   await updateOrder(db,orderId,{revision:1,status:'cancelled',admin_note:'Cancelled by test'});assert.equal(await stock(),3)
   await assert.rejects(updateOrder(db,orderId,{revision:1,status:'cancelled',admin_note:''}),e=>e.statusCode===409);assert.equal(await stock(),3)
   await updateOrder(db,orderId,{revision:2,status:'cancelled',admin_note:'Edited note'});assert.equal(await stock(),3)
   await assert.rejects(updateOrder(db,orderId,{revision:3,status:'new',admin_note:''}),e=>e.statusCode===409)
   const r=await call('GET','/api/admin/orders/'+orderId);assert.equal(r.json().history.length,3)
  })
  await t.test('variant stock is independent, missing options cannot be bought and removed variants warn on cancel',async()=>{
   await query('UPDATE products SET variants=$1 WHERE id=2',[JSON.stringify([{name:'Красный',sku:'R',price:25.05,stock:3},{name:'Синий',sku:'B',price:30,stock:4}])])
   const b=checkout();b.items=[{product_id:2,variant_name:'Красный',quantity:2},{product_id:2,variant_name:'Синий',quantity:1}]
   const r=await createOrder(db,b);assert.equal(r.total_cents,8010)
   const variants=(await query('SELECT variants FROM products WHERE id=2')).rows[0].variants;assert.equal(variants[0].stock,1);assert.equal(variants[1].stock,3)
   b.request_id=randomUUID();b.items=[{product_id:2,variant_name:'',quantity:1}];await assert.rejects(createOrder(db,b),e=>e.statusCode===409)
   const last=(await query('SELECT id::text FROM orders ORDER BY id DESC LIMIT 1')).rows[0].id
   await query('UPDATE products SET variants=$1 WHERE id=2',[JSON.stringify([variants[0]])]);await updateOrder(db,last,{revision:1,status:'cancelled',admin_note:''})
   const detail=(await call('GET','/api/admin/orders/'+last)).json();assert.match(detail.history[0].message,/Проверьте остаток вручную/)
   assert.equal((await query('SELECT variants FROM products WHERE id=2')).rows[0].variants[0].stock,3)
  })
  await t.test('customer editing, search, order history and status filters work without altering snapshots',async()=>{
   const customer=(await call('GET','/api/admin/customers/1')).json();assert.equal(customer.orders_count,3)
   const payload={revision:customer.revision,name:'Updated customer',phone:customer.phone,email:'new@example.invalid',note:'Private note'}
   assert.equal((await call('PUT','/api/admin/customers/1',payload)).statusCode,200)
   assert.equal((await call('PUT','/api/admin/customers/1',payload)).statusCode,409)
   assert.equal((await call('GET','/api/admin/orders/'+orderId)).json().customer_name,'Тестовый покупатель')
   assert.equal((await call('GET','/api/admin/customers?search=Updated')).json().total,1)
   assert.equal((await call('GET','/api/admin/orders?status=cancelled')).json().total,2)
   assert.equal((await call('GET','/api/admin/orders?search='+receipt.number)).json().total,1)
   assert.equal((await call('GET','/api/admin/orders?page=-1')).statusCode,400)
   const summary=(await call('GET','/api/admin/commerce/summary')).json();assert.equal(summary.orders,3);assert.equal(summary.new_orders,1);assert.equal(summary.customers,1)
  })
  await t.test('shipment and completion record transitions and completed totals; shipped cancellation fails',async()=>{
   const row=(await query("SELECT id::text FROM orders WHERE status='new'")).rows[0]
   for(const [i,status] of ['confirmed','processing','shipped','completed'].entries())await updateOrder(db,row.id,{revision:i+1,status,admin_note:''})
   await assert.rejects(updateOrder(db,row.id,{revision:5,status:'cancelled',admin_note:''}),e=>e.statusCode===409)
   assert.equal((await call('GET','/api/admin/commerce/summary')).json().completed_cents,2468)
  })
  await t.test('deleted products keep historical order details and emit a stock reconciliation warning',async()=>{
   const p=(await query("INSERT INTO products(name,category,price,stock) VALUES('Temporary product','Test',1,1) RETURNING id")).rows[0]
   const b=checkout();b.items=[{product_id:Number(p.id),variant_name:'',quantity:1}];await createOrder(db,b)
   const row=(await query('SELECT id::text FROM orders ORDER BY id DESC LIMIT 1')).rows[0]
   await query('DELETE FROM products WHERE id=$1',[p.id]);await updateOrder(db,row.id,{revision:1,status:'cancelled',admin_note:''})
   const detail=(await call('GET','/api/admin/orders/'+row.id)).json();assert.equal(detail.items[0].product_id,null);assert.equal(detail.items[0].name,'Temporary product');assert.match(detail.history[0].message,/Проверьте остаток вручную/)
  })
  await t.test('public mutations reject cross-origin/simple requests, disabled shop, malformed body and excessive attempts',async()=>{
   const headers={'x-nova-checkout':'1',origin:'http://localhost:5173'}
   assert.equal((await call('POST','/api/orders',checkout(),{})).statusCode,403)
   assert.equal((await call('POST','/api/orders',checkout(),{...headers,origin:'https://evil.invalid'})).statusCode,403)
   assert.equal((await call('POST','/api/orders',{},headers)).statusCode,400)
   await query('UPDATE site_settings SET shop_enabled=FALSE WHERE id=1');assert.equal((await call('POST','/api/orders',checkout(),headers)).statusCode,404);await query('UPDATE site_settings SET shop_enabled=TRUE WHERE id=1')
   for(let i=0;i<8;i++)await call('POST','/api/orders',{},headers)
   const limited=await call('POST','/api/orders',checkout(),headers);assert.equal(limited.statusCode,429);assert.equal(limited.headers['retry-after'],'900')
  })
 }finally{await app.close();await pool.end();await pg.close()}
})
