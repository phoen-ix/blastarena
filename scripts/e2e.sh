#!/usr/bin/env bash
# End-to-end suite: builds the production images, starts a throwaway stack on loopback ports
# (nginx on PORT_BASE, Mailpit on PORT_BASE+5) and runs the Playwright specs in e2e/ against it.
#
#   bash scripts/e2e.sh [playwright args]    # e.g. player/rooms.spec.ts, --grep @smoke
#
# PORT_BASE (default 24200); COMPOSE_PROJECT_NAME defaults to blastarena_e2e and must start with
# blastarena_ (blast-arena and blast-arena-dev are real stacks). Playwright output, the HTML
# report and the stack log go to ARTIFACTS (default: a new temp dir).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARTIFACTS=${ARTIFACTS:-$(mktemp -d)}
mkdir -p "$ARTIFACTS"

export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-blastarena_e2e}
case $COMPOSE_PROJECT_NAME in
  blastarena_*) ;;
  *) echo "refusing COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME (must start with blastarena_)" >&2; exit 2 ;;
esac
export PORT_BASE=${PORT_BASE:-24200}
export MAILPIT_PORT=$((PORT_BASE + 5))

# Test-only values for a stack that lives for one run.
export DB_PASSWORD=e2e-db-not-a-secret
export DB_ROOT_PASSWORD=e2e-root-not-a-secret
export JWT_SECRET=e2e-jwt-not-a-secret-aaaaaaaaaaaaaaaaaaaaaaaaaa
export EMAIL_PEPPER=e2e-pepper-not-a-secret-aaaaaaaaaaaaaaaaaaaaaa
export TOTP_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
export SMTP_HOST=mailpit SMTP_PORT=1025 SMTP_USER=e2e SMTP_PASSWORD=e2e
export APP_URL=http://127.0.0.1:$PORT_BASE
export E2E_BASE_URL=$APP_URL
export E2E_MAILPIT_URL=http://127.0.0.1:$MAILPIT_PORT
# The frontend exposes window.__e2eScenes() (frontend/src/main.ts) in this build only.
export VITE_E2E_HOOKS=1

# --env-file /dev/null: a developer's .env (production secrets, SMTP) never reaches this stack.
compose() {
  docker compose -p "$COMPOSE_PROJECT_NAME" --env-file /dev/null --profile mail \
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
PLAYWRIGHT_OUTPUT_DIR=$ARTIFACTS/test-results PLAYWRIGHT_HTML_OUTPUT_DIR=$ARTIFACTS/report \
  npx playwright test "$@"
