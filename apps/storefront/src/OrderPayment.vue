<script setup>
import {ref} from 'vue'
import PaymentFrame from '../../../shared/PaymentFrame.vue'
const props=defineProps({receipt:Object,texts:Object,config:Object})
const details=ref(null),busy=ref(false),error=ref('')
async function open(){if(busy.value)return;busy.value=true;error.value='';try{
 const request=async endpoint=>{const r=await fetch(endpoint,{method:'POST',credentials:'omit',headers:{'content-type':'application/json','x-nova-checkout':'1'},body:JSON.stringify({token:props.receipt.payment_token}),signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw Error(data.error||props.texts.payment_error);return data}
 const current=await request('/api/payments/checkout')
 details.value=props.config.automatic&&current.order.payment_state==='unpaid'?{...await request('/api/payments/automatic/checkout'),order:current.order}:current
}catch(e){error.value=e.message}finally{busy.value=false}}
</script>
<template><section class="order-payment">
<h3>{{config.title}}</h3><p v-if="!details">{{config.instructions}}</p><p v-if="!config.automatic" class="payment-manual">{{texts.payment_manual}}</p>
<button v-if="!details" type="button" class="primary-button" :disabled="busy" @click="open">{{busy?texts.payment_loading:texts.payment_open}}</button>
<div v-if="details"><template v-if="details.order?.payment_state==='paid'"><strong role="status">{{texts.payment_paid}}</strong></template><template v-else-if="details.order?.payment_state==='refunded'"><strong role="status">{{texts.payment_refunded}}</strong></template><template v-else-if="details.enabled"><p>{{texts.payment_reference}} <strong>{{details.order?.number||receipt.number}}</strong> · {{new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format((details.order?.total_cents||receipt.total_cents)/100)}}</p><p>{{details.instructions}}</p><PaymentFrame v-if="details.mode==='widget'" :config="details" :order="details.order"/><a v-if="details.link" class="payment-link" :href="details.link" target="_blank" rel="noopener noreferrer">{{texts.payment_link}} ↗</a><p v-if="!config.automatic">{{texts.payment_amount_notice}}</p><p v-else>Подтверждение оплаты появится в статусе заказа после проверки платёжного сервиса.</p></template><p v-else role="status">{{texts.payment_unavailable}}</p><button class="payment-refresh" type="button" :disabled="busy" @click="open">{{busy?texts.payment_loading:texts.payment_refresh}}</button></div><p v-if="error" class="payment-error" role="alert">{{error}}</p>
</section></template>
<style scoped>.order-payment{text-align:left;margin:25px 0;padding:18px 0;border-top:1px solid #d4dfd9;border-bottom:1px solid #d4dfd9;min-width:0}.order-payment h3{font-size:20px;margin-top:0}.order-payment p{line-height:1.6;overflow-wrap:anywhere}.payment-manual{font-size:12px;opacity:.8}.payment-link{display:block;text-align:center;padding:14px;margin:14px 0;border:1px solid currentColor;border-radius:8px;color:inherit;text-decoration:none;font-weight:600}.payment-refresh{padding:12px;background:none;border:1px solid #c8d8cc;border-radius:8px;color:inherit;cursor:pointer}.payment-error{color:#9e2727!important}</style>
