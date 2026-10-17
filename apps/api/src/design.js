import {defaultDesign,designValue,validateDesign} from '../../../shared/siteDesign.js'
export async function initDesign(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS site_design (id INTEGER PRIMARY KEY CHECK(id=1),draft JSONB NOT NULL,published JSONB NOT NULL,revision BIGINT NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`CREATE TABLE IF NOT EXISTS design_versions (id BIGSERIAL PRIMARY KEY,payload JSONB NOT NULL,action VARCHAR(20) NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query('INSERT INTO site_design (id,draft,published) VALUES (1,$1,$1) ON CONFLICT (id) DO NOTHING',[JSON.stringify(defaultDesign)])
 // Upgrade only untouched demo labels; preserve the owner's custom texts.
 for(const column of ['draft','published'])for(const [key,old] of [['checkout','Оформление скоро появится'],['cart_note','Демонстрационная корзина — оформление реальных заказов появится позже.']])await pool.query(`UPDATE site_design SET ${column}=jsonb_set(${column},$1,$2::jsonb) WHERE ${column}->'texts'->>$3=$4`,[['texts',key],JSON.stringify(defaultDesign.texts[key]),key,old])
}
const revision=value=>typeof value==='string'&&/^[1-9][0-9]{0,17}$/.test(value)
export function registerDesign(app,pool,requireAdmin){
 app.get('/api/design',async()=>designValue((await pool.query('SELECT published FROM site_design WHERE id=1')).rows[0].published))
 app.get('/api/design/style.css',async(req,reply)=>{const row=(await pool.query('SELECT published FROM site_design WHERE id=1')).rows[0];return reply.type('text/css; charset=utf-8').send(designValue(row.published).code.global_css)})
 app.get('/api/admin/design',{preHandler:requireAdmin},async()=>{const row=(await pool.query('SELECT draft,revision::text,updated_at FROM site_design WHERE id=1')).rows[0];return {...row,draft:designValue(row.draft)}})
 app.get('/api/admin/design/versions',{preHandler:requireAdmin},async()=>(await pool.query('SELECT id::text,action,created_at FROM design_versions ORDER BY id DESC LIMIT 30')).rows)
 app.get('/api/admin/design/versions/:id',{preHandler:requireAdmin},async(req,reply)=>{if(!revision(req.params.id))return reply.code(400).send({error:'Неверная версия'});const row=(await pool.query('SELECT payload FROM design_versions WHERE id=$1',[req.params.id])).rows[0];return row?designValue(row.payload):reply.code(404).send({error:'Версия не найдена'})})
 for(const action of ['save','publish'])app.route({method:action==='save'?'PUT':'POST',url:'/api/admin/design'+(action==='save'?'':'/publish'),bodyLimit:1152*1024,preHandler:requireAdmin,handler:async(req,reply)=>{
  if(!revision(req.body?.revision))return reply.code(400).send({error:'Укажите текущую версию оформления'})
  if(action==='save'){const error=validateDesign(req.body.draft);if(error)return reply.code(400).send({error})}
  const db=await pool.connect()
  try{
   await db.query('BEGIN')
   const row=(await db.query('SELECT draft,published,revision::text FROM site_design WHERE id=1 FOR UPDATE')).rows[0]
   if(row.revision!==req.body.revision){await db.query('ROLLBACK');return reply.code(409).send({error:'Оформление изменилось в другой вкладке. Скопируйте свой код и загрузите текущую версию.'})}
   const next=designValue(action==='save'?req.body.draft:row.draft)
   // The same row lock serializes media deletion with saving/publishing.
   if(next.hero_image_url)await db.query('SELECT nova_media_check($1)',[next.hero_image_url])
   await db.query('INSERT INTO design_versions (payload,action) VALUES ($1,$2)',[JSON.stringify(action==='save'?row.draft:row.published),action==='save'?'before-save':'before-publish'])
   const result=(await db.query(action==='save'?'UPDATE site_design SET draft=$1,revision=revision+1,updated_at=NOW() WHERE id=1 RETURNING draft,revision::text,updated_at':'UPDATE site_design SET published=$1,revision=revision+1,updated_at=NOW() WHERE id=1 RETURNING draft,revision::text,updated_at',[JSON.stringify(next)])).rows[0]
   await db.query('DELETE FROM design_versions WHERE id NOT IN (SELECT id FROM design_versions ORDER BY id DESC LIMIT 30)')
   await db.query('COMMIT');return {...result,draft:designValue(result.draft)}
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }})
}
