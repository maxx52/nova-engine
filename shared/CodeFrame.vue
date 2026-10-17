<script setup>
import {safeLink,publicDataPath} from './contentSafety.js'
import {ref,onMounted,onBeforeUnmount} from 'vue'
const props=defineProps({code:{type:Object,required:true},data:{type:Object,default:()=>({})},navigation:{type:Boolean,default:false},title:{type:String,default:'Пользовательский блок'}})
const emit=defineEmits(['error'])
async function boundedJson(response){
 if(Number(response.headers.get('content-length'))>2000000)throw Error('Слишком большой ответ')
 const reader=response.body.getReader(),chunks=[];let size=0
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('Слишком большой ответ')}chunks.push(value)}}finally{reader.releaseLock()}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length}
 return JSON.parse(new TextDecoder().decode(data))
}
const frame=ref(null),height=ref(420),key=crypto.randomUUID()
let sent=false
function send(){if(sent)return;sent=true;frame.value?.contentWindow?.postMessage({type:'nova:render',key,html:props.code.html,css:props.code.css,js:props.code.js,data:JSON.parse(JSON.stringify(props.data))},'*')}
let scheduled=false,activeRequests=0
const seenRequests=new Set()
function message(event){
 if(event.source!==frame.value?.contentWindow||event.origin!=='null'||event.data?.key!==key)return
 if(event.data.type==='nova:data'){
  const {id,path}=event.data
  if(!Number.isInteger(id)||id<1||id>100||seenRequests.has(id))return
  seenRequests.add(id)
  const respond=value=>frame.value?.contentWindow?.postMessage({type:'nova:data-result',key,id,...value},'*')
  if(!props.navigation||!publicDataPath(path)){respond({error:'Разрешено только чтение публичного API на сайте'});return}
  if(activeRequests>=3){respond({error:'Слишком много одновременных запросов'});return}
  activeRequests++
  fetch(path,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)}).then(async response=>{
   if(!response.ok)throw Error('Не удалось загрузить публичные данные ('+response.status+')')
   respond({data:await boundedJson(response)})
  }).catch(()=>respond({error:'Публичные данные недоступны. Повторите запрос позже.'})).finally(()=>activeRequests--)
  return
 }
 if(event.data.type==='nova:navigate'&&props.navigation&&typeof event.data.href==='string'&&event.data.href.startsWith('/')&&safeLink(event.data.href)&&!/^\/(api|admin|uploads)(\/|$)/.test(event.data.href)){location.assign(event.data.href);return}
 if(event.data.type==='nova:error'&&typeof event.data.message==='string')emit('error',event.data.message.slice(0,500))
 if(event.data.type==='nova:height'&&Number.isFinite(event.data.height)&&!scheduled){scheduled=true;const next=Math.max(120,Math.min(3000,event.data.height));requestAnimationFrame(()=>{height.value=next;scheduled=false})}
}
onMounted(()=>addEventListener('message',message));onBeforeUnmount(()=>removeEventListener('message',message))
</script>
<template><iframe ref="frame" src="/api/code-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" :title="title" :style="{height:height+'px'}" class="nova-code-frame" @load="send"></iframe></template>
<style scoped>.nova-code-frame{display:block;width:100%;border:0;background:transparent;min-height:120px;}</style>
