import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,randomBytes} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import pg from 'pg'
import {stageBookingPackage} from '../src/booking/package/stage.js'
import {selectBookingVersion} from '../src/booking/package/selection.js'
import {hashPassword} from '../src/auth.js'
const url=process.env.BOOKING_TEST_DATABASE_URL

test('signed external server package starts against dedicated PostgreSQL without losing existing data',{skip:!url,timeout:30000},async()=>{
 if(new URL(url).pathname!=='/nova_booking_verify')throw Error('A dedicated nova_booking_verify database is required')
 const temp=await mkdtemp(join(tmpdir(),'nova-runtime-pg-')),store=join(temp,'store'),source=join(temp,'package'),keyPath=join(temp,'public.pem'),priv=join(temp,'private.pem'),pool=new pg.Pool({connectionString:url}),script=resolve('scripts/booking-package.mjs')
 let child
 try{
  const before=await pool.query('SELECT count(*)::int AS count FROM nova_booking_organizations')
  const suffix=randomBytes(5).toString('hex'),username='ui'+suffix,password='booking-ui-password-2026',hash=await hashPassword(password)
  const next=await pool.query('SELECT COALESCE(MAX(id),0)+1 AS id FROM admin_accounts')
  await pool.query("INSERT INTO admin_accounts(id,username,password_hash,role) VALUES($1,$2,$3,'owner')",[next.rows[0].id,username,hash])
  const keys=generateKeyPairSync('ed25519');await mkdir(store,{mode:0o700});await writeFile(priv,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});const publicKey=keys.publicKey.export({format:'pem',type:'spki'});await writeFile(keyPath,publicKey,{mode:0o600})
  assert.equal(spawnSync(process.execPath,[script,'build',source]).status,0);assert.equal(spawnSync(process.execPath,[script,'sign',source,priv]).status,0)
  await stageBookingPackage({source,store,publicKey})
  await selectBookingVersion({store,keyPath,coreVersion:'0.28.0',version:'0.1.0'})
  const listener=createServer();await new Promise((yes,no)=>listener.once('error',no).listen(0,'127.0.0.1',yes));const port=listener.address().port;await new Promise(yes=>listener.close(yes))
  child=spawn(process.execPath,['apps/api/src/server.js'],{env:{...process.env,NODE_ENV:'development',DATABASE_URL:url,ADMIN_API_KEY:'runtime-test-only-key-2026',NOVA_BOOKING_ENABLED:'true',NOVA_BOOKING_PACKAGE_STORE:store,NOVA_BOOKING_USE_SELECTION:'true',NOVA_BOOKING_PACKAGE_VERSION:'',NOVA_BOOKING_TRUSTED_KEY:keyPath,UPLOAD_DIRECTORY:join(temp,'uploads'),API_HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'})
  let status;const deadline=Date.now()+15000
  while(Date.now()<deadline){if(child.exitCode!==null)break;try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(500)});if(response.ok){status=await response.json();break}}catch{}await new Promise(r=>setTimeout(r,150))}
  assert.equal(status?.database,'connected','test API failed to start')
  const base=`http://127.0.0.1:${port}`,headers={'x-nova-request':'1'}
  assert.equal((await fetch(base+'/api/admin/booking/interface.js')).status,401)
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(login.status,200)
  const cookie=login.headers.get('set-cookie').split(';')[0]
  const info=await fetch(base+'/api/admin/booking/runtime',{headers:{...headers,cookie}});assert.deepEqual(await info.json(),{mode:'external',version:'0.1.0'})
  const js=await fetch(base+'/api/admin/booking/interface.js?v=0.1.0',{headers:{...headers,cookie}})
  assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.match(js.headers.get('cache-control'),/no-store/)
  assert.deepEqual(Buffer.from(await js.arrayBuffer()),await readFile(join(source,'admin/booking-ui.js')))
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM nova_booking_organizations')).rows[0].count,before.rows[0].count)
 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(done=>{child.once('exit',done);setTimeout(done,2000).unref()})}await pool.end();await rm(temp,{recursive:true,force:true})}
})
