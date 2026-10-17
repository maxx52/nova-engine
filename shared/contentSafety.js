export function safeLink(value){
 if(typeof value!=='string'||value.length>2000||/[\s\x00-\x1f\x7f\\]/.test(value))return false
 if(value==='')return true
 try{
  if(value.startsWith('/')&&!value.startsWith('//'))return new URL(value,'https://nova.invalid').origin==='https://nova.invalid'
  if(!/^https?:\/\//.test(value))return false
  const url=new URL(value)
  return ['http:','https:'].includes(url.protocol)&&Boolean(url.hostname)&&!url.username&&!url.password
 }catch{return false}
}
export const mediaUrl=value=>typeof value==='string'&&/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(value)?value:''

// Public read-only endpoints available to authored sandbox blocks. Never forward cookies.
export function publicDataPath(value){
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/api/')||/[\s\x00-\x1f\x7f\\]/.test(value))return false
 try{
  const url=new URL(value,'https://nova.invalid')
  return url.origin==='https://nova.invalid'&&/^\/api\/(products(?:\/[1-9][0-9]*)?|categories|pages(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?|blog(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?)$/.test(url.pathname)
 }catch{return false}
}
