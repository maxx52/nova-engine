<script setup>
import {computed} from 'vue'
const props=defineProps({editor:Object})
const labels={title:'Заголовок',slug:'Адрес',content:'Текст',sections:'Блоки',seo:'SEO',published:'Публикация',excerpt:'Описание',category:'Рубрика',tags:'Теги',cover_url:'Обложка'}
const show=v=>v===undefined?'—':typeof v==='string'?v:JSON.stringify(v,null,2)
const comparison=computed(()=>props.editor.historical?.payload||props.editor.conflict)
const changes=computed(()=>comparison.value?Object.keys(labels).filter(k=>JSON.stringify(props.editor.form?.[k])!==JSON.stringify(comparison.value[k])):[])
const action={initial:'Начальная версия',create:'Создание',save:'Сохранение',import:'Импорт',trash:'Корзина',restore:'Восстановление'}
</script>
<template>
 <section class="content-recovery" aria-label="Сохранение и версии">
  <fieldset :disabled="editor.busy"><p role="status">{{editor.status}} <span v-if="editor.form?.revision">· Версия {{editor.form.revision}}</span></p>
  <div v-if="editor.pending" class="recovery-notice"><p>Есть ваш личный черновик от {{new Date(editor.pending.saved_at).toLocaleString('ru')}}. Он не опубликован.</p><button type="button" class="row-btn" @click="editor.recover">Восстановить личный черновик</button><button type="button" class="row-btn" @click="editor.discardDraft">Удалить личный черновик</button></div>
  <button v-if="editor.form?.id" type="button" class="row-btn" @click="editor.history">История версий</button>
  <details v-if="editor.versions.length" open><summary>Последние {{editor.versions.length}} версий (до 30)</summary><div class="version-list"><button v-for="v in editor.versions" :key="v.revision" type="button" class="row-btn" @click="editor.inspect(v.revision)">Версия {{v.revision}} · {{action[v.action]||'Сохранение'}} · {{new Date(v.created_at).toLocaleString('ru')}}</button></div></details>
  <div v-if="editor.conflict" class="recovery-notice" role="alert"><strong>{{editor.conflict.deleted_at?'Материал перемещён в корзину. Ваш текст остаётся в редакторе.':'На сервере есть изменения другого редактора.'}}</strong><p>Сравните текст ниже. Выбор своего варианта ещё не сохраняет его на сервере.</p></div>
  <div v-if="comparison" class="version-compare"><h3>{{editor.historical?'Сравнение с версией '+editor.historical.revision:'Сравнение с серверной версией '+editor.conflict.revision}}</h3><p v-if="!changes.length">Содержимое совпадает.</p><details v-for="field in changes" :key="field"><summary>{{labels[field]}}</summary><div class="compare-columns"><div><strong>В редакторе</strong><pre>{{show(editor.form[field])}}</pre></div><div><strong>{{editor.historical?'Из истории':'На сервере'}}</strong><pre>{{show(comparison[field])}}</pre></div></div></details><button v-if="editor.historical" type="button" class="row-btn" @click="editor.useVersion">Загрузить версию как черновик</button><template v-else-if="!editor.conflict.deleted_at"><button type="button" class="row-btn" @click="editor.keepLocal">Продолжить с моим вариантом</button><button type="button" class="row-btn" @click="editor.loadServer">Загрузить вариант с сервера</button></template></div>
 </fieldset></section>
</template>
<style scoped>
fieldset{border:0;padding:0;min-width:0}.content-recovery{padding:14px;border:1px solid #d6e3dc;background:#f6faf7;border-radius:12px;margin-bottom:18px;overflow-wrap:anywhere}.content-recovery p{margin:0 0 10px}.recovery-notice{border-left:3px solid #b18a27;padding:12px;margin:8px 0;background:#fff9e8}.version-list{display:flex;flex-direction:column;max-height:220px;overflow:auto;align-items:start;margin-top:10px}.version-compare{margin-top:16px}.version-compare details{margin:12px 0}.compare-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.compare-columns>div{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto;font-size:12px;background:#fff;padding:10px}.row-btn{margin:3px}summary{cursor:pointer}@media(max-width:600px){.compare-columns{grid-template-columns:1fr}}
</style>
