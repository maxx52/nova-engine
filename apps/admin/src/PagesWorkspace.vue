<script setup>
import PagePreview from './PagePreview.vue'
import SeoEditor from './SeoEditor.vue'
import { ref, onMounted, toRefs } from 'vue'
import ContentRecovery from './ContentRecovery.vue'
import {useContentEditor} from './useContentEditor.js'
import PageSectionsEditor from './PageSectionsEditor.vue'
const siteUrl = (import.meta.env.VITE_SITE_URL || (import.meta.env.DEV?'http://localhost:5173':location.origin)).replace(/\/$/, '')
const props = defineProps({ apiWrite: Function })
const emit=defineEmits(['dirty'])
const templates=ref([]),templateId=ref('')
async function applyTemplate(){if(!templateId.value)return;const row=await props.apiWrite('/api/admin/packages/template/'+templateId.value,'GET');if((form.value.title||form.value.content||form.value.sections.length)&&!confirm('Заменить содержимое в редакторе выбранным шаблоном? Сохранение и публикация выполняются отдельно.'))return;form.value.title=row.package.page.title;form.value.content=row.package.page.content;form.value.sections=JSON.parse(JSON.stringify(row.package.page.sections)).map(s=>({...s,id:crypto.randomUUID()}))}
const uploading = ref(false),previewOpen=ref(false)
const rows=ref([]),trash=ref(false)
const editor=useContentEditor('pages',load,emit)
const {form,busy,error}=toRefs(editor)
async function load(){rows.value=await props.apiWrite('/api/admin/pages'+(trash.value?'?trash=1':''),'GET')}
async function switchTrash(){trash.value=!trash.value;try{await load()}catch(e){error.value=e.message}}
async function edit(row){previewOpen.value=false;templateId.value='';await editor.open(row||{sections:[],title:'',slug:'',content:'',published:false})}
async function save(){if(uploading.value)return;await editor.save()}
async function remove(row){await editor.trash(row)}
onMounted(async () => { try { await load();templates.value=(await props.apiWrite('/api/admin/packages','GET')).filter(p=>p.kind==='template') } catch (e) { error.value = e.message } })
</script>
<template>
  <div>
    <div class="page-title"><div><span class="eyebrow">СОДЕРЖИМОЕ САЙТА</span><h1>Страницы</h1><p>Создавайте обычные страницы сайта.</p></div><button class="primary-btn" :disabled="busy" @click="edit()">＋ Создать страницу</button></div>
    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <div class="panel"><div class="panel-heading"><h2>{{trash?'Корзина страниц':'Все страницы'}}</h2><button class="row-btn" :disabled="busy" @click="switchTrash">{{trash?'Все страницы':'Корзина'}}</button></div><div class="table-scroll"><table><thead><tr><th>Заголовок</th><th>Адрес</th><th>Статус</th><th>Действия</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.title }}</td><td><a v-if="row.published" :href="siteUrl + '/' + row.slug" target="_blank" rel="noopener">/{{ row.slug }}</a><span v-else>/{{ row.slug }}</span></td><td>{{ row.published ? 'Опубликована' : 'Черновик' }}</td><td><template v-if="!trash"><button class="row-btn" :disabled="busy || uploading" @click="edit(row)">Изменить</button><button class="row-btn danger" :disabled="busy || uploading" @click="remove(row)">В корзину</button></template><template v-else><button class="row-btn" :disabled="busy" @click="editor.trash(row,'restore')">Восстановить</button><button class="row-btn danger" :disabled="busy" @click="editor.trash(row,'purge')">Удалить окончательно</button></template></td></tr></tbody></table><p v-if="!rows.length" class="empty">{{trash?'Корзина пуста.':'Страниц пока нет. Создайте первую страницу.'}}</p></div></div>
    <div v-if="form" class="modal-backdrop"><div class="modal page-editor-modal"><div class="modal-heading"><h2>{{ form.id ? 'Редактирование страницы' : 'Новая страница' }}</h2><button :disabled="busy || uploading" @click="editor.close">×</button></div><ContentRecovery :editor="editor"/><form @submit.prevent="save"><fieldset :disabled="busy || !!editor.pending"><div v-if="templates.length" class="page-template-picker"><label>Шаблон страницы<select v-model="templateId" aria-label="Шаблон страницы"><option value="">Без шаблона</option><option v-for="t in templates" :key="t.id" :value="t.id">{{t.manifest.name}} · {{t.manifest.version}}</option></select></label><button class="row-btn" type="button" :disabled="busy||!templateId" @click="applyTemplate().catch(e=>error=e.message)">Заполнить шаблоном</button><p>Формы и изображения выбираются из данных вашего сайта после заполнения.</p></div><label>Заголовок<input v-model="form.title" required maxlength="150"></label><label>Адрес страницы<input v-model="form.slug" required maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="about"><small>Латинские буквы, цифры и дефисы. Например: /about</small></label><label>Вступительный текст<textarea v-model="form.content" rows="12" maxlength="100000"></textarea><small>Обычный текст с сохранением абзацев.</small></label><PageSectionsEditor v-model="form.sections" :disabled="busy" @uploading="uploading=$event" @save="save" /><button type="button" class="row-btn" @click="previewOpen=!previewOpen">{{previewOpen?'Скрыть предпросмотр':'Мобильный предпросмотр'}}</button><PagePreview v-if="previewOpen" :page="form"/><SeoEditor v-model="form.seo"/><label><input type="checkbox" v-model="form.published"> Опубликована</label><p v-if="error" class="alert">{{ error }}</p><div class="modal-actions"><button class="cancel-btn" type="button" :disabled="busy || uploading" @click="editor.close">Отмена</button><button class="primary-btn" :disabled="busy || uploading || !!editor.pending || editor.blocked">{{ busy ? 'Сохранение…' : 'Сохранить' }}</button></div></fieldset></form></div></div>
  </div>
</template>

<style scoped>.page-editor-modal{width:min(1000px,100%)}.page-editor-modal form{min-width:0}.page-editor-modal fieldset{border:0;padding:0;min-width:0;display:grid;gap:17px}</style>
