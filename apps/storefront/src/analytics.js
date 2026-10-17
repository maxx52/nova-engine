import {analyticsPath,referralHost,uuid} from '../../../shared/analytics.js'
const key='nova_analytics_v1',memory={}
let queue=Promise.resolve(),configuration=null,checkedAt=0,current=null
const optedOut=()=>navigator.doNotTrack==='1'||navigator.globalPrivacyControl===true
async function enabled(){
 if(optedOut())return false
 if(!configuration||Date.now()-checkedAt>60000){checkedAt=Date.now();configuration=fetch('/api/analytics/config',{credentials:'same-origin',signal:AbortSignal.timeout(1500)}).then(r=>r.ok?r.json():{enabled:false}).catch(()=>({enabled:false}))}
 return (await configuration).enabled===true
}
function context(reset=false){
 const now=Date.now();let value
 try{value=JSON.parse(localStorage.getItem(key)||'null')}catch{}
 if(!value)value=memory.value
 if(!value||!uuid(value.visitor_id)||!Number.isFinite(value.expires)||value.expires<=now)value={visitor_id:crypto.randomUUID(),expires:now+30*86400000}
 const fresh=reset||!uuid(value.session_id)||!Number.isFinite(value.last)||value.last<=now-1800000||!Number.isFinite(value.started)||value.started<=now-86400000
 if(fresh){value.session_id=crypto.randomUUID();value.started=now}
 value.last=now;memory.value=value
 try{localStorage.setItem(key,JSON.stringify(value))}catch{}
 current={visitor_id:value.visitor_id,session_id:value.session_id}
 return {...current,fresh}
}
function source(){try{return referralHost(new URL(document.referrer).hostname)}catch{return ''}}
async function send(type,path,ids){
 return fetch('/api/analytics/collect',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-nova-analytics':'1'},body:JSON.stringify({event_id:crypto.randomUUID(),visitor_id:ids.visitor_id,session_id:ids.session_id,type,path,referrer:source()}),keepalive:true,signal:AbortSignal.timeout(1500)})
}
export function track(type,path=location.pathname){
 const clean=analyticsPath(path);if(!clean)return
 queue=queue.then(async()=>{
  if(!await enabled()){current=null;return}
  let ids=context()
  if(ids.fresh&&type!=='pageview')await send('pageview',clean,ids)
  let response=await send(type,clean,ids)
  if(response.status===409){ids=context(true);if(type!=='pageview')await send('pageview',clean,ids);response=await send(type,clean,ids)}
  if(!response.ok)current=null
 }).catch(()=>{current=null})
}
export async function analyticsOrderContext(){
 // Analytics must never hold up checkout, or modify its retry payload.
 await Promise.race([queue,new Promise(resolve=>setTimeout(resolve,800))])
 if(optedOut()||!current||!memory.value||memory.value.last<Date.now()-1800000)return null
 return {...current}
}
