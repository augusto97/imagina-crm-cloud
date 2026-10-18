#!/usr/bin/env bash
#
# v0.1.283 (ADR-S43) — Aplica una copia completa en un servidor RECIÉN
# INSTALADO con install.sh (modo recuperación). Lo lanza el API desde el
# asistente /recuperar (o `imagina-restore` por consola) con la copia ya
# bajada del Drive y descifrada.
#
#   BASE_PATH=/opt/imagina-base ./recover-from-snapshot.sh /ruta/copia.tar
#
# Pasos (cada uno se anota en RECOVERY_STATUS_FILE para que el asistente lo
# muestre):
#   env      instala el .env de la copia (los secretos del servidor viejo:
#            SECRETS_KEY, contraseñas de Postgres/Redis…), conservando la URL
#            y el layout de ESTE servidor. Lo de antes queda como
#            .env.production.installer-<ts>.
#   data     recrea Postgres y Redis con esas contraseñas (base VACÍA: sólo
#            se permite si no hay empresas — nunca pisa un servidor en uso).
#   version  si la copia es de otra versión, instala ESA versión (como
#            bootstrap-server.sh) para que el esquema coincida con el código.
#   restore  base + archivos + ajustes de plataforma (snapshot-restore.sh).
#   restart  reinicia el API, que arranca ya con los datos restaurados.
set -euo pipefail

TAR="${1:?Falta la ruta a la copia (.tar)}"
BASE_PATH="${BASE_PATH:-/opt/imagina-base}"
SHARED="$BASE_PATH/shared"
ENV_FILE="$SHARED/.env.production"
STATUS_FILE="${RECOVERY_STATUS_FILE:-$SHARED/recovery/status.json}"
DEPLOY="$BASE_PATH/current/deploy"
COMPOSE=(docker compose -f "$DEPLOY/docker-compose.prod.yml" --env-file "$ENV_FILE")
SERVICE="${SERVICE:-imagina-api}"
RESTART_CMD="${RESTART_CMD:-sudo systemctl restart $SERVICE}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$(dirname "$STATUS_FILE")"

status() {
    STEP="$1" MSG="$2" FILE="$STATUS_FILE" node -e '
        const fs = require("fs"); const f = process.env.FILE; let prev = {};
        try { prev = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
        const now = new Date().toISOString();
        fs.writeFileSync(f, JSON.stringify({ step: process.env.STEP, message: process.env.MSG, pct: null,
            file: prev.file ?? null, started_at: prev.started_at ?? now, updated_at: now }), { mode: 0o600 });'
    echo "→ [$1] $2"
}
fail() {
    status failed "$1"
    rm -f "$TAR"
    exit 1
}
trap 'fail "Falló un paso de la restauración (línea $LINENO). Revisa el log en $(dirname "$STATUS_FILE")."' ERR

[[ -f "$TAR" ]] || fail "No se encuentra la copia descifrada."
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 0. ¿es una copia completa? ¿el servidor está vacío? ─────────────────────
tar -C "$WORK" -xf "$TAR" --wildcards '*/manifest.json' '*/env.production' 2>/dev/null || true
PARTS="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'imagina-snapshot-*' | head -1)"
[[ -n "$PARTS" && -f "$PARTS/manifest.json" ]] || fail "El archivo no es una copia de Imagina Base."
[[ -f "$PARTS/env.production" ]] || fail "La copia no trae los secretos del servidor (.env): elige una copia completa."
SNAP_VERSION="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).app_version||"")' "$PARTS/manifest.json")"
CUR_VERSION="$(basename "$(readlink -f "$BASE_PATH/current")" | sed -E 's/^[0-9]+_//')"

PG_CONTAINER="${PG_CONTAINER:-imagina-base-prod-postgres-1}"
if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    # "Empresas", no "usuarios": el API crea solo la cuenta del superadmin al arrancar (SEC-04).
    tenants="$(docker exec "$PG_CONTAINER" sh -c 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from tenants" 2>/dev/null' || echo 0)"
    [[ "${tenants:-0}" =~ ^[0-9]+$ ]] || tenants=0
    (( tenants == 0 )) || fail "Este servidor ya tiene empresas ($tenants): la recuperación sólo se usa en un servidor recién instalado."
fi

# ── 1. env ──────────────────────────────────────────────────────────────────
status env "Instalando los secretos del servidor de la copia…"
# El mismo filtro que snapshot-restore.sh (SEC-37): una copia ajena no mete
# variables que cambian cómo arranca el proceso.
ENV_DENY_RE='^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_REPL_EXTERNAL_MODULE|LD_[A-Z_]+|DYLD_[A-Z_]+|PATH|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|IFS|GCONV_PATH|PERL5OPT|PERL5LIB|PYTHONPATH|PYTHONSTARTUP|RUBYOPT|npm_config_[A-Za-z_]+|NPM_CONFIG_[A-Z_]+|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|OPENSSL_CONF|SYSTEMD_[A-Z_]+)$'
# Lo que es de ESTE servidor (dominio y layout) se conserva del instalador.
KEEP_RE='^(APP_BASE_URL|UPDATER_BASE_PATH|PORT|COOKIE_SECURE|TRUST_PROXY|POSTGRES_PORT|REDIS_PORT)$'
key_of() { [[ "${1%$'\r'}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]] && echo "${BASH_REMATCH[2]}" || true; }
NEW="$WORK/env.new"
: > "$NEW"
while IFS= read -r line || [[ -n "$line" ]]; do
    k="$(key_of "$line")"
    if [[ -n "$k" ]]; then
        [[ "$k" =~ $ENV_DENY_RE ]] && { echo "  ⚠ se descarta $k de la copia"; continue; }
        [[ "$k" =~ $KEEP_RE ]] && continue
        [[ "$k" =~ ^RECOVERY_ ]] && continue
    fi
    printf '%s\n' "$line" >> "$NEW"
done < "$PARTS/env.production"
{
    echo
    echo "# — de este servidor (install.sh, $STAMP) —"
    grep -E '^[[:space:]]*(export[[:space:]]+)?(APP_BASE_URL|UPDATER_BASE_PATH|PORT|COOKIE_SECURE|TRUST_PROXY|POSTGRES_PORT|REDIS_PORT)[[:space:]]*=' "$ENV_FILE" || true
} >> "$NEW"
# Los puertos de Postgres/Redis son de ESTE servidor (el instalador eligió unos
# libres si el 5432/6379 estaban ocupados): las URLs de la copia se reapuntan.
port_of() { sed -nE "s/^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*\"?([0-9]+).*/\2/p" "$ENV_FILE" | tail -1; }
PG_PORT="$(port_of POSTGRES_PORT)"; REDIS_PORT="$(port_of REDIS_PORT)"
if [[ -n "$PG_PORT" ]]; then sed -i -E "/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=/ s#@(127\.0\.0\.1|localhost):[0-9]+/#@\1:$PG_PORT/#" "$NEW"; fi
if [[ -n "$REDIS_PORT" ]]; then sed -i -E "/^[[:space:]]*(export[[:space:]]+)?REDIS_URL=/ s#@(127\.0\.0\.1|localhost):[0-9]+#@\1:$REDIS_PORT#" "$NEW"; fi
cp "$ENV_FILE" "$ENV_FILE.installer-$STAMP"
install -m 600 "$NEW" "$ENV_FILE"

# ── 2. Postgres + Redis con las contraseñas de la copia ─────────────────────
status data "Recreando la base de datos y Redis con las credenciales de la copia…"
"${COMPOSE[@]}" down -v --remove-orphans
"${COMPOSE[@]}" up -d
for _ in $(seq 1 60); do
    docker exec "$PG_CONTAINER" sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break
    sleep 2
done
docker exec "$PG_CONTAINER" sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 || fail "Postgres no arrancó con las credenciales de la copia."

# ── 3 y 4. versión + restauración ───────────────────────────────────────────
if [[ -n "$SNAP_VERSION" && "$SNAP_VERSION" != "dev" && "$SNAP_VERSION" != "$CUR_VERSION" ]]; then
    status version "Instalando la versión $SNAP_VERSION (la de la copia) y restaurando los datos…"
    BASE_PATH="$BASE_PATH" bash "$DEPLOY/bootstrap-server.sh" --snapshot "$TAR" --yes
else
    status restore "Restaurando la base, los archivos y los ajustes…"
    BASE_PATH="$BASE_PATH" APP_VERSION="${SNAP_VERSION:-$CUR_VERSION}" bash "$DEPLOY/snapshot-restore.sh" "$TAR" --no-service --no-safety --skip-env --yes
fi
rm -f "$TAR"

# ── 5. reinicio ─────────────────────────────────────────────────────────────
# "done" se anota ANTES: el reinicio mata a este proceso junto con el API.
trap - ERR
status "done" "Listo: el servidor arrancó con los datos de la copia. Entra con tu cuenta de siempre."
eval "$RESTART_CMD" || status failed "Los datos se restauraron, pero no se pudo reiniciar el API: sudo systemctl restart $SERVICE"
