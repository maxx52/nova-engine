import {quoteShipping,orderEvent} from './fulfillment.js'
import {createHash} from 'node:crypto'
import {normalizePhone,validEmail,validateCheckout,orderStatuses,orderTransitions,orderNumber} from '../../../shared/commerce.js'
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{statusCode,commerce:true})}
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,17}$/.test(value)
const digest=value=>createHash('sha256').update(value).digest('hex')
const publicReceipt=row=>({number:orderNumber(row.id),total_cents:Number(row.total_cents),currency:'RUB'})
const jsonOrder=row=>{const {analytics_session_hash,...publicRow}=row;return {...publicRow,total_cents:Number(row.total_cents),number:orderNumber(row.id)}}
export async function initCommerce(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,name VARCHAR(150) NOT NULL,phone VARCHAR(16) NOT NULL UNIQUE,email VARCHAR(254) NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,customer_id BIGINT NOT NULL REFERENCES customers(id),customer_name VARCHAR(150) NOT NULL,
  phone VARCHAR(16) NOT NULL,email VARCHAR(254) NOT NULL DEFAULT '',delivery_method VARCHAR(20) NOT NULL CHECK(delivery_method IN ('pickup','delivery')),
  address TEXT NOT NULL DEFAULT '',comment TEXT NOT NULL DEFAULT '',admin_note TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','processing','shipped','completed','cancelled')),
  total_cents BIGINT NOT NULL CHECK(total_cents>=0 AND total_cents<=99999999999999),revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,variant_name VARCHAR(120) NOT NULL DEFAULT '',sku VARCHAR(100) NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100),unit_cents BIGINT NOT NULL CHECK(unit_cents>=0))`)
 await pool.query(`CREATE TABLE IF NOT EXISTS order_history (id BIGSERIAL PRIMARY KEY,order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,message TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`CREATE TABLE IF NOT EXISTS order_requests (request_id UUID PRIMARY KEY,payload_hash VARCHAR(64) NOT NULL,order_id BIGINT REFERENCES orders(id))`)
 await pool.query(`CREATE TABLE IF NOT EXISTS order_throttle (key VARCHAR(64) PRIMARY KEY,attempts INTEGER NOT NULL,reset_at TIMESTAMPTZ NOT NULL)`)
 for(const sql of ['CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC,id DESC)','CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id,id DESC)','CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status,id DESC)','CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id)','CREATE INDEX IF NOT EXISTS order_history_order_idx ON order_history(order_id,id)','CREATE INDEX IF NOT EXISTS order_throttle_expiry_idx ON order_throttle(reset_at)'])await pool.query(sql)
}
export async function createOrder(pool,body,{attribute=async()=>null,receipt=publicReceipt}={}){
 const error=validateCheckout(body);if(error)fail(400,error)
 // Canonical payload excludes all client prices, totals and status fields.
 const input={customer:{name:body.customer.name.trim(),phone:normalizePhone(body.customer.phone),email:body.customer.email.trim().toLowerCase()},delivery:{method:body.delivery.method,address:body.delivery.method==='delivery'?body.delivery.address.trim():''},comment:body.comment.trim(),items:body.items.map(x=>({product_id:x.product_id,variant_name:x.variant_name,quantity:x.quantity})).sort((a,b)=>a.product_id-b.product_id||a.variant_name.localeCompare(b.variant_name))}
 if(body.delivery.option_id!==undefined)input.delivery.option_id=body.delivery.option_id
 if(body.delivery.settings_revision!==undefined)input.delivery.settings_revision=body.delivery.settings_revision
 if(body.notifications_opt_in!==undefined)input.notifications_opt_in=body.notifications_opt_in
 const sessionHash=await attribute(body.analytics)
 const hash=digest(JSON.stringify(input)),db=await pool.connect()
 try{
  await db.query('BEGIN')
  await db.query('INSERT INTO order_requests (request_id,payload_hash) VALUES ($1,$2) ON CONFLICT (request_id) DO NOTHING',[body.request_id,hash])
  const submission=(await db.query('SELECT payload_hash,order_id::text FROM order_requests WHERE request_id=$1 FOR UPDATE',[body.request_id])).rows[0]
  if(submission.payload_hash!==hash)fail(409,'Состав заказа изменился. Начните новое оформление.')
  if(submission.order_id){const row=(await db.query('SELECT id::text,total_cents FROM orders WHERE id=$1',[submission.order_id])).rows[0];await db.query('COMMIT');return receipt(row,body.request_id)}
  const settings=(await db.query('SELECT shop_enabled FROM site_settings WHERE id=1 FOR SHARE')).rows[0]
  if(!settings?.shop_enabled)fail(404,'Магазин отключён')
  const ids=[...new Set(input.items.map(x=>x.product_id))].sort((a,b)=>a-b)
  const rows=(await db.query('SELECT id,name,price,sku,stock,variants,published FROM products WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[ids])).rows
  let total=0;const items=[]
  for(const item of input.items){
   const product=rows.find(x=>Number(x.id)===item.product_id)
   if(!product?.published)fail(409,'Один из товаров больше недоступен. Обновите каталог.')
   const variant=item.variant_name?product.variants.find(x=>x.name===item.variant_name):null
   if(product.variants.length&&!variant||!product.variants.length&&item.variant_name)fail(409,'Вариант товара изменился. Обновите каталог.')
   const source=variant||product
   if(source.stock<item.quantity)fail(409,'Недостаточно товара «'+product.name+(variant?' — '+variant.name:'')+'». Доступно: '+source.stock)
   const cents=Math.round(Number(source.price)*100);total+=cents*item.quantity
   if(!Number.isSafeInteger(total)||total>99999999999999)fail(400,'Превышена максимальная сумма заказа')
   source.stock-=item.quantity
   items.push({...item,name:product.name,sku:source.sku,unit_cents:cents})
  }
  const shipping=await quoteShipping(db,body.delivery,total);total+=shipping.cents;if(!Number.isSafeInteger(total)||total>99999999999999)fail(400,'Превышена сумма заказа')
  for(const product of rows)await db.query('UPDATE products SET stock=$1,variants=$2,revision=revision+1,updated_at=NOW() WHERE id=$3',[product.stock,JSON.stringify(product.variants),product.id])
  await db.query('INSERT INTO customers (name,phone,email) VALUES ($1,$2,$3) ON CONFLICT (phone) DO NOTHING',[input.customer.name,input.customer.phone,input.customer.email])
  const customer=(await db.query('SELECT id FROM customers WHERE phone=$1',[input.customer.phone])).rows[0]
  const order=(await db.query(`INSERT INTO orders (customer_id,customer_name,phone,email,delivery_method,address,comment,total_cents,analytics_session_hash,delivery_cents,delivery_snapshot,notifications_opt_in) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::text,total_cents`,[customer.id,input.customer.name,input.customer.phone,input.customer.email,input.delivery.method,input.delivery.address,input.comment,total,sessionHash,shipping.cents,JSON.stringify(shipping.snapshot),body.notifications_opt_in===true])).rows[0]
  for(const item of items)await db.query('INSERT INTO order_items (order_id,product_id,name,variant_name,sku,quantity,unit_cents) VALUES ($1,$2,$3,$4,$5,$6,$7)',[order.id,item.product_id,item.name,item.variant_name,item.sku,item.quantity,item.unit_cents])
  await db.query('INSERT INTO order_history (order_id,status,message) VALUES ($1,$2,$3)',[order.id,'new','Заказ оформлен. Товары списаны с доступного остатка.'])
  await orderEvent(db,order.id,'new')
  await db.query('UPDATE order_requests SET order_id=$1 WHERE request_id=$2',[order.id,body.request_id])
  await db.query('COMMIT');return receipt(order,body.request_id)
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export async function updateOrder(pool,orderId,body){
 if(!id(orderId)||!Number.isInteger(body?.revision)||typeof body.status!=='string'||!Object.hasOwn(orderStatuses,body.status)||typeof body.admin_note!=='string'||body.admin_note.length>5000)fail(400,'Некорректные данные заказа')
 const db=await pool.connect()
 try{
  await db.query('BEGIN')
  const row=(await db.query('SELECT id,status,revision,payment_state FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0]
  if(!row)fail(404,'Заказ не найден')
  if(row.revision!==body.revision)fail(409,'Заказ уже изменён. Обновите карточку.')
  if(body.status!==row.status&&!orderTransitions[row.status].includes(body.status))fail(409,'Этот переход статуса недоступен')
  const notes=[]
  if(body.status==='cancelled'&&row.status!=='cancelled'){
   if(row.payment_state==='paid')fail(409,'Сначала выполните возврат в платёжной системе и подтвердите его в карточке оплаты')
   const items=(await db.query('SELECT product_id,variant_name,quantity,name FROM order_items WHERE order_id=$1 ORDER BY product_id,variant_name',[orderId])).rows
   const ids=[...new Set(items.filter(x=>x.product_id).map(x=>String(x.product_id)))]
   const products=(await db.query('SELECT id,stock,variants FROM products WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[ids])).rows
   for(const item of items){
    const p=products.find(x=>String(x.id)===String(item.product_id)),v=item.variant_name?p?.variants.find(x=>x.name===item.variant_name):null
    if(!p||item.variant_name&&!v||!item.variant_name&&p.variants.length){notes.push('Проверьте остаток вручную: '+item.name+(item.variant_name?' — '+item.variant_name:''));continue}
    const source=v||p
    if(source.stock>2147483647-item.quantity){notes.push('Превышен предел остатка: '+item.name);continue}
    source.stock+=item.quantity
   }
   for(const p of products)await db.query('UPDATE products SET stock=$1,variants=$2,revision=revision+1,updated_at=NOW() WHERE id=$3',[p.stock,JSON.stringify(p.variants),p.id])
  }
  await db.query('UPDATE orders SET status=$1,admin_note=$2,revision=revision+1,updated_at=NOW() WHERE id=$3',[body.status,body.admin_note,orderId])
  await db.query('INSERT INTO order_history (order_id,status,message) VALUES ($1,$2,$3)',[orderId,body.status,[body.status===row.status?'Изменена заметка администратора.':'Статус: '+orderStatuses[body.status]+'.',...(body.status==='cancelled'&&row.status!=='cancelled'?['Остатки существующих товаров и вариантов возвращены.']:[]),...notes].join(' ')])
  if(body.status!==row.status)await orderEvent(db,orderId,'status')
  await db.query('COMMIT')
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
function paging(query){const page=Number(query?.page||1);if(!Number.isInteger(page)||page<1||page>10000)fail(400,'Некорректная страница');const search=query?.search||'';if(typeof search!=='string'||search.length>150)fail(400,'Слишком длинный поиск');return {page,search:search.trim(),offset:(page-1)*25}}
async function detail(pool,value){
 if(!id(value))fail(400,'Неверный номер заказа')
 const row=(await pool.query('SELECT *,id::text,customer_id::text FROM orders WHERE id=$1',[value])).rows[0];if(!row)fail(404,'Заказ не найден')
 const items=(await pool.query('SELECT id::text,product_id::text,name,variant_name,sku,quantity,unit_cents FROM order_items WHERE order_id=$1 ORDER BY id',[value])).rows.map(x=>({...x,unit_cents:Number(x.unit_cents)}))
 const history=(await pool.query('SELECT id::text,status,message,created_at FROM order_history WHERE order_id=$1 ORDER BY id DESC',[value])).rows
 return {...jsonOrder(row),items,history}
}
export function registerCommerce(app,pool,requireAdmin,{origins=[],attribute=async()=>null,receipt=publicReceipt}={}){
 let cleanAt=0
 const protect=handler=>async(req,reply)=>{try{return await handler(req,reply)}catch(e){if(e.commerce)return reply.code(e.statusCode).send({error:e.message});throw e}}
 app.post('/api/orders',{bodyLimit:16384,onRequest:async(req,reply)=>{
  if(req.headers['x-nova-checkout']!=='1'||req.headers.origin&&!origins.includes(req.headers.origin))return reply.code(403).send({error:'Запрос отклонён'})
  if(Date.now()>cleanAt){await pool.query('DELETE FROM order_throttle WHERE reset_at<=NOW()');cleanAt=Date.now()+60000}
  const r=await pool.query(`INSERT INTO order_throttle (key,attempts,reset_at) VALUES ($1,1,NOW()+INTERVAL '15 minutes') ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN order_throttle.reset_at<=NOW() THEN 1 ELSE order_throttle.attempts+1 END,reset_at=CASE WHEN order_throttle.reset_at<=NOW() THEN EXCLUDED.reset_at ELSE order_throttle.reset_at END WHERE order_throttle.attempts<10 OR order_throttle.reset_at<=NOW() RETURNING attempts`,[digest(req.ip)])
  if(!r.rowCount)return reply.header('Retry-After','900').code(429).send({error:'Слишком много оформлений. Повторите через 15 минут.'})
 }},protect(async(req,reply)=>reply.code(201).send(await createOrder(pool,req.body,{attribute,receipt}))))
 app.get('/api/admin/commerce/summary',{preHandler:requireAdmin},async()=>{
  const row=(await pool.query(`SELECT (SELECT COUNT(*)::int FROM orders) AS orders,(SELECT COUNT(*)::int FROM orders WHERE status='new') AS new_orders,(SELECT COUNT(*)::int FROM customers) AS customers,(SELECT COALESCE(SUM(total_cents),0)::text FROM orders WHERE status='completed') AS completed_cents`)).rows[0]
  return {...row,completed_cents:Number(row.completed_cents)}
 })
 app.get('/api/admin/orders',{preHandler:requireAdmin},protect(async(req)=>{
  const {page,search,offset}=paging(req.query),status=req.query.status||''
  if(status&&!Object.hasOwn(orderStatuses,status))fail(400,'Неизвестный статус')
  const params=[status,'%'+search+'%'],where=`WHERE ($1='' OR status=$1) AND (customer_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2 OR ('N'||CASE WHEN LENGTH(id::text)<6 THEN LPAD(id::text,6,'0') ELSE id::text END) ILIKE $2 OR id::text ILIKE $2)`
  const total=(await pool.query('SELECT COUNT(*)::int AS total FROM orders '+where,params)).rows[0].total
  const rows=(await pool.query('SELECT id::text,customer_id::text,customer_name,phone,status,payment_state,total_cents,created_at FROM orders '+where+' ORDER BY id DESC LIMIT 25 OFFSET $3',[...params,offset])).rows.map(jsonOrder)
  return {rows,total,page}
 }))
 app.get('/api/admin/orders/:id',{preHandler:requireAdmin},protect(req=>detail(pool,req.params.id)))
 app.put('/api/admin/orders/:id',{preHandler:requireAdmin,bodyLimit:12000},protect(async(req)=>{await updateOrder(pool,req.params.id,req.body);return detail(pool,req.params.id)}))
 app.get('/api/admin/customers',{preHandler:requireAdmin},protect(async(req)=>{
  const {page,search,offset}=paging(req.query),params=['%'+search+'%'],where='WHERE c.name ILIKE $1 OR c.phone ILIKE $1 OR c.email ILIKE $1'
  const total=(await pool.query('SELECT COUNT(*)::int AS total FROM customers c '+where,params)).rows[0].total
  const rows=(await pool.query(`SELECT c.id::text,c.name,c.phone,c.email,c.created_at,COUNT(o.id)::int AS orders_count,COALESCE(SUM(o.total_cents) FILTER(WHERE o.status<>'cancelled'),0)::text AS total_cents,MAX(o.created_at) AS last_order_at FROM customers c LEFT JOIN orders o ON o.customer_id=c.id ${where} GROUP BY c.id ORDER BY c.id DESC LIMIT 25 OFFSET $2`,[...params,offset])).rows.map(x=>({...x,total_cents:Number(x.total_cents)}))
  return {rows,total,page}
 }))
 app.get('/api/admin/customers/:id',{preHandler:requireAdmin},protect(async(req)=>{
  if(!id(req.params.id))fail(400,'Неверный ID покупателя')
  const row=(await pool.query('SELECT *,id::text FROM customers WHERE id=$1',[req.params.id])).rows[0];if(!row)fail(404,'Покупатель не найден')
  const {page,offset}=paging(req.query)
  const orders=(await pool.query('SELECT id::text,status,total_cents,created_at FROM orders WHERE customer_id=$1 ORDER BY id DESC LIMIT 25 OFFSET $2',[row.id,offset])).rows.map(jsonOrder)
  const stats=(await pool.query(`SELECT COUNT(*)::int AS orders_count,COALESCE(SUM(total_cents) FILTER(WHERE status<>'cancelled'),0)::text AS total_cents FROM orders WHERE customer_id=$1`,[row.id])).rows[0]
  return {...row,orders,page,orders_count:stats.orders_count,total_cents:Number(stats.total_cents)}
 }))
 app.put('/api/admin/customers/:id',{preHandler:requireAdmin,bodyLimit:12000},protect(async(req,reply)=>{
  const b=req.body
  if(!id(req.params.id)||!b||!Number.isInteger(b.revision)||typeof b.name!=='string'||!b.name.trim()||b.name.length>150||!normalizePhone(b.phone)||!validEmail(b.email)||typeof b.note!=='string'||b.note.length>5000)fail(400,'Проверьте имя, телефон, email и заметку (до 5000 символов)')
  try{const r=await pool.query('UPDATE customers SET name=$1,phone=$2,email=$3,note=$4,revision=revision+1,updated_at=NOW() WHERE id=$5 AND revision=$6 RETURNING id::text',[b.name.trim(),normalizePhone(b.phone),b.email.trim().toLowerCase(),b.note,req.params.id,b.revision]);if(!r.rowCount)fail(409,'Карточка изменилась. Обновите её.');return r.rows[0]}catch(e){if(e.code==='23505')return reply.code(409).send({error:'Этот телефон уже принадлежит другой карточке'});throw e}
 }))
}
