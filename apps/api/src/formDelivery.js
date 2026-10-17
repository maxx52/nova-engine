import nodemailer from 'nodemailer'
import {lookup} from 'node:dns/promises'
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto'
export function secretVault(secret){
 const key=createHash('sha256').update('nova-contact-secrets-v1\0'+secret).digest(),aad=Buffer.from('NOVA contact settings v1')
 return {seal:value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64')},open:box=>{const bytes=Buffer.from(box,'base64'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(aad);decipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'))}}
}
export function publicIPv4(value){const p=value.split('.').map(Number);if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255))return false;const [a,b,c]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)}
export async function smtpAddress(host,resolve=lookup){
 let timer
 try{const rows=await Promise.race([resolve(host,{all:true,family:4}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('DNS'),{code:'EDNS'})),5000);timer.unref?.()})]);if(!rows.length||rows.some(r=>!publicIPv4(r.address)))throw Object.assign(Error('SMTP address rejected'),{code:'EHOSTPOLICY'});return rows[0].address}finally{clearTimeout(timer)}
}
export function notificationText(message){return ['NOVA · Заявка '+message.number,message.title,...message.fields.map(f=>f.label+': '+(typeof message.values[f.key]==='boolean'?(message.values[f.key]?'Да':'Нет'):message.values[f.key])),message.source?'Страница: '+message.source:'','Согласие: '+message.consent_label].filter(Boolean).join('\n\n')}
export async function sendEmail(config,message,{resolve=lookup,createTransport=nodemailer.createTransport}={}){
 const e=config.email,address=await smtpAddress(e.host,resolve)
 const transport=createTransport({host:address,port:e.port,secure:e.tls==='implicit',requireTLS:e.tls==='starttls',...(e.mode!=='1gb'?{auth:{user:e.user,pass:config.smtp_password}}:{}),tls:{servername:e.host,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false})
 const replyField=message.fields.find(f=>f.type==='email'&&message.values[f.key])
 try{const info=await transport.sendMail({from:e.from,to:e.to,...(replyField?{replyTo:message.values[replyField.key]}:{}),subject:'NOVA: '+message.title+' · '+message.number,text:notificationText(message),textEncoding:'quoted-printable',messageId:'<nova-feedback-'+message.delivery_id+'@'+e.from.split('@')[1]+'>',disableFileAccess:true,disableUrlAccess:true});return {partial:!!info.rejected?.length,external_id:''}}finally{transport.close()}
}
async function limitedTelegramJson(r){
 let size=0,parts=[];const reader=r.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>64000){await reader.cancel();throw Error('Response too large')}parts.push(value)}}catch{throw Object.assign(Error('Telegram response unknown'),{code:'ETELEGRAM_UNKNOWN',uncertain:true})}finally{reader.releaseLock()}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Object.assign(Error('Telegram response unknown'),{code:'ETELEGRAM_UNKNOWN',uncertain:true})}
}
export async function sendTelegram(config,message,{fetcher=fetch}={}){
 const full=notificationText(message),text=full.length>3800?full.slice(0,3700).replace(/[\uD800-\uDBFF]$/,'')+'\n\n[Сокращено. Полный текст — в админке NOVA.]':full
 let r
 try{r=await fetcher('https://api.telegram.org/bot'+config.bot_token+'/sendMessage',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:config.telegram.chat_id,text,link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(12000)})}catch{throw Object.assign(Error('Telegram network result unknown'),{code:'ETELEGRAM_UNKNOWN',uncertain:true})}
 if(r.status===429){let retryAfter=60;try{const body=await limitedTelegramJson(r);retryAfter=Number(body.parameters?.retry_after)||60}catch{}throw Object.assign(Error('Telegram rate limit'),{code:'ETELEGRAM_LIMIT',retry:true,retry_after:Math.min(86400,Math.max(60,retryAfter))})}
 if(r.status>=500){await r.body?.cancel();throw Object.assign(Error('Telegram result unknown'),{code:'ETELEGRAM_UNKNOWN',uncertain:true})}
 // Bot API responses contain the submitted text; neither the body nor provider errors enter logs.
 const data=await limitedTelegramJson(r)
 if(!r.ok||!data.ok)throw Object.assign(Error('Telegram request rejected'),{code:'ETELEGRAM_REJECTED'})
 return {external_id:String(data.result?.message_id||'')}
}
export const formTransports={email:sendEmail,telegram:sendTelegram}
export function deliveryFailure(error){
 if(error.code==='ETELEGRAM_LIMIT')return {code:'TELEGRAM_LIMIT',retry:true,retry_after:error.retry_after}
 if(error.uncertain||error.code==='ETELEGRAM_UNKNOWN')return {code:'RESULT_UNKNOWN',uncertain:true}
 if(error.code==='ESECRETS')return {code:'CREDENTIALS_UNREADABLE'}
 if(error.code==='EHOSTPOLICY')return {code:'SMTP_ADDRESS_REJECTED'}
 if(error.code==='EAUTH')return {code:'SMTP_AUTH_REJECTED'}
 if(error.code==='EDNS'||['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(error.code)||['CONN','STARTTLS'].includes(error.command))return {code:'SMTP_CONNECTION_FAILED',retry:true}
 if(error.code==='ETELEGRAM_REJECTED')return {code:'TELEGRAM_REJECTED'}
 if(error.code==='EENVELOPE'||error.responseCode>=500)return {code:'SMTP_REJECTED'}
 return {code:'RESULT_UNKNOWN',uncertain:true}
}
