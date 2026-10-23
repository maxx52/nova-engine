<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {orderStatuses} from '../../../shared/commerce.js'
import {paymentStates} from '../../../shared/payments.js'
const props=defineProps({token:{type:String,default:''}})
const order=ref(null),error=ref(''),busy=ref(false)
const token=props.token||new URLSearchParams(location.hash.slice(1)).get('token')||''
const link='/order-status#token='+encodeURIComponent(token)
const money=c=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(c/100)
async function refresh(){if(busy.value)return;busy.value=true;error.value='';try{const r=await fetch('/api/orders/status',{method:'POST',credentials:'omit',headers:{'content-type':'application/json','x-nova-checkout':'1'},body:JSON.stringify({token}),signal:AbortSignal.timeout(12000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Статус недоступен');order.value=d}catch(e){error.value=e.message}finally{busy.value=false}}
let timer
onMounted(()=>{refresh();timer=setInterval(()=>{if(!document.hidden)refresh()},30000)})
onBeforeUnmount(()=>clearInterval(timer))
</script>
<template><section class="order-status-view"><h1>{{order?'Статус заказа '+order.number:'Статус заказа'}}</h1><template v-if="order"><p><strong>{{orderStatuses[order.status]}}</strong> · {{paymentStates[order.payment_state]}}</p><p>Итого: {{money(order.total_cents)}} · доставка: {{money(order.delivery_cents)}}</p><p>{{order.delivery_snapshot.title}}</p><p v-if="order.tracking_code">Трек-номер: {{order.tracking_code}}</p><a v-if="order.tracking_url" :href="order.tracking_url" target="_blank" rel="noopener noreferrer">Отследить отправление ↗</a></template><p v-if="error" role="alert">{{error}}</p><p><button type="button" :disabled="busy" @click="refresh">{{busy?'Загрузка…':'Обновить статус'}}</button></p><p><a :href="link">Ссылка на статус заказа</a> — сохраните её и передавайте только тем, кому разрешаете просматривать статус. Доступна 90 дней.</p></section></template>
<style scoped>.order-status-view{max-width:800px;margin:30px auto;padding:24px;line-height:1.7;overflow-wrap:anywhere}.order-status-view h1{font-size:24px}.order-status-view button{padding:12px;border:1px solid #ccd9d0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}.order-status-view a{color:inherit}</style>
