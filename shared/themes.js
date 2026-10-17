import {validateSections} from './pageSections.js'
import {formId} from './forms.js'
import {mediaUrl,safeLink} from './contentSafety.js'
export const THEME_API_VERSION=1
export const templateSlots={header:'Шапка',home:'Главная',catalog:'Каталог',product:'Товар',page:'Страница',blog:'Список статей',post:'Статья',footer:'Подвал'}
export const packageId=v=>typeof v==='string'&&/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v)&&v.length<=80&&!['constructor','prototype','__proto__'].includes(v)
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const keys=(o,allowed)=>object(o)&&Object.keys(o).every(k=>allowed.includes(k))
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length
export const emptyTheme=()=>({manifest:{id:'my-theme',name:'Моя тема',version:'1.0.0',description:'',author:'',license:'MIT'},settings_schema:[],settings:{},templates:{}})
export function validateManifest(m){
 if(!keys(m,['id','name','version','description','author','license'])||!packageId(m.id)||typeof m.version!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9.-]{1,40})?$/.test(m.version))return 'Некорректные ID или версия пакета'
 for(const [k,max]of [['name',150],['description',2000],['author',150],['license',100]])if(typeof m[k]!=='string'||m[k].length>max||k==='name'&&!m[k].trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(m[k]))return 'Некорректное поле manifest: '+k
 return null
}
function settingValue(f,v){
 if(f.type==='checkbox')return typeof v==='boolean'
 if(typeof v!=='string')return false
 if(f.type==='text')return v.length<=3000
 if(f.type==='color')return /^#[a-f0-9]{6}$/i.test(v)
 if(f.type==='select')return f.options.some(o=>o.value===v)
 if(f.type==='form')return v===''||formId(v)
 if(f.type==='image')return v===''||!!mediaUrl(v)
 return false
}
export function validateSettingsSchema(schema,values){
 if(!Array.isArray(schema)||schema.length>20||!object(values))return 'До 20 настроек темы'
 const seen=new Set()
 for(const f of schema){
  if(!keys(f,['id','label','type','default','options'])||!packageId(f.id)||seen.has(f.id)||typeof f.label!=='string'||!f.label.trim()||f.label.length>150||!['text','color','checkbox','select','form','image'].includes(f.type))return 'Некорректная настройка темы'
  seen.add(f.id)
  if(f.type==='select'&&(!Array.isArray(f.options)||!f.options.length||f.options.length>20||f.options.some(o=>!keys(o,['value','label'])||typeof o.value!=='string'||!o.value||o.value.length>80||typeof o.label!=='string'||!o.label||o.label.length>150)||new Set(f.options.map(o=>o.value)).size!==f.options.length))return 'Некорректные варианты настройки'
  if(!settingValue(f,f.default)||!Object.hasOwn(values,f.id)||!settingValue(f,values[f.id]))return 'Некорректное значение настройки: '+f.id
 }
 return Object.keys(values).some(k=>!seen.has(k))?'Неизвестная настройка темы':null
}
export function validateTemplateCode(templates){
 if(!object(templates)||Object.keys(templates).some(k=>!Object.hasOwn(templateSlots,k)))return 'Неизвестное место шаблона'
 let size=0
 for(const [name,code]of Object.entries(templates)){
  if(!keys(code,['html','css','js'])||['html','css','js'].some(k=>typeof code[k]!=='string'||code[k].length>50000))return 'HTML/CSS/JS шаблона до 50 000 символов: '+name
  size+=code.html.length+code.css.length+code.js.length
 }
 return size>350000?'Суммарный код шаблонов до 350 000 символов':null
}
export function validateActiveTheme(t){
 if(t===null)return null
 if(!keys(t,['manifest','settings_schema','settings','templates']))return 'Некорректная тема'
 return validateManifest(t.manifest)||validateSettingsSchema(t.settings_schema,t.settings)||validateTemplateCode(t.templates)
}
export function validateThemeStyle(s){
 if(!keys(s,['colors','font','radius','width','visibility','home_order','site_css']))return 'Неизвестное поле стиля темы'
 if(s.colors!==undefined&&(!keys(s.colors,['primary','accent','background','text','hero','footer'])||Object.values(s.colors).some(v=>typeof v!=='string'||!/^#[a-f0-9]{6}$/i.test(v))))return 'Цвета темы — #RRGGBB'
 if(s.font!==undefined&&!['Manrope','Arial','Georgia','Verdana'].includes(s.font))return 'Некорректный шрифт темы'
 if(s.radius!==undefined&&(!Number.isInteger(s.radius)||s.radius<0||s.radius>32)||s.width!==undefined&&(!Number.isInteger(s.width)||s.width<900||s.width>1600))return 'Некорректная ширина или скругление темы'
 if(s.visibility!==undefined&&(!keys(s.visibility,['announcement','header','hero','advantages','catalog','footer','year','floating'])||Object.values(s.visibility).some(v=>typeof v!=='boolean')))return 'Некорректная видимость разделов'
 if(s.home_order!==undefined&&(!Array.isArray(s.home_order)||s.home_order.length!==3||new Set(s.home_order).size!==3||s.home_order.some(x=>!['hero','advantages','catalog'].includes(x))))return 'Некорректный порядок разделов'
 if(s.site_css!==undefined&&(typeof s.site_css!=='string'||s.site_css.length>100000))return 'site.css до 100 000 символов'
 return null
}
export function validatePackage(p){
 if(!object(p)||!['nova-theme','nova-template'].includes(p.format)||p.apiVersion!==THEME_API_VERSION)return 'Поддерживаются nova-theme / nova-template, apiVersion: 1'
 if(bytes(p)>512*1024)return 'Пакет не должен превышать 512 КиБ UTF-8'
 const error=validateManifest(p.manifest);if(error)return error
 if(p.format==='nova-theme'){
  if(!keys(p,['format','apiVersion','manifest','style','settings_schema','templates']))return 'Неизвестное поле пакета темы'
  if(!Array.isArray(p.settings_schema))return 'Укажите settings_schema'
  // Portable packages must not carry database-specific media/form IDs as defaults.
  if(p.settings_schema.some(f=>['image','form'].includes(f?.type)&&f.default!==''))return 'Начальное значение image/form в пакете должно быть пустым'
  const defaults=Object.fromEntries(p.settings_schema.map(f=>[f?.id,f?.default]))
  return validateThemeStyle(p.style)||validateSettingsSchema(p.settings_schema,defaults)||validateTemplateCode(p.templates)
 }
 if(!keys(p,['format','apiVersion','manifest','page'])||!keys(p.page,['title','content','sections'])||typeof p.page.title!=='string'||!p.page.title.trim()||p.page.title.length>150||typeof p.page.content!=='string'||p.page.content.length>100000||!Array.isArray(p.page.sections))return 'Некорректный шаблон страницы'
 // Empty form_id is a deliberate binding placeholder, resolved by the page owner before saving.
 const sections=p.page.sections.map(s=>s?.type==='form'&&s.form_id===''?{...s,form_id:'00000000-0000-4000-8000-000000000000'}:s)
 if(p.page.sections.some(s=>s?.type==='form'&&s.form_id!==''||s?.image_url&&s.image_url!==''))return 'Шаблон не должен содержать ID форм или изображений другого сайта'
 return validateSections(sections)
}
export function activeThemeFromPackage(p){return {manifest:structuredClone(p.manifest),settings_schema:structuredClone(p.settings_schema),settings:Object.fromEntries(p.settings_schema.map(f=>[f.id,f.default])),templates:structuredClone(p.templates)}}
export function publicNavigation(value){
 if(typeof value!=='string'||!value||!value.startsWith('/')||!safeLink(value))return false
 try{const path=decodeURIComponent(new URL(value,'https://nova.invalid').pathname);return !path.startsWith('//')&&!/^\/(api|admin|uploads)(\/|$)/i.test(path)&&!/[\\\x00-\x1f]/.test(path)}catch{return false}
}
export function validateThemeAction(action,payload){
 if(action==='cart.open')return payload===null||payload===undefined||object(payload)&&Object.keys(payload).length===0?null:'Некорректное действие корзины'
 if(action==='cart.add')return keys(payload,['product_id','variant_name','quantity'])&&Number.isSafeInteger(payload.product_id)&&payload.product_id>0&&typeof payload.variant_name==='string'&&payload.variant_name.length<=120&&Number.isInteger(payload.quantity)&&payload.quantity>=1&&payload.quantity<=100?null:'Проверьте ID товара, вариант и количество'
 if(action==='forms.open')return keys(payload,['form_id'])&&formId(payload.form_id)?null:'Некорректная форма'
 return 'Недоступное действие темы'
}
