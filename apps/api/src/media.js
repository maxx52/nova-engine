import {readdir,stat,unlink} from 'node:fs/promises'
import {join} from 'node:path'
export const mediaName=/^[a-f0-9-]{36}\.(png|jpg|webp)$/
export async function syncMedia(pool,directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(!entry.isFile()||!mediaName.test(entry.name))continue
  const info=await stat(join(directory,entry.name))
  await pool.query('INSERT INTO media_files (url,original_name,size,mime,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (url) DO NOTHING',['/uploads/'+entry.name,entry.name,info.size,entry.name.endsWith('.png')?'image/png':entry.name.endsWith('.webp')?'image/webp':'image/jpeg',info.mtime])
 }
 for(const row of (await pool.query('SELECT url FROM media_files WHERE deleted_at IS NOT NULL')).rows){if(!mediaName.test(row.url.slice('/uploads/'.length)))continue;try{await unlink(join(directory,row.url.slice('/uploads/'.length)))}catch(e){if(e.code!=='ENOENT')throw e}}
}
export async function mediaUsage(db,url){
 const result=await db.query(`SELECT 'product' AS type,id::text,name AS title FROM products WHERE image_url=$1 OR images ? $1 OR seo->>'image_url'=$1
 UNION ALL SELECT 'page',p.id::text,p.title FROM pages p WHERE p.seo->>'image_url'=$1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.sections) s WHERE s->>'image_url'=$1 OR nova_media_path(s->>'button_url')=$1 OR (s->>'type'='code' AND position($1 in s::text)>0))
 UNION ALL SELECT 'section',id::text,title FROM page_section_library WHERE position($1 in section::text)>0
 UNION ALL SELECT 'post',id::text,title FROM posts WHERE cover_url=$1 OR seo->>'image_url'=$1
 UNION ALL SELECT 'version',record_id::text,'История содержимого' FROM content_versions WHERE position($1 in snapshot::text)>0
 UNION ALL SELECT 'draft','0','Личный черновик' FROM content_drafts WHERE position($1 in payload::text)>0
 UNION ALL SELECT 'design',id::text,'Оформление сайта' FROM site_design WHERE position($1 in draft::text)>0 OR position($1 in published::text)>0
 UNION ALL SELECT 'seo',id::text,'SEO-настройки' FROM seo_settings WHERE config->'home'->>'image_url'=$1 OR config->'catalog'->>'image_url'=$1 OR config->'blog'->>'image_url'=$1
 UNION ALL SELECT 'settings',id::text,name FROM site_settings WHERE logo_url=$1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(menu) m WHERE nova_media_path(m->>'url')=$1)`,[url])
 return result.rows
}
export function registerMedia(app,pool,requireAdmin,directory){
 app.get('/api/admin/media',{preHandler:requireAdmin},async(req,reply)=>{
  const {q='',page='1'}=req.query
  if(typeof q!=='string'||q.length>200||typeof page!=='string'||!/^[1-9][0-9]{0,5}$/.test(page))return reply.code(400).send({error:'Некорректный поиск'})
  const total=(await pool.query("SELECT COUNT(*)::integer AS total FROM media_files WHERE deleted_at IS NULL AND position(lower($1) in lower(original_name||url))>0",[q])).rows[0].total
  const rows=(await pool.query("SELECT url,original_name,size,mime,created_at FROM media_files WHERE deleted_at IS NULL AND position(lower($1) in lower(original_name||url))>0 ORDER BY created_at DESC,url LIMIT 24 OFFSET $2",[q,(Number(page)-1)*24])).rows
  const items=await Promise.all(rows.map(async row=>({...row,usage:await mediaUsage(pool,row.url)})))
  return {items,total,page:Number(page)}
 })
 app.delete('/api/admin/media/:filename',{preHandler:requireAdmin},async(req,reply)=>{
  const {filename}=req.params
  if(!mediaName.test(filename))return reply.code(400).send({error:'Некорректный файл'})
  const url='/uploads/'+filename,client=await pool.connect()
  try{
   await client.query('BEGIN')
   const row=await client.query('SELECT url FROM media_files WHERE url=$1 AND deleted_at IS NULL FOR UPDATE',[url])
   if(!row.rowCount){await client.query('ROLLBACK');return reply.code(404).send({error:'Файл не найден'})}
   const usage=await mediaUsage(client,url)
   if(usage.length){await client.query('ROLLBACK');return reply.code(409).send({error:'Файл используется. Сначала уберите его из содержимого и сохраните изменения.',usage})}
   await client.query('UPDATE media_files SET deleted_at=NOW() WHERE url=$1',[url]);await client.query('COMMIT')
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  // Tombstones block serving and reuse immediately. Retry physical cleanup at startup.
  try{await unlink(join(directory,filename))}catch(e){if(e.code!=='ENOENT')app.log.warn({err:e},'Media cleanup deferred')}
  return reply.code(204).send()
 })
}
