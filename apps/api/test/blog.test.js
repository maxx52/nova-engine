import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validatePost,registerBlog } from '../src/blog.js'
const draft={title:'Статья',slug:'first-post',excerpt:'Описание',content:'Текст статьи',category:'Новости',tags:['NOVA'],cover_url:'',published:false}
test('post validation rejects invalid slugs, image paths, tags and publication status',()=>{
 assert.equal(validatePost(draft),null)
 for(const patch of [{slug:'../secret'},{title:' '},{cover_url:'https://example.com/a.jpg'},{tags:['A','a']},{tags:[null]},{tags:Array.from({length:21},(_,i)=>String(i))},{published:'false'},{content:'x'.repeat(100001)}])assert.ok(validatePost({...draft,...patch}))
})
test('blog HTTP workflow: drafts, publication, filters, conflicts, disable and trash',async()=>{
 const {contentFixture}=await import('./fixtures/content.js'),f=await contentFixture(),{app,call,query}=f
 await query('UPDATE site_settings SET blog_enabled=TRUE')
 try{
  assert.equal((await app.inject('/api/admin/posts')).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/admin/posts',payload:draft})).statusCode,401)
  const created=await call('POST','/api/admin/posts',draft);assert.equal(created.statusCode,201,created.body)
  const id=created.json().id
  assert.equal((await app.inject('/api/blog/first-post')).statusCode,404)
  assert.equal((await app.inject('/api/blog')).json().total,0)
  const saved=await call('PUT','/api/admin/posts/'+id,{...draft,published:true,revision:created.json().revision});assert.equal(saved.statusCode,200,saved.body)
  const list=(await app.inject('/api/blog?category='+encodeURIComponent('Новости')+'&tag=NOVA')).json()
  assert.equal(list.total,1);assert.equal(list.items[0].slug,'first-post');assert.deepEqual(list.tags,['NOVA'])
  assert.equal((await app.inject('/api/blog?tag=other')).json().total,0)
  assert.equal((await app.inject('/api/blog?page=-1')).statusCode,400)
  assert.equal((await app.inject('/api/blog/first-post')).json().content,'Текст статьи')
  assert.equal((await call('POST','/api/admin/posts',draft)).statusCode,409)
  await query('UPDATE site_settings SET blog_enabled=FALSE')
  assert.equal((await app.inject('/api/blog')).statusCode,404)
  assert.equal((await app.inject('/api/blog/first-post')).statusCode,404)
  assert.equal((await call('GET','/api/admin/posts')).json().length,1)
  await query('UPDATE site_settings SET blog_enabled=TRUE')
  assert.equal((await call('DELETE','/api/admin/posts/'+id,{revision:saved.json().revision})).statusCode,204)
  assert.equal((await app.inject('/api/blog')).json().total,0)
  assert.equal((await app.inject('/api/blog/first-post')).statusCode,404)
  assert.equal((await call('GET','/api/admin/posts?trash=1')).json().length,1)
 }finally{await f.close()}
})
