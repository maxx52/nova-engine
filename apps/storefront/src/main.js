import {startSeo} from './seo.js'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import App from './App.vue'
import './style.css'

const vuetify = createVuetify({ icons: { defaultSet: 'mdi' }, theme: { defaultTheme: 'light' } })
createApp(App).use(createPinia()).use(vuetify).mount('#app')

startSeo()
