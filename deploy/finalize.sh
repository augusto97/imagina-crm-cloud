#!/usr/bin/env bash
#
# Reinicio + health-check + rollback del API (ADR-S13). Se corre DESACOPLADO del
# API (spawn detached) porque reiniciar el API mata al worker in-process que
# dispara el update (gotcha #2). El estado final lo reconcilia la app al bootear
# comparando la versión servida (self-heal); este script se ocupa del lado OS.
#
# Env requeridos:
#   BASE_PATH      raíz del layout de releases
#   PREV_RELEASE   release anterior (para rollback del symlink)
#   HEALTH_URL     probe de readiness (p.ej. http://127.0.0.1:3001/api/v1/health/ready)
# Opcional:
#   SERVICE        nombre del servicio systemd (default imagina-api)
#   HEALTH_RETRIES cantidad de intentos (default 30, cada 2s = 60s)
set -uo pipefail

: "${BASE_PATH:?Falta BASE_PATH}"
: "${PREV_RELEASE:?Falta PREV_RELEASE}"
: "${HEALTH_URL:?Falta HEALTH_URL}"
SERVICE="${SERVICE:-imagina-api}"
RETRIES="${HEALTH_RETRIES:-30}"
CURRENT="${BASE_PATH}/current"
SHARED="${BASE_PATH}/shared"
# Cómo reiniciar el API. Default systemd; overrideable por si corre bajo PM2 u
# otro supervisor (p.ej. RESTART_CMD="pm2 restart imagina-api").
RESTART_CMD="${RESTART_CMD:-sudo systemctl restart ${SERVICE}}"

restart() { eval "${RESTART_CMD}"; }

wait_healthy() {
    for _ in $(seq 1 "${RETRIES}"); do
        if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then return 0; fi
        sleep 2
    done
    return 1
}

# FORCE_ROLLBACK=1 → rollback manual desde el panel (saltea el intento inicial).
if [ -z "${FORCE_ROLLBACK:-}" ]; then
    echo "→ reiniciando ${SERVICE} sobre el release nuevo"
    restart
    if wait_healthy; then
        echo "✓ release nuevo saludable"
        # Poda de releases viejos (deja los últimos N) — best-effort.
        KEEP="${UPDATER_KEEP_RELEASES:-5}"
        ls -1dt "${BASE_PATH}/releases/"*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
        exit 0
    fi
    echo "✗ health-check falló → ROLLBACK a ${PREV_RELEASE}"
else
    echo "→ ROLLBACK manual a ${PREV_RELEASE}"
fi
ln -sfn "${PREV_RELEASE}" "${CURRENT}"
restart
# Restaurar el último dump (las migraciones son forward-only; el rollback de
# datos es restore, no migrate:down).
LAST_DUMP="$(ls -1t "${SHARED}/backups/"*.dump 2>/dev/null | head -1 || true)"
if [ -n "${LAST_DUMP}" ]; then
    echo "→ restaurando dump ${LAST_DUMP}"
    set -a; # shellcheck disable=SC1091
    . "${SHARED}/.env.production"; set +a
    TARGET_DATABASE_URL="${DATABASE_URL}" "${CURRENT}/deploy/restore.sh" "${LAST_DUMP}" || true
fi
wait_healthy && echo "✓ rollback saludable" || echo "✗ rollback aún no saludable — revisar manualmente"
exit 1
