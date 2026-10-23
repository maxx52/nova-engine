import {releaseVersion} from '../../../shared/releases.js'
import { reactive } from 'vue'
export const auth = reactive({user:null,csrf:'',notice:'',serverVersion:null})
export async function adminFetch(url,options={}) {
 const response=await fetch(url,{...options,credentials:'same-origin',headers:{...options.headers,'x-nova-request':'1',...(auth.csrf?{'x-csrf-token':auth.csrf}:{})}})
 const version=response.headers.get('x-nova-version');if(releaseVersion(version))auth.serverVersion=version
 if(response.status===401&&!['/api/auth/login','/api/auth/setup'].includes(url)&&auth.user){auth.user=null;auth.csrf='';auth.notice='Сессия завершена. Войдите снова.'}
 return response
}
export async function authRequest(url,body) {
 const response=await adminFetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})})
 const data=response.status===204?null:await response.json()
 if(!response.ok)throw Error(data?.error||'Ошибка запроса')
 return data
}
export function acceptSession(data){auth.user=data.user;auth.csrf=data.csrf_token;auth.notice='';sessionStorage.removeItem('nova_admin_key')}
