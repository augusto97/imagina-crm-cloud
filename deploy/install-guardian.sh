#!/usr/bin/env bash
# Instala (o actualiza) el guardián del servidor de Imagina Base (v0.1.431,
# ADR-S104). Se corre UNA vez como root; volver a correrlo lo actualiza:
#
#   bash /opt/imagina-base/current/deploy/install-guardian.sh [dominio] [--puerto 8899] [--sin-rescate]
#
# Deja el guardián en archivos de root que la app no puede modificar
# (/usr/local/lib/imagina-base, /etc/imagina-base) y lo programa cada minuto
# con systemd. La app sólo puede pedirle una revisión dejando un archivo en
# /var/lib/imagina-base/guardian/requests (el guardián nunca lee su contenido).
#
# v0.1.432 — También instala los comandos imagina-estado, imagina-reparar e
# imagina-rescate (en /usr/local/bin) y la página de rescate: un servicio aparte
# (imagina-rescue) en su propio puerto, con clave, que funciona aunque la app o
# Nginx no abran. Corre con un usuario sin permisos (imagina-rescue) y sólo
# puede pedirle cosas al guardián, igual que la app.
set -euo pipefail

fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
# Dueño de lo que se instala: root. Sólo las pruebas lo cambian (corren sin
# root, en carpetas temporales); con otro dueño no se toca nada del sistema
# porque las rutas también vienen de las pruebas.
OWNER="${GUARDIAN_OWNER:-root}"
if [ "$OWNER" = root ]; then
    [ "$(id -u)" -eq 0 ] || fail "córrelo como root (el usuario de la aplicación no tiene permisos para instalarlo)."
fi
GROUP=$(id -gn "$OWNER" 2>/dev/null) || fail "no existe el usuario $OWNER."

RESCUE_PORT_ARG=
RESCUE_OFF_ARG=0
DOMAIN_ARG=
while [ $# -gt 0 ]; do
    case "$1" in
        --puerto) RESCUE_PORT_ARG="${2:-}"; shift 2 || fail "falta el número después de --puerto." ;;
        --puerto=*) RESCUE_PORT_ARG="${1#*=}"; shift ;;
        --sin-rescate) RESCUE_OFF_ARG=1; shift ;;
        -h|--help)
            echo "Uso: bash $0 [dominio] [--puerto 8899] [--sin-rescate]"
            exit 0 ;;
        -*) fail "no conozco la opción $1 (las que hay: --puerto N, --sin-rescate)." ;;
        *) DOMAIN_ARG="$1"; shift ;;
    esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
BASE="${BASE_PATH:-/opt/imagina-base}"
ENV_FILE="$BASE/shared/.env.production"
LIB="${GUARDIAN_LIB:-/usr/local/lib/imagina-base}"
CONF_DIR="${GUARDIAN_CONF_DIR:-/etc/imagina-base}"
STATE="${GUARDIAN_STATE:-/var/lib/imagina-base/guardian}"
UNIT_DIR="${GUARDIAN_UNIT_DIR:-/etc/systemd/system}"
BIN_DIR="${GUARDIAN_BIN_DIR:-/usr/local/bin}"
SERVICE="${SERVICE:-imagina-api}"

[ -f "$HERE/guardian/imagina-guardian.sh" ] || fail "no encontré $HERE/guardian/imagina-guardian.sh (¿la versión instalada es anterior a la 0.1.431?)."
command -v systemctl >/dev/null 2>&1 || fail "este servidor no usa systemd."

env_get() {
    [ -f "$ENV_FILE" ] || return 0
    { grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$ENV_FILE" || true; } | tail -1 \
        | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

APP_BASE_URL=$(env_get APP_BASE_URL)
DOMAIN="${DOMAIN_ARG:-$(printf '%s' "$APP_BASE_URL" | sed -E 's#^[a-z]+://##; s#[/:].*$##')}"
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

# ── Página de rescate: lo que se eligió antes se conserva ────────────────
prev_conf() { [ -f "$CONF_DIR/guardian.conf" ] || return 0; { grep -E "^$1=" "$CONF_DIR/guardian.conf" || true; } | tail -1 | cut -d= -f2-; }
RESCUE_ENABLED=$(prev_conf RESCUE_ENABLED); RESCUE_ENABLED=${RESCUE_ENABLED:-1}
RESCUE_PORT=${RESCUE_PORT_ARG:-$(prev_conf RESCUE_PORT)}; RESCUE_PORT=${RESCUE_PORT:-8899}
[ -n "$RESCUE_PORT_ARG" ] && RESCUE_ENABLED=1
[ "$RESCUE_OFF_ARG" = 1 ] && RESCUE_ENABLED=0
case "$RESCUE_PORT" in ''|*[!0-9]*) fail "el puerto de la página de rescate tiene que ser un número (por ejemplo --puerto 8899)." ;; esac
if [ "$RESCUE_PORT" -lt 1024 ] || [ "$RESCUE_PORT" -gt 65535 ] || [ "$RESCUE_PORT" = "$API_PORT" ]; then
    fail "elige otro puerto para la página de rescate: entre 1024 y 65535 y distinto del de la app ($API_PORT)."
fi
RESCUE_USER="${GUARDIAN_RESCUE_USER:-imagina-rescue}"
NODE_BIN=
if [ "$RESCUE_ENABLED" = 1 ]; then
    # El mismo node con el que corre la app.
    NODE_BIN=$(systemctl show -p ExecStart --value "$SERVICE" 2>/dev/null | grep -oE 'path=[^ ;]+' | head -1 | cut -d= -f2 || true)
    case "$(basename -- "${NODE_BIN:-x}")" in node|nodejs) ;; *) NODE_BIN=$(command -v node || true) ;; esac
    if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
        echo "→ No encontré node en este servidor: la página de rescate queda apagada (los comandos por SSH sí funcionan)."
        RESCUE_ENABLED=0
    fi
fi
if [ "$RESCUE_ENABLED" = 1 ] && command -v ss >/dev/null 2>&1 \
    && ss -Hltn "( sport = :$RESCUE_PORT )" 2>/dev/null | grep -q . \
    && ! systemctl is-active --quiet imagina-rescue 2>/dev/null; then
    fail "el puerto $RESCUE_PORT ya lo usa otro programa. Elige otro: bash $0 --puerto 8898"
fi

mkdir -p "$LIB" "$CONF_DIR" "$STATE/requests" "$STATE/state"
install -m 0755 -o "$OWNER" -g "$GROUP" "$HERE/guardian/imagina-guardian.sh" "$LIB/imagina-guardian.sh"
install -m 0755 -o "$OWNER" -g "$GROUP" "$HERE/serveravatar-nginx.sh" "$LIB/serveravatar-nginx.sh"

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
RESCUE_ENABLED=$RESCUE_ENABLED
RESCUE_PORT=$RESCUE_PORT
RESCUE_USER=$RESCUE_USER
CONF
chmod 0644 "$CONF_DIR/guardian.conf"
chown "$OWNER:$GROUP" "$(dirname "$STATE")" "$STATE" "$STATE/state"
chmod 0755 "$(dirname "$STATE")" "$STATE"
chmod 0700 "$STATE/state"
chown "$APP_USER" "$STATE/requests"
chmod 0700 "$STATE/requests"

for unit in imagina-guardian.service imagina-guardian.timer imagina-guardian.path; do
    install -m 0644 -o "$OWNER" -g "$GROUP" "$HERE/guardian/$unit" "$UNIT_DIR/$unit"
done

# ── Comandos por SSH ───────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
for cmd in imagina-estado imagina-reparar imagina-rescate; do
    sed -e "s#@LIB@#$LIB#g" -e "s#@CONF_DIR@#$CONF_DIR#g" "$HERE/guardian/$cmd" > "$BIN_DIR/$cmd.tmp"
    chown "$OWNER:$GROUP" "$BIN_DIR/$cmd.tmp"
    chmod 0755 "$BIN_DIR/$cmd.tmp"
    mv -f "$BIN_DIR/$cmd.tmp" "$BIN_DIR/$cmd"
done

# ── Página de rescate ──────────────────────────────────────────────────────
rand_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
new_password() {
    local raw
    raw=$(LC_ALL=C tr -dc 'abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789' < /dev/urandom | head -c 20 || true)
    printf '%s-%s-%s-%s' "${raw:0:5}" "${raw:5:5}" "${raw:10:5}" "${raw:15:5}"
}
RESCUE_CONF="$CONF_DIR/rescue.conf"
RESCUE_PASS=
if [ "$RESCUE_ENABLED" = 1 ]; then
    if ! id "$RESCUE_USER" >/dev/null 2>&1; then
        useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$RESCUE_USER" \
            || fail "no pude crear el usuario $RESCUE_USER para la página de rescate."
    fi
    RESCUE_GROUP=$(id -gn "$RESCUE_USER")
    install -m 0755 -o "$OWNER" -g "$GROUP" "$HERE/guardian/imagina-rescue.mjs" "$LIB/imagina-rescue.mjs"
    # La carpeta es de root: la página sólo puede leer lo que hay y escribir sus
    # pedidos (requests/) y quién entró (audit.jsonl).
    mkdir -p "$STATE/rescue/requests"
    chown "$OWNER:$RESCUE_GROUP" "$STATE/rescue"
    chmod 0750 "$STATE/rescue"
    chown "$RESCUE_USER:$RESCUE_GROUP" "$STATE/rescue/requests"
    chmod 0700 "$STATE/rescue/requests"
    [ -f "$STATE/rescue/audit.jsonl" ] || : > "$STATE/rescue/audit.jsonl"
    chown "$RESCUE_USER:$RESCUE_GROUP" "$STATE/rescue/audit.jsonl"
    chmod 0600 "$STATE/rescue/audit.jsonl"

    # Certificado propio, por si el del dominio no se encuentra.
    if [ ! -f "$CONF_DIR/rescue-self.crt" ] && command -v openssl >/dev/null 2>&1; then
        openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$DOMAIN" \
            -addext "subjectAltName=DNS:$DOMAIN" \
            -keyout "$CONF_DIR/rescue-self.key" -out "$CONF_DIR/rescue-self.crt" >/dev/null 2>&1 \
            || rm -f "$CONF_DIR/rescue-self.key" "$CONF_DIR/rescue-self.crt"
    fi
    [ -f "$CONF_DIR/rescue-self.key" ] && chmod 0600 "$CONF_DIR/rescue-self.key"
    [ -f "$CONF_DIR/rescue-self.crt" ] && chmod 0644 "$CONF_DIR/rescue-self.crt"

    # La clave: si ya había una, se conserva.
    old_kv() { [ -f "$RESCUE_CONF" ] || return 0; { grep -E "^$1=" "$RESCUE_CONF" || true; } | tail -1 | cut -d= -f2-; }
    PASS_HASH=$(old_kv PASSWORD_HASH)
    SESSION_SECRET=$(old_kv SESSION_SECRET)
    if [ -z "$PASS_HASH" ]; then
        RESCUE_PASS=$(new_password)
        PASS_HASH=$(printf '%s' "$RESCUE_PASS" | "$NODE_BIN" "$LIB/imagina-rescue.mjs" hash) \
            || fail "no pude crear la clave de la página de rescate."
    fi
    [ -n "$SESSION_SECRET" ] || SESSION_SECRET=$(rand_hex 32)
    ( umask 077
      cat > "$RESCUE_CONF.tmp" <<RCONF
# Lo escribe deploy/install-guardian.sh; la clave se cambia con: imagina-rescate clave
PORT=$RESCUE_PORT
USER=$RESCUE_USER
GROUP=$RESCUE_GROUP
PASSWORD_HASH=$PASS_HASH
SESSION_SECRET=$SESSION_SECRET
STATE=$STATE
DOMAIN=$DOMAIN
NODE=$NODE_BIN
RCONF
    )
    chown "$OWNER:$GROUP" "$RESCUE_CONF.tmp"
    chmod 0600 "$RESCUE_CONF.tmp"
    mv -f "$RESCUE_CONF.tmp" "$RESCUE_CONF"

    case "$NODE_BIN" in /home/*|/root/*) PROTECT_HOME=read-only ;; *) PROTECT_HOME=yes ;; esac
    sed -e "s#@NODE@#$NODE_BIN#g" -e "s#@LIB@#$LIB#g" -e "s#@STATE@#$STATE#g" \
        -e "s#@CONF@#$RESCUE_CONF#g" -e "s#@PROTECT_HOME@#$PROTECT_HOME#g" \
        "$HERE/guardian/imagina-rescue.service" > "$UNIT_DIR/imagina-rescue.service"
    chown "$OWNER:$GROUP" "$UNIT_DIR/imagina-rescue.service"
    chmod 0644 "$UNIT_DIR/imagina-rescue.service"

    # El firewall del sistema, si está activo (el del panel o del proveedor se
    # abre aparte: lo dice el resumen).
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
        ufw allow "$RESCUE_PORT/tcp" comment 'Imagina Base: pagina de rescate' >/dev/null 2>&1 || true
    fi
fi

systemctl daemon-reload
systemctl enable --now imagina-guardian.timer imagina-guardian.path >/dev/null
if [ "$RESCUE_ENABLED" = 1 ]; then
    systemctl enable imagina-rescue >/dev/null 2>&1 || true
elif [ -f "$UNIT_DIR/imagina-rescue.service" ]; then
    systemctl disable --now imagina-rescue >/dev/null 2>&1 || true
fi
# La primera revisión escribe qué certificado usa la página y la arranca.
systemctl start imagina-guardian.service
[ "$RESCUE_ENABLED" = 1 ] && systemctl restart imagina-rescue >/dev/null 2>&1 || true

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
echo
echo "Por SSH, como root:"
echo "  imagina-estado      dice cómo está el servidor"
echo "  imagina-reparar     arregla lo que encuentre, ya (también: reiniciar, version-anterior, espacio)"
echo "  imagina-rescate     la dirección de la página de rescate y su clave"
if [ "$RESCUE_ENABLED" = 1 ]; then
    echo
    echo "Página de rescate: https://$DOMAIN:$RESCUE_PORT"
    if [ -n "$RESCUE_PASS" ]; then
        echo "  Clave: $RESCUE_PASS"
        echo "  Guárdala ahora (en tu gestor de contraseñas): no se vuelve a mostrar."
        echo "  Si la pierdes, por SSH: imagina-rescate clave"
    else
        echo "  La clave es la de antes (para cambiarla: imagina-rescate clave)."
    fi
    echo "  Abre el puerto $RESCUE_PORT/tcp en el firewall del panel (en ServerAvatar: el servidor → Firewall)"
    echo "  y, si tu proveedor tiene uno propio (Hetzner Cloud, AWS, DigitalOcean), también ahí."
fi
