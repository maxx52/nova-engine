import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {verifyBookingPackage} from '../src/booking/package/manifest.js'
test('Booking package verifies only declared bounded files and detects tampering',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'nova-booking-package-')),dir=join(temp,'package'),script=resolve('scripts/booking-package.mjs')
 try{
  const build=spawnSync(process.execPath,[script,'build',dir],{encoding:'utf8'});assert.equal(build.status,0,build.stderr)
  assert.equal((await verifyBookingPackage(dir)).version,'0.1.0')
  assert.notEqual(spawnSync(process.execPath,[script,'build',dir],{encoding:'utf8'}).status,0)
  const file=join(dir,'server/index.js'),original=await readFile(file);await writeFile(file,Buffer.concat([original,Buffer.from('x')]))
  await assert.rejects(verifyBookingPackage(dir),/mismatch/);await writeFile(file,original)
  const manifestPath=join(dir,'manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));manifest.files['../escape']={size:1,sha256:'0'.repeat(64)};await writeFile(manifestPath,JSON.stringify(manifest))
  await assert.rejects(verifyBookingPackage(dir),/Invalid package files/)
 }finally{await rm(temp,{recursive:true,force:true})}
})
