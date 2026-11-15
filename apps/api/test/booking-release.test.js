import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'

const root=resolve(import.meta.dirname,'../../..')
test('core release excludes the independently distributed Booking implementation',async t=>{
 try{await stat(join(root,'apps/admin/dist/index.html'));await stat(join(root,'apps/storefront/dist/index.html'))}catch{t.skip('Build the applications before checking the release archive');return}
 const temp=await mkdtemp(join(tmpdir(),'nova-release-test-'))
 try{
  const build=spawnSync(process.execPath,['scripts/build-release.mjs',temp],{cwd:root,encoding:'utf8'})
  assert.equal(build.status,0,build.stderr)
  const archive=join(temp,JSON.parse(build.stdout).artifact)
  const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'})
  assert.equal(listing.status,0,listing.stderr)
  const files=new Set(listing.stdout.trim().split('\n'))
  for(const path of ['apps/api/src/booking/index.js','apps/admin/src/BookingWorkspace.vue','apps/admin/src/bookingEntry.js','scripts/booking-package.mjs','scripts/booking-schema.mjs'])assert.equal(files.has(path),false,path)
  assert.equal(files.has('apps/api/src/booking/package/runtime.js'),true)
  const assets=join(root,'apps/admin/dist/assets')
  for(const name of await readdir(assets))if(name.endsWith('.js')){
   const source=await readFile(join(assets,name),'utf8')
   assert.equal(source.includes('Название организации'),false,name)
   assert.equal(source.includes('Сохранить доступ'),false,name)
  }
 }finally{await rm(temp,{recursive:true,force:true})}
})
