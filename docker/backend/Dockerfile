# Node 22 (LTS) is required by isolated-vm (>=22); its musl prebuild loads with no build toolchain.
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install dependencies
RUN npm install --workspace=shared --workspace=backend

# Copy source
COPY shared/ ./shared/
COPY backend/ ./backend/

# Build shared first, then backend
RUN npm run build --workspace=shared && npm run build --workspace=backend

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache wget

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

RUN npm install --workspace=shared --workspace=backend --omit=dev

COPY --from=builder /app/shared/dist ./shared/dist
COPY shared/package.json ./shared/
COPY --from=builder /app/backend/dist ./backend/dist
COPY backend/src/db/migrations ./backend/src/db/migrations
COPY backend/locales ./backend/locales
COPY docs/ ./docs/

COPY docker/backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
