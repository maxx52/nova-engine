<script setup>
import { ref, computed, onMounted } from 'vue'

const products = ref([])
const search = ref('')
const cart = ref([])
const loading = ref(true)
const error = ref('')
const selectedCategory = ref('Все товары')
const cartOpen = ref(false)
const mobileMenu = ref(false)
const notice = ref('')
const currency = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value)
const art = {
  'Электроника': { icon: '🎧', background: 'linear-gradient(145deg,#e8e8ff,#d4dbfb)' },
  'Дом': { icon: '🪴', background: 'linear-gradient(145deg,#fff1df,#ffe2d3)' },
  'Аксессуары': { icon: '🎒', background: 'linear-gradient(145deg,#d9f1ec,#bce3d8)' }
}
const productIcons = ['🎧','💡','🎒','☕','⌨️','🗂️']
const categories = computed(() => ['Все товары', ...new Set(products.value.map(p => p.category))])
const visibleProducts = computed(() => products.value.filter(p =>
  (selectedCategory.value === 'Все товары' || p.category === selectedCategory.value) &&
  p.name.toLowerCase().includes(search.value.trim().toLowerCase())
))
const itemCount = computed(() => cart.value.reduce((sum, item) => sum + item.quantity, 0))
const cartTotal = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0))
function addToCart(product) {
  const existing = cart.value.find(item => item.id === product.id)
  if (existing) existing.quantity += 1
  else cart.value.push({ ...product, quantity: 1 })
  notice.value = 'Товар добавлен в корзину'
  window.setTimeout(() => notice.value = '', 2400)
}
function changeQty(item, delta) {
  item.quantity += delta
  if (item.quantity <= 0) cart.value = cart.value.filter(p => p.id !== item.id)
}
function scrollToCatalog() { document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }) }
onMounted(async () => {
  try {
    const response = await fetch('/api/products')
    if (!response.ok) throw new Error('Не удалось получить товары')
    products.value = (await response.json()).filter(p=>p.published!==false)
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
})
</script>

<template>
  <div class="site-shell">
    <div class="announcement"><span>✦ Новая платформа для современной торговли</span><span class="announcement-right">NOVA Engine · Preview 0.2</span></div>
    <header class="site-header">
      <div class="container header-inner">
        <a href="#" class="logo" aria-label="NOVA — главная"><span class="logo-symbol">N</span><span>NOVA<span class="logo-dot">.</span></span><small>ENGINE</small></a>
        <nav class="main-nav" :class="{ 'nav-open': mobileMenu }" aria-label="Основная навигация">
          <a href="#" class="nav-active" @click="mobileMenu = false">Главная</a>
          <a href="#catalog" @click="mobileMenu = false">Каталог</a>
          <a href="#advantages" @click="mobileMenu = false">Преимущества</a>
        </nav>
        <div class="header-actions">
          <button class="icon-button mobile-nav-button" aria-label="Меню" @click="mobileMenu = !mobileMenu">☰</button>
          <button class="cart-trigger" @click="cartOpen = true"><span class="cart-glyph">🛍</span><span class="cart-label">Корзина</span><span class="cart-count">{{ itemCount }}</span></button>
        </div>
      </div>
    </header>

    <main>
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
        <div class="toolbar"><div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: selectedCategory === category }" @click="selectedCategory = category">{{ category }}</button></div><label class="search-box"><span>⌕</span><input v-model="search" placeholder="Поиск товаров..." aria-label="Поиск товаров"></label></div>
        <p v-if="error" class="error-message">{{ error }}. Проверь, запущен ли API на порту 3001.</p>
        <p v-if="loading" class="empty-state">Загружаем каталог…</p>
        <div v-else-if="visibleProducts.length" class="product-grid">
          <article v-for="(product, index) in visibleProducts" :key="product.id" class="product-card">
            <div class="product-image" :style="{ background: art[product.category]?.background || 'linear-gradient(145deg,#e6eaf1,#cfd9e6)' }">
              <span class="product-badge" v-if="index < 2">{{ index === 0 ? 'ХИТ ПРОДАЖ' : 'ВЫБОР NOVA' }}</span><img v-if="product.image_url" :src="product.image_url" :alt="product.name" style="width:100%;height:100%;object-fit:contain;padding:24px"><span v-else class="product-emoji">{{ productIcons[(product.id - 1) % productIcons.length] || '📦' }}</span>
              <button class="quick-add" :aria-label="'Добавить ' + product.name + ' в корзину'" @click="addToCart(product)">＋</button>
            </div>
            <div class="product-info"><span class="product-category">{{ product.category }}</span><h3>{{ product.name }}</h3><p>{{ product.description }}</p><div class="product-bottom"><strong>{{ currency(product.price) }}</strong><button @click="addToCart(product)" :disabled="product.stock===0 && product.sku">В корзину ↗</button></div></div>
          </article>
        </div>
        <p v-else-if="!error" class="empty-state">По вашему запросу товары не найдены.</p>
      </section>
    </main>
    <footer class="footer"><div class="container footer-inner"><div class="footer-brand">NOVA<span>.</span> <small>ENGINE</small></div><span>Демонстрация платформы · {{ new Date().getFullYear() }}</span><span>Создано на Vue 3 + JavaScript</span></div></footer>
    <div v-if="cartOpen" class="drawer-overlay" @click.self="cartOpen = false"><aside class="cart-drawer" aria-label="Корзина"><div class="drawer-header"><div><span class="section-kicker">ВАШИ ПОКУПКИ</span><h2>Корзина ({{ itemCount }})</h2></div><button class="close-button" aria-label="Закрыть корзину" @click="cartOpen = false">×</button></div><div v-if="!cart.length" class="drawer-empty"><span>🛍️</span><h3>В корзине пока пусто</h3><p>Добавьте понравившиеся товары из каталога.</p><button class="primary-button" @click="cartOpen = false; scrollToCatalog()">К покупкам ↗</button></div><div v-else class="cart-items"><div v-for="item in cart" :key="item.id" class="cart-item"><span class="cart-item-art">{{ productIcons[(item.id - 1) % productIcons.length] || '📦' }}</span><div class="cart-item-info"><strong>{{ item.name }}</strong><span>{{ currency(item.price) }}</span><div class="quantity-controls"><button @click="changeQty(item, -1)">−</button><b>{{ item.quantity }}</b><button @click="changeQty(item, 1)">+</button></div></div></div></div><div v-if="cart.length" class="drawer-bottom"><div class="total-row"><span>Итого</span><strong>{{ currency(cartTotal) }}</strong></div><p>Демонстрационная корзина — оформление реальных заказов появится позже.</p><button class="primary-button" disabled>Оформление скоро появится</button></div></aside></div>
    <div v-if="notice" class="toast">{{ notice }} ✓</div>
  </div>
</template>
