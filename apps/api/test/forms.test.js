import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {registerForms,submitContact,deliverContactJob,maintainContacts,formChallenges} from '../src/forms.js'
import {secretVault,publicIPv4,smtpAddress,sendEmail,sendTelegram,notificationText} from '../src/formDelivery.js'
import {defaultForm,defaultFormSettings,validateForm,validateFormSettings,emailAddress} from '../../../shared/forms.js'
import {validateSections} from '../src/pages.js'

test('contact forms validate fields, section insertion, SMTP profiles and strict addresses',()=>{
 assert.equal(validateForm(defaultForm),null);assert.equal(validateFormSettings(defaultFormSettings),null)
 for(const change of [x=>x.channels=[],x=>x.fields.push({...x.fields[0]}),x=>x.fields[0].key='constructor',x=>x.privacy_url='javascript:alert(1)',x=>x.fields[0].required='yes',x=>x.title='Bad\r\nBcc: bad@elsewhere.ru']){const x=structuredClone(defaultForm);change(x);assert.ok(validateForm(x))}
 const relay={...structuredClone(defaultFormSettings),email:{enabled:true,mode:'1gb',host:'robots.1gb.ru',port:25,tls:'relay',user:'',from:'forms@shop.ru',to:['owner@shop.ru']}}
 assert.equal(validateFormSettings(relay),null)
 for(const change of [x=>x.email.host='mail1.1gb.ru',x=>x.email.user='password',x=>x.email.port=465]){const x=structuredClone(relay);change(x);assert.ok(validateFormSettings(x))}
 for(const value of ['a@site.ru\n','a@site.ru\r\nBcc:b@site.ru','Name <a@site.ru>'])assert.equal(emailAddress(value),false)
 assert.equal(validateSections([{id:'section1',type:'form',form_id:randomUUID()}]),null);assert.ok(validateSections([{id:'section1',type:'form',form_id:'bad'}]))
})
test('form challenges bind the form and revision and expire without accepting instant bot submissions',()=>{
 let time=1792224000000;const id=randomUUID(),tokens=formChallenges('only-test-key',()=>time),token=tokens.issue(id,2)
 assert.equal(tokens.verify(token,id,2),false);time+=2000;assert.equal(tokens.verify(token,id,2),true)
 assert.equal(tokens.verify(token,randomUUID(),2),false);assert.equal(tokens.verify(token,id,3),false)
 assert.equal(tokens.verify(token.slice(0,-1),id,2),false);time+=1800001;assert.equal(tokens.verify(token,id,2),false)
})
test('secrets are authenticated, randomized and cannot be decrypted with a different server key',()=>{
 const vault=secretVault('only-test-root-key'),value={smtp_password:'private-test-password',bot_token:'private-test-token'},a=vault.seal(value),b=vault.seal(value)
 assert.notEqual(a,b);assert.ok(!a.includes(value.smtp_password));assert.deepEqual(vault.open(a),value)
 assert.throws(()=>secretVault('different-key').open(a));const broken=Buffer.from(a,'base64');broken[30]^=1;assert.throws(()=>vault.open(broken.toString('base64')))
})
test('SMTP resolves and pins only public IPv4 addresses; TLS, sender, Reply-To and safe MIME are enforced',async()=>{
 for(const value of ['127.0.0.1','10.1.2.3','172.16.1.2','169.254.169.254','192.168.1.1','100.100.100.200','0.0.0.0','224.1.2.3','198.18.0.1','192.0.2.1','198.51.100.2'])assert.equal(publicIPv4(value),false,value)
 assert.equal(publicIPv4('8.8.8.8'),true)
 await assert.rejects(smtpAddress('smtp.test',async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}]),e=>e.code==='EHOSTPOLICY')
 let options,mail,closed=false
 const config={email:{host:'smtp.provider.ru',port:465,tls:'implicit',mode:'smtp',user:'login',from:'forms@shop.ru',to:['owner@shop.ru']},smtp_password:'test-password'}
 const message={number:'F000001',title:'Форма',delivery_id:randomUUID(),consent_label:'Согласен',fields:[{key:'email',label:'Email',type:'email'},{key:'message',label:'Сообщение',type:'textarea'}],values:{email:'visitor@other.ru',message:'<script>text</script>\n'.repeat(100)},source:'/contacts'}
 const result=await sendEmail(config,message,{resolve:async()=>[{address:'8.8.8.8'}],createTransport:o=>{options=o;return {sendMail:async m=>{mail=m;return {accepted:['owner@shop.ru'],rejected:[]}},close(){closed=true}}}})
 assert.equal(options.host,'8.8.8.8');assert.equal(options.tls.servername,'smtp.provider.ru');assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.secure,true);assert.equal(options.disableUrlAccess,true);assert.equal(options.disableFileAccess,true)
 assert.equal(mail.from,'forms@shop.ru');assert.equal(mail.replyTo,'visitor@other.ru');assert.equal(mail.textEncoding,'quoted-printable');assert.ok(mail.text.includes('<script>text</script>'));assert.equal(mail.html,undefined);assert.equal(closed,true);assert.equal(result.partial,false)
 await sendEmail({...config,email:{...config.email,mode:'1gb',host:'robots.1gb.ru',port:25,tls:'relay',user:''}},message,{resolve:async()=>[{address:'8.8.8.8'}],createTransport:o=>{assert.equal(o.auth,undefined);assert.equal(o.requireTLS,false);return {sendMail:async()=>({}),close(){}}}})
})
test('Telegram uses a fixed HTTPS API, plain text, bounded messages, retry_after and unknown outcomes',async()=>{
 const config={bot_token:'12345:test-token',telegram:{chat_id:'-100123456'}},message={title:'Test',number:'F000001',consent_label:'yes',fields:[{key:'body',label:'Message'}],values:{body:'<b>Plain text</b> 🙂'.repeat(600)}}
 let body
 await sendTelegram(config,message,{fetcher:async(url,opts)=>{assert.equal(url,'https://api.telegram.org/bot12345:test-token/sendMessage');assert.equal(opts.redirect,'error');body=JSON.parse(opts.body);return new Response(JSON.stringify({ok:true,result:{message_id:123}}),{status:200})}})
 assert.equal(body.chat_id,'-100123456');assert.equal(body.parse_mode,undefined);assert.ok(body.text.length<4096);assert.ok(Array.from(body.text).length<4096);assert.ok(body.text.includes('Сокращено'));assert.ok(body.text.includes('<b>Plain text</b>'))
 await assert.rejects(sendTelegram(config,message,{fetcher:async()=>new Response(JSON.stringify({parameters:{retry_after:1234}}),{status:429})}),e=>e.code==='ETELEGRAM_LIMIT'&&e.retry_after===1234)
 await assert.rejects(sendTelegram(config,message,{fetcher:async()=>{throw Error('private token in network error')}}),e=>e.uncertain===true)
 await assert.rejects(sendTelegram(config,message,{fetcher:async()=>new Response('bad',{status:502})}),e=>e.uncertain===true)
 await assert.rejects(sendTelegram(config,message,{fetcher:async()=>new Response(JSON.stringify({ok:false,description:'private'}),{status:403})}),e=>e.code==='ETELEGRAM_REJECTED'&&!e.message.includes('private'))
})

test('PostgreSQL contact lifecycle: privacy, atomic acceptance, queue isolation, unknown results and retention',async t=>{
 const pg=new PGlite(),query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve();const db={query,connect:async()=>{const prev=tail;let release;tail=new Promise(r=>release=r);await prev;return {query,release}}};pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify(),secret='test-only-contact-key-with-32-characters',vault=secretVault(secret);let time=Date.now()
 const {requireAdmin}=registerAuth(app,db,{setupKey:secret})
 const registered=registerForms(app,db,requireAdmin,{secret,origins:['http://localhost:5173'],worker:false,now:()=>time})
 const mutation={'x-nova-request':'1',origin:'http://localhost:5174'}
 const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:mutation,payload:{username:'test_admin',password:'only-test-temporary-password',setup_key:secret}})
 assert.equal(setup.statusCode,201,setup.body)
 const auth={...mutation,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token},publicHeaders={'x-nova-form':'1',origin:'http://localhost:5173'}
 const call=(method,url,payload,headers=auth)=>app.inject({method,url,payload,headers})
 const state=async()=>query('SELECT channel,state,attempts,error_code FROM contact_deliveries ORDER BY channel')
 try{
  for(const path of ['/api/admin/forms','/api/admin/forms/settings','/api/admin/forms/messages'])assert.equal((await call('GET',path,undefined,{})).statusCode,401)
  let settings=(await call('GET','/api/admin/forms/settings')).json();assert.equal(settings.enabled,false)
  const input={...settings,enabled:true,email:{enabled:true,mode:'smtp',host:'smtp.provider.ru',port:587,tls:'starttls',user:'forms@shop.ru',from:'forms@shop.ru',to:['owner@shop.ru']},telegram:{enabled:true,chat_id:'-100123456'},smtp_password:'PRIVATE_TEST_PASSWORD',bot_token:'123456789:abcdefghijklmnopqrstuvwxyz_012345'}
  assert.equal((await call('PUT','/api/admin/forms/settings',input,{...auth,'x-csrf-token':'bad'})).statusCode,403)
  let saved=await call('PUT','/api/admin/forms/settings',input);assert.equal(saved.statusCode,200,saved.body);settings=saved.json();assert.equal(settings.smtp_password,undefined);assert.equal(settings.bot_token,undefined);assert.equal(settings.smtp_password_set,true)
  const encrypted=(await query('SELECT secret_box,config FROM contact_settings')).rows[0];assert.ok(!JSON.stringify(encrypted).includes('PRIVATE_TEST_PASSWORD'))
  assert.equal((await call('PUT','/api/admin/forms/settings',input)).statusCode,409)
  settings=(await call('PUT','/api/admin/forms/settings',{...settings,smtp_password:'',bot_token:''})).json();assert.equal(settings.bot_token_set,true)
  const created=await call('POST','/api/admin/forms',{...defaultForm,enabled:true,channels:['email','telegram']});assert.equal(created.statusCode,201,created.body);const form=created.json()
  const get=await call('GET','/api/forms/'+form.id,undefined,{});assert.equal(get.statusCode,200,get.body);const publicForm=get.json();assert.equal(publicForm.available,true);assert.ok(!get.body.includes('owner@shop.ru'));assert.equal(publicForm.channels,undefined);assert.equal(publicForm.telegram,undefined)
  const payload={request_id:randomUUID(),challenge:publicForm.challenge,consent:true,website:'',source:'/contacts?private=not-saved',values:{name:'Visitor',email:'visitor@other.ru',message:'Private text <script>not executable</script>'}}
  const submit=()=>call('POST','/api/forms/'+form.id+'/submit',payload,publicHeaders)
  assert.equal((await submit()).statusCode,409);assert.equal((await query('SELECT COUNT(*)::int AS n FROM contact_submissions')).rows[0].n,0)
  time+=3000
  assert.equal((await call('POST','/api/forms/'+form.id+'/submit',payload,{})).statusCode,403)
  assert.equal((await call('POST','/api/forms/'+form.id+'/submit',payload,{...publicHeaders,origin:'https://evil.ru'})).statusCode,403)
  assert.equal((await call('POST','/api/forms/'+form.id+'/submit',{...payload,consent:false},publicHeaders)).statusCode,400)
  assert.equal((await call('POST','/api/forms/'+form.id+'/submit',{...payload,website:'spam'},publicHeaders)).statusCode,202);assert.equal((await query('SELECT COUNT(*)::int AS n FROM contact_submissions')).rows[0].n,0)
  const [one,two]=await Promise.all([submit(),submit()]);assert.equal(one.statusCode,202,one.body);assert.deepEqual(one.json(),two.json());assert.ok(!one.body.includes('visitor@other.ru'));assert.equal((await query('SELECT COUNT(*)::int AS n FROM contact_submissions')).rows[0].n,1)
  assert.equal((await state()).rows.length,2);assert.equal((await query('SELECT source FROM contact_submissions')).rows[0].source,'')
  assert.equal((await call('POST','/api/forms/'+form.id+'/submit',{...payload,values:{...payload.values,message:'Changed'}},publicHeaders)).statusCode,409)
  let emailCalls=0,telegramCalls=0
  const transports={email:async(c,m)=>{emailCalls++;assert.equal(c.smtp_password,'PRIVATE_TEST_PASSWORD');assert.ok(!c.bot_token);assert.ok(notificationText(m).includes('visitor@other.ru'));return {}},telegram:async(c,m)=>{telegramCalls++;assert.equal(c.smtp_password,undefined);throw Object.assign(Error('private text'),{code:'ETELEGRAM_UNKNOWN',uncertain:true})}}
  while(await deliverContactJob(db,vault,{transports})){}
  assert.equal(emailCalls,1);assert.equal(telegramCalls,1)
  let rows=(await state()).rows;assert.deepEqual(rows.map(x=>x.state),['sent','uncertain']);assert.equal(rows[1].error_code,'RESULT_UNKNOWN')
  assert.equal(await deliverContactJob(db,vault,{transports}),false)
  const list=await call('GET','/api/admin/forms/messages');assert.equal(list.statusCode,200,list.body);assert.equal(list.json().total,1)
  const mid=list.json().rows[0].id;const detail=(await call('GET','/api/admin/forms/messages/'+mid)).json();assert.equal(detail.values.email,'visitor@other.ru');assert.equal(detail.secret_box,undefined);assert.ok(detail.deliveries.every(x=>!x.secret_box))
  const telegram=detail.deliveries.find(x=>x.channel==='telegram')
  assert.equal((await call('POST','/api/admin/forms/deliveries/'+telegram.id+'/retry',{acknowledge_duplicate:false})).statusCode,400)
  assert.equal((await call('POST','/api/admin/forms/deliveries/'+telegram.id+'/retry',{acknowledge_duplicate:true})).statusCode,200)
  assert.equal(await deliverContactJob(db,vault,{transports:{...transports,telegram:async()=>{telegramCalls++;return {external_id:'77'}}}}),true)
  assert.equal(emailCalls,1);assert.equal(telegramCalls,2);assert.equal((await state()).rows[1].state,'sent')
  assert.ok((await query('SELECT secret_box FROM contact_deliveries')).rows.every(x=>x.secret_box===''))
  assert.equal((await call('PUT','/api/admin/forms/messages/'+mid,{status:'closed',revision:1})).statusCode,200);assert.equal((await call('PUT','/api/admin/forms/messages/'+mid,{status:'new',revision:1})).statusCode,409)
  for(let i=0;i<4;i++)assert.equal((await call('POST','/api/forms/'+form.id+'/submit',{...payload,request_id:randomUUID()},publicHeaders)).statusCode,202)
  assert.equal((await call('POST','/api/forms/'+form.id+'/submit',{...payload,request_id:randomUUID()},publicHeaders)).statusCode,429)
  await query("UPDATE contact_submissions SET created_at=NOW()-INTERVAL '91 days'");await maintainContacts(db,90)
  assert.equal((await query('SELECT COUNT(*)::int AS n FROM contact_submissions')).rows[0].n,0);assert.equal((await state()).rows.length,0)
  settings=(await call('PUT','/api/admin/forms/settings',{...settings,enabled:false})).json()
  assert.equal((await call('GET','/api/forms/'+form.id)).json().available,false)
  assert.equal((await call('POST','/api/admin/forms/test',{channel:'email'})).statusCode,400)
  settings=(await call('PUT','/api/admin/forms/settings',{...settings,enabled:true})).json()
  assert.equal((await call('POST','/api/admin/forms/test',{channel:'email'})).statusCode,202)
  const unavailable={email:async()=>{throw Object.assign(Error('No connection'),{code:'ETIMEDOUT',command:'CONN'})}}
  for(let i=0;i<3;i++){await query("UPDATE contact_deliveries SET not_before=NOW()-INTERVAL '1 second'");assert.equal(await deliverContactJob(db,vault,{transports:unavailable}),true)}
  assert.equal((await state()).rows[0].state,'failed');assert.equal((await state()).rows[0].attempts,3)
  await query("UPDATE contact_deliveries SET state='sending',started_at=NOW()-INTERVAL '3 minutes'");await maintainContacts(db,90)
  assert.equal((await state()).rows[0].state,'uncertain');assert.equal(await deliverContactJob(db,vault,{transports:unavailable}),false)
  await call('POST','/api/admin/forms/test',{channel:'email'});await call('POST','/api/admin/forms/test',{channel:'telegram'})
  settings=(await call('PUT','/api/admin/forms/settings',{...settings,email:{...settings.email,enabled:false}})).json()
  let tg=0;assert.equal(await deliverContactJob(db,vault,{transports:{email:async()=>assert.fail('disabled channel'),telegram:async()=>{tg++;return {}}}}),true)
  assert.equal(tg,1);assert.equal((await query("SELECT COUNT(*)::int AS n FROM contact_deliveries WHERE channel='email' AND state='queued'")).rows[0].n,1)

 }finally{await app.close();await pg.close()}
})
