<script setup>
import PagePreview from './PagePreview.vue'
import SeoEditor from './SeoEditor.vue'
import { adminFetch } from './adminApi.js'
import { ref, onMounted } from 'vue'
import PageSectionsEditor from './PageSectionsEditor.vue'
const siteUrl = (import.meta.env.VITE_SITE_URL || (import.meta.env.DEV?'http://localhost:5173':location.origin)).replace(/\/$/, '')
const props = defineProps({ apiWrite: Function })
const templates=ref([]),templateId=ref('')
async function applyTemplate(){if(!templateId.value)return;const row=await props.apiWrite('/api/admin/packages/template/'+templateId.value,'GET');if((form.value.title||form.value.content||form.value.sections.length)&&!confirm('Заменить содержимое в редакторе выбранным шаблоном? Сохранение и публикация выполняются отдельно.'))return;form.value.title=row.package.page.title;form.value.content=row.package.page.content;form.value.sections=JSON.parse(JSON.stringify(row.package.page.sections)).map(s=>({...s,id:crypto.randomUUID()}))}
const uploading = ref(false),previewOpen=ref(false)
const rows = ref([]), error = ref(''), busy = ref(false), form = ref(null)
async function load() { rows.value = await props.apiWrite('/api/admin/pages', 'GET') }
function edit(row) { previewOpen.value=false; templateId.value='';error.value = ''; form.value = row ? { ...row, sections: JSON.parse(JSON.stringify(row.sections || [])) } : { sections: [], title: '', slug: '', content: '', published: false } }
async function save() {
  if (busy.value || uploading.value) return
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
onMounted(async () => { try { await load();templates.value=(await props.apiWrite('/api/admin/packages','GET')).filter(p=>p.kind==='template') } catch (e) { error.value = e.message } })
</script>
<template>
  <div>
    <div class="page-title"><div><span class="eyebrow">СОДЕРЖИМОЕ САЙТА</span><h1>Страницы</h1><p>Создавайте обычные страницы сайта.</p></div><button class="primary-btn" @click="edit()">＋ Создать страницу</button></div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div class="panel"><div class="table-scroll"><table><thead><tr><th>Заголовок</th><th>Адрес</th><th>Статус</th><th>Действия</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.title }}</td><td><a v-if="row.published" :href="siteUrl + '/' + row.slug" target="_blank" rel="noopener">/{{ row.slug }}</a><span v-else>/{{ row.slug }}</span></td><td>{{ row.published ? 'Опубликована' : 'Черновик' }}</td><td><button class="row-btn" :disabled="busy || uploading" @click="edit(row)">Изменить</button><button class="row-btn danger" :disabled="busy || uploading" @click="remove(row)">Удалить</button></td></tr></tbody></table><p v-if="!rows.length" class="empty">Страниц пока нет. Создайте первую страницу.</p></div></div>
    <div v-if="form" class="modal-backdrop"><div class="modal page-editor-modal"><div class="modal-heading"><h2>{{ form.id ? 'Редактирование страницы' : 'Новая страница' }}</h2><button :disabled="busy || uploading" @click="form=null">×</button></div><form @submit.prevent="save"><div v-if="templates.length" class="page-template-picker"><label>Шаблон страницы<select v-model="templateId" aria-label="Шаблон страницы"><option value="">Без шаблона</option><option v-for="t in templates" :key="t.id" :value="t.id">{{t.manifest.name}} · {{t.manifest.version}}</option></select></label><button class="row-btn" type="button" :disabled="busy||!templateId" @click="applyTemplate().catch(e=>error=e.message)">Заполнить шаблоном</button><p>Формы и изображения выбираются из данных вашего сайта после заполнения.</p></div><label>Заголовок<input v-model="form.title" required maxlength="150"></label><label>Адрес страницы<input v-model="form.slug" required maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="about"><small>Латинские буквы, цифры и дефисы. Например: /about</small></label><label>Вступительный текст<textarea v-model="form.content" rows="12" maxlength="100000"></textarea><small>Обычный текст с сохранением абзацев.</small></label><PageSectionsEditor v-model="form.sections" :disabled="busy" @uploading="uploading=$event" @save="save" /><button type="button" class="row-btn" @click="previewOpen=!previewOpen">{{previewOpen?'Скрыть предпросмотр':'Мобильный предпросмотр'}}</button><PagePreview v-if="previewOpen" :page="form"/><SeoEditor v-model="form.seo"/><label><input type="checkbox" v-model="form.published"> Опубликована</label><p v-if="error" class="alert">{{ error }}</p><div class="modal-actions"><button class="cancel-btn" type="button" :disabled="busy || uploading" @click="form=null">Отмена</button><button class="primary-btn" :disabled="busy || uploading">{{ busy ? 'Сохранение…' : 'Сохранить' }}</button></div></form></div></div>
  </div>
</template>

<style scoped>.page-editor-modal{width:min(1000px,100%)}.page-editor-modal form{min-width:0}</style>
