<script setup>
import {computed,ref,watch} from 'vue'
import CodeFrame from './CodeFrame.vue'
const props=defineProps({name:String,design:Object,data:Object,actions:Function})
const failed=ref(false),code=computed(()=>props.design?.theme?.templates?.[props.name])
watch(()=>code.value,()=>failed.value=false)
</script>
<template><CodeFrame v-if="code&&!failed" :key="name+JSON.stringify(code)" :code="code" :data="data" :actions="actions" navigation :title="'Шаблон темы: '+name" @error="failed=true"/><slot v-else/></template>
