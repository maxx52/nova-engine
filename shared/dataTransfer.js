export const transferKinds={products:'Товары',customers:'Покупатели',pages:'Страницы',posts:'Статьи блога'}
export const transferFields={products:['name','category','price','description','sku','stock','image_url','published','images','attributes','variants','seo'],customers:['name','phone','email','note'],pages:['title','slug','content','published','sections','seo'],posts:['title','slug','excerpt','content','category','tags','cover_url','published','published_at','seo']}
// RFC 4180 quoting, BOM, CRLF and semicolon tables from Russian spreadsheet tools.
export function parseCsv(text){
 text=text.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/,1)[0],delimiter=first.includes(';')?';':','
 let rows=[],row=[],field='',quoted=false,closed=false
 for(let i=0;i<=text.length;i++){const c=text[i];if(quoted){if(c===undefined)throw Error('CSV: незакрытая кавычка');if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
  if(c==='"'){if(field||closed)throw Error('CSV: кавычка внутри неэкранированного поля');quoted=true;continue}
  if(c===delimiter||c==='\n'||c==='\r'||c===undefined){row.push(field);field='';closed=false;if(c!==delimiter){if(row.some(v=>v!==''))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++}continue}
  if(closed)throw Error('CSV: лишние символы после кавычки');field+=c
 }
 if(rows.length<2)throw Error('CSV: нужны заголовок и строки данных');const headers=rows.shift();if(headers.some(h=>!h||! /^[a-z_]+$/.test(h))||new Set(headers).size!==headers.length)throw Error('CSV: некорректные или повторяющиеся заголовки')
 return rows.map((r,i)=>{if(r.length!==headers.length)throw Error('CSV: неверное число столбцов в строке '+(i+2));return Object.fromEntries(headers.map((h,j)=>[h,r[j]]))})
}
export function readTransfer({kind,format,text}){
 if(!Object.hasOwn(transferKinds,kind)||!['json','csv'].includes(format)||typeof text!=='string'||new TextEncoder().encode(text).length>4000000)throw Error('Выберите тип данных и файл до 4 МБ')
 let records;if(format==='csv'){if(!['products','customers'].includes(kind))throw Error('Для контента используйте JSON');records=parseCsv(text);for(const r of records){for(const key of ['price','stock'])if(Object.hasOwn(r,key)){const value=r[key].replace(',','.');if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))throw Error('CSV: неверное число в поле '+key);r[key]=Number(value)}if(Object.hasOwn(r,'published')){if(!['true','false','1','0'].includes(r.published))throw Error('CSV: published должен быть true/false или 1/0');r.published=['true','1'].includes(r.published)}for(const key of ['images','attributes','variants','seo'])if(Object.hasOwn(r,key)){try{r[key]=JSON.parse(r[key])}catch{throw Error('CSV: поле '+key+' должно содержать JSON')}}}}
 else{let file;try{file=JSON.parse(text.replace(/^\uFEFF/,''))}catch{throw Error('Некорректный JSON')};if(!file||file.format!=='nova-data'||file.version!==1||file.kind!==kind)throw Error('Ожидается JSON NOVA, версия 1, с выбранным типом данных');records=file.records}
 if(!Array.isArray(records)||!records.length||records.length>500)throw Error('В одном импорте должно быть от 1 до 500 записей')
 return records
}
export function transferFile(kind,records){return {format:'nova-data',version:1,kind,records}}
