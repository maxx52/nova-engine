import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {verifyBookingPackage} from '../src/booking/package/manifest.js'
test('Booking package verifies only declared bounded files and detects tampering',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'nova-booking-package-')),dir=join(temp,'package'),script=resolve('scripts/booking-package.mjs')
 try{
  const build=spawnSync(process.execPath,[script,'build',dir],{encoding:'utf8'});assert.equal(build.status,0,build.stderr)
  assert.equal((await verifyBookingPackage(dir)).version,'0.1.0')
  const ui=await import(pathToFileURL(join(dir,'admin/booking-ui.js')).href);assert.equal(typeof ui.mountBooking,'function');assert.throws(()=>ui.mountBooking(null,{}),/Invalid Booking host context/)
  assert.notEqual(spawnSync(process.execPath,[script,'build',dir],{encoding:'utf8'}).status,0)
  const file=join(dir,'server/index.js'),original=await readFile(file);await writeFile(file,Buffer.concat([original,Buffer.from('x')]))
  await assert.rejects(verifyBookingPackage(dir),/mismatch/);await writeFile(file,original)
  const manifestPath=join(dir,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));manifest.files['../escape']={size:1,sha256:'0'.repeat(64)};await writeFile(manifestPath,JSON.stringify(manifest))
  await assert.rejects(verifyBookingPackage(dir),/Invalid package files/)
 }finally{await rm(temp,{recursive:true,force:true})}
})

test('signed package rejects another key and changed content or manifest',async()=>{
 const {generateKeyPairSync}=await import('node:crypto')
 const {verifyTrustedBookingPackage}=await import('../src/booking/package/manifest.js')
 const temp=await mkdtemp(join(tmpdir(),'nova-booking-sign-')),dir=join(temp,'package'),script=resolve('scripts/booking-package.mjs')
 try{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519').publicKey
  const privatePath=join(temp,'private.pem'),publicPath=join(temp,'public.pem')
  await writeFile(privatePath,privateKey.export({type:'pkcs8',format:'pem'}));await writeFile(publicPath,publicKey.export({type:'spki',format:'pem'}))
  assert.equal(spawnSync(process.execPath,[script,'build',dir]).status,0)
  assert.notEqual(spawnSync(process.execPath,[script,'verify-trusted',dir,publicPath]).status,0)
  assert.equal(spawnSync(process.execPath,[script,'sign',dir,privatePath]).status,0)
  assert.equal(spawnSync(process.execPath,[script,'verify-trusted',dir,publicPath]).status,0)
  assert.notEqual(spawnSync(process.execPath,[script,'sign',dir,privatePath]).status,0)
  await assert.rejects(verifyTrustedBookingPackage(dir,other.export({type:'spki',format:'pem'})),/signature verification failed/)
  const path=join(dir,'manifest.json'),original=await readFile(path,'utf8'),m=JSON.parse(original);m.version='0.1.1';await writeFile(path,JSON.stringify(m))
  await assert.rejects(verifyTrustedBookingPackage(dir,publicKey.export({type:'spki',format:'pem'})),/signature verification failed/)
  await writeFile(path,original)
  const file=join(dir,'server/index.js'),content=await readFile(file);content[0]^=1;await writeFile(file,content)
  await assert.rejects(verifyTrustedBookingPackage(dir,publicKey.export({type:'spki',format:'pem'})),/checksum mismatch/)
 }finally{await rm(temp,{recursive:true,force:true})}
})
