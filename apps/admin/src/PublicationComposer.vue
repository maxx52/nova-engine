<script setup>
import {ref} from 'vue'
defineProps({editor:Object})
const date=ref('')
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone
</script>
<template>
 <details class="publication-composer"><summary>Согласование и публикация по расписанию</summary>
  <p v-if="!editor.form?.id">Сначала сохраните материал как черновик. Затем откройте его для отправки на согласование или выбора времени публикации.</p>
  <template v-else><p>Отправляется текущий текст редактора. Сайт продолжит показывать прежний материал до публикации. Изменение исходного материала отменит ожидающую заявку.</p><label>Желаемое время публикации ({{zone}})<input v-model="date" type="datetime-local" :disabled="editor.busy||!!editor.pending||editor.blocked"><small>Для согласования время необязательно. Администратор подтвердит время или опубликует сразу.</small></label><div><button type="button" class="row-btn" :disabled="editor.busy||!!editor.pending||editor.blocked" @click="editor.submitPublication('review',date)">Отправить на согласование</button><button v-if="!editor.isEditor" type="button" class="row-btn" :disabled="!date||editor.busy||!!editor.pending||editor.blocked" @click="editor.submitPublication('schedule',date)">Запланировать публикацию</button></div></template>
 </details>
</template>
<style scoped>
.publication-composer{margin-top:15px;border-top:1px solid #d6e3dc;padding-top:12px}summary{cursor:pointer;font-weight:700}p,small{font-size:12px;line-height:1.7}label{display:grid;gap:8px;margin:10px 0}input{padding:10px;border:1px solid #d6e3dc;border-radius:6px;max-width:100%}.row-btn{margin:5px 5px 5px 0}
</style>
