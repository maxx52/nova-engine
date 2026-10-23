// Public widget code only: never put provider passwords, API secrets or signing keys here.
export const paymentProviders = [
 {id:'yookassa',name:'ЮKassa',url:'https://yookassa.ru/developers',hint:'Готовая форма из личного кабинета или платёжная ссылка. API требует отдельного серверного адаптера.',origins:['https://yookassa.ru','https://yoomoney.ru']},
 {id:'tbank',name:'Т-Банк',url:'https://developer.tbank.ru/eacq/intro/developer/setup_js',hint:'Готовая форма / ссылка из кабинета интернет-эквайринга. Подписанные параметры формируются на сервере банка или отдельным адаптером.',origins:['https://integrationjs.t-static.ru']},
 {id:'cloudpayments',name:'CloudPayments',url:'https://developers.cloudpayments.ru/',hint:'Публичный код виджета с Public ID. API Secret нельзя размещать в виджете.',origins:['https://widget.cloudpayments.ru']},
 {id:'robokassa',name:'Robokassa',url:'https://docs.robokassa.ru/ru/iframe.html',hint:'Кнопка, ссылка или iframe. Подпись привязана к сумме и номеру счёта: готовая подпись не подходит для другого заказа.',origins:['https://auth.robokassa.ru']},
 {id:'paykeeper',name:'PayKeeper',url:'https://docs.paykeeper.ru/metody-integratsii/iframe/',hint:'Ссылка, HTML-форма или iframe. Добавьте точный HTTPS-домен вашего платёжного сервера из кабинета PayKeeper.',origins:[]},
 {id:'other',name:'Другой сервис',url:'',hint:'Используйте публичную форму, выданную вашим платёжным сервисом.',origins:[]}
]
export const paymentStates={unpaid:'Не подтверждена',paid:'Оплата подтверждена',refunded:'Возврат подтверждён'}
export const defaultPayments={enabled:false,provider:'yookassa',mode:'link',title:'Оплата заказа',instructions:'Укажите номер заказа при оплате. Подтверждение поступления проверяет менеджер.',link:'',code:'',origins:[],revision:1}
export function validPaymentOrigin(value,siteOrigins=[]){
 if(typeof value!=='string'||value.length>250)return false
 try{
  const u=new URL(value),host=u.hostname
  // Exact public HTTPS origins only. No IPs, wildcards, credentials or same-site access.
  return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password&&!u.port&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)&&!/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)&&!siteOrigins.some(s=>new URL(s).hostname===host)
 }catch{return false}
}
export function validatePayments(b,siteOrigins=[]){
 if(!b||typeof b.enabled!=='boolean'||!paymentProviders.some(p=>p.id===b.provider)||!['link','widget'].includes(b.mode))return 'Выберите сервис и способ подключения'
 if(!Number.isInteger(b.revision)||b.revision<1)return 'Обновите настройки перед сохранением'
 if(typeof b.title!=='string'||!b.title.trim()||b.title.length>150||typeof b.instructions!=='string'||b.instructions.length>3000)return 'Название до 150 и инструкция до 3000 символов'
 if(typeof b.code!=='string'||b.code.length>100000||typeof b.link!=='string'||b.link.length>2000)return 'Код до 100 000 символов; ссылка до 2000 символов'
 if(!Array.isArray(b.origins)||b.origins.length>20||new Set(b.origins).size!==b.origins.length||b.origins.some(x=>!validPaymentOrigin(x,siteOrigins)))return 'Разрешены до 20 уникальных HTTPS-источников без пути, IP-адресов и домена самого сайта'
 if(b.link){try{const u=new URL(b.link);if(!validPaymentOrigin(u.origin,siteOrigins)||u.username||u.password||!b.origins.includes(u.origin))return 'Добавьте HTTPS-домен платёжной ссылки в разрешённые источники'}catch{return 'Некорректная платёжная ссылка'}}
 if(b.enabled&&b.mode==='link'&&!b.link)return 'Укажите платёжную ссылку'
 if(b.enabled&&b.mode==='widget'&&!b.code.trim())return 'Вставьте публичный HTML/JavaScript-код виджета'
 return null
}
const escapeAttr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')
export function paymentDocument(config,order){
 const origins=config.origins.filter(x=>validPaymentOrigin(x)).join(' ')
 const sources=origins||"'none'"
 const policy=["default-src 'none'",`script-src 'unsafe-inline' ${origins}`,`style-src 'unsafe-inline' ${origins}`,`img-src data: ${origins}`,`font-src data: ${origins}`,`connect-src ${sources}`,`frame-src ${sources}`,`form-action ${sources}`,"base-uri 'none'","object-src 'none'"].join('; ')
 const context=JSON.stringify({order_number:order.number,amount:(order.total_cents/100).toFixed(2),amount_cents:order.total_cents,currency:'RUB'}).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="'+escapeAttr(policy)+'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;font:14px system-ui;color:#172f27;overflow-wrap:anywhere}*{box-sizing:border-box}iframe{max-width:100%}</style><script>Object.defineProperty(window,"NOVA_PAYMENT",{value:Object.freeze('+context+'),writable:false,configurable:false})</script></head><body>'+config.code+'</body></html>'
}
