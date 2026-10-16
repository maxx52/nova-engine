import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePage, registerPages } from '../src/pages.js'
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
