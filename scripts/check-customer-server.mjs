// CI-only fixture. Copied explicitly into the disposable container; never loaded by server.js.
// A separate database and a capturing mail transport prevent any outbound email.
import Fastify from 'fastify'
import {readFile} from 'node:fs/promises'
import {registerCustomerAccounts} from './apps/api/src/customerAccounts.js'
import {registerCommerce} from './apps/api/src/commerce.js'
import {registerSettings} from './apps/api/src/settings.js'
import {registerSeo} from './apps/api/src/seo.js'
import {registerSecurity,publicErrorHandler} from './apps/api/src/security.js'
import {designValue} from './shared/siteDesign.js'
import {fulfillmentConfig} from './apps/api/src/fulfillment.js'
const connection=new URL(process.env.DATABASE_URL);connection.pathname='/nova_customer_ci';process.env.DATABASE_URL=connection.href
const {pool,initDatabase}=await import('./apps/api/src/db.js')
await initDatabase();await pool.query('UPDATE products SET stock=20,price=10 WHERE id=1')
const app=Fastify(),messages=[],origin='http://127.0.0.1:5175'
registerSecurity(app,{perIp:2000});app.setErrorHandler(publicErrorHandler)
const deny=async(req,reply)=>reply.code(403).send({error:'CI fixture'})
const accounts=registerCustomerAccounts(app,pool,{secret:process.env.ADMIN_API_KEY,origins:[origin],mailSettings:async()=>({config:{enabled:true,email:{enabled:true,mode:'smtp',host:'smtp.example.com',from:'shop@example.com',to:['owner@example.com'],user:'shop'}},secrets:{smtp_password:'disposable-only'}}),send:async(config,message)=>{messages.push({email:config.email.to[0],code:message.values.code});return {}}})
registerCommerce(app,pool,deny,{origins:[origin],customerCheckout:accounts.checkout});registerSettings(app,pool,deny)
app.get('/api/design',async()=>designValue());app.get('/api/design/style.css',async(req,reply)=>reply.type('text/css').send(''))
app.get('/api/products',async()=>{const r=await pool.query('SELECT * FROM products WHERE published=TRUE ORDER BY id');return r.rows.map(p=>({...p,id:Number(p.id),price:Number(p.price)}))})
app.get('/api/categories',async()=>[]);app.get('/api/payments/config',async()=>({enabled:false}));app.get('/api/shipping',async()=>{const s=await fulfillmentConfig(pool);return {options:s.config.options,revision:s.revision}})
app.get('/__test/messages',async()=>messages)
app.post('/__test/price',async()=>{await pool.query('UPDATE products SET price=15,stock=1 WHERE id=1');return {ok:true}})
app.get('/assets/:name',async(req,reply)=>{if(!/^[a-zA-Z0-9_.-]+$/.test(req.params.name))return reply.code(404).send();const ext=req.params.name.split('.').pop();return reply.type(({js:'text/javascript',css:'text/css',woff2:'font/woff2',woff:'font/woff',ttf:'font/ttf'})[ext]||'application/octet-stream').send(await readFile(new URL('./apps/storefront/dist/assets/'+req.params.name,import.meta.url)))})
registerSeo(app,pool,deny,{fallbackOrigin:origin,template:()=>readFile(new URL('./apps/storefront/dist/index.html',import.meta.url),'utf8')})
await app.listen({port:3002,host:'0.0.0.0'})
