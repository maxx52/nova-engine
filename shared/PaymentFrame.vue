<script setup>
import {computed} from 'vue'
import {paymentDocument} from './payments.js'
const props=defineProps({config:Object,order:Object})
const documentHtml=computed(()=>paymentDocument(props.config,props.order))
function render(event){event.target.contentWindow.postMessage({type:'nova:payment-render',html:documentHtml.value},'*')}
</script>
<template><iframe :key="documentHtml" class="payment-frame" src="/api/payment-frame" title="Платёжная форма" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" @load="render"></iframe></template>
<style scoped>.payment-frame{display:block;width:100%;height:650px;min-height:400px;border:1px solid #dbe5e2;border-radius:8px;background:white}</style>
