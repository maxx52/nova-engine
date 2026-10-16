<script setup>
import { ref } from 'vue'
const emit = defineEmits(['uploading'])
const sections = defineModel({ default: () => [] })
defineProps({ disabled: Boolean })
const uploading = ref(false), error = ref('')
const names = { hero: 'Обложка', text: 'Текст', image: 'Изображение' }
function add(type) {
  if (sections.value.length >= 50) return
  sections.value.push({ id: crypto.randomUUID(), type, title: '', text: '', image_url: '', alt: '', caption: '', button_text: '', button_url: '' })
}
function move(index, delta) {
  const target = index + delta
  if (target < 0 || target >= sections.value.length) return
  const [section] = sections.value.splice(index, 1)
  sections.value.splice(target, 0, section)
}
async function upload(event, section) {
  const file = event.target.files?.[0]
  if (!file) return
  uploading.value = true; emit('uploading', true); error.value = ''
  try {
    const data = new FormData(); data.append('file', file)
    const key = sessionStorage.getItem('nova_admin_key') || ''
    const response = await fetch('/api/uploads', { method: 'POST', headers: { 'x-admin-key': key }, body: data })
    const result = await response.json()
    if (!response.ok) throw Error(result.error || 'Ошибка загрузки')
    section.image_url = result.url
  } catch (e) { error.value = e.message } finally { uploading.value = false; emit('uploading', false); event.target.value = '' }
}
</script>
<template>
  <fieldset class="sections-editor" :disabled="disabled || uploading">
    <legend>Секции страницы ({{ sections.length }}/50)</legend>
    <p>Секции отображаются после заголовка и вступительного текста.</p>
    <article v-for="(section,index) in sections" :key="section.id" class="section-editor">
      <header><strong>{{ index + 1 }}. {{ names[section.type] }}</strong><div><button type="button" class="row-btn" :disabled="index===0" aria-label="Поднять секцию" @click="move(index,-1)">↑</button><button type="button" class="row-btn" :disabled="index===sections.length-1" aria-label="Опустить секцию" @click="move(index,1)">↓</button><button type="button" class="row-btn danger" @click="sections.splice(index,1)">Удалить</button></div></header>
      <template v-if="section.type !== 'image'"><label>Заголовок<input v-model="section.title" maxlength="300"></label><label>Текст<textarea v-model="section.text" rows="4" maxlength="20000"></textarea></label></template>
      <template v-if="section.type !== 'text'">
        <label>{{ section.type==='hero' ? 'Фон обложки' : 'Изображение' }}<input type="file" accept="image/jpeg,image/png,image/webp" @change="upload($event,section)"><small>JPG, PNG, WebP до 5 МБ</small></label>
        <div v-if="section.image_url"><img :src="section.image_url" alt="Предпросмотр" class="section-preview"><button type="button" class="row-btn" @click="section.image_url=''">Убрать изображение</button></div>
      </template>
      <template v-if="section.type==='image'"><label>Описание изображения для доступности<input v-model="section.alt" maxlength="300"></label><label>Подпись<input v-model="section.caption" maxlength="1000"></label></template>
      <template v-if="section.type==='hero'"><label>Текст кнопки<input v-model="section.button_text" maxlength="100"></label><label>Адрес кнопки<input v-model="section.button_url" maxlength="2000" placeholder="/about или https://example.com"></label></template>
    </article>
    <div class="section-add"><button v-for="(name,type) in names" :key="type" type="button" class="row-btn" :disabled="sections.length>=50" @click="add(type)">＋ {{ name }}</button></div>
  </fieldset>
  <p v-if="uploading" role="status">Загрузка изображения…</p><p v-if="error" class="alert" role="alert">{{ error }}</p>
</template>
<style scoped>
.sections-editor { border: 1px solid #dce4df; border-radius: 12px; padding: 16px; min-width: 0; }
.sections-editor p { font-size: 13px; color: #607468; }
.section-editor { border: 1px solid #dce4df; border-radius: 8px; padding: 12px; margin: 16px 0; }
header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.section-preview { display:block; max-width:100%; max-height:160px; object-fit:contain; margin-bottom:8px; }
.section-add { display:flex; flex-wrap:wrap; gap:8px; }
</style>
