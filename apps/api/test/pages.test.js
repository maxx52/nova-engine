import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePage, registerPages, validateSections } from '../src/pages.js'
const valid = { title: 'О нас', slug: 'about', content: 'Текст', published: false }
test('page validation rejects reserved paths, invalid slugs and invalid payloads', () => {
  assert.equal(validatePage(valid), null)
  for (const slug of ['api','uploads','product','admin','../secret','О нас','with space','a/b','-about','ABOUT']) assert.ok(validatePage({ ...valid, slug }))
  for (const body of [null, {}, {...valid, title: ' '}, {...valid, published:'false'}, {...valid,content:'x'.repeat(100001)}]) assert.ok(validatePage(body))
})
test('public reads require publication; administrative routes require authentication', async () => {
  const routes = [], queries = []
  const app = { get: (...args) => routes.push({method:'GET', url:args[0], options:args.length===3?args[1]:{}, handler:args.at(-1)}), route: route=>routes.push(route), delete: (url,options,handler)=>routes.push({method:'DELETE',url,options,handler}) }
  const auth = () => {}
  registerPages(app,{query:async(sql,args)=>{queries.push({sql,args});return {rows:[],rowCount:0}}},auth)
  for(const route of routes.filter(r=>r.url.startsWith('/api/admin/'))) assert.equal(route.preHandler || route.options.preHandler,auth)
  const reply = { status:200, code(n){this.status=n;return this}, send(body){return body} }
  const result = await routes.find(r=>r.url==='/api/pages/:slug').handler({params:{slug:'draft'}},reply)
  assert.equal(reply.status,404);assert.equal(result.error,'Страница не найдена')
  assert.match(queries[0].sql,/published=TRUE/);assert.deepEqual(queries[0].args,['draft'])
})

test('sections preserve old pages and reject unsafe links and invalid section data', async () => {
  const { validateSections } = await import('../src/pages.js')
  const hero = { id:'hero-1',type:'hero',title:'Привет',text:'Текст',image_url:'',alt:'',caption:'',button_text:'О нас',button_url:'/about' }
  assert.equal(validatePage(valid),null)
  assert.equal(validatePage({...valid,sections:[hero]}),null)
  for(const button_url of ['javascript:alert(1)','//evil.test','/\\evil.test','data:text/html,hi','https://a.test/\nfoo']) assert.ok(validateSections([{...hero,button_url}]))
  for(const button_url of ['/about','/#contacts','https://example.com/path']) assert.equal(validateSections([{...hero,button_url}]),null)
  assert.ok(validateSections([hero,hero]))
  assert.ok(validateSections([{...hero,type:'script'}]))
  assert.ok(validateSections([{...hero,image_url:'https://example.com/a.jpg'}]))
  assert.ok(validateSections(Array.from({length:51},(_,i)=>({...hero,id:String(i)}))))
})

test('HTTP page writes persist ordered sections as JSON and require admin key', async () => {
  const { default: Fastify } = await import('fastify')
  const app = Fastify()
  const calls = []
  const pool = { query: async (sql,args) => {
    calls.push({sql,args})
    return {rowCount:1,rows:[{id:'7',title:args[0],slug:args[1],content:args[2],published:args[3],sections:JSON.parse(args[4])}]}
  }}
  registerPages(app,pool,(req,reply,done)=>{if(req.headers['x-admin-key']!=='secret') return reply.code(401).send({error:'Unauthorized'});done()})
  try {
    const section = {id:'image-1',type:'image',title:'',text:'',image_url:'/uploads/00000000-0000-0000-0000-000000000000.jpg',alt:'Фото',caption:'Подпись',button_text:'',button_url:''}
    const payload={...valid,sections:[section,{...section,id:'text-1',type:'text',text:'Текст'}]}
    assert.equal((await app.inject({method:'POST',url:'/api/admin/pages',payload})).statusCode,401)
    assert.equal(calls.length,0)
    const created=await app.inject({method:'POST',url:'/api/admin/pages',headers:{'x-admin-key':'secret'},payload})
    assert.equal(created.statusCode,201)
    assert.deepEqual(created.json().sections,payload.sections)
    const updated=await app.inject({method:'PUT',url:'/api/admin/pages/7',headers:{'x-admin-key':'secret'},payload:{...payload,sections:[...payload.sections].reverse()}})
    assert.equal(updated.statusCode,200)
    assert.equal(updated.json().sections[0].id,'text-1')
    assert.match(calls[1].sql,/sections=\$5.*WHERE id=\$6/)
    assert.equal(calls[1].args[5],'7')
    const rejected=await app.inject({method:'POST',url:'/api/admin/pages',headers:{'x-admin-key':'secret'},payload:{...payload,sections:[{...section,button_url:'javascript:alert(1)'}]}})
    assert.equal(rejected.statusCode,400);assert.equal(calls.length,2)
  } finally { await app.close() }
})

test('code sections validate isolated HTML, CSS and JavaScript with bounded source sizes',()=>{
 const section={id:'custom-block',type:'code',code:{html:'<h2>Custom</h2>',css:'h2{color:green}',js:'document.body.dataset.ready="yes"'}}
 assert.equal(validateSections([section]),null)
 assert.ok(validateSections([{...section,code:{...section.code,js:'x'.repeat(100001)}}]))
 assert.ok(validateSections([{...section,code:{html:'',css:''}}]))
 assert.ok(validateSections([section,section]))
})
