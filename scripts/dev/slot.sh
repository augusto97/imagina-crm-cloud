#!/bin/sh
# Instancia de desarrollo AISLADA para trabajar varias entregas en paralelo
# (cada una en su propia copia/worktree del repo).
#
#   sh scripts/dev/slot.sh <n 1-9> up        # instala, compila, crea la base, migra y arranca
#   sh scripts/dev/slot.sh <n> restart        # reinicia API + vite (después de compilar)
#   sh scripts/dev/slot.sh <n> stop           # apaga SÓLO los procesos de este slot
#   sh scripts/dev/slot.sh <n> status         # puertos, base y salud
#   sh scripts/dev/slot.sh <n> env            # imprime las variables (para `eval`)
#
# Cada slot tiene: API en 3100+n, app en 5180+n, base `imagina_slot_<n>` (o la de
# IMAGINA_SLOT_DB) en el
# Postgres del entorno principal, Redis DB n y logs en /tmp/imagina-dev-slot-<n>.
# Usuario de pruebas: e2e@test.local / Superadmin-pass-1 (tenant 1 del slot).
#
# Requiere el entorno principal arriba (Docker + Postgres + Redis de
# `scripts/dev/up.sh`). NUNCA correr `up.sh` ni `restart.sh` desde un slot:
# matan los procesos de TODOS los slots (buscan cualquier `node dist/main.js`).
set -e
N=$1
CMD=${2:-up}
case "$N" in
    [1-9]) ;;
    *) echo "uso: sh scripts/dev/slot.sh <1-9> up|restart|stop|status|env" >&2; exit 2 ;;
esac

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MAIN_ROOT=$(cd "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)/.." && pwd)
API_PORT=$((3100 + N))
WEB_PORT=$((5180 + N))
# IMAGINA_SLOT_DB: otra base para el mismo slot (p. ej. una nueva y limpia).
DB=${IMAGINA_SLOT_DB:-imagina_slot_$N}
LOGS=/tmp/imagina-dev-slot-$N
PG=${IMAGINA_DEV_PG_CONTAINER:-imagina-base-postgres-1}
mkdir -p "$LOGS"

export DATABASE_URL="postgres://imagina:imagina@localhost:5432/$DB"
export REDIS_URL="redis://localhost:6379/$N"
export PORT=$API_PORT
export APP_BASE_URL="http://localhost:$WEB_PORT"

kill_group() {
    f="$LOGS/$1.pid"
    [ -f "$f" ] || return 0
    pid=$(cat "$f")
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    rm -f "$f"
}

start_api() {
    (
        cd "$ROOT/apps/api"
        set -a; . ./.env; set +a
        export NODE_ENV=development \
            DEV_ALLOW_PRIVATE_EGRESS=1 \
            SMTP_ALLOW_PRIVATE_HOSTS=true \
            RATE_LIMIT_AUTH_MAX=500 \
            PLATFORM_SUPERADMINS=${PLATFORM_SUPERADMINS:-e2e@test.local} \
            BACKUPS_DIR="$LOGS/backups" \
            SECRETS_KEY=clave-dev-para-secretos-32bytes \
            FILES_SIGNING_SECRET=firma-dev-para-archivos \
            MERCADOPAGO_API_URL=http://127.0.0.1:4898/mp \
            WOMPI_API_URL=http://127.0.0.1:4898/wompi \
            WOMPI_CHECKOUT_URL=http://127.0.0.1:4898/wompi-pay/
        # .env trae PORT/DATABASE_URL/REDIS_URL del entorno principal: se pisan.
        export PORT=$API_PORT \
            DATABASE_URL="postgres://imagina:imagina@localhost:5432/$DB" \
            REDIS_URL="redis://localhost:6379/$N" \
            APP_BASE_URL="http://localhost:$WEB_PORT"
        [ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
        setsid nohup node dist/main.js >"$LOGS/api.log" 2>&1 &
        echo $! >"$LOGS/api.pid"
    )
}

start_web() {
    (
        cd "$ROOT/apps/web"
        API_URL="http://localhost:$API_PORT" setsid nohup npx vite --config vite.cloud.config.ts \
            --port "$WEB_PORT" --strictPort >"$LOGS/vite.log" 2>&1 &
        echo $! >"$LOGS/vite.pid"
    )
}

wait_up() {
    for i in $(seq 1 60); do
        curl -s -o /dev/null -w "%{http_code}" "localhost:$API_PORT/api/v1/health/live" 2>/dev/null | grep -q 200 && break
        sleep 1
    done
    for i in $(seq 1 60); do curl -s -o /dev/null "localhost:$WEB_PORT/" && break; sleep 1; done
}

status() {
    printf 'slot %s · API http://localhost:%s (%s) · app http://localhost:%s (%s) · base %s · redis db %s · logs %s\n' \
        "$N" "$API_PORT" "$(curl -s -o /dev/null -w '%{http_code}' "localhost:$API_PORT/api/v1/health/live" 2>/dev/null || true)" \
        "$WEB_PORT" "$(curl -s -o /dev/null -H 'accept: text/html' -w '%{http_code}' "localhost:$WEB_PORT/" 2>/dev/null || true)" \
        "$DB" "$N" "$LOGS"
}

case "$CMD" in
    env)
        echo "export DATABASE_URL='$DATABASE_URL' REDIS_URL='$REDIS_URL' PORT=$API_PORT APP_BASE_URL='$APP_BASE_URL'"
        echo "export E2E_BASE='http://localhost:$WEB_PORT' E2E_DB='$DB'"
        ;;
    up)
        docker exec "$PG" pg_isready -q -U imagina || {
            echo "Postgres del entorno principal no responde: correr primero sh scripts/dev/up.sh en $MAIN_ROOT" >&2
            exit 1
        }
        cd "$ROOT"
        [ -d node_modules ] || pnpm install --frozen-lockfile
        [ -f apps/api/.env ] || cp "$MAIN_ROOT/apps/api/.env" apps/api/.env
        pnpm --filter @imagina-base/shared build
        pnpm --filter @imagina-base/api build
        if ! docker exec "$PG" psql -U imagina -d postgres -tAc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
            docker exec "$PG" createdb -U imagina "$DB"
        fi
        (cd apps/api && pnpm db:migrate)
        IMAGINA_DEV_DB=$DB sh scripts/dev/create-superadmin.sh || true
        kill_group api; kill_group vite
        start_api; start_web; wait_up; status
        ;;
    restart)
        kill_group api; kill_group vite
        sleep 1
        start_api; start_web; wait_up; status
        ;;
    stop)
        kill_group api; kill_group vite
        echo "slot $N apagado"
        ;;
    status)
        status
        ;;
    *)
        echo "comando desconocido: $CMD" >&2
        exit 2
        ;;
esac
