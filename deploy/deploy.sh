#!/usr/bin/env bash
#
# Despliegue atómico de un release ya extraído (ADR-S13). Prepara el release
# (link a shared + migraciones forward-only) y hace el FLIP del symlink current.
# NO reinicia el API — de eso se ocupa finalize.sh (para el update in-app, que
# corre dentro del propio proceso a reiniciar). Reutilizable a mano.
#
# Env requeridos:
#   BASE_PATH    raíz del layout de releases (contiene releases/ shared/ current)
#   RELEASE_DIR  carpeta del release a activar (releases/<ts>_<ver>)
set -euo pipefail

: "${BASE_PATH:?Falta BASE_PATH}"
: "${RELEASE_DIR:?Falta RELEASE_DIR}"
SHARED="${BASE_PATH}/shared"
CURRENT="${BASE_PATH}/current"

echo "→ preparando ${RELEASE_DIR}"
# El API lee el env por systemd (EnvironmentFile=shared/.env.production); el
# symlink dentro del release es para herramientas/CLI que corran desde ahí.
ln -sfn "${SHARED}/.env.production" "${RELEASE_DIR}/apps/api/.env.production"

echo "→ uploads persistentes (shared/uploads)"
# El default de UPLOADS_DIR es ./data/uploads RELATIVO al cwd del servicio
# (current/apps/api) — o sea DENTRO del release: cada update dejaba los
# archivos subidos (logos, adjuntos) atrás y la poda de releases los borraba.
# Fix: los bytes viven en shared/uploads y cada release apunta ahí por
# symlink — el default resuelve al lugar correcto sin tocar el env.
mkdir -p "${SHARED}/uploads"
# Rescate best-effort: recuperar uploads que quedaron dentro de releases
# anteriores (sin sobreescribir; claves opacas → colisiones nulas).
for OLD in "${BASE_PATH}"/releases/*/apps/api/data/uploads; do
    if [ -d "${OLD}" ] && [ ! -L "${OLD%/uploads}/uploads" ]; then
        cp -an "${OLD}/." "${SHARED}/uploads/" 2>/dev/null || true
    fi
done
mkdir -p "${RELEASE_DIR}/apps/api/data"
rm -rf "${RELEASE_DIR}/apps/api/data/uploads"
ln -sfn "${SHARED}/uploads" "${RELEASE_DIR}/apps/api/data/uploads"

echo "→ migraciones (forward-only)"
# Lee el .env estilo dotenv SIN `source`: un valor sin comillas con espacios o
# `<>` (MAIL_FROM=Imagina Base <no-reply@…>, como trae el .env.production.example)
# hace que bash lo interprete como comando + redirección y aborte el deploy.
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
load_env_file "${SHARED}/.env.production"
( cd "${RELEASE_DIR}/apps/api" && node dist/db/migrate.js )

echo "→ descubrimiento OAuth del MCP (archivos estáticos en web/.well-known)"
# v0.1.186 — claude.ai / Claude Desktop piden /.well-known/oauth-* en la RAÍZ
# del host; sin regla de proxy caían al SPA (HTML 200 → "Failed to start MCP
# authorization"). Los archivos reales se sirven antes del fallback. Best-
# effort: si APP_BASE_URL no está, se avisa y el deploy sigue.
WEB_DIR="${RELEASE_DIR}/web" APP_BASE_URL="${APP_BASE_URL:-}" \
    bash "$(dirname "$0")/oauth-discovery-static.sh" || echo "  (aviso: no se pudieron generar los archivos de descubrimiento OAuth)"

echo "→ FLIP atómico: current → ${RELEASE_DIR}"
ln -sfn "${RELEASE_DIR}" "${CURRENT}"

echo "✓ deploy.sh completo (current apunta al release nuevo)"
