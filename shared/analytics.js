export const analyticsTypes=['pageview','cart_add','checkout_start']
export const analyticsZones=['Asia/Novosibirsk','Europe/Moscow','UTC']
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
export function analyticsPath(value){
 if(typeof value!=='string'||value.length>2000)return null
 const path=value.split(/[?#]/)[0].replace(/\/$/,'')||'/'
 if(path.length>200||/^\/(admin|api|uploads|health)(\/|$)/i.test(path))return null
 return /^(\/|\/catalog|\/product\/[1-9][0-9]*|\/blog(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?|\/[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(path)?path:null
}
export function referralHost(value){
 if(typeof value!=='string'||value.length>253)return ''
 const host=value.toLowerCase().replace(/^www\./,'')
 return host.includes('.')&&!/^\d+(\.\d+){3}$/.test(host)&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)?host:''
}
export function dayAt(date,zone){return new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
export function addDays(day,amount){return new Date(Date.parse(day+'T12:00:00Z')+amount*86400000).toISOString().slice(0,10)}
