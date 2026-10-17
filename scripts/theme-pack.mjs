import {readFile,writeFile,lstat,realpath} from 'node:fs/promises'
import {resolve,join,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import {validatePackage,templateSlots} from '../shared/themes.js'
export async function packDirectory(directory){
 const root=await realpath(directory)
 async function read(path,optional=false){
  const full=join(root,path)
  try{const stat=await lstat(full);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>600*1024)throw Error('Недопустимый файл: '+path);const actual=await realpath(full),rel=relative(root,actual);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Выход за каталог: '+path);return await readFile(full,'utf8')}catch(e){if(optional&&e.code==='ENOENT')return '';throw e}
 }
 const manifest=JSON.parse(await read('manifest.json'));let pack
 if(manifest.format==='nova-theme'){
  const templates={},baseCss=await read('base.css',true)
  // Paths are generated from this fixed set; the manifest cannot supply filenames or executable hooks.
  for(const slot of Object.keys(templateSlots)){const html=await read('templates/'+slot+'/index.html',true),css=await read('templates/'+slot+'/style.css',true),js=await read('templates/'+slot+'/script.js',true);if(html||css||js)templates[slot]={html,css:baseCss+'\n'+css,js}}
  const style=JSON.parse(await read('design.json'));style.site_css=await read('site.css',true)
  pack={...manifest,style,templates}
 }else pack={...manifest,page:JSON.parse(await read('page.json'))}
 const error=validatePackage(pack);if(error)throw Error(error);return pack
}
export async function cli(args){
 const [command,input,output]=args
 if(command==='check'&&input){const p=JSON.parse(await readFile(resolve(input),'utf8')),error=validatePackage(p);if(error)throw Error(error);console.log('OK '+p.format+': '+p.manifest.id+' '+p.manifest.version);return}
 if(command==='pack'&&input){const p=await packDirectory(resolve(input));if(!output)throw Error('Укажите выходной JSON-файл');const full=resolve(output);await writeFile(full,JSON.stringify(p,null,2)+'\n');console.log('Создан '+full);return}
 throw Error('Использование: npm run theme:pack -- каталог файл.nova.json | npm run theme:check -- файл.nova.json')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))cli(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1})
