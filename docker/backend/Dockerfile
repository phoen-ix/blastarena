# Node 24 (LTS "Krypton"). This image has no build toolchain — the only apk is wget — so every
# native module must resolve to a prebuilt binary. isolated-vm needs
# prebuilds/linux-x64/isolated-vm.abi137.musl.node, where abi137 is Node 24's NODE_MODULE_VERSION.
# Moving to a major that isolated-vm ships no prebuild for does NOT fail loudly: its install script
# is `node-gyp-build || node-gyp rebuild`, and the `||` falls through to a source build that cannot
# succeed here. bcrypt is safe either way — it is N-API (napi-v3), keyed on the N-API version rather
# than the ABI. Keep all five Node stages in lockstep (here, Dockerfile.dev, and the two in
# docker/nginx/Dockerfile); they install from one root package-lock.json and drifted apart once
# already. Guarded by tests/backend/utils/nodeVersion.test.ts.
#
# The tag is pinned to an exact patch, not the floating `node:24-alpine`, because the tag also
# decides the npm major. npm 11 already warns that bcrypt/esbuild/isolated-vm "have install scripts
# not yet covered by allowScripts"; the scripts still run today, but bcrypt 5.1.1 is the one that
# cannot survive them being gated — its .node binary is fetched from GitHub Releases by its install
# script, and `--fallback-to-build` then hits node-gyp, which has no toolchain here. A floating tag
# would import that change silently on a future rebuild. Bump this deliberately for Node patches.
FROM node:24.19.0-alpine3.24 AS builder

WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

# Install dependencies
# npm ci, not npm install: the lockfile is copied above and must be honoured, or two
# builds of the same commit can ship different transitive dependencies. (audit NPM-CI-1)
RUN npm ci --workspace=shared --workspace=backend

# Copy source
COPY shared/ ./shared/
COPY backend/ ./backend/

# Build shared first, then backend
RUN npm run build --workspace=shared && npm run build --workspace=backend

FROM node:24.19.0-alpine3.24

WORKDIR /app

RUN apk add --no-cache wget

COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/

RUN npm ci --workspace=shared --workspace=backend --omit=dev

COPY --from=builder /app/shared/dist ./shared/dist
COPY shared/package.json ./shared/
COPY --from=builder /app/backend/dist ./backend/dist
COPY backend/src/db/migrations ./backend/src/db/migrations
COPY backend/locales ./backend/locales
COPY docs/ ./docs/

COPY docker/backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Drop root. This process executes untrusted, admin-uploaded bot and enemy AI (in isolated-vm
# isolates) and writes to five bind-mounted host directories; running it as uid 0 removed the
# second layer of defence behind the isolate boundary and left root-owned files on the host.
# The node:24.19.0-alpine3.24 image already provides the `node` user (uid 1000). (audit CONTAINER-ROOT-1)
RUN mkdir -p /app/gamelogs /app/simulations /app/replays /app/ai /app/enemy-ai \
    && chown -R node:node /app
USER node

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
