import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { defaultSettings,validateSettings,registerSettings,registerShopGuard } from '../src/settings.js'

test('settings reject invalid titles, unsafe menus, invalid home IDs and external logos',()=>{
 assert.equal(validateSettings(defaultSettings),null)
 for(const patch of [{name:' '},{logo_url:'https://evil.test/logo.png'},{home_page_id:7},{home_page_id:'0'},{home_page_id:'abc'},{shop_enabled:'false'},{blog_enabled:'false'},{menu:[{label:'test',url:'//evil.test'}]},{menu:[{label:'test',url:'javascript:alert(1)'}]},{menu:[{label:'',url:'/'}]}]) assert.ok(validateSettings({...defaultSettings,...patch}))
 assert.equal(validateSettings({...defaultSettings,home_page_id:'17',menu:[{label:'О нас',url:'/about'},{label:'Внешний сайт',url:'https://example.com'}]}),null)
})

test('settings auth, published homepage validation, storage, and catalog guard',async()=>{
 const app=Fastify();let settings={...defaultSettings,home_slug:null};let updated=0
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT id FROM pages'))return {rowCount:args[0]==='7'?1:0,rows:[]}
  if(sql.startsWith('UPDATE site_settings')){updated++;settings={name:args[0],logo_url:args[1],home_page_id:args[2],shop_enabled:args[3],blog_enabled:args[5]??settings.blog_enabled,menu:JSON.parse(args[4]),home_slug:args[2]==='7'?'landing':null};return {rowCount:1}}
  return {rowCount:1,rows:[settings]}
 }}
 const auth=(req,reply,done)=>{if(req.headers['x-admin-key']!=='secret')return reply.code(401).send({error:'Unauthorized'});done()}
 registerSettings(app,pool,auth)
 app.get('/api/products',()=>[{id:1}])
 app.get('/api/products/:id',()=>({id:1}))
 app.get('/api/categories',()=>[])
 // Match the application ordering: hook is registered after the existing page routes.
 registerShopGuard(app,pool,'secret')
 try{
  assert.equal((await app.inject('/api/settings')).json().shop_enabled,true)
  assert.equal((await app.inject({method:'PUT',url:'/api/admin/settings',payload:defaultSettings})).statusCode,401)
  const write=payload=>app.inject({method:'PUT',url:'/api/admin/settings',headers:{'x-admin-key':'secret'},payload})
  assert.equal((await write({...defaultSettings,home_page_id:'8'})).statusCode,400);assert.equal(updated,0)
  const result=await write({...defaultSettings,name:'Мой сайт',shop_enabled:false,home_page_id:'7',menu:[{label:'Контакты',url:'/contacts'},{label:'Главная',url:'/'}]})
  assert.equal(result.statusCode,200);assert.equal(result.json().home_slug,'landing');assert.equal(result.json().menu[0].url,'/contacts')
  for(const url of ['/api/products','/api/products/1','/api/categories?all=1'])assert.equal((await app.inject(url)).statusCode,404)
  assert.equal((await app.inject({url:'/api/products',headers:{'x-admin-key':'wrong'}})).statusCode,404)
  assert.equal((await app.inject({url:'/api/products',headers:{'x-admin-key':'secret'}})).statusCode,200)
  assert.equal((await app.inject('/api/settings')).statusCode,200)
  await write({...defaultSettings,blog_enabled:true})
  assert.equal((await app.inject('/api/settings')).json().blog_enabled,true)
  const legacy={...defaultSettings};delete legacy.blog_enabled
  await write(legacy)
  assert.equal((await app.inject('/api/settings')).json().blog_enabled,true)
  assert.equal((await app.inject('/api/products')).statusCode,200)
 }finally{await app.close()}
})
