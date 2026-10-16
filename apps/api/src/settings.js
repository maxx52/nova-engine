import { safeLink } from './pages.js'
export const defaultSettings = { name: 'NOVA', logo_url: '', home_page_id: null, shop_enabled: true, blog_enabled: false, menu: [{label:'Главная',url:'/'},{label:'Каталог',url:'/catalog'}] }
export function validateSettings(body) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) return 'Название: от 1 до 100 символов'
  if (typeof body.logo_url !== 'string' || (body.logo_url !== '' && !/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(body.logo_url))) return 'Некорректный логотип'
  if (typeof body.shop_enabled !== 'boolean') return 'Некорректный статус магазина'
  if (body.blog_enabled !== undefined && typeof body.blog_enabled !== 'boolean') return 'Некорректный статус блога'
  if (body.home_page_id !== null && (typeof body.home_page_id !== 'string' || !/^[1-9][0-9]{0,17}$/.test(body.home_page_id))) return 'Некорректная главная страница'
  if (!Array.isArray(body.menu) || body.menu.length > 20 || body.menu.some(item => !item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80 || typeof item.url !== 'string' || !item.url || item.url.length > 2000 || !safeLink(item.url))) return 'Меню: до 20 ссылок с названием и корректным адресом'
  return null
}
export async function readSettings(pool) {
  const result = await pool.query(`SELECT s.name,s.logo_url,s.home_page_id::text,s.shop_enabled,s.blog_enabled,s.menu,p.slug AS home_slug
    FROM site_settings s LEFT JOIN pages p ON p.id=s.home_page_id AND p.published=TRUE WHERE s.id=1`)
  return result.rows[0] || {...defaultSettings,home_slug:null}
}
export function registerSettings(app,pool,requireAdmin) {
  app.get('/api/settings', () => readSettings(pool))
  app.put('/api/admin/settings',{preHandler:requireAdmin},async(req,reply)=>{
    const error=validateSettings(req.body)
    if(error)return reply.code(400).send({error})
    const {name,logo_url,home_page_id,shop_enabled,menu}=req.body
    if(home_page_id!==null){
      const page=await pool.query('SELECT id FROM pages WHERE id=$1 AND published=TRUE',[home_page_id])
      if(!page.rowCount)return reply.code(400).send({error:'Выберите опубликованную страницу'})
    }
    try {
      await pool.query('UPDATE site_settings SET name=$1,logo_url=$2,home_page_id=$3,shop_enabled=$4,menu=$5,blog_enabled=COALESCE($6,blog_enabled) WHERE id=1',[name.trim(),logo_url,home_page_id,shop_enabled,JSON.stringify(menu),req.body.blog_enabled ?? null])
      return readSettings(pool)
    } catch(e) {
      if(e.code==='23503')return reply.code(409).send({error:'Главная страница удалена. Выберите другую.'})
      throw e
    }
  })
}

export function registerShopGuard(app,pool,isAdmin) {
  app.addHook('preHandler',async(request,reply)=>{
    if(request.method==='GET' && /^\/api\/(products|categories)(\/|$)/.test(request.url.split('?')[0]) && !await isAdmin(request)){
      const settings=await readSettings(pool)
      if(!settings.shop_enabled)return reply.code(404).send({error:'Магазин отключён'})
    }
  })
}
