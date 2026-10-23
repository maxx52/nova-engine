import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {PGlite} from '@electric-sql/pglite'
import {pool,initDatabase} from '../../src/db.js'
import {registerAuth} from '../../src/auth.js'
import {registerSecurity,publicErrorHandler} from '../../src/security.js'
import {registerPages} from '../../src/pages.js'
import {registerBlog} from '../../src/blog.js'
import {registerDataTransfer} from '../../src/dataTransfer.js'
import {registerSeo} from '../../src/seo.js'
import {registerSettings} from '../../src/settings.js'
export async function contentFixture() {
 const pg=new PGlite()
 const query=async(sql,args)=>{const r=await pg.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0}}
 let tail=Promise.resolve()
 const db={query,connect:async()=>{const previous=tail;let release;tail=new Promise(r=>release=r);await previous;return {query,release}}}
 pool.query=query;pool.connect=db.connect;await initDatabase();await initDatabase()
 const app=Fastify({bodyLimit:2000000});registerSecurity(app,{perIp:5000})
 const key='lifecycle-test-setup-secret-32-chars'
 const {requireAdmin}=registerAuth(app,db,{setupKey:key})
 registerPages(app,db,requireAdmin);registerBlog(app,db,requireAdmin);registerDataTransfer(app,db,requireAdmin);registerSettings(app,db,requireAdmin)
 registerSeo(app,db,requireAdmin,{fallbackOrigin:'https://example.test',template:async()=>'<html><head></head><body><div id="app"></div></body></html>'});app.setErrorHandler(publicErrorHandler)
 const mutation={'x-nova-request':'1',origin:'http://localhost:5174'}
 const setup=await app.inject({method:'POST',url:'/api/auth/setup',headers:mutation,payload:{username:'content_owner',password:'test-only-content-password',setup_key:key}})
 assert.equal(setup.statusCode,201,setup.body)
 const auth={...mutation,cookie:setup.headers['set-cookie'].split(';')[0],'x-csrf-token':setup.json().csrf_token}
 const call=(method,url,payload,headers=auth)=>app.inject({method,url,payload,headers})
 return {app,db,query,auth,call,close:async()=>{await app.close();await pg.close()}}
}
