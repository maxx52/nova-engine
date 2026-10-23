import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {registerPages} from '../src/pages.js'
import {registerBlog} from '../src/blog.js'
import {registerPageLibrary} from '../src/pageLibrary.js'
import {registerDataTransfer} from '../src/dataTransfer.js'
import {registerSecurity,publicErrorHandler} from '../src/security.js'
import {parseCsv,readTransfer,transferFile} from '../../../shared/dataTransfer.js'
import {allowed} from '../src/identity.js'
import {createOrder} from '../src/commerce.js'
const textSection=title=>({id:randomUUID(),type:'text',title,text:'Body',image_url:'',alt:'',caption:'',button_text:'',button_url:''})
test('CSV and transfer formats preserve quoted newlines, Unicode and typed values without evaluating formulas',()=>{
 assert.deepEqual(parseCsv('\uFEFFname;phone\r\n"Иван; Петров";"+79991112233"\r\n'),[{name:'Иван; Петров',phone:'+79991112233'}])
 assert.deepEqual(parseCsv('name,description\n"A""B","first\nsecond"'),[{name:'A"B',description:'first\nsecond'}])
 for(const s of ['name,name\na,b','name\n"unclosed','name,phone\na','name\n"a"bad'])assert.throws(()=>parseCsv(s))
 const records=readTransfer({kind:'products',format:'csv',text:'name;price;stock;published\n=1+1;12,50;2;false'});assert.equal(records[0].name,'=1+1');assert.equal(records[0].price,12.5);assert.equal(records[0].published,false)
 for(const change of [{text:'{}'},{kind:'unknown'},{text:JSON.stringify(transferFile('customers',[]))},{text:'x'.repeat(4000001)}])assert.throws(()=>readTransfer({kind:'products',format:'json',text:JSON.stringify(transferFile('products',[{}])),...change}))
 assert.equal(allowed('editor','POST','/api/admin/pages/section-library'),true);assert.equal(allowed('editor','POST','/api/admin/transfer/apply'),false);assert.equal(allowed('manager','GET','/api/admin/transfer/export'),false)
})
test('PostgreSQL transfer and section library: preview isolation, conflict checks, atomic writes and protected preview',async t=>{
 let rejectWrite=false
 const pg=new PGlite(),query=async(sql,args)=>{if(rejectWrite&&sql.startsWith('INSERT INTO products ')&&args?.[0]==='FAIL-AFTER-FIRST'){rejectWrite=false;throw Object.assign(Error('test-only insertion conflict'),{code:'23505'})}const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve();const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}};pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify();registerSecurity(app,{perIp:1000});const key='transfer-only-test-secret-32-characters',{requireAdmin}=registerAuth(app,db,{setupKey:key});registerDataTransfer(app,db,requireAdmin);registerPages(app,db,requireAdmin);registerBlog(app,db,requireAdmin);registerPageLibrary(app,db,requireAdmin,{template:async()=>'<html><body><div id="app"></div></body></html>'});app.setErrorHandler(publicErrorHandler)
 const mutation={'x-nova-request':'1',origin:'http://localhost:5174'},setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:mutation,payload:{username:'transfer_admin',password:'test-only-transfer-password',setup_key:key}});assert.equal(setup.statusCode,201,setup.body)
 const auth={...mutation,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token},call=(method,url,payload,headers=auth)=>app.inject({method,url,payload,headers})
 const preview=async(kind,records,mode='create')=>{const r=await call('POST','/api/admin/transfer/preview',{kind,mode,format:'json',text:JSON.stringify(transferFile(kind,records))});assert.equal(r.statusCode,200,r.body);return r.json()}
 const apply=id=>call('POST','/api/admin/transfer/apply',{id,confirm:true})
 const count=async table=>Number((await query('SELECT COUNT(*) AS n FROM '+table)).rows[0].n)
 const product=(sku,name='Imported product')=>({name,category:'Imported category',price:12.34,sku,stock:5,description:'Description',published:false})
 try{
 await t.test('preflight and export need login and CSRF; a preview cannot write products',async()=>{
  assert.equal((await call('GET','/api/admin/transfer/export?kind=customers',undefined,{})).statusCode,401)
  assert.equal((await call('POST','/api/admin/transfer/preview',{}, {...auth,'x-csrf-token':'bad'})).statusCode,403)
  const before=await count('products'),r=await preview('products',[product('TRANSFER-1')]);assert.equal(r.valid,true);assert.equal(r.summary.create,1);assert.equal(await count('products'),before)
  assert.equal((await call('POST','/api/admin/transfer/apply',{id:r.id})).statusCode,400)
  const applied=await apply(r.id);assert.equal(applied.statusCode,200,applied.body);assert.equal(await count('products'),before+1);assert.equal((await apply(r.id)).json().duplicate,true);assert.equal(await count('products'),before+1)
  const exported=await call('GET','/api/admin/transfer/export?kind=products');assert.equal(exported.statusCode,200);const p=exported.json().records.find(p=>p.sku==='TRANSFER-1');assert.equal(p.price,12.34);for(const k of ['id','revision','password','box'])assert.equal(p[k],undefined)
 })
 await t.test('existing keys require merge; missing fields are preserved, unchanged rows are recognised',async()=>{
  let r=await preview('products',[{sku:'TRANSFER-1',price:15}]);assert.equal(r.valid,false);assert.equal(r.id,null)
  r=await preview('products',[{sku:'TRANSFER-1',price:15}],'merge');assert.equal(r.valid,true);assert.equal(r.summary.update,1);assert.ok(r.rows[0].changes.some(c=>c.field==='price'));assert.equal((await apply(r.id)).statusCode,200)
  const p=(await query('SELECT name,stock,price FROM products WHERE sku=$1',['TRANSFER-1'])).rows[0];assert.equal(p.name,'Imported product');assert.equal(p.stock,5);assert.equal(Number(p.price),15)
  r=await preview('products',[{sku:'TRANSFER-1',price:15}],'merge');assert.equal(r.summary.unchanged,1)
 })
 await t.test('duplicate keys, unknown fields, missing media, bad forms, unsafe URLs and excess precision block all writes',async()=>{
  for(const records of [[product('DUP'),product('DUP')],[{...product('BAD'),password:'not-a-field'}],[{...product('BAD'),price:12.345}],[{...product('BAD'),price:0.000001}],[{...product('BAD'),image_url:'/uploads/'+randomUUID()+'.png'}]]){const r=await preview('products',records);assert.equal(r.valid,false);assert.equal(r.id,null)}
  const page={title:'Page',slug:'transfer-invalid',content:'',published:false,sections:[{...textSection('Bad'),button_url:'javascript:alert(1)'}]};assert.equal((await preview('pages',[page])).valid,false)
  page.sections=[{id:randomUUID(),type:'form',form_id:randomUUID()}];assert.equal((await preview('pages',[page])).valid,false)
  assert.equal((await preview('pages',[{...page,slug:'order-status',sections:[]}])).valid,false)
 })
 await t.test('checkout after preview causes conflict and no partial import or stock loss',async()=>{
  await query("UPDATE products SET stock=5,published=TRUE WHERE sku='TRANSFER-1'");const p=(await query("SELECT id FROM products WHERE sku='TRANSFER-1'")).rows[0]
  const r=await preview('products',[product('NEW-BEFORE-CONFLICT'),{sku:'TRANSFER-1',stock:100}],'merge'),before=await count('products');assert.equal(r.valid,true)
  await createOrder(db,{request_id:randomUUID(),customer:{name:'Buyer',phone:'+79991112233',email:''},delivery:{method:'pickup',address:''},comment:'',items:[{product_id:Number(p.id),variant_name:'',quantity:1}]})
  const applied=await apply(r.id);assert.equal(applied.statusCode,409,applied.body);assert.equal(await count('products'),before);assert.equal((await query('SELECT stock FROM products WHERE id=$1',[p.id])).rows[0].stock,4)
 })
 await t.test('newly created matching key, expired preview and ownership block stale applies',async()=>{
  let r=await preview('products',[product('RACE')]);await query('INSERT INTO products(name,category,price,sku) VALUES($1,$2,$3,$4)',['Concurrent','Other',1,'RACE']);assert.equal((await apply(r.id)).statusCode,409)
  r=await preview('products',[product('EXPIRED')]);await query("UPDATE data_imports SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[r.id]);assert.equal((await apply(r.id)).statusCode,409)
  r=await preview('products',[product('OWNED')]);await query("INSERT INTO admin_accounts(username,password_hash,role) VALUES('other_admin','fake-test-only','admin')");const other=(await query("SELECT id FROM admin_accounts WHERE username='other_admin'")).rows[0];await query('UPDATE data_imports SET user_id=$1 WHERE id=$2',[other.id,r.id]);assert.equal((await apply(r.id)).statusCode,409)
 })
 await t.test('content and customer imports roundtrip; customer changes preserve order contact snapshots',async()=>{
  let r=await preview('customers',[{name:'Updated customer',phone:'8 (999) 111-22-33',email:'new@example.invalid',note:'Import note'}],'merge');assert.equal(r.valid,true);assert.equal(r.summary.update,1);assert.equal((await apply(r.id)).statusCode,200);assert.equal((await query('SELECT customer_name FROM orders LIMIT 1')).rows[0].customer_name,'Buyer')
  r=await preview('pages',[{title:'Imported page',slug:'imported-page',content:'Safe plain text <script>not executed</script>',sections:[textSection('Saved block')],published:false}]);assert.equal((await apply(r.id)).statusCode,200)
  r=await preview('posts',[{title:'Imported post',slug:'imported-post',excerpt:'Intro',content:'Body',category:'News',tags:['One'],cover_url:'',published:false}]);assert.equal((await apply(r.id)).statusCode,200)
  for(const kind of ['pages','posts','customers']){const exported=(await call('GET','/api/admin/transfer/export?kind='+kind)).json();r=await preview(kind,exported.records,'merge');assert.equal(r.valid,true);assert.equal(r.summary.unchanged,exported.records.length);assert.equal((await apply(r.id)).statusCode,200)}
 })
 await t.test('failure after a first write rolls back the whole file; concurrent replay applies once',async()=>{
  const r=await preview('products',[product('ATOMIC-1'),product('ATOMIC-2','FAIL-AFTER-FIRST')]),before=await count('products');assert.equal(r.valid,true);rejectWrite=true
  assert.equal((await apply(r.id)).statusCode,409);assert.equal(await count('products'),before);assert.equal((await query('SELECT applied_at FROM data_imports WHERE id=$1',[r.id])).rows[0].applied_at,null)
  const results=await Promise.all([apply(r.id),apply(r.id)]);assert.ok(results.every(x=>x.statusCode===200));assert.equal(results.filter(x=>x.json().duplicate).length,1);assert.equal(await count('products'),before+2)
 })
 await t.test('saved sections validate references and remain independent copies; preview is authenticated and embeddable only same-origin',async()=>{
  const section=textSection('Reusable');let r=await call('POST','/api/admin/pages/section-library',{title:'Reusable text',section});assert.equal(r.statusCode,201,r.body);const id=r.json().id
  const list=(await call('GET','/api/admin/pages/section-library')).json();assert.equal(list[0].section,undefined);assert.equal(list[0].type,'text')
  section.title='Changed editor';const saved=(await call('GET','/api/admin/pages/section-library/'+id)).json();assert.equal(saved.section.title,'Reusable')
  const missing={...textSection('Missing'),image_url:'/uploads/'+randomUUID()+'.png'};r=await call('POST','/api/admin/pages/section-library',{title:'Missing',section:missing});assert.equal(r.statusCode,400,r.body)
  r=await call('GET','/api/admin/pages/preview-frame',undefined,{});assert.equal(r.statusCode,401)
  r=await call('GET','/api/admin/pages/preview-frame');assert.equal(r.statusCode,200);assert.equal(r.headers['x-frame-options'],'SAMEORIGIN');assert.ok(r.headers['content-security-policy'].includes("frame-ancestors 'self'"));assert.ok(!r.body.includes('password'))
  assert.equal((await call('DELETE','/api/admin/pages/section-library/'+id)).statusCode,204)
 })
 }finally{await app.close();await pg.close()}
})
