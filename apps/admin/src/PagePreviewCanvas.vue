<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue'
import PageSections from '../../storefront/src/PageSections.vue'
const page=ref({title:'',content:'',sections:[]}),design=ref({}),runCode=ref(false)
function message(e){if(e.source!==parent||e.origin!==location.origin||e.data?.type!=='nova:page-preview'||typeof e.data.page?.title!=='string'||typeof e.data.page?.content!=='string'||!Array.isArray(e.data.page?.sections))return;page.value=e.data.page;runCode.value=e.data.runCode===true}
function blockNavigation(e){if(e.target.closest('a'))e.preventDefault()}
onMounted(async()=>{addEventListener('message',message);document.addEventListener('click',blockNavigation,true);parent.postMessage({type:'nova:page-preview-ready'},location.origin);try{const r=await fetch('/api/design',{credentials:'omit'});if(r.ok){design.value=await r.json();for(const [key,value]of Object.entries(design.value.colors||{}))if(/^[a-z]+$/.test(key)&&/^#[a-f0-9]{6}$/i.test(value))document.documentElement.style.setProperty('--nova-'+key,value);if(['Manrope','Arial','Georgia','Verdana'].includes(design.value.font))document.body.style.fontFamily=design.value.font+',sans-serif'}}catch{}})
onBeforeUnmount(()=>{removeEventListener('message',message);document.removeEventListener('click',blockNavigation,true)})
</script>
<template><main class="preview-page"><h1>{{page.title}}</h1><div class="intro">{{page.content}}</div><PageSections :sections="page.sections" :preview="true" :run-code="runCode" :site-data="{settings:{name:'Предпросмотр'},products:[],design,route:{path:'/',search:''}}"/></main></template>
<style scoped>.preview-page{max-width:900px;margin:auto;padding:32px 20px;background:var(--nova-background,#fff);color:var(--nova-text,#19372b);min-height:100vh}.preview-page h1{font-size:clamp(30px,5vw,52px);overflow-wrap:anywhere;line-height:1.2;margin:0 0 32px}.intro{white-space:pre-wrap;overflow-wrap:anywhere;font-size:18px;line-height:1.8}</style>
