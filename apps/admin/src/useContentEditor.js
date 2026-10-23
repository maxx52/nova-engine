import {reactive,watch,onBeforeUnmount} from 'vue'
import {adminFetch,auth} from './adminApi.js'
const clone=value=>JSON.parse(JSON.stringify(value))
const fields={pages:['title','slug','content','sections','seo','published'],posts:['title','slug','excerpt','content','category','tags','cover_url','seo','published']}
export function useContentEditor(kind,load,emit) {
 const base='/api/admin/'+kind
 const e=reactive({form:null,busy:false,error:'',status:'',pending:null,conflict:null,versions:[],historical:null,draftRevision:'0',blocked:false,notice:'',isEditor:auth.user?.role==='editor',liveAtOpen:false})
 let timer,baseline='',savedDraft='',generation=0,inflight=null,ready=false,key='new',submissionKey='',submissionId=''
 const payload=()=>Object.fromEntries(fields[kind].filter(k=>e.form?.[k]!==undefined).map(k=>[k,clone(e.form[k])]))
 const text=()=>e.form?JSON.stringify({payload:payload(),base_revision:e.form.revision||null}):''
 const unsaved=()=>Boolean(e.form&&text()!==baseline&&text()!==savedDraft)
 async function request(url,method='GET',body) {
  const r=await adminFetch(url,{method,signal:AbortSignal.timeout(15000),...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})})
  const data=r.status===204?null:await r.json()
  if(!r.ok)throw Object.assign(Error(data?.error||'Ошибка запроса'),{status:r.status,...data})
  return data
 }
 function changed(){emit?.('dirty',unsaved())}
 async function flush() {
  clearTimeout(timer)
  if(inflight){await inflight;return flush()}
  if(!ready||!e.form||!unsaved())return true
  if(e.blocked||e.pending)return false
  const snapshot=text(),version=generation,body={payload:payload(),base_revision:e.form.revision||null,revision:e.draftRevision},url=base+'/drafts/'+key
  e.status='Автосохранение…'
  const operation=(async()=>{
   try {
    const result=await request(url,'PUT',body)
    if(version!==generation)return false
    e.draftRevision=result.revision;savedDraft=snapshot;e.status='Личный черновик сохранён';changed();return true
   }catch(err){if(version===generation){e.status=err.message;e.blocked=err.code==='draft_conflict';changed()}return false}
  })()
  inflight=operation
  const ok=await operation;inflight=null
  // An edit made while a request was in flight gets its own CAS write.
  if(ok&&version===generation&&unsaved())return flush()
  return ok
 }
 watch(()=>e.form,()=>{
  if(!ready)return
  changed();clearTimeout(timer)
  if(unsaved()&&!e.busy&&!e.blocked&&!e.pending){e.status='Есть несохранённые изменения';timer=setTimeout(flush,1200)}
 },{deep:true,flush:'sync'})
 async function open(row) {
  if(e.busy)return
  e.busy=true;e.error=''
  try {
   const current=row?.id?await request(base+'/'+row.id):clone(row)
   key=String(current?.id||'new')
   const draft=await request(base+'/drafts/'+key)
   ready=false;generation++;e.form=current;e.conflict=null;e.historical=null;e.versions=[];e.pending=draft;e.blocked=false
   e.liveAtOpen=Boolean(current?.published);e.notice='';e.draftRevision=draft?.revision||'0';baseline=text();savedDraft='';e.status=draft?'Найден ваш личный черновик':'Изменений нет';ready=true;changed()
  }catch(err){e.error=err.message}finally{e.busy=false}
 }
 function recover() {
  if(!e.pending)return
  const d=e.pending;e.pending=null
  Object.assign(e.form,clone(d.payload),{revision:d.base_revision||undefined})
  if(e.isEditor)e.form.published=e.liveAtOpen
  savedDraft=text();e.status='Личный черновик восстановлен';changed()
 }
 async function discardDraft() {
  try {
   await request(base+'/drafts/'+key,'DELETE',{revision:e.draftRevision})
   e.draftRevision='0';e.pending=null;e.blocked=false;savedDraft='';e.status='Личный черновик удалён';changed()
  }catch(err){e.error=err.message}
 }
 async function close() {
  if(e.busy)return
  if(unsaved()&&!await flush()&&!confirm('Изменения не сохранены на сервере. Закрыть редактор и потерять их?'))return
  clearTimeout(timer);ready=false;generation++;e.form=null;changed()
 }
 async function save() {
  if(e.busy||e.pending||e.blocked)return
  // Finish outstanding autosaves before removing exactly that draft revision.
  e.busy=true;e.error='';const draftOk=await flush()
  if(e.isEditor&&e.liveAtOpen){
   if(draftOk){ready=false;generation++;e.form=null;e.notice='Личный черновик сохранён. Для публикации откройте его и отправьте на согласование.';changed()}else e.error='Не удалось сохранить личный черновик. '+e.status
   e.busy=false;return
  }
  if(e.blocked){e.busy=false;return}
  try {
   const result=await request(base+(e.form.id?'/'+e.form.id:''),e.form.id?'PUT':'POST',{...payload(),...(e.form.id?{revision:e.form.revision}:{})})
   // A different tab's work must never be cleared by this save.
   if(e.draftRevision!=='0')try{await request(base+'/drafts/'+key,'DELETE',{revision:e.draftRevision})}catch{}
   ready=false;generation++;e.form=null;e.conflict=null;e.status='';changed();await load();return result
  }catch(err){e.error=err.message;if(err.code==='content_conflict')e.conflict=err.current}finally{e.busy=false}
 }
 async function submitPublication(mode,localTime) {
  if(e.busy||e.pending||e.blocked||!e.form?.id)return
  e.busy=true;e.error=''
  try {
   await flush();if(e.blocked)return
   const publish_at=localTime?new Date(localTime).toISOString():null
   const body={revision:e.form.revision,payload:{...payload(),published:true},mode,publish_at}
   const signature=JSON.stringify(body)
   if(signature!==submissionKey){submissionKey=signature;submissionId=crypto.randomUUID()}
   await request(base+'/'+e.form.id+'/publications','POST',{...body,request_id:submissionId})
   ready=false;generation++;e.form=null;e.conflict=null;changed()
   e.notice=mode==='review'?'Материал отправлен на согласование. Опубликованный текст не изменён.':'Публикация запланирована. До выбранного времени сайт показывает прежний текст.'
   await load()
  }catch(err){e.error=err.message;if(err.code==='content_conflict')e.conflict=err.current}finally{e.busy=false}
 }
 async function history() {
  try{e.versions=await request(base+'/'+e.form.id+'/versions');e.historical=null}catch(err){e.error=err.message}
 }
 async function inspect(revision) {
  try{e.historical={revision,payload:await request(base+'/'+e.form.id+'/versions/'+revision)}}catch(err){e.error=err.message}
 }
 function useVersion() {
  if(!e.historical)return
  Object.assign(e.form,clone(e.historical.payload));e.historical=null;e.status='Версия загружена в редактор. Проверьте и сохраните черновик.'
 }
 function keepLocal() {
  if(e.conflict?.deleted_at)return
  e.form.revision=String(e.conflict.revision);e.conflict=null;e.error='';e.status='Проверьте результат и нажмите «Сохранить»'
 }
 async function loadServer() {
  if(e.conflict?.deleted_at)return
  // Keep private local work until explicitly discarded, and offer it on next open.
  if(!await flush())return
  const current=e.conflict;ready=false;e.form=clone(current);baseline=text();savedDraft='';e.conflict=null;e.error='';ready=true;changed()
 }
 async function trash(row,operation='trash') {
  const question=operation==='purge'?'Удалить «'+row.title+'» окончательно вместе с историей и личными черновиками всех редакторов?':operation==='restore'?'Восстановить «'+row.title+'» как неопубликованный черновик?':'Переместить «'+row.title+'» в корзину?'
  if(!confirm(question))return
  e.busy=true;e.error=''
  try{await request(base+'/'+row.id+(operation==='trash'?'':'/'+operation),operation==='restore'?'POST':'DELETE',{revision:String(row.revision)});await load()}catch(err){e.error=err.message;await load().catch(()=>{})}finally{e.busy=false}
 }
 function beforeUnload(event){if(unsaved()){event.preventDefault();event.returnValue=''}}
 window.addEventListener('beforeunload',beforeUnload)
 onBeforeUnmount(()=>{clearTimeout(timer);ready=false;generation++;window.removeEventListener('beforeunload',beforeUnload);emit?.('dirty',false)})
 return Object.assign(e,{open,save,close,flush,recover,discardDraft,history,inspect,useVersion,keepLocal,loadServer,trash,submitPublication})
}
