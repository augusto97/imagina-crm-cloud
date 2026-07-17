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
set -a
# shellcheck disable=SC1091
. "${SHARED}/.env.production"
set +a
( cd "${RELEASE_DIR}/apps/api" && node dist/db/migrate.js )

echo "→ FLIP atómico: current → ${RELEASE_DIR}"
ln -sfn "${RELEASE_DIR}" "${CURRENT}"

echo "✓ deploy.sh completo (current apunta al release nuevo)"
