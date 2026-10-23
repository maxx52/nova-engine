<script setup>
import {ref,watch,onMounted,onBeforeUnmount} from 'vue'
const props=defineProps({page:Object})
const frame=ref(null),width=ref(390),runCode=ref(false),ready=ref(false)
let timer
function send(){if(!ready.value)return;frame.value?.contentWindow?.postMessage({type:'nova:page-preview',page:JSON.parse(JSON.stringify({title:props.page.title,content:props.page.content,sections:props.page.sections})),runCode:runCode.value},location.origin)}
function message(e){if(e.source===frame.value?.contentWindow&&e.origin===location.origin&&e.data?.type==='nova:page-preview-ready'){ready.value=true;send()}}
watch(()=>[props.page,runCode.value],()=>{clearTimeout(timer);timer=setTimeout(send,180)},{deep:true})
onMounted(()=>addEventListener('message',message));onBeforeUnmount(()=>{clearTimeout(timer);removeEventListener('message',message)})
</script>
<template><section class="page-preview"><h3>Предпросмотр без публикации</h3><div class="preview-tools"><label>Ширина<select v-model.number="width" aria-label="Ширина предпросмотра"><option :value="390">Телефон · 390 px</option><option :value="768">Планшет · 768 px</option><option :value="1280">Компьютер · 1280 px</option></select></label><label><input v-model="runCode" type="checkbox"> Выполнить код секций в изоляции</label></div><p>Показаны текущие заголовок, текст и блоки с оформлением сайта. Шапка, подвал и шаблон темы сюда не включены. Формы и ссылки не выполняют действий.</p><div class="preview-scroll"><iframe ref="frame" title="Предпросмотр страницы" src="/api/admin/pages/preview-frame" :style="{width:width+'px'}"></iframe></div></section></template>
<style scoped>.page-preview{min-width:0;background:#eef3f1;padding:16px;border-radius:12px}.preview-tools{display:flex;gap:15px;flex-wrap:wrap;align-items:center}.preview-tools label{font-size:12px}.preview-tools label:has([type=checkbox]){flex-direction:row;align-items:center}.preview-scroll{overflow:auto;max-width:100%;margin-top:15px}iframe{display:block;height:650px;border:1px solid #ccd9d0;background:#fff;margin:auto;max-width:none}.page-preview p{font-size:12px;line-height:1.6}.page-preview h3{margin:0 0 15px}</style>
