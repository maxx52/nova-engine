// Built storefront + real PostgreSQL, with a CI-only captured email transport.
import {execFileSync} from 'node:child_process'
import http from 'node:http'
import assert from 'node:assert/strict'
const docker=['compose','--env-file','.env','-f','deploy/docker/compose.yaml']
const run=args=>execFileSync('docker',[...docker,...args],{stdio:'pipe'})
run(['exec','-T','db','sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" createdb -h 127.0.0.1 -U postgres -O nova_app nova_customer_ci'])
run(['cp','scripts/check-customer-server.mjs','api:/app/check-customer-server.mjs'])
run(['exec','-T','-d','api','node','/app/check-customer-server.mjs'])
const proxy=http.createServer((req,res)=>{const upstream=http.request({hostname:'172.30.92.3',port:3002,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});upstream.on('error',()=>{res.statusCode=503;res.end()});req.pipe(upstream)})
await new Promise(resolve=>proxy.listen(5175,'127.0.0.1',resolve))
const origin='http://127.0.0.1:5175'
const {chromium}=await import(process.env.NOVA_PLAYWRIGHT_MODULE)
const browser=await chromium.launch({executablePath:process.env.NOVA_CHROME||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']})
const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
async function login(p,email){await p.goto(origin+'/account');await p.getByLabel('Электронная почта',{exact:true}).fill(email);await p.getByRole('button',{name:'Получить код входа',exact:true}).click();let code;for(let i=0;i<100;i++){const rows=await (await fetch(origin+'/__test/messages')).json();code=rows.find(r=>r.email===email)?.code;if(code)break;await new Promise(r=>setTimeout(r,100))}assert.ok(code);await p.getByLabel('Код из письма',{exact:true}).fill(code);await p.getByRole('button',{name:'Войти в кабинет',exact:true}).click();await p.getByText('Вход выполнен: '+email,{exact:true}).waitFor()}
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/account/config')).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 const initial=await page.goto(origin+'/account');assert.match(initial.headers()['x-robots-tag'],/noindex/);assert.equal(initial.headers()['cache-control'],'no-store')
 await login(page,'alice@example.com')
 await page.getByLabel('Ваше имя',{exact:true}).fill('Алиса');await page.getByLabel('Ваш телефон',{exact:true}).fill('+79991112233');await page.getByRole('button',{name:'Сохранить профиль',exact:true}).click();await page.getByText('Профиль сохранён.',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Добавить адрес',exact:true}).click();const address=page.getByRole('dialog',{name:'Сохранённый адрес'});await address.getByLabel('Название адреса').fill('Дом');await address.getByLabel('Адрес доставки').fill('Новосибирск, улица 1');await address.getByRole('button',{name:'Сохранить адрес',exact:true}).click();await page.getByText('Адрес сохранён.',{exact:true}).waitFor()
 await page.goto(origin+'/catalog');await page.locator('.product-card').first().locator('.quick-add').click();await page.getByRole('button',{name:/Корзина 1/}).click();await page.locator('.drawer-bottom .primary-button').click()
 await page.getByText('Заказ сохранится в вашем личном кабинете.',{exact:true}).waitFor();assert.equal(await page.locator('input[autocomplete="name"]').inputValue(),'Алиса')
 await page.locator('.checkout-form button[type="submit"]').click();await page.locator('.checkout-success').waitFor();await page.goto(origin+'/account');await page.getByRole('button',{name:'Открыть заказ',exact:true}).click();const detail=page.getByRole('dialog',{name:'Мой заказ'});await detail.getByText('Получатель: Алиса · +79991112233',{exact:true}).waitFor()
 const rows=await context.request.get(origin+'/api/account/orders'),id=(await rows.json()).items[0].id
 const other=await browser.newContext(),otherPage=await other.newPage();await login(otherPage,'bob@example.com');assert.equal((await other.request.get(origin+'/api/account/orders/'+id)).status(),404);assert.equal((await (await other.request.get(origin+'/api/account/orders')).json()).items.length,0)
 await fetch(origin+'/__test/price',{method:'POST'});await detail.getByRole('button',{name:'Повторить заказ',exact:true}).click();await detail.getByText(/Цена .* изменилась/).waitFor();await detail.getByRole('button',{name:'Добавить повтор в корзину',exact:true}).click();assert.match(await page.locator('.cart-items').textContent(),/15/)
 await page.reload();await page.getByRole('button',{name:/Корзина 1/}).click();assert.match(await page.locator('.cart-items').textContent(),/15/);await page.getByRole('button',{name:'Закрыть корзину',exact:true}).click()
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await page.getByRole('button',{name:'Выйти на всех устройствах',exact:true}).click();await page.getByRole('heading',{name:'Вход по email',exact:true}).waitFor();assert.equal((await context.request.get(origin+'/api/account/orders/'+id)).status(),401)
 assert.deepEqual(errors,[]);await other.close();console.log('PASS customer UI: captured OTP only, profile, saved address, checkout, own history, isolation, live reorder, cart reload, mobile and logout')
}finally{await browser.close();await new Promise(resolve=>proxy.close(resolve))}
