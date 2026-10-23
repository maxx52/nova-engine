import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHmac} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {createOrder,updateOrder,registerCommerce} from '../src/commerce.js'
import {registerPayments,recordPayment,paymentTokens} from '../src/payments.js'
import {registerAutomaticPayments,amountCents,validHmac,applyVerifiedPayment} from '../src/automaticPayments.js'
import {registerFulfillment,orderStatusTokens,prepareOrderNotifications,deliverOrderNotification} from '../src/fulfillment.js'
import {secretVault} from '../src/formDelivery.js'
import {fulfillmentDefaults,validateFulfillment,shippingPrice,trackingLink} from '../../../shared/fulfillment.js'
import {publicErrorHandler} from '../src/security.js'
import {allowed as roleAllows} from '../src/identity.js'
const secret='order-operations-test-secret-only-32',siteOrigin='http://localhost:5173'
const input=()=>({request_id:randomUUID(),customer:{name:'Private Buyer',phone:'+79991112233',email:'buyer@example.invalid'},delivery:{method:'pickup',address:''},comment:'private comment',items:[{product_id:1,variant_name:'',quantity:1}]})
const signature=(raw,key='fake-provider-secret')=>createHmac('sha256',key).update(raw).digest('base64')
test('financial amounts, signatures, shipping and receipt purposes reject ambiguous inputs',()=>{
 for(const [s,n] of [['0',0],['12.34',1234],['12.3',1230],[12.34,1234]])assert.equal(amountCents(s),n)
 for(const v of ['1e3','-1','01','12.345','Infinity','',null,{},'1,23'])assert.equal(amountCents(v),null)
 const raw=Buffer.from('Name=A%2BB&Amount=12.34');assert.ok(validHmac(raw,signature(raw),'fake-provider-secret'));assert.ok(!validHmac(Buffer.from('Name=A+B&Amount=12.34'),signature(raw),'fake-provider-secret'));assert.ok(!validHmac(raw,signature(raw),'other'));assert.ok(!validHmac(raw,'bad','fake-provider-secret'))
 const id=randomUUID(),token=orderStatusTokens(secret).issue(id);assert.equal(orderStatusTokens(secret).verify(token),id);assert.equal(paymentTokens(secret).verify(token),null);assert.equal(orderStatusTokens(secret).verify(paymentTokens(secret).issue(id)),null)
 const c=fulfillmentDefaults();assert.equal(validateFulfillment(c),null);c.options[1].price_cents=35000;c.options[1].free_from_cents=500000;assert.equal(shippingPrice(c.options[1],499999),35000);assert.equal(shippingPrice(c.options[1],500000),0)
 c.options.push({...c.options[0]});assert.ok(validateFulfillment(c));for(const url of ['http://example.ru','javascript:alert(1)','https://127.0.0.1','https://user:pass@example.ru'])assert.equal(trackingLink(url),false)
 assert.ok(roleAllows('manager','PUT','/api/admin/orders/:id/shipping'));assert.ok(!roleAllows('manager','PUT','/api/admin/fulfillment'));assert.ok(!roleAllows('editor','PUT','/api/admin/payments/automatic'))
})
test('PostgreSQL order operations: authoritative delivery, notifications and authenticated automatic payment lifecycle',async t=>{
 const pg=new PGlite();const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve();const db={query,connect:async()=>{const before=tail;let release;tail=new Promise(r=>release=r);await before;return {query,release}}};pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify(),{requireAdmin}=registerAuth(app,db,{setupKey:secret});let providerObject=null,networkCalls=[],createResponse=null
 const fetcher=async(url,options)=>{networkCalls.push({url,method:options.method});return new Response(JSON.stringify(options.method==='POST'?createResponse:providerObject),{status:200,headers:{'content-type':'application/json'}})}
 registerFulfillment(app,db,requireAdmin,{secret,siteOrigin,worker:false});const automatic=registerAutomaticPayments(app,db,requireAdmin,{secret,siteOrigin,fetcher});const payments=registerPayments(app,db,requireAdmin,{secret,origins:[siteOrigin],automaticEnabled:automatic.enabled});registerCommerce(app,db,requireAdmin,{origins:[siteOrigin],receipt:payments.receipt});app.setErrorHandler(publicErrorHandler)
 const mutation={'x-nova-request':'1',origin:'http://localhost:5174'},setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:mutation,payload:{username:'test_admin',password:'test-temporary-password-only',setup_key:secret}});assert.equal(setup.statusCode,201,setup.body)
 const auth={...mutation,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token},pub={'x-nova-checkout':'1',origin:siteOrigin}
 const call=(method,url,payload,headers=auth)=>app.inject({method,url,payload,headers})
 const order=async id=>(await query('SELECT * FROM orders WHERE id=$1',[id])).rows[0]
 const stock=async()=>Number((await query('SELECT stock FROM products WHERE id=1')).rows[0].stock)
 const make=async(overrides={})=>{const b={...input(),...overrides},receipt=await createOrder(db,b,{receipt:payments.receipt}),o=(await query('SELECT * FROM orders ORDER BY id DESC LIMIT 1')).rows[0];return {b,receipt,id:String(o.id)}}
 const attempt=async(id,provider='cloudpayments')=>{const a=randomUUID();await query('INSERT INTO payment_attempts(id,order_id,provider,account_id,test,amount_cents,box) VALUES($1,$2,$3,$4,TRUE,$5,$6)',[a,id,provider,'fake-shop',Number((await order(id)).total_cents),secretVault('nova-payment-adapter-v1:'+secret).seal({provider,account_id:'fake-shop',secret:'fake-provider-secret',test:true})]);return a}
 const cp=async(a,change={},rawOverride=null,key='fake-provider-secret',event='pay')=>{const raw=rawOverride||new URLSearchParams({InvoiceId:a,Amount:'12.34',Currency:'RUB',TestMode:'1',Status:'Completed',TransactionId:'123456',...change}).toString();return call('POST','/api/payments/webhooks/cloudpayments/'+event,raw,{'content-type':'application/x-www-form-urlencoded','content-hmac':signature(raw,key)})}
 try{
 await query('UPDATE products SET stock=100,price=12.34 WHERE id=1')
 await t.test('shipping is priced from locked configuration, free thresholds and stale revisions roll back',async()=>{
  const settings=(await call('GET','/api/admin/fulfillment')).json();settings.config.options[1].price_cents=35000;settings.config.options[1].free_from_cents=2000
  assert.equal((await call('PUT','/api/admin/fulfillment',settings,{})).statusCode,401);const saved=await call('PUT','/api/admin/fulfillment',settings);assert.equal(saved.statusCode,200,saved.body)
  const b={...input(),delivery:{method:'delivery',address:'Private address',option_id:'delivery',settings_revision:2,price_cents:1}},r=await createOrder(db,b);assert.equal(r.total_cents,36234);assert.deepEqual(await createOrder(db,b),r)
  const o=(await query('SELECT * FROM orders ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(Number(o.delivery_cents),35000);assert.equal(o.delivery_snapshot.title,'Доставка')
  const free=await createOrder(db,{...b,request_id:randomUUID(),items:[{product_id:1,variant_name:'',quantity:2}]});assert.equal(free.total_cents,2468)
  const before=await stock();await assert.rejects(createOrder(db,{...b,request_id:randomUUID(),delivery:{...b.delivery,settings_revision:1}}),e=>e.statusCode===409);assert.equal(await stock(),before)
 })
 await t.test('status token reveals only safe fields; shipping uses revisions and HTTPS',async()=>{
  const {id,receipt}=await make();let r=await call('POST','/api/orders/status',{token:receipt.status_token},pub);assert.equal(r.statusCode,200,r.body);for(const key of ['email','phone','address','admin_note','items','payment_token'])assert.equal(r.json()[key],undefined)
  assert.equal((await call('POST','/api/orders/status',{token:receipt.payment_token},pub)).statusCode,403)
  assert.equal((await call('PUT','/api/admin/orders/'+id+'/shipping',{revision:1,tracking_code:'TRACK',tracking_url:'javascript:alert(1)'})).statusCode,400)
  r=await call('PUT','/api/admin/orders/'+id+'/shipping',{revision:1,tracking_code:'TRACK',tracking_url:'https://tracking.example.ru/1'});assert.equal(r.statusCode,200,r.body)
  assert.equal((await call('PUT','/api/admin/orders/'+id+'/shipping',{revision:1,tracking_code:'STALE',tracking_url:''})).statusCode,409)
  assert.equal((await call('POST','/api/orders/status',{token:receipt.status_token},pub)).json().tracking_code,'TRACK')
 })
 await t.test('signed CloudPayments rejects tampering, wrong totals/mode, incomplete capture and duplicates',async()=>{
  const {id}=await make(),a=await attempt(id),before=await stock()
  for(const [change,key] of [[{},'wrong-key'],[{Amount:'0.01'}],[{Currency:'USD'}],[{TestMode:'0'}],[{Status:'Authorized'}],[{OperationType:'Refund'}],[{TransactionId:'bad'}]]){const r=await cp(a,change,null,key);assert.ok(r.statusCode>=400,r.body);assert.equal((await order(id)).payment_state,'unpaid')}
  const duplicateFields='InvoiceId='+a+'&InvoiceId='+a+'&Amount=12.34';assert.equal((await cp(a,{},duplicateFields)).statusCode,400)
  assert.deepEqual((await cp(a,{},null,undefined,'check')).json(),{code:0});assert.equal((await order(id)).payment_state,'unpaid')
  let r=await cp(a);assert.equal(r.statusCode,200,r.body);assert.equal((await order(id)).payment_state,'paid');const revision=(await order(id)).revision;r=await cp(a);assert.equal(r.statusCode,200,r.body);assert.equal((await order(id)).revision,revision);assert.equal(await stock(),before)
  await recordPayment(db,id,{revision,state:'refunded',reference:'fake provider refund confirmed'});assert.equal((await cp(a)).statusCode,200);assert.equal((await order(id)).payment_state,'refunded','replayed payment cannot reverse a refund')
  await cp(a,{TransactionId:'123457'});assert.equal((await order(id)).payment_review,true);assert.equal((await order(id)).payment_state,'paid','a different real transaction needs reconciliation')
 })
 await t.test('YooKassa ignores claimed success until authenticated API context agrees',async()=>{
  const {id}=await make(),a=await attempt(id,'yookassa'),tx=randomUUID(),event={event:'payment.succeeded',object:{id:tx,metadata:{nova_attempt_id:a},paid:true,status:'succeeded'}}
  providerObject={id:tx,status:'pending',paid:false};let r=await call('POST','/api/payments/webhooks/yookassa',event,{});assert.equal(r.statusCode,400,r.body);assert.equal((await order(id)).payment_state,'unpaid')
  providerObject={id:tx,status:'succeeded',paid:true,test:true,amount:{value:'12.34',currency:'RUB'},recipient:{account_id:'wrong-shop'},metadata:{nova_attempt_id:a}};r=await call('POST','/api/payments/webhooks/yookassa',event,{});assert.equal(r.statusCode,400,r.body)
  providerObject.recipient.account_id='fake-shop';r=await call('POST','/api/payments/webhooks/yookassa',event,{});assert.equal(r.statusCode,200,r.body);const calls=networkCalls.length;assert.equal((await call('POST','/api/payments/webhooks/yookassa',event,{})).statusCode,200);assert.equal(networkCalls.length,calls)
  assert.ok(networkCalls.every(n=>n.url==='https://api.yookassa.ru/v3/payments/'+tx))
 })
 await t.test('automatic confirmation changes only new orders after verified payment',async()=>{const s=(await call('GET','/api/admin/fulfillment')).json();s.config.auto_confirm_paid=true;await call('PUT','/api/admin/fulfillment',s);const {id}=await make(),a=await attempt(id);await applyVerifiedPayment(db,a,'888');assert.equal((await order(id)).status,'confirmed');s.revision++;s.config.auto_confirm_paid=false;await call('PUT','/api/admin/fulfillment',s)})
 await t.test('late payment never resurrects cancellation or reserves returned stock; concurrent repeats apply once',async()=>{
  const {id}=await make(),a=await attempt(id);await updateOrder(db,id,{revision:1,status:'cancelled',admin_note:'private internal note'});const before=await stock();const results=await Promise.all([applyVerifiedPayment(db,a,'777'),applyVerifiedPayment(db,a,'777')]);assert.equal(results.filter(x=>x.duplicate).length,1);const o=await order(id);assert.equal(o.status,'cancelled');assert.equal(o.payment_state,'paid');assert.equal(o.payment_review,true);assert.equal(await stock(),before)
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM verified_payments WHERE attempt_id=$1',[a])).rows[0].n,1)
 })
 await t.test('settings keep keys private; API creates one provider invoice and never trusts browser paid flags',async()=>{
  const settings=(await call('GET','/api/admin/payments/automatic')).json();assert.equal(settings.secret,undefined)
  const saved=await call('PUT','/api/admin/payments/automatic',{...settings,enabled:true,provider:'cloudpayments',account_id:'fake-shop',secret:'fake-provider-secret'});assert.equal(saved.statusCode,200,saved.body);assert.ok(!saved.body.includes('fake-provider-secret'));assert.equal(saved.json().secret_set,true)
  const {id,receipt}=await make();createResponse={Success:true,Model:{Id:'fake-invoice',Url:'https://orders.cloudpayments.ru/d/fake-invoice'}}
  const r=await call('POST','/api/payments/automatic/checkout',{token:receipt.payment_token,paid:true},pub);assert.equal(r.statusCode,200,r.body);assert.equal((await order(id)).payment_state,'unpaid');const count=networkCalls.length;assert.equal((await call('POST','/api/payments/automatic/checkout',{token:receipt.payment_token},pub)).statusCode,200);assert.equal(networkCalls.length,count)
  assert.equal((await call('GET','/api/admin/orders/'+id+'/payments')).body.includes('fake-provider-secret'),false)
  assert.equal((await call('POST','/api/payments/automatic/checkout',{token:receipt.payment_token},{...pub,origin:'https://evil.example'})).statusCode,403)
 })
 await t.test('notification snapshots exclude internal notes; missing consent and uncertain sends do not auto resend',async()=>{
  // Earlier events are prepared with notifications disabled: enabling a channel is not retroactive.
  const vault=secretVault(secret);while((await query("SELECT 1 FROM order_events e WHERE NOT EXISTS(SELECT 1 FROM order_notifications n WHERE n.event_id=e.id AND n.channel='prepared') LIMIT 1")).rowCount)await prepareOrderNotifications(db,vault,{secret,siteOrigin})
  const s=(await call('GET','/api/admin/fulfillment')).json();s.config.notifications={customer_email:true,store_email:false,store_telegram:false};await call('PUT','/api/admin/fulfillment',s)
  const mail=(await query('SELECT config FROM contact_settings WHERE id=1')).rows[0].config;mail.enabled=true;mail.email={...mail.email,enabled:true,mode:'1gb',host:'robots.1gb.ru',port:25,tls:false,from:'shop@example.ru',to:['store@example.ru']};await query('UPDATE contact_settings SET config=$1::jsonb WHERE id=1',[JSON.stringify(mail)])
  await make();await prepareOrderNotifications(db,vault,{secret,siteOrigin});assert.equal((await query("SELECT 1 FROM order_notifications WHERE channel='email'")).rowCount,0)
  const {id}=await make({notifications_opt_in:true});await updateOrder(db,id,{revision:1,status:'confirmed',admin_note:'PRIVATE ADMIN NOTE'});await prepareOrderNotifications(db,vault,{secret,siteOrigin});await prepareOrderNotifications(db,vault,{secret,siteOrigin})
  let calls=0;await deliverOrderNotification(db,vault,{transports:{email:async(config,message)=>{calls++;assert.deepEqual(config.email.to,['buyer@example.invalid']);assert.ok(message.values.status_url.startsWith(siteOrigin+'/order-status#token='));assert.ok(!JSON.stringify(message).includes('PRIVATE'));assert.ok(!JSON.stringify(message).includes('private comment'));throw Error('unknown transport outcome')}}})
  const uncertain=(await query("SELECT * FROM order_notifications WHERE state='uncertain'")).rows[0];assert.ok(uncertain);assert.equal(calls,1);await query("UPDATE order_notifications SET not_before=NOW()+INTERVAL '1 hour' WHERE state='queued'")
  assert.equal(await deliverOrderNotification(db,vault,{transports:{email:async()=>calls++}}),false);assert.equal(calls,1)
  assert.equal((await call('POST','/api/admin/orders/'+id+'/notifications/'+uncertain.id+'/retry',{})).statusCode,400)
  assert.equal((await call('POST','/api/admin/orders/'+id+'/notifications/'+uncertain.id+'/retry',{acknowledge:true})).statusCode,200)
  await deliverOrderNotification(db,vault,{transports:{email:async()=>({})}});assert.equal((await query('SELECT state,box FROM order_notifications WHERE id=$1',[uncertain.id])).rows[0].box,'')
  const list=await call('GET','/api/admin/orders/'+id+'/notifications');assert.ok(!list.body.includes('box'));assert.ok(!list.body.includes('buyer@example.invalid'))
 })
 }finally{await app.close();await pg.close()}
})
