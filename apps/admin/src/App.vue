<script setup>
import { ref, computed, onMounted } from 'vue'
const page=ref('overview')
const products=ref([])
const loading=ref(true)
const error=ref('')
const filter=ref('')
const dialog=ref(false)
const editingId=ref(null)
const form=ref({name:'',category:'Электроника',price:0,description:'',sku:'',stock:0,image_url:'',published:true,images:[],attributes:[],variants:[]})
const editorTab=ref('main')
const categoryRows=ref([])
const uploading=ref(false)
const categoryName=ref('')
const parentCategory=ref('')
const categoryEditing=ref(null)
const templateText=ref('')
const categoryTree=computed(()=>{const depth=(c,seen=new Set())=>{if(!c.parent_id||seen.has(c.id))return 0;const parent=categoryRows.value.find(x=>x.id===c.parent_id);return parent?1+depth(parent,new Set([...seen,c.id])):0};return [...categoryRows.value].map(c=>({...c,depth:depth(c)})).sort((a,b)=>a.name.localeCompare(b.name,'ru'))})
const categoryError=ref('')
const sidebar=ref(false)
const adminKey=ref(sessionStorage.getItem('nova_admin_key') || '')
const busy=ref(false)
const saveError=ref('')
function updateKey(){const key=window.prompt('Введи ADMIN_API_KEY из файла .env:',adminKey.value);if(key!==null){adminKey.value=key.trim();sessionStorage.setItem('nova_admin_key',adminKey.value)}}
async function apiWrite(url,method,body){const response=await fetch(url,{method,headers:{'x-admin-key':adminKey.value,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'Ошибка запроса: '+response.status)}return response.status===204?null:response.json()}
async function reload(){const r=await fetch('/api/products');if(!r.ok)throw Error('Ошибка загрузки каталога');products.value=await r.json()}
const categories=computed(()=>categoryRows.value.map(c=>c.name))
const sections=[{id:'overview',icon:'◫',label:'Обзор'},{id:'products',icon:'▦',label:'Товары'},{id:'categories',icon:'▤',label:'Категории'},{id:'orders',icon:'▤',label:'Заказы'},{id:'customers',icon:'♙',label:'Покупатели'},{id:'settings',icon:'⚙',label:'Настройки'}]
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n)
const total=computed(()=>products.value.reduce((a,p)=>a+p.price,0))
const filtered=computed(()=>products.value.filter(p=>p.name.toLowerCase().includes(filter.value.toLowerCase())))
async function loadCategories(){const r=await fetch('/api/categories');if(!r.ok)throw Error('Категории не загружены');categoryRows.value=await r.json()}
function navigate(id){page.value=id;sidebar.value=false}
function edit(product=null){editingId.value=product?.id??null;form.value=product?{name:product.name,category:product.category,price:product.price,description:product.description,sku:product.sku||'',stock:product.stock||0,image_url:product.image_url||'',published:product.published!==false,images:[...(product.images?.length?product.images:(product.image_url?[product.image_url]:[]))],attributes:(product.attributes||[]).map(a=>({...a})),variants:(product.variants||[]).map(v=>({...v}))}:{name:'',category:categories.value[0]||'Другое',price:0,description:'',sku:'',stock:0,image_url:'',published:true,images:[],attributes:[],variants:[]};editorTab.value='main';dialog.value=true}
async function save(){
  if(busy.value||!form.value.name.trim()||!Number.isFinite(Number(form.value.price))||Number(form.value.price)<0)return
  if(!adminKey.value){updateKey();if(!adminKey.value)return}
  busy.value=true;saveError.value=''
  try{
    const data={...form.value,name:form.value.name.trim(),price:Number(form.value.price),stock:Number(form.value.stock),attributes:form.value.attributes.filter(a=>a.name.trim()&&a.value.trim()),variants:form.value.variants.map(v=>({...v,price:Number(v.price),stock:Number(v.stock)}))}
    await apiWrite(editingId.value===null?'/api/products':'/api/products/'+editingId.value,editingId.value===null?'POST':'PUT',data)
    await reload();dialog.value=false
  }catch(e){saveError.value=e.message}finally{busy.value=false}
}
async function remove(id){
  if(!window.confirm('Удалить товар из базы данных?'))return
  if(!adminKey.value){updateKey();if(!adminKey.value)return}
  try{await apiWrite('/api/products/'+id,'DELETE');await reload()}catch(e){window.alert(e.message)}
}
async function uploadImage(event){
 const file=event.target.files?.[0];if(!file)return
 if(form.value.images.length>=12){saveError.value='Максимум 12 фотографий';return}
 if(!adminKey.value){updateKey();if(!adminKey.value)return}
 uploading.value=true;saveError.value=''
 try{const body=new FormData();body.append('file',file);const response=await fetch('/api/uploads',{method:'POST',headers:{'x-admin-key':adminKey.value},body});const data=await response.json();if(!response.ok)throw Error(data.error||'Ошибка загрузки');form.value.images=[...form.value.images,data.url].slice(0,12);if(!form.value.image_url)form.value.image_url=data.url}catch(e){saveError.value=e.message}finally{uploading.value=false;event.target.value=''}
}
function addAttribute(){form.value.attributes.push({name:'',value:''})}
function addVariant(){form.value.variants.push({name:'',sku:'',price:Number(form.value.price)||0,stock:0})}
function removePhoto(url){form.value.images=form.value.images.filter(x=>x!==url);if(form.value.image_url===url)form.value.image_url=form.value.images[0]||''}
function mainPhoto(url){form.value.image_url=url}
function categoryEdit(c){categoryEditing.value=c.id;categoryName.value=c.name;parentCategory.value=c.parent_id===null?'':String(c.parent_id);templateText.value=(c.attribute_templates||[]).join(', ')}
function cancelCategory(){categoryEditing.value=null;categoryName.value='';parentCategory.value='';templateText.value=''}
function useTemplate(){const c=categoryRows.value.find(x=>x.name===form.value.category);if(!c)return;for(const name of c.attribute_templates||[]){if(!form.value.attributes.some(a=>a.name.toLowerCase()===name.toLowerCase()))form.value.attributes.push({name,value:''})}editorTab.value='attributes'}
async function addCategory(){
 if(!categoryName.value.trim())return
 if(!adminKey.value){updateKey();if(!adminKey.value)return}
 categoryError.value=''
 try{const values=templateText.value.split(',').map(x=>x.trim()).filter(Boolean);await apiWrite(categoryEditing.value?'/api/categories/'+categoryEditing.value:'/api/categories',categoryEditing.value?'PUT':'POST',{name:categoryName.value.trim(),parent_id:parentCategory.value?Number(parentCategory.value):null,attribute_templates:values});cancelCategory();await loadCategories()}catch(e){categoryError.value=e.message}
}
onMounted(async()=>{try{await Promise.all([reload(),loadCategories()])}catch(e){error.value=e.message}finally{loading.value=false}})
</script>
<template>
<div class="admin-layout">
  <div v-if="sidebar" class="mobile-backdrop" @click="sidebar=false"></div>
  <aside class="sidebar" :class="{'sidebar-open':sidebar}">
    <div class="brand"><span class="brand-icon">N</span><div><strong>NOVA</strong><small>ADMIN PANEL</small></div></div>
    <div class="sidebar-label">УПРАВЛЕНИЕ</div>
    <nav><button v-for="section in sections" :key="section.id" :class="{selected:page===section.id}" @click="navigate(section.id)"><span class="nav-icon">{{section.icon}}</span>{{section.label}}<span v-if="section.id==='products'" class="nav-count">{{products.length}}</span></button></nav>
    <div class="sidebar-bottom"><span class="status-dot"></span> NOVA Engine v0.7 <small>Демо-режим</small></div>
  </aside>
  <div class="main-area">
    <header class="topbar"><div class="top-left"><button class="menu-toggle" @click="sidebar=!sidebar">☰</button><span>Панель управления</span><span class="breadcrumb">/ {{sections.find(s=>s.id===page)?.label}}</span></div><div class="top-right"><span class="demo-pill">● Демоверсия</span><button class="row-btn" @click="updateKey">🔑 Ключ API</button><div class="avatar">A</div></div></header>
    <main class="content">
      <div v-if="page==='overview'">
        <div class="page-title"><div><span class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Добро пожаловать в NOVA 👋</h1><p>Управляйте своим магазином в одном месте.</p></div><button class="primary-btn" @click="navigate('products');edit()">＋ Добавить товар</button></div>
        <div class="stats-grid"><div class="stat-card"><span>Всего товаров</span><strong>{{products.length}}</strong><small>Товары из базы данных</small><div class="stat-icon">▦</div></div><div class="stat-card"><span>Сумма цен каталога</span><strong>{{money(total)}}</strong><small>Не выручка магазина</small><div class="stat-icon">₽</div></div><div class="stat-card"><span>Заказы</span><strong>—</strong><small>Модуль пока не подключён</small><div class="stat-icon">▤</div></div><div class="stat-card"><span>Покупатели</span><strong>—</strong><small>Модуль пока не подключён</small><div class="stat-icon">♙</div></div></div>
        <div class="panel"><div class="panel-heading"><div><h2>Недавно добавленные товары</h2><p>Данные из PostgreSQL через NOVA API</p></div><button class="text-btn" @click="navigate('products')">Все товары →</button></div><div v-if="loading" class="empty">Загрузка...</div><div v-else-if="error" class="alert">{{error}}</div><div v-else class="table-scroll"><table><thead><tr><th>Товар</th><th>Категория</th><th>Цена</th></tr></thead><tbody><tr v-for="p in products.slice(-5).reverse()" :key="p.id"><td><span class="product-marker">📦</span><strong>{{p.name}}</strong></td><td>{{p.category}}</td><td class="table-price">{{money(p.price)}}</td></tr></tbody></table></div></div>
      </div>
      <div v-if="page==='categories'"><div class="page-title"><div><span class="eyebrow">КАТАЛОГ</span><h1>Категории</h1><p>Создавайте категории товаров.</p></div></div><div class="panel"><div class="panel-heading"><h2>Категории ({{categoryRows.length}})</h2></div><div style="padding:20px;display:flex;flex-wrap:wrap;gap:10px"><input class="search-input" v-model="categoryName" placeholder="Название категории" maxlength="100"><select class="search-input" v-model="parentCategory"><option value="">Без родителя</option><option v-for="c in categoryRows.filter(c=>c.id!==categoryEditing)" :key="c.id" :value="String(c.id)">{{c.name}}</option></select><input class="search-input" v-model="templateText" placeholder="Шаблоны через запятую: Бренд, Цвет"><button class="primary-btn" @click="addCategory">{{categoryEditing?'Сохранить категорию':'Добавить категорию'}}</button><button v-if="categoryEditing" class="row-btn" @click="cancelCategory">Отмена</button></div><p v-if="categoryError" class="alert">{{categoryError}}</p><div class="table-scroll"><table><thead><tr><th>ID</th><th>Категория</th></tr></thead><tbody><tr v-for="c in categoryTree" :key="c.id"><td>{{c.id}}</td><td><strong :style="{paddingLeft:(c.depth*22)+'px',display:'inline-block'}">{{c.depth?'↳ ':''}}{{c.name}}</strong><div style="color:#82948a;font-size:11px">{{(c.attribute_templates||[]).join(' · ')}}</div><button class="row-btn" @click="categoryEdit(c)">Редактировать</button></td></tr></tbody></table></div></div></div>
      <div v-if="page==='products'"><div class="page-title"><div><span class="eyebrow">КАТАЛОГ</span><h1>Товары</h1><p>Добавляйте и редактируйте товары в общей базе данных.</p></div><button class="primary-btn" @click="edit()">＋ Добавить товар</button></div><div class="panel"><div class="panel-heading"><div><h2>Все товары <span class="count-tag">{{products.length}}</span></h2><p>Изменения сохраняются в PostgreSQL и доступны на витрине</p></div><input class="search-input" v-model="filter" placeholder="⌕  Поиск по названию"></div><div v-if="loading" class="empty">Загрузка...</div><div v-else-if="error" class="alert">{{error}}</div><div v-else class="table-scroll"><table><thead><tr><th>Наименование</th><th>Категория</th><th>Цена</th><th class="actions-col">Действия</th></tr></thead><tbody><tr v-for="p in filtered" :key="p.id"><td><span class="product-marker">📦</span><strong>{{p.name}}</strong></td><td><span class="category-chip">{{p.category}}</span></td><td class="table-price">{{money(p.price)}}</td><td class="actions-col"><button class="row-btn" @click="edit(p)">Изменить</button><button class="row-btn danger" @click="remove(p.id)">Удалить</button></td></tr></tbody></table><div v-if="!filtered.length" class="empty">Товары не найдены</div></div></div></div>
      <div v-if="['orders','customers','settings'].includes(page)"><div class="page-title"><div><span class="eyebrow">NOVA ENGINE</span><h1>{{sections.find(s=>s.id===page)?.label}}</h1><p>Модуль появится на следующем этапе.</p></div></div><div class="coming-soon"><div>✧</div><h2>Раздел в разработке</h2><p>Сейчас доступно управление демонстрационным каталогом. Заказы, пользователи и настройки появятся после разработки авторизации и других модулей.</p></div></div>
    </main>
  </div>
  <div v-if="dialog" class="modal-backdrop" @click.self="dialog=false"><div class="modal"><div class="modal-heading"><h2>{{editingId===null?'Новый товар':'Редактирование товара'}}</h2><button @click="dialog=false">×</button></div><div class="editor-tabs"><button type="button" v-for="t in [{id:'main',name:'Основное'},{id:'photos',name:'Фотографии'},{id:'attributes',name:'Характеристики'},{id:'variants',name:'Варианты'}]" :key="t.id" :class="{active:editorTab===t.id}" @click="editorTab=t.id">{{t.name}}</button></div><form @submit.prevent="save"><template v-if="editorTab==='main'"><label>Название товара<input v-model="form.name" required maxlength="150" placeholder="Например, беспроводные наушники"></label><label>Категория<select v-model="form.category"><option v-for="c in categories" :key="c">{{c}}</option></select></label><label>Цена, ₽<input v-model.number="form.price" type="number" min="0" step="0.01" required></label><label>Артикул (SKU)<input v-model="form.sku" maxlength="100" placeholder="Например, NOVA-001"></label><label>Остаток на складе<input v-model.number="form.stock" type="number" min="0" step="1" required></label></template><template v-if="editorTab==='photos'"><label>Фотографии товара (до 12)<input type="file" accept="image/jpeg,image/png,image/webp" @change="uploadImage"><small v-if="uploading">Загружается...</small><div style="display:flex;flex-wrap:wrap;gap:10px"><div v-for="url in form.images" :key="url" style="display:flex;flex-direction:column;gap:5px"><img :src="url" alt="Фото товара" style="width:105px;height:90px;object-fit:contain;background:#f5f5f5;border-radius:8px"><button type="button" class="row-btn" @click="mainPhoto(url)">{{form.image_url===url?'★ Главное':'Сделать главным'}}</button><button type="button" class="row-btn danger" @click="removePhoto(url)">Удалить</button></div></div></label></template><template v-if="editorTab==='main'"><label style="flex-direction:row;align-items:center"><input type="checkbox" v-model="form.published"> Опубликован</label><label>Описание<textarea v-model="form.description" rows="3" placeholder="Краткое описание"></textarea></label></template><div v-if="editorTab==='attributes'" class="editor-repeater"><button type="button" class="row-btn" @click="useTemplate">Применить шаблон категории</button><p>Название и значение характеристики (например, Материал — хлопок).</p><div v-for="(a,i) in form.attributes" :key="i" class="editor-line"><input v-model="a.name" maxlength="80" placeholder="Характеристика"><input v-model="a.value" maxlength="300" placeholder="Значение"><button type="button" class="row-btn danger" @click="form.attributes.splice(i,1)">×</button></div><button type="button" class="row-btn" @click="addAttribute">＋ Добавить характеристику</button></div><div v-if="editorTab==='variants'" class="editor-repeater"><p>Каждый вариант имеет собственную цену, артикул и остаток.</p><div v-for="(v,i) in form.variants" :key="i" class="variant-row"><input v-model="v.name" maxlength="120" placeholder="Название, например Красный / M"><input v-model="v.sku" maxlength="100" placeholder="Артикул"><input v-model.number="v.price" type="number" min="0" step="0.01" placeholder="Цена"><input v-model.number="v.stock" type="number" min="0" step="1" placeholder="Остаток"><button type="button" class="row-btn danger" @click="form.variants.splice(i,1)">Удалить</button></div><button type="button" class="row-btn" @click="addVariant">＋ Добавить вариант</button></div><p v-if="saveError" class="alert">{{saveError}}</p><div class="modal-actions"><button type="button" class="cancel-btn" @click="dialog=false">Отмена</button><button type="submit" class="primary-btn" :disabled="busy">{{busy?'Сохранение…':'Сохранить'}}</button></div></form></div></div>
</div>
</template>
