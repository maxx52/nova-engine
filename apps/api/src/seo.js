import {readFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {readSettings} from './settings.js'
import {seoPath,protectedSeoPath,validateSeo,normalizedSeo,escapeHtml as esc,jsonLd} from '../../../shared/seo.js'
export async function initSeo(db){
 for(const table of ['pages','products','posts'])await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS seo JSONB NOT NULL DEFAULT '{}'::jsonb`)
 await db.query(`CREATE TABLE IF NOT EXISTS seo_settings(id INTEGER PRIMARY KEY CHECK(id=1),config JSONB NOT NULL DEFAULT '{}'::jsonb,revision BIGINT NOT NULL DEFAULT 1)`)
 await db.query('INSERT INTO seo_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING')
 await db.query(`CREATE TABLE IF NOT EXISTS seo_redirects(id BIGSERIAL PRIMARY KEY,source TEXT NOT NULL UNIQUE,target TEXT NOT NULL,status INTEGER NOT NULL CHECK(status IN(301,302,307,308)),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
}
export function validateSeoSettings(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['site_url','description','indexing','disallow','home','catalog','blog'].includes(k)))return 'Некорректные SEO-настройки'
 if(typeof s.site_url!=='string'||s.site_url.length>500)return 'Укажите основной адрес сайта'
 if(s.site_url){try{const u=new URL(s.site_url);if(u.protocol!=='https:'||u.origin!==s.site_url||u.username||u.password)throw Error()}catch{return 'Адрес сайта: https://example.ru без пути и завершающего слеша'}}
 if(typeof s.description!=='string'||s.description.length>500||typeof s.indexing!=='boolean'||!Array.isArray(s.disallow)||s.disallow.length>100||s.disallow.some(p=>!seoPath(p)))return 'Проверьте описание, индексацию и запрещённые пути'
 for(const k of ['home','catalog','blog']){const error=validateSeo(s[k]);if(error)return error}
 return null
}
export function redirectCycle(rows,source,target){const map=new Map(rows.map(r=>[r.source,r.target]));map.set(source,target);const seen=new Set();let node=source;while(map.has(node)){if(seen.has(node))return true;seen.add(node);node=map.get(node)}return false}
const defaults=()=>({site_url:'',description:'',indexing:true,disallow:[],home:{},catalog:{},blog:{}})
export async function seoConfig(db,fallback){const r=(await db.query('SELECT config,revision::text FROM seo_settings WHERE id=1')).rows[0];const config={...defaults(),...r?.config};return {config,revision:r?.revision||'1',origin:config.site_url||fallback}}
const plain=value=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
const summary=value=>plain(value).slice(0,300)
const crumb=(origin,items)=>({'@type':'BreadcrumbList',itemListElement:items.map(([name,path],i)=>({'@type':'ListItem',position:i+1,name,item:origin+path}))})
export async function resolveSeo(db,raw,{fallbackOrigin}={}){
 const input=new URL(raw,'https://nova.invalid'),path=seoPath(input.pathname)
 if(path==='/account')return {status:200,metadata:{title:'Личный кабинет покупателя',description:'',robots:'noindex, nofollow',canonical:'',graph:[]},content:'<h1>Личный кабинет покупателя</h1>'}
 if(!path||protectedSeoPath(path))return {status:404,metadata:{title:'Страница не найдена',description:'',robots:'noindex, nofollow',canonical:'',graph:[]},content:'<h1>Страница не найдена</h1>'}
 if(path==='/order-status')return {status:200,metadata:{title:'Статус заказа',description:'',robots:'noindex, nofollow',canonical:'',graph:[]},content:'<h1>Статус заказа</h1>'}
 const {config,origin}=await seoConfig(db,fallbackOrigin),site=await readSettings(db)
 const redirect=(await db.query('SELECT target,status FROM seo_redirects WHERE source=$1',[path])).rows[0];if(redirect)return {status:redirect.status,redirect:redirect.target}
 let row=null,seo={},title=site.name,description=config.description,image='',type='website',status=200,canonicalPath=path,content='',graph=[],items=[]
 const node={'@type':'Organization','@id':origin+'/#organization',name:site.name,url:origin+'/',...(site.logo_url?{logo:origin+site.logo_url}:{})}
 if(path==='/'){
  if(site.home_page_id){row=(await db.query('SELECT * FROM pages WHERE id=$1 AND published=TRUE AND deleted_at IS NULL',[site.home_page_id])).rows[0]||null}
  seo={...row?.seo,...config.home,title:config.home.title||row?.seo?.title||'',description:config.home.description||row?.seo?.description||'',noindex:!!(row?.seo?.noindex||config.home.noindex),nofollow:!!(row?.seo?.nofollow||config.home.nofollow)};title=row?.title||site.name;description=summary(row?.content)||description
  content=row?`<h1>${esc(row.title)}</h1><p>${esc(row.content)}</p>`:`<h1>${esc(site.name)}</h1><p>${esc(description)}</p>`
  graph=[node,{'@type':'WebSite',name:site.name,url:origin+'/'}]
 }else if(path==='/catalog'&&site.shop_enabled){
  seo=config.catalog;title='Каталог';const products=(await db.query('SELECT id,name FROM products WHERE published=TRUE ORDER BY id LIMIT 100')).rows
  content='<h1>Каталог</h1><ul>'+products.map(p=>`<li><a href="/product/${p.id}">${esc(p.name)}</a></li>`).join('')+'</ul>';items=[['Главная','/'],['Каталог',path]]
 }else if(/^\/product\/[1-9]\d{0,17}$/.test(path)&&site.shop_enabled){
  row=(await db.query('SELECT * FROM products WHERE id=$1 AND published=TRUE',[path.split('/')[2]])).rows[0]||null
  if(row){seo=row.seo;title=row.name;description=summary(row.description);image=row.image_url||row.images?.[0]||'';type='product';content=`<h1>${esc(title)}</h1><p>${esc(row.description)}</p>`
   const offer=(p)=>({'@type':'Offer',url:origin+path,price:Number(p.price).toFixed(2),priceCurrency:'RUB',availability:'https://schema.org/'+(p.stock>0?'InStock':'OutOfStock')})
   // Each variant is an actual choice offered by this shop; do not invent
   // review scores, merchant alternatives or variant attributes we do not store.
   graph=[{'@type':'Product',name:row.name,description:plain(row.description),...(row.sku?{sku:row.sku}:{}),...(row.images?.length?{image:row.images.map(p=>origin+p)}:image?{image:[origin+image]}:{}),offers:row.variants?.length?row.variants.map(v=>({...offer(v),name:v.name,...(v.sku?{sku:v.sku}:{})})):offer(row)}]
   content+=(row.variants?.length?'<ul>'+row.variants.map(v=>'<li>'+esc(v.name)+': '+esc(Number(v.price).toFixed(2))+' RUB — '+(v.stock>0?'В наличии':'Нет в наличии')+'</li>').join('')+'</ul>':'');content+='<p>Цена: '+esc(row.variants?.length?Math.min(...row.variants.map(v=>Number(v.price))):Number(row.price))+' RUB</p>';items=[['Главная','/'],['Каталог','/catalog'],[title,path]]
  }else status=404
 }else if(path==='/blog'&&site.blog_enabled){
  seo=config.blog;title='Блог';const page=Number(input.searchParams.get('page')||1)
  if(!Number.isSafeInteger(page)||page<1||page>100000)status=404
  else{const posts=(await db.query('SELECT title,slug FROM posts WHERE published=TRUE AND deleted_at IS NULL ORDER BY published_at DESC,id DESC LIMIT 12 OFFSET $1',[(page-1)*12])).rows;if(page>1&&!posts.length)status=404;if(page>1){canonicalPath+='?page='+page;title+=' — страница '+page}content='<h1>'+esc(title)+'</h1><ul>'+posts.map(p=>`<li><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></li>`).join('')+'</ul>';items=[['Главная','/'],['Блог','/blog']]}
 }else if(/^\/blog\/[a-z0-9-]+$/.test(path)&&site.blog_enabled){
  row=(await db.query('SELECT * FROM posts WHERE slug=$1 AND published=TRUE AND deleted_at IS NULL',[path.slice(6)])).rows[0]||null
  if(row){seo=row.seo;title=row.title;description=summary(row.excerpt||row.content);image=row.cover_url;type='article';content=`<h1>${esc(title)}</h1><p>${esc(row.content)}</p>`;graph=[{'@type':'BlogPosting',headline:row.title,description,...(image?{image:origin+image}:{}),datePublished:new Date(row.published_at).toISOString(),dateModified:new Date(row.updated_at).toISOString(),publisher:{'@id':node['@id']}}];items=[['Главная','/'],['Блог','/blog'],[title,path]]}else status=404
 }else if(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)){
  row=(await db.query('SELECT * FROM pages WHERE slug=$1 AND published=TRUE AND deleted_at IS NULL',[path.slice(1)])).rows[0]||null
  if(row){seo=row.seo;title=row.title;description=summary(row.content);content=`<h1>${esc(title)}</h1><p>${esc(row.content)}</p>`;if(String(row.id)===site.home_page_id)canonicalPath='/';for(const section of row.sections||[])if(['hero','text'].includes(section.type))content+=`<section><h2>${esc(section.title)}</h2><p>${esc(section.text)}</p></section>`;items=[['Главная','/'],[title,path]]}else status=404
 }else status=404
 seo=normalizedSeo(seo)
 if(status===404){title='Страница не найдена';description='Запрошенная страница недоступна.';content='<h1>Страница не найдена</h1><a href="/">На главную</a>';graph=[];items=[]}
 else if(!graph.length)graph=[{'@type':'WebPage',name:title,url:origin+canonicalPath}]
 if(items.length)graph.push(crumb(origin,items))
 if(type==='article')graph.unshift(node)
 const robots=[!config.indexing||seo.noindex||status!==200||[...input.searchParams.keys()].some(k=>!['page','utm_source','utm_medium','utm_campaign','utm_term','utm_content','yclid','gclid'].includes(k))?'noindex':'index',seo.nofollow||status!==200?'nofollow':'follow'].join(', ')
 const canonical=status===200?origin+(seo.canonical_path||canonicalPath):''
 return {status,content,metadata:{title:status===200?(seo.title||title+(title===site.name?'':' — '+site.name)):title,description:status===200?(seo.description||description):description,canonical,robots,image:status===200&&(seo.image_url||image)?origin+(seo.image_url||image):'',type,site_name:site.name,graph:status===200?{'@context':'https://schema.org','@graph':graph}:null}}
}
export function seoHead(m,nonce){return `<title>${esc(m.title)}</title><meta name="description" content="${esc(m.description)}" data-nova-seo><meta name="robots" content="${esc(m.robots)}" data-nova-seo>${m.canonical?`<link rel="canonical" href="${esc(m.canonical)}" data-nova-seo>`:''}<meta property="og:title" content="${esc(m.title)}" data-nova-seo><meta property="og:description" content="${esc(m.description)}" data-nova-seo><meta property="og:type" content="${m.type==='article'?'article':m.type==='product'?'product':'website'}" data-nova-seo><meta property="og:site_name" content="${esc(m.site_name)}" data-nova-seo>${m.canonical?`<meta property="og:url" content="${esc(m.canonical)}" data-nova-seo>`:''}${m.image?`<meta property="og:image" content="${esc(m.image)}" data-nova-seo>`:''}<meta name="twitter:card" content="${m.image?'summary_large_image':'summary'}" data-nova-seo>${m.graph?`<script type="application/ld+json" nonce="${nonce}" data-nova-seo>${jsonLd(m.graph)}</script>`:''}`}
const publicUrls=`SELECT '/' AS path,NULL::timestamptz AS updated_at FROM site_settings WHERE id=1
 UNION ALL SELECT '/catalog',NULL::timestamptz FROM site_settings WHERE id=1 AND shop_enabled
 UNION ALL SELECT '/blog',NULL::timestamptz FROM site_settings WHERE id=1 AND blog_enabled
 UNION ALL SELECT '/'||p.slug,p.updated_at FROM pages p JOIN site_settings s ON s.id=1 WHERE p.published AND p.slug<>'account' AND p.deleted_at IS NULL AND (s.home_page_id IS NULL OR p.id<>s.home_page_id) AND COALESCE((p.seo->>'noindex')::boolean,FALSE)=FALSE AND COALESCE(p.seo->>'canonical_path','') IN ('','/'||p.slug)
 UNION ALL SELECT '/product/'||p.id,p.updated_at FROM products p JOIN site_settings s ON s.id=1 WHERE s.shop_enabled AND p.published AND COALESCE((p.seo->>'noindex')::boolean,FALSE)=FALSE AND COALESCE(p.seo->>'canonical_path','') IN ('','/product/'||p.id)
 UNION ALL SELECT '/blog/'||p.slug,p.updated_at FROM posts p JOIN site_settings s ON s.id=1 WHERE s.blog_enabled AND p.published AND p.deleted_at IS NULL AND COALESCE((p.seo->>'noindex')::boolean,FALSE)=FALSE AND COALESCE(p.seo->>'canonical_path','') IN ('','/blog/'||p.slug)`
export function registerSeo(app,db,requireAdmin,{fallbackOrigin='http://localhost:5173',template=()=>readFile(new URL('../../storefront/dist/index.html',import.meta.url),'utf8')}={}){
 const base=new URL(fallbackOrigin);if(!['http:','https:'].includes(base.protocol)||base.origin!==fallbackOrigin)throw Error('PUBLIC_SITE_URL must be an HTTP(S) origin without a path')
 app.get('/api/admin/seo',{preHandler:requireAdmin},async()=>{const s=await seoConfig(db,fallbackOrigin);return {...s,redirects:(await db.query('SELECT id::text,source,target,status FROM seo_redirects ORDER BY id DESC LIMIT 10000')).rows}})
 app.put('/api/admin/seo',{preHandler:requireAdmin,bodyLimit:16000},async(req,reply)=>{const error=validateSeoSettings(req.body?.config);if(error)return reply.code(400).send({error});if(!/^[1-9]\d{0,17}$/.test(req.body?.revision||''))return reply.code(409).send({error:'Обновите настройки перед сохранением'});const r=await db.query('UPDATE seo_settings SET config=$1::jsonb,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision',[JSON.stringify(req.body.config),req.body.revision]);if(!r.rowCount)return reply.code(409).send({error:'Настройки уже изменены. Обновите раздел.'});return seoConfig(db,fallbackOrigin)})
 app.post('/api/admin/seo/redirects',{preHandler:requireAdmin,bodyLimit:5000},async(req,reply)=>{
  const source=seoPath(req.body?.source),target=seoPath(req.body?.target),status=req.body?.status
  if(!source||!target||protectedSeoPath(source)||protectedSeoPath(target)||![301,302,307,308].includes(status))return reply.code(400).send({error:'Укажите внутренние адреса без query-параметров и код редиректа'})
  const client=await db.connect();try{await client.query('BEGIN');await client.query('LOCK TABLE seo_redirects IN SHARE ROW EXCLUSIVE MODE');const rows=(await client.query('SELECT source,target FROM seo_redirects')).rows;if(rows.length>=10000)return await client.query('ROLLBACK'),reply.code(400).send({error:'Достигнут лимит 10 000 редиректов'});if(redirectCycle(rows,source,target))return await client.query('ROLLBACK'),reply.code(400).send({error:'Редирект создаёт цикл'});const r=await client.query('INSERT INTO seo_redirects(source,target,status) VALUES($1,$2,$3) RETURNING id::text,source,target,status',[source,target,status]);await client.query('COMMIT');return reply.code(201).send(r.rows[0])}catch(e){await client.query('ROLLBACK');if(e.code==='23505')return reply.code(409).send({error:'Для этого адреса уже есть редирект'});throw e}finally{client.release()}
 })
 app.delete('/api/admin/seo/redirects/:id',{preHandler:requireAdmin},async(req,reply)=>{if(!/^[1-9]\d{0,17}$/.test(req.params.id))return reply.code(400).send({error:'Некорректный ID'});const r=await db.query('DELETE FROM seo_redirects WHERE id=$1 RETURNING id',[req.params.id]);return r.rowCount?reply.code(204).send():reply.code(404).send({error:'Редирект не найден'})})
 app.get('/api/seo/metadata',async(req,reply)=>{if(typeof req.query.path!=='string'||req.query.path.length>4000||!req.query.path.startsWith('/')||req.query.path.startsWith('//'))return reply.code(400).send({error:'Некорректный адрес'});const result=await resolveSeo(db,req.query.path,{fallbackOrigin});return {status:result.status,redirect:result.redirect,metadata:result.metadata}})
 app.get('/robots.txt',async(req,reply)=>{const {config,origin}=await seoConfig(db,fallbackOrigin);return reply.type('text/plain; charset=utf-8').header('Cache-Control','no-cache').send('User-agent: *\n'+(config.indexing?'Disallow: /admin/\nDisallow: /api/\nDisallow: /account\n'+config.disallow.map(p=>'Disallow: '+seoPath(p)+'\n').join(''):'Disallow: /\n')+'Sitemap: '+origin+'/sitemap.xml\n')})
 async function sitemapRows(config){const home=(await db.query('SELECT p.seo FROM site_settings s JOIN pages p ON p.id=s.home_page_id AND p.published=TRUE AND p.deleted_at IS NULL WHERE s.id=1')).rows[0];const omitted=['home','catalog','blog'].map((key,i)=>config[key]?.noindex||config[key]?.canonical_path&&config[key].canonical_path!==['/','/catalog','/blog'][i]?['/','/catalog','/blog'][i]:null).filter(Boolean);if(home?.seo?.noindex&&!omitted.includes('/'))omitted.push('/');return {sql:`SELECT u.path,u.updated_at FROM (${publicUrls}) u WHERE NOT EXISTS(SELECT 1 FROM seo_redirects r WHERE r.source=u.path) AND NOT(u.path=ANY($1::text[])) AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) d WHERE left(u.path,length(d))=d)`,args:[omitted,config.disallow.map(seoPath)]}}
 app.get('/sitemap.xml',async(req,reply)=>{const {config,origin}=await seoConfig(db,fallbackOrigin);const q=await sitemapRows(config),count=config.indexing?Number((await db.query('SELECT COUNT(*) AS count FROM ('+q.sql+') x',q.args)).rows[0].count):0;const pages=Math.ceil(count/1000);if(pages>50000)throw Object.assign(Error('Sitemap capacity exceeded'),{statusCode:503});return reply.type('application/xml; charset=utf-8').header('Cache-Control','no-cache').send('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+Array.from({length:pages},(_,i)=>'<sitemap><loc>'+esc(origin+'/sitemap-'+(i+1)+'.xml')+'</loc></sitemap>').join('')+'</sitemapindex>')})
 app.get('/sitemap-:part.xml',async(req,reply)=>{if(!/^[1-9]\d{0,4}$/.test(req.params.part)||Number(req.params.part)>50000)return reply.code(404).send();const {config,origin}=await seoConfig(db,fallbackOrigin);const q=await sitemapRows(config);const rows=config.indexing?(await db.query(q.sql+' ORDER BY path LIMIT 1000 OFFSET $3',[...q.args,(Number(req.params.part)-1)*1000])).rows:[];if(!rows.length)return reply.code(404).send();return reply.type('application/xml; charset=utf-8').header('Cache-Control','no-cache').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+rows.map(r=>'<url><loc>'+esc(origin+r.path)+'</loc>'+(r.updated_at?'<lastmod>'+new Date(r.updated_at).toISOString()+'</lastmod>':'')+'</url>').join('')+'</urlset>')})
 async function html(req,reply){if(protectedSeoPath(req.raw.url.split('?')[0])&&req.raw.url.split('?')[0].replace(/\/$/,'')!=='/account')return reply.code(404).send({error:'Не найдено'});const result=await resolveSeo(db,req.raw.url,{fallbackOrigin});if(result.redirect)return reply.redirect(result.redirect,result.status);const nonce=randomBytes(18).toString('base64');req.novaSeoNonce=nonce;let shell;try{shell=await template()}catch{throw Object.assign(Error('Build storefront before serving HTML'),{statusCode:503})}const document=shell.replace(/<title>[\s\S]*?<\/title>/i,'').replace('</head>',seoHead(result.metadata,nonce)+'</head>').replace('<div id="app"></div>','<div id="app">'+result.content+'</div>');return reply.code(result.status).type('text/html; charset=utf-8').header('Cache-Control',req.raw.url.split('?')[0].replace(/\/$/,'')==='/account'?'no-store':'no-cache').header('X-Robots-Tag',result.metadata.robots).header('X-Nova-SEO','server').send(document)}
 app.get('/',html);app.get('/*',html)
}
