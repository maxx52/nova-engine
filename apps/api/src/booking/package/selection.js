import {lstat,readFile,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {verifyBookingRuntime} from './runtime.js'
const versionPattern=/^\d{1,6}\.\d{1,6}\.\d{1,6}$/
function checkState(state){
 if(!state||Array.isArray(state)||Object.keys(state).sort().join(',')!=='current,previous'||!versionPattern.test(state.current)||!(state.previous===null||typeof state.previous==='string'&&versionPattern.test(state.previous)))throw Error('Invalid Booking selection')
 return state
}
export async function readBookingSelection(store){
 const path=join(store,'selection.json');let info
 try{info=await lstat(path)}catch(e){if(e.code==='ENOENT')return null;throw e}
 if(!info.isFile()||info.isSymbolicLink()||info.size>1024||(process.platform!=='win32'&&((info.mode&0o022)!==0||(process.getuid&&info.uid!==0&&info.uid!==process.getuid()))))throw Error('Unsafe Booking selection file')
 return checkState(JSON.parse(await readFile(path,'utf8')))
}
// Changes only the server package selection; no code is loaded, no service is restarted and no database is modified.
export async function selectBookingVersion({store,keyPath,coreVersion,version,rollback=false}){
 const root=await lstat(store)
 if(!root.isDirectory()||root.isSymbolicLink()||(process.platform!=='win32'&&((root.mode&0o022)!==0||(process.getuid&&root.uid!==process.getuid()))))throw Error('Unsafe selection directory')
 const lock=join(store,'.booking-stage.lock');try{await mkdir(lock,{mode:0o700})}catch(e){if(e.code==='EEXIST')throw Error('Another operation is active or its lock needs inspection');throw e}
 let temp
 try{
  const old=await readBookingSelection(store),target=rollback?old?.previous:version
  if(typeof target!=='string'||!versionPattern.test(target))throw Error(rollback?'No previous Booking version':'Invalid Booking version')
  if(!rollback&&target===old?.current)throw Error('Booking version already selected')
  const candidate=await verifyBookingRuntime({store,version:target,keyPath,coreVersion})
  if(old){const existing=await verifyBookingRuntime({store,version:old.current,keyPath,coreVersion});if(existing.manifest.schema_version!==candidate.manifest.schema_version)throw Error('Schema versions differ: automatic rollback is not supported')}
  const next={current:target,previous:old?.current||null}
  temp=await mkdtemp(join(store,'.booking-selection-'))
  const staged=join(temp,'selection.json');await writeFile(staged,JSON.stringify(next)+'\n',{flag:'wx',mode:0o600})
  await rename(staged,join(store,'selection.json'))
  return {...next,restart_required:true,automatic_rollback:false}
 }finally{if(temp)await rm(temp,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
}
