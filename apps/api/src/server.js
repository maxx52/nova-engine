import Fastify from 'fastify'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { pool, initDatabase, productJson } from './db.js'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
const app = Fastify({ logger: true })
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
  return null
}
app.get('/health', async () => {
  await pool.query('SELECT 1')
  return { status: 'ok', product: 'NOVA Engine', version: '0.3.0', database: 'connected' }
})
app.get('/api/products', async () => {
  const result = await pool.query('SELECT id,name,category,price,description FROM products ORDER BY id')
  return result.rows.map(productJson)
})
app.post('/api/products', { preHandler: requireAdmin }, async (request, reply) => {
  const err = validateProduct(request.body)
  if (err) return reply.code(400).send({ error: err })
  const { name,category,price,description } = request.body
  const result = await pool.query('INSERT INTO products (name,category,price,description) VALUES ($1,$2,$3,$4) RETURNING id,name,category,price,description',[name.trim(),category.trim(),price,description])
  return reply.code(201).send(productJson(result.rows[0]))
})
app.put('/api/products/:id', { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: 'Неверный ID' })
  const err = validateProduct(request.body)
  if (err) return reply.code(400).send({ error: err })
  const {name,category,price,description}=request.body
  const result = await pool.query('UPDATE products SET name=$1,category=$2,price=$3,description=$4,updated_at=NOW() WHERE id=$5 RETURNING id,name,category,price,description',[name.trim(),category.trim(),price,description,id])
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
try {
  await initDatabase()
  await app.listen({port:Number(process.env.PORT||3001),host:process.env.API_HOST||'127.0.0.1'})
} catch(error) {app.log.error(error);await pool.end();process.exit(1)}
