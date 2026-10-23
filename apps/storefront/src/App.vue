<script setup>
import ThemeSlot from '../../../shared/ThemeSlot.vue'
import ContactForm from '../../../shared/ContactForm.vue'
import {validateThemeAction} from '../../../shared/themes.js'
import {track} from './analytics.js'
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import CheckoutForm from './CheckoutForm.vue'
import OrderStatus from './OrderStatus.vue'
import CustomerAccount from './CustomerAccount.vue'
import ContentPage from './ContentPage.vue'
import BlogView from './BlogView.vue'
import CodeFrame from '../../../shared/CodeFrame.vue'
import {designValue} from '../../../shared/siteDesign.js'
import {safeLink} from '../../../shared/contentSafety.js'

const siteSettings=ref({name:'NOVA',logo_url:'',home_slug:null,shop_enabled:true,blog_enabled:false,menu:[]})
const design=ref(designValue())
const t=computed(()=>design.value.texts)
const customHome=computed(()=>design.value.code.enabled&&(design.value.code.placement==='site'||routePath.value==='/'&&design.value.code.placement==='home'))
const designStyle=computed(()=>({'--nova-primary':design.value.colors.primary,'--nova-accent':design.value.colors.accent,'--nova-background':design.value.colors.background,'--nova-text':design.value.colors.text,'--nova-hero':design.value.colors.hero,'--nova-footer':design.value.colors.footer,'--nova-radius':design.value.radius+'px','--nova-width':design.value.width+'px',fontFamily:design.value.font+', Arial, sans-serif'}))
const publicData=computed(()=>({settings:{...siteSettings.value,menu:menuItems.value},products:products.value,design:{texts:t.value,colors:design.value.colors,font:design.value.font,width:design.value.width,radius:design.value.radius},theme:design.value.theme?{id:design.value.theme.manifest.id,version:design.value.theme.manifest.version,settings:design.value.theme.settings}:null,route:{path:routePath.value,search:/^\/blog/.test(routePath.value)?new URLSearchParams([...new URLSearchParams(location.search)].filter(([k])=>['page','category','tag'].includes(k))).toString():''},context:{product:activeProduct.value},cartSummary:{count:itemCount.value,total_cents:Math.round(cartTotal.value*100)}}))
const contactFormId=ref('')
async function themeAction(action,payload){
 const invalid=validateThemeAction(action,payload);if(invalid)throw Error(invalid)
 if(action==='forms.open'){contactFormId.value=payload.form_id;return {opened:true}}
 if(!shopEnabled.value)throw Error('Магазин отключён')
 if(action==='cart.open'){cartOpen.value=true;return {opened:true}}
 if(checkoutLocked.value)throw Error(t.value.checkout_locked)
 const p=products.value.find(p=>p.id===payload.product_id);if(!p)throw Error('Товар недоступен')
 const v=payload.variant_name?p.variants?.find(v=>v.name===payload.variant_name):null
 if(payload.variant_name&&!v||p.variants?.length&&!v)throw Error('Укажите доступный вариант товара')
 const available=Math.min(100,v?.stock??p.stock),current=cart.value.find(x=>x.cartKey===JSON.stringify([p.id,v?.name||'']))?.quantity||0
 if(available-current<payload.quantity)throw Error('Недостаточно доступного товара')
 addToCart(p,v,payload.quantity)
 return {count:itemCount.value,total_cents:Math.round(cartTotal.value*100)}
}
const settingsReady=ref(false)
const settingsError=ref('')
const shopEnabled=computed(()=>siteSettings.value.shop_enabled)
const isShopLink=url=>/^\/(catalog|product)(\/|$|[?#])/.test(url) || url==='/#catalog' || url==='/#advantages'
const menuItems=computed(()=>siteSettings.value.menu.filter(item=>item.url && safeLink(item.url) && (shopEnabled.value||!isShopLink(item.url)) && (siteSettings.value.blog_enabled || !/^\/blog(\/|$|[?#])/.test(item.url))))
const routePath = ref(location.pathname)
watch(()=>settingsReady.value?routePath.value:null,path=>{if(path)track('pageview',path)})
window.addEventListener('popstate', () => { routePath.value = location.pathname })
const contentPath=computed(()=>routePath.value==='/' && siteSettings.value.home_slug ? '/'+siteSettings.value.home_slug : routePath.value)
const isBlogRoute=computed(()=>/^\/blog(\/|$)/.test(routePath.value))
const isContentRoute = computed(() => (routePath.value==='/' && !!siteSettings.value.home_slug) || (!['/','/catalog','/catalog/'].includes(routePath.value) && !/^\/product\/\d+\/?$/.test(routePath.value)))
const products = ref([])
const search = ref('')
const attributeFilter = ref('')
const categoryRows = ref([])
const availableAttributes = computed(()=>[...new Set(products.value.filter(p=>selectedCategory.value==='Все товары'||p.category===selectedCategory.value).flatMap(p=>(p.attributes||[]).map(a=>a.name+'::'+a.value)))].sort())
const descendantNames = computed(()=>{const chosen=categoryRows.value.find(c=>c.name===selectedCategory.value);if(!chosen)return [];const ids=new Set([chosen.id]);let changed=true;while(changed){changed=false;for(const c of categoryRows.value)if(ids.has(c.parent_id)&&!ids.has(c.id)){ids.add(c.id);changed=true}}return categoryRows.value.filter(c=>ids.has(c.id)).map(c=>c.name)})
const cart = ref([])
watch(cart,items=>{try{sessionStorage.setItem('nova-cart',JSON.stringify(items.slice(0,50).map(x=>({product_id:x.id,variant_name:x.variantName||'',quantity:x.quantity}))))}catch{}},{deep:true})
function restoreCart(items){
 for(const row of items.slice(0,50)){
  if(!row||typeof row!=='object')continue
  const p=products.value.find(p=>p.id===row.product_id);if(!p||!Number.isInteger(row.quantity)||row.quantity<1)continue
  const v=p.variants?.find(v=>v.name===row.variant_name)
  if(row.variant_name&&!v||p.variants?.length&&!v)continue
  addToCart(p,v,Math.min(100,row.quantity))
 }
}
function openAccount(){if(checkoutLocked.value)return;cartOpen.value=false;checkoutOpen.value=false;activeProduct.value=null;routePath.value='/account';history.pushState({},'','/account');window.scrollTo(0,0)}
async function repeatOrder(items){
 if(checkoutLocked.value)throw Error(t.value.checkout_locked)
 const r=await fetch('/api/products',{credentials:'omit'});if(!r.ok)throw Error('Не удалось проверить товары')
 products.value=(await r.json()).filter(p=>p.published!==false)
 const previous=cart.value.map(x=>({product_id:x.id,variant_name:x.variantName,quantity:x.quantity}))
 cart.value=[];restoreCart(previous);restoreCart(items)
 cartOpen.value=true;notice.value='Корзина обновлена по текущим ценам и остаткам. Проверьте состав перед оформлением.'
}
const loading = ref(true)
const error = ref('')
const selectedCategory = ref('Все товары')
const cartOpen = ref(false)
const checkoutOpen=ref(false)
const checkoutLocked=ref(false)
const mobileMenu = ref(false)
const notice = ref('')
const activeProduct = ref(null)
const chosenVariant = ref(-1)
const selectedVariant = computed(()=>activeProduct.value?.variants?.[chosenVariant.value] || null)
const currentImage = ref('')
const productImages = computed(() => activeProduct.value ? (activeProduct.value.images?.length ? activeProduct.value.images : (activeProduct.value.image_url ? [activeProduct.value.image_url] : [])) : [])
function openProduct(product) { chosenVariant.value=-1;activeProduct.value = product; currentImage.value = productImages.value[0] || ''; routePath.value = '/product/' + product.id; history.pushState({ productId: product.id }, '', '/product/' + product.id); window.scrollTo({top:0,behavior:'smooth'}) }
async function closeProduct() {
  activeProduct.value = null
  routePath.value = '/catalog'
  history.pushState({}, '', '/catalog#catalog')
  await nextTick()
  scrollToCatalog()
}
function syncUrl() { chosenVariant.value=-1;const match = location.pathname.match(/^\/product\/(\d+)\/?$/); activeProduct.value = match ? (products.value.find(p=>p.id===Number(match[1])) || null) : null; currentImage.value = activeProduct.value?.image_url || activeProduct.value?.images?.[0] || '' }
const currency = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(value)
const categories = computed(() => ['Все товары', ...new Set(products.value.map(p => p.category))])
const visibleProducts = computed(() => products.value.filter(p =>
  (selectedCategory.value === 'Все товары' || descendantNames.value.includes(p.category)) &&
  (!attributeFilter.value || (p.attributes||[]).some(a=>a.name+'::'+a.value===attributeFilter.value)) &&
  [p.name,p.sku,p.description,...(p.attributes||[]).flatMap(a=>[a.name,a.value])].join(' ').toLowerCase().includes(search.value.trim().toLowerCase())
))
const itemCount = computed(() => cart.value.reduce((sum, item) => sum + item.quantity, 0))
const cartTotal = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0))
function addToCart(product,variant=null,quantity=1) {
  if(checkoutLocked.value){notice.value=t.value.checkout_locked;return}
  checkoutOpen.value=false
  const choice=variant || (product.variants?.length ? product.variants.find(v=>v.stock>0) : null)
  if(product.variants?.length && !choice){notice.value=t.value.no_variants;return}
  if(choice && choice.stock<=0){notice.value=t.value.variant_unavailable;return}
  if(!choice && product.stock<=0){notice.value=t.value.out_of_stock;return}
  const key=JSON.stringify([product.id,choice?.name||''])
  const existing=cart.value.find(item=>item.cartKey===key)
  if(existing){if(existing.quantity>=Math.min(100,choice?.stock??product.stock)){notice.value=t.value.stock_limit;return}existing.quantity=Math.min(Math.min(100,choice?.stock??product.stock),existing.quantity+quantity)}
  else if(cart.value.length>=50){notice.value='В корзине может быть до 50 позиций';return}
  else cart.value.push({...product,cartKey:key,variantName:choice?.name||'',available:choice?.stock??product.stock,name:choice?product.name+' — '+choice.name:product.name,price:choice?.price??product.price,quantity:Math.min(quantity,100,choice?.stock??product.stock)})

  track('cart_add',routePath.value)
  notice.value = t.value.added
  window.setTimeout(() => notice.value = '', 2400)
}
function changeQty(item, delta) {
  if(checkoutLocked.value)return
  if(delta>0&&item.quantity>=Math.min(100,item.available)){notice.value=t.value.stock_limit;return}
  item.quantity += delta
  if (item.quantity <= 0) cart.value = cart.value.filter(p => p.cartKey !== item.cartKey)
}
async function orderComplete(){cart.value=[];try{const r=await fetch('/api/products',{credentials:'omit'});if(r.ok)products.value=await r.json()}catch{} }
function startCheckout(){checkoutOpen.value=true;track('checkout_start',routePath.value)}
function scrollToCatalog() { document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }) }
onMounted(async () => {
  window.addEventListener('popstate',syncUrl)
  try {
    const settingsResponse=await fetch('/api/settings')
    if(!settingsResponse.ok)throw Error('Не удалось загрузить настройки сайта')
    siteSettings.value=await settingsResponse.json()
    const designResponse=await fetch('/api/design')
    if(designResponse.ok)design.value=designValue(await designResponse.json())
    else if(designResponse.status!==404)throw Error('Не удалось загрузить оформление')
    const style=document.createElement('link');style.rel='stylesheet';style.href='/api/design/style.css';document.head.append(style)
    settingsReady.value=true
    if(!shopEnabled.value)return
    const response = await fetch('/api/products')
    if (!response.ok) throw new Error('Не удалось получить товары')
    products.value = (await response.json()).filter(p=>p.published!==false)
    const cats=await fetch('/api/categories');if(cats.ok)categoryRows.value=await cats.json()
    syncUrl()
    try{const saved=JSON.parse(sessionStorage.getItem('nova-cart')||'[]');if(Array.isArray(saved))restoreCart(saved)}catch{}
  } catch (e) { if(!settingsReady.value)settingsError.value=e.message;else error.value=e.message }
  finally { loading.value = false }
})
</script>

<template>
  <div v-if="!settingsReady" class="empty-state" role="status">{{settingsError || t.loading}}</div>
  <div v-else class="site-shell" :style="designStyle">
    <div v-if="design.visibility.announcement" class="announcement"><span>{{t.announcement || siteSettings.name}}</span></div>
    <ThemeSlot v-if="design.visibility.header" name="header" :design="design" :data="publicData" :actions="themeAction"><header class="site-header">
      <div class="container header-inner">
        <a href="/" class="logo" :aria-label="siteSettings.name+' — главная'"><img v-if="siteSettings.logo_url" :src="siteSettings.logo_url" :alt="siteSettings.name" class="site-logo-image"><span v-else class="logo-symbol">{{siteSettings.name.slice(0,1)}}</span><span class="site-name">{{siteSettings.name}}</span></a>
        <nav class="main-nav" :class="{ 'nav-open': mobileMenu }" aria-label="Основная навигация">
          <a v-for="(item,index) in menuItems" :key="index" :href="item.url" @click="mobileMenu=false">{{item.label}}</a>
        </nav>
        <div class="header-actions">
          <a href="/account" class="account-link" @click.prevent="openAccount">Личный кабинет</a>
          <button class="icon-button mobile-nav-button" aria-label="Меню" @click="mobileMenu = !mobileMenu">☰</button>
          <button v-if="shopEnabled" class="cart-trigger" :aria-label="t.cart+' '+itemCount" @click="cartOpen = true"><span class="cart-glyph">🛍</span><span class="cart-label">{{t.cart}}</span><span class="cart-count">{{ itemCount }}</span></button>
        </div>
      </div>
    </header></ThemeSlot>

    <OrderStatus v-if="routePath==='/order-status'"/><CustomerAccount v-else-if="/^\/account\/?$/.test(routePath)" :repeat-order="repeatOrder" :locked="checkoutLocked"/><main v-else-if="customHome"><CodeFrame :code="design.code" :data="publicData" navigation /></main>
    <BlogView :design="design" :site-data="publicData" :actions="themeAction" v-else-if="isBlogRoute && siteSettings.blog_enabled" :path="routePath" :site-name="siteSettings.name" :texts="t" />
    <main v-else-if="isBlogRoute" class="container site-welcome"><h1>{{t.not_found}}</h1><a href="/">{{t.home_link}}</a></main>
    <ContentPage :template-name="routePath==='/'?'home':'page'" :design="design" :actions="themeAction" v-else-if="isContentRoute" :site-data="publicData" :path="contentPath" :site-name="siteSettings.name" :texts="t" />
    <ThemeSlot v-else-if="routePath==='/'&&design.theme?.templates.home" name="home" :design="design" :data="publicData" :actions="themeAction"><main class="container site-welcome"><h1>{{siteSettings.name}}</h1><a href="/catalog">{{t.hero_button}}</a></main></ThemeSlot>
    <main v-else-if="!shopEnabled" class="container site-welcome"><h1>{{routePath==='/'?siteSettings.name:t.not_found}}</h1><a v-if="routePath!=='/'" href="/">{{t.home_link}}</a></main>
    <ThemeSlot v-else-if="!activeProduct" :key="routePath" name="catalog" :design="design" :data="publicData" :actions="themeAction"><main>
      <template v-for="sectionId in design.home_order" :key="sectionId">
      <section v-if="sectionId==='hero' && design.visibility.hero" class="hero-section">
        <div class="container hero-grid">
          <div class="hero-copy">
            <div class="eyebrow"><span class="green-dot"></span> {{t.hero_eyebrow}}</div>
            <h1>{{t.hero_title}}<br><em>{{t.hero_accent}}</em><br>{{t.hero_end}}</h1>
            <p>{{t.hero_description}}</p>
            <div class="hero-actions"><a class="primary-button" :href="design.hero_button_url">{{t.hero_button}} <span>↗</span></a><span class="hero-note">{{t.hero_note}}</span></div>
          </div>
          <div class="hero-art" aria-label="Подборка товаров">
            <img v-if="design.hero_image_url" :src="design.hero_image_url" :alt="t.hero_title" class="hero-custom-image"><template v-else><div class="hero-circle"></div><div class="hero-item hero-item-main">{{t.hero_main_icon}}</div><div class="hero-item hero-item-second">{{t.hero_second_icon}}</div></template>
            <div v-if="design.visibility.floating" class="hero-floating"><span>{{t.hero_float_icon}}</span><div><strong>{{t.hero_float_title}}</strong><small>{{t.hero_float_text}}</small></div></div>
          </div>
        </div>
      </section>

      <section v-if="sectionId==='advantages' && design.visibility.advantages" class="benefit-strip" id="advantages">
        <div class="container benefits">
          <div><span class="benefit-icon">{{t.benefit_1_icon}}</span><span><strong>{{t.benefit_1_title}}</strong><small>{{t.benefit_1_text}}</small></span></div>
          <div><span class="benefit-icon">{{t.benefit_2_icon}}</span><span><strong>{{t.benefit_2_title}}</strong><small>{{t.benefit_2_text}}</small></span></div>
          <div><span class="benefit-icon">{{t.benefit_3_icon}}</span><span><strong>{{t.benefit_3_title}}</strong><small>{{t.benefit_3_text}}</small></span></div>
        </div>
      </section>

      <section v-if="sectionId==='catalog' && design.visibility.catalog" class="catalog-section container" id="catalog">
        <div class="section-heading"><div><span class="section-kicker">{{t.catalog_kicker}}</span><h2>{{t.catalog_title}}<span class="heading-period">.</span></h2><p>{{t.catalog_description}}</p></div><span class="catalog-count">{{t.found}} {{ visibleProducts.length }}</span></div>
        <div class="toolbar"><div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: selectedCategory === category }" @click="selectedCategory = category;attributeFilter = ''">{{ category==='Все товары'?t.all_products:category }}</button></div><select v-model="attributeFilter" aria-label="Фильтр характеристик" class="catalog-filter"><option value="">{{t.all_attributes}}</option><option v-for="attr in availableAttributes" :key="attr" :value="attr">{{attr.replace('::',' — ')}}</option></select><label class="search-box"><span>⌕</span><input v-model="search" :placeholder="t.search" :aria-label="t.search"></label></div>
        <p v-if="error" class="error-message">{{ t.load_error }}</p>
        <p v-if="loading" class="empty-state">{{t.catalog_loading}}</p>
        <div v-else-if="visibleProducts.length" class="product-grid">
          <article v-for="(product, index) in visibleProducts" :key="product.id" class="product-card">
            <div class="product-image" @click="openProduct(product)" style="cursor:pointer" :style="{ background: design.colors.hero }">
              <span class="product-badge" v-if="index < 2">{{ index === 0 ? t.badge_1 : t.badge_2 }}</span><img v-if="product.image_url" :src="product.image_url" :alt="product.name" style="width:100%;height:100%;object-fit:contain;padding:24px"><span v-else class="product-emoji">{{t.fallback_icon}}</span>
              <button class="quick-add" @click.stop="addToCart(product)" :aria-label="'Добавить ' + product.name + ' в корзину'" :disabled="product.variants?.length?!product.variants.some(v=>v.stock>0):product.stock<=0">＋</button>
            </div>
            <div class="product-info"><span class="product-category">{{ product.category }}</span><h3><a :href="'/product/'+product.id" @click.prevent="openProduct(product)">{{ product.name }}</a></h3><p>{{ product.description }}</p><div class="product-bottom"><strong>{{ currency(product.price) }}</strong><button @click="addToCart(product)" :disabled="product.variants?.length?!product.variants.some(v=>v.stock>0):product.stock<=0">{{t.add_to_cart}}</button></div></div>
          </article>
        </div>
        <p v-else-if="!error" class="empty-state">{{t.no_products}}</p>
      </section>
      </template>
    </main>
    </ThemeSlot><ThemeSlot v-else name="product" :design="design" :data="publicData" :actions="themeAction"><main class="container" style="padding-top:44px;padding-bottom:90px">
      <button class="detail-back" @click="closeProduct">{{t.back_catalog}}</button>
      <div class="detail-layout">
        <div>
          <div class="detail-photo"><img v-if="currentImage" :src="currentImage" :alt="activeProduct.name"><span v-else style="font-size:90px">{{t.fallback_icon}}</span></div>
          <div class="detail-thumbnails"><button v-for="url in productImages" :key="url" :class="{ chosen:currentImage===url }" @click="currentImage=url"><img :src="url" :alt="activeProduct.name"></button></div>
        </div>
        <div class="detail-info">
          <span class="section-kicker">{{activeProduct.category}}</span>
          <h1>{{activeProduct.name}}</h1>
          <p class="detail-sku">{{t.sku}} {{selectedVariant?.sku || activeProduct.sku || t.no_sku}}</p>
          <strong class="detail-price">{{currency(selectedVariant?.price ?? activeProduct.price)}}</strong>
          <p class="detail-stock">{{(selectedVariant?.stock ?? activeProduct.stock)>0?t.in_stock+' '+(selectedVariant?.stock ?? activeProduct.stock):t.out_of_stock}}</p>
          <div v-if="activeProduct.variants?.length" class="variant-picker"><strong>{{t.choose_variant}}</strong><div><button v-for="(v,i) in activeProduct.variants" :key="i" :disabled="v.stock===0" :class="{chosen:chosenVariant===i}" @click="chosenVariant=i">{{v.name}} · {{currency(v.price)}}</button></div></div><button class="primary-button" :disabled="activeProduct.variants?.length?!selectedVariant||selectedVariant.stock<=0:activeProduct.stock<=0" @click="addToCart(activeProduct,selectedVariant)">{{t.product_add}}</button>
          <h2>{{t.description}}</h2>
          <p class="detail-description">{{activeProduct.description || t.no_description}}</p><div v-if="activeProduct.attributes?.length" class="detail-attributes"><h2>{{t.attributes}}</h2><div v-for="(attr,i) in activeProduct.attributes" :key="i"><span>{{attr.name}}</span><strong>{{attr.value}}</strong></div></div>
        </div>
      </div>
    </main>
    </ThemeSlot><CodeFrame v-if="design.code.enabled && design.code.placement==='footer'" :key="routePath" :code="design.code" :data="publicData" navigation />
    <ThemeSlot v-if="design.visibility.footer" name="footer" :design="design" :data="publicData" :actions="themeAction"><footer class="footer"><div class="container footer-inner"><div class="footer-brand">{{siteSettings.name}}</div><span>{{t.footer_text}}<template v-if="design.visibility.year"> · {{ new Date().getFullYear() }}</template></span><span>{{t.footer_credit}}</span></div></footer></ThemeSlot>
    <div v-if="shopEnabled" v-show="cartOpen" class="drawer-overlay" @click.self="cartOpen = false"><aside class="cart-drawer" aria-label="Корзина"><div class="drawer-header"><div><span class="section-kicker">{{t.cart_kicker}}</span><h2>{{t.cart}} ({{ itemCount }})</h2></div><button class="close-button" aria-label="Закрыть корзину" @click="cartOpen = false">×</button></div><CheckoutForm v-if="checkoutOpen" :items="cart" :texts="t" @account="openAccount" @locked="checkoutLocked=$event" @complete="orderComplete" @back="checkoutOpen=false; cartOpen=false"/><div v-else-if="!cart.length" class="drawer-empty"><span>🛍️</span><h3>{{t.cart_empty}}</h3><p>{{t.cart_hint}}</p><button class="primary-button" @click="cartOpen = false; scrollToCatalog()">{{t.cart_shop}}</button></div><div v-else class="cart-items"><div v-for="item in cart" :key="item.cartKey" class="cart-item"><span class="cart-item-art">{{t.fallback_icon}}</span><div class="cart-item-info"><strong>{{ item.name }}</strong><span>{{ currency(item.price) }}</span><div class="quantity-controls"><button @click="changeQty(item, -1)">−</button><b>{{ item.quantity }}</b><button @click="changeQty(item, 1)">+</button></div></div></div></div><div v-if="cart.length && !checkoutOpen" class="drawer-bottom"><div class="total-row"><span>{{t.cart_total}}</span><strong>{{ currency(cartTotal) }}</strong></div><p>{{t.cart_note}}</p><button class="primary-button" @click="startCheckout">{{t.checkout}}</button></div></aside></div>
    <div v-if="contactFormId" class="drawer-overlay" @click.self="contactFormId=''"><section class="theme-contact-modal" role="dialog" aria-modal="true" aria-label="Обратная связь"><button class="close-button" aria-label="Закрыть форму" @click="contactFormId=''">×</button><ContactForm :key="contactFormId" :form-id="contactFormId"/></section></div>
    <div v-if="notice" class="toast">{{ notice }} ✓</div>
  </div>
</template>

<style scoped>
.account-link{font-size:13px;color:inherit;text-decoration:none}.theme-contact-modal{width:min(680px,calc(100vw - 32px));max-height:90vh;overflow:auto;background:var(--nova-background);padding:18px;border-radius:var(--nova-radius);margin:auto}.theme-contact-modal>.close-button{display:block;margin:0 0 10px auto}
.site-logo-image { max-width:100px;max-height:48px;object-fit:contain; }
.site-name { max-width:260px;overflow-wrap:anywhere;line-height:1.2; }
.site-welcome { min-height:65vh;padding-top:80px;padding-bottom:80px;overflow-wrap:anywhere; }
@media(max-width:600px){.logo{min-width:0;max-width:38%}.account-link{max-width:74px;font-size:12px;padding:4px}.site-name{max-width:160px;font-size:20px;}.site-logo-image{max-width:64px;}}
</style>
