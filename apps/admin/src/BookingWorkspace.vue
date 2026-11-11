<script setup>
import {ref,onMounted} from 'vue'
const props=defineProps({apiWrite:{type:Function,required:true}})
const organizations=ref([]),branches=ref([]),selected=ref(''),error=ref(''),busy=ref(false)
const organization=ref({name:'',profile:'universal'}),branch=ref({name:'',timezone:'Asia/Barnaul',address:''})
async function load(){try{error.value='';organizations.value=(await props.apiWrite('/api/admin/booking/organizations','GET')).organizations;if(selected.value&&!organizations.value.some(o=>o.id===selected.value))selected.value='';if(selected.value)await loadBranches()}catch(e){error.value='Модуль недоступен. Проверьте, что NOVA_BOOKING_ENABLED=true и API перезапущен. '+e.message}}
async function loadBranches(){branches.value=[];if(!selected.value)return;try{branches.value=(await props.apiWrite(`/api/admin/booking/organizations/${selected.value}/branches`,'GET')).branches}catch(e){error.value=e.message}}
async function createOrg(){busy.value=true;try{await props.apiWrite('/api/admin/booking/organizations','POST',organization.value);organization.value={name:'',profile:'universal'};await load()}catch(e){error.value=e.message}finally{busy.value=false}}
async function createBranch(){busy.value=true;try{await props.apiWrite(`/api/admin/booking/organizations/${selected.value}/branches`,'POST',branch.value);branch.value={name:'',timezone:'Asia/Barnaul',address:''};await loadBranches()}catch(e){error.value=e.message}finally{busy.value=false}}
onMounted(load)
</script>
<template>
 <div class="page-title"><div><h1>Booking &amp; CRM</h1><p>Первый этап: организации и филиалы</p></div></div>
 <p v-if="error" class="alert" role="alert">{{error}}</p>
 <div class="panel" style="padding:20px;margin-bottom:20px"><h2>Организации</h2><form @submit.prevent="createOrg" style="display:flex;flex-wrap:wrap;gap:10px"><input v-model="organization.name" class="search-input" placeholder="Название организации" maxlength="150" required><select v-model="organization.profile" class="search-input"><option value="universal">Универсальный бизнес</option><option value="dentistry">Стоматология</option><option value="beauty">Салон красоты</option><option value="automotive">Автосервис</option></select><button class="primary-btn" :disabled="busy">Создать организацию</button></form><p>Создание доступно владельцу NOVA. Профиль пока сохраняется как настройка.</p></div>
 <div class="panel" style="padding:20px"><h2>Филиалы</h2><select v-model="selected" @change="loadBranches" class="search-input"><option value="">Выберите организацию</option><option v-for="o in organizations" :key="o.id" :value="o.id">{{o.name}} ({{o.role}})</option></select><template v-if="selected"><form @submit.prevent="createBranch" style="display:flex;flex-wrap:wrap;gap:10px;margin:16px 0"><input v-model="branch.name" class="search-input" placeholder="Название филиала" maxlength="150" required><input v-model="branch.timezone" class="search-input" placeholder="Часовой пояс, например Asia/Barnaul" required><input v-model="branch.address" class="search-input" placeholder="Адрес" maxlength="300"><button class="primary-btn" :disabled="busy">Добавить филиал</button></form><ul><li v-for="b in branches" :key="b.id">{{b.name}} — {{b.timezone}} <span v-if="b.address">— {{b.address}}</span></li></ul><p v-if="!branches.length">Филиалов пока нет.</p></template></div>
</template>
