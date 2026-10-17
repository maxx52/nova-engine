import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {analyticsPath,referralHost,dayAt,addDays} from '../../../shared/analytics.js'
import {registerAnalytics,analyticsReport,purgeAnalytics,reportRange,deviceInfo} from '../src/analytics.js'
import {createOrder,updateOrder} from '../src/commerce.js'
import {pool,initDatabase} from '../src/db.js'
import {registerAuth} from '../src/auth.js'
import {publicErrorHandler} from '../src/security.js'

test('analytics strips query strings, rejects private paths and stores only validated referral domains',()=>{
 assert.equal(analyticsPath('/product/12/?email=private#secret'),'/product/12')
 for(const path of ['/admin','/api/orders','/uploads/file.jpg','/health','//evil.invalid','/admin/login','/%61dmin','/customer/person@example.com','/a/b'])assert.equal(analyticsPath(path),null,path)
 assert.equal(referralHost('www.Google.com'),'google.com')
 for(const host of ['https://google.com/?secret=1','test@example.com','127.0.0.1','google.com/path','google.com\n','localhost','-bad.example'])assert.equal(referralHost(host),'',host)
 assert.deepEqual(deviceInfo('Mozilla iPhone Mobile Safari/16'),{device:'mobile',browser:'Safari'})
 assert.deepEqual(deviceInfo('Mozilla Android Tablet Chrome/100'),{device:'tablet',browser:'Chrome'})
 assert.equal(reportRange({from:'2026-10-01',to:'2026-10-17'},'Asia/Novosibirsk',new Date('2026-10-16T20:00:00Z')).to,'2026-10-17')
 for(const range of [{from:'2026-02-30',to:'2026-10-17'},{from:'2026-10-18',to:'2026-10-18'},{from:'2026-01-01',to:'2026-10-17'},{from:'2026-10-17',to:'2026-10-16'}])assert.throws(()=>reportRange(range,'Asia/Novosibirsk',new Date('2026-10-17T00:00:00Z')))
})

test('PostgreSQL analytics: privacy, distinct counts, timezone, order attribution, opt-out, retention and access',async t=>{
 const pg=new PGlite(),query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve();const db={query,connect:async()=>{const prev=tail;let release;tail=new Promise(r=>release=r);await prev;return {query,release}}}
 pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify(),secret='only-a-temporary-test-secret-32-characters'
 const {requireAdmin,isAdmin}=registerAuth(app,db,{setupKey:secret})
 const analytics=registerAnalytics(app,db,requireAdmin,isAdmin,{secret,origins:['http://localhost:5173','https://nova.test']});app.setErrorHandler(publicErrorHandler)
 const basic={'x-nova-request':'1',origin:'http://localhost:5174'},setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:basic,payload:{username:'test_admin',password:'temporary-analytics-password',setup_key:secret}})
 assert.equal(setup.statusCode,201,setup.body)
 const auth={...basic,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token}
 const headers={'x-nova-analytics':'1',origin:'http://localhost:5173','user-agent':'Mozilla Chrome/120'}
 const call=(method,url,payload,h=auth)=>app.inject({method,url,payload,headers:h})
 const visitor1=randomUUID(),visitor2=randomUUID(),session1=randomUUID(),session2=randomUUID(),session3=randomUUID()
 const event=(overrides={})=>({event_id:randomUUID(),visitor_id:visitor1,session_id:session1,type:'pageview',path:'/',referrer:'google.com',...overrides})
 const collect=async(payload,h=headers)=>{const r=await call('POST','/api/analytics/collect',payload,h);assert.equal(r.statusCode,204,r.body);return r}
 const count=async table=>(await query('SELECT COUNT(*)::int AS n FROM '+table)).rows[0].n
 const today=dayAt(new Date(),'Asia/Novosibirsk')
 let orderId,hash
 try{
  await t.test('admin reports are private and collector rejects cross-origin/simple requests and private routes',async()=>{
   for(const url of ['/api/admin/analytics','/api/admin/analytics/settings'])assert.equal((await call('GET',url,undefined,{})).statusCode,401)
   assert.deepEqual((await call('GET','/api/analytics/config',undefined,{})).json(),{enabled:true})
   assert.deepEqual((await call('GET','/api/analytics/config')).json(),{enabled:false})
   assert.equal((await call('POST','/api/analytics/collect',event(),{})).statusCode,403)
   assert.equal((await call('POST','/api/analytics/collect',event(),{...headers,origin:'https://evil.invalid'})).statusCode,403)
   assert.equal((await call('POST','/api/analytics/collect',event({path:'/admin/settings'}),headers)).statusCode,400)
   await collect(event(),{...headers,cookie:auth.cookie});await collect(event(),{...headers,dnt:'1'});await collect(event(),{...headers,'sec-gpc':'1'});await collect(event(),{...headers,'user-agent':'Googlebot/2.1'})
   assert.equal(await count('analytics_events'),0)
   assert.equal((await call('PUT','/api/admin/analytics/settings',{enabled:false,exclude_admin:true,timezone:'UTC'},{...auth,'x-csrf-token':'bad'})).statusCode,403)
  })
  await t.test('events are idempotent, sessions preserve source, visitors deduplicate across sessions, raw IDs and URL secrets are absent',async()=>{
   const first=event({path:'/?email=private@example.invalid#secret'});await collect(first);await collect(first)
   await collect(event({path:'/product/1',referrer:'different.example'}));await collect(event({type:'cart_add'}));await collect(event({type:'cart_add'}));await collect(event({type:'checkout_start'}))
   await collect(event({session_id:session2,path:'/catalog',referrer:'nova.test'}))
   await collect(event({visitor_id:visitor2,session_id:session3,path:'/blog/first',referrer:'yandex.ru'}),{...headers,'user-agent':'Mozilla iPhone Mobile Safari/17'})
   await collect(event({visitor_id:visitor2,session_id:session3,path:'/blog',referrer:''}))
   const data=await analyticsReport(db,{from:today,to:today})
   assert.deepEqual(data.summary,{pageviews:5,sessions:3,visitors:2});assert.deepEqual(data.actions,{sessions:3,cart:1,checkout:1,ordered:0})
   assert.equal(data.sources.find(x=>x.name==='google.com').sessions,1);assert.equal(data.sources.find(x=>x.name==='').sessions,1)
   assert.equal(data.devices.find(x=>x.name==='mobile').sessions,1)
   const stored=JSON.stringify((await query('SELECT * FROM analytics_sessions')).rows)+JSON.stringify((await query('SELECT * FROM analytics_events')).rows)
   for(const value of [visitor1,session1,'private@example.invalid','secret','Mozilla','iPhone'])assert.equal(stored.includes(value),false,value)
   hash=(await query('SELECT session_hash FROM analytics_sessions WHERE source=$1',['google.com'])).rows[0].session_hash
   assert.equal((await query('SELECT COUNT(DISTINCT id)::int AS n FROM analytics_events')).rows[0].n,8)
  })
  await t.test('orders link only known visitor/session pairs; conversion excludes cancelled orders and retries do not duplicate',async()=>{
   assert.equal(await analytics.attribute({visitor_id:visitor2,session_id:session1}),null)
   assert.equal(await analytics.attribute({visitor_id:visitor1,session_id:randomUUID()}),null)
   assert.equal(await analytics.attribute({visitor_id:visitor1,session_id:session1}),hash)
   await query('UPDATE products SET stock=4 WHERE id=1')
   const body={request_id:randomUUID(),analytics:{visitor_id:visitor1,session_id:session1},customer:{name:'Analytics test',phone:'+79991112233',email:''},delivery:{method:'pickup',address:''},comment:'',items:[{product_id:1,variant_name:'',quantity:1}]}
   await createOrder(db,body,{attribute:analytics.attribute});await createOrder(db,body,{attribute:analytics.attribute})
   const row=(await query('SELECT id::text,analytics_session_hash FROM orders')).rows[0];orderId=row.id;assert.equal(row.analytics_session_hash,hash)
   let data=await analyticsReport(db,{from:today,to:today});assert.equal(data.actions.ordered,1);assert.equal(data.commerce.orders,1)
   await updateOrder(db,orderId,{revision:1,status:'cancelled',admin_note:''})
   data=await analyticsReport(db,{from:today,to:today});assert.equal(data.actions.ordered,0);assert.equal(data.commerce.cancelled,1);assert.equal(data.commerce.average_cents,0)
  })
  await t.test('daily grouping respects selected timezone and inserts zero days',async()=>{
   const boundary=(await query(`SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Novosibirsk') AS at`,[today])).rows[0].at
   // One pageview just before local midnight belongs to the previous day.
   await query("UPDATE analytics_events SET at=$1::timestamptz-INTERVAL '1 second' WHERE id=(SELECT id FROM analytics_events WHERE type='pageview' AND session_hash=$2 LIMIT 1)",[boundary,hash])
   const data=await analyticsReport(db,{from:addDays(today,-2),to:today});assert.equal(data.days.length,3);assert.equal(data.days[0].pageviews,0);assert.equal(data.days[1].pageviews,1);assert.equal(data.days[2].pageviews,4)
   assert.equal(data.summary.visitors,2);assert.equal(data.summary.sessions,3)
   assert.equal((await call('GET','/api/admin/analytics?from=broken')).statusCode,400)
  })
  await t.test('disabled collection retains reports, admin settings validate timezone, expired sessions require rotation',async()=>{
   const b={enabled:false,exclude_admin:true,timezone:'UTC'};assert.equal((await call('PUT','/api/admin/analytics/settings',{...b,timezone:'invalid'})).statusCode,400)
   assert.equal((await call('PUT','/api/admin/analytics/settings',b)).statusCode,200)
   const before=await count('analytics_events');await collect(event());assert.equal(await count('analytics_events'),before)
   assert.equal(await analytics.attribute({visitor_id:visitor1,session_id:session1}),null)
   assert.equal((await call('GET','/api/analytics/config',undefined,{})).json().enabled,false)
   assert.equal((await call('GET','/api/admin/analytics')).statusCode,200)
   await call('PUT','/api/admin/analytics/settings',{enabled:true,exclude_admin:false,timezone:'Asia/Novosibirsk'})
   await collect(event({session_id:randomUUID()}),{...headers,cookie:auth.cookie});assert.equal(await count('analytics_events'),before+1)
   await query("UPDATE analytics_sessions SET last_seen_at=NOW()-INTERVAL '31 minutes' WHERE session_hash=$1",[hash])
   assert.equal((await call('POST','/api/analytics/collect',event(),headers)).statusCode,409)
  })
  await t.test('retention purges sessions/events and unlinks old attribution without deleting the historical order',async()=>{
   const before=await count('analytics_events');await query("UPDATE analytics_sessions SET started_at=NOW()-INTERVAL '91 days' WHERE session_hash=$1",[hash]);await purgeAnalytics(db)
   assert.ok(await count('analytics_events')<before);assert.equal(await count('orders'),1);assert.equal((await query('SELECT analytics_session_hash FROM orders WHERE id=$1',[orderId])).rows[0].analytics_session_hash,null)
  })
  await t.test('collector enforces persistent event budget',async()=>{
   await query('UPDATE analytics_throttle SET attempts=120');const r=await call('POST','/api/analytics/collect',event({session_id:randomUUID()}),headers);assert.equal(r.statusCode,429);assert.equal(r.headers['retry-after'],'600')
  })
 }finally{await app.close();await pool.end();await pg.close()}
})
