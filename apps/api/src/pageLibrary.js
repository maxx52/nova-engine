import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {validateSections} from '../../../shared/pageSections.js'
import {httpHeaders} from '../../../config/httpHeaders.js'
export async function initPageLibrary(db){await db.query(`CREATE TABLE IF NOT EXISTS page_section_library(id UUID PRIMARY KEY,title VARCHAR(150) NOT NULL,section JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)}
export async function checkContentReferences(db,value){
 const text=JSON.stringify(value),images=[...new Set(text.match(/\/uploads\/[a-f0-9-]{36}\.(?:png|jpg|webp)/g)||[])]
 for(const path of images){const r=await db.query('SELECT url FROM media_files WHERE url=$1 AND deleted_at IS NULL FOR SHARE',[path]);if(!r.rowCount)return 'Изображение отсутствует в медиатеке: '+path}
 const sections=Array.isArray(value)?value:value.sections||[]
 for(const s of sections)if(s.type==='form'&&!(await db.query('SELECT id FROM contact_forms WHERE id=$1 FOR SHARE',[s.form_id])).rowCount)return 'Форма не найдена: '+s.form_id
 return null
}
export function registerPageLibrary(app,db,requireAdmin,{template=()=>readFile(new URL(process.env.NODE_ENV==='production'?'../../admin/dist/preview.html':'../../admin/preview.html',import.meta.url),'utf8')}={}){
 app.get('/api/admin/pages/section-library',{preHandler:requireAdmin},async()=> (await db.query("SELECT id,title,section->>'type' AS type,created_at FROM page_section_library ORDER BY created_at DESC,id LIMIT 200")).rows)
 app.get('/api/admin/pages/section-library/:id',{preHandler:requireAdmin},async(req,reply)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.params.id))return reply.code(400).send({error:'Неверный ID'});const r=await db.query('SELECT id,title,section FROM page_section_library WHERE id=$1',[req.params.id]);return r.rowCount?r.rows[0]:reply.code(404).send({error:'Секция не найдена'})})
 app.post('/api/admin/pages/section-library',{preHandler:requireAdmin,bodyLimit:1100000},async(req,reply)=>{
  const b=req.body,error=typeof b?.title!=='string'||!b.title.trim()||b.title.length>150||b.title.includes('\0')?'Название: от 1 до 150 символов':validateSections([b.section]);if(error)return reply.code(400).send({error})
  const c=await db.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(724103)');if(Number((await c.query('SELECT COUNT(*) AS n FROM page_section_library')).rows[0].n)>=200){await c.query('ROLLBACK');return reply.code(409).send({error:'В библиотеке уже 200 секций'})}const missing=await checkContentReferences(c,[b.section]);if(missing){await c.query('ROLLBACK');return reply.code(400).send({error:missing})}const r=await c.query('INSERT INTO page_section_library(id,title,section) VALUES($1,$2,$3::jsonb) RETURNING id,title,section,created_at',[randomUUID(),b.title.trim(),JSON.stringify(b.section)]);await c.query('COMMIT');return reply.code(201).send(r.rows[0])}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 })
 app.delete('/api/admin/pages/section-library/:id',{preHandler:requireAdmin},async(req,reply)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(req.params.id))return reply.code(400).send({error:'Неверный ID'});const r=await db.query('DELETE FROM page_section_library WHERE id=$1 RETURNING id',[req.params.id]);return r.rowCount?reply.code(204).send():reply.code(404).send({error:'Секция не найдена'})})
 app.get('/api/admin/pages/preview-frame',{preHandler:requireAdmin,config:{novaCodeFrame:true}},async(req,reply)=>{let html;try{html=await template()}catch{return reply.code(503).send({error:'Соберите админку для предпросмотра'})}return reply.type('text/html; charset=utf-8').header('Content-Security-Policy',httpHeaders()['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'")).header('X-Frame-Options','SAMEORIGIN').header('X-Robots-Tag','noindex, nofollow').send(html)})
}
