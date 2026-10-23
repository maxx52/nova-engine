import {checkContentReferences} from './pageLibrary.js'
import {registerContentLifecycle,contentTransaction,contentRevision,contentConflict} from './contentLifecycle.js'
import {validateSeo,normalizedSeo} from '../../../shared/seo.js'
import { readSettings } from './settings.js'
export function validatePost(body) {
  const seoError=validateSeo(body?.seo);if(seoError)return seoError
  if (!body || typeof body.title!=='string' || !body.title.trim() || body.title.length>200) return 'Заголовок: от 1 до 200 символов'
  if (typeof body.slug!=='string' || body.slug.length>120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) return 'Адрес: латинские буквы, цифры и дефисы'
  for (const [field,max] of [['excerpt',1000],['content',100000],['category',100]]) if(typeof body[field]!=='string' || body[field].length>max) return 'Некорректное поле: '+field
  if(typeof body.cover_url!=='string' || (body.cover_url && !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(body.cover_url)))return 'Некорректная обложка'
  if(typeof body.published!=='boolean')return 'Некорректный статус публикации'
  if(!Array.isArray(body.tags) || body.tags.length>20 || body.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>60)||new Set(body.tags.map(t=>t.trim().toLowerCase())).size!==body.tags.length)return 'Теги: до 20 уникальных значений длиной до 60 символов'
  return null
}
export function registerBlog(app,pool,requireAdmin) {
 const fields='id::text,title,slug,excerpt,content,category,tags,cover_url,published,published_at,updated_at,seo,revision::text,deleted_at'
 async function enabled(req,reply){if(!(await readSettings(pool)).blog_enabled)return reply.code(404).send({error:'Блог отключён'})}
 registerContentLifecycle(app,pool,requireAdmin,'posts')
 app.get('/api/admin/posts',{preHandler:requireAdmin},async req=> (await pool.query(`SELECT ${fields} FROM posts WHERE deleted_at IS ${req.query.trash==='1'?'NOT NULL':'NULL'} ORDER BY updated_at DESC,id DESC`)).rows)
 app.get('/api/blog',{preHandler:enabled},async(req,reply)=>{
  const {page='1',category='',tag=''}=req.query
  if(typeof page!=='string'||!/^[1-9][0-9]{0,5}$/.test(page)||typeof category!=='string'||category.length>100||typeof tag!=='string'||tag.length>60)return reply.code(400).send({error:'Некорректный фильтр'})
  const values=[category,tag]
  const where="published=TRUE AND deleted_at IS NULL AND ($1='' OR category=$1) AND ($2='' OR tags ? $2)"
  const count=await pool.query(`SELECT COUNT(*)::integer AS total FROM posts WHERE ${where}`,values)
  const posts=await pool.query(`SELECT id::text,title,slug,excerpt,category,tags,cover_url,published_at FROM posts WHERE ${where} ORDER BY published_at DESC,id DESC LIMIT 12 OFFSET $3`,[...values,(Number(page)-1)*12])
  const facets=await pool.query('SELECT category,tags FROM posts WHERE published=TRUE AND deleted_at IS NULL')
  return {items:posts.rows,total:count.rows[0].total,page:Number(page),categories:[...new Set(facets.rows.map(p=>p.category).filter(Boolean))].sort(),tags:[...new Set(facets.rows.flatMap(p=>p.tags))].sort()}
 })
 app.get('/api/blog/:slug',{preHandler:enabled},async(req,reply)=>{
  const result=await pool.query(`SELECT ${fields} FROM posts WHERE slug=$1 AND published=TRUE AND deleted_at IS NULL`,[req.params.slug])
  if(!result.rowCount)return reply.code(404).send({error:'Статья не найдена'})
  return result.rows[0]
 })
 for(const method of ['POST','PUT'])app.route({method,url:'/api/admin/posts'+(method==='PUT'?'/:id':''),preHandler:requireAdmin,handler:async(req,reply)=>{
  if(method==='PUT'&&!/^[1-9][0-9]{0,17}$/.test(req.params.id))return reply.code(400).send({error:'Некорректный ID'})
  if(method==='PUT'&&!contentRevision(req.body?.revision))return reply.code(400).send({error:'Укажите текущую версию записи'})
  const error=validatePost(req.body);if(error)return reply.code(400).send({error})
  const {title,slug,excerpt,content,category,tags,cover_url,published}=req.body
  const args=[title.trim(),slug,excerpt,content,category.trim(),JSON.stringify(tags.map(t=>t.trim())),cover_url,published,(method==='PUT'&&req.body.seo===undefined?null:JSON.stringify(normalizedSeo(req.body.seo)))]
  try {
   return await contentTransaction(pool,req,reply,async (db,reply)=>{
        const missing=await checkContentReferences(db,req.body);if(missing)return reply.code(400).send({error:missing})
   const result=method==='POST'
    ? await db.query(`INSERT INTO posts (title,slug,excerpt,content,category,tags,cover_url,published,seo,published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8 THEN NOW() ELSE NULL END) RETURNING ${fields}`,args)
    : await db.query(`UPDATE posts SET title=$1,slug=$2,excerpt=$3,content=$4,category=$5,tags=$6,cover_url=$7,published=$8,seo=COALESCE($9::jsonb,seo),published_at=CASE WHEN $8 THEN COALESCE(published_at,NOW()) ELSE published_at END,updated_at=NOW() WHERE id=$10 AND revision=$11 AND deleted_at IS NULL RETURNING ${fields}`,[...args,req.params.id,req.body.revision])
   if(!result.rowCount)return contentConflict(db,'posts',req.params.id,reply)
   return reply.code(method==='POST'?201:200).send(result.rows[0])
   })
  }catch(e){if(e.code==='23505')return reply.code(409).send({error:'Статья с таким адресом уже существует'});throw e}
 }})
}
