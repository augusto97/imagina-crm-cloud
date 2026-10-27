#!/usr/bin/env bash
# Capturas reales del centro de aprendizaje en el release (v0.1.322, ADR-S75).
#
# Levanta una copia efímera de la app (Postgres + Redis en Docker, el API
# compilado y el SPA ya construido), crea la empresa de ejemplo, graba las
# demos y deja los cuadros en $OUT (por defecto, dentro del build del SPA).
# Si algo falla, el release sigue SIN capturas: la ayuda se ve igual con sus
# ilustraciones (las capturas son un extra).
#
#   bash scripts/help-captures/ci.sh [carpeta-de-salida]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
OUT=${1:-apps/web/dist-cloud/help-media}
API_PORT=${HC_API_PORT:-3401}
WEB_PORT=${HC_WEB_PORT:-5401}
LOGS=${HC_LOGS:-/tmp/help-captures}
mkdir -p "$LOGS"

# HC_DATABASE_URL / HC_REDIS_URL: usar una base y un Redis que ya existen
# (para probarlo en una máquina de desarrollo sin pisar sus puertos).
if [ -z "${HC_DATABASE_URL:-}" ]; then
    docker compose -f docker/docker-compose.yml -p imagina-help-captures up -d --wait
    OWN_INFRA=1
fi

export NODE_ENV=development
export PORT=$API_PORT
export DATABASE_URL=${HC_DATABASE_URL:-postgres://imagina:imagina@localhost:5432/imagina_base}
export REDIS_URL=${HC_REDIS_URL:-redis://localhost:6379/0}
export SECRETS_KEY=capturas-de-ayuda-secretos-32bytes
export FILES_SIGNING_SECRET=capturas-de-ayuda-firma
export APP_BASE_URL=http://localhost:$WEB_PORT
export MAIL_TRANSPORT=log
export RATE_LIMIT_AUTH_MAX=500
export UPLOADS_DIR=$LOGS/uploads
# Operador de la plataforma para las capturas del módulo «Plataforma».
export HC_SUPERADMIN_EMAIL=operador@ejemplo.test
export HC_SUPERADMIN_PASSWORD=Operador-de-demo-$RANDOM-1
export PLATFORM_SUPERADMINS=$HC_SUPERADMIN_EMAIL

pnpm --filter @imagina-base/api db:migrate > "$LOGS/migrate.log" 2>&1
node apps/api/dist/main.js > "$LOGS/api.log" 2>&1 &
API_PID=$!
API_PORT=$API_PORT node scripts/dev/serve-prod.mjs "$ROOT/apps/web/dist-cloud" "$WEB_PORT" > "$LOGS/web.log" 2>&1 &
WEB_PID=$!
cleanup() {
    kill "$API_PID" "$WEB_PID" 2>/dev/null || true
    if [ -n "${OWN_INFRA:-}" ]; then docker compose -f docker/docker-compose.yml -p imagina-help-captures down -v >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

for i in $(seq 1 60); do
    curl -fsS "http://localhost:$API_PORT/api/v1/health/ready" >/dev/null 2>&1 && break
    sleep 2
done
curl -fsS "http://localhost:$API_PORT/api/v1/health/ready" >/dev/null

EMAIL=demo@ejemplo.test
PASS=Clave-de-demo-$RANDOM-1
node scripts/help-captures/prepare.mjs --api "http://localhost:$API_PORT" --email "$EMAIL" --password "$PASS"
node scripts/help-captures/prepare-operator.mjs --email "$HC_SUPERADMIN_EMAIL" --password "$HC_SUPERADMIN_PASSWORD"

if [ -z "${PW_CHROMIUM:-}" ]; then
    pnpm exec playwright-core install --with-deps chromium > "$LOGS/playwright.log" 2>&1
fi
node scripts/help-captures/run.mjs --base "http://localhost:$WEB_PORT" --email "$EMAIL" --password "$PASS" --out "$OUT"
echo "capturas en $OUT ($(du -sh "$OUT" | cut -f1))"
