<script setup>
import { ref, computed, onMounted } from 'vue'
import ContentPage from './ContentPage.vue'

const siteSettings=ref({name:'NOVA',logo_url:'',home_slug:null,shop_enabled:true,menu:[]})
const settingsReady=ref(false)
const settingsError=ref('')
const shopEnabled=computed(()=>siteSettings.value.shop_enabled)
const isShopLink=url=>/^\/(catalog|product)(\/|$|[?#])/.test(url) || url==='/#catalog' || url==='/#advantages'
const menuItems=computed(()=>siteSettings.value.menu.filter(item=>shopEnabled.value||!isShopLink(item.url)))
const routePath = ref(location.pathname)
window.addEventListener('popstate', () => { routePath.value = location.pathname })
const contentPath=computed(()=>routePath.value==='/' && siteSettings.value.home_slug ? '/'+siteSettings.value.home_slug : routePath.value)
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
const mobileMenu = ref(false)
const notice = ref('')
const activeProduct = ref(null)
const chosenVariant = ref(-1)
const selectedVariant = computed(()=>activeProduct.value?.variants?.[chosenVariant.value] || null)
const currentImage = ref('')
const productImages = computed(() => activeProduct.value ? (activeProduct.value.images?.length ? activeProduct.value.images : (activeProduct.value.image_url ? [activeProduct.value.image_url] : [])) : [])
function openProduct(product) { chosenVariant.value=-1;activeProduct.value = product; currentImage.value = productImages.value[0] || ''; routePath.value = '/product/' + product.id; history.pushState({ productId: product.id }, '', '/product/' + product.id); window.scrollTo({top:0,behavior:'smooth'}) }
function closeProduct() { activeProduct.value = null; routePath.value = '/'; history.pushState({}, '', '/'); window.scrollTo({top:0,behavior:'smooth'}) }
function syncUrl() { chosenVariant.value=-1;const match = location.pathname.match(/^\/product\/(\d+)\/?$/); activeProduct.value = match ? (products.value.find(p=>p.id===Number(match[1])) || null) : null; currentImage.value = activeProduct.value?.image_url || activeProduct.value?.images?.[0] || '' }
const currency = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value)
const art = {
  'Электроника': { icon: '🎧', background: 'linear-gradient(145deg,#e8e8ff,#d4dbfb)' },
  'Дом': { icon: '🪴', background: 'linear-gradient(145deg,#fff1df,#ffe2d3)' },
  'Аксессуары': { icon: '🎒', background: 'linear-gradient(145deg,#d9f1ec,#bce3d8)' }
}
const productIcons = ['🎧','💡','🎒','☕','⌨️','🗂️']
const categories = computed(() => ['Все товары', ...new Set(products.value.map(p => p.category))])
const visibleProducts = computed(() => products.value.filter(p =>
  (selectedCategory.value === 'Все товары' || descendantNames.value.includes(p.category)) &&
  (!attributeFilter.value || (p.attributes||[]).some(a=>a.name+'::'+a.value===attributeFilter.value)) &&
  [p.name,p.sku,p.description,...(p.attributes||[]).flatMap(a=>[a.name,a.value])].join(' ').toLowerCase().includes(search.value.trim().toLowerCase())
))
const itemCount = computed(() => cart.value.reduce((sum, item) => sum + item.quantity, 0))
const cartTotal = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0))
function addToCart(product,variant=null) {
  const choice=variant || (product.variants?.length ? product.variants.find(v=>v.stock>0) : null)
  if(product.variants?.length && !choice){notice.value='Нет доступных вариантов';return}
  if(choice && choice.stock<=0){notice.value='Вариант отсутствует';return}
  const key=product.id+':'+(choice?.name||'base')
  const existing=cart.value.find(item=>item.cartKey===key)
  if(existing)existing.quantity+=1
  else cart.value.push({...product,cartKey:key,name:choice?product.name+' — '+choice.name:product.name,price:choice?.price??product.price,quantity:1})

  notice.value = 'Товар добавлен в корзину'
  window.setTimeout(() => notice.value = '', 2400)
}
function changeQty(item, delta) {
  item.quantity += delta
  if (item.quantity <= 0) cart.value = cart.value.filter(p => p.id !== item.id)
}
function scrollToCatalog() { document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }) }
onMounted(async () => {
  window.addEventListener('popstate',syncUrl)
  try {
    const settingsResponse=await fetch('/api/settings')
    if(!settingsResponse.ok)throw Error('Не удалось загрузить настройки сайта')
    siteSettings.value=await settingsResponse.json()
    document.title=siteSettings.value.name
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
  <div v-if="!settingsReady" class="empty-state" role="status">{{settingsError || 'Загрузка сайта…'}}</div>
  <div v-else class="site-shell">
    <div class="announcement"><span>{{siteSettings.name}}</span><span class="announcement-right">NOVA Engine · Preview 0.10</span></div>
    <header class="site-header">
      <div class="container header-inner">
        <a href="/" class="logo" :aria-label="siteSettings.name+' — главная'"><img v-if="siteSettings.logo_url" :src="siteSettings.logo_url" :alt="siteSettings.name" class="site-logo-image"><span v-else class="logo-symbol">{{siteSettings.name.slice(0,1)}}</span><span class="site-name">{{siteSettings.name}}</span></a>
        <nav class="main-nav" :class="{ 'nav-open': mobileMenu }" aria-label="Основная навигация">
          <a v-for="(item,index) in menuItems" :key="index" :href="item.url" @click="mobileMenu=false">{{item.label}}</a>
        </nav>
        <div class="header-actions">
          <button class="icon-button mobile-nav-button" aria-label="Меню" @click="mobileMenu = !mobileMenu">☰</button>
          <button v-if="shopEnabled" class="cart-trigger" @click="cartOpen = true"><span class="cart-glyph">🛍</span><span class="cart-label">Корзина</span><span class="cart-count">{{ itemCount }}</span></button>
        </div>
      </div>
    </header>

    <ContentPage v-if="isContentRoute" :path="contentPath" :site-name="siteSettings.name" />
    <main v-else-if="!shopEnabled" class="container site-welcome"><h1>{{routePath==='/'?siteSettings.name:'Страница не найдена'}}</h1><a v-if="routePath!=='/'" href="/">На главную →</a></main>
    <main v-else-if="!activeProduct">
      <section class="hero-section">
        <div class="container hero-grid">
          <div class="hero-copy">
            <div class="eyebrow"><span class="green-dot"></span> ПРОСТРАНСТВО ВОЗМОЖНОСТЕЙ</div>
            <h1>Вещи, которые<br><em>делают жизнь</em><br>интереснее.</h1>
            <p>Технологии, уют и детали на каждый день. Откройте подборку товаров в нашем демонстрационном магазине.</p>
            <div class="hero-actions"><button class="primary-button" @click="scrollToCatalog">Смотреть каталог <span>↗</span></button><span class="hero-note">Больше выбора. Меньше лишнего.</span></div>
          </div>
          <div class="hero-art" aria-label="Подборка товаров">
            <div class="hero-circle"></div><div class="hero-decor hero-decor-one">✦</div><div class="hero-decor hero-decor-two">✳</div>
            <div class="hero-item hero-item-main">🎧</div><div class="hero-item hero-item-second">🎒</div>
            <div class="hero-floating"><span>✦</span><div><strong>Выбирай лучшее</strong><small>Каждый день</small></div></div>
          </div>
        </div>
      </section>

      <section class="benefit-strip" id="advantages">
        <div class="container benefits">
          <div><span class="benefit-icon">✧</span><span><strong>Удобный выбор</strong><small>Всё необходимое рядом</small></span></div>
          <div><span class="benefit-icon">♧</span><span><strong>Разные категории</strong><small>Товары на каждый день</small></span></div>
          <div><span class="benefit-icon">♡</span><span><strong>С любовью к деталям</strong><small>Продуманный ассортимент</small></span></div>
        </div>
      </section>

      <section class="catalog-section container" id="catalog">
        <div class="section-heading"><div><span class="section-kicker">НАШ АССОРТИМЕНТ</span><h2>Популярные товары<span class="heading-period">.</span></h2><p>Откройте для себя что-то новое.</p></div><span class="catalog-count">Найдено: {{ visibleProducts.length }}</span></div>
        <div class="toolbar"><div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: selectedCategory === category }" @click="selectedCategory = category;attributeFilter = ''">{{ category }}</button></div><select v-model="attributeFilter" aria-label="Фильтр характеристик" class="catalog-filter"><option value="">Все характеристики</option><option v-for="attr in availableAttributes" :key="attr" :value="attr">{{attr.replace('::',' — ')}}</option></select><label class="search-box"><span>⌕</span><input v-model="search" placeholder="Поиск товаров..." aria-label="Поиск товаров"></label></div>
        <p v-if="error" class="error-message">{{ error }}. Проверь, запущен ли API на порту 3001.</p>
        <p v-if="loading" class="empty-state">Загружаем каталог…</p>
        <div v-else-if="visibleProducts.length" class="product-grid">
          <article v-for="(product, index) in visibleProducts" :key="product.id" class="product-card">
            <div class="product-image" @click="openProduct(product)" style="cursor:pointer" :style="{ background: art[product.category]?.background || 'linear-gradient(145deg,#e6eaf1,#cfd9e6)' }">
              <span class="product-badge" v-if="index < 2">{{ index === 0 ? 'ХИТ ПРОДАЖ' : 'ВЫБОР NOVA' }}</span><img v-if="product.image_url" :src="product.image_url" :alt="product.name" style="width:100%;height:100%;object-fit:contain;padding:24px"><span v-else class="product-emoji">{{ productIcons[(product.id - 1) % productIcons.length] || '📦' }}</span>
              <button class="quick-add" @click.stop="addToCart(product)" :aria-label="'Добавить ' + product.name + ' в корзину'" >＋</button>
            </div>
            <div class="product-info"><span class="product-category">{{ product.category }}</span><h3><a :href="'/product/'+product.id" @click.prevent="openProduct(product)">{{ product.name }}</a></h3><p>{{ product.description }}</p><div class="product-bottom"><strong>{{ currency(product.price) }}</strong><button @click="addToCart(product)" :disabled="product.stock===0 && product.sku">В корзину ↗</button></div></div>
          </article>
        </div>
        <p v-else-if="!error" class="empty-state">По вашему запросу товары не найдены.</p>
      </section>
    </main>
    <main v-else class="container" style="padding-top:44px;padding-bottom:90px">
      <button class="detail-back" @click="closeProduct">← Назад в каталог</button>
      <div class="detail-layout">
        <div>
          <div class="detail-photo"><img v-if="currentImage" :src="currentImage" :alt="activeProduct.name"><span v-else style="font-size:90px">📦</span></div>
          <div class="detail-thumbnails"><button v-for="url in productImages" :key="url" :class="{ chosen:currentImage===url }" @click="currentImage=url"><img :src="url" :alt="activeProduct.name"></button></div>
        </div>
        <div class="detail-info">
          <span class="section-kicker">{{activeProduct.category}}</span>
          <h1>{{activeProduct.name}}</h1>
          <p class="detail-sku">Артикул: {{selectedVariant?.sku || activeProduct.sku || 'не указан'}}</p>
          <strong class="detail-price">{{currency(selectedVariant?.price ?? activeProduct.price)}}</strong>
          <p class="detail-stock">{{(selectedVariant?.stock ?? activeProduct.stock)>0?'● В наличии: '+(selectedVariant?.stock ?? activeProduct.stock):'Нет в наличии'}}</p>
          <div v-if="activeProduct.variants?.length" class="variant-picker"><strong>Выберите вариант</strong><div><button v-for="(v,i) in activeProduct.variants" :key="i" :disabled="v.stock===0" :class="{chosen:chosenVariant===i}" @click="chosenVariant=i">{{v.name}} · {{currency(v.price)}}</button></div></div><button class="primary-button" :disabled="(activeProduct.variants?.length && chosenVariant<0) || (selectedVariant?.stock===0)" @click="addToCart(activeProduct,selectedVariant)">Добавить в корзину →</button>
          <h2>Описание товара</h2>
          <p class="detail-description">{{activeProduct.description || 'Описание пока не добавлено.'}}</p><div v-if="activeProduct.attributes?.length" class="detail-attributes"><h2>Характеристики</h2><div v-for="(attr,i) in activeProduct.attributes" :key="i"><span>{{attr.name}}</span><strong>{{attr.value}}</strong></div></div>
        </div>
      </div>
    </main>
    <footer class="footer"><div class="container footer-inner"><div class="footer-brand">{{siteSettings.name}}</div><span>Демонстрация платформы · {{ new Date().getFullYear() }}</span><span>Создано на Vue 3 + JavaScript</span></div></footer>
    <div v-if="shopEnabled && cartOpen" class="drawer-overlay" @click.self="cartOpen = false"><aside class="cart-drawer" aria-label="Корзина"><div class="drawer-header"><div><span class="section-kicker">ВАШИ ПОКУПКИ</span><h2>Корзина ({{ itemCount }})</h2></div><button class="close-button" aria-label="Закрыть корзину" @click="cartOpen = false">×</button></div><div v-if="!cart.length" class="drawer-empty"><span>🛍️</span><h3>В корзине пока пусто</h3><p>Добавьте понравившиеся товары из каталога.</p><button class="primary-button" @click="cartOpen = false; scrollToCatalog()">К покупкам ↗</button></div><div v-else class="cart-items"><div v-for="item in cart" :key="item.id" class="cart-item"><span class="cart-item-art">{{ productIcons[(item.id - 1) % productIcons.length] || '📦' }}</span><div class="cart-item-info"><strong>{{ item.name }}</strong><span>{{ currency(item.price) }}</span><div class="quantity-controls"><button @click="changeQty(item, -1)">−</button><b>{{ item.quantity }}</b><button @click="changeQty(item, 1)">+</button></div></div></div></div><div v-if="cart.length" class="drawer-bottom"><div class="total-row"><span>Итого</span><strong>{{ currency(cartTotal) }}</strong></div><p>Демонстрационная корзина — оформление реальных заказов появится позже.</p><button class="primary-button" disabled>Оформление скоро появится</button></div></aside></div>
    <div v-if="notice" class="toast">{{ notice }} ✓</div>
  </div>
</template>

<style scoped>
.site-logo-image { max-width:100px;max-height:48px;object-fit:contain; }
.site-name { max-width:260px;overflow-wrap:anywhere;line-height:1.2; }
.site-welcome { min-height:65vh;padding-top:80px;padding-bottom:80px;overflow-wrap:anywhere; }
@media(max-width:600px){.site-name{max-width:160px;font-size:20px;}.site-logo-image{max-width:64px;}}
</style>
