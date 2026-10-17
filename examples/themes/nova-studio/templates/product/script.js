let productId;
function render(){
 const p=NOVA.context.product;if(!p)return;
 if(productId!==p.id){productId=p.id;
  for(const [id,value]of Object.entries({name:p.name,description:p.description,category:p.category}))document.getElementById(id).textContent=value;
  const photo=document.getElementById('photo');photo.replaceChildren();if(p.image_url){const img=document.createElement('img');img.src=p.image_url;img.alt=p.name;img.className='photo';photo.append(img)}
  const picker=document.getElementById('variant');picker.replaceChildren();for(const v of p.variants){const option=document.createElement('option');option.value=v.name;option.textContent=v.name;option.disabled=v.stock<=0;picker.append(option)}
  document.getElementById('variant-label').hidden=!p.variants.length;
 }
 const v=p.variants.find(v=>v.name===document.getElementById('variant').value),source=v||p;
 document.getElementById('price').textContent=NOVA.money(Math.round(source.price*100));document.getElementById('stock').textContent='В наличии: '+source.stock;document.getElementById('add').disabled=source.stock<=0;
}
document.getElementById('variant').addEventListener('change',render);
document.getElementById('add').addEventListener('click',async()=>{try{const p=NOVA.context.product;await NOVA.cart.add(p.id,p.variants.length?document.getElementById('variant').value:'');document.getElementById('status').textContent='Товар добавлен'}catch(e){document.getElementById('status').textContent=e.message}});
document.getElementById('cart').addEventListener('click',()=>NOVA.cart.open().catch(e=>document.getElementById('status').textContent=e.message));
render();addEventListener('nova:context',render);
