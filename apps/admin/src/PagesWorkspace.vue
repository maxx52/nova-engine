<script setup>
import { ref, onMounted } from 'vue'
const siteUrl = (import.meta.env.VITE_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
const props = defineProps({ apiWrite: Function })
const rows = ref([]), error = ref(''), busy = ref(false), form = ref(null)
async function load() { rows.value = await props.apiWrite('/api/admin/pages', 'GET') }
function edit(row) { error.value = ''; form.value = row ? { ...row } : { title: '', slug: '', content: '', published: false } }
async function save() {
  busy.value = true; error.value = ''
  try {
    const saved = await props.apiWrite('/api/admin/pages' + (form.value.id ? '/' + form.value.id : ''), form.value.id ? 'PUT' : 'POST', form.value)
    form.value = saved
    await load(); form.value = null
  } catch (e) { error.value = e.message } finally { busy.value = false }
}
async function remove(row) {
  if (!confirm('Удалить страницу «' + row.title + '»?')) return
  busy.value = true; error.value = ''
  try { await props.apiWrite('/api/admin/pages/' + row.id, 'DELETE'); await load() } catch (e) { error.value = e.message } finally { busy.value = false }
}
onMounted(async () => { try { await load() } catch (e) { error.value = e.message } })
</script>
<template>
  <div>
    <div class="page-title"><div><span class="eyebrow">СОДЕРЖИМОЕ САЙТА</span><h1>Страницы</h1><p>Создавайте обычные страницы сайта.</p></div><button class="primary-btn" @click="edit()">＋ Создать страницу</button></div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div class="panel"><div class="table-scroll"><table><thead><tr><th>Заголовок</th><th>Адрес</th><th>Статус</th><th>Действия</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.title }}</td><td><a v-if="row.published" :href="siteUrl + '/' + row.slug" target="_blank" rel="noopener">/{{ row.slug }}</a><span v-else>/{{ row.slug }}</span></td><td>{{ row.published ? 'Опубликована' : 'Черновик' }}</td><td><button class="row-btn" :disabled="busy" @click="edit(row)">Изменить</button><button class="row-btn danger" :disabled="busy" @click="remove(row)">Удалить</button></td></tr></tbody></table><p v-if="!rows.length" class="empty">Страниц пока нет. Создайте первую страницу.</p></div></div>
    <div v-if="form" class="modal-backdrop"><div class="modal"><div class="modal-heading"><h2>{{ form.id ? 'Редактирование страницы' : 'Новая страница' }}</h2><button :disabled="busy" @click="form=null">×</button></div><form @submit.prevent="save"><label>Заголовок<input v-model="form.title" required maxlength="150"></label><label>Адрес страницы<input v-model="form.slug" required maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="about"><small>Латинские буквы, цифры и дефисы. Например: /about</small></label><label>Текст страницы<textarea v-model="form.content" rows="12" maxlength="100000"></textarea><small>Обычный текст с сохранением абзацев.</small></label><label><input type="checkbox" v-model="form.published"> Опубликована</label><p v-if="error" class="alert">{{ error }}</p><div class="modal-actions"><button class="cancel-btn" type="button" :disabled="busy" @click="form=null">Отмена</button><button class="primary-btn" :disabled="busy">{{ busy ? 'Сохранение…' : 'Сохранить' }}</button></div></form></div></div>
  </div>
</template>
