import pg from 'pg'
import {initMediaSchema} from './mediaSchema.js'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
const { Pool } = pg
export const pool = new Pool({max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,options:'-c statement_timeout=5000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000', connectionString: process.env.DATABASE_URL || 'postgres://nova:nova_dev_password@localhost:5432/nova' })
const seeds = [
  ['Беспроводные наушники','Электроника',3490,'Компактная модель для музыки и звонков.'],
  ['Настольная лампа','Дом',2190,'Регулируемый свет для рабочего стола.'],
  ['Городской рюкзак','Аксессуары',4590,'Практичный рюкзак на каждый день.'],
  ['Термокружка','Дом',1390,'Сохраняет температуру напитка.'],
  ['Механическая клавиатура','Электроника',6990,'Для работы и игр.'],
  ['Органайзер для стола','Дом',990,'Порядок на рабочем месте.']
]
export async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_accounts (
    id INTEGER PRIMARY KEY CHECK (id=1), username VARCHAR(64) NOT NULL UNIQUE, password_hash TEXT NOT NULL
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash VARCHAR(64) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    csrf_token VARCHAR(64) NOT NULL, expires_at TIMESTAMPTZ NOT NULL
  )`)
  await pool.query(`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_throttle (key VARCHAR(64) PRIMARY KEY,attempts INTEGER NOT NULL,reset_at TIMESTAMPTZ NOT NULL)`)
  await pool.query('CREATE INDEX IF NOT EXISTS auth_throttle_expiry_idx ON auth_throttle(reset_at)')
  await pool.query('CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at)')
  await pool.query(`CREATE TABLE IF NOT EXISTS pages (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await pool.query(`CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY CHECK (id=1),
    name VARCHAR(100) NOT NULL DEFAULT 'NOVA',
    logo_url TEXT NOT NULL DEFAULT '',
    home_page_id BIGINT REFERENCES pages(id) ON DELETE SET NULL,
    shop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    menu JSONB NOT NULL DEFAULT '[{"label":"Главная","url":"/"},{"label":"Каталог","url":"/catalog"}]'::jsonb
  )`)
  await pool.query(`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS blog_enabled BOOLEAN NOT NULL DEFAULT FALSE`)
  await pool.query(`CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY, title VARCHAR(200) NOT NULL, slug VARCHAR(120) NOT NULL UNIQUE,
    excerpt TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', category VARCHAR(100) NOT NULL DEFAULT '',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb, cover_url TEXT NOT NULL DEFAULT '', published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await pool.query('CREATE INDEX IF NOT EXISTS posts_publication_idx ON posts (published,published_at DESC,id DESC)')
  await pool.query('INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING')
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(100) NOT NULL,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(100) NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await pool.query(`UPDATE products SET images=jsonb_build_array(image_url) WHERE jsonb_array_length(images)=0 AND image_url<>''`)
  await pool.query(`CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
    parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await pool.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS attribute_templates JSONB NOT NULL DEFAULT '[]'::jsonb`)
  await pool.query(`INSERT INTO categories (name) SELECT DISTINCT category FROM products WHERE category <> '' ON CONFLICT (name) DO NOTHING`)
  const result = await pool.query('SELECT COUNT(*)::integer AS count FROM products')
  if(result.rows[0].count === 0) {
    for(const [name,category,price,description] of seeds)
      await pool.query('INSERT INTO products (name,category,price,description) VALUES ($1,$2,$3,$4)',[name,category,price,description])
  }
  await pool.query(`INSERT INTO categories (name) SELECT DISTINCT category FROM products WHERE category <> '' ON CONFLICT (name) DO NOTHING`)
  await initMediaSchema(pool)
}
export function productJson(row) { return {...row,id:Number(row.id),price:Number(row.price)} }
