export const fulfillmentDefaults=()=>({options:[{id:'pickup',title:'Самовывоз',kind:'pickup',description:'',price_cents:0,free_from_cents:null},{id:'delivery',title:'Доставка',kind:'delivery',description:'Стоимость доставки включена',price_cents:0,free_from_cents:null}],notifications:{customer_email:false,store_email:false,store_telegram:false},auto_confirm_paid:false})
export function validateFulfillment(c){
 if(!c||!Array.isArray(c.options)||!c.options.length||c.options.length>20||typeof c.auto_confirm_paid!=='boolean')return 'Добавьте от 1 до 20 способов получения'
 const ids=new Set()
 for(const o of c.options){if(!o||typeof o.id!=='string'||!/^[a-z][a-z0-9_-]{0,31}$/.test(o.id)||ids.has(o.id)||typeof o.title!=='string'||!o.title.trim()||o.title.length>120||/[\r\n\x00-\x1f]/.test(o.title)||!['pickup','delivery'].includes(o.kind)||typeof o.description!=='string'||o.description.length>1000||!Number.isSafeInteger(o.price_cents)||o.price_cents<0||o.price_cents>100000000||o.free_from_cents!==null&&(!Number.isSafeInteger(o.free_from_cents)||o.free_from_cents<0||o.free_from_cents>10000000000))return 'Проверьте идентификатор, название и стоимость доставки';ids.add(o.id)}
 for(const k of ['customer_email','store_email','store_telegram'])if(typeof c.notifications?.[k]!=='boolean')return 'Проверьте уведомления'
 return null
}
export function shippingPrice(option,subtotal){return option.free_from_cents!==null&&subtotal>=option.free_from_cents?0:option.price_cents}
export function trackingLink(value){if(value==='')return true;if(typeof value!=='string'||value.length>2000)return false;try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(u.hostname)&&!/(^|\.)(localhost|local|internal|invalid|test)$/.test(u.hostname)}catch{return false}}
