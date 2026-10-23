import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {registerSeo,resolveSeo,redirectCycle} from '../src/seo.js'
import {registerPages} from '../src/pages.js'
import {registerBlog} from '../src/blog.js'
import {registerSecurity,publicErrorHandler} from '../src/security.js'
import {seoPath,validateSeo,jsonLd} from '../../../shared/seo.js'
const key='seo-test-setup-key-32-characters-long',password='seo-only-test-password-2026'
test('SEO validates internal canonical/redirect paths, prevents cycles and escapes JSON-LD script boundaries',()=>{
 for(const bad of ['//evil.test','https://evil.test','/../admin','/%2e%2e/admin','/a\\b','/a?x=1','/a#x','/%0afoo','/%252fadmin','/a//b'])assert.equal(seoPath(bad),null,bad)
 assert.equal(seoPath('/about/'),'/about');assert.equal(seoPath('/товары'),encodeURI('/товары'))
 for(const seo of [{title:42},{description:'x'.repeat(501)},{noindex:'false'},{canonical_path:'/api/auth'},{image_url:'https://evil.test/x'},{unknown:1}])assert.ok(validateSeo(seo))
 assert.equal(validateSeo({title:'Title',description:'Description',noindex:true,canonical_path:'/about'}),null)
 assert.equal(redirectCycle([{source:'/a',target:'/b'}],'/b','/a'),true)
 assert.equal(redirectCycle([], '/a','/a'),true);assert.equal(redirectCycle([{source:'/a',target:'/b'}],'/b','/c'),false)
 const escaped=jsonLd({name:'</script><script>alert(1)</script>&'});assert.ok(!escaped.includes('<'));assert.equal(JSON.parse(escaped).name,'</script><script>alert(1)</script>&')
})
test('SEO PostgreSQL workflow: saved fields, initial HTML, robots, segmented sitemap, redirects, privacy and server permissions',async()=>{
 const pg=new PGlite();let tail=Promise.resolve()
 const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}}
 pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify({routerOptions:{maxParamLength:2000}});registerSecurity(app);const {requireAdmin}=registerAuth(app,db,{setupKey:key});registerPages(app,db,requireAdmin);registerBlog(app,db,requireAdmin)
 registerSeo(app,db,requireAdmin,{fallbackOrigin:'https://shop.example',template:async()=>'<html><head><title>Default</title></head><body><div id="app"></div><script src="/assets/app.js"></script></body></html>'});app.setErrorHandler(publicErrorHandler)
 const call=(method,url,payload,headers={})=>app.inject({method,url,payload,headers:{'x-nova-request':'1',...headers}})
 try{
  assert.equal((await call('GET','/api/admin/seo')).statusCode,401)
  const setup=await call('POST','/api/auth/setup',{username:'seo_owner',password,setup_key:key});assert.equal(setup.statusCode,201,setup.body)
  const owner={cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token}
  assert.equal((await call('PUT','/api/admin/seo',{config:{}},{cookie:owner.cookie})).statusCode,403)
  const created=await call('POST','/api/admin/pages',{title:'About',slug:'about',content:'Real content <script>unsafe</script>',published:true,sections:[],seo:{title:'SEO "title" </title>',description:'Unique & description',noindex:false}},owner);assert.equal(created.statusCode,201,created.body);const id=created.json().id
  const publicPage=await call('GET','/about');assert.equal(publicPage.statusCode,200,publicPage.body);assert.match(publicPage.body,/<title>SEO &quot;title&quot; &lt;\/title&gt;<\/title>/);assert.ok(publicPage.body.includes('name="description" content="Unique &amp; description"'));assert.ok(publicPage.body.includes('https://shop.example/about'));assert.ok(!publicPage.body.includes('<script>unsafe'));assert.match(publicPage.headers['content-security-policy'],/script-src 'self' 'nonce-/);assert.equal(publicPage.headers['x-robots-tag'],'index, follow')
  const metadata=(await call('GET','/api/seo/metadata?path=/about')).json();assert.equal(metadata.metadata.title,'SEO "title" </title>')
  const robots=await call('GET','/robots.txt');assert.match(robots.body,/Disallow: \/admin\//);assert.match(robots.body,/Sitemap: https:\/\/shop.example\/sitemap.xml/)
  assert.match((await call('GET','/sitemap.xml')).body,/sitemap-1.xml/)
  const map=await call('GET','/sitemap-1.xml');assert.equal(map.statusCode,200,map.body);assert.match(map.body,/<loc>https:\/\/shop.example\/about<\/loc>/)
  await query("UPDATE pages SET seo=seo||'{\"noindex\":true}'::jsonb WHERE id=$1",[id]);assert.ok(!(await call('GET','/sitemap-1.xml')).body.includes('/about</loc>'));assert.match((await call('GET','/about')).headers['x-robots-tag'],/noindex/)
  await query('UPDATE pages SET published=FALSE WHERE id=$1',[id]);assert.equal((await call('GET','/about')).statusCode,404);assert.equal((await call('GET','/unknown')).statusCode,404)
  await query('UPDATE products SET price=123.45,stock=0,seo=$1::jsonb WHERE id=1',[JSON.stringify({title:'Product SEO'})]);const product=(await resolveSeo(db,'/product/1',{fallbackOrigin:'https://shop.example'})).metadata;assert.equal(product.title,'Product SEO');const structured=product.graph['@graph'][0];assert.equal(structured['@type'],'Product');assert.equal(structured.offers.price,'123.45');assert.equal(structured.offers.availability,'https://schema.org/OutOfStock');assert.ok(!structured.aggregateRating)
  await query('UPDATE products SET variants=$1::jsonb WHERE id=1',[JSON.stringify([{name:'Red',sku:'R',price:77,stock:2},{name:'Blue',sku:'B',price:88,stock:0}])]);const variants=(await resolveSeo(db,'/product/1',{fallbackOrigin:'https://shop.example'})).metadata.graph['@graph'][0].offers;assert.equal(variants[0].price,'77.00');assert.equal(variants[1].availability,'https://schema.org/OutOfStock')
  assert.equal((await call('POST','/api/admin/seo/redirects',{source:'/old',target:'/catalog',status:301},owner)).statusCode,201)
  const long='/legacy/'+('x'.repeat(400));assert.equal((await call('POST','/api/admin/seo/redirects',{source:long,target:'/catalog',status:301},owner)).statusCode,201);assert.equal((await call('GET',long)).statusCode,301)
  const moved=await call('GET','/old?secret=not-forwarded');assert.equal(moved.statusCode,301);assert.equal(moved.headers.location,'/catalog')
  assert.equal((await call('POST','/api/admin/seo/redirects',{source:'/catalog',target:'/old',status:302},owner)).statusCode,400)
  for(const source of ['/admin','/api/auth','/sitemap.xml','/uploads/x'])assert.equal((await call('POST','/api/admin/seo/redirects',{source,target:'/',status:301},owner)).statusCode,400)
  const editorCreate=await call('POST','/api/admin/accounts',{username:'seo_editor',password,role:'editor'},owner);assert.equal(editorCreate.statusCode,201)
  const login=await call('POST','/api/auth/login',{username:'seo_editor',password});const editor={cookie:login.headers['set-cookie'].split(';')[0],'x-csrf-token':login.json().csrf_token}
  assert.equal((await call('GET','/api/admin/seo',undefined,editor)).statusCode,403)
  await query("INSERT INTO pages(title,slug,content,published) SELECT 'Map '||n,'map-'||n,'',TRUE FROM generate_series(1,1005) n")
  const index=(await call('GET','/sitemap.xml')).body;assert.ok(index.includes('sitemap-2.xml'))
  const firstMap=(await call('GET','/sitemap-1.xml')).body,secondMap=(await call('GET','/sitemap-2.xml')).body
  assert.equal((firstMap.match(/<url>/g)||[]).length,1000);assert.ok((secondMap.match(/<url>/g)||[]).length>0)
  const urls=[...firstMap.matchAll(/<loc>(.*?)<\/loc>/g),...secondMap.matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]);assert.equal(new Set(urls).size,urls.length)
  await query('UPDATE site_settings SET blog_enabled=TRUE WHERE id=1')
  const post=await call('POST','/api/admin/posts',{title:'News',slug:'news',excerpt:'News excerpt',content:'Article content',category:'',tags:[],cover_url:'',published:true,seo:{title:'Article SEO'}},owner);assert.equal(post.statusCode,201,post.body)
  const article=(await resolveSeo(db,'/blog/news',{fallbackOrigin:'https://shop.example'})).metadata;assert.equal(article.title,'Article SEO');assert.ok(article.graph['@graph'].some(x=>x['@type']==='BlogPosting'))
  await query('UPDATE site_settings SET shop_enabled=FALSE,blog_enabled=FALSE WHERE id=1')
  assert.equal((await call('GET','/product/1')).statusCode,404);assert.equal((await call('GET','/blog/news')).statusCode,404)
  assert.ok(!(await call('GET','/sitemap-1.xml')).body.includes('/product/'));assert.ok(!(await call('GET','/sitemap-1.xml')).body.includes('/blog'))
  await query('UPDATE site_settings SET shop_enabled=TRUE WHERE id=1')
  const current=(await call('GET','/api/admin/seo',undefined,owner)).json();const config={...current.config,site_url:'https://canonical.example',indexing:false}
  assert.equal((await call('PUT','/api/admin/seo',{config,revision:current.revision},owner)).statusCode,200)
  assert.equal((await call('PUT','/api/admin/seo',{config,revision:current.revision},owner)).statusCode,409)
  assert.match((await call('GET','/robots.txt')).body,/Disallow: \/\n/);assert.ok(!(await call('GET','/sitemap.xml')).body.includes('<sitemap>'));assert.match((await call('GET','/product/1')).headers['x-robots-tag'],/noindex/)
  const poisoned=await app.inject({url:'/product/1',headers:{host:'evil.example','x-forwarded-host':'evil.example'}});assert.ok(!poisoned.body.includes('evil.example'));assert.ok(poisoned.body.includes('canonical.example'))
  assert.equal((await call('GET','/sitemap-99999.xml')).statusCode,404)
 }finally{await app.close();await pg.close()}
})
