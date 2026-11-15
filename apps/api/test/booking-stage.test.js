import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises'
import {generateKeyPairSync} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {stageBookingPackage} from '../src/booking/package/stage.js'
test('staging requires a trusted signature, preserves versions and rejects damaged files',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'nova-stage-')),source=join(temp,'package'),store=join(temp,'store'),keyFile=join(temp,'private.pem'),script=resolve('scripts/booking-package.mjs')
 try{
  await mkdir(store,{mode:0o700})
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519').publicKey
  const trusted=publicKey.export({format:'pem',type:'spki'})
  await writeFile(keyFile,privateKey.export({format:'pem',type:'pkcs8'}))
  assert.equal(spawnSync(process.execPath,[script,'build',source]).status,0)
  await assert.rejects(stageBookingPackage({source,store,publicKey:trusted}))
  assert.equal(spawnSync(process.execPath,[script,'sign',source,keyFile]).status,0)
  await assert.rejects(stageBookingPackage({source,store,publicKey:other.export({format:'pem',type:'spki'})}),/signature verification failed/)
  assert.deepEqual(await readdir(store),[])
  const result=await stageBookingPackage({source,store,publicKey:trusted});assert.equal(result.activated,false);assert.equal(result.version,'0.1.0')
  const original=await readFile(join(result.path,'server/index.js'))
  await assert.rejects(stageBookingPackage({source,store,publicKey:trusted}),/already exists/)
  assert.deepEqual(await readFile(join(result.path,'server/index.js')),original)
  const altered=Buffer.from(original);altered[0]^=1;await writeFile(join(source,'server/index.js'),altered)
  await assert.rejects(stageBookingPackage({source,store,publicKey:trusted}),/checksum mismatch/)
  assert.deepEqual(await readdir(store),['booking-0.1.0'])
 }finally{await rm(temp,{recursive:true,force:true})}
})
