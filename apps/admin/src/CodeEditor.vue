<script setup>
import {ref,computed,nextTick} from 'vue'
const props=defineProps({modelValue:{type:String,default:''},language:String,disabled:Boolean})
const emit=defineEmits(['update:modelValue','save'])
const input=ref(null),gutter=ref(null),query=ref(''),searchNotice=ref('')
const lines=computed(()=>Array.from({length:props.modelValue.split('\n').length},(_,i)=>i+1).join('\n'))
function scroll(){if(gutter.value)gutter.value.scrollTop=input.value.scrollTop}
async function key(event){
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();emit('save');return}
 if(event.key!=='Tab')return
 event.preventDefault();const el=input.value,start=el.selectionStart,end=el.selectionEnd
 const before=props.modelValue.slice(0,start),after=props.modelValue.slice(end)
 if(event.shiftKey){const line=before.lastIndexOf('\n')+1;const length=(before.slice(line).match(/^ {1,2}/)||[''])[0].length;if(!length)return;emit('update:modelValue',before.slice(0,line)+before.slice(line+length)+props.modelValue.slice(start));await nextTick();el.setSelectionRange(start-length,end-length)}
 else{emit('update:modelValue',before+'  '+props.modelValue.slice(start,end)+after);await nextTick();el.setSelectionRange(start+2,end+2)}
}
function find(){if(!query.value)return;const el=input.value,offset=props.modelValue.indexOf(query.value,el.selectionEnd);const at=offset>=0?offset:props.modelValue.indexOf(query.value);searchNotice.value=at<0?'Не найдено':'';if(at>=0){el.focus();el.setSelectionRange(at,at+query.value.length);const row=props.modelValue.slice(0,at).split('\n').length;el.scrollTop=Math.max(0,(row-4)*22);scroll()}}
</script>
<template><div class="code-editor"><div class="code-tools"><strong>{{language}}</strong><label>Найти<input v-model="query" @keydown.enter.prevent="find"></label><button type="button" class="row-btn" @click="find">Следующее</button><span role="status">{{searchNotice}}</span><small>Tab — отступ · Ctrl+S — сохранить</small></div><div class="code-input"><pre ref="gutter" aria-hidden="true">{{lines}}</pre><textarea ref="input" :aria-label="'Код '+language" :value="modelValue" :disabled="disabled" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" maxlength="100000" @input="emit('update:modelValue',$event.target.value)" @keydown="key" @scroll="scroll"></textarea></div><small class="code-count">{{modelValue.length.toLocaleString('ru-RU')}} / 100 000 символов</small></div></template>
<style scoped>
.code-editor{min-width:0;border:1px solid #d8e2e9;border-radius:10px;overflow:hidden;background:#101923;color:#e4edf5}.code-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px;background:#1d2c39;font-size:12px}.code-tools label{display:flex;align-items:center;gap:8px}.code-tools input{max-width:160px;padding:6px;border-radius:4px;border:1px solid #536676}.code-tools small{color:#bacbd8}.code-input{display:flex;height:460px;min-width:0}.code-input pre,.code-input textarea{font:14px/22px Consolas,'Courier New',monospace;tab-size:2;margin:0;border:0;padding:16px 12px}.code-input pre{overflow:hidden;min-width:56px;text-align:right;color:#7c96aa;background:#14212d;user-select:none}.code-input textarea{flex:1;min-width:0;resize:vertical;outline-offset:-3px;white-space:pre;overflow:auto;background:#101923;color:#e4edf5}.code-count{display:block;padding:8px 12px;color:#aac0d0;text-align:right}@media(max-width:600px){.code-input{height:340px}.code-tools small{width:100%}}
</style>
