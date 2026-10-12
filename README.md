# NOVA Engine

Модульная платформа для сайтов, интернет-магазинов и маркетплейсов на **JavaScript**.

## Технологии
- Vue 3, Vite, Vuetify 3, Pinia, Vue Router
- Node.js + Fastify (API)
- PostgreSQL (планируется)

## Запуск
Требуется Node.js 22+ и npm.

```bash
npm install
npm run dev
```

Витрина: http://localhost:5173  
API: http://localhost:3001/health

## Структура
- `apps/storefront` — витрина на Vue 3
- `apps/api` — REST API на Fastify
- `apps/admin` — будущая панель управления
- `packages` — будущие общие модули и компоненты

Версия 0.1 — стартовый каркас. Пока нет базы данных, платежей и пользовательских аккаунтов; демонстрационные товары возвращает API.
