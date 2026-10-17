import {safeLink} from './contentSafety.js'
export const formFieldTypes={text:'Текст',email:'Email',tel:'Телефон',textarea:'Сообщение',checkbox:'Флажок'}
export const deliveryStates={queued:'В очереди',sending:'Отправляется',sent:'Принято сервисом',partial:'Принято не всеми адресатами',failed:'Ошибка',uncertain:'Результат неизвестен'}
export const defaultForm={title:'Обратная связь',description:'Оставьте сообщение — мы свяжемся с вами.',enabled:false,channels:['email'],button:'Отправить',success:'Сообщение принято. Мы свяжемся с вами.',consent_label:'Согласен на обработку указанных данных для ответа на обращение',privacy_url:'',fields:[{key:'name',label:'Ваше имя',type:'text',required:true},{key:'email',label:'Электронная почта',type:'email',required:true},{key:'message',label:'Сообщение',type:'textarea',required:true}]}
export const defaultFormSettings={enabled:false,revision:1,retention_days:90,email:{enabled:false,mode:'smtp',host:'',port:465,tls:'implicit',user:'',from:'',to:[]},telegram:{enabled:false,chat_id:''}}
export const emailAddress=v=>typeof v==='string'&&v.length<=254&&!/[\s\x00-\x1f\x7f]/.test(v)&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(v)
export const formId=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
export function validateForm(b){
 if(!b||typeof b.enabled!=='boolean'||!Array.isArray(b.channels)||!b.channels.length||b.channels.length>2||new Set(b.channels).size!==b.channels.length||b.channels.some(c=>!['email','telegram'].includes(c)))return 'Выберите email и/или Telegram'
 for(const [key,max]of [['title',150],['description',2000],['button',100],['success',1000],['consent_label',1000],['privacy_url',2000]])if(typeof b[key]!=='string'||b[key].length>max||key!=='description'&&key!=='privacy_url'&&!b[key].trim())return 'Проверьте тексты формы: '+key
 if(/[\r\n\x00-\x1f\x7f]/.test(b.title+b.button))return 'Название и кнопка должны быть однострочными'
 if(!safeLink(b.privacy_url))return 'Некорректная ссылка на политику обработки данных'
 if(!Array.isArray(b.fields)||!b.fields.length||b.fields.length>10)return 'В форме должно быть от 1 до 10 полей'
 const keys=new Set()
 for(const f of b.fields){if(!f||typeof f.key!=='string'||!/^[a-z][a-z0-9_]{0,39}$/.test(f.key)||['__proto__','constructor','prototype'].includes(f.key)||keys.has(f.key)||typeof f.label!=='string'||!f.label.trim()||f.label.length>100||!Object.hasOwn(formFieldTypes,f.type)||typeof f.required!=='boolean')return 'Проверьте ключи, подписи и типы полей';keys.add(f.key)}
 return null
}
export function cleanForm(b){return {title:b.title.trim(),description:b.description,enabled:b.enabled,channels:b.channels,button:b.button,success:b.success,consent_label:b.consent_label,privacy_url:b.privacy_url,fields:b.fields.map(f=>({key:f.key,label:f.label.trim(),type:f.type,required:f.required}))}}
export function validateFormSettings(b){
 if(!b||typeof b.enabled!=='boolean'||!Number.isInteger(b.revision)||b.revision<1||!Number.isInteger(b.retention_days)||b.retention_days<30||b.retention_days>365)return 'Проверьте версию настроек и срок хранения (30–365 дней)'
 const e=b.email,t=b.telegram
 if(!e||!t||typeof e.enabled!=='boolean'||typeof t.enabled!=='boolean'||!['smtp','1gb'].includes(e.mode)||typeof e.host!=='string'||e.host.length>253||typeof e.user!=='string'||e.user.length>254||/[\r\n\x00]/.test(e.user)||typeof e.from!=='string'||!Array.isArray(e.to)||e.to.length>5||e.to.some(x=>!emailAddress(x))||new Set(e.to).size!==e.to.length)return 'Проверьте параметры почты и до 5 получателей'
 if(e.from&&!emailAddress(e.from))return 'Отправитель — только адрес email, без имени и угловых скобок'
 if(e.mode==='1gb'){if(e.host!=='robots.1gb.ru'||e.port!==25||e.tls!=='relay'||e.user!=='')return 'Профиль 1Gb.ru: robots.1gb.ru, порт 25, без авторизации'}
 else if(![465,587,2525,25,925].includes(e.port)||!['implicit','starttls'].includes(e.tls)||e.host&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(e.host)||/(^|\.)(localhost|local|internal|invalid|test)$/.test(e.host))return 'SMTP: публичное имя сервера, допустимый порт и TLS / STARTTLS'
 if(typeof t.chat_id!=='string'||t.chat_id!==''&&!/^(?:-?[1-9][0-9]{0,19}|@[a-zA-Z][a-zA-Z0-9_]{4,31})$/.test(t.chat_id))return 'Укажите числовой chat_id или @имя канала'
 for(const key of ['smtp_password','bot_token'])if(b[key]!==undefined&&(typeof b[key]!=='string'||b[key].length>1000||/[\r\n\x00]/.test(b[key])))return 'Некорректный секрет'
 if(b.bot_token&&!/^[1-9][0-9]{4,19}:[a-zA-Z0-9_-]{20,100}$/.test(b.bot_token))return 'Некорректный токен Telegram-бота'
 for(const key of ['clear_smtp_password','clear_bot_token'])if(b[key]!==undefined&&typeof b[key]!=='boolean')return 'Некорректный сброс секрета'
 return null
}
export function formChannelsReady(s,secrets,channels){return s.enabled&&channels.every(c=>c==='email'?s.email.enabled&&s.email.host&&emailAddress(s.email.from)&&s.email.to.length&&(s.email.mode==='1gb'||s.email.user&&secrets.smtp_password):s.telegram.enabled&&s.telegram.chat_id&&secrets.bot_token)}
export function validateFormValues(config,body){
 if(!body||!formId(body.request_id)||body.consent!==true||typeof body.website!=='string'||body.website.length>500||!body.values||typeof body.values!=='object'||Array.isArray(body.values))return 'Проверьте форму и согласие на обработку данных'
 const allowed=new Set(config.fields.map(f=>f.key));if(Object.keys(body.values).some(k=>!allowed.has(k)))return 'Состав формы изменился. Обновите страницу.'
 let size=0
 for(const f of config.fields){const v=body.values[f.key];if(f.type==='checkbox'){if(typeof v!=='boolean'||f.required&&!v)return 'Заполните поле «'+f.label+'»';continue}if(typeof v!=='string'||v.length>3000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)||f.required&&!v.trim())return 'Проверьте поле «'+f.label+'» (до 3000 символов)';if(f.type==='email'&&v&&!emailAddress(v))return 'Проверьте email';if(f.type==='tel'&&v&&!/^[+\d\s()\-]{5,40}$/.test(v))return 'Проверьте телефон';size+=v.length}
 return size>16000?'Сообщение слишком длинное (до 16 000 символов)':null
}
