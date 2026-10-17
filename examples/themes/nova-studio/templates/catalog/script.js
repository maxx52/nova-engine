function render(){
 const query=document.getElementById('search').value.trim().toLowerCase(),root=document.getElementById('products');root.replaceChildren();
 for(const p of NOVA.products.filter(p=>p.name.toLowerCase().includes(query))){
  const card=document.createElement('article');card.className='card';
  const a=document.createElement('a');a.href='/product/'+p.id;
  if(p.image_url){const img=document.createElement('img');img.className='photo';img.src=p.image_url;img.alt=p.name;img.loading='lazy';a.append(img)}
  const h=document.createElement('h3');h.textContent=p.name;a.append(h);card.append(a);
  const price=document.createElement('strong');price.textContent=NOVA.money(Math.round(p.price*100));card.append(price);
  const actions=document.createElement('div');actions.className='actions';
  const button=document.createElement('button');button.textContent=p.variants.length?'Выбрать вариант':'В корзину';button.disabled=!p.variants.length&&p.stock===0;
  if(p.variants.length){const link=document.createElement('a');link.href='/product/'+p.id;link.className='button';link.textContent='Выбрать вариант';actions.append(link)}
  else{button.addEventListener('click',async()=>{try{await NOVA.cart.add(p.id);document.getElementById('status').textContent='Товар добавлен'}catch(e){document.getElementById('status').textContent=e.message}});actions.append(button)}
  card.append(actions);root.append(card);
 }
 if(!root.children.length)root.textContent=NOVA.design.texts.no_products;
}
document.getElementById('search').addEventListener('input',render);
document.getElementById('cart').addEventListener('click',()=>NOVA.cart.open().catch(e=>document.getElementById('status').textContent=e.message));
render();addEventListener('nova:context',render);
