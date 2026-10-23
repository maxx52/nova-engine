import {PRODUCT_VERSION} from '../../../config/release.js'
import {adminRefreshUrl,canRefreshAdmin} from '../../../shared/adminVersion.js'
const key='nova_admin_reload_'+PRODUCT_VERSION
let requested=false
function attempted(){const query=new URL(location.href).searchParams.get('nova_version');try{return sessionStorage.getItem(key)||query}catch{return query}}
export function refreshAdmin(version){
 if(requested)return
 const url=adminRefreshUrl(location.href,version)
 requested=true
 try{sessionStorage.setItem(key,version)}catch{}
 location.replace(url)
}
export function syncAdminVersion(status){
 if(status?.current_version===PRODUCT_VERSION){try{sessionStorage.removeItem(key)}catch{};return}
 if(canRefreshAdmin(PRODUCT_VERSION,status,attempted()))refreshAdmin(status.current_version)
}
