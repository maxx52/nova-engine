import {mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createPrivateKey,sign} from 'node:crypto'
import {fileMetadata,verifyBookingPackage,verifyTrustedBookingPackage} from '../apps/api/src/booking/package/manifest.js'
const root=fileURLToPath(new URL('../',import.meta.url)),[action,arg,keyPath]=process.argv.slice(2)
if(!['build','verify','sign','verify-trusted'].includes(action)||!arg||(['sign','verify-trusted'].includes(action)&&!keyPath)||(['build','verify'].includes(action)&&keyPath)){console.error('Usage: node scripts/booking-package.mjs build|verify DIRECTORY or sign|verify-trusted DIRECTORY KEY');process.exit(2)}
const dir=resolve(arg)
try{
 if(action==='build'){
  // Never overwrite an existing package or another path.
  await mkdir(dir,{recursive:false,mode:0o700})
  try{
   await mkdir(join(dir,'server'));await mkdir(join(dir,'admin'))
   const inputs={'server/index.js':'apps/api/src/booking/index.js','admin/BookingWorkspace.vue':'apps/admin/src/BookingWorkspace.vue'},files={}
   for(const [target,source] of Object.entries(inputs)){const bytes=await readFile(join(root,source));files[target]=fileMetadata(bytes);await writeFile(join(dir,target),bytes,{flag:'wx',mode:0o600})}
   const manifest={format:'nova-booking-package-v1',version:'0.1.0',module_api:1,nova_min:'0.28.0',nova_max:'0.28.0',files}
   await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600})
  }catch(e){await rm(dir,{recursive:true,force:true});throw e}
 }
 let m=await verifyBookingPackage(dir)
 if(action==='sign'){
  const key=createPrivateKey(await readFile(resolve(keyPath)))
  if(key.asymmetricKeyType!=='ed25519')throw Error('Signing key must be Ed25519')
  const signature=sign(null,await readFile(join(dir,'manifest.json')),key).toString('base64')
  await writeFile(join(dir,'manifest.sig'),signature,{flag:'wx',mode:0o600})
 }
 if(action==='verify-trusted')m=await verifyTrustedBookingPackage(dir,await readFile(resolve(keyPath)))
 console.log(JSON.stringify({verified:true,signature_verified:action==='verify-trusted',version:m.version,module_api:m.module_api,nova_min:m.nova_min,nova_max:m.nova_max}))
}catch(e){console.error('Booking package error:',e.message);process.exitCode=1}
