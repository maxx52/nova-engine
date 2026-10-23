import test from 'node:test'
import assert from 'node:assert/strict'
import {adminVersionMismatch,canRefreshAdmin,adminRefreshUrl} from '../../../shared/adminVersion.js'
test('admin reload waits for a completed coherent installation and guards stale-cache reload loops',()=>{
 const old='0.21.2',next='0.22.0',status={current_version:next,installed_version:next,active:null}
 assert.equal(adminVersionMismatch(old,next),true)
 assert.equal(adminVersionMismatch(next,next),false)
 for(const bad of [null,undefined,'','main','<script>'])assert.equal(adminVersionMismatch(old,bad),false)
 assert.equal(canRefreshAdmin(old,status,null),true)
 assert.equal(canRefreshAdmin(old,{...status,active:{kind:'update'}},null),false)
 assert.equal(canRefreshAdmin(old,{...status,current_version:old},null),false,'do not reload into files whose API is still old')
 assert.equal(canRefreshAdmin(old,{...status,installed_version:'0.22.1'},null),false)
 assert.equal(canRefreshAdmin(old,status,next),false,'one attempt per target version prevents loops')
 assert.equal(canRefreshAdmin(next,{current_version:old,installed_version:old,active:null},null),true,'restores also refresh the UI')
 assert.equal(canRefreshAdmin(old,null,null),false)
 const url=new URL(adminRefreshUrl('https://shop.example/admin/?tab=system#status',next));assert.equal(url.searchParams.get('tab'),'system');assert.equal(url.searchParams.get('nova_version'),next);assert.equal(url.hash,'#status')
 assert.throws(()=>adminRefreshUrl('https://shop.example/admin/','main'))
})
