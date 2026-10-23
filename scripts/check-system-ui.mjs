// CI only: the isolated localhost deployment, with system commands intercepted.
import assert from 'node:assert/strict'
import {PRODUCT_VERSION} from '../config/release.js'
const {chromium}=await import(process.env.NOVA_PLAYWRIGHT_MODULE)
const browser=await chromium.launch({executablePath:process.env.NOVA_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
// This is the disposable Caddy localhost CA; Python has already verified its TLS chain.
const context=await browser.newContext({ignoreHTTPSErrors:true})
const page=await context.newPage(),commands=[],errors=[]
page.on('pageerror',e=>errors.push(e.message))
const backupId='20261018T100000Z-abcdef12'
const status={available:true,protocol:1,current_version:PRODUCT_VERSION,installed_version:PRODUCT_VERSION,release:{version:'99.0.0',title:'Test release',notes:'<img src=x onerror=alert(1)>',url:'https://github.com/maxx52/nova-engine/releases/tag/v99.0.0'},checked_at:new Date().toISOString(),schedule:{enabled:false,hour_utc:3,retention_days:7},active:null,jobs:[],backups:[{id:backupId,created_at:new Date().toISOString(),version:'0.21.0',verified:true,size_bytes:1048576,reason:'ci'}]}
await page.route('**/api/admin/system**',async route=>{
 const req=route.request()
 if(req.method()==='POST')commands.push(req.postDataJSON())
 await route.fulfill({status:req.method()==='POST'?202:200,contentType:'application/json',body:JSON.stringify(req.method()==='POST'?{id:'ci-job'}:status)})
})
async function waitForCommand(count){const until=Date.now()+5000;while(commands.length<count&&Date.now()<until)await new Promise(r=>setTimeout(r,25));await page.waitForFunction(()=>!document.querySelector('.system-workspace .system-heading button')?.disabled);assert.equal(commands.length,count)}
try{
 await page.goto('https://localhost/admin/')
 await page.getByLabel('Логин',{exact:true}).fill('ci_admin')
 await page.getByLabel('Пароль',{exact:true}).fill('ci-only-disposable-password-8241')
 await page.getByRole('button',{name:'Войти',exact:true}).click()
 await page.getByRole('button',{name:/Обновления и копии/}).click()
 await page.getByRole('heading',{name:'Доступно обновление 99.0.0'}).waitFor()
 assert.equal(commands.length,0,'no update or backup is started just by opening the screen')
 await page.getByText('Что изменилось',{exact:true}).click()
 assert.equal(await page.locator('.release-notes img').count(),0)
 assert.match(await page.locator('.release-notes').textContent(),/onerror/)
 page.once('dialog',dialog=>dialog.accept())
 await page.getByRole('button',{name:'Создать копию и обновить',exact:true}).click()
 await waitForCommand(1);assert.deepEqual(commands[0],{kind:'update',version:'99.0.0'})
 await page.getByRole('button',{name:'Создать и проверить копию',exact:true}).click()
 await waitForCommand(2);assert.deepEqual(commands[1],{kind:'backup'})
 await page.getByLabel('Включить ежедневную полную копию').check()
 await page.getByLabel('Час по UTC').selectOption('20')
 await page.getByRole('button',{name:'Сохранить расписание',exact:true}).click()
 await waitForCommand(3);assert.deepEqual(commands[2],{kind:'schedule',enabled:true,hour_utc:20,retention_days:7})
 await page.getByRole('button',{name:'Восстановить…',exact:true}).click()
 const restore=page.getByRole('button',{name:'Восстановить выбранную копию',exact:true})
 assert.equal(await restore.isDisabled(),true)
 await page.getByLabel('Введите ВОССТАНОВИТЬ').fill('ВОССТАНОВИТЬ')
 page.once('dialog',dialog=>dialog.accept())
 await restore.click()
 await waitForCommand(4);assert.deepEqual(commands[3],{kind:'restore',backup_id:backupId,confirm:'ВОССТАНОВИТЬ'})
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true)
 await page.setViewportSize({width:1280,height:900})
 status.current_version='99.0.0';status.installed_version='99.0.0';status.active={kind:'update',phase:'apply'}
 await page.getByRole('button',{name:'Проверить релизы',exact:true}).click()
 await page.getByRole('heading',{name:'Обновление CMS',exact:true}).waitFor()
 assert.ok(!page.url().includes('nova_version='),'no reload during an active installation')
 status.active=null
 await page.waitForURL('**/admin/?nova_version=99.0.0')
 await page.getByRole('heading',{name:/Добро пожаловать/}).waitFor()
 await page.getByRole('button',{name:/Обновления и копии/}).click()
 await page.getByText('Установленная версия: 99.0.0',{exact:true}).waitFor()
 // The mocked version cannot change this bundle: returning to the same screen
 // must show its status rather than repeatedly reloading the document.
 status.current_version=PRODUCT_VERSION;status.installed_version=PRODUCT_VERSION
 await page.getByRole('button',{name:'Проверить релизы',exact:true}).click()
 await page.getByText('Установленная версия: '+PRODUCT_VERSION,{exact:true}).waitFor()
 await (await import('./check-seo-ui.mjs')).runSeoChecks(page)
 await (await import('./check-order-operations-ui.mjs')).runOrderOperationsChecks(page)
 await (await import('./check-editor-transfer-ui.mjs')).runEditorTransferChecks(page)
 await (await import('./check-content-recovery-ui.mjs')).runContentRecoveryChecks(page)
 await (await import('./check-identity-ui.mjs')).runIdentityChecks(page)
 assert.deepEqual(errors,[])
 console.log('PASS system UI: release notes escaped, update is explicit, backup/schedule commands valid, restore requires typed confirmation, mobile width fits; completed update refreshes the admin once')
}catch(e){console.log('::error title=System UI::'+String(e).replaceAll('%','%25').replaceAll('\n','%0A'));throw e}finally{await browser.close()}
