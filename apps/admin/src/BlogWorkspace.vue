<script setup>
import SeoEditor from './SeoEditor.vue'
import MediaPicker from './MediaPicker.vue'
import { adminFetch } from './adminApi.js'
import {ref,onMounted,computed,toRefs,watch} from 'vue'
import PublicationQueue from './PublicationQueue.vue'
import ContentRecovery from './ContentRecovery.vue'
import {useContentEditor} from './useContentEditor.js'
const props=defineProps({apiWrite:Function})
const emit=defineEmits(['dirty'])
const rows=ref([]),loading=ref(true),search=ref(''),trash=ref(false)
const publicationQueue=ref(null)
const editor=useContentEditor('posts',load,emit)
const {form,busy,error}=toRefs(editor)
const tagsText=ref('')
watch(()=>form.value?.tags,value=>{const tags=tagsText.value.split(',').map(t=>t.trim()).filter(Boolean);if(JSON.stringify(value)!==JSON.stringify(tags))tagsText.value=(value||[]).join(', ')},{immediate:true})
watch(tagsText,value=>{if(form.value)form.value.tags=value.split(',').map(t=>t.trim()).filter(Boolean)},{flush:'sync'})
const siteUrl=(import.meta.env.VITE_SITE_URL||(import.meta.env.DEV?'http://localhost:5173':location.origin)).replace(/\/$/,'')
const categories=computed(()=>[...new Set(rows.value.map(p=>p.category).filter(Boolean))])
const filtered=computed(()=>rows.value.filter(p=>(p.title+' '+p.category+' '+p.tags.join(' ')).toLowerCase().includes(search.value.toLowerCase())))
async function load(){rows.value=await props.apiWrite('/api/admin/posts'+(trash.value?'?trash=1':''),'GET');await publicationQueue.value?.reload()}
async function switchTrash(){trash.value=!trash.value;try{await load()}catch(e){error.value=e.message}}
async function edit(row){await editor.open(row||{title:'',slug:'',excerpt:'',content:'',category:'',tags:[],cover_url:'',published:false})}
async function save(){await editor.save()}
async function remove(row){await editor.trash(row)}
async function upload(event){const file=event.target.files?.[0];if(!file)return;busy.value=true;error.value='';try{const body=new FormData();body.append('file',file);const response=await adminFetch('/api/uploads',{method:'POST',body});const data=await response.json();if(!response.ok)throw Error(data.error||'Ошибка загрузки');form.value.cover_url=data.url}catch(e){error.value=e.message}finally{busy.value=false;event.target.value=''}}
onMounted(async()=>{try{await load()}catch(e){error.value=e.message}finally{loading.value=false}})
</script>
<template>
<div><div class="page-title"><div><span class="eyebrow">ПУБЛИКАЦИИ</span><h1>Блог</h1><p>Статьи, рубрики и теги.</p></div><button class="primary-btn" :disabled="busy" @click="edit()">＋ Создать статью</button></div><p v-if="editor.notice" class="editor-notice" role="status">{{editor.notice}}</p><p v-if="error" class="alert" role="alert">{{error}}</p>
<div class="panel"><div class="panel-heading"><h2>{{trash?'Корзина статей':'Статьи'}} ({{rows.length}})</h2><button class="row-btn" :disabled="busy" @click="switchTrash">{{trash?'Все статьи':'Корзина'}}</button><input v-model="search" class="search-input" placeholder="Поиск по названию, рубрике, тегу" aria-label="Поиск статей"></div><p v-if="loading" class="empty">Загрузка…</p><div v-else class="table-scroll"><table><thead><tr><th>Статья</th><th>Рубрика</th><th>Статус</th><th>Действия</th></tr></thead><tbody><tr v-for="row in filtered" :key="row.id"><td><strong>{{row.title}}</strong><div><a v-if="row.published" :href="siteUrl+'/blog/'+row.slug" target="_blank" rel="noopener">/blog/{{row.slug}}</a><span v-else>/blog/{{row.slug}}</span></div></td><td>{{row.category || '—'}}</td><td>{{row.published?'Опубликована':'Черновик'}}</td><td><template v-if="!trash"><button class="row-btn" :disabled="busy" @click="edit(row)">Изменить</button><button class="row-btn danger" :disabled="busy" @click="remove(row)">В корзину</button></template><template v-else><button class="row-btn" :disabled="busy" @click="editor.trash(row,'restore')">Восстановить</button><button class="row-btn danger" :disabled="busy" @click="editor.trash(row,'purge')">Удалить окончательно</button></template></td></tr></tbody></table><p v-if="!filtered.length" class="empty">Статьи не найдены.</p></div></div>
<PublicationQueue ref="publicationQueue" kind="posts"/><div v-if="form" class="modal-backdrop"><div class="modal blog-modal"><div class="modal-heading"><h2>{{form.id?'Редактирование статьи':'Новая статья'}}</h2><button :disabled="busy" @click="editor.close">×</button></div><ContentRecovery :editor="editor"/><form @submit.prevent="save"><fieldset :disabled="busy || !!editor.pending"><label>Заголовок<input v-model="form.title" maxlength="200" required></label><label>Адрес статьи<input v-model="form.slug" maxlength="120" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="first-post"><small>/blog/first-post — латинские буквы, цифры и дефисы</small></label><label>Краткое описание<textarea v-model="form.excerpt" maxlength="1000" rows="3"></textarea></label><label>Текст статьи<textarea v-model="form.content" maxlength="100000" rows="14"></textarea><small>Обычный текст с сохранением абзацев.</small></label><label>Рубрика<input v-model="form.category" maxlength="100" list="blog-categories"><datalist id="blog-categories"><option v-for="category in categories" :key="category" :value="category"></option></datalist></label><label>Теги через запятую<input v-model="tagsText" maxlength="1300" placeholder="Новости, Разработка"><small>До 20 уникальных тегов.</small></label><MediaPicker :disabled="busy" @select="form.cover_url=$event" /><label>Обложка<input type="file" accept="image/jpeg,image/png,image/webp" @change="upload"><small>JPG, PNG, WebP до 5 МБ.</small></label><div v-if="form.cover_url"><img :src="form.cover_url" class="cover-preview" alt="Обложка"><button type="button" class="row-btn" @click="form.cover_url=''">Убрать обложку</button></div><SeoEditor v-model="form.seo"/><label class="publish-check"><input type="checkbox" v-model="form.published" :disabled="editor.isEditor"> Опубликована</label><p v-if="error" class="alert">{{error}}</p><div class="modal-actions"><button type="button" class="cancel-btn" @click="editor.close">Отмена</button><button class="primary-btn" :disabled="!!editor.pending || editor.blocked">{{busy?'Сохранение…':editor.isEditor&&editor.liveAtOpen?'Сохранить личный черновик':'Сохранить'}}</button></div></fieldset></form></div></div>
</div>
</template>
<style scoped>.editor-notice{padding:16px;background:#eaf6ed;color:#285e40;line-height:1.6}
.blog-modal{width:min(760px,100%);}fieldset{border:0;padding:0;display:grid;gap:17px;min-width:0;} .cover-preview{display:block;max-width:100%;max-height:200px;object-fit:contain;margin-bottom:10px;}.publish-check{flex-direction:row;align-items:center;}td div{margin-top:8px;}td a{color:#287253;}
</style>
