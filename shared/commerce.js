export const orderStatuses={new:'Новый',confirmed:'Подтверждён',processing:'В работе',ready:'Готов к выдаче',shipped:'Передан в доставку',completed:'Выполнен',cancelled:'Отменён'}
export const orderTransitions={new:['confirmed','cancelled'],confirmed:['processing','cancelled'],processing:['ready','shipped','completed','cancelled'],ready:['completed','cancelled'],shipped:['completed'],completed:[],cancelled:[]}
export const deliveryMethods={pickup:'Самовывоз',delivery:'Доставка'}
export const orderNumber=id=>'N'+String(id).padStart(6,'0')
export function normalizePhone(value){
 if(typeof value!=='string'||value.length>40||!/^[+\d\s()\-]+$/.test(value))return ''
 let digits=value.replace(/\D/g,'');if(digits.length===10)digits='7'+digits;if(digits.length===11&&digits[0]==='8')digits='7'+digits.slice(1)
 return /^[1-9]\d{9,14}$/.test(digits)?'+'+digits:''
}
export const validEmail=value=>typeof value==='string'&&value.length<=254&&(value===''||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
export function validateCheckout(body){
 if(!body||typeof body!=='object'||typeof body.request_id!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.request_id||''))return 'Обновите форму оформления заказа'
 const c=body.customer,d=body.delivery
 if(!c||typeof c.name!=='string'||!c.name.trim()||c.name.length>150)return 'Укажите имя (до 150 символов)'
 if(!normalizePhone(c.phone))return 'Укажите телефон с кодом страны'
 if(!validEmail(c.email))return 'Проверьте электронную почту'
 if(!d||typeof d.method!=='string'||!Object.hasOwn(deliveryMethods,d.method)||typeof d.address!=='string'||d.address.length>1000||d.method==='delivery'&&!d.address.trim())return 'Укажите способ получения и адрес доставки'
 if(typeof body.comment!=='string'||body.comment.length>2000)return 'Комментарий: до 2000 символов'
 if(!Array.isArray(body.items)||!body.items.length||body.items.length>50)return 'В заказе должно быть от 1 до 50 позиций'
 if(d.option_id!==undefined&&(typeof d.option_id!=='string'||!/^[a-z][a-z0-9_-]{0,31}$/.test(d.option_id))||d.settings_revision!==undefined&&!Number.isInteger(d.settings_revision)||body.notifications_opt_in!==undefined&&typeof body.notifications_opt_in!=='boolean')return 'Проверьте способ доставки и уведомления'
 const keys=new Set()
 for(const item of body.items){
  if(!item||!Number.isSafeInteger(item.product_id)||item.product_id<=0||typeof item.variant_name!=='string'||item.variant_name.length>120||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)return 'Количество каждой позиции: от 1 до 100'
  const key=JSON.stringify([item.product_id,item.variant_name]);if(keys.has(key))return 'Объедините одинаковые позиции';keys.add(key)
 }
 return null
}
