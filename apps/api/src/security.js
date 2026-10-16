import {httpHeaders} from '../../../config/httpHeaders.js'
export function securityConfig(env=process.env){
 const production=env.NODE_ENV==='production'
 const origins=(env.ADMIN_ORIGINS||'http://localhost:5174,http://127.0.0.1:5174').split(',').map(s=>s.trim())
 if(origins.some(origin=>{try{const url=new URL(origin);return !['http:','https:'].includes(url.protocol)||url.origin!==origin}catch{return true}}))throw Error('ADMIN_ORIGINS must contain exact HTTP(S) origins without paths or trailing slashes')
 if(production){
  if(!env.ADMIN_ORIGINS||origins.some(s=>!s.startsWith('https://')))throw Error('Production requires explicit HTTPS ADMIN_ORIGINS')
  if(!env.ADMIN_API_KEY||env.ADMIN_API_KEY.length<32||/replace-with|example|nova_dev/i.test(env.ADMIN_API_KEY))throw Error('Production requires a non-default ADMIN_API_KEY of at least 32 characters')
  if(!env.DATABASE_URL||env.DATABASE_URL.includes('nova_dev_password'))throw Error('Production requires its own DATABASE_URL without development credentials')
 }
 const proxy=env.TRUST_PROXY||''
 if(['true','*','0.0.0.0/0','::/0'].some(v=>proxy.split(',').includes(v)))throw Error('TRUST_PROXY must list trusted proxy IPs/CIDRs; trusting every address is prohibited')
 return {production,secure:production||env.SESSION_SECURE==='true',origins,trustProxy:proxy?proxy.split(',').map(s=>s.trim()):false}
}
export function workLimiter(max=2){
 let active=0
 return async work=>{
  if(active>=max)throw Object.assign(Error('Сервер занят. Повторите запрос через несколько секунд.'),{statusCode:503})
  active++;try{return await work()}finally{active--}
 }
}
export function registerSecurity(app,{secure=false,now=()=>Date.now(),perIp=240,globalMax=2400}={}){
 const buckets=new Map();let global={count:0,until:0},cleanAt=0
 app.addHook('onRequest',async(req,reply)=>{
  const time=now()
  if(time>=cleanAt){for(const [key,b]of buckets)if(b.until<=time)buckets.delete(key);cleanAt=time+60000}
  if(global.until<=time)global={count:0,until:time+60000}
  const bucket=buckets.get(req.ip)||{count:0,until:time+60000}
  if(bucket.until<=time){bucket.count=0;bucket.until=time+60000}
  if(global.count>=globalMax||bucket.count>=perIp||(!buckets.has(req.ip)&&buckets.size>=10000))return reply.header('Retry-After','60').code(429).send({error:'Слишком много запросов. Повторите через минуту.'})
  bucket.count++;global.count++;buckets.set(req.ip,bucket)
 })
 app.addHook('onSend',async(req,reply,payload)=>{
  for(const [key,value]of Object.entries(httpHeaders({https:secure,asset:true})))reply.header(key,value)
  if(req.url.startsWith('/api/'))reply.header('Cache-Control','no-store').header('Vary','Cookie, Origin')
  if(reply.statusCode===503)reply.header('Retry-After','2')
  return payload
 })
}

export function publicErrorHandler(error,request,reply){
 if(error.constraint==='nova_media_available')return reply.code(400).send({error:'Изображение удалено или отсутствует. Выберите другой файл.'})
 const status=Number.isInteger(error.statusCode)&&error.statusCode>=400&&error.statusCode<=599?error.statusCode:500
 request.log.error({event:'request.failed',errorCode:error.code||'INTERNAL',status,requestId:request.id})
 const messages={400:'Некорректный запрос',401:'Требуется вход',403:'Запрос отклонён',404:'Не найдено',409:'Конфликт данных',413:'Превышен допустимый размер запроса',415:'Допускаются только корректные JPG, PNG, WebP без анимации: до 5 МБ, 20 Мп и 10 000 px по стороне.',429:'Слишком много запросов',503:'Сервер занят. Повторите запрос через несколько секунд.'}
 return reply.code(status).send({error:messages[status]||'Ошибка сервера'})
}

export async function assertDatabaseRole(pool){
 const result=await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE
  (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolname IN
   ('pg_execute_server_program','pg_read_server_files','pg_write_server_files','pg_read_all_data','pg_write_all_data','pg_signal_backend'))
  AND (rolname=current_user OR pg_has_role(current_user,oid,'MEMBER'))) AS unsafe`)
 if(result.rows[0]?.unsafe!==false)throw Error('Production database role must not be a superuser, manage roles/databases, bypass RLS or inherit server file/program privileges')
}
