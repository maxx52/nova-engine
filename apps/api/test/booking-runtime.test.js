import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {generateKeyPairSync} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {stageBookingPackage} from '../src/booking/package/stage.js'
import {loadBookingRuntime} from '../src/booking/package/runtime.js'
test('external runtime loads signed matching server code and rejects changed files or keys',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'nova-runtime-')),source=join(temp,'package'),store=join(temp,'store'),priv=join(temp,'private.pem'),pub=join(temp,'public.pem'),script=resolve('scripts/booking-package.mjs')
 try{
  const keys=generateKeyPairSync('ed25519');await mkdir(store,{mode:0o700});await writeFile(priv,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});const publicKey=keys.publicKey.export({format:'pem',type:'spki'});await writeFile(pub,publicKey,{mode:0o600})
  assert.equal(spawnSync(process.execPath,[script,'build',source]).status,0);assert.equal(spawnSync(process.execPath,[script,'sign',source,priv]).status,0)
  const staged=await stageBookingPackage({source,store,publicKey}),args={store,version:'0.1.0',keyPath:pub,coreVersion:'0.28.0'}
  const loaded=await loadBookingRuntime(args);assert.equal(typeof loaded.registerBooking,'function');assert.equal(typeof loaded.migrateBooking,'function')
  await assert.rejects(loadBookingRuntime({...args,version:'../foo'}),/Invalid/)
  await assert.rejects(loadBookingRuntime({...args,coreVersion:'0.29.0'}),/incompatible/)
  await assert.rejects(loadBookingRuntime({...args,keyPath:join(store,'key')}),/outside/)
  const file=join(staged.path,'server/index.js'),data=await readFile(file);data[0]^=1;await writeFile(file,data)
  await assert.rejects(loadBookingRuntime(args),/checksum mismatch/)
 }finally{await rm(temp,{recursive:true,force:true})}
})
