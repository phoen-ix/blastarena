#!/usr/bin/env bash
# Docs screenshot tour: builds the production images, starts a throwaway stack on one loopback
# port, seeds demo data (e2e/docs/seed.ts) and runs the tour (e2e/docs/tour.spec.ts).
#
#   bash scripts/docs-screenshots.sh [outdir]      # PNGs to outdir (default docs/screenshots)
#
# PORT_BASE (default 24200) is the nginx port; COMPOSE_PROJECT_NAME defaults to blastarena_docs
# and must start with blastarena_ (blast-arena and blast-arena-dev are real stacks).
# Playwright output and stack logs go to ARTIFACTS (default: a new temp dir).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mkdir -p "${1:-$ROOT/docs/screenshots}" && cd "${1:-$ROOT/docs/screenshots}" && pwd)
ARTIFACTS=${ARTIFACTS:-$(mktemp -d)}
mkdir -p "$ARTIFACTS"

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-blastarena_docs}
case $COMPOSE_PROJECT_NAME in
  blastarena_*) ;;
  *) echo "refusing COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME (must start with blastarena_)" >&2; exit 2 ;;
esac
export PORT_BASE=${PORT_BASE:-24200}

# Test-only values for a stack that lives for one run.
export DB_PASSWORD=docs-db-not-a-secret
export DB_ROOT_PASSWORD=docs-root-not-a-secret
export JWT_SECRET=docs-jwt-not-a-secret-aaaaaaaaaaaaaaaaaaaaaaaa
export EMAIL_PEPPER=docs-pepper-not-a-secret-aaaaaaaaaaaaaaaaaaaaa
export TOTP_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
export APP_URL=http://127.0.0.1:$PORT_BASE
export E2E_BASE_URL=$APP_URL

# --env-file /dev/null: a developer's .env (production secrets, SMTP) never reaches this stack.
compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" --env-file /dev/null \
    -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.e2e.yml" "$@"
}
teardown() {
  compose logs --no-color >"$ARTIFACTS/stack.log" 2>&1 || true
  compose down -v --remove-orphans --rmi local >/dev/null 2>&1 || true
}
trap teardown EXIT

compose build
compose up -d --wait --wait-timeout 600

cd "$ROOT/e2e"
[ -d node_modules ] || npm ci --no-audit --no-fund
DOCS_SCREENSHOT_DIR=$OUT PLAYWRIGHT_OUTPUT_DIR=$ARTIFACTS/test-results \
  npx playwright test -c playwright.docs.config.ts
echo "screenshots: $OUT"
