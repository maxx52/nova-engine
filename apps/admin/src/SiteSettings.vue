<script setup>
import { ref,onMounted } from 'vue'
const props=defineProps({apiWrite:Function})
const emit=defineEmits(['saved'])
const form=ref(null),pages=ref([]),busy=ref(false),error=ref(''),notice=ref('')
onMounted(async()=>{try{form.value=await props.apiWrite('/api/settings','GET');const all=await props.apiWrite('/api/admin/pages','GET');pages.value=all.filter(p=>p.published)}catch(e){error.value=e.message}})
async function save(){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{form.value=await props.apiWrite('/api/admin/settings','PUT',form.value);emit('saved',form.value);notice.value='Настройки сохранены'}catch(e){error.value=e.message}finally{busy.value=false}}
async function upload(event){const file=event.target.files?.[0];if(!file)return;busy.value=true;error.value='';notice.value='';try{const data=new FormData();data.append('file',file);const response=await fetch('/api/uploads',{method:'POST',headers:{'x-admin-key':sessionStorage.getItem('nova_admin_key')||''},body:data});const result=await response.json();if(!response.ok)throw Error(result.error||'Ошибка загрузки');form.value.logo_url=result.url}catch(e){error.value=e.message}finally{busy.value=false;event.target.value=''}}
function move(index,delta){const target=index+delta;if(target<0||target>=form.value.menu.length)return;const [item]=form.value.menu.splice(index,1);form.value.menu.splice(target,0,item)}
</script>
<template>
<div><div class="page-title"><div><span class="eyebrow">NOVA CMS</span><h1>Настройки сайта</h1><p>Название, главная страница, меню и магазин.</p></div></div><p v-if="error" class="alert" role="alert">{{error}}</p><p v-if="notice" class="settings-notice" role="status">{{notice}}</p>
<form v-if="form" class="panel settings-form" @submit.prevent="save"><fieldset :disabled="busy">
<label>Название сайта<input v-model="form.name" required maxlength="100"></label>
<label>Логотип<input type="file" accept="image/jpeg,image/png,image/webp" @change="upload"><small>JPG, PNG, WebP до 5 МБ</small></label><div v-if="form.logo_url"><img :src="form.logo_url" alt="Логотип" class="settings-logo"><button type="button" class="row-btn" @click="form.logo_url=''">Убрать логотип</button></div>
<label>Главная страница<select v-model="form.home_page_id"><option :value="null">{{form.shop_enabled?'Демонстрационная страница магазина':'Стартовая страница с названием сайта'}}</option><option v-if="form.home_page_id && !pages.some(p=>String(p.id)===form.home_page_id)" :value="form.home_page_id">Выбранная страница недоступна — выберите другую</option><option v-for="page in pages" :key="page.id" :value="String(page.id)">{{page.title}} (/{{page.slug}})</option></select><small>Выбранная опубликованная страница будет открываться по адресу /.</small></label>
<label class="settings-check"><input type="checkbox" v-model="form.shop_enabled"> Включить магазин</label><p>При отключении каталог и корзина исчезнут с сайта. Товары сохранятся.</p>
<h2>Меню сайта</h2><p>Внутренние ссылки: /, /about, /catalog. Допускаются HTTP(S) адреса.</p>
<div v-for="(item,index) in form.menu" :key="index" class="menu-setting"><label>Название ссылки<input v-model="item.label" required maxlength="80"></label><label>Адрес<input v-model="item.url" required maxlength="2000" placeholder="/about"></label><div><button type="button" class="row-btn" :disabled="index===0" aria-label="Поднять ссылку" @click="move(index,-1)">↑</button><button type="button" class="row-btn" :disabled="index===form.menu.length-1" aria-label="Опустить ссылку" @click="move(index,1)">↓</button><button type="button" class="row-btn danger" @click="form.menu.splice(index,1)">Удалить</button></div></div>
<button type="button" class="row-btn" :disabled="form.menu.length>=20" @click="form.menu.push({label:'',url:''})">＋ Добавить ссылку</button><div class="settings-actions"><button class="primary-btn">{{busy?'Сохранение…':'Сохранить настройки'}}</button></div>
</fieldset></form></div>
</template>
<style scoped>
.settings-form { max-width:850px; padding:28px; } fieldset { border:0; padding:0; min-width:0; display:grid; gap:20px; } label { display:grid;gap:8px;font-size:14px;font-weight:700; } input,select { min-width:0;max-width:100%;border:1px solid #dbe5e2;border-radius:7px;padding:12px; } .settings-check { display:flex;align-items:center; } p,small { color:#62776c;font-size:13px; } .settings-logo { max-width:180px;max-height:90px;object-fit:contain;display:block;margin-bottom:12px; } .menu-setting { padding:16px;border:1px solid #dbe5e2;border-radius:8px;display:grid;gap:12px; } .settings-notice {color:#287253;} .settings-actions { margin-top:12px; }
</style>
