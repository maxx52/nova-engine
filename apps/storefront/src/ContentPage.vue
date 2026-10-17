<script setup>
import ThemeSlot from '../../../shared/ThemeSlot.vue'
import {defaultTexts} from '../../../shared/siteDesign.js'
import { ref, watch } from 'vue'
import PageSections from './PageSections.vue'
const props = defineProps({ design:Object,actions:Function,templateName:{type:String,default:'page'}, siteData:{type:Object,default:()=>({})}, texts:{type:Object,default:()=>defaultTexts}, path: String, siteName: {type:String,default:'NOVA'} })
const page = ref(null), loading = ref(false), error = ref('')
let version = 0
watch(() => props.path, async path => {
  const current = ++version
  page.value = null; error.value = ''; loading.value = true
  try {
    const slug = path.replace(/^\//, '').replace(/\/$/, '')
    const response = await fetch('/api/pages/' + encodeURIComponent(slug))
    if (!response.ok) throw Error(response.status === 404 ? 'Страница не найдена' : 'Не удалось загрузить страницу')
    const data = await response.json()
    if (current === version) { page.value = data; document.title = data.title + ' — ' + props.siteName }
  } catch (e) { if (current === version) { error.value = e.message; document.title = 'NOVA — ' + e.message } }
  finally { if (current === version) loading.value = false }
}, { immediate: true })
</script>
<template>
  <main class="container content-page">
    <p v-if="loading" role="status">{{texts.page_loading}}</p>
    <template v-else-if="error"><h1>{{ error }}</h1><a href="/">{{texts.home_link}}</a></template>
    <article v-else-if="page"><ThemeSlot :name="design?.theme?.templates?.[templateName]?templateName:'page'" :design="design" :actions="actions" :data="{...siteData,context:{...siteData.context,page}}"><h1>{{ page.title }}</h1><div class="page-text">{{ page.content }}</div></ThemeSlot><PageSections :sections="page.sections || []" :site-data="siteData" /></article>
  </main>
</template>
<style scoped>
.content-page { padding-top: 64px; padding-bottom: 96px; min-height: 65vh; max-width: 900px; }
h1 { font-size: clamp(30px, 5vw, 52px); line-height: 1.2; margin-bottom: 32px; overflow-wrap: anywhere; }
.page-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 18px; line-height: 1.8; }
</style>
