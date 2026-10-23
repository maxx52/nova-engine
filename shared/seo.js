export const defaultSeo=()=>({title:'',description:'',canonical_path:'',image_url:'',noindex:false,nofollow:false})
export function seoPath(value){
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//'))return null
 let decoded;try{decoded=decodeURIComponent(value)}catch{return null}
 if(/[\s\\?#%\u0000-\u001f\u007f]/u.test(decoded)||decoded.includes('//')||decoded.split('/').some(s=>s==='.'||s==='..'))return null
 const result=encodeURI(decoded).replace(/\/+$/,'')||'/';return result.length<=2000?result:null
}
export function protectedSeoPath(path){return /^\/(api|admin|assets|uploads)(\/|$)|^\/(health|robots\.txt|sitemap(?:-\d+)?\.xml)$|^\/\./i.test(path)}
export function validateSeo(value){
 if(value===undefined)return null
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(defaultSeo(),k)))return 'Некорректные SEO-поля'
 for(const [k,max] of [['title',200],['description',500],['canonical_path',2000],['image_url',200]])if(value[k]!==undefined&&(typeof value[k]!=='string'||value[k].length>max||/[\u0000-\u001f\u007f]/.test(value[k])))return 'Некорректное SEO-поле: '+k
 for(const k of ['noindex','nofollow'])if(value[k]!==undefined&&typeof value[k]!=='boolean')return 'Некорректный параметр индексации'
 if(value.canonical_path&&(!seoPath(value.canonical_path)||protectedSeoPath(seoPath(value.canonical_path))))return 'Canonical: укажите внутренний адрес страницы без query-параметров'
 if(value.image_url&&!/^\/uploads\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(value.image_url))return 'Выберите изображение из медиатеки'
 return null
}
export function normalizedSeo(value){const result={...defaultSeo(),...(value||{})};if(result.canonical_path)result.canonical_path=seoPath(result.canonical_path);return result}
export function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')}
export function jsonLd(value){return JSON.stringify(value).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')}
