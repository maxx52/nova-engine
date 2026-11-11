import {createHash,createPublicKey,verify} from 'node:crypto'
import {readFile,lstat,readdir} from 'node:fs/promises'
import {join} from 'node:path'
const files=['server/index.js','admin/BookingWorkspace.vue']
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
export const bookingPackageFiles=Object.freeze(files)
export function validateManifest(m){
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='files,format,module_api,nova_max,nova_min,version')throw Error('Invalid manifest')
 if(m.format!=='nova-booking-package-v1'||m.module_api!==1||!/^\d+\.\d+\.\d+$/.test(m.version)||m.nova_min!=='0.28.0'||m.nova_max!=='0.28.0')throw Error('Unsupported package compatibility')
 if(!m.files||typeof m.files!=='object'||Array.isArray(m.files)||Object.keys(m.files).sort().join(',')!==[...files].sort().join(','))throw Error('Invalid package files')
 for(const name of files){const entry=m.files[name];if(!entry||Object.keys(entry).sort().join(',')!=='sha256,size'||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>1024*1024||!/^([a-f0-9]{64})$/.test(entry.sha256))throw Error('Invalid package file metadata')}
 return m
}
export async function verifyBookingPackage(dir,{trustedPublicKey}={}){
 const root=await lstat(dir);if(!root.isDirectory()||root.isSymbolicLink())throw Error('Invalid package directory')
 const entries=(await readdir(dir)).sort().join(',');if(!['admin,manifest.json,server','admin,manifest.json,manifest.sig,server'].includes(entries))throw Error('Unexpected package entries')
 const manifestFile=join(dir,'manifest.json'),stat=await lstat(manifestFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('Invalid manifest file')
 const manifestBytes=await readFile(manifestFile)
 const manifest=validateManifest(JSON.parse(manifestBytes.toString('utf8')))
 if(trustedPublicKey!==undefined){
  const key=createPublicKey(trustedPublicKey)
  if(key.asymmetricKeyType!=='ed25519')throw Error('Trusted key must be Ed25519')
  const path=join(dir,'manifest.sig'),signatureStat=await lstat(path)
  if(!signatureStat.isFile()||signatureStat.isSymbolicLink()||signatureStat.size!==88)throw Error('Missing or invalid signature')
  const text=await readFile(path,'utf8'),signature=Buffer.from(text,'base64')
  if(signature.length!==64||signature.toString('base64')!==text)throw Error('Invalid signature encoding')
  if(!verify(null,manifestBytes,key,signature))throw Error('Package signature verification failed')
 }
 for(const [folder,expected] of [['server','index.js'],['admin','BookingWorkspace.vue']]){const s=await lstat(join(dir,folder));if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid package directory');if((await readdir(join(dir,folder))).join(',')!==expected)throw Error('Unexpected package entries')}
 for(const name of files){const path=join(dir,name),s=await lstat(path),expected=manifest.files[name];if(!s.isFile()||s.isSymbolicLink()||s.size!==expected.size)throw Error('Package file size mismatch: '+name);const bytes=await readFile(path);if(bytes.length!==expected.size||digest(bytes)!==expected.sha256)throw Error('Package file checksum mismatch: '+name)}
 return manifest
}
export function fileMetadata(bytes){return {size:bytes.length,sha256:digest(bytes)}}

// The caller must provide a separately provisioned trusted key.
export async function verifyTrustedBookingPackage(dir,trustedPublicKey){
 if(!trustedPublicKey)throw Error('Trusted key is required')
 return verifyBookingPackage(dir,{trustedPublicKey})
}
