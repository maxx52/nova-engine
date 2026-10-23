import http from 'node:http'
import {PRODUCT_VERSION} from '../../../config/release.js'
import {publicRelease,compareVersions,releaseVersion,RELEASES_URL} from '../../../shared/releases.js'
let cached={checked_at:null,release:null,error:null},lastCheck=0,inflight
async function checkGitHub(){
 if(inflight)return inflight
 if(Date.now()-lastCheck<300000)return cached
 lastCheck=Date.now()
 inflight=(async()=>{try{
  const response=await fetch('https://api.github.com/repos/maxx52/nova-engine/releases?per_page=10',{headers:{Accept:'application/vnd.github+json','User-Agent':'NOVA-Engine-update-check'},signal:AbortSignal.timeout(10000),redirect:'error'})
  if(!response.ok)throw Error('GitHub недоступен')
  const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder()
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>200000){await reader.cancel();throw Error('Размер ответа GitHub превышен')}text+=decoder.decode(value,{stream:true})}
  const rows=JSON.parse(text+decoder.decode());if(!Array.isArray(rows))throw Error('Некорректный ответ GitHub')
  const releases=rows.map(publicRelease).filter(Boolean).sort((a,b)=>compareVersions(b.version,a.version))
  cached={checked_at:new Date().toISOString(),release:releases[0]||null,error:null}
 }catch{cached={...cached,error:'Не удалось проверить GitHub. Попробуйте позднее.'}}finally{inflight=null}return cached})()
 return inflight
}
export function agentRequest(socketPath,path,body){
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath,path,method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{}},response=>{
   let size=0,data='';response.setEncoding('utf8');response.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>500000){req.destroy(Error('response limit'));return}data+=chunk});response.on('end',()=>{try{const value=JSON.parse(data);if(response.statusCode>=400)return reject(Object.assign(Error(value.error||'Операция отклонена службой'),{statusCode:response.statusCode,system:true}));resolve(value)}catch(e){reject(e)}})
  });req.setTimeout(5000,()=>req.destroy(Error('timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined)
 })
}
export function validateSystemCommand(body){
 if(!body||typeof body!=='object'||Array.isArray(body))return false
 if(body.kind==='backup'||body.kind==='check')return Object.keys(body).length===1
 if(body.kind==='update')return Object.keys(body).length===2&&releaseVersion(body.version)
 if(body.kind==='verify')return Object.keys(body).length===2&&typeof body.backup_id==='string'&&/^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(body.backup_id)
 if(body.kind==='restore')return Object.keys(body).length===3&&body.confirm==='ВОССТАНОВИТЬ'&&typeof body.backup_id==='string'&&/^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(body.backup_id)
 if(body.kind==='schedule')return Object.keys(body).length===4&&typeof body.enabled==='boolean'&&Number.isInteger(body.hour_utc)&&body.hour_utc>=0&&body.hour_utc<=23&&[7,14,30].includes(body.retention_days)
 return false
}
export function registerSystem(app,requireAdmin,{socketPath=process.env.NOVA_UPDATER_SOCKET,request=agentRequest,check=checkGitHub}={}){
 app.get('/api/admin/system',{preHandler:requireAdmin},async()=>{
  if(socketPath){try{const status=await request(socketPath,'/status');return {...status,installed_version:status.current_version||PRODUCT_VERSION,current_version:PRODUCT_VERSION,releases_url:RELEASES_URL,available:true}}catch(e){if(e.system)throw e}}
  const release=await check();return {current_version:PRODUCT_VERSION,releases_url:RELEASES_URL,available:false,reason:'Серверная служба обновления не подключена. Доступна проверка релизов; установку выполняет администратор хостинга.',...release}
 })
 app.post('/api/admin/system/jobs',{preHandler:requireAdmin,bodyLimit:2048},async(req,reply)=>{
  if(!validateSystemCommand(req.body))return reply.code(400).send({error:'Некорректная системная операция'})
  if(!socketPath){if(req.body.kind==='check')return check();return reply.code(503).send({error:'Серверная служба не подключена'})}
  try{const result=await request(socketPath,'/jobs',req.body);req.log.info({event:'system.command',kind:req.body.kind});return reply.code(202).send(result)}catch(e){return reply.code(e.system?e.statusCode:503).send({error:e.system?e.message:'Серверная служба временно недоступна'})}
 })
}
