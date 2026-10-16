import pg from 'pg'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
const { Pool } = pg
export const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://nova:nova_dev_password@localhost:5432/nova' })
const seeds = [
  ['Беспроводные наушники','Электроника',3490,'Компактная модель для музыки и звонков.'],
  ['Настольная лампа','Дом',2190,'Регулируемый свет для рабочего стола.'],
  ['Городской рюкзак','Аксессуары',4590,'Практичный рюкзак на каждый день.'],
  ['Термокружка','Дом',1390,'Сохраняет температуру напитка.'],
  ['Механическая клавиатура','Электроника',6990,'Для работы и игр.'],
  ['Органайзер для стола','Дом',990,'Порядок на рабочем месте.']
]
export async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(100) NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  const result = await pool.query('SELECT COUNT(*)::integer AS count FROM products')
  if(result.rows[0].count === 0) {
    for(const [name,category,price,description] of seeds)
      await pool.query('INSERT INTO products (name,category,price,description) VALUES ($1,$2,$3,$4)',[name,category,price,description])
  }
}
export function productJson(row) { return {...row,id:Number(row.id),price:Number(row.price)} }
