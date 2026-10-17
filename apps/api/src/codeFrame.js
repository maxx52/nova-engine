import {randomBytes} from 'node:crypto'
export function codeFramePolicy(nonce){return "default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts"}
export function codeFrameDocument(nonce){
 const runtime = `const expectedOrigin=new URL(location.href).origin;let rendered=false,key='',nextRequest=0;const requests=new Map();
 const report=()=>parent.postMessage({type:'nova:height',key,height:Math.ceil(document.documentElement.scrollHeight)},expectedOrigin);
 addEventListener('error',event=>parent.postMessage({type:'nova:error',key,message:String(event.message).slice(0,500)},expectedOrigin));
 addEventListener('unhandledrejection',event=>parent.postMessage({type:'nova:error',key,message:String(event.reason?.message||event.reason).slice(0,500)},expectedOrigin));
 addEventListener('message',event=>{
  const value=event.data;
  if(event.source!==parent||event.origin!==expectedOrigin||!value)return;
  if(['nova:data-result','nova:action-result'].includes(value.type)&&value.key===key&&requests.has(value.id)){const pending=requests.get(value.id);requests.delete(value.id);clearTimeout(pending.timer);value.error?pending.reject(Error(value.error)):pending.resolve(value.data);return;}
  if(rendered&&value.type==='nova:context'&&value.key===key){for(const [name,data]of Object.entries(value.data||{}))if(!['request','call','cart','forms','escape','money','apiVersion'].includes(name))NOVA[name]=data;dispatchEvent(new CustomEvent('nova:context',{detail:NOVA}));return;}
  if(rendered||value.type!=='nova:render'||typeof value.key!=='string')return;
  if(['html','css','js'].some(k=>typeof value[k]!=='string'||value[k].length>100000))return;
  rendered=true;key=value.key;window.NOVA=value.data||{};
  NOVA.request=path=>new Promise((resolve,reject)=>{const id=++nextRequest;if(id>100){reject(Error('Лимит запросов блока исчерпан'));return;}const timer=setTimeout(()=>{requests.delete(id);reject(Error('Истекло время ожидания данных'))},10000);requests.set(id,{resolve,reject,timer});parent.postMessage({type:'nova:data',key,id,path},expectedOrigin)});
  NOVA.apiVersion=1;
  NOVA.escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  NOVA.money=cents=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(Number(cents)/100);
  NOVA.call=(action,payload={})=>new Promise((resolve,reject)=>{if(!navigator.userActivation?.isActive){reject(Error('Действие доступно только после нажатия пользователя'));return}const id=++nextRequest;if(id>100){reject(Error('Лимит действий исчерпан'));return}const timer=setTimeout(()=>{requests.delete(id);reject(Error('Истекло время ожидания действия'))},10000);requests.set(id,{resolve,reject,timer});parent.postMessage({type:'nova:action',key,id,action,payload},expectedOrigin)});
  NOVA.cart={add:(product_id,variant_name='',quantity=1)=>NOVA.call('cart.add',{product_id,variant_name,quantity}),open:()=>NOVA.call('cart.open')};
  NOVA.forms={open:form_id=>NOVA.call('forms.open',{form_id})};
  for(const [name,color]of Object.entries(NOVA.design?.colors||{}))if(/^[a-z]+$/.test(name)&&/^#[a-f0-9]{6}$/i.test(color))document.documentElement.style.setProperty('--nova-'+name,color);
  if(['Manrope','Arial','Georgia','Verdana'].includes(NOVA.design?.font))document.documentElement.style.fontFamily=NOVA.design.font+', Arial, sans-serif';
  for(const name of ['width','radius'])if(Number.isInteger(NOVA.design?.[name]))document.documentElement.style.setProperty('--nova-'+name,NOVA.design[name]+'px');
  document.getElementById('root').innerHTML=value.html;
  const style=document.createElement('style');style.textContent=value.css;document.head.append(style);
  document.addEventListener('click',event=>{const a=event.target.closest?.('a[href]');if(!a||!event.isTrusted)return;const raw=a.getAttribute('href');if(raw.startsWith('#'))return;event.preventDefault();try{const url=new URL(raw,location.href);if(url.origin===expectedOrigin)parent.postMessage({type:'nova:navigate',key,href:url.pathname+url.search+url.hash},expectedOrigin)}catch{}});
  new ResizeObserver(report).observe(document.getElementById('root'));
  const script=document.createElement('script');script.nonce=${JSON.stringify(nonce)};script.textContent=value.js;document.body.append(script);report();
 });`;
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}#root{display:flow-root;overflow-wrap:anywhere}img{max-width:100%}</style></head><body><div id="root"></div><script nonce="'+nonce+'">'+runtime+'</script></body></html>'
}
export function registerCodeFrame(app){
 app.get('/api/code-frame',{config:{novaCodeFrame:true}},async(req,reply)=>{
  const nonce=randomBytes(24).toString('base64')
  return reply.header('Content-Security-Policy',codeFramePolicy(nonce)).header('X-Frame-Options','SAMEORIGIN').header('Cache-Control','no-store').type('text/html; charset=utf-8').send(codeFrameDocument(nonce))
 })
}
