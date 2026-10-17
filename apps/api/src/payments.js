import {createHmac,timingSafeEqual} from 'node:crypto'
import {defaultPayments,validatePayments,paymentStates} from '../../../shared/payments.js'
import {orderNumber} from '../../../shared/commerce.js'
const fail=(statusCode,error)=>{throw Object.assign(Error(error),{statusCode,payment:true})}
export async function initPayments(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS payment_settings(id INTEGER PRIMARY KEY CHECK(id=1),config JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1)`)
 await pool.query('INSERT INTO payment_settings(id,config) VALUES(1,$1) ON CONFLICT(id) DO NOTHING',[JSON.stringify(defaultPayments)])
 await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_state VARCHAR(16) NOT NULL DEFAULT 'unpaid' CHECK(payment_state IN ('unpaid','paid','refunded'))`)
}
export async function readPayments(pool){const row=(await pool.query('SELECT config,revision FROM payment_settings WHERE id=1')).rows[0];return {...row.config,revision:row.revision}}
export function paymentTokens(secret){
 const signature=requestId=>createHmac('sha256',secret).update('nova-payment-receipt-v1:'+requestId).digest('hex')
 return {
  issue:requestId=>requestId+'.'+signature(requestId),
  verify:token=>{
   if(typeof token!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[a-f0-9]{64}$/i.test(token))return null
   const [uuid,sig]=token.split('.');return timingSafeEqual(Buffer.from(sig,'hex'),Buffer.from(signature(uuid),'hex'))?uuid:null
  }
 }
}
export async function recordPayment(pool,orderId,body){
 if(typeof orderId!=='string'||! /^[1-9][0-9]{0,17}$/.test(orderId)||!Number.isInteger(body?.revision)||!['paid','refunded'].includes(body.state)||typeof body.reference!=='string'||!body.reference.trim()||body.reference.length>500)fail(400,'Укажите подтверждённый статус и номер операции / основание (до 500 символов)')
 const db=await pool.connect()
 try{
  await db.query('BEGIN')
  const row=(await db.query('SELECT status,payment_state,revision FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0]
  if(!row)fail(404,'Заказ не найден')
  if(row.revision!==body.revision)fail(409,'Заказ изменился. Обновите карточку.')
  if(body.state==='paid'&&row.status==='cancelled')fail(409,'Нельзя подтвердить оплату отменённого заказа')
  if(!(row.payment_state==='unpaid'&&body.state==='paid'||row.payment_state==='paid'&&body.state==='refunded'))fail(409,'Недоступный переход статуса оплаты')
  await db.query('UPDATE orders SET payment_state=$1,revision=revision+1,updated_at=NOW() WHERE id=$2',[body.state,orderId])
  await db.query('INSERT INTO order_history(order_id,status,message) VALUES($1,$2,$3)',[orderId,row.status,paymentStates[body.state]+'. Основание: '+body.reference.trim()])
  await db.query('COMMIT');return {ok:true}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export function registerPayments(app,pool,requireAdmin,{secret,origins=[]}){
 // Separate HTTP document: data:/srcdoc frames inherit the main page CSP and cannot run provider scripts.
 // Both the response and the iframe sandbox omit allow-same-origin. No parent bridge for payment status.
 app.get('/api/payment-frame',{config:{novaCodeFrame:true}},async(req,reply)=>{
  const policy="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; connect-src https:; frame-src https:; form-action https:; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
  const runtime=`const expected=new URL(location.href).origin;addEventListener('message',function render(e){if(e.source!==parent||e.origin!==expected||e.data?.type!=='nova:payment-render'||typeof e.data.html!=='string'||e.data.html.length>160000)return;removeEventListener('message',render);document.open();document.write(e.data.html);document.close()})`
  return reply.header('Content-Security-Policy',policy).header('X-Frame-Options','SAMEORIGIN').type('text/html; charset=utf-8').send('<!doctype html><html><head><meta charset="utf-8"></head><body><script>'+runtime+'</script></body></html>')
 })
 const tokens=paymentTokens(secret)
 const protect=handler=>async(req,reply)=>{try{return await handler(req,reply)}catch(e){if(e.payment)return reply.code(e.statusCode).send({error:e.message});throw e}}
 const publicConfig=c=>({enabled:c.enabled,title:c.title,instructions:c.instructions})
 app.get('/api/payments/config',async()=>publicConfig(await readPayments(pool)))
 app.get('/api/admin/payments',{preHandler:requireAdmin},()=>readPayments(pool))
 app.put('/api/admin/payments',{preHandler:requireAdmin,bodyLimit:130000},protect(async(req)=>{
  const error=validatePayments(req.body,origins);if(error)fail(400,error)
  const {enabled,provider,mode,title,instructions,link,code,origins:allowed}=req.body
  const config={enabled,provider,mode,title:title.trim(),instructions,link,code,origins:allowed}
  const result=await pool.query('UPDATE payment_settings SET config=$1,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision',[JSON.stringify(config),req.body.revision])
  if(!result.rowCount)fail(409,'Настройки изменились. Обновите страницу и повторите.')
  return {...config,revision:result.rows[0].revision}
 }))
 // A receipt token authorizes only public payment instructions for one order, never contacts or admin actions.
 app.post('/api/payments/checkout',{bodyLimit:1024,onRequest:async(req,reply)=>{
  if(req.headers['x-nova-checkout']!=='1'||req.headers.origin&&!origins.includes(req.headers.origin))return reply.code(403).send({error:'Запрос отклонён'})
 }},protect(async(req)=>{
  const uuid=tokens.verify(req.body?.token);if(!uuid)fail(403,'Неверный ключ заказа')
  const row=(await pool.query(`SELECT o.id::text,o.total_cents,o.status,o.payment_state FROM orders o JOIN order_requests r ON r.order_id=o.id WHERE r.request_id=$1 AND o.created_at>NOW()-INTERVAL '30 days'`,[uuid])).rows[0]
  if(!row)fail(404,'Заказ недоступен. Обратитесь в магазин.')
  const order={number:orderNumber(row.id),total_cents:Number(row.total_cents),currency:'RUB',payment_state:row.payment_state}
  if(row.status==='cancelled')fail(409,'Заказ отменён. Оплата недоступна.')
  if(row.payment_state!=='unpaid'||order.total_cents===0)return {order,enabled:false}
  const c=await readPayments(pool)
  if(!c.enabled)return {order,enabled:false}
  // Validate again against deployment origins, including settings saved on a different host.
  if(validatePayments(c,origins))fail(503,'Настройки оплаты требуют проверки администратором')
  return {order,...publicConfig(c),mode:c.mode,link:c.link,...(c.mode==='widget'?{code:c.code,origins:c.origins}:{})}
 }))
 app.put('/api/admin/orders/:id/payment',{preHandler:requireAdmin,bodyLimit:3000},protect(req=>recordPayment(pool,req.params.id,req.body)))
 return {receipt:(row,requestId)=>({number:orderNumber(row.id),total_cents:Number(row.total_cents),currency:'RUB',payment_token:tokens.issue(requestId)})}
}
