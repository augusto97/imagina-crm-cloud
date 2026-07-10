#!/usr/bin/env bash
#
# Restore Point-In-Time (PITR) de PRODUCCIÓN — F5, STANDALONE §14/§17.
#
# Reconstruye un cluster de Postgres a partir de un base backup físico
# (scripts/basebackup.sh) + el WAL archivado (docker-compose.prod.yml), y hace
# replay hasta un INSTANTE elegido (`--target-time`) o hasta el final del WAL.
# La lógica es la misma que valida scripts/pitr-drill.sh, pero apuntando a un
# base backup real y a un directorio de datos nuevo. Ver docs/runbook-pitr.md.
#
# ⚠️ NO sobrescribe el pgdata de producción: restaura en un DATA_DIR NUEVO. El
# operador decide después si promueve ese cluster (cambiar el volumen del
# contenedor) tras verificarlo.
#
# Uso:
#   ./scripts/pitr-restore.sh <base-backup-dir> <data-dir-destino> [--target-time "2026-07-10 14:30:00+00"]
#
# Ejemplos:
#   # Restaurar al último WAL disponible (recuperación total ante desastre):
#   ./scripts/pitr-restore.sh basebackups/base-20260710T030000Z /srv/pg-restore
#   # Viajar a un instante (p.ej. justo antes de un DROP TABLE accidental):
#   ./scripts/pitr-restore.sh basebackups/base-20260710T030000Z /srv/pg-restore \
#       --target-time "2026-07-10 14:29:55+00"
#
# Variables:
#   WAL_ARCHIVE_DIR   dir del WAL archivado en el HOST (default: ./wal_archive).
#                     Se monta read-only en el contenedor de restore.
#   PG_IMAGE          imagen de Postgres (default: postgres:16-alpine).
#   RESTORE_CONTAINER nombre del contenedor efímero de restore.
#   BACKUP_GPG        si el base backup está cifrado (*.tar.gz.gpg), descifra con gpg.
set -euo pipefail

BASE_DIR="${1:?uso: pitr-restore.sh <base-backup-dir> <data-dir-destino> [--target-time \"...\"]}"
DATA_DIR="${2:?falta el data-dir destino}"
shift 2

TARGET_TIME=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-time) TARGET_TIME="${2:?--target-time requiere un valor}"; shift 2 ;;
        *) echo "opción desconocida: $1" >&2; exit 2 ;;
    esac
done

WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-./wal_archive}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
RESTORE_CONTAINER="${RESTORE_CONTAINER:-imagina-pitr-restore}"

[[ -d "$BASE_DIR" ]] || { echo "no existe el base backup: $BASE_DIR" >&2; exit 1; }
[[ -d "$WAL_ARCHIVE_DIR" ]] || { echo "no existe el WAL archive: $WAL_ARCHIVE_DIR (setéa WAL_ARCHIVE_DIR)" >&2; exit 1; }
if [[ -e "$DATA_DIR" && -n "$(ls -A "$DATA_DIR" 2>/dev/null || true)" ]]; then
    echo "el data-dir destino '$DATA_DIR' no está vacío — abortando para no pisar datos." >&2
    exit 1
fi

log() { printf '→ %s\n' "$*"; }
mkdir -p "$DATA_DIR"
WAL_ABS="$(cd "$WAL_ARCHIVE_DIR" && pwd)"
DATA_ABS="$(cd "$DATA_DIR" && pwd)"

# ── 1. Descomprimir el base backup (base.tar.gz → DATA_DIR) ──────────────────
base_tar="$BASE_DIR/base.tar.gz"
wal_tar="$BASE_DIR/pg_wal.tar.gz"
if [[ ! -f "$base_tar" && -f "$base_tar.gpg" ]]; then
    log "descifrando base backup con GPG"
    gpg --batch --yes --decrypt --output "$base_tar" "$base_tar.gpg"
    [[ -f "$wal_tar.gpg" ]] && gpg --batch --yes --decrypt --output "$wal_tar" "$wal_tar.gpg"
fi
[[ -f "$base_tar" ]] || { echo "no se encontró base.tar.gz en $BASE_DIR" >&2; exit 1; }

log "descomprimiendo base backup en $DATA_ABS"
tar -xzf "$base_tar" -C "$DATA_ABS"
# El WAL que capturó pg_basebackup -Xs viene aparte; va al pg_wal del cluster.
if [[ -f "$wal_tar" ]]; then
    tar -xzf "$wal_tar" -C "$DATA_ABS/pg_wal"
fi

# ── 2. Configurar la recuperación (restore_command + target) ─────────────────
# El WAL archivado se monta en /wal_archive dentro del contenedor.
log "escribiendo configuración de recovery"
{
    echo "restore_command = 'cp /wal_archive/%f %p'"
    if [[ -n "$TARGET_TIME" ]]; then
        echo "recovery_target_time = '$TARGET_TIME'"
    fi
    # Al alcanzar el target (o el fin del WAL) promociona el cluster a R/W.
    echo "recovery_target_action = 'promote'"
} >> "$DATA_ABS/postgresql.auto.conf"
touch "$DATA_ABS/recovery.signal"
# postgres corre como uid 70 (alpine) / 999 (debian); damos permisos al datadir.
chmod -R 700 "$DATA_ABS" 2>/dev/null || true
chmod -R 777 "$DATA_ABS" 2>/dev/null || true

# ── 3. Levantar Postgres para el replay hasta el target ──────────────────────
docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
log "levantando Postgres de restore ($RESTORE_CONTAINER) — replay de WAL"
docker run -d --name "$RESTORE_CONTAINER" \
    -v "$DATA_ABS":/var/lib/postgresql/data \
    -v "$WAL_ABS":/wal_archive:ro \
    "$PG_IMAGE" \
    -c archive_mode=off >/dev/null

log "esperando a que termine el recovery (pg_is_in_recovery → f)…"
ok=""
for _ in $(seq 1 120); do
    if docker exec "$RESTORE_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
        in_rec="$(docker exec "$RESTORE_CONTAINER" psql -U postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo t)"
        if [[ "$in_rec" == "f" ]]; then ok=1; break; fi
    fi
    sleep 1
done

if [[ -z "$ok" ]]; then
    echo "⚠️  el recovery no promovió en el tiempo esperado — revisá los logs:" >&2
    echo "    docker logs $RESTORE_CONTAINER" >&2
    exit 1
fi

log "✅ recovery completo. Cluster restaurado y promovido a R/W."
[[ -n "$TARGET_TIME" ]] && log "   punto de recuperación: $TARGET_TIME" || log "   punto de recuperación: fin del WAL archivado"
cat <<EOF

Siguiente paso (verificación antes de promover a producción):
  docker exec -it $RESTORE_CONTAINER psql -U postgres -c '\\dt'
  docker exec -it $RESTORE_CONTAINER psql -U postgres -c 'SELECT count(*) FROM users;'

El cluster restaurado vive en:  $DATA_ABS
El contenedor de verificación:  $RESTORE_CONTAINER  (borralo con: docker rm -f $RESTORE_CONTAINER)
Para promover: apuntá el volumen pgdata de producción a este data-dir (con el
API detenido) — ver docs/runbook-pitr.md.
EOF
