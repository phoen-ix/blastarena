# Stage 1: Build frontend
#
# Node 24 (LTS "Krypton"). Both Node stages in this file must stay in lockstep with the two in
# docker/backend/Dockerfile*: all five install from the same root package-lock.json. This file is
# the half that drifted — it sat on Node 20 while the backend moved to 22, and nothing caught it
# because the Dockerfile tags were the only pin. Guarded by tests/backend/utils/nodeVersion.test.ts.
FROM node:24.19.0-alpine3.24 AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=shared --workspace=frontend

COPY shared/ ./shared/
COPY frontend/ ./frontend/

RUN npm run build --workspace=frontend

# Stage 2: Dev frontend (for docker-compose.dev.yml)
FROM node:24.19.0-alpine3.24 AS frontend-dev

WORKDIR /app

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=shared --workspace=frontend

COPY shared/ ./shared/
COPY frontend/ ./frontend/

EXPOSE 5173

# Regenerate public/locales from source before starting Vite (the `predev` hook is bypassed when
# Vite is run directly), so the HTTP-served locale files match the source of truth.
CMD ["sh", "-c", "node frontend/scripts/copy-locales.cjs && npx --workspace=frontend vite --host 0.0.0.0"]

# Stage 3: Dev nginx (proxies to Vite dev server)
FROM nginx:alpine AS nginx-dev

COPY docker/nginx/nginx.dev.conf /etc/nginx/nginx.conf
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/security-headers-dev.conf /etc/nginx/security-headers-dev.conf
COPY docker/nginx/502.html /usr/share/nginx/html/502.html
COPY docker/nginx/502.js /usr/share/nginx/html/502.js

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# Stage 4: Production nginx (default target)
FROM nginx:alpine

COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/502.html /usr/share/nginx/html/502.html
COPY docker/nginx/502.js /usr/share/nginx/html/502.js

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
