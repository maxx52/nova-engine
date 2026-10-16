import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeImage,registerUploads} from '../src/uploads.js'
test('upload normalization rejects fake/corrupt/huge images and strips appended payloads',async()=>{
 for(const value of [Buffer.from('<svg onload="alert(1)"></svg>'),Buffer.from('%PDF-1.7'),Buffer.from('PK\x03\x04archive'),Buffer.from([137,80,78,71,13,10,26,10])])await assert.rejects(normalizeImage(value),e=>e.statusCode===415)
 await assert.rejects(normalizeImage(Buffer.alloc(6*1024*1024)),e=>e.statusCode===413)
 const png=await sharp({create:{width:4,height:3,channels:3,background:'#ed7733'}}).png().toBuffer()
 const bytes=await normalizeImage(Buffer.concat([png,Buffer.from('<script>secret-payload</script>')]))
 assert.equal((await sharp(bytes).metadata()).format,'webp');assert.equal((await sharp(bytes).metadata()).width,4);assert.ok(!bytes.includes(Buffer.from('secret-payload')))
 const huge=await sharp({create:{width:5000,height:5000,channels:3,background:'#112233'}}).png().toBuffer()
 await assert.rejects(normalizeImage(huge),e=>e.statusCode===415)
})
test('upload endpoint requires authentication, ignores spoofed MIME and records only re-encoded data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-upload-')),app=Fastify();const inserted=[]
 await app.register(multipart,{limits:{fileSize:5*1024*1024,files:1,fields:0,parts:1}})
 registerUploads(app,{query:async(sql,args)=>{inserted.push(args)}},async(req,reply)=>{if(req.headers['x-test']!=='yes')return reply.code(401).send({error:'Unauthorized'})},dir)
 const png=await sharp({create:{width:3,height:2,channels:3,background:'#ffffff'}}).png().toBuffer()
 const boundary='nova-test-boundary',payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.html"\r\nContent-Type: text/html\r\n\r\n`),png,Buffer.from(`\r\n--${boundary}--\r\n`)])
 try{
  assert.equal((await app.inject({method:'POST',url:'/api/uploads',headers:{'content-type':'multipart/form-data; boundary='+boundary},payload})).statusCode,401)
  const r=await app.inject({method:'POST',url:'/api/uploads',headers:{'x-test':'yes','content-type':'multipart/form-data; boundary='+boundary},payload});assert.equal(r.statusCode,201,r.body);assert.match(r.json().url,/^\/uploads\/[a-f0-9-]{36}\.webp$/)
  const before=inserted.length
  const extra=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="one.png"\r\nContent-Type: image/png\r\n\r\n`),png,Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="two.png"\r\nContent-Type: image/png\r\n\r\n`),png,Buffer.from(`\r\n--${boundary}--\r\n`)])
  const rejected=await app.inject({method:'POST',url:'/api/uploads',headers:{'x-test':'yes','content-type':'multipart/form-data; boundary='+boundary},payload:extra});assert.equal(rejected.statusCode,400,rejected.body);assert.equal(inserted.length,before)
  const files=await readdir(dir);assert.equal(files.length,1);const stored=await readFile(join(dir,files[0]));assert.equal((await sharp(stored).metadata()).format,'webp');assert.equal(inserted[0][3],'image/webp');assert.equal(inserted[0][2],stored.length)
 }finally{await app.close();await rm(dir,{recursive:true,force:true})}
})
