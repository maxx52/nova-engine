<script setup>
import CodeEditor from './CodeEditor.vue'
import CodeFrame from '../../../shared/CodeFrame.vue'
import MediaPicker from './MediaPicker.vue'
import { adminFetch } from './adminApi.js'
import { ref,onMounted,onBeforeUnmount } from 'vue'
const emit = defineEmits(['uploading','save'])
const sections = defineModel({ default: () => [] })
const props=defineProps({ disabled: Boolean })
const forms=ref([]),library=ref([]),libraryBusy=ref(false),saveNames=ref({}),dragId=ref(''),dropId=ref('')
async function libraryRequest(path,method='GET',body){const r=await adminFetch('/api/admin/pages/section-library'+path,{method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const value=r.status===204?null:await r.json();if(!r.ok)throw Error(value?.error||'Ошибка библиотеки');return value}
async function loadLibrary(){library.value=await libraryRequest('')}
async function saveSection(section){if(props.disabled||uploading.value||libraryBusy.value)return;libraryBusy.value=true;error.value='';try{await libraryRequest('','POST',{title:saveNames.value[section.id]||section.title?.slice(0,150)||names[section.type],section:JSON.parse(JSON.stringify(section))});await loadLibrary()}catch(e){error.value=e.message}finally{libraryBusy.value=false}}
async function insertSaved(row){if(props.disabled||uploading.value||libraryBusy.value||sections.value.length>=50)return;libraryBusy.value=true;error.value='';try{const saved=await libraryRequest('/'+row.id);sections.value.push({...JSON.parse(JSON.stringify(saved.section)),id:crypto.randomUUID()})}catch(e){error.value=e.message}finally{libraryBusy.value=false}}
async function removeSaved(row){if(props.disabled||!confirm('Удалить сохранённую секцию «'+row.title+'» из библиотеки? На страницах копии останутся.'))return;libraryBusy.value=true;error.value='';try{await libraryRequest('/'+row.id,'DELETE');await loadLibrary()}catch(e){error.value=e.message}finally{libraryBusy.value=false}}
function reorder(id,target){if(props.disabled||uploading.value||libraryBusy.value)return;const from=sections.value.findIndex(s=>s.id===id),to=sections.value.findIndex(s=>s.id===target);if(from<0||to<0||from===to)return;const [s]=sections.value.splice(from,1);sections.value.splice(to,0,s)}
let pointer=null,scrollFrame=0,lastPoint=null,scrollContainer=null
function updateDrop(){dropId.value=lastPoint?document.elementFromPoint(lastPoint.x,lastPoint.y)?.closest('[data-section-id]')?.dataset.sectionId||'':''}
function autoScroll(){if(pointer===null)return;if(scrollContainer&&lastPoint){const box=scrollContainer.getBoundingClientRect(),dy=lastPoint.y<box.top+60?-10:lastPoint.y>box.bottom-60?10:0;if(dy){scrollContainer.scrollTop+=dy;updateDrop()}}scrollFrame=requestAnimationFrame(autoScroll)}
function pointerStart(e,id){if(e.button!==0||pointer!==null||props.disabled||uploading.value||libraryBusy.value)return;e.preventDefault();pointer=e.pointerId;dragId.value=id;dropId.value=id;lastPoint={x:e.clientX,y:e.clientY};scrollContainer=e.currentTarget.closest('.modal');e.currentTarget.setPointerCapture(e.pointerId);autoScroll()}
function pointerMove(e){if(e.pointerId!==pointer)return;lastPoint={x:e.clientX,y:e.clientY};updateDrop()}
function cancelDrag(){cancelAnimationFrame(scrollFrame);pointer=null;lastPoint=null;scrollContainer=null;dragId.value='';dropId.value=''}
function pointerEnd(e){if(e.pointerId!==pointer)return;lastPoint={x:e.clientX,y:e.clientY};updateDrop();if(dropId.value)reorder(dragId.value,dropId.value);cancelDrag()}
onBeforeUnmount(cancelDrag)
onMounted(async()=>{try{const r=await adminFetch('/api/admin/forms');if(r.ok)forms.value=await r.json()}catch{};try{await loadLibrary()}catch(e){error.value=e.message}})
const uploading = ref(false), error = ref('')
const previews=ref({}),codeFiles=ref({}),codeErrors=ref({})
function run(section){codeErrors.value[section.id]='';previews.value[section.id]={code:JSON.parse(JSON.stringify(section.code)),key:crypto.randomUUID()}}
const names = { form:'Форма обратной связи', code:'HTML / CSS / JavaScript', hero: 'Обложка', text: 'Текст', image: 'Изображение' }
function add(type) {
  if (sections.value.length >= 50) return
  sections.value.push({ id: crypto.randomUUID(), type, title: '', text: '', image_url: '', alt: '', caption: '', button_text: '', button_url: '', ...(type==='form'?{form_id:''}:{}), ...(type==='code'?{code:{html:'<section><h2>Новый блок</h2><p>Свой HTML на странице.</p></section>',css:'section { padding: 32px; font-family: Arial, sans-serif; }',js:''}}:{}) })
}
function move(index, delta) {
  if(props.disabled||uploading.value||libraryBusy.value)return
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
    const response = await adminFetch('/api/uploads', { method: 'POST',  body: data })
    const result = await response.json()
    if (!response.ok) throw Error(result.error || 'Ошибка загрузки')
    section.image_url = result.url
  } catch (e) { error.value = e.message } finally { uploading.value = false; emit('uploading', false); event.target.value = '' }
}
</script>
<template>
  <fieldset class="sections-editor" :disabled="disabled || uploading || libraryBusy">
    <legend>Секции страницы ({{ sections.length }}/50)</legend>
    <p>Перетаскивайте блоки за ручку ⋮⋮. Кнопки ↑/↓ доступны с клавиатуры. Секции отображаются после заголовка и вступительного текста.</p><details class="saved-library"><summary>Сохранённые секции ({{library.length}})</summary><p v-if="!library.length">Сохраните блок из редактора, чтобы использовать его на других страницах.</p><div v-for="row in library" :key="row.id" class="saved-row"><strong>{{row.title}}</strong><small>{{names[row.type]}}</small><button type="button" class="row-btn" :disabled="sections.length>=50" @click="insertSaved(row)">Вставить секцию</button><button type="button" class="row-btn danger" @click="removeSaved(row)">Удалить из библиотеки</button></div></details>
    <article v-for="(section,index) in sections" :key="section.id" class="section-editor" :data-section-id="section.id" :class="{'drop-target':dropId===section.id,dragging:dragId===section.id}">
      <header><button type="button" class="drag-handle row-btn" aria-label="Перетащить секцию" @pointerdown="pointerStart($event,section.id)" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="cancelDrag">⋮⋮</button><strong>{{ index + 1 }}. {{ names[section.type] }}</strong><div><button type="button" class="row-btn" :disabled="index===0" aria-label="Поднять секцию" @click="move(index,-1)">↑</button><button type="button" class="row-btn" :disabled="index===sections.length-1" aria-label="Опустить секцию" @click="move(index,1)">↓</button><button type="button" class="row-btn danger" @click="sections.splice(index,1)">Удалить</button></div></header>
      <template v-if="section.type !== 'image' && section.type !== 'code' && section.type !== 'form'"><label>Заголовок<input v-model="section.title" maxlength="300"></label><label>Текст<textarea v-model="section.text" rows="4" maxlength="20000"></textarea></label></template>
      <template v-if="section.type !== 'text' && section.type !== 'code' && section.type !== 'form'">
        <MediaPicker :disabled="disabled||uploading" @select="section.image_url=$event" />
        <label>{{ section.type==='hero' ? 'Фон обложки' : 'Изображение' }}<input type="file" accept="image/jpeg,image/png,image/webp" @change="upload($event,section)"><small>JPG, PNG, WebP до 5 МБ</small></label>
        <div v-if="section.image_url"><img :src="section.image_url" alt="Предпросмотр" class="section-preview"><button type="button" class="row-btn" @click="section.image_url=''">Убрать изображение</button></div>
      </template>
      <template v-if="section.type==='form'"><label>Форма<select v-model="section.form_id" aria-label="Форма обратной связи"><option value="">Выберите форму</option><option v-for="f in forms" :key="f.id" :value="f.id">{{f.title}}{{f.enabled?'':' (выключена)'}}{{f.ready?'':' · каналы не настроены'}}</option></select></label><p>Создайте форму и настройте отправку в разделе «Формы и заявки». Форма появится на опубликованной странице.</p></template><template v-if="section.type==='code'"><label>Файл<select v-model="codeFiles[section.id]" aria-label="Файл секции"><option :value="undefined">index.html</option><option value="css">style.css</option><option value="js">script.js</option></select></label><CodeEditor v-model="section.code[codeFiles[section.id]||'html']" :language="codeFiles[section.id]||'html'" :disabled="disabled||uploading" @save="emit('save')"/><button type="button" class="row-btn" @click="run(section)">Предпросмотр блока</button><CodeFrame v-if="previews[section.id]" :key="previews[section.id].key" :code="previews[section.id].code" :data="{settings:{name:'Предпросмотр'},products:[],route:{path:'/',search:''}}" title="Предпросмотр секции" @error="codeErrors[section.id]=$event"/><p v-if="codeErrors[section.id]" class="alert">{{codeErrors[section.id]}}</p></template>
      <template v-if="section.type==='image'"><label>Описание изображения для доступности<input v-model="section.alt" maxlength="300"></label><label>Подпись<input v-model="section.caption" maxlength="1000"></label></template>
      <template v-if="section.type==='hero'"><label>Текст кнопки<input v-model="section.button_text" maxlength="100"></label><label>Адрес кнопки<input v-model="section.button_url" maxlength="2000" placeholder="/about или https://example.com"></label></template>
      <div class="save-section"><label>Название в библиотеке<input v-model="saveNames[section.id]" maxlength="150" :placeholder="section.title||names[section.type]"></label><button type="button" class="row-btn" @click="saveSection(section)">Сохранить секцию</button></div>
    </article>
    <div class="section-add"><button v-for="(name,type) in names" :key="type" type="button" class="row-btn" :disabled="sections.length>=50" @click="add(type)">＋ {{ name }}</button></div>
  </fieldset>
  <p v-if="uploading" role="status">Загрузка изображения…</p><p v-if="error" class="alert" role="alert">{{ error }}</p>
</template>
<style scoped>
.drag-handle{touch-action:none;cursor:grab;font-size:20px}.drop-target{outline:2px solid #287253}.dragging{opacity:.6}.save-section,.saved-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:15px}.save-section label{flex:1;min-width:150px}.saved-library{background:#f3f7f5;padding:15px;border-radius:8px}.saved-row{padding:12px 0;border-bottom:1px solid #ccd9d0}.saved-row strong{overflow-wrap:anywhere}
.sections-editor { border: 1px solid #dce4df; border-radius: 12px; padding: 16px; min-width: 0; }
.sections-editor p { font-size: 13px; color: #607468; }
.section-editor { border: 1px solid #dce4df; border-radius: 8px; padding: 12px; margin: 16px 0; }
header { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.section-preview { display:block; max-width:100%; max-height:160px; object-fit:contain; margin-bottom:8px; }
.section-add { display:flex; flex-wrap:wrap; gap:8px; }
</style>
