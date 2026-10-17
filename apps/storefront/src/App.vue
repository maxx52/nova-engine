<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import CheckoutForm from './CheckoutForm.vue'
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
const publicData=computed(()=>({settings:siteSettings.value,products:products.value,route:{path:routePath.value,search:location.search}}))
const settingsReady=ref(false)
const settingsError=ref('')
const shopEnabled=computed(()=>siteSettings.value.shop_enabled)
const isShopLink=url=>/^\/(catalog|product)(\/|$|[?#])/.test(url) || url==='/#catalog' || url==='/#advantages'
const menuItems=computed(()=>siteSettings.value.menu.filter(item=>item.url && safeLink(item.url) && (shopEnabled.value||!isShopLink(item.url)) && (siteSettings.value.blog_enabled || !/^\/blog(\/|$|[?#])/.test(item.url))))
const routePath = ref(location.pathname)
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
function addToCart(product,variant=null) {
  if(checkoutLocked.value){notice.value=t.value.checkout_locked;return}
  checkoutOpen.value=false
  const choice=variant || (product.variants?.length ? product.variants.find(v=>v.stock>0) : null)
  if(product.variants?.length && !choice){notice.value=t.value.no_variants;return}
  if(choice && choice.stock<=0){notice.value=t.value.variant_unavailable;return}
  if(!choice && product.stock<=0){notice.value=t.value.out_of_stock;return}
  const key=JSON.stringify([product.id,choice?.name||''])
  const existing=cart.value.find(item=>item.cartKey===key)
  if(existing){if(existing.quantity>=Math.min(100,choice?.stock??product.stock)){notice.value=t.value.stock_limit;return}existing.quantity+=1}
  else cart.value.push({...product,cartKey:key,variantName:choice?.name||'',available:choice?.stock??product.stock,name:choice?product.name+' — '+choice.name:product.name,price:choice?.price??product.price,quantity:1})

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
function scrollToCatalog() { document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }) }
onMounted(async () => {
  window.addEventListener('popstate',syncUrl)
  try {
    const settingsResponse=await fetch('/api/settings')
    if(!settingsResponse.ok)throw Error('Не удалось загрузить настройки сайта')
    siteSettings.value=await settingsResponse.json()
    document.title=siteSettings.value.name
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
  } catch (e) { if(!settingsReady.value)settingsError.value=e.message;else error.value=e.message }
  finally { loading.value = false }
})
</script>

<template>
  <div v-if="!settingsReady" class="empty-state" role="status">{{settingsError || t.loading}}</div>
  <div v-else class="site-shell" :style="designStyle">
    <div v-if="design.visibility.announcement" class="announcement"><span>{{t.announcement || siteSettings.name}}</span></div>
    <header v-if="design.visibility.header" class="site-header">
      <div class="container header-inner">
        <a href="/" class="logo" :aria-label="siteSettings.name+' — главная'"><img v-if="siteSettings.logo_url" :src="siteSettings.logo_url" :alt="siteSettings.name" class="site-logo-image"><span v-else class="logo-symbol">{{siteSettings.name.slice(0,1)}}</span><span class="site-name">{{siteSettings.name}}</span></a>
        <nav class="main-nav" :class="{ 'nav-open': mobileMenu }" aria-label="Основная навигация">
          <a v-for="(item,index) in menuItems" :key="index" :href="item.url" @click="mobileMenu=false">{{item.label}}</a>
        </nav>
        <div class="header-actions">
          <button class="icon-button mobile-nav-button" aria-label="Меню" @click="mobileMenu = !mobileMenu">☰</button>
          <button v-if="shopEnabled" class="cart-trigger" :aria-label="t.cart+' '+itemCount" @click="cartOpen = true"><span class="cart-glyph">🛍</span><span class="cart-label">{{t.cart}}</span><span class="cart-count">{{ itemCount }}</span></button>
        </div>
      </div>
    </header>

    <main v-if="customHome"><CodeFrame :code="design.code" :data="publicData" navigation /></main>
    <BlogView v-else-if="isBlogRoute && siteSettings.blog_enabled" :path="routePath" :site-name="siteSettings.name" :texts="t" />
    <main v-else-if="isBlogRoute" class="container site-welcome"><h1>{{t.not_found}}</h1><a href="/">{{t.home_link}}</a></main>
    <ContentPage v-else-if="isContentRoute" :site-data="publicData" :path="contentPath" :site-name="siteSettings.name" :texts="t" />
    <main v-else-if="!shopEnabled" class="container site-welcome"><h1>{{routePath==='/'?siteSettings.name:t.not_found}}</h1><a v-if="routePath!=='/'" href="/">{{t.home_link}}</a></main>
    <main v-else-if="!activeProduct">
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
    <main v-else class="container" style="padding-top:44px;padding-bottom:90px">
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
    <CodeFrame v-if="design.code.enabled && design.code.placement==='footer'" :key="routePath" :code="design.code" :data="publicData" navigation />
    <footer v-if="design.visibility.footer" class="footer"><div class="container footer-inner"><div class="footer-brand">{{siteSettings.name}}</div><span>{{t.footer_text}}<template v-if="design.visibility.year"> · {{ new Date().getFullYear() }}</template></span><span>{{t.footer_credit}}</span></div></footer>
    <div v-if="shopEnabled" v-show="cartOpen" class="drawer-overlay" @click.self="cartOpen = false"><aside class="cart-drawer" aria-label="Корзина"><div class="drawer-header"><div><span class="section-kicker">{{t.cart_kicker}}</span><h2>{{t.cart}} ({{ itemCount }})</h2></div><button class="close-button" aria-label="Закрыть корзину" @click="cartOpen = false">×</button></div><CheckoutForm v-if="checkoutOpen" :items="cart" :texts="t" @locked="checkoutLocked=$event" @complete="orderComplete" @back="checkoutOpen=false; cartOpen=false"/><div v-else-if="!cart.length" class="drawer-empty"><span>🛍️</span><h3>{{t.cart_empty}}</h3><p>{{t.cart_hint}}</p><button class="primary-button" @click="cartOpen = false; scrollToCatalog()">{{t.cart_shop}}</button></div><div v-else class="cart-items"><div v-for="item in cart" :key="item.cartKey" class="cart-item"><span class="cart-item-art">{{t.fallback_icon}}</span><div class="cart-item-info"><strong>{{ item.name }}</strong><span>{{ currency(item.price) }}</span><div class="quantity-controls"><button @click="changeQty(item, -1)">−</button><b>{{ item.quantity }}</b><button @click="changeQty(item, 1)">+</button></div></div></div></div><div v-if="cart.length && !checkoutOpen" class="drawer-bottom"><div class="total-row"><span>{{t.cart_total}}</span><strong>{{ currency(cartTotal) }}</strong></div><p>{{t.cart_note}}</p><button class="primary-button" @click="checkoutOpen=true">{{t.checkout}}</button></div></aside></div>
    <div v-if="notice" class="toast">{{ notice }} ✓</div>
  </div>
</template>

<style scoped>
.site-logo-image { max-width:100px;max-height:48px;object-fit:contain; }
.site-name { max-width:260px;overflow-wrap:anywhere;line-height:1.2; }
.site-welcome { min-height:65vh;padding-top:80px;padding-bottom:80px;overflow-wrap:anywhere; }
@media(max-width:600px){.site-name{max-width:160px;font-size:20px;}.site-logo-image{max-width:64px;}}
</style>
