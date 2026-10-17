import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {validatePackage,packageId,activeThemeFromPackage} from '../../../shared/themes.js'
import {defaultDesign,designValue,validateDesign} from '../../../shared/siteDesign.js'
const fail=(statusCode,message)=>{throw Object.assign(Error(message),{statusCode,theme:true})}
const kind=p=>p.format==='nova-theme'?'theme':'template'
const validKind=k=>['theme','template'].includes(k)
const meta=row=>({kind:row.kind,id:row.id,manifest:row.package.manifest,revision:row.revision,updated_at:row.updated_at,...(row.kind==='theme'?{slots:Object.keys(row.package.templates)}:{sections:row.package.page.sections.length})})
export async function initThemes(pool){await pool.query(`CREATE TABLE IF NOT EXISTS cms_packages(kind VARCHAR(16) NOT NULL CHECK(kind IN ('theme','template')),id VARCHAR(80) NOT NULL,package JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(kind,id))`)}
export function applyThemeDesign(current,p){
 const next=designValue(current),style=p.style
 for(const key of ['colors','visibility'])next[key]={...defaultDesign[key],...style[key]}
 for(const key of ['font','radius','width','home_order'])next[key]=structuredClone(style[key]??defaultDesign[key])
 next.code.global_css=style.site_css||'';next.code.enabled=false;next.theme=activeThemeFromPackage(p)
 return next
}
export function exportThemeDesign(draft){
 const d=designValue(draft);if(!d.theme)fail(409,'В черновике нет активной темы')
 return {format:'nova-theme',apiVersion:1,manifest:d.theme.manifest,style:{colors:d.colors,font:d.font,radius:d.radius,width:d.width,visibility:d.visibility,home_order:d.home_order,site_css:d.code.global_css},settings_schema:d.theme.settings_schema.map(f=>({...f,default:['form','image'].includes(f.type)?'':d.theme.settings[f.id]})),templates:d.theme.templates}
}
export async function applyInstalledTheme(pool,id,{design_revision,package_revision}){
 if(!packageId(id)||typeof design_revision!=='string'||! /^[1-9][0-9]{0,17}$/.test(design_revision)||!Number.isInteger(package_revision))fail(400,'Обновите тему и черновик перед применением')
 const db=await pool.connect();try{
  await db.query('BEGIN')
  const pack=(await db.query("SELECT package,revision FROM cms_packages WHERE kind='theme' AND id=$1 FOR SHARE",[id])).rows[0]
  if(!pack)fail(404,'Тема не установлена');if(pack.revision!==package_revision)fail(409,'Пакет темы изменился. Загрузите список заново.')
  const row=(await db.query('SELECT draft,revision::text FROM site_design WHERE id=1 FOR UPDATE')).rows[0]
  if(row.revision!==design_revision)fail(409,'Черновик оформления изменился. Загрузите его заново.')
  const next=applyThemeDesign(row.draft,pack.package),error=validateDesign(next);if(error)fail(400,error)
  await db.query("INSERT INTO design_versions(payload,action) VALUES($1,'before-theme')",[JSON.stringify(row.draft)])
  await db.query('UPDATE site_design SET draft=$1,revision=revision+1,updated_at=NOW() WHERE id=1',[JSON.stringify(next)])
  await db.query('DELETE FROM design_versions WHERE id NOT IN (SELECT id FROM design_versions ORDER BY id DESC LIMIT 30)')
  await db.query('COMMIT');return {draft:next,revision:String(BigInt(row.revision)+1n)}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export function registerThemes(app,pool,requireAdmin){
 const protect=handler=>async(req,reply)=>{try{return await handler(req,reply)}catch(e){if(e.theme)return reply.code(e.statusCode).send({error:e.message});throw e}}
 app.get('/api/admin/packages',{preHandler:requireAdmin},async()=>(await pool.query('SELECT kind,id,package,revision,updated_at FROM cms_packages ORDER BY kind,id')).rows.map(meta))
 app.get('/api/admin/packages/active-export',{preHandler:requireAdmin},protect(async()=>{
  const row=(await pool.query('SELECT draft FROM site_design WHERE id=1')).rows[0],p=exportThemeDesign(row.draft),error=validatePackage(p);if(error)fail(400,error);return p
 }))
 app.get('/api/admin/packages/examples',{preHandler:requireAdmin},async()=>{
  const paths=['themes/nova-studio/theme.nova.json','templates/contact-page/template.nova.json']
  return Promise.all(paths.map(async path=>JSON.parse(await readFile(fileURLToPath(new URL('../../../examples/'+path,import.meta.url)),'utf8'))))
 })
 app.get('/api/admin/packages/:kind/:id',{preHandler:requireAdmin},protect(async req=>{
  if(!validKind(req.params.kind)||!packageId(req.params.id))fail(400,'Некорректный пакет')
  const row=(await pool.query('SELECT kind,id,package,revision,updated_at FROM cms_packages WHERE kind=$1 AND id=$2',[req.params.kind,req.params.id])).rows[0];if(!row)fail(404,'Пакет не найден');return {...meta(row),package:row.package}
 }))
 app.post('/api/admin/packages',{preHandler:requireAdmin,bodyLimit:600*1024},protect(async(req,reply)=>{
  const p=req.body?.package,error=validatePackage(p);if(error)fail(400,error)
  const k=kind(p),id=p.manifest.id,db=await pool.connect();try{
   await db.query('BEGIN')
   // Serialize the small package catalog and enforce its upper bound across concurrent imports.
   await db.query('LOCK TABLE cms_packages IN SHARE ROW EXCLUSIVE MODE')
   const old=(await db.query('SELECT revision FROM cms_packages WHERE kind=$1 AND id=$2 FOR UPDATE',[k,id])).rows[0]
   if(old&&old.revision!==req.body.revision)fail(409,'Пакет уже установлен или изменился. Обновите список перед заменой.')
   if(!old&&(await db.query('SELECT COUNT(*)::int AS n FROM cms_packages')).rows[0].n>=50)fail(409,'Максимум 50 пакетов')
   const row=(await db.query('INSERT INTO cms_packages(kind,id,package) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET package=EXCLUDED.package,revision=cms_packages.revision+1,updated_at=NOW() RETURNING kind,id,package,revision,updated_at',[k,id,JSON.stringify(p)])).rows[0]
   await db.query('COMMIT');return reply.code(old?200:201).send(meta(row))
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }))
 app.post('/api/admin/themes/:id/apply',{preHandler:requireAdmin},protect(req=>applyInstalledTheme(pool,req.params.id,req.body||{})))
}
