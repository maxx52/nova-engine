<script setup>
import { ref, computed, onMounted } from 'vue'
const page=ref('overview')
const products=ref([])
const loading=ref(true)
const error=ref('')
const filter=ref('')
const dialog=ref(false)
const editingId=ref(null)
const form=ref({name:'',category:'Электроника',price:0,description:''})
const sidebar=ref(false)
const categories=['Электроника','Дом','Аксессуары','Другое']
const sections=[{id:'overview',icon:'◫',label:'Обзор'},{id:'products',icon:'▦',label:'Товары'},{id:'orders',icon:'▤',label:'Заказы'},{id:'customers',icon:'♙',label:'Покупатели'},{id:'settings',icon:'⚙',label:'Настройки'}]
const money=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n)
const total=computed(()=>products.value.reduce((a,p)=>a+p.price,0))
const filtered=computed(()=>products.value.filter(p=>p.name.toLowerCase().includes(filter.value.toLowerCase())))
function navigate(id){page.value=id;sidebar.value=false}
function edit(product=null){editingId.value=product?.id??null;form.value=product?{name:product.name,category:product.category,price:product.price,description:product.description}:{name:'',category:'Электроника',price:0,description:''};dialog.value=true}
function save(){if(!form.value.name.trim()||!Number.isFinite(Number(form.value.price))||Number(form.value.price)<0)return;const data={...form.value,name:form.value.name.trim(),price:Number(form.value.price)};if(editingId.value!==null){const i=products.value.findIndex(p=>p.id===editingId.value);if(i>=0)products.value[i]={...products.value[i],...data}}else products.value.push({...data,id:Math.max(0,...products.value.map(p=>p.id))+1});dialog.value=false}
function remove(id){if(window.confirm('Удалить товар из демонстрационного списка?'))products.value=products.value.filter(p=>p.id!==id)}
onMounted(async()=>{try{const r=await fetch('/api/products');if(!r.ok)throw Error('Не удалось загрузить каталог');products.value=await r.json()}catch(e){error.value=e.message}finally{loading.value=false}})
</script>
<template>
<div class="admin-layout">
  <div v-if="sidebar" class="mobile-backdrop" @click="sidebar=false"></div>
  <aside class="sidebar" :class="{'sidebar-open':sidebar}">
    <div class="brand"><span class="brand-icon">N</span><div><strong>NOVA</strong><small>ADMIN PANEL</small></div></div>
    <div class="sidebar-label">УПРАВЛЕНИЕ</div>
    <nav><button v-for="section in sections" :key="section.id" :class="{selected:page===section.id}" @click="navigate(section.id)"><span class="nav-icon">{{section.icon}}</span>{{section.label}}<span v-if="section.id==='products'" class="nav-count">{{products.length}}</span></button></nav>
    <div class="sidebar-bottom"><span class="status-dot"></span> NOVA Engine v0.2 <small>Демо-режим</small></div>
  </aside>
  <div class="main-area">
    <header class="topbar"><div class="top-left"><button class="menu-toggle" @click="sidebar=!sidebar">☰</button><span>Панель управления</span><span class="breadcrumb">/ {{sections.find(s=>s.id===page)?.label}}</span></div><div class="top-right"><span class="demo-pill">● Демоверсия</span><div class="avatar">A</div></div></header>
    <main class="content">
      <div v-if="page==='overview'">
        <div class="page-title"><div><span class="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>Добро пожаловать в NOVA 👋</h1><p>Управляйте своим магазином в одном месте.</p></div><button class="primary-btn" @click="navigate('products');edit()">＋ Добавить товар</button></div>
        <div class="stats-grid"><div class="stat-card"><span>Всего товаров</span><strong>{{products.length}}</strong><small>Демонстрационный каталог</small><div class="stat-icon">▦</div></div><div class="stat-card"><span>Сумма цен каталога</span><strong>{{money(total)}}</strong><small>Не выручка магазина</small><div class="stat-icon">₽</div></div><div class="stat-card"><span>Заказы</span><strong>—</strong><small>Модуль пока не подключён</small><div class="stat-icon">▤</div></div><div class="stat-card"><span>Покупатели</span><strong>—</strong><small>Модуль пока не подключён</small><div class="stat-icon">♙</div></div></div>
        <div class="panel"><div class="panel-heading"><div><h2>Недавно добавленные товары</h2><p>Данные из демонстрационного API</p></div><button class="text-btn" @click="navigate('products')">Все товары →</button></div><div v-if="loading" class="empty">Загрузка...</div><div v-else-if="error" class="alert">{{error}}</div><div v-else class="table-scroll"><table><thead><tr><th>Товар</th><th>Категория</th><th>Цена</th></tr></thead><tbody><tr v-for="p in products.slice(-5).reverse()" :key="p.id"><td><span class="product-marker">📦</span><strong>{{p.name}}</strong></td><td>{{p.category}}</td><td class="table-price">{{money(p.price)}}</td></tr></tbody></table></div></div>
      </div>
      <div v-if="page==='products'"><div class="page-title"><div><span class="eyebrow">КАТАЛОГ</span><h1>Товары</h1><p>Добавляйте и редактируйте товары демонстрационного магазина.</p></div><button class="primary-btn" @click="edit()">＋ Добавить товар</button></div><div class="panel"><div class="panel-heading"><div><h2>Все товары <span class="count-tag">{{products.length}}</span></h2><p>Изменения хранятся только до обновления страницы</p></div><input class="search-input" v-model="filter" placeholder="⌕  Поиск по названию"></div><div v-if="loading" class="empty">Загрузка...</div><div v-else-if="error" class="alert">{{error}}</div><div v-else class="table-scroll"><table><thead><tr><th>Наименование</th><th>Категория</th><th>Цена</th><th class="actions-col">Действия</th></tr></thead><tbody><tr v-for="p in filtered" :key="p.id"><td><span class="product-marker">📦</span><strong>{{p.name}}</strong></td><td><span class="category-chip">{{p.category}}</span></td><td class="table-price">{{money(p.price)}}</td><td class="actions-col"><button class="row-btn" @click="edit(p)">Изменить</button><button class="row-btn danger" @click="remove(p.id)">Удалить</button></td></tr></tbody></table><div v-if="!filtered.length" class="empty">Товары не найдены</div></div></div></div>
      <div v-if="['orders','customers','settings'].includes(page)"><div class="page-title"><div><span class="eyebrow">NOVA ENGINE</span><h1>{{sections.find(s=>s.id===page)?.label}}</h1><p>Модуль появится на следующем этапе.</p></div></div><div class="coming-soon"><div>✧</div><h2>Раздел в разработке</h2><p>Сейчас доступно управление демонстрационным каталогом. Заказы, пользователи и настройки появятся после подключения базы данных и авторизации.</p></div></div>
    </main>
  </div>
  <div v-if="dialog" class="modal-backdrop" @click.self="dialog=false"><div class="modal"><div class="modal-heading"><h2>{{editingId===null?'Новый товар':'Редактирование товара'}}</h2><button @click="dialog=false">×</button></div><form @submit.prevent="save"><label>Название товара<input v-model="form.name" required maxlength="150" placeholder="Например, беспроводные наушники"></label><label>Категория<select v-model="form.category"><option v-for="c in categories" :key="c">{{c}}</option></select></label><label>Цена, ₽<input v-model.number="form.price" type="number" min="0" step="0.01" required></label><label>Описание<textarea v-model="form.description" rows="3" placeholder="Краткое описание"></textarea></label><div class="modal-actions"><button type="button" class="cancel-btn" @click="dialog=false">Отмена</button><button type="submit" class="primary-btn">Сохранить</button></div></form></div></div>
</div>
</template>
