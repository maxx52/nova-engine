import Fastify from 'fastify'

const app = Fastify({ logger: true })
const products = [
  { id: 1, name: 'Беспроводные наушники', category: 'Электроника', price: 3490, description: 'Компактная модель для музыки и звонков.' },
  { id: 2, name: 'Настольная лампа', category: 'Дом', price: 2190, description: 'Регулируемый свет для рабочего стола.' },
  { id: 3, name: 'Городской рюкзак', category: 'Аксессуары', price: 4590, description: 'Практичный рюкзак на каждый день.' },
  { id: 4, name: 'Термокружка', category: 'Дом', price: 1390, description: 'Сохраняет температуру напитка.' },
  { id: 5, name: 'Механическая клавиатура', category: 'Электроника', price: 6990, description: 'Для работы и игр.' },
  { id: 6, name: 'Органайзер для стола', category: 'Дом', price: 990, description: 'Порядок на рабочем месте.' }
]
app.get('/health', async () => ({ status: 'ok', product: 'NOVA Engine', version: '0.1.0' }))
app.get('/api/products', async () => products)
try { await app.listen({ port: Number(process.env.PORT || 3001), host: '0.0.0.0' }) }
catch (error) { app.log.error(error); process.exit(1) }
