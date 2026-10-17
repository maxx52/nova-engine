import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {readFile,mkdtemp,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Script} from 'node:vm'
import {packDirectory} from '../../../scripts/theme-pack.mjs'
import {validatePackage,validateActiveTheme,validateThemeAction,publicNavigation,activeThemeFromPackage} from '../../../shared/themes.js'
import {designValue,validateDesign} from '../../../shared/siteDesign.js'
import {registerThemes,applyThemeDesign} from '../src/themes.js'
import {registerDesign} from '../src/design.js'
import {registerAuth} from '../src/auth.js'
import {pool,initDatabase} from '../src/db.js'
import {codeFrameDocument} from '../src/codeFrame.js'
const themePath=new URL('../../../examples/themes/nova-studio/theme.nova.json',import.meta.url),templatePath=new URL('../../../examples/templates/contact-page/template.nova.json',import.meta.url)
const theme=JSON.parse(await readFile(themePath,'utf8')),pageTemplate=JSON.parse(await readFile(templatePath,'utf8'))

test('theme and page packages validate a portable versioned format and reject unsafe shapes and sizes',()=>{
 assert.equal(validatePackage(theme),null);assert.equal(validatePackage(pageTemplate),null)
 for(const change of [p=>p.apiVersion=2,p=>p.format='php',p=>p.install='run.sh',p=>p.manifest.id='../escape',p=>p.manifest.id='__proto__',p=>p.manifest.version='latest',p=>p.style.colors.primary='red;url(https://bad.invalid)',p=>p.templates.admin={html:'',css:'',js:''},p=>p.templates.home.js='a'.repeat(50001),p=>p.settings_schema.push(p.settings_schema[0]),p=>p.settings_schema[2].default='123e4567-e89b-42d3-a456-426614174000',p=>p.style.font='url(https://bad.invalid)',p=>p.style.home_order=['hero','hero','catalog']]){const p=structuredClone(theme);change(p);assert.ok(validatePackage(p))}
 const huge=structuredClone(theme);huge.style.site_css='界'.repeat(100000);for(const code of Object.values(huge.templates))code.html='界'.repeat(50000);assert.ok(validatePackage(huge))
 const wrong=structuredClone(pageTemplate);wrong.page.sections[1].form_id='123e4567-e89b-42d3-a456-426614174000';assert.ok(validatePackage(wrong))
 const active=activeThemeFromPackage(theme);assert.equal(validateActiveTheme(active),null);active.settings['not-declared']='bad';assert.ok(validateActiveTheme(active))
 const before=designValue();before.texts.hero_title='Owner text';before.hero_button_url='/owner';before.code.enabled=true;before.code.global_css='old css';const after=applyThemeDesign(before,theme)
 assert.equal(after.texts.hero_title,'Owner text');assert.equal(after.hero_button_url,'/owner');assert.equal(after.code.enabled,false);assert.equal(after.theme.manifest.id,theme.manifest.id);assert.equal(validateDesign(after),null);assert.equal(before.theme,null)
})
test('theme API only admits bounded cart/form actions and public navigation; bootstrap syntax remains executable',()=>{
 assert.equal(validateThemeAction('cart.add',{product_id:1,variant_name:'',quantity:1}),null)
 assert.equal(validateThemeAction('cart.open',{}),null);assert.equal(validateThemeAction('forms.open',{form_id:'123e4567-e89b-42d3-a456-426614174000'}),null)
 for(const value of [{product_id:'1',variant_name:'',quantity:1},{product_id:1,variant_name:'',quantity:101},{product_id:1,variant_name:'',quantity:1,price:0.01}])assert.ok(validateThemeAction('cart.add',value))
 for(const action of ['orders.create','payments.paid','admin.read','fetch'])assert.ok(validateThemeAction(action,{}))
 for(const path of ['/admin','/%2fadmin','/%61dmin/','/api/auth/me','//evil.ru','/uploads/a.png','/%5cadmin','https://evil.ru'])assert.equal(publicNavigation(path),false,path)
 for(const path of ['/catalog','/product/1','/about','/blog?tag=test','/#catalog'])assert.equal(publicNavigation(path),true,path)
 const document=codeFrameDocument('test-nonce'),runtime=document.match(/<script nonce="test-nonce">([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new Script(runtime))
})
test('bundled examples are reproducible from source and packer refuses links escaping its directory',async()=>{
 assert.deepEqual(await packDirectory(new URL('../../../examples/themes/nova-studio',import.meta.url)),theme)
 assert.deepEqual(await packDirectory(new URL('../../../examples/templates/contact-page',import.meta.url)),pageTemplate)
 const dir=await mkdtemp(join(tmpdir(),'nova-theme-'));try{
  await writeFile(join(dir,'outside.json'),JSON.stringify({...theme,manifest:theme.manifest}));const inner=join(dir,'inner');await import('node:fs/promises').then(fs=>fs.mkdir(inner));try{await symlink(join(dir,'outside.json'),join(inner,'manifest.json'))}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}await assert.rejects(packDirectory(inner))
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('PostgreSQL package lifecycle: auth, revisions, draft-only application, publishing, export and history',async()=>{
 const pg=new PGlite(),query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve();const db={query,connect:async()=>{const old=tail;let release;tail=new Promise(r=>release=r);await old;return {query,release}}};pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify(),key='themes-only-test-setup-key-32-characters';const {requireAdmin}=registerAuth(app,db,{setupKey:key});registerThemes(app,db,requireAdmin);registerDesign(app,db,requireAdmin)
 const headers={'x-nova-request':'1',origin:'http://localhost:5174'};const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers,payload:{username:'test_admin',password:'temporary-test-password-only',setup_key:key}});assert.equal(setup.statusCode,201,setup.body)
 const auth={...headers,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token},call=(method,url,payload,h=auth)=>app.inject({method,url,payload,headers:h})
 try{
  for(const url of ['/api/admin/packages','/api/admin/packages/examples','/api/admin/packages/active-export','/api/admin/packages/theme/nova-studio'])assert.equal((await call('GET',url,undefined,{})).statusCode,401)
  assert.equal((await call('POST','/api/admin/packages',{package:theme},{})).statusCode,401)
  assert.equal((await call('POST','/api/admin/packages',{package:theme},{...auth,'x-csrf-token':'bad'})).statusCode,403)
  assert.equal((await call('GET','/api/admin/packages/examples')).json().length,2)
  let d=(await call('GET','/api/admin/design')).json();d.draft.texts.hero_title='Preserve owner content';d.draft.code.enabled=true;d=(await call('PUT','/api/admin/design',d)).json();const rev=d.revision
  const saved=await call('POST','/api/admin/packages',{package:theme});assert.equal(saved.statusCode,201,saved.body);assert.equal((await call('GET','/api/design')).json().theme,null)
  const installed=saved.json();assert.equal((await call('POST','/api/admin/packages',{package:theme})).statusCode,409)
  assert.equal((await call('POST','/api/admin/themes/nova-studio/apply',{design_revision:'1',package_revision:installed.revision})).statusCode,409)
  const applied=await call('POST','/api/admin/themes/nova-studio/apply',{design_revision:rev,package_revision:installed.revision});assert.equal(applied.statusCode,200,applied.body)
  assert.equal((await call('GET','/api/design')).json().theme,null)
  const active=(await call('GET','/api/admin/design')).json();assert.equal(active.draft.texts.hero_title,'Preserve owner content');assert.equal(active.draft.theme.manifest.id,'nova-studio');assert.equal(active.draft.code.enabled,false)
  const history=(await call('GET','/api/admin/design/versions')).json();assert.equal(history[0].action,'before-theme')
  const pub=await call('POST','/api/admin/design/publish',{revision:active.revision});assert.equal(pub.statusCode,200,pub.body)
  assert.equal((await call('GET','/api/design')).json().theme.manifest.id,'nova-studio')
  assert.equal((await call('GET','/api/design/style.css')).body,theme.style.site_css)
  const exported=(await call('GET','/api/admin/packages/active-export')).json();assert.equal(validatePackage(exported),null);assert.equal(exported.settings_schema[2].default,'');assert.equal(exported.texts,undefined);assert.equal(exported.orders,undefined)
  const template=await call('POST','/api/admin/packages',{package:pageTemplate});assert.equal(template.statusCode,201,template.body)
  assert.deepEqual((await call('GET','/api/admin/packages/template/contact-page')).json().package,pageTemplate)
  const updated=await call('POST','/api/admin/packages',{package:{...theme,manifest:{...theme.manifest,version:'1.0.1'}},revision:installed.revision});assert.equal(updated.statusCode,200,updated.body)
  assert.equal((await call('GET','/api/design')).json().theme.manifest.version,'1.0.0')
  assert.equal((await call('POST','/api/admin/themes/nova-studio/apply',{design_revision:pub.json().revision,package_revision:installed.revision})).statusCode,409)
  const restore=(await call('GET','/api/admin/design/versions/'+history[0].id)).json();assert.equal(restore.theme,null)
  assert.equal((await call('PUT','/api/admin/design',{revision:pub.json().revision,draft:restore})).statusCode,200)
  assert.equal((await call('GET','/api/design')).json().theme.manifest.id,'nova-studio')
 }finally{await app.close();await pg.close()}
})
