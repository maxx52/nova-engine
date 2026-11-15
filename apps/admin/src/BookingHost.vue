<script setup>
import {ref,shallowRef,onMounted,onBeforeUnmount} from 'vue'
import {adminFetch} from './adminApi.js'
const props=defineProps({apiWrite:{type:Function,required:true},userRole:{type:String,required:true}})
const mode=ref('loading'),error=ref(''),root=ref(null),developmentComponent=shallowRef(null)
let dispose=null,closed=false
onMounted(async()=>{
 try{
  const response=await adminFetch('/api/admin/booking/runtime')
  if(response.status===404){mode.value='unavailable';return}
  if(!response.ok)throw Error('Не удалось проверить установленную версию модуля')
  const info=await response.json()
  if(info.mode==='bundled'){
   if(import.meta.env.DEV){const source='./BookingWorkspace.vue';const component=await import(/* @vite-ignore */ source);if(!closed){developmentComponent.value=component.default;mode.value='development'};return}
   throw Error('Для подключения Booking установите подписанный пакет')
  }
  if(info.mode!=='external')throw Error('Неизвестный режим модуля')
  if(typeof info.version!=='string'||!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(info.version))throw Error('Некорректная версия интерфейса модуля')
  const url='/api/admin/booking/interface.js?v='+encodeURIComponent(info.version)
  const module=await import(/* @vite-ignore */ url)
  if(closed)return
  if(typeof module.mountBooking!=='function')throw Error('Несовместимый интерфейс модуля')
  dispose=module.mountBooking(root.value,{apiWrite:props.apiWrite,userRole:props.userRole});mode.value='external'
 }catch(e){if(!closed){error.value=e.message||'Не удалось открыть модуль';mode.value='error'}}
})
onBeforeUnmount(()=>{closed=true;if(dispose)dispose()})
</script>
<template>
 <component :is="developmentComponent" v-if="mode==='development'" :api-write="apiWrite" :user-role="userRole" />
 <p v-if="mode==='unavailable'" role="status">Модуль Booking &amp; CRM не установлен или отключён.</p>
 <p v-if="mode==='loading'" role="status">Загрузка Booking &amp; CRM…</p>
 <p v-if="mode==='error'" class="alert" role="alert">{{error}}</p>
 <div v-show="mode==='external' || mode==='loading'" ref="root"></div>
</template>
