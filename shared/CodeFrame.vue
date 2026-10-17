<script setup>
import {safeLink} from './contentSafety.js'
import {ref,onMounted,onBeforeUnmount} from 'vue'
const props=defineProps({code:{type:Object,required:true},data:{type:Object,default:()=>({})},navigation:{type:Boolean,default:false},title:{type:String,default:'Пользовательский блок'}})
const emit=defineEmits(['error'])
const frame=ref(null),height=ref(420),key=crypto.randomUUID()
let sent=false
function send(){if(sent)return;sent=true;frame.value?.contentWindow?.postMessage({type:'nova:render',key,html:props.code.html,css:props.code.css,js:props.code.js,data:JSON.parse(JSON.stringify(props.data))},'*')}
let scheduled=false
function message(event){
 if(event.source!==frame.value?.contentWindow||event.origin!=='null'||event.data?.key!==key)return
 if(event.data.type==='nova:navigate'&&props.navigation&&typeof event.data.href==='string'&&event.data.href.startsWith('/')&&safeLink(event.data.href)&&!/^\/(api|admin|uploads)(\/|$)/.test(event.data.href)){location.assign(event.data.href);return}
 if(event.data.type==='nova:error'&&typeof event.data.message==='string')emit('error',event.data.message.slice(0,500))
 if(event.data.type==='nova:height'&&Number.isFinite(event.data.height)&&!scheduled){scheduled=true;const next=Math.max(120,Math.min(3000,event.data.height));requestAnimationFrame(()=>{height.value=next;scheduled=false})}
}
onMounted(()=>addEventListener('message',message));onBeforeUnmount(()=>removeEventListener('message',message))
</script>
<template><iframe ref="frame" src="/api/code-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" :title="title" :style="{height:height+'px'}" class="nova-code-frame" @load="send"></iframe></template>
<style scoped>.nova-code-frame{display:block;width:100%;border:0;background:transparent;min-height:120px;}</style>
