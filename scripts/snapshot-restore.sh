#!/usr/bin/env bash
#
# Restaura un snapshot completo de Imagina Base (v0.1.179 — ADR-S20). Sirve
# para los dos escenarios: VOLVER a un estado anterior en este servidor, y
# LEVANTAR la app en un servidor nuevo (ver scripts/bootstrap-server.sh, que
# llama a este).
#
# Qué hace, en orden:
#   1. Descifra (si .gpg), extrae y VERIFICA checksums.
#   2. Compara la versión del snapshot con la del código instalado: un snapshot
#      MÁS NUEVO que el código se rechaza (el esquema tendría migraciones que
#      el código no conoce) salvo --force-version. Uno más viejo es normal: las
#      migraciones pendientes se aplican al final.
#   3. Pide confirmación escrita (salvo --yes).
#   4. Detiene el API (systemd; --no-service lo omite — dev / bootstrap).
#   5. Copia de seguridad de la base ACTUAL (pre-restore-<ts>.dump) para poder
#      deshacer el restore (--no-safety la omite).
#   6. Base: DROP SCHEMA public + drizzle → pg_restore. Se tira el esquema
#      entero (no --clean objeto por objeto) para que restaurar un snapshot
#      viejo sobre código nuevo no deje tablas huérfanas que después choquen
#      con las migraciones. El rol imagina_app se crea si falta.
#   7. Uploads: los actuales se apartan a uploads.pre-restore-<ts> y se
#      extraen los del snapshot.
#   8. Redis: se reponen las claves platform:* (SMTP de plataforma…).
#   9. Env: en servidor nuevo se instala; en uno existente se compara y, si
#      los secretos difieren, se deja al lado como env.production.snapshot y
#      se AVISA (--apply-env lo reemplaza, guardando el anterior).
#  10. Migraciones pendientes → arranque del API → health-check.
#
# Uso:
#   BASE_PATH=/opt/imagina-base ./scripts/snapshot-restore.sh <snapshot.tar[.gpg]> [flags]
# Flags:
#   --yes            no pregunta (para el panel y el bootstrap)
#   --dry-run        muestra qué haría y sale
#   --no-service     no detiene/arranca el servicio (dev, bootstrap)
#   --no-safety      no hace la copia previa de la base actual
#   --skip-uploads   no toca los uploads
#   --skip-redis     no toca Redis
#   --skip-env       no toca el env
#   --apply-env      reemplaza el env existente por el del snapshot (guarda el anterior)
#   --force-version  restaura aunque el snapshot sea más nuevo que el código
#   --no-migrate     no corre migraciones al final
# Variables:
#   BASE_PATH, DATABASE_URL, REDIS_URL, UPLOADS_DIR, ENV_FILE, BACKUP_DIR, APP_VERSION
#   SERVICE (default imagina-api), STOP_CMD / START_CMD, HEALTH_URL, MIGRATE_CMD
#   PG_CONTAINER / REDIS_CONTAINER (docker exec si no hay CLI en el PATH)
set -euo pipefail

SNAPSHOT="${1:?Falta la ruta al snapshot (.tar o .tar.gpg)}"; shift || true
YES=0; DRY=0; NO_SERVICE=0; NO_SAFETY=0; SKIP_UPLOADS=0; SKIP_REDIS=0; SKIP_ENV=0; APPLY_ENV=0; FORCE_VERSION=0; NO_MIGRATE=0
for a in "$@"; do
    case "$a" in
        --yes) YES=1 ;; --dry-run) DRY=1 ;; --no-service) NO_SERVICE=1 ;; --no-safety) NO_SAFETY=1 ;;
        --skip-uploads) SKIP_UPLOADS=1 ;; --skip-redis) SKIP_REDIS=1 ;; --skip-env) SKIP_ENV=1 ;;
        --apply-env) APPLY_ENV=1 ;; --force-version) FORCE_VERSION=1 ;; --no-migrate) NO_MIGRATE=1 ;;
        *) echo "flag desconocido: $a" >&2; exit 2 ;;
    esac
done
[[ -f "$SNAPSHOT" ]] || { echo "✗ no existe el snapshot: $SNAPSHOT" >&2; exit 1; }

BASE_PATH="${BASE_PATH:-}"
ENV_FILE="${ENV_FILE:-${BASE_PATH:+$BASE_PATH/shared/.env.production}}"
BACKUP_DIR="${BACKUP_DIR:-${BASE_PATH:+$BASE_PATH/shared/backups}}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$SNAPSHOT")}"
UPLOADS_DIR="${UPLOADS_DIR:-${BASE_PATH:+$BASE_PATH/shared/uploads}}"
SERVICE="${SERVICE:-imagina-api}"
STOP_CMD="${STOP_CMD:-sudo systemctl stop $SERVICE}"
START_CMD="${START_CMD:-sudo systemctl start $SERVICE}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 1. descifrar + extraer + verificar ──────────────────────────────────────
TAR="$SNAPSHOT"
if [[ "$SNAPSHOT" == *.gpg ]]; then
    echo "→ descifrando"
    TAR="$WORK/snapshot.tar"
    gpg --batch --yes --decrypt --output "$TAR" "$SNAPSHOT"
fi
echo "→ extrayendo y verificando checksums"
tar -C "$WORK" -xf "$TAR"
PARTS="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'imagina-snapshot-*' | head -1)"
[[ -n "$PARTS" && -f "$PARTS/manifest.json" ]] || { echo "✗ el archivo no es un snapshot de Imagina Base (falta manifest.json)" >&2; exit 1; }
( cd "$PARTS" && sha256sum --quiet -c checksums.sha256 ) || { echo "✗ checksums NO coinciden: snapshot corrupto o alterado" >&2; exit 1; }

manifest() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],m);process.stdout.write(v===undefined||v===null?"":String(v))' "$PARTS/manifest.json" "$1"; }
SNAP_VERSION="$(manifest app_version)"
SNAP_DATE="$(manifest created_at)"
SNAP_MIGR="$(manifest migrations_applied)"
HAS_UPLOADS="$(manifest includes.uploads)"
HAS_REDIS="$(manifest includes.redis)"
HAS_ENV="$(manifest includes.env)"
echo "  snapshot: versión $SNAP_VERSION · $SNAP_DATE · migraciones $SNAP_MIGR · uploads=$HAS_UPLOADS redis=$HAS_REDIS env=$HAS_ENV"

# ── env: de dónde salen DATABASE_URL & co ───────────────────────────────────
# En un servidor NUEVO no hay env todavía: se toma el del snapshot para poder
# conectarse (y más abajo se instala). En uno existente manda el instalado.
if [[ -z "${DATABASE_URL:-}" ]]; then
    if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
        # shellcheck disable=SC1090
        set -a; . "$ENV_FILE"; set +a
    elif [[ -f "$PARTS/env.production" ]]; then
        echo "  · sin env instalado: uso el del snapshot para conectarme"
        # shellcheck disable=SC1090
        set -a; . "$PARTS/env.production"; set +a
    fi
fi
: "${DATABASE_URL:?Falta DATABASE_URL (ni env instalado ni env en el snapshot)}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

# ── 2. versión del código vs snapshot ───────────────────────────────────────
if [[ -z "${APP_VERSION:-}" ]]; then
    if [[ -n "$BASE_PATH" && -f "$BASE_PATH/current/VERSION" ]]; then APP_VERSION="$(tr -d '[:space:]' < "$BASE_PATH/current/VERSION")"; else APP_VERSION="dev"; fi
fi
if [[ "$APP_VERSION" != "dev" && "$SNAP_VERSION" != "dev" ]]; then
    newest="$(printf '%s\n%s\n' "$APP_VERSION" "$SNAP_VERSION" | sort -V | tail -1)"
    if [[ "$newest" == "$SNAP_VERSION" && "$SNAP_VERSION" != "$APP_VERSION" ]]; then
        if [[ $FORCE_VERSION -eq 1 ]]; then
            echo "  ⚠ el snapshot ($SNAP_VERSION) es MÁS NUEVO que el código ($APP_VERSION) — sigo por --force-version" >&2
        else
            echo "✗ el snapshot es de la versión $SNAP_VERSION y el código instalado es $APP_VERSION." >&2
            echo "  Primero actualizá el código a $SNAP_VERSION (o más) y volvé a correr. (--force-version para forzar)" >&2
            exit 3
        fi
    fi
fi

# ── herramientas ────────────────────────────────────────────────────────────
PG_CONTAINER="${PG_CONTAINER:-imagina-base-prod-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-imagina-base-prod-redis-1}"
if command -v psql >/dev/null 2>&1; then
    psql_cmd() { psql "$@"; }; pg_restore_cmd() { pg_restore "$@"; }; pg_dump_cmd() { pg_dump "$@"; }
elif docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    psql_cmd() { docker exec -i "$PG_CONTAINER" psql "$@"; }
    pg_restore_cmd() { docker exec -i "$PG_CONTAINER" pg_restore "$@"; }
    pg_dump_cmd() { docker exec -i "$PG_CONTAINER" pg_dump "$@"; }
else
    echo "✗ no hay psql/pg_restore en el PATH ni contenedor '$PG_CONTAINER'" >&2; exit 1
fi
if command -v redis-cli >/dev/null 2>&1; then
    redis_cmd() { redis-cli -u "$REDIS_URL" "$@"; }
elif docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1; then
    redis_cmd() { docker exec -i "$REDIS_CONTAINER" redis-cli -u "$REDIS_URL" "$@"; }
else
    redis_cmd() { return 99; }
fi

# ── 3. plan + confirmación ──────────────────────────────────────────────────
echo "→ plan:"
echo "  · base de datos: SE REEMPLAZA por la del snapshot ($DATABASE_URL)"
[[ $NO_SAFETY -eq 0 ]] && echo "  · antes: copia de la base actual en $BACKUP_DIR/pre-restore-$STAMP.dump"
if [[ "$HAS_UPLOADS" == "true" && $SKIP_UPLOADS -eq 0 && -n "$UPLOADS_DIR" ]]; then echo "  · uploads: se reemplazan ($UPLOADS_DIR; los actuales quedan en uploads.pre-restore-$STAMP)"; fi
if [[ "$HAS_REDIS" == "true" && $SKIP_REDIS -eq 0 ]]; then echo "  · redis: se reponen las claves platform:*"; fi
if [[ "$HAS_ENV" == "true" && $SKIP_ENV -eq 0 && -n "$ENV_FILE" ]]; then
    if [[ -f "$ENV_FILE" ]]; then echo "  · env: se compara con $ENV_FILE ($([[ $APPLY_ENV -eq 1 ]] && echo 'se REEMPLAZA' || echo 'no se pisa; si difiere se deja al lado'))"; else echo "  · env: se instala en $ENV_FILE (servidor nuevo)"; fi
fi
[[ $NO_SERVICE -eq 0 ]] && echo "  · servicio $SERVICE: stop → restore → start (+ health-check)"
[[ $NO_MIGRATE -eq 0 ]] && echo "  · migraciones pendientes al final"
if [[ $DRY -eq 1 ]]; then echo "→ dry-run: no se cambió nada"; exit 0; fi
if [[ $YES -eq 0 ]]; then
    echo
    read -r -p "Escribí RESTAURAR para continuar: " answer
    [[ "$answer" == "RESTAURAR" ]] || { echo "cancelado"; exit 1; }
fi

# ── 4. detener el servicio ──────────────────────────────────────────────────
if [[ $NO_SERVICE -eq 0 ]]; then
    echo "→ deteniendo $SERVICE"
    eval "$STOP_CMD" || echo "  ⚠ no se pudo detener el servicio (¿ya estaba parado?)" >&2
fi

# ── 5. copia de seguridad de la base actual ─────────────────────────────────
if [[ $NO_SAFETY -eq 0 ]]; then
    mkdir -p "$BACKUP_DIR"
    SAFETY="$BACKUP_DIR/pre-restore-$STAMP.dump"
    echo "→ copia previa de la base actual → $SAFETY"
    if command -v pg_dump >/dev/null 2>&1; then
        pg_dump --format=custom --no-owner --compress=6 --file="$SAFETY" "$DATABASE_URL" || echo "  ⚠ la copia previa falló (¿base vacía?), sigo" >&2
    else
        pg_dump_cmd --format=custom --no-owner --compress=6 "$DATABASE_URL" > "$SAFETY" || echo "  ⚠ la copia previa falló, sigo" >&2
    fi
fi

# ── 6. base de datos ────────────────────────────────────────────────────────
echo "→ restaurando la base (drop schema + pg_restore)"
psql_cmd "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imagina_app') THEN CREATE ROLE imagina_app NOLOGIN; END IF;
END $$;
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO imagina_app;
SQL
if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --no-owner --exit-on-error --dbname="$DATABASE_URL" "$PARTS/db.dump"
else
    pg_restore_cmd --no-owner --exit-on-error --dbname="$DATABASE_URL" < "$PARTS/db.dump"
fi
# Cinturón y tiradores: por si el dump viniera sin privilegios (backups viejos
# hechos con --no-privileges), el rol de la app siempre queda con acceso.
psql_cmd "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO imagina_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO imagina_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO imagina_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO imagina_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO imagina_app;
SQL
echo "  ✓ base restaurada"

# ── 7. uploads ──────────────────────────────────────────────────────────────
if [[ "$HAS_UPLOADS" == "true" && $SKIP_UPLOADS -eq 0 && -n "$UPLOADS_DIR" && -f "$PARTS/uploads.tar.gz" ]]; then
    echo "→ uploads → $UPLOADS_DIR"
    if [[ -d "$UPLOADS_DIR" ]] && [[ -n "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]]; then
        mv "$UPLOADS_DIR" "$UPLOADS_DIR.pre-restore-$STAMP"
        echo "  · los uploads actuales quedaron en $UPLOADS_DIR.pre-restore-$STAMP"
    fi
    mkdir -p "$UPLOADS_DIR"
    tar -C "$UPLOADS_DIR" -xzf "$PARTS/uploads.tar.gz"
    echo "  ✓ uploads restaurados ($(find "$UPLOADS_DIR" -type f | wc -l) archivos)"
fi

# ── 8. redis platform:* ─────────────────────────────────────────────────────
if [[ "$HAS_REDIS" == "true" && $SKIP_REDIS -eq 0 && -f "$PARTS/redis-platform.json" ]]; then
    if redis_cmd ping >/dev/null 2>&1; then
        echo "→ redis (platform:*)"
        mkdir -p "$WORK/redis"
        node -e '
            const fs = require("fs");
            const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
            let i = 0;
            for (const [k, v] of Object.entries(data)) {
                fs.writeFileSync(`${process.argv[2]}/${i}.key`, k);
                fs.writeFileSync(`${process.argv[2]}/${i}.val`, String(v));
                i++;
            }
            process.stdout.write(String(i));
        ' "$PARTS/redis-platform.json" "$WORK/redis" > "$WORK/redis/count"
        n="$(cat "$WORK/redis/count")"
        for ((i = 0; i < n; i++)); do
            redis_cmd -x SET "$(cat "$WORK/redis/$i.key")" < "$WORK/redis/$i.val" >/dev/null
        done
        echo "  ✓ $n clave(s) repuestas"
    else
        echo "  ⚠ Redis no accesible ($REDIS_URL): no se repuso el SMTP de plataforma" >&2
    fi
fi

# ── 9. env ──────────────────────────────────────────────────────────────────
if [[ "$HAS_ENV" == "true" && $SKIP_ENV -eq 0 && -n "$ENV_FILE" && -f "$PARTS/env.production" ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
        echo "→ env: instalando $ENV_FILE (servidor nuevo)"
        mkdir -p "$(dirname "$ENV_FILE")"
        cp "$PARTS/env.production" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    elif [[ $APPLY_ENV -eq 1 ]]; then
        echo "→ env: reemplazando $ENV_FILE (el anterior queda en $ENV_FILE.pre-restore-$STAMP)"
        cp "$ENV_FILE" "$ENV_FILE.pre-restore-$STAMP"
        cp "$PARTS/env.production" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    else
        differs=0
        for k in SECRETS_KEY FILES_SIGNING_SECRET; do
            a="$(grep -E "^$k=" "$ENV_FILE" | head -1 || true)"; b="$(grep -E "^$k=" "$PARTS/env.production" | head -1 || true)"
            [[ "$a" != "$b" ]] && differs=1
        done
        if [[ $differs -eq 1 ]]; then
            cp "$PARTS/env.production" "$ENV_FILE.snapshot"; chmod 600 "$ENV_FILE.snapshot"
            echo "  ⚠ SECRETS_KEY / FILES_SIGNING_SECRET del snapshot DIFIEREN del env instalado." >&2
            echo "    Las contraseñas SMTP y los secretos 2FA restaurados sólo se leen con los del snapshot." >&2
            echo "    Quedó en $ENV_FILE.snapshot — revisalo y, si corresponde, volvé a correr con --apply-env." >&2
        else
            echo "→ env: los secretos coinciden con el instalado (no se toca)"
        fi
    fi
fi

# ── 10. migraciones + arranque + health ─────────────────────────────────────
if [[ $NO_MIGRATE -eq 0 ]]; then
    MIGRATE_CMD="${MIGRATE_CMD:-}"
    if [[ -z "$MIGRATE_CMD" && -n "$BASE_PATH" && -f "$BASE_PATH/current/apps/api/dist/db/migrate.js" ]]; then
        MIGRATE_CMD="cd '$BASE_PATH/current/apps/api' && node dist/db/migrate.js"
    fi
    if [[ -n "$MIGRATE_CMD" ]]; then
        echo "→ migraciones pendientes"
        if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
        ( eval "$MIGRATE_CMD" )
    else
        echo "→ migraciones: sin MIGRATE_CMD ni release instalado — se omiten"
    fi
fi
if [[ $NO_SERVICE -eq 0 ]]; then
    echo "→ arrancando $SERVICE"
    eval "$START_CMD"
    if [[ -n "${HEALTH_URL:-}" ]]; then
        ok=0
        for _ in $(seq 1 30); do
            if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
            sleep 2
        done
        if [[ $ok -eq 1 ]]; then echo "  ✓ API sana ($HEALTH_URL)"; else echo "  ✗ el API no respondió sano en 60 s — revisá 'journalctl -u $SERVICE'" >&2; exit 4; fi
    fi
fi
echo "✓ restore completo (snapshot $SNAP_VERSION de $SNAP_DATE)"
[[ $NO_SAFETY -eq 0 ]] && echo "  para deshacer: TARGET_DATABASE_URL=\$DATABASE_URL ./restore.sh $SAFETY"
exit 0
