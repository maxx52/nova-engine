import {readFile,mkdir,stat} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {releaseVersion} from '../shared/releases.js'
import {writeFile} from 'node:fs/promises'
const release=JSON.parse(await readFile(new URL('../config/release.json',import.meta.url),'utf8'))
if(!releaseVersion(release.version))throw Error('Invalid release version')
const output=resolve(process.argv[2]||'/tmp/nova-release')
await mkdir(output,{recursive:true})
for(const file of ['apps/admin/dist/index.html','apps/storefront/dist/index.html'])await stat(file)
const name='nova-'+release.version+'.tar.gz',archive=resolve(output,name)
const result=spawnSync('tar',['-czf',archive,'--exclude=node_modules','--exclude=.git','--exclude=.env','--exclude=.env.*','--exclude=uploads','--exclude=setup-key','--exclude=__pycache__','--exclude=*.pyc','package.json','package-lock.json','apps','config','shared','examples','deploy','scripts','docs','README.md','SECURITY.md'],{stdio:'inherit'})
if(result.status!==0)throw Error('Release archive failed')
const hash=createHash('sha256');for await(const chunk of createReadStream(archive))hash.update(chunk)
const manifest={format:'nova-release',...release,artifact:{name,size:(await stat(archive)).size,sha256:hash.digest('hex')}}
await writeFile(resolve(output,'nova-release.json'),JSON.stringify(manifest,null,2)+'\n')
process.stdout.write(JSON.stringify({version:release.version,artifact:name})+'\n')
