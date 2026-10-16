import sharp from 'sharp'
import {constants} from 'node:fs'
import {mediaName} from './media.js'
import {randomUUID} from 'node:crypto'
import {writeFile,unlink,open,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {workLimiter} from './security.js'
const imageWork=workLimiter(2)
sharp.cache({memory:16,files:0,items:20});sharp.concurrency(1)
function imageKind(data){
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png'
 if(data.length>=3&&data[0]===255&&data[1]===216&&data[2]===255)return 'jpeg'
 if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return 'webp'
 return null
}
export async function normalizeImage(data){
 if(!Buffer.isBuffer(data)||data.length>5*1024*1024)throw Object.assign(Error('Максимальный размер фото — 5 МБ'),{statusCode:413})
 const format=imageKind(data)
 if(!format)throw Object.assign(Error('Разрешены только настоящие JPG, PNG и WebP'),{statusCode:415})
 return imageWork(async()=>{
  try{
   const image=sharp(data,{limitInputPixels:20_000_000,failOn:'warning',animated:false})
   const metadata=await image.metadata()
   if(metadata.format!==format||!metadata.width||!metadata.height||metadata.width>10000||metadata.height>10000||(metadata.pages||1)>1)throw Error('Unsupported dimensions or animation')
   // Decode and re-encode; do not retain EXIF, comments or appended payloads.
   const bytes=await image.rotate().resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true}).webp({quality:90,effort:3}).timeout({seconds:5}).toBuffer()
   if(bytes.length>5*1024*1024)throw Error('Output too large')
   return bytes
  }catch(e){throw Object.assign(Error('Повреждённое изображение, анимация или превышен лимит: 20 Мп и 10 000 px по стороне.'),{statusCode:415})}
 })
}
export function registerUploads(app,pool,requireAdmin,directory){
 app.get('/uploads/:filename',async(req,reply)=>{
  const {filename}=req.params
  if(!mediaName.test(filename))return reply.code(404).send({error:'Файл не найден'})
  const deleted=await pool.query('SELECT url FROM media_files WHERE url=$1 AND deleted_at IS NOT NULL',['/uploads/'+filename])
  if(deleted.rowCount)return reply.code(404).send({error:'Файл не найден'})
  let handle
  try{
   const path=join(directory,filename)
   if(!(await lstat(path)).isFile())return reply.code(404).send({error:'Файл не найден'})
   handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0))
   const info=await handle.stat()
   if(!info.isFile()||info.size>5*1024*1024){await handle.close();return reply.code(404).send({error:'Файл не найден'})}
   reply.type(filename.endsWith('.png')?'image/png':filename.endsWith('.webp')?'image/webp':'image/jpeg').header('Cache-Control','public, max-age=86400').header('X-Content-Type-Options','nosniff')
   return reply.send(handle.createReadStream())
  }catch(e){if(handle)await handle.close().catch(()=>{});if(['ENOENT','ELOOP'].includes(e.code))return reply.code(404).send({error:'Файл не найден'});throw e}
 })
 app.post('/api/uploads',{bodyLimit:6*1024*1024,preHandler:requireAdmin},async(req,reply)=>{
  let input,fileName
  try{
   for await(const part of req.parts()){
    if(part.type!=='file'||input)return reply.code(400).send({error:'Отправьте одно изображение'})
    fileName=part.filename;input=await part.toBuffer()
   }
  }catch(e){
   if(e.code==='FST_REQ_FILE_TOO_LARGE')return reply.code(413).send({error:'Максимальный размер фото — 5 МБ'})
   if(['FST_FILES_LIMIT','FST_FIELDS_LIMIT','FST_PARTS_LIMIT'].includes(e.code))return reply.code(400).send({error:'Отправьте одно изображение'})
   throw e
  }
  if(!input)return reply.code(400).send({error:'Файл не передан'})
  const bytes=await normalizeImage(input),name=randomUUID()+'.webp',url='/uploads/'+name
  await writeFile(join(directory,name),bytes,{flag:'wx',mode:0o600})
  try{await pool.query('INSERT INTO media_files (url,original_name,size,mime) VALUES ($1,$2,$3,$4)',[url,(fileName||name).split(/[\\/]/).pop().replace(/[\x00-\x1f]/g,'').slice(0,200)||name,bytes.length,'image/webp'])}
  catch(e){await unlink(join(directory,name)).catch(()=>{});throw e}
  return reply.code(201).send({url})
 })
}
