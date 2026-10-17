import {randomBytes} from 'node:crypto'
export function codeFramePolicy(nonce){return "default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts"}
export function codeFrameDocument(nonce){
 const runtime = `const expectedOrigin=new URL(location.href).origin;let rendered=false,key='';
 const report=()=>parent.postMessage({type:'nova:height',key,height:Math.ceil(document.documentElement.scrollHeight)},expectedOrigin);
 addEventListener('error',event=>parent.postMessage({type:'nova:error',key,message:String(event.message).slice(0,500)},expectedOrigin));
 addEventListener('unhandledrejection',event=>parent.postMessage({type:'nova:error',key,message:String(event.reason?.message||event.reason).slice(0,500)},expectedOrigin));
 addEventListener('message',event=>{
  const value=event.data;
  if(rendered||event.source!==parent||event.origin!==expectedOrigin||!value||value.type!=='nova:render'||typeof value.key!=='string')return;
  if(['html','css','js'].some(k=>typeof value[k]!=='string'||value[k].length>100000))return;
  rendered=true;key=value.key;window.NOVA=value.data||{};
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
