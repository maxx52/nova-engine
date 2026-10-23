// One metadata owner for initial loads, SPA transitions and browser history.
let generation=0
export async function updateSeo(){
 const current=++generation,path=location.pathname+location.search
 try{
  const r=await fetch('/api/seo/metadata?'+new URLSearchParams({path}),{credentials:'omit'});if(!r.ok)throw Error('SEO temporarily unavailable')
  const data=await r.json();if(current!==generation||path!==location.pathname+location.search)return
  if(data.redirect){location.replace(data.redirect);return}
  const m=data.metadata;if(!m)return
  document.title=m.title
  const nonce=document.querySelector('script[type="application/ld+json"][data-nova-seo]')?.nonce||''
  document.querySelectorAll('meta[name="description"],meta[name="robots"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"],script[type="application/ld+json"][data-nova-seo]').forEach(n=>n.remove())
  function meta(key,value,property=false){const n=document.createElement('meta');n.setAttribute(property?'property':'name',key);n.content=value||'';n.dataset.novaSeo='';document.head.append(n)}
  meta('description',m.description);meta('robots',m.robots)
  if(m.canonical){const n=document.createElement('link');n.rel='canonical';n.href=m.canonical;n.dataset.novaSeo='';document.head.append(n)}
  for(const [k,v] of Object.entries({title:m.title,description:m.description,type:m.type||'website',site_name:m.site_name,url:m.canonical,image:m.image}))if(v)meta('og:'+k,v,true)
  meta('twitter:card',m.image?'summary_large_image':'summary')
  if(m.graph){const n=document.createElement('script');n.type='application/ld+json';n.dataset.novaSeo='';if(nonce)n.nonce=nonce;n.textContent=JSON.stringify(m.graph).replaceAll('<','\\u003c');document.head.append(n)}
 }catch{if(current===generation){document.querySelectorAll('link[rel="canonical"],script[type="application/ld+json"][data-nova-seo]').forEach(n=>n.remove());const old=document.querySelector('meta[name="robots"]')||document.head.appendChild(document.createElement('meta'));old.name='robots';old.content='noindex, follow'}}
}
export function startSeo(){
 for(const name of ['pushState','replaceState']){const original=history[name].bind(history);history[name]=(...args)=>{const before=location.pathname+location.search;const result=original(...args);if(before!==location.pathname+location.search)updateSeo();return result}}
 window.addEventListener('popstate',updateSeo);updateSeo()
}
