<script setup>
import {ref} from 'vue'
import MediaLibrary from './MediaLibrary.vue'
const props=defineProps({disabled:Boolean})
const emit=defineEmits(['select'])
const open=ref(false)
function select(url){emit('select',url);open.value=false}
</script>
<template>
<button type="button" class="row-btn" :disabled="disabled" @click="open=true">Выбрать из медиатеки</button>
<Teleport to="body"><div v-if="open" class="media-picker-backdrop"><div class="media-picker-dialog" role="dialog" aria-modal="true" aria-label="Выбор изображения" @keydown.esc="open=false"><header><h2>Медиатека</h2><button type="button" class="row-btn" autofocus @click="open=false">Закрыть</button></header><MediaLibrary selectable @select="select" /></div></div></Teleport>
</template>
<style scoped>
.media-picker-backdrop{position:fixed;inset:0;z-index:100;background:#102b2699;display:grid;place-items:center;padding:16px;}.media-picker-dialog{background:white;border-radius:16px;padding:24px;width:min(1040px,100%);max-height:92vh;overflow:auto;}.media-picker-dialog header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px;}.media-picker-dialog h2{margin:0;font-size:22px;}
</style>
