<script setup>
import {ref} from 'vue'
import {auth,authRequest} from './adminApi.js'
const dialog=ref(false),current=ref(''),password=ref(''),confirmation=ref(''),busy=ref(false),error=ref('')
async function logout(all=false){if(busy.value)return;busy.value=true;error.value='';try{await authRequest(all?'/api/auth/logout-all':'/api/auth/logout');auth.user=null;auth.csrf=''}catch(e){error.value=e.message}finally{busy.value=false}}
async function change(){if(busy.value)return;error.value='';if(password.value!==confirmation.value){error.value='Пароли не совпадают';return}busy.value=true;try{await authRequest('/api/auth/password',{current_password:current.value,new_password:password.value});auth.user=null;auth.csrf='';auth.notice='Пароль изменён. Войдите с новым паролем.'}catch(e){error.value=e.message}finally{busy.value=false}}
</script>
<template>
<div class="account-actions"><span>{{auth.user?.username}}</span><button class="row-btn" :disabled="busy" @click="dialog=true;error=''">Сменить пароль</button><button class="row-btn" :disabled="busy" @click="logout(false)">Выйти</button><button class="row-btn" :disabled="busy" @click="logout(true)">Выйти везде</button><span v-if="error && !dialog" role="alert">{{error}}</span></div>
<div v-if="dialog" class="modal-backdrop"><div class="modal"><div class="modal-heading"><h2>Смена пароля</h2><button :disabled="busy" @click="dialog=false;current='';password='';confirmation=''">×</button></div><form @submit.prevent="change"><fieldset :disabled="busy"><label>Текущий пароль<input v-model="current" type="password" autocomplete="current-password" required minlength="12" maxlength="256"></label><label>Новый пароль<input v-model="password" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><label>Повторите новый пароль<input v-model="confirmation" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><p>После смены пароля потребуется войти заново на всех устройствах.</p><p v-if="error" class="alert" role="alert">{{error}}</p><button class="primary-btn">{{busy?'Сохранение…':'Изменить пароль'}}</button></fieldset></form></div></div>
</template>
<style scoped>
.account-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;}fieldset{border:0;padding:0;display:grid;gap:18px;min-width:0;}p{font-size:13px;line-height:1.7;}@media(max-width:600px){.account-actions>span:first-child{display:none;}}
</style>
