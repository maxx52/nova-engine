import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {createOrder,registerCommerce,updateOrder} from '../src/commerce.js'
import {paymentTokens,registerPayments,recordPayment} from '../src/payments.js'
import {defaultPayments,validatePayments,validPaymentOrigin,paymentDocument} from '../../../shared/payments.js'
import {httpHeaders} from '../../../config/httpHeaders.js'

test('payment settings accept public HTTPS sources and reject same-site, IP, credentials and malformed configuration',()=>{
 const good={...defaultPayments,enabled:true,link:'https://auth.robokassa.ru/pay?id=123',origins:['https://auth.robokassa.ru']}
 assert.equal(validatePayments(good,['https://nova.maxxdev.ru']),null)
 for(const source of ['http://bank.ru','https://127.0.0.1','https://[::1]','https://localhost','https://bank.local','https://bank.ru/path','https://*.bank.ru','https://user:pass@bank.ru','https://bank.ru:444','https://bank.ru\n','https://nova.maxxdev.ru'])assert.equal(validPaymentOrigin(source,['https://nova.maxxdev.ru']),false,source)
 for(const change of [b=>b.enabled='yes',b=>b.mode='api',b=>b.provider='missing',b=>b.code='x'.repeat(100001),b=>b.link='javascript:alert(1)',b=>b.origins=[],b=>b.origins.push(b.origins[0]),b=>b.revision='1',b=>b.instructions=null]){const b=structuredClone(good);change(b);assert.ok(validatePayments(b))}
 assert.equal(validatePayments({...good,mode:'widget',code:'<button>Pay</button>'}),null)
 assert.ok(validatePayments({...good,mode:'widget',code:''}))
})
test('receipt tokens resist tampering and use a separate signature purpose',()=>{
 const tokens=paymentTokens('test-only-secret'),uuid=randomUUID(),token=tokens.issue(uuid)
 assert.equal(tokens.verify(token),uuid)
 for(const invalid of [null,{},uuid,token.slice(0,-1),token+'0',token.replace(uuid,randomUUID()),tokens.issue(randomUUID()).slice(0,37)+token.slice(37)])assert.equal(tokens.verify(invalid),null)
 assert.equal(paymentTokens('different-test-secret').verify(token),null)
})
test('widget document scopes sources and passes only public order context',()=>{
 const html=paymentDocument({...defaultPayments,code:'<div>widget</div>',origins:['https://auth.robokassa.ru','https://*.bank.ru']},{number:'</script><script>bad()</script>',total_cents:1234,email:'secret@example.invalid',payment_token:'private'})
 assert.ok(html.includes("default-src 'none'"));assert.ok(html.includes('https://auth.robokassa.ru'));assert.ok(!html.includes('https://*.bank.ru'))
 assert.ok(html.includes('\\u003c/script>'));assert.ok(!html.includes('secret@example.invalid'));assert.ok(!html.includes('payment_token'));assert.ok(html.includes('"amount":"12.34"'))
 assert.ok(!httpHeaders()['Content-Security-Policy'].includes("frame-src 'self' data:"));assert.ok(!httpHeaders()['Content-Security-Policy'].includes("script-src 'self' 'unsafe-inline'"))
})

test('PostgreSQL payments: authenticated settings, receipt privacy, manual reconciliation and refunds',async t=>{
 const pg=new PGlite();const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 const db={query,connect:async()=>({query,release(){}})};pool.query=query;pool.connect=db.connect
 await initDatabase();await initDatabase()
 const app=Fastify(),secret='payments-test-only-key-32-characters'
 const {requireAdmin}=registerAuth(app,db,{setupKey:secret})
 const payments=registerPayments(app,db,requireAdmin,{secret,origins:['https://shop.nova.ru','http://localhost:5173']})
 registerCommerce(app,db,requireAdmin,{origins:['http://localhost:5173'],receipt:payments.receipt})
 const mutation={'x-nova-request':'1',origin:'http://localhost:5174'}
 const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:mutation,payload:{username:'test_admin',password:'temporary-test-password-only',setup_key:secret}})
 assert.equal(setup.statusCode,201,setup.body)
 const auth={...mutation,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token}
 const call=(method,url,payload,headers=auth)=>app.inject({method,url,payload,headers})
 const publicHeaders={'x-nova-checkout':'1',origin:'http://localhost:5173'}
 const checkout=token=>call('POST','/api/payments/checkout',{token},publicHeaders)
 try{
  const frame=await call('GET','/api/payment-frame');assert.equal(frame.statusCode,200);assert.ok(frame.headers['content-security-policy'].includes('sandbox allow-scripts'));assert.ok(!frame.headers['content-security-policy'].includes('allow-same-origin'));assert.equal(frame.headers['x-frame-options'],'SAMEORIGIN');assert.ok(!frame.body.includes('private'));
  const defaults=(await call('GET','/api/payments/config')).json();assert.equal(defaults.enabled,false);assert.equal(defaults.code,undefined)
  assert.equal((await call('GET','/api/admin/payments',undefined,{})).statusCode,401)
  let c={...(await call('GET','/api/admin/payments')).json(),enabled:true,provider:'robokassa',mode:'widget',code:'<button onclick="parent.postMessage({paid:true},\'*\')">Test</button>',origins:['https://auth.robokassa.ru'],link:'https://auth.robokassa.ru/pay'}
  assert.equal((await call('PUT','/api/admin/payments',c,{...auth,'x-csrf-token':'bad'})).statusCode,403)
  assert.equal((await call('PUT','/api/admin/payments',{...c,origins:['https://shop.nova.ru']})).statusCode,400)
  const saved=await call('PUT','/api/admin/payments',c);assert.equal(saved.statusCode,200,saved.body);c=saved.json();assert.equal(c.revision,2)
  assert.equal((await call('PUT','/api/admin/payments',{...c,revision:1})).statusCode,409)
  const pub=(await call('GET','/api/payments/config')).json();assert.deepEqual(Object.keys(pub).sort(),['enabled','instructions','title'])
  await query('UPDATE products SET stock=4,price=12.34 WHERE id=1')
  const input={request_id:randomUUID(),customer:{name:'Payment Test',phone:'+79991112233',email:'private@example.invalid'},delivery:{method:'pickup',address:''},comment:'private comment',items:[{product_id:1,variant_name:'',quantity:2}],payment_state:'paid',total_cents:1}
  const receipt=await createOrder(db,input,{receipt:payments.receipt}),id=(await query('SELECT id::text FROM orders')).rows[0].id
  assert.deepEqual(await createOrder(db,input,{receipt:payments.receipt}),receipt)
  const opened=await checkout(receipt.payment_token);assert.equal(opened.statusCode,200,opened.body);const data=opened.json()
  assert.equal(data.order.total_cents,2468);assert.equal(data.order.payment_state,'unpaid');assert.equal(data.code,c.code)
  assert.deepEqual(Object.keys(data.order).sort(),['currency','number','payment_state','total_cents'])
  assert.ok(!opened.body.includes('private'));assert.ok(!opened.body.includes('phone'));assert.ok(!opened.body.includes('request_id'))
  assert.equal((await checkout(receipt.payment_token.slice(0,-1))).statusCode,403)
  assert.equal((await checkout(paymentTokens(secret).issue(randomUUID()))).statusCode,404)
  assert.equal((await call('POST','/api/payments/checkout',{token:receipt.payment_token},{})).statusCode,403)
  assert.equal((await call('POST','/api/payments/checkout',{token:receipt.payment_token},{...publicHeaders,origin:'https://evil.ru'})).statusCode,403)
  assert.equal((await call('PUT','/api/admin/orders/'+id+'/payment',{revision:1,state:'paid',reference:'fake'},publicHeaders)).statusCode,401)
  c=(await call('PUT','/api/admin/payments',{...c,mode:'link'})).json()
  const linked=(await checkout(receipt.payment_token)).json();assert.equal(linked.mode,'link');assert.equal(linked.link,c.link);assert.equal(linked.code,undefined)
  c=(await call('PUT','/api/admin/payments',{...c,enabled:false})).json()
  assert.equal((await checkout(receipt.payment_token)).json().enabled,false)
  c=(await call('PUT','/api/admin/payments',{...c,enabled:true})).json()

  await assert.rejects(recordPayment(db,id,{revision:1,state:'paid',reference:''}),e=>e.statusCode===400)
  await recordPayment(db,id,{revision:1,state:'paid',reference:'Verified operation #123, full amount 24.68'})
  assert.equal((await checkout(receipt.payment_token)).json().enabled,false)
  assert.equal((await checkout(receipt.payment_token)).json().order.payment_state,'paid')
  await assert.rejects(recordPayment(db,id,{revision:1,state:'refunded',reference:'stale'}),e=>e.statusCode===409)
  await assert.rejects(updateOrder(db,id,{revision:2,status:'cancelled',admin_note:''}),e=>e.statusCode===409)
  assert.equal((await query('SELECT stock FROM products WHERE id=1')).rows[0].stock,2)
  await recordPayment(db,id,{revision:2,state:'refunded',reference:'Verified full refund #124'})
  assert.equal((await checkout(receipt.payment_token)).json().order.payment_state,'refunded')
  await updateOrder(db,id,{revision:3,status:'cancelled',admin_note:''})
  assert.equal((await query('SELECT stock FROM products WHERE id=1')).rows[0].stock,4)
  assert.equal((await checkout(receipt.payment_token)).statusCode,409)
  const history=(await query('SELECT message FROM order_history ORDER BY id')).rows.map(x=>x.message).join(' ');assert.ok(history.includes('#123')&&history.includes('#124'))
  await assert.rejects(recordPayment(db,id,{revision:4,state:'paid',reference:'cancelled'}),e=>e.statusCode===409)
  await query("UPDATE orders SET created_at=NOW()-INTERVAL '31 days'")
  assert.equal((await checkout(receipt.payment_token)).statusCode,404)
 }finally{await app.close();await pg.close()}
})
