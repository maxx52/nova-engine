import {registerDesign} from './design.js'
import {registerCodeFrame} from './codeFrame.js'
import Fastify from 'fastify'
import {securityConfig,registerSecurity,publicErrorHandler,assertDatabaseRole} from './security.js'
import {registerUploads} from './uploads.js'
import {syncMedia,registerMedia} from './media.js'
import { registerAuth } from './auth.js'
import { registerBlog } from './blog.js'
import { registerSettings, registerShopGuard } from './settings.js'
import { registerPages } from './pages.js'
import multipart from '@fastify/multipart'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { pool, initDatabase, productJson } from './db.js'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
const security=securityConfig()
const app = Fastify({logger:{level:process.env.LOG_LEVEL||'info',serializers:{req:req=>({method:req.method,url:req.url?.split('?')[0],remoteAddress:req.ip})},redact:['req.headers.cookie','req.headers["x-admin-key"]','req.headers["x-csrf-token"]','password','setup_key','current_password','new_password']},trustProxy:security.trustProxy,bodyLimit:2*1024*1024,routerOptions:{maxParamLength:200},requestTimeout:15000,connectionTimeout:10000,keepAliveTimeout:5000})
app.server.headersTimeout=10000
registerSecurity(app,{secure:security.secure})
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files:1,fields:0,parts:1 } })
const uploadDirectory = process.env.UPLOAD_DIRECTORY?resolve(process.env.UPLOAD_DIRECTORY):fileURLToPath(new URL('../../../uploads/', import.meta.url))
await mkdir(uploadDirectory, { recursive: true })
const productFields = 'id,name,category,price,description,sku,stock,image_url,published,images,attributes,variants'
const adminKey = process.env.ADMIN_API_KEY
if (!adminKey || adminKey.length < 16) {
  console.error('Set ADMIN_API_KEY (at least 16 characters) in .env before starting API')
  process.exit(1)
}
const {requireAdmin,isAdmin}=registerAuth(app,pool,{setupKey:adminKey,secure:security.secure,origins:security.origins})
registerUploads(app,pool,requireAdmin,uploadDirectory)
registerMedia(app,pool,requireAdmin,uploadDirectory)
registerPages(app, pool, requireAdmin)
registerDesign(app,pool,requireAdmin)
registerCodeFrame(app)
registerSettings(app, pool, requireAdmin)
registerBlog(app, pool, requireAdmin)
registerShopGuard(app,pool,isAdmin)

function validateProduct(body) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) return 'Название: от 1 до 150 символов'
  if (typeof body.category !== 'string' || !body.category.trim() || body.category.trim().length > 100) return 'Укажите категорию'
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 9999999999.99) return 'Некорректная цена'
  if (typeof body.description !== 'string' || body.description.length > 20000) return 'Некорректное описание'
  if (body.sku !== undefined && (typeof body.sku !== 'string' || body.sku.length > 100)) return 'Некорректный артикул'
  if (body.stock !== undefined && (!Number.isSafeInteger(body.stock) || body.stock < 0)) return 'Некорректный остаток'
  if (body.published !== undefined && typeof body.published !== 'boolean') return 'Некорректный статус'
  if (body.image_url !== undefined && (typeof body.image_url !== 'string' || !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(body.image_url) && body.image_url !== '')) return 'Некорректное изображение'
  if(body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 12 || body.images.some(url => typeof url !== 'string' || !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(url)) || new Set(body.images).size !== body.images.length)) return 'Галерея: до 12 уникальных изображений'
  if(body.images && body.image_url && !body.images.includes(body.image_url)) return 'Главное фото должно быть в галерее'
  const attrs=body.attributes??[]
  if(!Array.isArray(attrs)||attrs.length>50||attrs.some(a=>!a||typeof a.name!=='string'||!a.name.trim()||a.name.length>80||typeof a.value!=='string'||!a.value.trim()||a.value.length>300))return 'Некорректные характеристики'
  const variants=body.variants??[]
  if(!Array.isArray(variants)||variants.length>100||variants.some(v=>!v||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||typeof v.sku!=='string'||v.sku.length>100||typeof v.price!=='number'||!Number.isFinite(v.price)||v.price<0||v.price>9999999999.99||!Number.isSafeInteger(v.stock)||v.stock<0))return 'Некорректные варианты товара'
  if(new Set(variants.map(v=>v.name.trim().toLowerCase())).size!==variants.length)return 'Названия вариантов должны быть уникальными'
  return null
}
app.get('/health', async () => {
  await pool.query('SELECT 1')
  return security.production?{status:'ok'}:{status:'ok',product:'NOVA Engine',version:'0.15.0',database:'connected'}
})
app.get('/api/products', async (request) => {
  const result = await pool.query('SELECT '+productFields+' FROM products'+(await isAdmin(request)?'':' WHERE published=TRUE')+' ORDER BY id')
  return result.rows.map(productJson)
})
app.get('/api/products/:id',async(request,reply)=>{const id=Number(request.params.id);if(!Number.isSafeInteger(id)||id<=0)return reply.code(400).send({error:'Неверный ID'});const result=await pool.query('SELECT '+productFields+' FROM products WHERE id=$1 AND published=TRUE',[id]);if(!result.rowCount)return reply.code(404).send({error:'Товар не найден'});return productJson(result.rows[0])})
app.post('/api/products', { preHandler: requireAdmin }, async (request, reply) => {
  const err = validateProduct(request.body)
  if (err) return reply.code(400).send({ error: err })
  const { name,category,price,description,sku='',stock=0,image_url='',published=true,images=image_url?[image_url]:[],attributes=[],variants=[] } = request.body
  const result = await pool.query('INSERT INTO products (name,category,price,description,sku,stock,image_url,published,images,attributes,variants) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING '+productFields,[name.trim(),category.trim(),price,description,sku,stock,image_url,published,JSON.stringify(images),JSON.stringify(attributes),JSON.stringify(variants)])
  return reply.code(201).send(productJson(result.rows[0]))
})
app.put('/api/products/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: 'Неверный ID' })
  const err = validateProduct(request.body)
  if (err) return reply.code(400).send({ error: err })
  const {name,category,price,description,sku='',stock=0,image_url='',published=true,images=image_url?[image_url]:[],attributes=[],variants=[]}=request.body
  const result = await pool.query('UPDATE products SET name=$1,category=$2,price=$3,description=$4,sku=$5,stock=$6,image_url=$7,published=$8,images=$9,attributes=$10,variants=$11,updated_at=NOW() WHERE id=$12 RETURNING '+productFields,[name.trim(),category.trim(),price,description,sku,stock,image_url,published,JSON.stringify(images),JSON.stringify(attributes),JSON.stringify(variants),id])
  if (!result.rowCount) return reply.code(404).send({error:'Товар не найден'})
  return productJson(result.rows[0])
})
app.delete('/api/products/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const id=Number(request.params.id)
  if (!Number.isSafeInteger(id) || id<=0) return reply.code(400).send({error:'Неверный ID'})
  const result=await pool.query('DELETE FROM products WHERE id=$1 RETURNING id',[id])
  if (!result.rowCount) return reply.code(404).send({error:'Товар не найден'})
  return reply.code(204).send()
})
function validTemplates(v){return Array.isArray(v)&&v.length<=50&&v.every(x=>typeof x==='string'&&x.trim()&&x.length<=80)&&new Set(v.map(x=>x.trim().toLowerCase())).size===v.length}
app.put('/api/categories/:id',{preHandler:requireAdmin},async(req,reply)=>{
 const id=Number(req.params.id),{name,parent_id=null,attribute_templates=[]}=req.body||{}
 if(!Number.isSafeInteger(id)||id<=0||typeof name!=='string'||!name.trim()||name.length>100||!validTemplates(attribute_templates))return reply.code(400).send({error:'Некорректные данные категории'})
 if(parent_id!==null&&(!Number.isSafeInteger(parent_id)||parent_id<=0))return reply.code(400).send({error:'Некорректный родитель'})
 if(parent_id===id)return reply.code(400).send({error:'Категория не может быть родителем самой себе'})
 if(parent_id!==null){const tree=await pool.query('WITH RECURSIVE descendants AS (SELECT id FROM categories WHERE id=$1 UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id) SELECT id FROM descendants',[id]);if(tree.rows.some(r=>Number(r.id)===parent_id))return reply.code(400).send({error:'Нельзя создать цикл категорий'})}
 try{const result=await pool.query('UPDATE categories SET name=$1,parent_id=$2,attribute_templates=$3 WHERE id=$4 RETURNING id,name,parent_id,attribute_templates',[name.trim(),parent_id,JSON.stringify(attribute_templates),id]);if(!result.rowCount)return reply.code(404).send({error:'Категория не найдена'});return {...result.rows[0],id:Number(result.rows[0].id),parent_id:result.rows[0].parent_id===null?null:Number(result.rows[0].parent_id)}}catch(e){if(e.code==='23505')return reply.code(409).send({error:'Название занято'});if(e.code==='23503')return reply.code(400).send({error:'Родитель не найден'});throw e}
})
app.get('/api/categories', async () => {
  const result = await pool.query('SELECT id,name,parent_id,attribute_templates FROM categories ORDER BY name')
  return result.rows.map(row => ({...row,id:Number(row.id),parent_id:row.parent_id===null?null:Number(row.parent_id)}))
})
app.post('/api/categories',{preHandler:requireAdmin},async(request,reply)=>{
  const { name,parent_id=null,attribute_templates=[] }=request.body || {}
  if(!validTemplates(attribute_templates))return reply.code(400).send({error:'Некорректные шаблоны характеристик'})
  if(typeof name!=='string'||!name.trim()||name.length>100) return reply.code(400).send({error:'Некорректное название категории'})
  if(parent_id!==null && (!Number.isSafeInteger(parent_id)||parent_id<=0)) return reply.code(400).send({error:'Некорректная родительская категория'})
  try{
    const result=await pool.query('INSERT INTO categories (name,parent_id,attribute_templates) VALUES ($1,$2,$3) RETURNING id,name,parent_id,attribute_templates',[name.trim(),parent_id,JSON.stringify(attribute_templates)])
    return reply.code(201).send({...result.rows[0],id:Number(result.rows[0].id)})
  }catch(e){
    if(e.code==='23505') return reply.code(409).send({error:'Такая категория уже существует'})
    if(e.code==='23503') return reply.code(400).send({error:'Родительская категория не найдена'})
    throw e
  }
})
app.setErrorHandler(publicErrorHandler)
try {
  if(security.production)await assertDatabaseRole(pool)
  await initDatabase()
  await syncMedia(pool,uploadDirectory)
  await app.listen({port:Number(process.env.PORT||3001),host:process.env.API_HOST||'127.0.0.1'})
} catch(error) {app.log.error(error);await pool.end();process.exit(1)}

export {app}
