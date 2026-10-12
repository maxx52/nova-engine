<script setup>
import { ref, computed, onMounted } from 'vue'

const products = ref([])
const search = ref('')
const cart = ref([])
const loading = ref(true)
const error = ref('')
const visibleProducts = computed(() => products.value.filter(p => p.name.toLowerCase().includes(search.value.toLowerCase())))
const cartTotal = computed(() => cart.value.reduce((sum, item) => sum + item.price * item.quantity, 0))
const money = value => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value)
function addToCart(product) {
  const existing = cart.value.find(item => item.id === product.id)
  if (existing) existing.quantity += 1
  else cart.value.push({ ...product, quantity: 1 })
}
onMounted(async () => {
  try {
    const response = await fetch('/api/products')
    if (!response.ok) throw new Error('Ошибка загрузки каталога')
    products.value = await response.json()
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
})
</script>

<template>
  <v-app>
    <v-app-bar color="white" elevation="1">
      <v-app-bar-title class="font-weight-bold">NOVA <span class="text-primary">Engine</span></v-app-bar-title>
      <v-spacer />
      <v-chip color="primary" variant="tonal" prepend-icon="mdi-cart-outline">Корзина: {{ cart.length }} / {{ money(cartTotal) }}</v-chip>
    </v-app-bar>
    <v-main class="bg-grey-lighten-5">
      <v-container class="py-10">
        <v-sheet rounded="xl" color="primary" class="pa-8 mb-8 text-white">
          <div class="text-overline">NOVA Commerce · демоверсия</div>
          <h1 class="text-h3 font-weight-bold mb-3">Интернет-магазин на собственном движке</h1>
          <p class="text-body-1">Vue 3 + JavaScript + Vuetify. Первый шаг к модульной CMS и маркетплейсу.</p>
        </v-sheet>
        <div class="d-flex flex-wrap align-center ga-4 mb-6">
          <h2 class="text-h5 font-weight-bold">Каталог товаров</h2><v-spacer />
          <v-text-field v-model="search" label="Поиск товаров" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details style="max-width:330px" />
        </div>
        <v-alert v-if="error" type="error" class="mb-4">{{ error }}. Проверь запуск API на порту 3001.</v-alert>
        <v-progress-linear v-if="loading" indeterminate color="primary" />
        <v-row v-else>
          <v-col v-for="product in visibleProducts" :key="product.id" cols="12" sm="6" md="4">
            <v-card rounded="lg" height="100%">
              <v-card-title>{{ product.name }}</v-card-title>
              <v-card-subtitle>{{ product.category }}</v-card-subtitle>
              <v-card-text><div class="text-h6 font-weight-bold">{{ money(product.price) }}</div><p class="text-body-2 mt-3">{{ product.description }}</p></v-card-text>
              <v-card-actions><v-btn color="primary" variant="flat" prepend-icon="mdi-cart-plus" @click="addToCart(product)">В корзину</v-btn></v-card-actions>
            </v-card>
          </v-col>
        </v-row>
        <v-alert v-if="!loading && !error && !visibleProducts.length" type="info" class="mt-4">Товары не найдены</v-alert>
      </v-container>
    </v-main>
  </v-app>
</template>
