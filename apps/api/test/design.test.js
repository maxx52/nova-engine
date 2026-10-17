import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import {designValue,validateDesign} from '../../../shared/siteDesign.js'
import {registerDesign} from '../src/design.js'
import {registerCodeFrame} from '../src/codeFrame.js'
import {registerSecurity} from '../src/security.js'

test('design validates the complete editable schema and rejects CSS injection, unsafe media and oversized code',()=>{
 const value=designValue();assert.equal(validateDesign(value),null)
 for(const mutate of [v=>v.colors.primary='red; background:url(https://bad.invalid)',v=>v.hero_image_url='https://bad.invalid/image.png',v=>v.home_order=['hero','hero','catalog'],v=>v.radius=NaN,v=>v.font='url(https://bad.invalid)',v=>v.code.js='x'.repeat(100001),v=>v.texts.hero_title={},v=>v.visibility.header='false',v=>v.code.placement='admin',v=>v.code.server='process.env']){
  const bad=designValue();mutate(bad);assert.ok(validateDesign(bad))
 }
 const clean=designValue(JSON.parse('{"texts":{"__proto__":{"polluted":true},"hero_title":"<script>alert(1)</script>"}}'))
 assert.equal({}.polluted,undefined);assert.equal(clean.texts.hero_title,'<script>alert(1)</script>')
 clean.colors.primary='#abcdef';assert.notEqual(designValue().colors.primary,clean.colors.primary)
})
test('drafts, history and publication require authorization before database access',async()=>{
 const app=Fastify();registerDesign(app,{query(){throw Error('unauthorized database read')}},async(req,reply)=>reply.code(401).send({error:'Войдите'}))
 for(const [method,url]of [['GET','/api/admin/design'],['GET','/api/admin/design/versions'],['GET','/api/admin/design/versions/1'],['PUT','/api/admin/design'],['POST','/api/admin/design/publish']])assert.equal((await app.inject({method,url})).statusCode,401)
 await app.close()
})
test('code execution is confined to a nonce-authorized opaque iframe without networking or top navigation',async()=>{
 const app=Fastify();registerSecurity(app);registerCodeFrame(app)
 const first=await app.inject('/api/code-frame'),second=await app.inject('/api/code-frame')
 assert.equal(first.statusCode,200);assert.equal(first.headers['x-frame-options'],'SAMEORIGIN');assert.equal(first.headers['cache-control'],'no-store')
 const policy=first.headers['content-security-policy'];assert.match(policy,/sandbox allow-scripts/);assert.doesNotMatch(policy,/allow-same-origin|allow-top-navigation|unsafe-eval|unsafe-inline.*script-src/);assert.match(policy,/connect-src 'none'/);assert.match(policy,/form-action 'none'/);assert.match(policy,/frame-ancestors 'self'/)
 assert.notEqual(policy,second.headers['content-security-policy'])
 const nonce=policy.match(/'nonce-([^']+)'/)[1];assert.ok(first.body.includes('nonce="'+nonce+'"'));assert.match(first.body,/event.source!==parent/);assert.match(first.body,/event.origin!==expectedOrigin/)
 await app.close()
})
