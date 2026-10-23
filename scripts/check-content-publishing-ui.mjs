// Real accounts and timed worker in the disposable localhost deployment only.
import assert from 'node:assert/strict'
export async function runContentPublishingChecks(page) {
 const errors=[],editorContext=await page.context().browser().newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}})
 const editor=await editorContext.newPage();editor.on('pageerror',e=>errors.push(e.message))
 const title='CI publication workflow',slug='ci-publication-workflow'
 const live=()=>page.evaluate(async slug=>{const r=await fetch('/api/pages/'+slug);return {status:r.status,data:await r.json()}},slug)
 const record=p=>p.locator('tbody tr').filter({hasText:'/'+slug})
 const input=p=>p.getByLabel('Вступительный текст',{exact:false})
 const open=p=>record(p).getByRole('button',{name:'Изменить',exact:true}).click()
 const queue=p=>p.locator('.publication-queue')
 const refresh=p=>queue(p).getByRole('button',{name:'Обновить очередь',exact:true}).click()
 const review=(p,state)=>queue(p).locator('tbody tr').filter({hasText:title}).filter({hasText:state}).getByRole('button',{name:'Проверить заявку',exact:true}).click()
 const composer=p=>p.getByText('Согласование и публикация по расписанию',{exact:true}).click()
 const submit=async p=>{await composer(p);await p.getByRole('button',{name:'Отправить на согласование',exact:true}).click();await p.locator('.page-editor-modal').waitFor({state:'hidden'})}
 const close=p=>p.getByRole('button',{name:'Закрыть проверку публикации',exact:true}).click()
 try {
  await page.getByRole('button',{name:/Страницы/}).click()
  await page.evaluate(async({title,slug})=>{
   const session=await (await fetch('/api/auth/me')).json(),headers={'content-type':'application/json','x-nova-request':'1','x-csrf-token':session.csrf_token}
   for(const [url,body]of [['/api/admin/accounts',{username:'ci_publish_editor',password:'ci-only-publication-editor-8241',role:'editor'}],['/api/admin/pages',{title,slug,content:'Live baseline',sections:[],published:true}]]){const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});if(r.status!==201)throw Error('Publication fixture failed: '+r.status)}
  },{title,slug})
  // Refresh the owner list after the API fixture.
  await page.getByRole('button',{name:/Блог/}).click();await page.getByRole('button',{name:/Страницы/}).click()
  await editor.goto('https://localhost/admin/')
  await editor.getByLabel('Логин',{exact:true}).fill('ci_publish_editor')
  await editor.getByLabel('Пароль',{exact:true}).fill('ci-only-publication-editor-8241')
  await editor.getByRole('button',{name:'Войти',exact:true}).click()
  await open(editor)
  assert.equal(await editor.getByLabel('Опубликована',{exact:true}).isDisabled(),true)
  await input(editor).fill('First proposal <img src=x onerror="throw Error(1)">')
  await submit(editor)
  assert.equal((await live()).data.content,'Live baseline')
  await refresh(page);await review(page,'На согласовании')
  assert.equal(await page.locator('.publication-detail script,.publication-detail img,.publication-detail iframe').count(),0)
  await page.getByLabel('Комментарий к решению',{exact:true}).fill('Уточните формулировку')
  await page.getByRole('button',{name:'Вернуть с комментарием',exact:true}).click()
  await page.locator('.publication-detail').getByText('Возвращено с замечаниями',{exact:true}).waitFor();await close(page)
  await refresh(editor);await review(editor,'Возвращено с замечаниями')
  await editor.getByText('Комментарий: Уточните формулировку',{exact:true}).waitFor();await close(editor)
  await open(editor);await editor.getByRole('button',{name:'Восстановить личный черновик',exact:true}).click()
  await input(editor).fill('Approved second proposal');await submit(editor)
  await refresh(page);await review(page,'На согласовании')
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Одобрить и опубликовать',exact:true}).click()
  await page.locator('.publication-detail').getByText('Опубликовано',{exact:true}).waitFor();await close(page)
  assert.equal((await live()).data.content,'Approved second proposal')
  // Saving a personal work copy of a live page must not unpublish or replace it.
  await open(editor);await editor.getByRole('button',{name:'Удалить личный черновик',exact:true}).click()
  await input(editor).fill('Private unpublished change')
  await editor.getByRole('button',{name:'Сохранить личный черновик',exact:true}).click()
  await editor.locator('.page-editor-modal').waitFor({state:'hidden'})
  assert.equal((await live()).data.content,'Approved second proposal')
  // Schedule unsaved owner edits and wait for the actual 15-second server worker.
  await open(page);await input(page).fill('Published by timed worker');await composer(page)
  const localTime=await page.evaluate(()=>{const d=new Date(Date.now()+90000);return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)})
  await page.getByLabel(/Желаемое время публикации/).fill(localTime)
  await page.getByRole('button',{name:'Запланировать публикацию',exact:true}).click()
  await page.locator('.page-editor-modal').waitFor({state:'hidden'})
  assert.equal((await live()).data.content,'Approved second proposal')
  const scheduled=await page.evaluate(async()=> (await (await fetch('/api/admin/pages/publications?state=active')).json()).items.find(r=>r.title==='CI publication workflow'))
  assert.equal(scheduled.state,'scheduled')
  const deadline=Date.now()+120000
  while(Date.now()<deadline){const observed=await live();if(observed.data.content==='Published by timed worker'){assert.ok(Date.now()>=Date.parse(scheduled.scheduled_at),'publication must wait until its scheduled instant');break}await new Promise(r=>setTimeout(r,1000))}
  await refresh(page)
  const result=await live();assert.equal(result.data.revision,'3');assert.equal(result.data.content,'Published by timed worker')
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1280,height:900})
  assert.deepEqual(errors,[])
  console.log('PASS publishing UI: real editor review, rejection comment, immutable public text, approval, private live-page drafts, timezone input, timed server publication and mobile queue')
 }finally{await editorContext.close()}
}
