#!/usr/bin/env bash
# Pruebas de pantallas en el CI (v0.1.436).
#
# Levanta una copia efímera de la app como en producción —Postgres + Redis en
# Docker, el API compilado y el front YA construido detrás de un servidor
# estático— y corre `scripts/e2e/smoke.mjs`: una empresa nueva con plantillas
# reales recorre todas las pantallas (listas, cada vista, la ficha, la
# configuración de cada lista, Ajustes, tableros, el celular en oscuro y la
# consola de Plataforma) y falla si alguna se rompe, da un error de JavaScript,
# un 5xx del API o guarda una lista bajo su slug en la caché (regla de oro nº 7).
#
#   bash scripts/e2e/ci.sh [carpeta-de-capturas]
#
# E2E_DATABASE_URL / E2E_REDIS_URL: usar una base y un Redis que ya existen
# (para correrlo en una máquina de desarrollo sin pisar sus puertos).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
SHOTS=${1:-/tmp/e2e-shots}
API_PORT=${E2E_API_PORT:-3402}
WEB_PORT=${E2E_WEB_PORT:-5402}
LOGS=${E2E_LOGS:-/tmp/e2e}
mkdir -p "$LOGS" "$SHOTS"

if [ -z "${E2E_DATABASE_URL:-}" ]; then
    docker compose -f docker/docker-compose.yml -p imagina-e2e up -d --wait
    OWN_INFRA=1
fi

export NODE_ENV=development
export PORT=$API_PORT
export DATABASE_URL=${E2E_DATABASE_URL:-postgres://imagina:imagina@localhost:5432/imagina_base}
export REDIS_URL=${E2E_REDIS_URL:-redis://localhost:6379/0}
export SECRETS_KEY=pruebas-de-pantallas-secretos-32b
export FILES_SIGNING_SECRET=pruebas-de-pantallas-firma
export APP_BASE_URL=http://localhost:$WEB_PORT
export MAIL_TRANSPORT=log
# Cada corrida registra empresas y entra varias veces desde la misma IP.
export RATE_LIMIT_AUTH_MAX=500
export UPLOADS_DIR=$LOGS/uploads
# Las páginas públicas (el formulario) se sirven con el front compilado.
export WEB_DIST_DIR=$ROOT/apps/web/dist-cloud
export E2E_OPERATOR_EMAIL=operador-e2e@ejemplo.test
export E2E_OPERATOR_PASSWORD=Operador-e2e-$RANDOM-1
export PLATFORM_SUPERADMINS=$E2E_OPERATOR_EMAIL

pnpm --filter @imagina-base/api db:migrate > "$LOGS/migrate.log" 2>&1
node apps/api/dist/main.js > "$LOGS/api.log" 2>&1 &
API_PID=$!
API_PORT=$API_PORT node scripts/dev/serve-prod.mjs "$ROOT/apps/web/dist-cloud" "$WEB_PORT" > "$LOGS/web.log" 2>&1 &
WEB_PID=$!
cleanup() {
    kill "$API_PID" "$WEB_PID" 2>/dev/null || true
    if [ -n "${OWN_INFRA:-}" ]; then docker compose -f docker/docker-compose.yml -p imagina-e2e down -v >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

for _ in $(seq 1 60); do
    curl -fsS "http://localhost:$API_PORT/api/v1/health/ready" >/dev/null 2>&1 && break
    sleep 2
done
if ! curl -fsS "http://localhost:$API_PORT/api/v1/health/ready" >/dev/null; then
    echo "el API no arrancó:"; tail -60 "$LOGS/api.log"; exit 1
fi

node scripts/help-captures/prepare-operator.mjs --email "$E2E_OPERATOR_EMAIL" --password "$E2E_OPERATOR_PASSWORD"

# El navegador: el Chrome que ya traen las máquinas de GitHub (como las capturas
# de la ayuda, v0.1.382); si no arranca, el de playwright-core.
if [ -z "${PW_CHROMIUM:-}" ]; then
    for candidate in google-chrome-stable google-chrome chromium chromium-browser; do
        bin=$(command -v "$candidate" 2>/dev/null || true)
        [ -n "$bin" ] || continue
        if PW_CHROMIUM="$bin" timeout 60 node -e '
            const { createRequire } = require("node:module");
            const { chromium } = createRequire(process.cwd() + "/package.json")("playwright-core");
            chromium.launch({ executablePath: process.env.PW_CHROMIUM })
                .then((b) => b.close())
                .catch((e) => { console.error(e.message); process.exit(1); });
        ' > "$LOGS/chrome-check.log" 2>&1; then
            export PW_CHROMIUM="$bin"
            echo "navegador: $bin ($("$bin" --version 2>/dev/null || echo '?'))"
            break
        fi
    done
fi
if [ -z "${PW_CHROMIUM:-}" ]; then
    echo "navegador: el de playwright-core (se instala)"
    pnpm exec playwright-core install --with-deps chromium > "$LOGS/playwright.log" 2>&1
fi

status=0
node scripts/e2e/smoke.mjs --base "http://localhost:$WEB_PORT" --api "http://localhost:$API_PORT" --shots "$SHOTS" || status=$?
if [ "$status" -ne 0 ]; then
    echo; echo "── últimas líneas del API ──"; tail -80 "$LOGS/api.log"
fi
exit "$status"
