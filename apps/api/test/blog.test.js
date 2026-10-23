import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validatePost,registerBlog } from '../src/blog.js'
const draft={title:'Статья',slug:'first-post',excerpt:'Описание',content:'Текст статьи',category:'Новости',tags:['NOVA'],cover_url:'',published:false}
test('post validation rejects invalid slugs, image paths, tags and publication status',()=>{
 assert.equal(validatePost(draft),null)
 for(const patch of [{slug:'../secret'},{title:' '},{cover_url:'https://example.com/a.jpg'},{tags:['A','a']},{tags:[null]},{tags:Array.from({length:21},(_,i)=>String(i))},{published:'false'},{content:'x'.repeat(100001)}])assert.ok(validatePost({...draft,...patch}))
})
test('blog HTTP workflow: drafts, publication, filters, conflicts, disable and delete',async()=>{
 const app=Fastify();const posts=[];const queries=[];let enabled=true
 const pool={query:async(sql,args=[])=>{
  queries.push({sql,args})
  if(sql.includes('FROM site_settings'))return {rows:[{blog_enabled:enabled}]}
  if(sql.startsWith('INSERT INTO posts')||sql.startsWith('UPDATE posts')){
   const [title,slug,excerpt,content,category,tags,cover_url,published]=args
   const id=sql.startsWith('UPDATE')?args[9]:String(posts.length+1)
   if(posts.some(p=>p.slug===slug&&p.id!==id))throw Object.assign(new Error('duplicate'),{code:'23505'})
   const row={id,title,slug,excerpt,content,category,tags:JSON.parse(tags),cover_url,published,published_at:published?'2026-10-16T00:00:00Z':null}
   const index=posts.findIndex(p=>p.id===id)
   if(sql.startsWith('UPDATE')&&index<0)return {rowCount:0,rows:[]}
   if(index<0)posts.push(row);else posts[index]=row
   return {rowCount:1,rows:[row]}
  }
  if(sql.startsWith('DELETE')){const index=posts.findIndex(p=>p.id===args[0]);if(index<0)return {rowCount:0};posts.splice(index,1);return {rowCount:1}}
  if(sql.includes('slug=$1')){assert.match(sql,/published=TRUE/);const rows=posts.filter(p=>p.slug===args[0]&&p.published);return {rows,rowCount:rows.length}}
  if(sql.includes('WHERE published=TRUE')){
   const filtered=posts.filter(p=>p.published&&(!args[0]||p.category===args[0])&&(!args[1]||p.tags.includes(args[1])))
   if(sql.includes('COUNT(*)'))return {rows:[{total:filtered.length}]}
   if(sql.includes('LIMIT 12'))return {rows:filtered.slice(args[2],args[2]+12)}
   return {rows:posts.filter(p=>p.published).map(({category,tags})=>({category,tags}))}
  }
  return {rows:posts}
 }}
 const auth=(req,reply,done)=>{if(req.headers['x-admin-key']!=='secret')return reply.code(401).send({error:'Unauthorized'});done()}
 registerBlog(app,pool,auth)
 const write=(method,url,payload)=>app.inject({method,url,payload,headers:{'x-admin-key':'secret'}})
 try{
  assert.equal((await app.inject('/api/admin/posts')).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/admin/posts',payload:draft})).statusCode,401)
  assert.equal((await write('POST','/api/admin/posts',draft)).statusCode,201)
  assert.equal((await app.inject('/api/blog/first-post')).statusCode,404)
  assert.equal((await app.inject('/api/blog')).json().total,0)
  assert.equal((await write('PUT','/api/admin/posts/1',{...draft,published:true})).statusCode,200)
  const list=(await app.inject('/api/blog?category='+encodeURIComponent('Новости')+'&tag=NOVA')).json()
  assert.equal(list.total,1);assert.equal(list.items[0].slug,'first-post');assert.deepEqual(list.tags,['NOVA'])
  assert.equal((await app.inject('/api/blog?tag=other')).json().total,0)
  assert.equal((await app.inject('/api/blog?page=-1')).statusCode,400)
  assert.equal((await app.inject('/api/blog/first-post')).json().content,'Текст статьи')
  assert.equal((await write('POST','/api/admin/posts',draft)).statusCode,409)
  enabled=false
  assert.equal((await app.inject('/api/blog')).statusCode,404)
  assert.equal((await app.inject('/api/blog/first-post')).statusCode,404)
  assert.equal((await app.inject({url:'/api/admin/posts',headers:{'x-admin-key':'secret'}})).json().length,1)
  enabled=true
  assert.equal((await write('PUT','/api/admin/posts/1',draft)).statusCode,200)
  assert.equal((await app.inject('/api/blog/first-post')).statusCode,404)
  assert.equal((await write('DELETE','/api/admin/posts/1')).statusCode,204)
  assert.equal((await write('DELETE','/api/admin/posts/1')).statusCode,404)
  assert.ok(queries.some(q=>q.sql.includes('tags ? $2')&&q.sql.includes('LIMIT 12 OFFSET $3')))
 }finally{await app.close()}
})
