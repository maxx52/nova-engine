import {reactive} from 'vue'
export const customer=reactive({user:null,csrf:'',loaded:false})
let refresh,epoch=0
export async function customerRequest(url,method='GET',body){
 const csrf=customer.csrf
 const r=await fetch(url,{method,credentials:'same-origin',signal:AbortSignal.timeout(15000),headers:{'x-nova-account':'1',...(customer.csrf?{'x-customer-csrf':customer.csrf}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
 const data=r.status===204?null:await r.json()
 if(r.status===401&&csrf===customer.csrf&&!url.endsWith('/login/verify')){customer.user=null;customer.csrf=''}
 if(!r.ok)throw Object.assign(Error(data?.error||'Не удалось выполнить запрос'),{status:r.status})
 return data
}
export function refreshCustomer(){if(refresh)return refresh;const version=epoch;refresh=customerRequest('/api/account/me').then(data=>{if(version!==epoch)return customer.user;customer.user=data.user;customer.csrf=data.csrf_token;customer.loaded=true;return data.user}).catch(e=>{if(e.status===401){customer.loaded=true;return null}throw e}).finally(()=>{refresh=null});return refresh}
let channel
try{channel=new BroadcastChannel('nova_customer_session');channel.onmessage=e=>{if(e.data==='logout'){epoch++;customer.user=null;customer.csrf=''}else if(e.data==='login')refreshCustomer().catch(()=>{})}}catch{}
export function acceptCustomer(data){epoch++;customer.user=data.user;customer.csrf=data.csrf_token;customer.loaded=true;channel?.postMessage('login')}
export async function logoutCustomer(all=false){await customerRequest('/api/account/'+(all?'logout-all':'logout'),'POST',{});epoch++;customer.user=null;customer.csrf='';channel?.postMessage('logout')}
window.addEventListener('pageshow',e=>{if(e.persisted)refreshCustomer().catch(()=>{})})
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&customer.loaded)refreshCustomer().catch(()=>{})})
