<script setup>
import ContactForm from '../../../shared/ContactForm.vue'
import CodeFrame from '../../../shared/CodeFrame.vue'
defineProps({preview:Boolean,runCode:Boolean, siteData:{type:Object,default:()=>({})}, sections: { type: Array, default: () => [] } })
import {safeLink,mediaUrl as image} from '../../../shared/contentSafety.js'
const link=value=>safeLink(value)?value:''
</script>
<template>
  <div class="page-sections">
    <template v-for="section in sections" :key="section.id">
      <section v-if="preview&&section.type==='form'" class="preview-placeholder">Форма обратной связи · {{section.form_id||'не выбрана'}} (отправка отключена)</section><section v-else-if="preview&&!runCode&&section.type==='code'" class="preview-placeholder">Блок HTML/CSS/JavaScript — включите выполнение кода для предпросмотра</section><ContactForm v-else-if="section.type==='form'" :form-id="section.form_id"/>
      <CodeFrame v-else-if="section.type==='code'" :code="section.code" :data="siteData" :navigation="!preview" />
      <section v-else-if="section.type==='hero'" class="page-hero" :style="image(section.image_url) ? {backgroundImage: 'linear-gradient(90deg,rgba(10,30,22,.85),rgba(10,30,22,.55)),url('+image(section.image_url)+')'} : {}">
        <h2 v-if="section.title">{{ section.title }}</h2><p v-if="section.text">{{ section.text }}</p><a v-if="section.button_text && link(section.button_url)" :href="link(section.button_url)" class="section-button">{{ section.button_text }} →</a>
      </section>
      <section v-else-if="section.type==='text'" class="page-text-section"><h2 v-if="section.title">{{ section.title }}</h2><p v-if="section.text">{{ section.text }}</p></section>
      <figure v-else-if="section.type==='image' && image(section.image_url)"><img :src="image(section.image_url)" :alt="section.alt || ''" loading="lazy"><figcaption v-if="section.caption">{{ section.caption }}</figcaption></figure>
    </template>
  </div>
</template>
<style scoped>
.preview-placeholder{padding:24px;border:1px dashed #607468;border-radius:10px;font-size:14px;overflow-wrap:anywhere}
.page-sections { margin-top:40px; display:grid; gap:32px; }
.page-hero { padding:clamp(24px,6vw,64px); border-radius:20px; background:#183e2f; color:white; background-size:cover; background-position:center; }
h2 { font-size:clamp(24px,4vw,40px); line-height:1.2; margin:0 0 20px; overflow-wrap:anywhere; }
p { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; font-size:18px; margin:0; }
.section-button { display:inline-block; margin-top:28px; background:#fff; color:#183e2f; padding:14px 22px; border-radius:10px; text-decoration:none; overflow-wrap:anywhere; max-width:100%; }
figure { margin:0; } img { width:100%; height:auto; border-radius:16px; display:block; } figcaption { margin-top:12px; color:#576d61; text-align:center; overflow-wrap:anywhere; }
</style>
