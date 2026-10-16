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
