#!/usr/bin/env bash
#
# Imagina Base — instalador de un servidor nuevo (v0.1.283, ADR-S43).
#
#   curl -fsSL https://github.com/augusto97/imagina-crm-cloud/releases/latest/download/install.sh | sudo bash
#
# Deja el servidor listo en un solo paso: Docker (Postgres + Redis), Node 22,
# la última versión de la app con el layout de releases, el servicio systemd y
# el servidor web (Caddy automático, o las instrucciones para ServerAvatar).
# Al terminar la app queda en MODO RECUPERACIÓN y la terminal muestra un
# código: en https://<dominio>/recuperar se restaura una copia del Google
# Drive (o se empieza de cero). Sin dominio todavía: `sudo imagina-restore`.
#
# Es idempotente: correrlo de nuevo no rompe nada (no pisa un .env existente
# ni una base con datos).
#
# Flags (todo lo que no se pase se pregunta):
#   --domain <host>        dominio de la app (ej. app.miempresa.com)
#   --email <correo>       correo del operador (superadmin de la plataforma)
#   --web caddy|serveravatar|none
#   --version <x.y.z>      versión a instalar (default: la última publicada)
#   --base-path <dir>      default /opt/imagina-base
#   --repo <owner/repo>    default augusto97/imagina-crm-cloud
#   --yes                  no preguntar (requiere --domain, --email y --web)
set -euo pipefail

REPO="augusto97/imagina-crm-cloud"
BASE_PATH="/opt/imagina-base"
DOMAIN=""; EMAIL=""; WEB=""; VERSION=""; YES=0
APP_USER="deploy"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) DOMAIN="$2"; shift 2 ;;
        --email) EMAIL="$2"; shift 2 ;;
        --web) WEB="$2"; shift 2 ;;
        --version) VERSION="${2#v}"; shift 2 ;;
        --base-path) BASE_PATH="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        --yes) YES=1; shift ;;
        -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
        *) echo "flag desconocido: $1" >&2; exit 2 ;;
    esac
done

say() { printf '\033[1;36m→\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
# Con `curl … | sudo bash` el stdin es el script: las preguntas se leen de la terminal.
ask() {
    local prompt="$1" default="${2:-}" answer=""
    [[ $YES -eq 1 ]] && { echo "$default"; return; }
    [[ -r /dev/tty ]] || die "No hay terminal para preguntar: pasa los datos con flags (ver --help)."
    if [[ -n "$default" ]]; then printf '%s [%s]: ' "$prompt" "$default" > /dev/tty; else printf '%s: ' "$prompt" > /dev/tty; fi
    IFS= read -r answer < /dev/tty || true
    echo "${answer:-$default}"
}

[[ $EUID -eq 0 ]] || die "Corre el instalador como root: curl -fsSL …/install.sh | sudo bash"
command -v apt-get >/dev/null 2>&1 || die "Este instalador es para Ubuntu o Debian (usa apt-get)."

cat <<'EOF'

  ╭─────────────────────────────────────────────╮
  │   Imagina Base — instalación del servidor   │
  ╰─────────────────────────────────────────────╯

EOF

# ── 0. datos ────────────────────────────────────────────────────────────────
[[ -n "$DOMAIN" ]] || DOMAIN="$(ask 'Dominio de la app (ej. app.miempresa.com)')"
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Dominio inválido: '$DOMAIN'"
[[ -n "$EMAIL" ]] || EMAIL="$(ask 'Tu correo de operador (superadmin)')"
EMAIL="$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]')"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Correo inválido: '$EMAIL'"
if [[ -z "$WEB" ]]; then
    echo "¿Qué servidor web?"
    echo "  1) Caddy — lo instalo y configuro yo, con HTTPS automático (recomendado)"
    echo "  2) ServerAvatar — ya administras el servidor con su panel: te digo qué pegar"
    echo "  3) Ninguno — lo configuro a mano"
    case "$(ask 'Elige 1, 2 o 3' 1)" in 1) WEB=caddy ;; 2) WEB=serveravatar ;; 3) WEB=none ;; *) die "Opción inválida" ;; esac
fi
[[ "$WEB" =~ ^(caddy|serveravatar|none)$ ]] || die "--web debe ser caddy, serveravatar o none"

# ── 1. paquetes ─────────────────────────────────────────────────────────────
say "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl unzip gnupg tar sudo >/dev/null

if ! command -v docker >/dev/null 2>&1; then
    say "Instalando Docker"
    curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Falta 'docker compose' (plugin de Docker Compose)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if (( NODE_MAJOR < 22 )); then
    say "Instalando Node 22"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi
NODE_BIN="$(command -v node)"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,) · Node $(node -v)"

# ── 2. usuario y carpetas ───────────────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
    say "Creando el usuario $APP_USER"
    useradd --system --create-home --shell /bin/bash "$APP_USER"
fi
getent group docker >/dev/null || groupadd docker
usermod -aG docker "$APP_USER"
mkdir -p "$BASE_PATH/releases" "$BASE_PATH/shared/backups" "$BASE_PATH/shared/uploads" "$BASE_PATH/shared/recovery"
mkdir -p /etc/sudoers.d
cat > /etc/sudoers.d/imagina <<EOF
# Imagina Base: el API reinicia su propio servicio (auto-actualización, restauraciones).
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart imagina-api, /usr/bin/systemctl stop imagina-api, /usr/bin/systemctl start imagina-api
EOF
chmod 440 /etc/sudoers.d/imagina

# ── 3. versión ──────────────────────────────────────────────────────────────
if [[ -z "$VERSION" ]]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write((JSON.parse(s).tag_name||"").replace(/^v/,"")))')"
fi
[[ -n "$VERSION" ]] || die "No se pudo saber cuál es la última versión publicada."
CURRENT_VERSION="$( [[ -L "$BASE_PATH/current" ]] && basename "$(readlink -f "$BASE_PATH/current")" | sed -E 's/^[0-9]+_//' || true)"

# ── 4. .env ─────────────────────────────────────────────────────────────────
ENV_FILE="$BASE_PATH/shared/.env.production"
rand() { node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))'; }
if [[ ! -f "$ENV_FILE" ]]; then
    say "Generando la configuración (secretos nuevos)"
    PG_PASS="$(rand)"; REDIS_PASS="$(rand)"
    # Puertos libres en localhost: el stack de ServerAvatar ya trae un Redis
    # en el 6379 (y a veces un Postgres en el 5432).
    port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
    PG_PORT=5432; while ! port_free "$PG_PORT"; do PG_PORT=$((PG_PORT + 1)); done
    REDIS_PORT=6379; while ! port_free "$REDIS_PORT"; do REDIS_PORT=$((REDIS_PORT + 1)); done
    [[ $PG_PORT == 5432 ]] || say "El puerto 5432 está ocupado: Postgres usará el $PG_PORT"
    [[ $REDIS_PORT == 6379 ]] || say "El puerto 6379 está ocupado (¿el Redis de ServerAvatar?): Redis usará el $REDIS_PORT"
    umask 077
    cat > "$ENV_FILE" <<EOF
# Generado por install.sh (Imagina Base $VERSION) el $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_USER=imagina
POSTGRES_PASSWORD=$PG_PASS
POSTGRES_DB=imagina_base
POSTGRES_PORT=$PG_PORT
REDIS_PASSWORD=$REDIS_PASS
REDIS_PORT=$REDIS_PORT

NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://imagina:$PG_PASS@127.0.0.1:$PG_PORT/imagina_base
REDIS_URL=redis://:$REDIS_PASS@127.0.0.1:$REDIS_PORT
SESSION_TTL_SECONDS=2592000
COOKIE_SECURE=true
APP_BASE_URL=https://$DOMAIN
TRUST_PROXY=loopback

MAIL_TRANSPORT=log
MAIL_FROM="Imagina Base <no-reply@$DOMAIN>"

SECRETS_KEY=$(rand)$(rand)
FILES_SIGNING_SECRET=$(rand)$(rand)

PLATFORM_SUPERADMINS=$EMAIL
UPDATER_GITHUB_REPO=$REPO
UPDATER_BASE_PATH=$BASE_PATH
EOF
    umask 022
    ok "Configuración en $ENV_FILE"
else
    ok "Se conserva la configuración existente ($ENV_FILE)"
fi

# Código del modo recuperación: sólo su hash queda en el .env. Se renueva en
# cada corrida (sólo vale mientras la base no tenga empresas).
CODE="$(node -e '
const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b=require("crypto").randomBytes(12);
let c=""; for (const x of b) c+=a[x%a.length];
process.stdout.write(c.match(/.{4}/g).join("-"))')"
CODE_HASH="$(printf '%s' "${CODE//-/}" | sha256sum | cut -d' ' -f1)"
grep -v '^RECOVERY_CODE_SHA256=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
echo "RECOVERY_CODE_SHA256=$CODE_HASH" >> "$ENV_FILE.tmp"
install -m 600 "$ENV_FILE.tmp" "$ENV_FILE"; rm -f "$ENV_FILE.tmp"

# ── 5. la app ───────────────────────────────────────────────────────────────
if [[ "$CURRENT_VERSION" != "$VERSION" ]]; then
    say "Bajando Imagina Base $VERSION"
    WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
    URL="https://github.com/$REPO/releases/download/v$VERSION/imagina-base-$VERSION.zip"
    curl -fL --retry 3 -s -o "$WORK/app.zip" "$URL" || die "No se pudo bajar $URL"
    curl -fL --retry 3 -s -o "$WORK/app.zip.sha256" "$URL.sha256" || die "No se pudo bajar el checksum"
    [[ "$(cut -d' ' -f1 < "$WORK/app.zip.sha256")" == "$(sha256sum "$WORK/app.zip" | cut -d' ' -f1)" ]] || die "El checksum del paquete no coincide."
    REL="$BASE_PATH/releases/$(date -u +%Y%m%d%H%M%S)_$VERSION"
    mkdir -p "$REL"; unzip -q -o "$WORK/app.zip" -d "$REL"
else
    REL="$(readlink -f "$BASE_PATH/current")"
    ok "La versión $VERSION ya está instalada"
fi

say "Postgres y Redis"
docker compose -f "$REL/deploy/docker-compose.prod.yml" --env-file "$ENV_FILE" up -d >/dev/null
for _ in $(seq 1 60); do
    docker exec imagina-base-prod-postgres-1 sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 && break
    sleep 2
done

say "Preparando la versión (migraciones + activación)"
chown -R "$APP_USER:$APP_USER" "$BASE_PATH"
sudo -u "$APP_USER" env BASE_PATH="$BASE_PATH" RELEASE_DIR="$REL" bash "$REL/deploy/deploy.sh" >/dev/null

say "Servicio"
mkdir -p /etc/systemd/system
sed -e "s#/opt/imagina-base#$BASE_PATH#g" -e "s#^User=.*#User=$APP_USER#" -e "s#^ExecStart=/usr/bin/node#ExecStart=$NODE_BIN#" \
    "$REL/deploy/imagina-api.service" > /etc/systemd/system/imagina-api.service
systemctl daemon-reload
systemctl enable imagina-api >/dev/null 2>&1
systemctl restart imagina-api
for _ in $(seq 1 45); do curl -fsS http://127.0.0.1:3001/api/v1/health/ready >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:3001/api/v1/health/ready >/dev/null 2>&1 || die "El API no arrancó: journalctl -u imagina-api -n 80"
ok "API corriendo en 127.0.0.1:3001"

# Restaurar por consola (sin dominio o sin navegador).
cat > /usr/local/bin/imagina-restore <<EOF
#!/usr/bin/env bash
# Imagina Base: restaurar una copia del Google Drive desde la terminal.
exec sudo -u $APP_USER env BASE_PATH=$BASE_PATH $NODE_BIN $BASE_PATH/current/apps/api/dist/recovery/cli.js "\$@"
EOF
chmod 755 /usr/local/bin/imagina-restore

# ── 6. servidor web ─────────────────────────────────────────────────────────
case "$WEB" in
    caddy)
        if ! command -v caddy >/dev/null 2>&1; then
            say "Instalando Caddy"
            apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
            curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
            apt-get update -qq && apt-get install -y -qq caddy >/dev/null
        fi
        mkdir -p /var/lib/caddy /etc/caddy
        sed -e "s#app\.tu-dominio\.com#$DOMAIN#g" -e "s#/opt/imagina-base#$BASE_PATH#g" "$REL/deploy/Caddyfile" > /etc/caddy/Caddyfile
        systemctl enable caddy >/dev/null 2>&1 || true
        systemctl restart caddy
        ok "Caddy sirve https://$DOMAIN (el certificado sale apenas el DNS apunte a este servidor)"
        ;;
    serveravatar)
        cat <<EOF

  En el panel de ServerAvatar:
   1. Crea la aplicación con el dominio $DOMAIN y activa el SSL.
   2. Raíz del sitio: $BASE_PATH/current/web
   3. Pega en la configuración de Nginx las reglas de:
        $BASE_PATH/current/deploy/nginx.conf
      (los bloques location: /api/, /socket.io/, /portal y el fallback del SPA).
   Guía completa: docs/runbook-serveravatar.md §6.
EOF
        ;;
    none)
        echo "  Configura tu proxy: API en 127.0.0.1:3001, SPA en $BASE_PATH/current/web (ver deploy/nginx.conf)."
        ;;
esac

IP="$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<EOF

  ╭──────────────────────────────────────────────────────────────╮
  │  Listo. Imagina Base $VERSION está instalada.
  │
  │  1. Apunta el DNS de $DOMAIN a $IP (registro A).
  │  2. Abre https://$DOMAIN/recuperar
  │  3. Escribe este código:   $CODE
  │
  │  Ahí eliges: restaurar una copia de tu Google Drive o
  │  empezar de cero. Sin dominio todavía, desde esta terminal:
  │     sudo imagina-restore
  ╰──────────────────────────────────────────────────────────────╯

EOF
