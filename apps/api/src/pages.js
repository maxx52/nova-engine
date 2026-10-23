import {registerContentPublishing,allowEditorContentWrite} from './contentPublishing.js'
import {checkContentReferences} from './pageLibrary.js'
import {registerContentLifecycle,contentTransaction,contentRevision,contentConflict} from './contentLifecycle.js'
import {validateSeo,normalizedSeo} from '../../../shared/seo.js'
import {validateSections} from '../../../shared/pageSections.js'
export {validateSections} from '../../../shared/pageSections.js'
export {safeLink} from '../../../shared/contentSafety.js'
import {safeLink} from '../../../shared/contentSafety.js'
export function validatePage(body) {
  const seoError=validateSeo(body?.seo);if(seoError)return seoError
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 150) return 'Заголовок: от 1 до 150 символов'
  if (typeof body.slug !== 'string' || body.slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) return 'Адрес: латинские буквы, цифры и дефисы'
  if (['api','uploads','assets','product','admin','catalog','blog','health','order-status','account'].includes(body.slug)) return 'Этот адрес зарезервирован'
  if (typeof body.content !== 'string' || body.content.length > 100000) return 'Текст: до 100 000 символов'
  if (typeof body.published !== 'boolean') return 'Укажите статус публикации'
  if (body.sections !== undefined) return validateSections(body.sections)
  return null
}
export function registerPages(app, pool, requireAdmin) {
  const fields = 'id,title,slug,content,published,sections,updated_at,seo,revision::text,deleted_at'
  registerContentLifecycle(app,pool,requireAdmin,'pages')
  registerContentPublishing(app,pool,requireAdmin,'pages')
  app.get('/api/admin/pages', { preHandler: requireAdmin }, async req => (await pool.query(`SELECT ${fields} FROM pages WHERE deleted_at IS ${req.query.trash==='1'?'NOT NULL':'NULL'} ORDER BY updated_at DESC,id DESC`)).rows)
  app.get('/api/pages', async () => (await pool.query('SELECT title,slug FROM pages WHERE published=TRUE AND deleted_at IS NULL ORDER BY title')).rows)
  app.get('/api/pages/:slug', async (req, reply) => {
    const result = await pool.query(`SELECT ${fields} FROM pages WHERE slug=$1 AND published=TRUE AND deleted_at IS NULL`, [req.params.slug])
    if (!result.rowCount) return reply.code(404).send({ error: 'Страница не найдена' })
    return result.rows[0]
  })
  for (const method of ['POST', 'PUT']) app.route({
    method, url: method === 'POST' ? '/api/admin/pages' : '/api/admin/pages/:id', preHandler: requireAdmin,
    handler: async (req, reply) => {
      if (method === 'PUT' && !/^[1-9][0-9]*$/.test(req.params.id)) return reply.code(400).send({ error: 'Неверный ID' })
      if(method==='PUT'&&!contentRevision(req.body?.revision))return reply.code(400).send({error:'Укажите текущую версию записи'})
      const error = validatePage(req.body)
      if (error) return reply.code(400).send({ error })
      const { title, slug, content, published, sections = [] } = req.body
      try {
        const args = [title.trim(), slug, content, published, JSON.stringify(sections),(method==='PUT'&&req.body.seo===undefined?null:JSON.stringify(normalizedSeo(req.body.seo)))]
        return await contentTransaction(pool,req,reply,async (db,reply)=>{
        if(!await allowEditorContentWrite(db,req,reply,'pages'))return
        const missing=await checkContentReferences(db,req.body);if(missing)return reply.code(400).send({error:missing})
        const result = method === 'POST'
          ? await db.query(`INSERT INTO pages (title,slug,content,published,sections,seo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${fields}`, args)
          : await db.query(`UPDATE pages SET title=$1,slug=$2,content=$3,published=$4,sections=$5,seo=COALESCE($6::jsonb,seo),updated_at=NOW() WHERE id=$7 AND revision=$8 AND deleted_at IS NULL RETURNING ${fields}`, [...args, req.params.id,req.body.revision])
        if (!result.rowCount) return contentConflict(db,'pages',req.params.id,reply)
        return reply.code(method === 'POST' ? 201 : 200).send(result.rows[0])
        })
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: 'Страница с таким адресом уже существует' })
        throw e
      }
    }
  })
}
