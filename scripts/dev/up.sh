#!/bin/sh
# Levanta TODO el entorno de desarrollo desde cero en un contenedor nuevo de
# Claude Code (o en una máquina local): Docker, Postgres+Redis, migraciones,
# build y API+vite. Idempotente: se puede correr de nuevo sin romper nada.
#   sh scripts/dev/up.sh
set -e
. "$(dirname "$0")/env.sh"
cd "$ROOT"

# 1. Docker (en el contenedor de Claude Code el daemon no arranca solo).
if ! docker info >/dev/null 2>&1; then
    echo "→ arrancando dockerd"
    (setsid nohup dockerd >"$LOGS/dockerd.log" 2>&1 &)
    for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi

# 2. Postgres 16 + Redis 7 (docker/docker-compose.yml).
pnpm infra:up

# 3. Dependencias + .env del API.
[ -d node_modules ] || pnpm install --frozen-lockfile
[ -f apps/api/.env ] || cp .env.example apps/api/.env

# 4. Build (shared primero: api y web lo consumen compilado) + migraciones.
pnpm --filter @imagina-base/shared build
pnpm --filter @imagina-base/api build
pnpm db:migrate

# 5. API (3001) + vite (5174).
sh scripts/dev/restart.sh

# 6. Usuario superadmin de pruebas (si no existe).
sh scripts/dev/create-superadmin.sh || true
