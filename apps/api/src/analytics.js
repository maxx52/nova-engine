import {workLimiter} from './security.js'
import {createHmac} from 'node:crypto'
import {analyticsPath,referralHost,analyticsTypes,analyticsZones,uuid,dayAt,addDays} from '../../../shared/analytics.js'
export async function purgeAnalytics(pool){
 // FK deletes events and detaches old order attribution without deleting orders.
 await pool.query("DELETE FROM analytics_sessions WHERE started_at<NOW()-INTERVAL '90 days'")
 await pool.query('DELETE FROM analytics_throttle WHERE reset_at<=NOW()')
}
export async function initAnalytics(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS analytics_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled BOOLEAN NOT NULL DEFAULT TRUE,exclude_admin BOOLEAN NOT NULL DEFAULT TRUE,timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Novosibirsk')`)
 await pool.query('INSERT INTO analytics_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING')
 await pool.query(`CREATE TABLE IF NOT EXISTS analytics_sessions(session_hash VARCHAR(64) PRIMARY KEY,visitor_hash VARCHAR(64) NOT NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),source VARCHAR(253) NOT NULL DEFAULT '',device VARCHAR(10) NOT NULL,browser VARCHAR(20) NOT NULL)`)
 await pool.query(`CREATE TABLE IF NOT EXISTS analytics_events(id UUID PRIMARY KEY,session_hash VARCHAR(64) NOT NULL REFERENCES analytics_sessions(session_hash) ON DELETE CASCADE,type VARCHAR(20) NOT NULL CHECK(type IN ('pageview','cart_add','checkout_start')),path VARCHAR(200) NOT NULL,at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
 await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_session_hash VARCHAR(64) REFERENCES analytics_sessions(session_hash) ON DELETE SET NULL`)
 await pool.query(`CREATE TABLE IF NOT EXISTS analytics_throttle(key VARCHAR(64) PRIMARY KEY,attempts INTEGER NOT NULL,reset_at TIMESTAMPTZ NOT NULL)`)
 for(const sql of ['CREATE INDEX IF NOT EXISTS analytics_events_at_idx ON analytics_events(at,type)','CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events(session_hash,at)','CREATE INDEX IF NOT EXISTS analytics_sessions_start_idx ON analytics_sessions(started_at)','CREATE INDEX IF NOT EXISTS analytics_throttle_expiry_idx ON analytics_throttle(reset_at)','CREATE INDEX IF NOT EXISTS orders_analytics_idx ON orders(analytics_session_hash) WHERE analytics_session_hash IS NOT NULL'])await pool.query(sql)
 await purgeAnalytics(pool)
}
const invalid=message=>Object.assign(Error(message),{statusCode:400,analytics:true})
export function reportRange(query,zone,now=new Date()){
 const today=dayAt(now,zone),from=query?.from||addDays(today,-6),to=query?.to||today
 const valid=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day
 if(!valid(from)||!valid(to)||from>to||to>today||from<addDays(today,-89))throw invalid('Период: от 1 до 90 дней, не позднее сегодняшнего дня')
 return {from,to,timezone:zone}
}
export function deviceInfo(ua=''){
 const device=/ipad|tablet|android(?!.*mobile)/i.test(ua)?'tablet':/mobile|iphone|ipod/i.test(ua)?'mobile':'desktop'
 const browser=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/YaBrowser\//.test(ua)?'Яндекс':/Firefox\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Другой'
 return {device,browser}
}
const config=async pool=>(await pool.query('SELECT enabled,exclude_admin,timezone FROM analytics_settings WHERE id=1')).rows[0]
const numeric=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='string'&&/^\d+$/.test(v)?Number(v):v]))
export async function analyticsReport(pool,query,now=new Date()){
 const settings=await config(pool),range=reportRange(query,settings.timezone,now),args=[range.from,range.to,range.timezone]
 const db=await pool.connect()
 try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
 const window=`at>=($1::date::timestamp AT TIME ZONE $3) AND at<(($2::date+1)::timestamp AT TIME ZONE $3)`
 const traffic=`SELECT e.*,s.visitor_hash,s.source,s.device,s.browser FROM analytics_events e JOIN analytics_sessions s ON s.session_hash=e.session_hash WHERE ${window} AND e.type='pageview'`
 const summary=numeric((await db.query(`SELECT COUNT(*)::int AS pageviews,COUNT(DISTINCT session_hash)::int AS sessions,COUNT(DISTINCT visitor_hash)::int AS visitors FROM (${traffic}) v`,args)).rows[0])
 const daily=(await db.query(`SELECT to_char(at AT TIME ZONE $3,'YYYY-MM-DD') AS day,COUNT(*)::int AS pageviews,COUNT(DISTINCT session_hash)::int AS sessions,COUNT(DISTINCT visitor_hash)::int AS visitors FROM (${traffic}) v GROUP BY day ORDER BY day`,args)).rows
 const byDay=new Map(daily.map(row=>[row.day,row]));const days=[]
 for(let day=range.from;day<=range.to;day=addDays(day,1))days.push(byDay.get(day)||{day,pageviews:0,sessions:0,visitors:0})
 const pages=(await db.query(`SELECT path,COUNT(*)::int AS pageviews,COUNT(DISTINCT session_hash)::int AS sessions FROM (${traffic}) v GROUP BY path ORDER BY pageviews DESC,path LIMIT 30`,args)).rows
 const groups={}
 for(const field of ['source','device','browser'])groups[field]=(await db.query(`SELECT ${field} AS name,COUNT(DISTINCT session_hash)::int AS sessions FROM (${traffic}) v GROUP BY ${field} ORDER BY sessions DESC,${field} LIMIT 20`,args)).rows
 const actions=(await db.query(`WITH visits AS (SELECT DISTINCT session_hash FROM (${traffic}) v) SELECT COUNT(*)::int AS sessions,
 COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM analytics_events e WHERE e.session_hash=v.session_hash AND e.type='cart_add' AND ${window}))::int AS cart,
 COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM analytics_events e WHERE e.session_hash=v.session_hash AND e.type='checkout_start' AND ${window}))::int AS checkout,
 COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM orders o WHERE o.analytics_session_hash=v.session_hash AND o.status<>'cancelled' AND o.created_at>=($1::date::timestamp AT TIME ZONE $3) AND o.created_at<(($2::date+1)::timestamp AT TIME ZONE $3)))::int AS ordered FROM visits v`,args)).rows[0]
 const commerce=numeric((await db.query(`SELECT COUNT(*)::int AS orders,COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,COUNT(*) FILTER(WHERE status='completed')::int AS completed,COALESCE(SUM(total_cents) FILTER(WHERE status='completed'),0)::text AS completed_cents,COALESCE(ROUND(AVG(total_cents) FILTER(WHERE status<>'cancelled')),0)::text AS average_cents FROM orders WHERE created_at>=($1::date::timestamp AT TIME ZONE $3) AND created_at<(($2::date+1)::timestamp AT TIME ZONE $3)`,args)).rows[0])
 await db.query('COMMIT')
 return {range,settings,summary,days,pages,sources:groups.source,devices:groups.device,browsers:groups.browser,actions,commerce,generated_at:now.toISOString()}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export function registerAnalytics(app,pool,requireAdmin,isAdmin,{secret,origins=[]}={}){
 if(typeof secret!=='string'||secret.length<16)throw Error('Analytics requires a server secret')
 const reportWork=workLimiter(2)
 const hash=(type,value)=>createHmac('sha256',secret).update('nova-analytics:'+type+':'+value.toLowerCase()).digest('hex')
 const protect=handler=>async(req,reply)=>{try{return await handler(req,reply)}catch(e){if(e.analytics)return reply.code(400).send({error:e.message});throw e}}
 const timer=setInterval(()=>purgeAnalytics(pool).catch(()=>app.log.warn({event:'analytics.cleanup_failed'})),6*60*60*1000);timer.unref()
 app.addHook('onClose',async()=>clearInterval(timer))
 app.get('/api/analytics/config',async(req)=>{const settings=await config(pool);return {enabled:settings.enabled&&!(settings.exclude_admin&&await isAdmin(req))}})
 app.post('/api/analytics/collect',{bodyLimit:2048,onRequest:async(req,reply)=>{
  if(req.headers['x-nova-analytics']!=='1'||req.headers.origin&&!origins.includes(req.headers.origin))return reply.code(403).send({error:'Запрос отклонён'})
  if(req.headers.dnt==='1'||req.headers['sec-gpc']==='1'||/bot\b|crawler|spider|facebookexternalhit|bingpreview/i.test(req.headers['user-agent']||''))return reply.code(204).send()
 }},protect(async(req,reply)=>{
  const settings=await config(pool);if(!settings.enabled||settings.exclude_admin&&await isAdmin(req))return reply.code(204).send()
  const b=req.body,path=analyticsPath(b?.path)
  if(!b||!uuid(b.event_id)||!uuid(b.visitor_id)||!uuid(b.session_id)||!analyticsTypes.includes(b.type)||!path||typeof b.referrer!=='string'||b.referrer.length>253)throw invalid('Некорректное событие')
  const limit=await pool.query(`INSERT INTO analytics_throttle(key,attempts,reset_at) VALUES($1,1,NOW()+INTERVAL '10 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN analytics_throttle.reset_at<=NOW() THEN 1 ELSE analytics_throttle.attempts+1 END,reset_at=CASE WHEN analytics_throttle.reset_at<=NOW() THEN EXCLUDED.reset_at ELSE analytics_throttle.reset_at END WHERE analytics_throttle.attempts<120 OR analytics_throttle.reset_at<=NOW() RETURNING attempts`,[hash('ip',req.ip)])
  if(!limit.rowCount)return reply.header('Retry-After','600').code(429).send({error:'Слишком много событий'})
  const session=hash('session',b.session_id),visitor=hash('visitor',b.visitor_id),source=referralHost(b.referrer),own=origins.map(value=>referralHost(new URL(value).hostname)),info=deviceInfo(req.headers['user-agent'])
  const db=await pool.connect()
  try{
   await db.query('BEGIN')
   await db.query('INSERT INTO analytics_sessions(session_hash,visitor_hash,source,device,browser) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_hash) DO NOTHING',[session,visitor,own.includes(source)?'':source,info.device,info.browser])
   const row=(await db.query(`SELECT visitor_hash,(last_seen_at<NOW()-INTERVAL '30 minutes' OR started_at<NOW()-INTERVAL '24 hours') AS expired FROM analytics_sessions WHERE session_hash=$1 FOR UPDATE`,[session])).rows[0]
   if(row.visitor_hash!==visitor||row.expired){await db.query('ROLLBACK');return reply.code(409).send({error:'Начните новую сессию'})}
   await db.query('INSERT INTO analytics_events(id,session_hash,type,path) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[b.event_id,session,b.type,path])
   await db.query('UPDATE analytics_sessions SET last_seen_at=NOW() WHERE session_hash=$1',[session])
   await db.query('COMMIT');return reply.code(204).send()
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 }))
 app.get('/api/admin/analytics/settings',{preHandler:requireAdmin},()=>config(pool))
 app.put('/api/admin/analytics/settings',{preHandler:requireAdmin,bodyLimit:1024},protect(async(req)=>{
  const b=req.body
  if(!b||typeof b.enabled!=='boolean'||typeof b.exclude_admin!=='boolean'||!analyticsZones.includes(b.timezone))throw invalid('Проверьте настройки аналитики')
  await pool.query('UPDATE analytics_settings SET enabled=$1,exclude_admin=$2,timezone=$3 WHERE id=1',[b.enabled,b.exclude_admin,b.timezone]);return config(pool)
 }))
 app.get('/api/admin/analytics',{preHandler:requireAdmin},protect(req=>reportWork(()=>analyticsReport(pool,req.query))))
 return {attribute:async value=>{
  if(!uuid(value?.visitor_id)||!uuid(value?.session_id))return null
  try{
   const row=(await pool.query(`SELECT s.session_hash FROM analytics_sessions s JOIN analytics_settings a ON a.id=1 AND a.enabled=TRUE WHERE s.session_hash=$1 AND s.visitor_hash=$2 AND s.last_seen_at>NOW()-INTERVAL '30 minutes' AND s.started_at>NOW()-INTERVAL '24 hours'`,[hash('session',value.session_id),hash('visitor',value.visitor_id)])).rows[0]
   return row?.session_hash||null
  }catch{app.log.warn({event:'analytics.attribution_unavailable'});return null}
 }}
}
