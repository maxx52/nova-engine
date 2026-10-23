<script setup>
import ThemeSlot from '../../../shared/ThemeSlot.vue'
import {defaultTexts} from '../../../shared/siteDesign.js'
import {ref,watch,computed} from 'vue'
const props=defineProps({design:Object,siteData:Object,actions:Function,path:String,siteName:String,texts:{type:Object,default:()=>defaultTexts}})
const data=ref(null),article=ref(null),loading=ref(false),error=ref('')
const initial=new URLSearchParams(location.search)
const category=ref(initial.get('category')||''),tag=ref(initial.get('tag')||''),page=ref(Number(initial.get('page'))||1)
const isList=computed(()=>/^\/blog\/?$/.test(props.path))
let version=0
const date=value=>value?new Date(value).toLocaleDateString('ru-RU',{year:'numeric',month:'long',day:'numeric'}):''
async function load(number=page.value){
 const current=++version;loading.value=true;error.value='';article.value=null;data.value=null;page.value=number
 try{
  const query=new URLSearchParams({page:String(number),category:category.value,tag:tag.value})
  const slug=props.path.replace(/^\/blog\//,'').replace(/\/$/,'')
  const response=await fetch(isList.value?'/api/blog?'+query:'/api/blog/'+encodeURIComponent(slug))
  if(!response.ok)throw Error(response.status===404?'Статья или блог не найдены':'Не удалось загрузить блог')
  const result=await response.json();if(current!==version)return
  if(isList.value){data.value=result;history.replaceState({},'',location.pathname+'?'+query)}
  else{article.value=result}
 }catch(e){if(current===version)error.value=e.message}finally{if(current===version)loading.value=false}
}
watch(()=>props.path,()=>load(),{immediate:true})
</script>
<template>
<main class="container blog-view">
<p v-if="loading" role="status">{{texts.blog_loading}}</p><div v-else-if="error" role="alert"><h1>{{error}}</h1><a href="/blog">{{texts.blog_back}}</a></div>
<template v-else-if="data"><div class="blog-heading"><h1>{{texts.blog_title}}</h1><span>{{texts.blog_count}} {{data.total}}</span></div>
<form class="blog-filters" @submit.prevent="load(1)"><label>{{texts.blog_rubric}}<select v-model="category"><option value="">{{texts.blog_all_rubrics}}</option><option v-for="value in data.categories" :key="value">{{value}}</option></select></label><label>{{texts.blog_tag}}<select v-model="tag"><option value="">{{texts.blog_all_tags}}</option><option v-for="value in data.tags" :key="value">{{value}}</option></select></label><button class="primary-button">{{texts.blog_filter}}</button></form>
<ThemeSlot name="blog" :design="design" :actions="actions" :data="{...siteData,context:{...siteData.context,blog:data}}"><div v-if="data.items.length" class="blog-grid"><article v-for="post in data.items" :key="post.id" class="post-card"><a :href="'/blog/'+post.slug" class="post-cover" v-if="post.cover_url"><img :src="post.cover_url" :alt="post.title" loading="lazy"></a><div class="post-summary"><div class="post-meta"><span v-if="post.category">{{post.category}}</span><time v-if="post.published_at" :datetime="post.published_at">{{date(post.published_at)}}</time></div><h2><a :href="'/blog/'+post.slug">{{post.title}}</a></h2><p>{{post.excerpt}}</p><div class="post-tags"><a v-for="value in post.tags" :key="value" :href="'/blog?tag='+encodeURIComponent(value)">#{{value}}</a></div><a :href="'/blog/'+post.slug" class="read-post">{{texts.blog_read}}</a></div></article></div><p v-else>{{texts.blog_empty}}</p></ThemeSlot>
<nav v-if="data.total>12 || page>1" class="blog-pagination" aria-label="Страницы блога"><button :disabled="page<=1" @click="load(page-1)">{{texts.previous}}</button><span>{{texts.page_number}} {{page}}</span><button :disabled="page*12>=data.total" @click="load(page+1)">{{texts.next}}</button></nav>
</template>
<ThemeSlot v-else-if="article" name="post" :design="design" :actions="actions" :data="{...siteData,context:{...siteData.context,post:article}}"><article class="post-detail"><a href="/blog">{{texts.blog_all}}</a><div class="post-meta"><span>{{article.category}}</span><time v-if="article.published_at" :datetime="article.published_at">{{date(article.published_at)}}</time></div><h1>{{article.title}}</h1><p v-if="article.excerpt" class="post-lead">{{article.excerpt}}</p><img v-if="article.cover_url" :src="article.cover_url" :alt="article.title" class="detail-cover"><div class="post-content">{{article.content}}</div><div class="post-tags"><a v-for="value in article.tags" :key="value" :href="'/blog?tag='+encodeURIComponent(value)">#{{value}}</a></div></article></ThemeSlot>
</main>
</template>
<style scoped>
.blog-view{padding-top:48px;padding-bottom:90px;min-height:65vh;}h1{font-size:clamp(30px,5vw,50px);line-height:1.2;overflow-wrap:anywhere;margin:20px 0 28px;}.blog-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;}.blog-filters{display:flex;flex-wrap:wrap;gap:16px;align-items:end;margin:16px 0 32px;}label{display:grid;gap:8px;}select{padding:12px;border:1px solid #d9e4dd;border-radius:8px;max-width:260px;}.blog-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;}.post-card{border:1px solid #e1e8e3;border-radius:16px;overflow:hidden;background:white;}.post-cover{display:block;aspect-ratio:16/10;background:#f0f4f1;}.post-cover img{width:100%;height:100%;object-fit:cover;}.post-summary{padding:24px;}h2{line-height:1.3;font-size:24px;overflow-wrap:anywhere;margin:18px 0;}a{color:#256247;}h2 a{text-decoration:none;color:inherit;}p{line-height:1.8;overflow-wrap:anywhere;white-space:pre-wrap;}.post-meta{display:flex;flex-wrap:wrap;gap:12px;color:#63776c;font-size:13px;margin-top:20px;overflow-wrap:anywhere;}.post-tags{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0;overflow-wrap:anywhere;}.post-tags a{max-width:100%;}.read-post{display:inline-block;margin-top:12px;}.post-detail{max-width:850px;margin:auto;}.post-lead{font-size:21px;color:#536b5e;}.detail-cover{width:100%;max-height:600px;object-fit:contain;border-radius:16px;margin:24px 0;}.post-content{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;font-size:18px;}.blog-pagination{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:36px;}button{cursor:pointer;}.blog-pagination button{padding:12px;border:1px solid #d9e4dd;border-radius:8px;}@media(max-width:900px){.blog-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}@media(max-width:600px){.blog-grid{grid-template-columns:1fr;}.blog-heading{align-items:start;flex-direction:column;gap:0;}.blog-filters{align-items:stretch;flex-direction:column;}select{max-width:100%;}}
</style>
