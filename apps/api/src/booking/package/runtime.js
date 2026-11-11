import {lstat,readFile} from 'node:fs/promises'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {verifyTrustedBookingPackage,bookingPackageFiles} from './manifest.js'

// External packages are opt-in and are read only from a separately managed local store.
export async function verifyBookingRuntime({store,version,keyPath,coreVersion}){
 if(!store||!keyPath||typeof version!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version))throw Error('Invalid Booking runtime configuration')
 const root=resolve(store),key=resolve(keyPath),rel=relative(root,key)
 if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw Error('Trusted key must be outside package store')
 async function trustedPath(path,kind){
  const s=await lstat(path)
  if(s.isSymbolicLink()||(kind==='directory'?!s.isDirectory():!s.isFile()))throw Error('Unsafe Booking runtime path')
  if(process.platform!=='win32'&&((s.mode&0o022)!==0||(process.getuid&&s.uid!==0&&s.uid!==process.getuid())))throw Error('Unsafe Booking runtime permissions')
 }
 await trustedPath(root,'directory');await trustedPath(key,'file')
 const dir=join(root,'booking-'+version)
 await trustedPath(dir,'directory')
 for(const folder of ['server','admin'])await trustedPath(join(dir,folder),'directory')
 for(const file of ['manifest.json','manifest.sig',...bookingPackageFiles])await trustedPath(join(dir,file),'file')
 const manifest=await verifyTrustedBookingPackage(dir,await readFile(key))
 if(manifest.version!==version||manifest.nova_min!==coreVersion||manifest.nova_max!==coreVersion)throw Error('Booking package is incompatible with NOVA')
 return {manifest,entry:join(dir,'server/index.js')}
}
export async function loadBookingRuntime(options){
 const {entry}=await verifyBookingRuntime(options)
 const loaded=await import(pathToFileURL(entry).href)
 if(typeof loaded.migrateBooking!=='function'||typeof loaded.registerBooking!=='function')throw Error('Invalid Booking server module')
 return loaded
}
