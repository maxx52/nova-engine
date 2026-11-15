import {mkdir,mkdtemp,lstat,readFile,writeFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {verifyTrustedBookingPackage,bookingPackageFiles} from './manifest.js'

// Staging only: no executable code is loaded, no database is changed, and no version is activated.
export async function stageBookingPackage({source,store,publicKey}){
 if(!publicKey)throw Error('Trusted public key is required')
 const storage=await lstat(store)
 if(!storage.isDirectory()||storage.isSymbolicLink())throw Error('Invalid staging directory')
 if(process.platform!=='win32'&&((storage.mode&0o022)!==0||(process.getuid&&storage.uid!==process.getuid())))throw Error('Staging directory must be owned by the current user and not group/world writable')
 const lock=join(store,'.booking-stage.lock')
 try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==='EEXIST')throw Error('Another staging operation is active or its lock needs inspection');throw e}
 let staging
 try{
  const verified=await verifyTrustedBookingPackage(source,publicKey)
  staging=await mkdtemp(join(store,'.booking-stage-'))
  await mkdir(join(staging,'server'),{mode:0o700});await mkdir(join(staging,'admin'),{mode:0o700})
  for(const file of ['manifest.json','manifest.sig',...bookingPackageFiles]){
   const bytes=await readFile(join(source,file))
   // Read sizes are checked before and after copying; staging is verified again below.
   if(bytes.length>1024*1024)throw Error('Package file too large')
   await writeFile(join(staging,file),bytes,{mode:0o600,flag:'wx'})
  }
  const copy=await verifyTrustedBookingPackage(staging,publicKey)
  if(copy.version!==verified.version)throw Error('Package changed during staging')
  const destination=join(store,'booking-'+copy.version)
  try{await lstat(destination);throw Error('This version already exists')}catch(e){if(e.code!=='ENOENT')throw e}
  await rename(staging,destination);staging=null
  return {staged:true,version:copy.version,path:destination,activated:false}
 }finally{
  if(staging)await rm(staging,{recursive:true,force:true})
  await rm(lock,{recursive:true,force:true})
 }
}
