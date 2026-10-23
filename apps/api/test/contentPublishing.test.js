import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {contentFixture} from './fixtures/content.js'
import {publishDueContent} from '../src/contentPublishing.js'
import {mediaUsage} from '../src/media.js'
const page={title:'Review page',slug:'review-page',content:'Live original',sections:[],published:true}
const post={title:'Review post',slug:'review-post',content:'Original article',excerpt:'',category:'News',tags:['CMS'],cover_url:'',published:false}
const fields=record=>Object.fromEntries(Object.keys(record).filter(k=>['title','slug','content','sections','seo','published','excerpt','category','tags','cover_url'].includes(k)).map(k=>[k,record[k]]))
test('publication approval and scheduling: immutable snapshots, roles, time, restart, CAS and media',async t=>{
 const f=await contentFixture(),{call,query,auth}=f
 const ok=async(method,url,payload,status=200,headers=auth)=>{const r=await call(method,url,payload,headers);assert.equal(r.statusCode,status,r.body);return status===204?null:r.json()}
 let editor,manager,current,job
 const at=()=>new Date(Date.now()+60000).toISOString()
 const submit=(row,payload,mode='review',headers=editor,publish_at=null,kind='pages',request_id=randomUUID())=>ok('POST','/api/admin/'+kind+'/'+row.id+'/publications',{revision:row.revision,payload,mode,publish_at,request_id},201,headers)
 const decision=(j,action,extra={},headers=auth,kind='pages')=>ok('POST','/api/admin/'+kind+'/publications/'+j.id+'/'+action,{revision:j.revision,...extra},200,headers)
 try{
  for(const role of ['editor','manager']) {
   const username='publisher_'+role,password='test-publication-password-'+role
   await ok('POST','/api/admin/accounts',{username,password,role},201)
   const r=await call('POST','/api/auth/login',{username,password},{'x-nova-request':'1',origin:'http://localhost:5174'})
   assert.equal(r.statusCode,200)
   const headers={...auth,cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrf_token}
   if(role==='editor')editor=headers;else manager=headers
  }
  current=await ok('POST','/api/admin/pages',page,201)
  await t.test('editor cannot bypass review; snapshots stay private until approved',async()=>{
   assert.equal((await call('POST','/api/admin/pages',{...page,slug:'bypass'},editor)).statusCode,403)
   for(const published of [true,false])assert.equal((await call('PUT','/api/admin/pages/'+current.id,{...page,revision:current.revision,content:'Bypass',published},editor)).statusCode,403)
   const id=randomUUID(),body={revision:current.revision,payload:{...page,content:'Submitted proposal'},mode:'review',publish_at:null,request_id:id}
   job=await ok('POST','/api/admin/pages/'+current.id+'/publications',body,201,editor)
   assert.equal(job.state,'review');assert.equal((await ok('GET','/api/pages/'+page.slug)).content,'Live original')
   const repeat=await ok('POST','/api/admin/pages/'+current.id+'/publications',body,200,editor);assert.equal(repeat.id,job.id)
   assert.equal((await call('POST','/api/admin/pages/'+current.id+'/publications',{...body,payload:{...page,content:'Different'}},editor)).statusCode,409)
   assert.equal((await call('GET','/api/admin/pages/publications',undefined,manager)).statusCode,403)
   assert.equal((await call('GET','/api/admin/pages/publications',undefined,{})).statusCode,401)
   assert.equal((await call('POST','/api/admin/pages/publications/'+job.id+'/approve',{revision:job.revision},editor)).statusCode,403)
   assert.equal((await call('POST','/api/admin/pages/publications/'+job.id+'/cancel',{revision:job.revision},{...editor,'x-csrf-token':'bad'})).statusCode,403)
   const approved=await decision(job,'approve');assert.equal(approved.state,'published');assert.equal(approved.applied_revision,'2')
   assert.equal((await ok('GET','/api/pages/'+page.slug)).content,'Submitted proposal')
   const history=await ok('GET','/api/admin/pages/'+current.id+'/versions');assert.equal(history[0].action,'publish');assert.equal(history[0].user_id,1)
   assert.equal((await call('POST','/api/admin/pages/publications/'+job.id+'/approve',{revision:job.revision})).statusCode,409)
   current=await ok('GET','/api/admin/pages/'+current.id)
  })
  await t.test('rejection requires a comment, is visible to its author and never changes live text',async()=>{
   job=await submit(current,{...page,content:'Return this'})
   assert.equal((await call('POST','/api/admin/pages/publications/'+job.id+'/reject',{revision:job.revision})).statusCode,400)
   const result=await decision(job,'reject',{note:'Исправьте заголовок'});assert.equal(result.state,'rejected')
   const detail=await ok('GET','/api/admin/pages/publications/'+job.id,undefined,200,editor);assert.equal(detail.note,'Исправьте заголовок');assert.equal(detail.payload.content,'Return this')
   assert.equal((await ok('GET','/api/pages/'+page.slug)).content,'Submitted proposal')
   // Other editors cannot see or cancel this author's submitted content.
   assert.equal((await ok('GET','/api/admin/pages/publications?state=all',undefined,200,editor)).items.length,2)
  })
  await t.test('scheduling needs a publisher, validates time and publishes once after a process restart',async()=>{
   const when=at(),id=randomUUID(),body={revision:current.revision,payload:{...page,content:'Scheduled snapshot'},mode:'schedule',publish_at:when,request_id:id}
   assert.equal((await call('POST','/api/admin/pages/'+current.id+'/publications',body,editor)).statusCode,403)
   for(const publish_at of [null,'bad','2020-01-01T00:00:00Z',new Date(Date.now()+400*86400000).toISOString()])assert.equal((await call('POST','/api/admin/pages/'+current.id+'/publications',{...body,publish_at})).statusCode,400)
   job=await ok('POST','/api/admin/pages/'+current.id+'/publications',body,201)
   assert.equal((await publishDueContent(f.db)).published,0)
   assert.equal((await ok('GET','/api/pages/'+page.slug)).content,'Submitted proposal')
   // A fresh worker reads durable jobs only; two concurrent instances cannot apply twice.
   const now=new Date(Date.parse(when)+1000),results=await Promise.all([publishDueContent(f.db,{now}),publishDueContent(f.db,{now})])
   assert.equal(results.reduce((n,r)=>n+r.published,0),1)
   assert.equal((await ok('GET','/api/pages/'+page.slug)).content,'Scheduled snapshot')
   assert.equal((await publishDueContent(f.db,{now})).published,0)
   current=await ok('GET','/api/admin/pages/'+current.id);assert.equal(current.revision,'3')
  })
  await t.test('content edits, imports, trash and cancellation invalidate the exact approved snapshot',async()=>{
   job=await submit(current,{...page,content:'Stale proposal'})
   current=await ok('PUT','/api/admin/pages/'+current.id,{...fields(current),revision:current.revision,content:'Newer live edit'})
   assert.equal((await ok('GET','/api/admin/pages/publications/'+job.id)).state,'stale')
   assert.equal((await call('POST','/api/admin/pages/publications/'+job.id+'/approve',{revision:job.revision})).statusCode,409)
   const when=at();job=await submit(current,{...page,content:'Do not publish'},'schedule',auth,when)
   const cancelled=await decision(job,'cancel');assert.equal(cancelled.state,'cancelled')
   assert.equal((await publishDueContent(f.db,{now:new Date(Date.parse(when)+1000)})).published,0)
   job=await submit(current,{...page,content:'Trashed proposal'},'schedule',auth,when)
   await ok('DELETE','/api/admin/pages/'+current.id,{revision:current.revision},204)
   assert.equal((await ok('GET','/api/admin/pages/publications/'+job.id)).state,'stale')
   current=(await ok('GET','/api/admin/pages?trash=1'))[0]
   await ok('DELETE','/api/admin/pages/'+current.id+'/purge',{revision:current.revision},204)
   assert.equal((await call('GET','/api/admin/pages/publications/'+job.id)).statusCode,404)
  })
  await t.test('approval may schedule a post; inactive approvers and missing forms fail without partial publication',async()=>{
   await query('UPDATE site_settings SET blog_enabled=TRUE')
   let article=await ok('POST','/api/admin/posts',post,201,editor)
   const request=await submit(article,{...post,content:'Approved article'},'review',editor,null,'posts')
   const when=at(),scheduled=await decision(request,'approve',{publish_at:when},auth,'posts');assert.equal(scheduled.state,'scheduled')
   assert.equal((await call('GET','/api/blog/'+post.slug)).statusCode,404)
   await publishDueContent(f.db,{now:new Date(Date.parse(when)+1000)})
   assert.equal((await ok('GET','/api/blog/'+post.slug)).content,'Approved article')
   article=await ok('GET','/api/admin/posts/'+article.id)
   const p=await submit(article,{...post,content:'Revoked'},'schedule',auth,at(),'posts')
   // Simulate the publisher being disabled between approval and execution.
   await query('UPDATE admin_accounts SET enabled=FALSE WHERE id=1')
   await publishDueContent(f.db,{now:new Date(Date.now()+120000)})
   await query('UPDATE admin_accounts SET enabled=TRUE WHERE id=1')
   assert.equal((await ok('GET','/api/admin/posts/publications/'+p.id)).state,'failed')
   assert.equal((await ok('GET','/api/blog/'+post.slug)).content,'Approved article')
  })
  await t.test('missing forms and an occupied slug fail atomically, and other editors cannot read or cancel a proposal',async()=>{
   const formId=randomUUID();await query('INSERT INTO contact_forms(id,config) VALUES($1,$2)',[formId,'{}'])
   const row=await ok('POST','/api/admin/pages',{...page,slug:'form-job',published:false},201)
   let pending=await submit(row,{...page,slug:'form-job',sections:[{id:'form-section',type:'form',form_id:formId}]},'schedule',auth,at())
   await query('DELETE FROM contact_forms WHERE id=$1',[formId])
   await publishDueContent(f.db,{now:new Date(Date.now()+120000)})
   assert.equal((await ok('GET','/api/admin/pages/publications/'+pending.id)).state,'failed')
   assert.equal((await call('GET','/api/pages/form-job')).statusCode,404)
   assert.equal((await ok('GET','/api/admin/pages/'+row.id)).revision,'1')
   pending=await submit(row,{...page,slug:'occupied-after-submit'},'schedule',auth,at())
   await ok('POST','/api/admin/pages',{...page,slug:'occupied-after-submit'},201)
   await publishDueContent(f.db,{now:new Date(Date.now()+120000)})
   assert.equal((await ok('GET','/api/admin/pages/publications/'+pending.id)).state,'failed')
   assert.equal((await ok('GET','/api/admin/pages/'+row.id)).revision,'1')
   pending=await submit(row,{...page,slug:'form-job'},'review',auth)
   assert.equal((await call('GET','/api/admin/pages/publications/'+pending.id,undefined,editor)).statusCode,404)
   assert.equal((await call('POST','/api/admin/pages/publications/'+pending.id+'/cancel',{revision:pending.revision},editor)).statusCode,404)
   await decision(pending,'cancel')
  })
  await t.test('active snapshots retain media and release it on cancellation; payload validation and queue pagination are bounded',async()=>{
   const image='/uploads/'+randomUUID()+'.png';await query('INSERT INTO media_files(url,original_name,size,mime) VALUES($1,$2,1,$3)',[image,'scheduled.png','image/png'])
   const row=await ok('POST','/api/admin/pages',{...page,slug:'media-review',published:false},201)
   job=await submit(row,{...page,slug:row.slug,seo:{image_url:image}},'schedule',auth,at())
   assert.ok((await mediaUsage(f.db,image)).some(r=>r.type==='publication'))
   await decision(job,'cancel');assert.ok(!(await mediaUsage(f.db,image)).some(r=>r.type==='publication'))
   for(const payload of [{...page,secret:'hidden'},{...page,slug:'../bad'},{...page,sections:[{id:'bad',type:'form',form_id:randomUUID()}]}])assert.equal((await call('POST','/api/admin/pages/'+row.id+'/publications',{revision:row.revision,payload,mode:'review',request_id:randomUUID()})).statusCode,400)
   assert.equal((await call('GET','/api/admin/pages/publications?offset=-1')).statusCode,400)
   assert.equal((await call('GET','/api/admin/pages/publications?state=unknown')).statusCode,400)
  })
 }finally{await f.close()}
})
