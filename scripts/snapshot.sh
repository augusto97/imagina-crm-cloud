#!/usr/bin/env bash
#
# Snapshot COMPLETO de Imagina Base (v0.1.179 — ADR-S20 "Copias y migración").
#
# UN solo archivo con TODO lo que hace falta para volver a levantar la app tal
# cual estaba — en este servidor (volver a una versión anterior) o en otro
# (migrar de servidor). El backup lógico de siempre (scripts/backup.sh) sólo
# guarda la base: sin los archivos subidos y sin los secretos del .env, un
# restore en otro servidor deja logos/adjuntos rotos y contraseñas SMTP y
# secretos 2FA ilegibles (están cifrados con SECRETS_KEY).
#
# Contenido del .tar (nombre imagina-snapshot-<UTC>-v<versión>.tar[.gpg]):
#   manifest.json        versión de la app, fecha, host, migraciones aplicadas,
#                        partes con tamaño y sha256
#   db.dump              pg_dump formato custom (comprimido), CON privilegios
#                        (los GRANT al rol imagina_app viajan en el dump)
#   uploads.tar.gz       archivos subidos (storage local). Con STORAGE_DRIVER=s3
#                        no viaja: los bytes ya viven en el bucket.
#   redis-platform.json  claves `platform:*` de Redis (SMTP de plataforma,
#                        ajustes de copias). Sesiones/colas NO: son efímeras.
#   env.production       el .env del servidor (SNAPSHOT_INCLUDE_ENV=0 lo omite)
#   checksums.sha256
#
# Uso:
#   BASE_PATH=/opt/imagina-base ./scripts/snapshot.sh            # producción
#   DATABASE_URL=postgres://… ./scripts/snapshot.sh ./backups    # a mano / dev
#
# Variables (todas opcionales salvo DATABASE_URL, que se lee del env file de
# BASE_PATH si no viene):
#   BASE_PATH               raíz del layout de releases (deriva defaults de todo lo demás)
#   DATABASE_URL            conexión a la base
#   REDIS_URL               conexión a Redis (default redis://localhost:6379)
#   UPLOADS_DIR             archivos subidos (default $BASE_PATH/shared/uploads)
#   ENV_FILE                .env a incluir (default $BASE_PATH/shared/.env.production)
#   APP_VERSION             versión (default $BASE_PATH/current/VERSION)
#   BACKUP_DIR              destino (default $BASE_PATH/shared/backups o ./backups). Arg 1 lo pisa.
#   BACKUP_GPG_RECIPIENT    si está, cifra el .tar → .tar.gpg y borra el plano.
#   SNAPSHOT_KEEP           conserva los N snapshots más nuevos (default 14; 0 = no podar)
#   SNAPSHOT_INCLUDE_ENV    1 (default) incluye el env; 0 lo omite
#   PG_CONTAINER / REDIS_CONTAINER   si no hay pg_dump/redis-cli en el PATH, se
#                           usan por `docker exec` (defaults imagina-base-prod-*)
set -euo pipefail

BASE_PATH="${BASE_PATH:-}"
ENV_FILE="${ENV_FILE:-${BASE_PATH:+$BASE_PATH/shared/.env.production}}"
if [[ -z "${DATABASE_URL:-}" && -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
fi
: "${DATABASE_URL:?Falta DATABASE_URL (o BASE_PATH con shared/.env.production)}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
UPLOADS_DIR="${UPLOADS_DIR:-${BASE_PATH:+$BASE_PATH/shared/uploads}}"
BACKUP_DIR="${1:-${BACKUP_DIR:-${BASE_PATH:+$BASE_PATH/shared/backups}}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${SNAPSHOT_KEEP:-14}"
INCLUDE_ENV="${SNAPSHOT_INCLUDE_ENV:-1}"
STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
if [[ -z "${APP_VERSION:-}" ]]; then
    if [[ -n "$BASE_PATH" && -f "$BASE_PATH/current/VERSION" ]]; then
        APP_VERSION="$(tr -d '[:space:]' < "$BASE_PATH/current/VERSION")"
    else
        APP_VERSION="dev"
    fi
fi

# ── herramientas: PATH o docker exec ────────────────────────────────────────
PG_CONTAINER="${PG_CONTAINER:-imagina-base-prod-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-imagina-base-prod-redis-1}"
if command -v pg_dump >/dev/null 2>&1; then
    pg_dump_cmd() { pg_dump "$@"; }
    psql_cmd() { psql "$@"; }
elif docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    # Dentro del contenedor 127.0.0.1 ES Postgres: la misma DATABASE_URL sirve.
    pg_dump_cmd() { docker exec -i "$PG_CONTAINER" pg_dump "$@"; }
    psql_cmd() { docker exec -i "$PG_CONTAINER" psql "$@"; }
else
    echo "✗ no hay pg_dump en el PATH ni contenedor '$PG_CONTAINER' (setéa PG_CONTAINER)" >&2
    exit 1
fi
if command -v redis-cli >/dev/null 2>&1; then
    redis_cmd() { redis-cli -u "$REDIS_URL" "$@"; }
elif docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1; then
    redis_cmd() { docker exec -i "$REDIS_CONTAINER" redis-cli -u "$REDIS_URL" "$@"; }
else
    redis_cmd() { return 99; }
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="imagina-snapshot-${STAMP}-v${APP_VERSION}"
mkdir -p "$BACKUP_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PARTS="$WORK/$NAME"
mkdir -p "$PARTS"

echo "→ snapshot $NAME"

# 1. Base de datos (pg_dump custom, comprimido). SIN --no-privileges: los GRANT
#    al rol imagina_app deben viajar, si no el API restaurado no puede leer.
echo "  · base de datos (pg_dump)"
if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --format=custom --no-owner --compress=9 --file="$PARTS/db.dump" "$DATABASE_URL"
else
    pg_dump_cmd --format=custom --no-owner --compress=9 "$DATABASE_URL" > "$PARTS/db.dump"
fi
MIGRATIONS="$(psql_cmd "$DATABASE_URL" -At -c 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null || echo 0)"

# 2. Archivos subidos.
UPLOADS_INCLUDED=false
if [[ "$STORAGE_DRIVER" == "s3" ]]; then
    echo "  · uploads: STORAGE_DRIVER=s3 → los bytes viven en el bucket, no viajan"
elif [[ -n "$UPLOADS_DIR" && -d "$UPLOADS_DIR" ]]; then
    echo "  · uploads ($UPLOADS_DIR)"
    tar -C "$UPLOADS_DIR" -czf "$PARTS/uploads.tar.gz" .
    UPLOADS_INCLUDED=true
else
    echo "  · uploads: sin directorio (${UPLOADS_DIR:-UPLOADS_DIR vacío}) — se omite"
fi

# 3. Claves platform:* de Redis → JSON {clave: valor-string}.
REDIS_INCLUDED=false
if redis_cmd ping >/dev/null 2>&1; then
    echo "  · redis (platform:*)"
    {
        printf '{'
        first=1
        while IFS= read -r key; do
            [[ -z "$key" ]] && continue
            val="$(redis_cmd --json GET "$key")"
            [[ "$val" == "null" ]] && continue
            [[ $first -eq 0 ]] && printf ','
            first=0
            # --json ya devuelve la clave/valor como cadenas JSON válidas.
            printf '%s:%s' "$(redis_cmd --json ECHO "$key")" "$val"
        done < <(redis_cmd --scan --pattern 'platform:*')
        printf '}\n'
    } > "$PARTS/redis-platform.json"
    REDIS_INCLUDED=true
else
    echo "  · redis: no accesible ($REDIS_URL) — se omite (sólo afecta SMTP de plataforma)"
    printf '{}\n' > "$PARTS/redis-platform.json"
fi

# 4. Env (secretos). Sin esto el snapshot NO es portable a otro servidor.
ENV_INCLUDED=false
if [[ "$INCLUDE_ENV" == "1" && -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    echo "  · env ($ENV_FILE)"
    cp "$ENV_FILE" "$PARTS/env.production"
    chmod 600 "$PARTS/env.production"
    ENV_INCLUDED=true
else
    echo "  · env: omitido"
fi

# 5. Manifest + checksums.
part_line() { # nombre → {"name":…,"bytes":…,"sha256":…}
    local f="$PARTS/$1"
    [[ -f "$f" ]] || return 0
    printf '{"name":"%s","bytes":%s,"sha256":"%s"}' "$1" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
}
{
    printf '{"format":1,"app":"imagina-base","app_version":"%s","created_at":"%s","host":"%s","migrations_applied":%s,' \
        "$APP_VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" "${MIGRATIONS:-0}"
    printf '"storage_driver":"%s","includes":{"uploads":%s,"redis":%s,"env":%s},"parts":[' \
        "$STORAGE_DRIVER" "$UPLOADS_INCLUDED" "$REDIS_INCLUDED" "$ENV_INCLUDED"
    sep=""
    for p in db.dump uploads.tar.gz redis-platform.json env.production; do
        line="$(part_line "$p")"
        [[ -z "$line" ]] && continue
        printf '%s%s' "$sep" "$line"; sep=","
    done
    printf ']}\n'
} > "$PARTS/manifest.json"
( cd "$PARTS" && sha256sum -- * > checksums.sha256 )

# 6. Empaquetar (manifest primero: se puede leer sin extraer todo).
OUT="$BACKUP_DIR/$NAME.tar"
tar -C "$WORK" -cf "$OUT" "$NAME/manifest.json" "$NAME/checksums.sha256" \
    $(cd "$WORK" && ls "$NAME"/* | grep -v -E 'manifest.json|checksums.sha256')
if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
    echo "  · cifrando con GPG para $BACKUP_GPG_RECIPIENT"
    gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$OUT.gpg" "$OUT"
    rm -f "$OUT"
    OUT="$OUT.gpg"
elif [[ "$ENV_INCLUDED" == "true" ]]; then
    echo "  ⚠ el snapshot incluye el .env con SECRETOS y NO está cifrado: guardalo como tal" >&2
    chmod 600 "$OUT"
fi
echo "✓ snapshot listo: $OUT ($(du -h "$OUT" | cut -f1); versión $APP_VERSION, migraciones ${MIGRATIONS:-0})"

# 7. Retención por cantidad (los N más nuevos).
if [[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -gt 0 ]]; then
    find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'imagina-snapshot-*.tar' -o -name 'imagina-snapshot-*.tar.gpg' \) -printf '%T@ %p\n' \
        | sort -rn | cut -d' ' -f2- | tail -n +"$((KEEP + 1))" | while read -r old; do
            echo "→ purgado (retención $KEEP): $old"
            rm -f "$old"
        done
fi
exit 0
