import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {securityConfig,registerSecurity,workLimiter,publicErrorHandler,assertDatabaseRole} from '../src/security.js'
import {httpHeaders} from '../../../config/httpHeaders.js'
import {safeLink} from '../../../shared/contentSafety.js'
test('production refuses default secrets, HTTP admin origins and blindly trusted proxies',()=>{
 const env={NODE_ENV:'production',ADMIN_ORIGINS:'https://admin.example.com',ADMIN_API_KEY:'a-randomly-generated-long-secret-for-test-only',DATABASE_URL:'postgres://nova:non-demo-password@db/nova'}
 assert.equal(securityConfig(env).secure,true)
 for(const patch of [{ADMIN_ORIGINS:''},{ADMIN_ORIGINS:'http://admin.example.com'},{ADMIN_API_KEY:'replace-with-a-random-secret-at-least-16-characters'},{DATABASE_URL:'postgres://nova:nova_dev_password@db/nova'},{TRUST_PROXY:'true'},{TRUST_PROXY:'0.0.0.0/0'}])assert.throws(()=>securityConfig({...env,...patch}))
 assert.equal(securityConfig({}).trustProxy,false)
 assert.deepEqual(securityConfig({...env,TRUST_PROXY:'loopback'}).trustProxy,['loopback'])
})
test('rate limits precede parsing and security headers cover errors and private caching',async()=>{
 let now=0;const app=Fastify();registerSecurity(app,{secure:true,now:()=>now,perIp:2,globalMax:10})
 app.get('/api/test',()=>({ok:true}))
 try{
  const r=await app.inject('/api/test');assert.equal(r.statusCode,200);assert.equal(r.headers['x-frame-options'],'DENY');assert.equal(r.headers['x-content-type-options'],'nosniff');assert.equal(r.headers['cache-control'],'no-store');assert.match(r.headers['strict-transport-security'],/31536000/);assert.match(r.headers['content-security-policy'],/sandbox/)
  await app.inject('/not-found');const limited=await app.inject('/api/test');assert.equal(limited.statusCode,429);assert.equal(limited.headers['retry-after'],'60');assert.equal(limited.headers['x-frame-options'],'DENY')
  now+=61000;assert.equal((await app.inject('/api/test')).statusCode,200)
 }finally{await app.close()}
 assert.ok(!httpHeaders()['Content-Security-Policy'].includes("script-src 'self' 'unsafe-inline'"))
 assert.match(httpHeaders()['Content-Security-Policy'],/frame-ancestors 'none'/)
})
test('expensive work has a bounded concurrency budget without an unbounded queue',async()=>{
 const run=workLimiter(1);let release
 const first=run(()=>new Promise(resolve=>release=resolve))
 await assert.rejects(run(async()=>{}),e=>e.statusCode===503)
 release('done');assert.equal(await first,'done');assert.equal(await run(async()=>42),42)
 await assert.rejects(run(async()=>{throw Error('failure')}));assert.equal(await run(async()=>7),7)
})
test('links block script protocols, control characters, network paths and deceptive credentials',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,x','//evil.example','/\\evil.example','https://trusted.example@evil.example','https://','https://example.com\u0000x'])assert.equal(safeLink(value),false)
 for(const value of ['/about','/#contacts','https://example.com/blog',''])assert.equal(safeLink(value),true)
})

test('error responses hide SQL details, secrets and parser input',async()=>{
 const app=Fastify();app.setErrorHandler(publicErrorHandler)
 app.get('/fail',async()=>{throw Error('postgres password=secret SELECT internal_table')})
 app.get('/bad',async()=>{throw Object.assign(Error('bad body contains private-input'),{statusCode:400})})
 try{for(const path of ['/fail','/bad']){const r=await app.inject(path);assert.ok(!r.body.includes('secret'));assert.ok(!r.body.includes('internal_table'));assert.ok(!r.body.includes('private-input'))}}finally{await app.close()}
})

test('production database guard refuses a superuser or inherited server privileges',async()=>{
 await assert.rejects(assertDatabaseRole({query:async()=>({rows:[{unsafe:true}]})}))
 await assert.rejects(assertDatabaseRole({query:async()=>({rows:[]})}))
 await assertDatabaseRole({query:async()=>({rows:[{unsafe:false}]})})
})
