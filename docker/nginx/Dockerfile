# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/

RUN npm install --workspace=shared --workspace=frontend

COPY shared/ ./shared/
COPY frontend/ ./frontend/

RUN npm run build --workspace=frontend

# Stage 2: Dev frontend (for docker-compose.dev.yml)
FROM node:20-alpine AS frontend-dev

WORKDIR /app

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY frontend/package.json ./frontend/

RUN npm install --workspace=shared --workspace=frontend

COPY shared/ ./shared/
COPY frontend/ ./frontend/

EXPOSE 5173

CMD ["npx", "--workspace=frontend", "vite", "--host", "0.0.0.0"]

# Stage 3: Dev nginx (proxies to Vite dev server)
FROM nginx:alpine AS nginx-dev

COPY docker/nginx/nginx.dev.conf /etc/nginx/nginx.conf
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/502.html /usr/share/nginx/html/502.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

# Stage 4: Production nginx (default target)
FROM nginx:alpine

COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/502.html /usr/share/nginx/html/502.html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
