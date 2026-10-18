import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {createServer} from 'node:http'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {registerSystem,validateSystemCommand,agentRequest} from '../src/system.js'
import {registerAuth} from '../src/auth.js'
import {pool,initDatabase} from '../src/db.js'
import {compareVersions,publicRelease,RELEASES_URL} from '../../../shared/releases.js'

test('release comparison and system operations reject shell paths, arbitrary URLs, preview releases and accidental restore',()=>{
 assert.equal(compareVersions('0.21.0','0.20.10'),1);assert.equal(compareVersions('0.21.0','0.21.0'),0)
 for(const v of ['main','1.2','1.2.3;id','01.2.3'])assert.throws(()=>compareVersions(v,'0.21.0'))
 const r={tag_name:'v0.21.0',html_url:RELEASES_URL+'/tag/v0.21.0',name:'Test',body:'Notes',draft:false,prerelease:false};assert.equal(publicRelease(r).version,'0.21.0')
 for(const change of [{draft:true},{prerelease:true},{html_url:'https://evil.invalid'},{tag_name:'v0.22.0-beta'}])assert.equal(publicRelease({...r,...change}),null)
 for(const value of [{kind:'backup'},{kind:'update',version:'0.21.0'},{kind:'restore',backup_id:'20261018T100000Z-abcdef12',confirm:'ВОССТАНОВИТЬ'}])assert.ok(validateSystemCommand(value))
 for(const value of [{kind:'shell'},{kind:'backup',path:'/etc'},{kind:'update',version:'main'},{kind:'update',version:'0.21.0',url:'http://evil.invalid'},{kind:'restore',backup_id:'20261018T100000Z-abcdef12'},{kind:'verify',backup_id:'../backup'},{kind:'schedule',enabled:true,hour_utc:24,retention_days:7}])assert.equal(validateSystemCommand(value),false)
})
test('local agent transport uses a Unix socket and surfaces only bounded JSON protocol replies',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'nova-system-')),socket=join(folder,'agent.sock'),server=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/bad'){res.writeHead(409);res.end(JSON.stringify({error:'Операция занята'}))}else res.end(JSON.stringify({protocol:1,path:req.url}))})
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve)})}catch(e){await rm(folder,{recursive:true,force:true});if(e.code==='EPERM'){t.skip('Unix socket binding is unavailable in this execution environment');return}throw e}
 try{assert.equal((await agentRequest(socket,'/status')).protocol,1);await assert.rejects(agentRequest(socket,'/bad'),e=>e.system&&e.statusCode===409)}finally{await new Promise(resolve=>server.close(resolve));await rm(folder,{recursive:true,force:true})}
})
test('system API requires an admin session and CSRF, validates commands before contacting the privileged manager',async()=>{
 const pg=new PGlite(),query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}},db={query,connect:async()=>({query,release(){}})};pool.query=query;pool.connect=db.connect;await initDatabase()
 const app=Fastify(),key='system-test-key-32-or-more-characters',calls=[];const {requireAdmin}=registerAuth(app,db,{setupKey:key})
 registerSystem(app,requireAdmin,{socketPath:'/fake/socket',request:async(socket,path,body)=>{calls.push({socket,path,body});return path==='/status'?{protocol:1,backups:[],active:null}:{id:'test-job'}}})
 const headers={'x-nova-request':'1',origin:'http://localhost:5174'}
 try{
  assert.equal((await app.inject({url:'/api/admin/system'})).statusCode,401)
  assert.equal((await app.inject({method:'POST',url:'/api/admin/system/jobs',payload:{kind:'backup'}})).statusCode,401)
  const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers,payload:{username:'system_admin',password:'temporary-test-password',setup_key:key}});assert.equal(setup.statusCode,201)
  const auth={...headers,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token}
  assert.equal((await app.inject({method:'POST',url:'/api/admin/system/jobs',headers:{...auth,'x-csrf-token':'bad'},payload:{kind:'backup'}})).statusCode,403)
  assert.equal(calls.length,0)
  assert.equal((await app.inject({method:'POST',url:'/api/admin/system/jobs',headers:auth,payload:{kind:'backup',path:'/etc'}})).statusCode,400)
  assert.equal(calls.length,0)
  const status=await app.inject({url:'/api/admin/system',headers:auth});assert.equal(status.statusCode,200);assert.equal(status.json().available,true)
  const request=await app.inject({method:'POST',url:'/api/admin/system/jobs',headers:auth,payload:{kind:'backup'}});assert.equal(request.statusCode,202);assert.deepEqual(calls.at(-1).body,{kind:'backup'})
 }finally{await app.close();await pg.close()}
})
