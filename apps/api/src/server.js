import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { fileTypeFromBuffer } from 'file-type'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { pool, initDatabase, productJson } from './db.js'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
const app = Fastify({ logger: true, bodyLimit: 6 * 1024 * 1024 })
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })
const uploadDirectory = fileURLToPath(new URL('../../../uploads/', import.meta.url))
await mkdir(uploadDirectory, { recursive: true })
const productFields = 'id,name,category,price,description,sku,stock,image_url,published'
const adminKey = process.env.ADMIN_API_KEY
if (!adminKey || adminKey.length < 16) {
  console.error('Set ADMIN_API_KEY (at least 16 characters) in .env before starting API')
  process.exit(1)
}
function requireAdmin(request, reply, done) {
  if (request.headers['x-admin-key'] !== adminKey) {
    reply.code(401).send({ error: 'Неверный ключ администратора' })
    return
  }
  done()
}
function validateProduct(body) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) return 'Название: от 1 до 150 символов'
  if (typeof body.category !== 'string' || !body.category.trim() || body.category.trim().length > 100) return 'Укажите категорию'
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 9999999999.99) return 'Некорректная цена'
  if (typeof body.description !== 'string' || body.description.length > 20000) return 'Некорректное описание'
  if (body.sku !== undefined && (typeof body.sku !== 'string' || body.sku.length > 100)) return 'Некорректный артикул'
  if (body.stock !== undefined && (!Number.isSafeInteger(body.stock) || body.stock < 0)) return 'Некорректный остаток'
  if (body.published !== undefined && typeof body.published !== 'boolean') return 'Некорректный статус'
  if (body.image_url !== undefined && (typeof body.image_url !== 'string' || !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(body.image_url) && body.image_url !== '')) return 'Некорректное изображение'
  return null
}
app.get('/health', async () => {
  await pool.query('SELECT 1')
  return { status: 'ok', product: 'NOVA Engine', version: '0.4.0', database: 'connected' }
})
app.get('/api/products', async () => {
  const result = await pool.query('SELECT '+productFields+' FROM products ORDER BY id')
  return result.rows.map(productJson)
})
app.post('/api/products', { preHandler: requireAdmin }, async (request, reply) => {
  const err = validateProduct(request.body)
  if (err) return reply.code(400).send({ error: err })
  const { name,category,price,description,sku='',stock=0,image_url='',published=true } = request.body
  const result = await pool.query('INSERT INTO products (name,category,price,description,sku,stock,image_url,published) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING '+productFields,[name.trim(),category.trim(),price,description,sku,stock,image_url,published])
  return reply.code(201).send(productJson(result.rows[0]))
})
app.put('/api/products/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: 'Неверный ID' })
  const err = validateProduct(request.body)
  if (err) return reply.code(400).send({ error: err })
  const {name,category,price,description,sku='',stock=0,image_url='',published=true}=request.body
  const result = await pool.query('UPDATE products SET name=$1,category=$2,price=$3,description=$4,sku=$5,stock=$6,image_url=$7,published=$8,updated_at=NOW() WHERE id=$9 RETURNING '+productFields,[name.trim(),category.trim(),price,description,sku,stock,image_url,published,id])
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
app.get('/api/categories', async () => {
  const result = await pool.query('SELECT id,name,parent_id FROM categories ORDER BY name')
  return result.rows.map(row => ({...row,id:Number(row.id),parent_id:row.parent_id===null?null:Number(row.parent_id)}))
})
app.post('/api/categories',{preHandler:requireAdmin},async(request,reply)=>{
  const { name,parent_id=null }=request.body || {}
  if(typeof name!=='string'||!name.trim()||name.length>100) return reply.code(400).send({error:'Некорректное название категории'})
  if(parent_id!==null && (!Number.isSafeInteger(parent_id)||parent_id<=0)) return reply.code(400).send({error:'Некорректная родительская категория'})
  try{
    const result=await pool.query('INSERT INTO categories (name,parent_id) VALUES ($1,$2) RETURNING id,name,parent_id',[name.trim(),parent_id])
    return reply.code(201).send({...result.rows[0],id:Number(result.rows[0].id)})
  }catch(e){
    if(e.code==='23505') return reply.code(409).send({error:'Такая категория уже существует'})
    if(e.code==='23503') return reply.code(400).send({error:'Родительская категория не найдена'})
    throw e
  }
})
app.get('/uploads/:filename',async(request,reply)=>{
  const {filename}=request.params
  if(!/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(filename)) return reply.code(404).send({error:'Файл не найден'})
  try {
    const bytes=await readFile(join(uploadDirectory,filename))
    const type=filename.endsWith('.png')?'image/png':filename.endsWith('.webp')?'image/webp':'image/jpeg'
    reply.header('Content-Type',type).header('X-Content-Type-Options','nosniff').header('Cache-Control','public, max-age=86400')
    return reply.send(bytes)
  }catch(e){if(e.code==='ENOENT') return reply.code(404).send({error:'Файл не найден'});throw e}
})
app.post('/api/uploads',{preHandler:requireAdmin},async(request,reply)=>{
  const file=await request.file()
  if(!file) return reply.code(400).send({error:'Файл не передан'})
  let data
  try { data=await file.toBuffer() }
  catch(e){if(e.code==='FST_REQ_FILE_TOO_LARGE')return reply.code(413).send({error:'Максимальный размер фото — 5 МБ'});throw e}
  const type=await fileTypeFromBuffer(data)
  const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[type?.mime]
  if(!ext) return reply.code(415).send({error:'Разрешены только JPG, PNG и WebP'})
  const name=randomUUID()+'.'+ext
  await writeFile(join(uploadDirectory,name),data,{flag:'wx'})
  return reply.code(201).send({url:'/uploads/'+name})
})
try {
  await initDatabase()
  await app.listen({port:Number(process.env.PORT||3001),host:process.env.API_HOST||'127.0.0.1'})
} catch(error) {app.log.error(error);await pool.end();process.exit(1)}
