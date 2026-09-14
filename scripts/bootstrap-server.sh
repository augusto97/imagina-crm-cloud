#!/usr/bin/env bash
#
# Levanta Imagina Base en un servidor NUEVO a partir de un snapshot completo
# (v0.1.179 — ADR-S20 "migrar de servidor"). Dos comandos en total:
#
#   servidor viejo:  BASE_PATH=/opt/imagina-base ./scripts/snapshot.sh
#                    scp /opt/imagina-base/shared/backups/imagina-snapshot-…tar nuevo:/tmp/
#   servidor nuevo:  BASE_PATH=/opt/imagina-base ./bootstrap-server.sh --snapshot /tmp/imagina-snapshot-…tar
#
# Requisitos previos en el servidor nuevo (ver docs/runbook-migration.md):
#   Node 22, Docker (Postgres + Redis con deploy/docker-compose.prod.yml y el
#   MISMO .env que trae el snapshot — o un Postgres/Redis propios accesibles
#   con las URLs del .env), unzip, curl.
#
# Qué hace:
#   1. Crea el layout de releases (releases/ shared/ current) en BASE_PATH.
#   2. Instala el .env del snapshot en shared/.env.production (si no existe).
#   3. Descarga de GitHub Releases el bundle de la MISMA versión del snapshot
#      (o --version), verifica su .sha256 y lo extrae como release.
#   4. Apunta `current` al release y restaura el snapshot (base, uploads,
#      redis, migraciones) con scripts/snapshot-restore.sh.
#   5. Opcional --install-service: instala la unidad systemd y arranca el API.
#
# Flags:
#   --snapshot <archivo>   (requerido) snapshot .tar o .tar.gpg
#   --version <x.y.z>      versión del bundle a instalar (default: la del snapshot)
#   --repo <owner/repo>    repo de GitHub (default augusto97/imagina-crm-cloud)
#   --install-service      copia deploy/imagina-api.service, habilita y arranca
#   --yes                  no pregunta
# Variables: BASE_PATH (default /opt/imagina-base), UPDATER_GITHUB_TOKEN (repo privado), PORT (default 3001)
set -euo pipefail

BASE_PATH="${BASE_PATH:-/opt/imagina-base}"
REPO="augusto97/imagina-crm-cloud"
SNAPSHOT=""; VERSION=""; INSTALL_SERVICE=0; YES=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --snapshot) SNAPSHOT="$2"; shift 2 ;;
        --version) VERSION="$2"; shift 2 ;;
        --repo) REPO="$2"; shift 2 ;;
        --install-service) INSTALL_SERVICE=1; shift ;;
        --yes) YES="--yes"; shift ;;
        *) echo "flag desconocido: $1" >&2; exit 2 ;;
    esac
done
[[ -n "$SNAPSHOT" && -f "$SNAPSHOT" ]] || { echo "✗ falta --snapshot <archivo>" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for tool in node curl unzip tar; do command -v "$tool" >/dev/null 2>&1 || { echo "✗ falta $tool en el PATH" >&2; exit 1; }; done

# ── 1. layout ───────────────────────────────────────────────────────────────
echo "→ layout en $BASE_PATH"
mkdir -p "$BASE_PATH/releases" "$BASE_PATH/shared/backups" "$BASE_PATH/shared/uploads"

# ── 2. manifest + env del snapshot ──────────────────────────────────────────
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
TAR="$SNAPSHOT"
if [[ "$SNAPSHOT" == *.gpg ]]; then TAR="$WORK/s.tar"; gpg --batch --yes --decrypt --output "$TAR" "$SNAPSHOT"; fi
tar -C "$WORK" -xf "$TAR" --wildcards '*/manifest.json' '*/env.production' 2>/dev/null || tar -C "$WORK" -xf "$TAR"
PARTS="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'imagina-snapshot-*' | head -1)"
[[ -n "$PARTS" ]] || { echo "✗ no es un snapshot de Imagina Base" >&2; exit 1; }
SNAP_VERSION="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).app_version||"")' "$PARTS/manifest.json")"
VERSION="${VERSION:-$SNAP_VERSION}"
[[ -n "$VERSION" && "$VERSION" != "dev" ]] || { echo "✗ el snapshot no trae versión (dev): pasá --version x.y.z" >&2; exit 1; }
ENV_FILE="$BASE_PATH/shared/.env.production"
if [[ ! -f "$ENV_FILE" ]]; then
    [[ -f "$PARTS/env.production" ]] || { echo "✗ el snapshot no incluye env y no existe $ENV_FILE" >&2; exit 1; }
    cp "$PARTS/env.production" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    echo "→ env instalado en $ENV_FILE (revisá dominio/URLs si cambian en este servidor)"
fi
echo "→ snapshot versión $SNAP_VERSION → se instala el bundle $VERSION"

# ── 3. bundle del release ───────────────────────────────────────────────────
STAMP="$(date -u +%Y%m%d%H%M%S)"
REL="$BASE_PATH/releases/${STAMP}_${VERSION}"
ZIP="$WORK/imagina-base-$VERSION.zip"
URL="https://github.com/$REPO/releases/download/v$VERSION/imagina-base-$VERSION.zip"
AUTH=()
[[ -n "${UPDATER_GITHUB_TOKEN:-}" ]] && AUTH=(-H "Authorization: Bearer $UPDATER_GITHUB_TOKEN" -H "Accept: application/octet-stream")
echo "→ descargando $URL"
curl -fL --retry 3 "${AUTH[@]}" -o "$ZIP" "$URL"
curl -fL --retry 3 "${AUTH[@]}" -o "$ZIP.sha256" "$URL.sha256"
expected="$(cut -d' ' -f1 < "$ZIP.sha256")"; actual="$(sha256sum "$ZIP" | cut -d' ' -f1)"
[[ "$expected" == "$actual" ]] || { echo "✗ checksum del bundle no coincide" >&2; exit 1; }
mkdir -p "$REL"; unzip -q -o "$ZIP" -d "$REL"
ln -sfn "$ENV_FILE" "$REL/apps/api/.env.production"
mkdir -p "$REL/apps/api/data"; rm -rf "$REL/apps/api/data/uploads"; ln -sfn "$BASE_PATH/shared/uploads" "$REL/apps/api/data/uploads"
ln -sfn "$REL" "$BASE_PATH/current"
echo "→ release $VERSION instalado y activo ($REL)"

# ── 4. restaurar el snapshot ────────────────────────────────────────────────
# Se prefiere el restore que está JUNTO a este script (vienen del mismo origen
# y son la versión que la persona eligió correr); el del bundle es el respaldo.
RESTORE="$HERE/snapshot-restore.sh"
[[ -f "$RESTORE" ]] || RESTORE="$REL/deploy/snapshot-restore.sh"
BASE_PATH="$BASE_PATH" APP_VERSION="$VERSION" bash "$RESTORE" "$SNAPSHOT" --no-service --no-safety --skip-env $YES

# ── 5. servicio ─────────────────────────────────────────────────────────────
if [[ $INSTALL_SERVICE -eq 1 ]]; then
    echo "→ instalando servicio systemd"
    sed -e "s#/opt/imagina-base#$BASE_PATH#g" "$REL/deploy/imagina-api.service" | sudo tee /etc/systemd/system/imagina-api.service >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now imagina-api
    for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:${PORT:-3001}/api/v1/health/ready" >/dev/null 2>&1 && { echo "  ✓ API sana"; break; }; sleep 2; done
else
    cat <<EOF
✓ datos restaurados. Falta el servicio y el proxy (una sola vez por servidor):
   sudo cp $REL/deploy/imagina-api.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now imagina-api
   Caddy/nginx: ver docs/runbook-deploy.md §6 (o --install-service para el servicio).
   Después apuntá el DNS al servidor nuevo.
EOF
fi
