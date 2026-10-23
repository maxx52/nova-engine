FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/storefront/package.json apps/storefront/package.json
RUN npm ci
COPY . .
RUN npm run build -w @nova/storefront && npm run build -w @nova/admin -- --base=/admin/
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 PORT=3001 UPLOAD_DIRECTORY=/var/lib/nova/uploads
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/storefront/dist ./apps/storefront/dist
COPY --from=build /app/shared ./shared
COPY --from=build /app/config ./config
COPY --from=build /app/examples ./examples
RUN mkdir -p /var/lib/nova/uploads && chown node:node /var/lib/nova/uploads
USER node
CMD ["node", "apps/api/src/server.js"]

FROM caddy:2-alpine AS web
COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/storefront/dist /srv/www/storefront
COPY --from=build /app/apps/admin/dist /srv/www/admin
