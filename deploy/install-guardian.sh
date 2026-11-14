#!/usr/bin/env bash
# Instala (o actualiza) el guardián del servidor de Imagina Base (v0.1.431,
# ADR-S104). Se corre UNA vez como root; volver a correrlo lo actualiza:
#
#   bash /opt/imagina-base/current/deploy/install-guardian.sh
#
# Deja el guardián en archivos de root que la app no puede modificar
# (/usr/local/lib/imagina-base, /etc/imagina-base) y lo programa cada minuto
# con systemd. La app sólo puede pedirle una revisión dejando un archivo en
# /var/lib/imagina-base/guardian/requests (el guardián nunca lee su contenido).
set -euo pipefail

fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail "córrelo como root (el usuario de la aplicación no tiene permisos para instalarlo)."

HERE=$(cd "$(dirname "$0")" && pwd)
BASE="${BASE_PATH:-/opt/imagina-base}"
ENV_FILE="$BASE/shared/.env.production"
LIB="${GUARDIAN_LIB:-/usr/local/lib/imagina-base}"
CONF_DIR="${GUARDIAN_CONF_DIR:-/etc/imagina-base}"
STATE="${GUARDIAN_STATE:-/var/lib/imagina-base/guardian}"
UNIT_DIR="${GUARDIAN_UNIT_DIR:-/etc/systemd/system}"
SERVICE="${SERVICE:-imagina-api}"

[ -f "$HERE/guardian/imagina-guardian.sh" ] || fail "no encontré $HERE/guardian/imagina-guardian.sh (¿la versión instalada es anterior a la 0.1.431?)."
command -v systemctl >/dev/null 2>&1 || fail "este servidor no usa systemd."

env_get() {
    [ -f "$ENV_FILE" ] || return 0
    { grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$ENV_FILE" || true; } | tail -1 \
        | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

APP_BASE_URL=$(env_get APP_BASE_URL)
DOMAIN="${1:-$(printf '%s' "$APP_BASE_URL" | sed -E 's#^[a-z]+://##; s#[/:].*$##')}"
[ -n "$DOMAIN" ] || fail "no sé el dominio de la app. Pásalo así: bash $0 app.tu-dominio.com"
API_PORT=$(env_get PORT); API_PORT=${API_PORT:-3001}
APP_USER=$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true); APP_USER=${APP_USER:-root}
id "$APP_USER" >/dev/null 2>&1 || fail "no existe el usuario $APP_USER del servicio $SERVICE."

PG_CONTAINER=$(env_get PG_CONTAINER)
if [ -z "$PG_CONTAINER" ] && command -v docker >/dev/null 2>&1; then
    PG_CONTAINER=$(docker ps -a --format '{{.Names}} {{.Image}}' 2>/dev/null | awk '$2 ~ /^postgres/ {print $1; exit}')
fi

REDIS_SERVICE=
for s in redis-server redis; do
    if systemctl list-unit-files "$s.service" --no-legend 2>/dev/null | grep -q "^$s.service"; then REDIS_SERVICE=$s; break; fi
done

mkdir -p "$LIB" "$CONF_DIR" "$STATE/requests" "$STATE/state"
install -m 0755 -o root -g root "$HERE/guardian/imagina-guardian.sh" "$LIB/imagina-guardian.sh"
install -m 0755 -o root -g root "$HERE/serveravatar-nginx.sh" "$LIB/serveravatar-nginx.sh"

# Cómo se sirve la app.
WEB_MODE=none
if systemctl is-active --quiet caddy 2>/dev/null; then
    WEB_MODE=caddy
elif command -v nginx >/dev/null 2>&1; then
    SITE=$(nginx -T 2>/dev/null | awk -v d="$DOMAIN" '
      /^# configuration file / { f = $4; sub(/:$/, "", f); next }
      $1 == "server_name" { for (i = 2; i <= NF; i++) { n = $i; sub(/;$/, "", n); if (n == d) { print f; exit } } }')
    if [ -n "$SITE" ]; then
        SITE=$(readlink -f "$SITE")
        if grep -q "imagina-base.locations" "$SITE"; then
            WEB_MODE=serveravatar
        elif grep -Eq "imagina_api|127\.0\.0\.1:${API_PORT}" "$SITE"; then
            # Configuración armada a mano (deploy/nginx.conf): no se reescribe,
            # sólo se levanta Nginx si se detiene.
            WEB_MODE=nginx
        else
            echo "→ La configuración de Nginx no tiene los bloques de la app: se reponen ahora."
            bash "$LIB/serveravatar-nginx.sh" "$DOMAIN"
            WEB_MODE=serveravatar
        fi
    fi
fi

umask 022
cat > "$CONF_DIR/guardian.conf" <<CONF
# Lo escribe deploy/install-guardian.sh. Volver a correr el instalador lo rehace.
BASE=$BASE
DOMAIN=$DOMAIN
API_PORT=$API_PORT
SERVICE=$SERVICE
PG_CONTAINER=$PG_CONTAINER
REDIS_SERVICE=$REDIS_SERVICE
WEB_MODE=$WEB_MODE
APP_USER=$APP_USER
CONF
chmod 0644 "$CONF_DIR/guardian.conf"
chown root:root "$(dirname "$STATE")" "$STATE" "$STATE/state"
chmod 0755 "$(dirname "$STATE")" "$STATE"
chmod 0700 "$STATE/state"
chown "$APP_USER" "$STATE/requests"
chmod 0700 "$STATE/requests"

for unit in imagina-guardian.service imagina-guardian.timer imagina-guardian.path; do
    install -m 0644 -o root -g root "$HERE/guardian/$unit" "$UNIT_DIR/$unit"
done
systemctl daemon-reload
systemctl enable --now imagina-guardian.timer imagina-guardian.path >/dev/null
systemctl start imagina-guardian.service

echo
echo "Guardián instalado:"
echo "  dominio           $DOMAIN"
echo "  servidor web      $WEB_MODE"
echo "  base de datos     ${PG_CONTAINER:-(no encontré el contenedor: no se vigila)}"
echo "  redis             ${REDIS_SERVICE:-(no es un servicio del sistema: no se vigila)}"
echo "  usuario de la app $APP_USER"
echo
if [ -f "$STATE/status.json" ]; then
    echo "Primera revisión:"
    cat "$STATE/status.json"
    echo
fi
echo "Lo ves en la app: Plataforma → Diagnóstico → Reparación automática."
