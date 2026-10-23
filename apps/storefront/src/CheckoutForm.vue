<script setup>
import {analyticsOrderContext} from './analytics.js'
import OrderStatus from './OrderStatus.vue'
import {customer,customerRequest,refreshCustomer} from './customerApi.js'
import {shippingPrice} from '../../../shared/fulfillment.js'
import OrderPayment from './OrderPayment.vue'
import {ref,computed,watch,onMounted} from 'vue'
const props=defineProps({items:Array,texts:Object})
const payments=ref({enabled:false}),shipping=ref(null),optionId=ref(''),notify=ref(false)
onMounted(async()=>{try{const r=await fetch('/api/shipping',{credentials:'omit'});if(!r.ok)throw Error();shipping.value=await r.json();optionId.value=shipping.value.options[0]?.id||''}catch{error.value='Не удалось загрузить доставку. Обновите страницу.'}})
const option=computed(()=>shipping.value?.options.find(o=>o.id===optionId.value))
const fee=computed(()=>option.value?shippingPrice(option.value,estimate.value):0)
onMounted(async()=>{try{const r=await fetch('/api/payments/config',{credentials:'omit'});if(r.ok)payments.value=await r.json()}catch{}})
const emit=defineEmits(['complete','back','locked','account'])
const form=ref({name:'',phone:'',email:'',method:'pickup',address:'',comment:''}),busy=ref(false),error=ref(''),receipt=ref(null),pending=ref(null)
watch(()=>busy.value||!!pending.value,value=>emit('locked',value))
const addresses=ref([]),selectedAddress=ref('');let pendingOwner
watch(()=>customer.user?.id,(id,old)=>{if(old&&id!==old){addresses.value=[];selectedAddress.value='';form.value={name:'',phone:'',email:'',method:'pickup',address:'',comment:''}}})
onMounted(async()=>{try{await refreshCustomer();if(!customer.user)return;form.value.name=customer.user.name;form.value.phone=customer.user.phone;form.value.email=customer.user.email;const owner=customer.user.id;const rows=await customerRequest('/api/account/addresses');if(owner!==customer.user?.id)return;addresses.value=rows;const a=addresses.value.find(a=>a.is_default);if(a){selectedAddress.value=a.id;useAddress()}}catch(e){error.value=e.message}})
function useAddress(){const a=addresses.value.find(a=>a.id===selectedAddress.value);if(a){form.value.name=a.name;form.value.phone=a.phone;form.value.address=a.address}}
const money=cents=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(cents/100)
const estimate=computed(()=>Math.round(props.items.reduce((sum,x)=>sum+Math.round(x.price*100)*x.quantity,0)))
async function submit(){
 if(busy.value||receipt.value)return
 if(pending.value&&pendingOwner!==(customer.user?.id||null)){error.value='Для повторной отправки войдите в ту же учётную запись, с которой начали оформление.';return}
 busy.value=true;error.value=''
 if(!pending.value)pendingOwner=customer.user?.id||null
 if(!pending.value)pending.value={analytics:await analyticsOrderContext(),request_id:crypto.randomUUID(),customer:{name:form.value.name,phone:form.value.phone,email:form.value.email},delivery:{method:option.value?.kind||form.value.method,address:form.value.address,option_id:optionId.value,settings_revision:shipping.value?.revision},notifications_opt_in:notify.value,comment:form.value.comment,items:props.items.map(x=>({product_id:x.id,variant_name:x.variantName||'',quantity:x.quantity}))}
 try{
  const response=await fetch('/api/orders',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-nova-checkout':'1',...(customer.csrf?{'x-customer-csrf':customer.csrf}:{})},body:JSON.stringify(pending.value),signal:AbortSignal.timeout(15000)})
  const data=await response.json()
  if(!response.ok){if(response.status>=400&&response.status<500)pending.value=null;throw Error(data.error||props.texts.checkout_error)}
  receipt.value=data;pending.value=null;emit('complete')
 }catch(e){error.value=pending.value?props.texts.checkout_retry:e.message}finally{busy.value=false}
}
</script>
<template>
<div class="checkout-form">
 <div v-if="receipt" class="checkout-success" role="status"><span>✓</span><h3>{{texts.order_success}}</h3><strong>{{receipt.number}}</strong><p>{{texts.order_received}}</p><p>{{texts.cart_total}}: {{money(receipt.total_cents)}}</p><OrderPayment v-if="(payments.enabled||payments.automatic)&&receipt.payment_token" :receipt="receipt" :texts="texts" :config="payments"/><OrderStatus v-if="receipt.status_token" :token="receipt.status_token"/><button class="primary-button" @click="emit('back')">{{texts.order_close}}</button></div>
 <form v-else @submit.prevent="submit"><h3>{{texts.checkout_title}}</h3><p>{{texts.checkout_intro}}</p><p v-if="customer.user">Заказ сохранится в вашем личном кабинете.</p><button v-else type="button" class="checkout-back" :disabled="busy||!!pending" @click="emit('account')">Войти, чтобы сохранять историю заказов</button><fieldset :disabled="busy||!!pending"><label v-if="addresses.length">Сохранённый адрес<select v-model="selectedAddress" @change="useAddress"><option value="">Ввести вручную</option><option v-for="a in addresses" :key="a.id" :value="a.id">{{a.label}}</option></select></label><label>{{texts.customer_name}}<input v-model="form.name" autocomplete="name" maxlength="150" required></label><label>{{texts.customer_phone}}<input v-model="form.phone" type="tel" autocomplete="tel" maxlength="40" required placeholder="+7 …"></label><label>{{texts.customer_email}}<input v-model="form.email" type="email" autocomplete="email" maxlength="254"></label><label>{{texts.delivery_method}}<select v-model="optionId" required><option v-for="o in shipping?.options||[]" :key="o.id" :value="o.id">{{o.title}} — {{money(shippingPrice(o,estimate))}}</option></select><small v-if="option?.description">{{option.description}}</small></label><label v-if="option?.kind==='delivery'">{{texts.delivery_address}}<textarea v-model="form.address" autocomplete="street-address" maxlength="1000" rows="3" required></textarea></label><label v-if="form.email"><span><input v-model="notify" type="checkbox" style="width:auto"> Получать уведомления о заказе на email</span></label><label>{{texts.order_comment}}<textarea v-model="form.comment" maxlength="2000" rows="3"></textarea></label></fieldset><div class="total-row"><span>{{texts.cart_total}}</span><strong>{{money(estimate+fee)}}</strong></div><p>Доставка: {{money(fee)}}</p><p>{{(payments.enabled||payments.automatic)?texts.checkout_online_note:texts.checkout_payment_note}}</p><p class="checkout-privacy">{{texts.checkout_privacy}}</p><p v-if="error" class="checkout-error" role="alert">{{error}}</p><button type="submit" class="primary-button" :disabled="busy||!shipping">{{busy?texts.order_sending:pending?texts.order_retry:texts.order_submit}}</button><button type="button" class="checkout-back" :disabled="busy||!!pending" @click="emit('back')">{{texts.back_cart}}</button></form>
</div>
</template>
<style scoped>
.checkout-form{padding:0 0 24px;overflow-y:auto;min-height:0;flex:1}.checkout-form h3{font-size:22px}.checkout-form p{line-height:1.6;font-size:13px;color:inherit}.checkout-form fieldset{border:0;padding:0;margin:22px 0;display:grid;gap:16px;min-width:0}.checkout-form label{display:grid;gap:7px;font-size:13px}.checkout-form input,.checkout-form select,.checkout-form textarea{font:inherit;width:100%;padding:12px;border:1px solid #ccd9d0;border-radius:var(--nova-radius,8px);background:var(--nova-background,#fff);color:inherit;box-sizing:border-box}.checkout-form button{width:100%}.checkout-back{background:transparent;border:0;padding:15px;cursor:pointer;color:inherit}.checkout-error{background:#fff0ed;color:#9e2727!important;padding:12px;border-radius:8px}.checkout-success{text-align:center;padding:30px 0}.checkout-success>span{font-size:50px;color:var(--nova-primary)}.checkout-success>strong{font-size:25px}.checkout-privacy{font-size:11px!important;opacity:.8}
</style>
