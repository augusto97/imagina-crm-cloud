#!/usr/bin/env bash
#
# Verifica que una copia completa (snapshot, ADR-S20) se pueda RESTAURAR, sin
# tocar nada de la app (v0.1.440).
#
# Una copia que no se puede restaurar es peor que no tener copia: da una
# tranquilidad falsa. Esto la prueba de verdad, en una base de prueba aparte:
#
#   1. Extrae la copia (menos los archivos subidos) junto a ella y VERIFICA las
#      sumas sha256 de cada parte. Los archivos subidos se leen del tar sin
#      extraerlos: suma + integridad del .tar.gz + cuántos archivos trae.
#   2. Crea una base TEMPORAL (imagina_verify_<fecha>_<pid>) en el mismo
#      servidor de Postgres y restaura ahí la base de la copia (pg_restore,
#      con el mismo manejo de versiones de snapshot-restore.sh).
#   3. Mide lo que trae: migraciones (contra el manifest), tablas, políticas
#      de RLS, permisos del rol imagina_app y cuántas empresas, personas,
#      listas, campos y registros hay — y lo mismo en la base actual, para
#      comparar.
#   4. Revisa las claves de la plataforma (redis-platform.json) y si el .env
#      trae los secretos que hacen falta para migrar (sin leer sus valores).
#   5. Borra la base temporal y lo extraído SIEMPRE (también si algo falla).
#
# La base de la app no se toca: sólo se LEE (conteos) y se crea/borra la base
# temporal. Ocupa disco mientras corre: lo extraído (la base de la copia) más
# la base restaurada; si no hay espacio, no se verifica y lo dice.
#
# Uso:
#   BASE_PATH=/opt/imagina-base ./scripts/snapshot-verify.sh <snapshot.tar[.gpg]>
#   DATABASE_URL=postgres://… ./scripts/snapshot-verify.sh <snapshot.tar>
#
# Variables:
#   BASE_PATH, DATABASE_URL, ENV_FILE  (como snapshot.sh)
#   PG_CONTAINER          docker exec si no hay psql/pg_restore en el PATH
#   SNAPSHOT_PASSPHRASE_FILE  contraseña para una copia cifrada (.gpg)
#   VERIFY_WORK_DIR       dónde extraer (default: la carpeta de la copia, no /tmp:
#                         /tmp suele vivir en memoria)
#   VERIFY_TIMEOUT        segundos máximos para restaurar (default 3600)
#   VERIFY_MIN_FREE_MB    margen de disco además de lo que hace falta (default 512)
#
# Salida: líneas legibles y, al final, UNA línea `VERIFY_JSON {…}` con el
# resultado (la lee la consola de plataforma).
# Código: 0 = la copia se restauró; 1 = la copia NO sirve (o algo falló);
#         2 = no se pudo verificar (cifrada sin contraseña, sin disco, sin
#             permiso para crear la base temporal): no dice nada de la copia.
set -uo pipefail

SNAPSHOT="${1:?Falta la ruta al snapshot (.tar o .tar.gpg)}"
START_TS="$(date +%s)"

# ── resultado ───────────────────────────────────────────────────────────────
# Todo se junta en variables R_* y se imprime como JSON al final (node arma
# el JSON: nada de escapar a mano).
R_STAGE=""; R_ERROR=""; R_SKIP=""
R_CHECKSUMS=""; R_MANIFEST_VERSION=""; R_MANIFEST_CREATED=""; R_MANIFEST_MIGR=""
R_INC_UPLOADS=""; R_INC_REDIS=""; R_INC_ENV=""; R_STORAGE=""
R_RESTORED=""; R_RESTORE_SECONDS=""; R_MIGRATIONS=""; R_TABLES=""; R_POLICIES=""; R_GRANTS=""
R_COUNTS=""; R_LIVE=""
R_UPLOADS_OK=""; R_UPLOADS_FILES=""
R_REDIS_KEYS=""; R_ENV_SECRETS=""; R_ENV_SIGNING=""; R_ENV_DB=""
R_TAR_BYTES=""

emit() {
    local code="$1"
    R_DURATION="$(( $(date +%s) - START_TS ))" \
    R_CODE="$code" \
    R_STAGE="$R_STAGE" R_ERROR="$R_ERROR" R_SKIP="$R_SKIP" R_CHECKSUMS="$R_CHECKSUMS" \
    R_MANIFEST_VERSION="$R_MANIFEST_VERSION" R_MANIFEST_CREATED="$R_MANIFEST_CREATED" R_MANIFEST_MIGR="$R_MANIFEST_MIGR" \
    R_INC_UPLOADS="$R_INC_UPLOADS" R_INC_REDIS="$R_INC_REDIS" R_INC_ENV="$R_INC_ENV" R_STORAGE="$R_STORAGE" \
    R_RESTORED="$R_RESTORED" R_RESTORE_SECONDS="$R_RESTORE_SECONDS" R_MIGRATIONS="$R_MIGRATIONS" R_TABLES="$R_TABLES" \
    R_POLICIES="$R_POLICIES" R_GRANTS="$R_GRANTS" R_COUNTS="$R_COUNTS" R_LIVE="$R_LIVE" \
    R_UPLOADS_OK="$R_UPLOADS_OK" R_UPLOADS_FILES="$R_UPLOADS_FILES" R_REDIS_KEYS="$R_REDIS_KEYS" \
    R_ENV_SECRETS="$R_ENV_SECRETS" R_ENV_SIGNING="$R_ENV_SIGNING" R_ENV_DB="$R_ENV_DB" R_TAR_BYTES="$R_TAR_BYTES" \
    node -e '
        const e = process.env;
        const num = (v) => (v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
        const bool = (v) => (v === "true" ? true : v === "false" ? false : null);
        const str = (v) => (v ? v : null);
        const counts = (v) => {
            if (!v) return null;
            const [tenants, users, lists, fields, records] = v.split("|").map((x) => num(x));
            return { tenants, users, lists, fields, records };
        };
        const out = {
            code: Number(e.R_CODE),
            stage: str(e.R_STAGE),
            error: str(e.R_ERROR),
            skip: str(e.R_SKIP),
            duration_seconds: num(e.R_DURATION),
            tar_bytes: num(e.R_TAR_BYTES),
            checksums_ok: bool(e.R_CHECKSUMS),
            manifest: e.R_MANIFEST_CREATED || e.R_MANIFEST_VERSION ? {
                app_version: str(e.R_MANIFEST_VERSION),
                created_at: str(e.R_MANIFEST_CREATED),
                migrations_applied: num(e.R_MANIFEST_MIGR),
                storage_driver: str(e.R_STORAGE),
                includes: { uploads: e.R_INC_UPLOADS === "true", redis: e.R_INC_REDIS === "true", env: e.R_INC_ENV === "true" },
            } : null,
            db: e.R_RESTORED ? {
                restored: e.R_RESTORED === "true",
                restore_seconds: num(e.R_RESTORE_SECONDS),
                migrations: num(e.R_MIGRATIONS),
                tables: num(e.R_TABLES),
                policies: num(e.R_POLICIES),
                grants_ok: bool(e.R_GRANTS),
                counts: counts(e.R_COUNTS),
            } : null,
            live: counts(e.R_LIVE),
            uploads: e.R_UPLOADS_OK ? { ok: e.R_UPLOADS_OK === "true", files: num(e.R_UPLOADS_FILES) } : null,
            platform_keys: num(e.R_REDIS_KEYS),
            env: e.R_ENV_SECRETS ? { secrets_key: e.R_ENV_SECRETS === "true", files_signing_secret: e.R_ENV_SIGNING === "true", database_url: e.R_ENV_DB === "true" } : null,
        };
        process.stdout.write("VERIFY_JSON " + JSON.stringify(out) + "\n");
    '
}

# El mensaje de error: las últimas líneas útiles, sin la URL de la base (lleva
# la contraseña).
clean_err() {
    sed -E 's#postgres(ql)?://[^ ]*#<base>#g' | grep -v '^[[:space:]]*$' | tail -n 3 | tr '\n' ' ' | cut -c1-400
}
fail() { R_STAGE="$1"; R_ERROR="$2"; echo "✗ $2" >&2; finish 1; }
skip() { R_STAGE="$1"; R_SKIP="$2"; R_ERROR="$3"; echo "· no se verificó: $3" >&2; finish 2; }

# ── entorno ─────────────────────────────────────────────────────────────────
BASE_PATH="${BASE_PATH:-}"
ENV_FILE="${ENV_FILE:-${BASE_PATH:+$BASE_PATH/shared/.env.production}}"
load_env_file() {
    local line key val
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
        key="${BASH_REMATCH[2]}"; val="${BASH_REMATCH[3]}"
        val="${val#"${val%%[![:space:]]*}"}"
        if [[ "$val" =~ ^\"(.*)\"[[:space:]]*$ ]]; then val="${BASH_REMATCH[1]}"
        elif [[ "$val" =~ ^\'(.*)\'[[:space:]]*$ ]]; then val="${BASH_REMATCH[1]}"
        else val="${val%"${val##*[![:space:]]}"}"; fi
        export "$key=$val"
    done < "$1"
}
if [[ -z "${DATABASE_URL:-}" && -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    load_env_file "$ENV_FILE"
fi

[[ -f "$SNAPSHOT" ]] || { R_STAGE="open"; R_ERROR="No existe la copia: $(basename "$SNAPSHOT")"; emit 1; exit 1; }
R_TAR_BYTES="$(stat -c %s "$SNAPSHOT" 2>/dev/null || echo 0)"
[[ -n "${DATABASE_URL:-}" ]] || { R_STAGE="setup"; R_SKIP="no_database"; R_ERROR="Falta DATABASE_URL"; emit 2; exit 2; }

PG_CONTAINER="${PG_CONTAINER:-imagina-base-prod-postgres-1}"
if command -v psql >/dev/null 2>&1 && command -v pg_restore >/dev/null 2>&1; then
    psql_cmd() { psql "$@"; }
    HOST_TOOLS=1
elif docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    psql_cmd() { docker exec -i "$PG_CONTAINER" psql "$@"; }
    HOST_TOOLS=0
else
    R_STAGE="setup"; R_SKIP="no_tools"; R_ERROR="No hay psql/pg_restore en el servidor ni el contenedor '$PG_CONTAINER'"
    emit 2; exit 2
fi

WORK_PARENT="${VERIFY_WORK_DIR:-$(dirname "$SNAPSHOT")}"
WORK="$(mktemp -d "$WORK_PARENT/.verify-XXXXXX" 2>/dev/null)" || {
    R_STAGE="setup"; R_SKIP="no_space"; R_ERROR="No se pudo crear la carpeta de trabajo en $WORK_PARENT"; emit 2; exit 2;
}
SCRATCH_DB="imagina_verify_$(date -u +%Y%m%d%H%M%S)_$$"
SCRATCH_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];process.stdout.write(u.toString())' "$DATABASE_URL" "$SCRATCH_DB")"
SCRATCH_CREATED=0

cleanup() {
    if [[ $SCRATCH_CREATED -eq 1 ]]; then
        psql_cmd "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE)" >/dev/null 2>&1 \
            || psql_cmd "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null 2>&1 \
            || echo "  ⚠ no se pudo borrar la base temporal $SCRATCH_DB: bórrala a mano" >&2
        SCRATCH_CREATED=0
    fi
    rm -rf "$WORK"
}
finish() {
    cleanup
    emit "$1"
    exit "$1"
}
trap 'cleanup' EXIT
trap 'cleanup; exit 130' INT TERM

echo "→ verificando $(basename "$SNAPSHOT")"

# Bases temporales que quedaron de una verificación cortada (el proceso se
# mató antes de llegar a borrarla). Una a la vez: la consola toma un lock.
LEFTOVERS="$(psql_cmd "$DATABASE_URL" -At -c "select datname from pg_database where datname like 'imagina\_verify\_%' and datname <> '$SCRATCH_DB'" 2>/dev/null || true)"
for db in $LEFTOVERS; do
    [[ "$db" =~ ^imagina_verify_[0-9]+_[0-9]+$ ]] || continue
    echo "  · borro una base temporal que quedó de antes: $db"
    psql_cmd "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1 || true
done

# ── 1. descifrar ────────────────────────────────────────────────────────────
TAR="$SNAPSHOT"
if [[ "$SNAPSHOT" == *.gpg ]]; then
    if [[ -z "${SNAPSHOT_PASSPHRASE_FILE:-}" ]]; then
        skip "decrypt" "encrypted" "La copia está cifrada con una clave GPG: se verifica por consola con SNAPSHOT_PASSPHRASE_FILE."
    fi
    echo "→ descifrando"
    TAR="$WORK/snapshot.tar"
    if ! err="$(gpg --batch --yes --pinentry-mode loopback --passphrase-file "$SNAPSHOT_PASSPHRASE_FILE" --decrypt --output "$TAR" "$SNAPSHOT" 2>&1)"; then
        fail "decrypt" "No se pudo descifrar la copia: $(printf '%s' "$err" | clean_err)"
    fi
fi

# ── disco: lo extraído (sin los archivos subidos) + la base restaurada ──────
# La base restaurada ocupa más o menos lo mismo que la actual (que además trae
# lo borrado y los índices inflados): es un buen techo.
LIVE_DB_BYTES="$(psql_cmd "$DATABASE_URL" -At -c 'select pg_database_size(current_database())' 2>/dev/null || echo 0)"
DUMP_BYTES="$(tar -tvf "$TAR" --wildcards '*/db.dump' 2>/dev/null | awk '{print $3}' | head -1)"
DUMP_BYTES="${DUMP_BYTES:-0}"
FREE_BYTES="$(df -B1 --output=avail "$WORK" 2>/dev/null | tail -1 | tr -d ' ')"
MARGIN=$(( ${VERIFY_MIN_FREE_MB:-512} * 1024 * 1024 ))
NEEDED=$(( DUMP_BYTES + LIVE_DB_BYTES + LIVE_DB_BYTES / 5 + MARGIN ))
if [[ -n "$FREE_BYTES" && "$FREE_BYTES" =~ ^[0-9]+$ && "$FREE_BYTES" -lt "$NEEDED" ]]; then
    skip "disk" "no_space" "Falta espacio en disco para probarla: quedan $(( FREE_BYTES / 1048576 )) MB y hacen falta unos $(( NEEDED / 1048576 )) MB."
fi

# ── 2. extraer (sin los archivos subidos) y verificar sumas ─────────────────
echo "→ extrayendo y verificando sumas"
if ! err="$(tar -C "$WORK" -xf "$TAR" --exclude='*/uploads.tar.gz' 2>&1)"; then
    fail "extract" "El archivo está dañado: no se pudo abrir ($(printf '%s' "$err" | clean_err))"
fi
PARTS="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'imagina-snapshot-*' | head -1)"
[[ -n "$PARTS" && -f "$PARTS/manifest.json" && -f "$PARTS/checksums.sha256" ]] || fail "extract" "No es una copia completa: falta el manifest o las sumas."
[[ -f "$PARTS/db.dump" ]] || fail "extract" "La copia no trae la base de datos (db.dump)."

# Sumas de lo extraído…
if ! err="$(cd "$PARTS" && grep -v ' uploads.tar.gz$' checksums.sha256 | sha256sum --quiet -c - 2>&1)"; then
    R_CHECKSUMS="false"
    fail "checksums" "Las sumas no coinciden: la copia está dañada o la modificaron ($(printf '%s' "$err" | clean_err))."
fi
# …y de los archivos subidos, leídos del tar sin extraerlos: la suma y que el
# .tar.gz se lea entero.
if grep -q ' uploads.tar.gz$' "$PARTS/checksums.sha256"; then
    echo "→ revisando los archivos subidos"
    want="$(grep ' uploads.tar.gz$' "$PARTS/checksums.sha256" | cut -d' ' -f1)"
    mkfifo "$WORK/up.fifo"
    ( sha256sum < "$WORK/up.fifo" | cut -d' ' -f1 > "$WORK/up.sha" ) &
    SHA_PID=$!
    if tar -xOf "$TAR" --wildcards '*/uploads.tar.gz' | tee "$WORK/up.fifo" | tar -tzf - > "$WORK/up.list" 2>"$WORK/up.err"; then
        wait "$SHA_PID" || true
        got="$(cat "$WORK/up.sha" 2>/dev/null)"
        R_UPLOADS_FILES="$(grep -vc '/$' "$WORK/up.list" || true)"
        if [[ "$got" == "$want" ]]; then
            R_UPLOADS_OK="true"
        else
            R_UPLOADS_OK="false"; R_CHECKSUMS="false"
            fail "checksums" "La suma de los archivos subidos no coincide: la copia está dañada."
        fi
    else
        wait "$SHA_PID" 2>/dev/null || true
        R_UPLOADS_OK="false"; R_CHECKSUMS="false"
        fail "checksums" "Los archivos subidos están dañados: no se pudieron leer ($(clean_err < "$WORK/up.err"))."
    fi
fi
R_CHECKSUMS="true"

manifest() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],m);process.stdout.write(v===undefined||v===null?"":String(v))' "$PARTS/manifest.json" "$1" 2>/dev/null; }
R_MANIFEST_VERSION="$(manifest app_version)"
R_MANIFEST_CREATED="$(manifest created_at)"
R_MANIFEST_MIGR="$(manifest migrations_applied)"
R_INC_UPLOADS="$(manifest includes.uploads)"
R_INC_REDIS="$(manifest includes.redis)"
R_INC_ENV="$(manifest includes.env)"
R_STORAGE="$(manifest storage_driver)"
[[ -n "$R_MANIFEST_CREATED" ]] || fail "manifest" "El manifest de la copia no se puede leer."

# ── 3. claves de la plataforma y secretos ───────────────────────────────────
if [[ -f "$PARTS/redis-platform.json" ]]; then
    R_REDIS_KEYS="$(node -e 'process.stdout.write(String(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).length))' "$PARTS/redis-platform.json" 2>/dev/null)" \
        || fail "platform" "Los ajustes de la plataforma de la copia (redis-platform.json) están dañados."
fi
if [[ -f "$PARTS/env.production" ]]; then
    has() { grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*[\"']?[^\"'[:space:]]" "$PARTS/env.production" && echo true || echo false; }
    R_ENV_SECRETS="$(has SECRETS_KEY)"
    R_ENV_SIGNING="$(has FILES_SIGNING_SECRET)"
    R_ENV_DB="$(has DATABASE_URL)"
fi

# ── 4. restaurar en una base temporal ───────────────────────────────────────
echo "→ restaurando en una base de prueba ($SCRATCH_DB)"
if ! err="$(psql_cmd "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$SCRATCH_DB\"" 2>&1)"; then
    skip "scratch" "no_scratch_db" "No se pudo crear la base de prueba ($(printf '%s' "$err" | clean_err)). El usuario de la base necesita permiso para crear bases."
fi
SCRATCH_CREATED=1
if ! err="$(psql_cmd "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q 2>&1 <<'SQL'
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'imagina_app') THEN CREATE ROLE imagina_app NOLOGIN; END IF;
END $$;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO imagina_app;
SQL
)"; then
    fail "scratch" "No se pudo preparar la base de prueba ($(printf '%s' "$err" | clean_err))."
fi

R_RESTORED="false"
RESTORE_START="$(date +%s)"
TIMEOUT="${VERIFY_TIMEOUT:-3600}"
if [[ $HOST_TOOLS -eq 1 ]]; then
    CLIENT_MAJOR="$(pg_restore --version | grep -oE '[0-9]+' | head -1)"
    SERVER_MAJOR="$(( $(psql_cmd "$DATABASE_URL" -At -c 'show server_version_num') / 10000 ))"
    if [ "${CLIENT_MAJOR:-0}" -gt "$SERVER_MAJOR" ]; then
        timeout "$TIMEOUT" bash -c 'pg_restore --no-owner --file=- "$1" | sed "/^SET transaction_timeout = /d" | psql "$2" -v ON_ERROR_STOP=1 -q >/dev/null' _ "$PARTS/db.dump" "$SCRATCH_URL" 2>"$WORK/restore.err"
    else
        timeout "$TIMEOUT" pg_restore --no-owner --exit-on-error --dbname="$SCRATCH_URL" "$PARTS/db.dump" 2>"$WORK/restore.err"
    fi
else
    timeout "$TIMEOUT" docker exec -i "$PG_CONTAINER" pg_restore --no-owner --exit-on-error --dbname="$SCRATCH_URL" < "$PARTS/db.dump" 2>"$WORK/restore.err"
fi
rc=$?
R_RESTORE_SECONDS="$(( $(date +%s) - RESTORE_START ))"
if [[ $rc -eq 124 ]]; then
    fail "restore" "La base tardó más de $(( TIMEOUT / 60 )) minutos en restaurarse: se cortó la prueba."
elif [[ $rc -ne 0 ]]; then
    fail "restore" "La base de la copia NO se pudo restaurar: $(clean_err < "$WORK/restore.err")"
fi
R_RESTORED="true"

# ── 5. medir lo que trae ────────────────────────────────────────────────────
echo "→ midiendo lo que trae"
q() { psql_cmd "$1" -At -v ON_ERROR_STOP=1 -c "$2" 2>"$WORK/q.err"; }
R_MIGRATIONS="$(q "$SCRATCH_URL" 'select count(*) from drizzle.__drizzle_migrations')" || R_MIGRATIONS=""
R_TABLES="$(q "$SCRATCH_URL" "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")" || R_TABLES=""
R_POLICIES="$(q "$SCRATCH_URL" 'select count(*) from pg_policies')" || R_POLICIES=""
R_GRANTS="$(q "$SCRATCH_URL" "select has_table_privilege('imagina_app', 'records', 'SELECT') and has_table_privilege('imagina_app', 'records', 'INSERT')")" || R_GRANTS=""
[[ "$R_GRANTS" == "t" ]] && R_GRANTS="true" || { [[ "$R_GRANTS" == "f" ]] && R_GRANTS="false"; }
COUNT_SQL="select (select count(*) from tenants) || '|' || (select count(*) from users) || '|' || (select count(*) from lists) || '|' || (select count(*) from fields) || '|' || (select count(*) from records)"
R_COUNTS="$(q "$SCRATCH_URL" "$COUNT_SQL")" || fail "inspect" "La base restaurada no tiene las tablas de la app ($(clean_err < "$WORK/q.err"))."
R_LIVE="$(q "$DATABASE_URL" "$COUNT_SQL")" || R_LIVE=""

echo "✓ la copia se restauró: migraciones ${R_MIGRATIONS:-?}, tablas ${R_TABLES:-?}, conteos ${R_COUNTS} (actual ${R_LIVE:-?})"
finish 0
