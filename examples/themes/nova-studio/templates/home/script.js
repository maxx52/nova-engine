// Use textContent for CMS data. Do not interpolate visitor content as HTML.
function render(){
 const settings=NOVA.theme.settings;
 document.getElementById('eyebrow').textContent=settings.eyebrow;
 document.getElementById('headline').textContent=settings.headline;
 document.getElementById('intro').textContent=NOVA.context.page?.content||NOVA.design.texts.hero_description;
 document.getElementById('catalog-link').hidden=!NOVA.settings.shop_enabled;
 document.getElementById('selection').hidden=!NOVA.settings.shop_enabled;
 document.getElementById('contact').hidden=!settings['contact-form'];
 const root=document.getElementById('products');root.replaceChildren();
 for(const p of NOVA.products.slice(0,3)){
  const card=document.createElement('article');card.className='card';
  const a=document.createElement('a');a.href='/product/'+p.id;
  const title=document.createElement('h3');title.textContent=p.name;
  if(p.image_url){const img=document.createElement('img');img.className='photo';img.src=p.image_url;img.alt=p.name;img.loading='lazy';a.append(img)}
  a.append(title);card.append(a);
  if(settings['show-prices']){const price=document.createElement('strong');price.textContent=NOVA.money(Math.round(p.price*100));card.append(price)}
  root.append(card);
 }
}
document.getElementById('contact').addEventListener('click',()=>NOVA.forms.open(NOVA.theme.settings['contact-form']).catch(e=>document.getElementById('status').textContent=e.message));
render();addEventListener('nova:context',render);
