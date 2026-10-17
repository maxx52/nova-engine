const imagePattern = /^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/
export {safeLink} from '../../../shared/contentSafety.js'
import {safeLink} from '../../../shared/contentSafety.js'
export function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length > 50 || JSON.stringify(sections).length>1000000) return 'Максимум 50 секций'
  const ids = new Set()
  for (const section of sections) {
    if (!section || typeof section.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(section.id) || ids.has(section.id)) return 'Некорректный идентификатор секции'
    ids.add(section.id)
    if(section.type==='code'){
      if(!section.code||typeof section.code!=='object'||['html','css','js'].some(key=>typeof section.code[key]!=='string'||section.code[key].length>100000))return 'Код секции: HTML, CSS и JavaScript до 100 000 символов каждый'
      continue
    }
    if (!['hero', 'text', 'image'].includes(section.type)) return 'Неизвестный тип секции'
    for (const [key, max] of [['title',300],['text',20000],['image_url',200],['alt',300],['caption',1000],['button_text',100],['button_url',2000]]) {
      if (typeof section[key] !== 'string' || section[key].length > max) return 'Некорректное поле секции: ' + key
    }
    if (section.image_url && !imagePattern.test(section.image_url)) return 'Некорректное изображение секции'
    if (!safeLink(section.button_url)) return 'Кнопка: используйте путь /about или адрес https://…'
    if (section.button_text && !section.button_url) return 'Укажите адрес кнопки'
  }
  return null
}
export function validatePage(body) {
  if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 150) return 'Заголовок: от 1 до 150 символов'
  if (typeof body.slug !== 'string' || body.slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) return 'Адрес: латинские буквы, цифры и дефисы'
  if (['api','uploads','product','admin','catalog','blog'].includes(body.slug)) return 'Этот адрес зарезервирован'
  if (typeof body.content !== 'string' || body.content.length > 100000) return 'Текст: до 100 000 символов'
  if (typeof body.published !== 'boolean') return 'Укажите статус публикации'
  if (body.sections !== undefined) return validateSections(body.sections)
  return null
}
export function registerPages(app, pool, requireAdmin) {
  const fields = 'id,title,slug,content,published,sections,updated_at'
  app.get('/api/admin/pages', { preHandler: requireAdmin }, async () => (await pool.query(`SELECT ${fields} FROM pages ORDER BY updated_at DESC,id DESC`)).rows)
  app.get('/api/pages', async () => (await pool.query('SELECT title,slug FROM pages WHERE published=TRUE ORDER BY title')).rows)
  app.get('/api/pages/:slug', async (req, reply) => {
    const result = await pool.query(`SELECT ${fields} FROM pages WHERE slug=$1 AND published=TRUE`, [req.params.slug])
    if (!result.rowCount) return reply.code(404).send({ error: 'Страница не найдена' })
    return result.rows[0]
  })
  for (const method of ['POST', 'PUT']) app.route({
    method, url: method === 'POST' ? '/api/admin/pages' : '/api/admin/pages/:id', preHandler: requireAdmin,
    handler: async (req, reply) => {
      if (method === 'PUT' && !/^[1-9][0-9]*$/.test(req.params.id)) return reply.code(400).send({ error: 'Неверный ID' })
      const error = validatePage(req.body)
      if (error) return reply.code(400).send({ error })
      const { title, slug, content, published, sections = [] } = req.body
      try {
        const args = [title.trim(), slug, content, published, JSON.stringify(sections)]
        const result = method === 'POST'
          ? await pool.query(`INSERT INTO pages (title,slug,content,published,sections) VALUES ($1,$2,$3,$4,$5) RETURNING ${fields}`, args)
          : await pool.query(`UPDATE pages SET title=$1,slug=$2,content=$3,published=$4,sections=$5,updated_at=NOW() WHERE id=$6 RETURNING ${fields}`, [...args, req.params.id])
        if (!result.rowCount) return reply.code(404).send({ error: 'Страница не найдена' })
        return reply.code(method === 'POST' ? 201 : 200).send(result.rows[0])
      } catch (e) {
        if (e.code === '23505') return reply.code(409).send({ error: 'Страница с таким адресом уже существует' })
        throw e
      }
    }
  })
  app.delete('/api/admin/pages/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (!/^[1-9][0-9]*$/.test(req.params.id)) return reply.code(400).send({ error: 'Неверный ID' })
    const result = await pool.query('DELETE FROM pages WHERE id=$1 RETURNING id', [req.params.id])
    return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: 'Страница не найдена' })
  })
}
