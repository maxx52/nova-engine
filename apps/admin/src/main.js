import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import App from './App.vue'
import './style.css'
createApp(App).use(createPinia()).use(createVuetify({icons:{defaultSet:'mdi'}})).mount('#app')
