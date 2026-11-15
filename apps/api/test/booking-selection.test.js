import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {generateKeyPairSync} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {stageBookingPackage} from '../src/booking/package/stage.js'
import {selectBookingVersion,readBookingSelection} from '../src/booking/package/selection.js'
import {loadBookingRuntime} from '../src/booking/package/runtime.js'
test('select and rollback only verified versions without damaging current selection',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'nova-select-')),store=join(temp,'store'),priv=join(temp,'private.pem'),pub=join(temp,'public.pem'),script=resolve('scripts/booking-package.mjs')
 try{
  await mkdir(store,{mode:0o700});const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'});await writeFile(pub,publicKey,{mode:0o600});await writeFile(priv,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600})
  for(const [index,version] of ['0.1.0','0.1.1'].entries()){
   const source=join(temp,'package'+index);assert.equal(spawnSync(process.execPath,[script,'build',source]).status,0)
   const path=join(source,'manifest.json'),manifest=JSON.parse(await readFile(path,'utf8'));manifest.version=version;await writeFile(path,JSON.stringify(manifest))
   assert.equal(spawnSync(process.execPath,[script,'sign',source,priv]).status,0);await stageBookingPackage({source,store,publicKey})
  }
  const opts={store,keyPath:pub,coreVersion:'0.28.0'}
  assert.equal((await selectBookingVersion({...opts,version:'0.1.0'})).current,'0.1.0')
  assert.deepEqual(await readBookingSelection(store),{current:'0.1.0',previous:null})
  assert.equal((await selectBookingVersion({...opts,version:'0.1.1'})).previous,'0.1.0')
  const chosen=await readBookingSelection(store);assert.equal(typeof (await loadBookingRuntime({...opts,version:chosen.current})).registerBooking,'function')
  assert.equal((await selectBookingVersion({...opts,rollback:true})).current,'0.1.0')
  const altered=join(store,'booking-0.1.1/server/index.js'),buf=await readFile(altered);buf[0]^=1;await writeFile(altered,buf)
  await assert.rejects(selectBookingVersion({...opts,version:'0.1.1'}),/checksum mismatch/)
  assert.equal((await readBookingSelection(store)).current,'0.1.0')
  await assert.rejects(selectBookingVersion({...opts,version:'../bad'}),/Invalid/)
 }finally{await rm(temp,{recursive:true,force:true})}
})
