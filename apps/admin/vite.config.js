import {defineConfig} from 'vite'
import {fileURLToPath} from 'node:url'
import vue from '@vitejs/plugin-vue'
import {httpHeaders} from '../../config/httpHeaders.js'
export default defineConfig({
 plugins:[vue()],
 build:{rollupOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),preview:fileURLToPath(new URL('./preview.html',import.meta.url))}}},
 server:{host:'127.0.0.1',port:5174,strictPort:true,headers:httpHeaders({development:true}),proxy:{'/api':'http://localhost:3001','/uploads':'http://localhost:3001'}},
 preview:{host:'127.0.0.1',headers:httpHeaders()}
})
