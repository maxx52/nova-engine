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

test('HTTP page writes persist ordered sections and require authentication and current revision',async()=>{
 const {contentFixture}=await import('./fixtures/content.js'),f=await contentFixture()
 try{
  const section={id:'text-1',type:'text',title:'',text:'Text',image_url:'',alt:'',caption:'',button_text:'',button_url:''}
  const payload={...valid,sections:[section,{...section,id:'text-2',text:'Second'}]}
  assert.equal((await f.call('POST','/api/admin/pages',payload,{})).statusCode,401)
  const created=await f.call('POST','/api/admin/pages',payload);assert.equal(created.statusCode,201,created.body)
  assert.deepEqual(created.json().sections,payload.sections)
  const updated=await f.call('PUT','/api/admin/pages/'+created.json().id,{...payload,revision:created.json().revision,sections:[...payload.sections].reverse()})
  assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().sections[0].id,'text-2')
  assert.equal((await f.call('PUT','/api/admin/pages/'+created.json().id,payload)).statusCode,400)
  assert.equal((await f.call('POST','/api/admin/pages',{...payload,slug:'unsafe',sections:[{...section,button_url:'javascript:alert(1)'}]})).statusCode,400)
 }finally{await f.close()}
})

test('code sections validate isolated HTML, CSS and JavaScript with bounded source sizes',()=>{
 const section={id:'custom-block',type:'code',code:{html:'<h2>Custom</h2>',css:'h2{color:green}',js:'document.body.dataset.ready="yes"'}}
 assert.equal(validateSections([section]),null)
 assert.ok(validateSections([{...section,code:{...section.code,js:'x'.repeat(100001)}}]))
 assert.ok(validateSections([{...section,code:{html:'',css:''}}]))
 assert.ok(validateSections([section,section]))
})
