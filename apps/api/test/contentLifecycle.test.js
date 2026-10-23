import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {contentFixture} from './fixtures/content.js'
import {mediaUsage} from '../src/media.js'
import {transferFile} from '../../../shared/dataTransfer.js'
const page={title:'Lifecycle page',slug:'lifecycle',content:'Original',sections:[],published:true}
test('content lifecycle: private recovery, CAS conflicts, retained versions, trash and import integration',async t=>{
 const f=await contentFixture(),{call,query,auth}=f
 const ok=async(method,url,payload,status=200,headers=auth)=>{const r=await call(method,url,payload,headers);assert.equal(r.statusCode,status,r.body);return status===204?null:r.json()}
 let current,other
 try{
 await t.test('all new endpoints require authentication, CSRF and the content role',async()=>{
  current=await ok('POST','/api/admin/pages',page,201)
  for(const role of ['editor','manager']) {
   const username='content_'+role,password='test-only-content-'+role
   await ok('POST','/api/admin/accounts',{username,password,role},201)
   const r=await call('POST','/api/auth/login',{username,password},{'x-nova-request':'1',origin:'http://localhost:5174'})
   assert.equal(r.statusCode,200,r.body)
   const headers={...auth,cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.json().csrf_token}
   assert.equal((await call('GET','/api/admin/pages/'+current.id+'/versions',undefined,headers)).statusCode,role==='editor'?200:403)
   assert.equal((await call('PUT','/api/admin/pages/drafts/new',{revision:'0',base_revision:null,payload:{title:'Private '+role}},headers)).statusCode,role==='editor'?200:403)
   if(role==='editor')other=headers
  }
  for(const url of ['/api/admin/pages/'+current.id,'/api/admin/pages/'+current.id+'/versions','/api/admin/pages/drafts/new'])assert.equal((await call('GET',url,undefined,{})).statusCode,401)
  assert.equal((await call('PUT','/api/admin/pages/drafts/new',{revision:'0',base_revision:null,payload:{title:'CSRF'}},{...auth,'x-csrf-token':'wrong'})).statusCode,403)
 })
 await t.test('incomplete new drafts stay private; stale tabs cannot overwrite or delete newer work',async()=>{
  assert.equal(await ok('GET','/api/admin/pages/drafts/new'),null)
  const d=await ok('PUT','/api/admin/pages/drafts/new',{revision:'0',base_revision:null,payload:{title:'',slug:'unfinished адрес',sections:[]}})
  assert.equal(d.revision,'1')
  assert.equal((await ok('GET','/api/admin/pages/drafts/new',undefined,200,other)).payload.title,'Private editor')
  assert.equal((await ok('GET','/api/pages')).length,1)
  assert.equal((await call('PUT','/api/admin/pages/drafts/new',{revision:'0',base_revision:null,payload:{title:'Other tab'}})).statusCode,409)
  const d2=await ok('PUT','/api/admin/pages/drafts/new',{revision:d.revision,base_revision:null,payload:{title:'Second'}})
  assert.equal((await call('DELETE','/api/admin/pages/drafts/new',{revision:d.revision})).statusCode,409)
  await ok('DELETE','/api/admin/pages/drafts/new',{revision:d2.revision},204)
  for(const payload of [{password:'secret'},{sections:'bad'},{title:'\0'},{seo:[]},{sections:Array(51).fill({})}])assert.equal((await call('PUT','/api/admin/pages/drafts/new',{revision:'0',base_revision:null,payload})).statusCode,400)
 })
 await t.test('concurrent saves accept one writer, retain the loser work copy and expose server comparison',async()=>{
  const base=current.revision
  await ok('PUT','/api/admin/pages/drafts/'+current.id,{revision:'0',base_revision:base,payload:{...page,content:'Local work'}})
  const results=await Promise.all(['Writer A','Writer B'].map(content=>call('PUT','/api/admin/pages/'+current.id,{...page,revision:base,content})))
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409])
  current=results.find(r=>r.statusCode===200).json()
  assert.equal(results.find(r=>r.statusCode===409).json().current.content,current.content)
  assert.equal((await ok('GET','/api/admin/pages/drafts/'+current.id)).payload.content,'Local work')
  assert.equal((await ok('GET','/api/pages/'+page.slug)).content,current.content)
  assert.equal((await call('PUT','/api/admin/pages/'+current.id,{...page})).statusCode,400)
  assert.equal((await call('DELETE','/api/admin/pages/'+current.id,{revision:base})).statusCode,409)
 })
 await t.test('history preview is data, defaults to draft and saves as a new version with its actor',async()=>{
  const history=await ok('GET','/api/admin/pages/'+current.id+'/versions')
  assert.equal(history.length,2);assert.equal(history[0].user_id,1)
  const previous=await ok('GET','/api/admin/pages/'+current.id+'/versions/1')
  assert.equal(previous.published,false);assert.equal(previous.content,'Original');assert.equal(previous.revision,undefined)
  current=await ok('PUT','/api/admin/pages/'+current.id,{...previous,revision:current.revision})
  assert.equal(current.revision,'3');assert.equal((await call('GET','/api/pages/'+page.slug)).statusCode,404)
  const version=(await query("SELECT snapshot,action FROM content_versions WHERE kind='pages' AND record_id=$1 AND revision=3",[current.id])).rows[0]
  assert.equal(version.snapshot.content,'Original');assert.equal(version.action,'save')
 })
 await t.test('trash hides public pages, homepage and sitemap; restore stays a draft, stale purge fails',async()=>{
  current=await ok('PUT','/api/admin/pages/'+current.id,{...page,revision:current.revision})
  await query('UPDATE site_settings SET home_page_id=$1',[current.id])
  assert.equal((await ok('GET','/api/settings')).home_slug,page.slug)
  await ok('DELETE','/api/admin/pages/'+current.id,{revision:current.revision},204)
  assert.equal((await ok('GET','/api/admin/pages')).length,0)
  current=(await ok('GET','/api/admin/pages?trash=1'))[0]
  assert.equal((await ok('GET','/api/settings')).home_slug,null)
  for(const url of ['/api/pages/'+page.slug,'/'+page.slug])assert.equal((await call('GET',url)).statusCode,404)
  assert.ok(!(await call('GET','/sitemap-1.xml')).body.includes('/'+page.slug))
  assert.equal((await call('PUT','/api/admin/pages/'+current.id,{...page,revision:current.revision})).statusCode,409)
  assert.equal((await call('PUT','/api/admin/pages/drafts/'+current.id,{revision:'1',base_revision:current.revision,payload:{title:'Trashed'}})).statusCode,409)
  assert.equal((await ok('GET','/api/admin/transfer/export?kind=pages')).records.length,0)
  const preview=await ok('POST','/api/admin/transfer/preview',{kind:'pages',mode:'merge',format:'json',text:JSON.stringify(transferFile('pages',[page]))})
  assert.equal(preview.valid,false);assert.match(preview.rows[0].errors.join(' '),/корзине/)
  const old=current.revision;current=await ok('POST','/api/admin/pages/'+current.id+'/restore',{revision:old})
  assert.equal(current.published,false)
  assert.equal((await call('DELETE','/api/admin/pages/'+current.id+'/purge',{revision:old})).statusCode,409)
 })
 await t.test('import records history and cannot apply after a newer edit or trash operation',async()=>{
  const preview=()=>ok('POST','/api/admin/transfer/preview',{kind:'pages',mode:'merge',format:'json',text:JSON.stringify(transferFile('pages',[{slug:page.slug,title:'From import'}]))})
  let plan=await preview();assert.equal(plan.valid,true)
  await ok('POST','/api/admin/transfer/apply',{id:plan.id,confirm:true})
  let h=await ok('GET','/api/admin/pages/'+current.id+'/versions');assert.equal(h[0].action,'import');assert.equal(h[0].user_id,1)
  plan=await preview();await query('UPDATE pages SET content=$1 WHERE id=$2',['Concurrent change',current.id])
  assert.equal((await call('POST','/api/admin/transfer/apply',{id:plan.id,confirm:true})).statusCode,409)
  current=await ok('GET','/api/admin/pages/'+current.id)
 })
 await t.test('history and private drafts retain media; purge releases references and work copies',async()=>{
  const image='/uploads/'+randomUUID()+'.png'
  await query('INSERT INTO media_files(url,original_name,size,mime) VALUES($1,$2,1,$3)',[image,'history.png','image/png'])
  current=await ok('PUT','/api/admin/pages/'+current.id,{...current,seo:{image_url:image}})
  current=await ok('PUT','/api/admin/pages/'+current.id,{...current,seo:{}})
  assert.ok((await mediaUsage(f.db,image)).some(r=>r.type==='version'))
  await ok('PUT','/api/admin/pages/drafts/new',{revision:'0',base_revision:null,payload:{seo:{image_url:image}}})
  assert.ok((await mediaUsage(f.db,image)).some(r=>r.type==='draft'))
  assert.equal((await call('PUT','/api/admin/pages/drafts/new',{revision:'1',base_revision:null,payload:{seo:{image_url:'/uploads/'+randomUUID()+'.jpg'}}})).statusCode,400)
  assert.equal((await ok('GET','/api/admin/pages/drafts/new')).revision,'1','failed media validation rolled the work copy back')
  await ok('DELETE','/api/admin/pages/drafts/new',{revision:'1'},204)
  await ok('DELETE','/api/admin/pages/'+current.id,{revision:current.revision},204)
  current=(await ok('GET','/api/admin/pages?trash=1'))[0]
  await ok('DELETE','/api/admin/pages/'+current.id+'/purge',{revision:current.revision},204)
  assert.deepEqual(await ok('GET','/api/admin/pages/'+current.id+'/versions'),[])
  assert.equal(await ok('GET','/api/admin/pages/drafts/'+current.id),null)
  assert.deepEqual(await mediaUsage(f.db,image),[])
  assert.equal((await ok('GET','/api/settings')).home_page_id,null)
 })
 await t.test('retention keeps exactly the latest 30 and code in snapshots is never evaluated',async()=>{
  let row=await ok('POST','/api/admin/pages',{...page,slug:'retention',sections:[{id:'code',type:'code',code:{html:'<script>throw Error("never execute")</script>',css:'',js:'throw Error("never execute")'}}]},201)
  for(let i=0;i<32;i++)await query('UPDATE pages SET title=$1 WHERE id=$2',['Revision '+i,row.id])
  const versions=await ok('GET','/api/admin/pages/'+row.id+'/versions');assert.equal(versions.length,30);assert.equal(versions[0].revision,'33');assert.equal(versions.at(-1).revision,'4')
  assert.equal((await call('GET','/api/admin/pages/'+row.id+'/versions/1')).statusCode,404)
  assert.match((await ok('GET','/api/admin/pages/'+row.id+'/versions/4')).sections[0].code.js,/never execute/)
 })
 }finally{await f.close()}
})
