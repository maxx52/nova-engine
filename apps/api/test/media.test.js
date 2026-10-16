import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {mkdtemp,writeFile,access,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {registerMedia,syncMedia} from '../src/media.js'
const filename='00000000-0000-0000-0000-000000000001.png',url='/uploads/'+filename

test('media scanner indexes existing regular image files and skips other files and symlinks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-media-'));const inserted=[]
 try{
  await writeFile(join(dir,filename),'test');await writeFile(join(dir,'ignore.txt'),'ignore');await symlink(join(dir,filename),join(dir,'00000000-0000-0000-0000-000000000002.png'))
  await syncMedia({query:async(sql,args)=>{if(sql.startsWith('INSERT'))inserted.push(args);return {rows:[]}}},dir)
  assert.equal(inserted.length,1);assert.equal(inserted[0][0],url);assert.equal(inserted[0][2],4)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test('media API requires auth, blocks used files, and deletes unused files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nova-media-'));await writeFile(join(dir,filename),'test')
 const app=Fastify();let used=true,deleted=false;const sqls=[]
 const db={query:async(sql,args)=>{sqls.push(sql);if(sql.startsWith('SELECT url FROM media_files'))return {rowCount:deleted?0:1,rows:deleted?[]:[{url}]};if(sql.includes("SELECT 'product'"))return {rows:used?[{type:'page',id:'1',title:'Draft'}]:[]};if(sql.startsWith('UPDATE'))deleted=true;return {rows:[]}},release(){}}
 registerMedia(app,{...db,connect:async()=>db},(req,reply,done)=>{if(req.headers['x-test-admin']!=='yes')return reply.code(401).send({error:'Unauthorized'});done()},dir)
 const remove=path=>app.inject({method:'DELETE',url:path,headers:{'x-test-admin':'yes'}})
 try{
  assert.equal((await app.inject({method:'DELETE',url:'/api/admin/media/'+filename})).statusCode,401)
  assert.equal((await app.inject('/api/admin/media')).statusCode,401)
  const blocked=await remove('/api/admin/media/'+filename);assert.equal(blocked.statusCode,409);assert.equal(blocked.json().usage[0].title,'Draft');assert.equal(deleted,false);await access(join(dir,filename))
  assert.equal((await remove('/api/admin/media/not-a-file')).statusCode,400)
  used=false;assert.equal((await remove('/api/admin/media/'+filename)).statusCode,204);assert.equal(deleted,true);await assert.rejects(access(join(dir,filename)))
  assert.equal((await remove('/api/admin/media/'+filename)).statusCode,404)
  assert.ok(sqls.some(sql=>sql.includes('FOR UPDATE')))
 }finally{await app.close();await rm(dir,{recursive:true,force:true})}
})
