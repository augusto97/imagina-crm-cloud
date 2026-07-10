#!/usr/bin/env bash
#
# Base backup FÍSICO para PITR (F5 — STANDALONE §14/§17). Complementa al backup
# lógico (scripts/backup.sh): el dump lógico restaura al momento del dump; el
# base backup físico + el WAL archivado (docker-compose.prod.yml) permiten
# restaurar a CUALQUIER instante (point-in-time) — ver docs/runbook-pitr.md.
#
# Corre `pg_basebackup` DENTRO del contenedor de Postgres (socket local, sin
# tocar pg_hba), formato tar+gzip con el WAL necesario incluido (-Xs), y saca el
# resultado a un directorio timestamped. Opcional: cifra con GPG. Aplica
# retención y, al vencer un base backup, poda el WAL que ya nadie necesita.
#
# Uso:
#   PG_CONTAINER=imagina-base-prod-postgres-1 ./scripts/basebackup.sh [destino_dir]
#
# Variables:
#   PG_CONTAINER              (default: imagina-base-prod-postgres-1) contenedor PG.
#   PGUSER                    (default: postgres) superusuario para pg_basebackup.
#   BASEBACKUP_DIR            destino (default: ./basebackups). Arg 1 lo pisa.
#   WAL_ARCHIVE_DIR           dir/volumen del WAL archivado (para la poda).
#   BACKUP_GPG_RECIPIENT      si está, cifra cada base backup con GPG.
#   BASEBACKUP_RETENTION_DAYS borra base backups más viejos que N días (default 14).
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-imagina-base-prod-postgres-1}"
PGUSER="${PGUSER:-postgres}"
BASEBACKUP_DIR="${1:-${BASEBACKUP_DIR:-./basebackups}}"
RETENTION_DAYS="${BASEBACKUP_RETENTION_DAYS:-14}"

if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    echo "No existe el contenedor de Postgres '$PG_CONTAINER' (setéa PG_CONTAINER)." >&2
    exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BASEBACKUP_DIR/base-$STAMP"
mkdir -p "$OUT"

echo "→ pg_basebackup físico (tar.gz, WAL incluido) desde $PG_CONTAINER"
docker exec "$PG_CONTAINER" rm -rf /tmp/basebackup
docker exec "$PG_CONTAINER" pg_basebackup -U "$PGUSER" -D /tmp/basebackup -Ft -z -Xs -P
docker cp "$PG_CONTAINER":/tmp/basebackup/. "$OUT"/
docker exec "$PG_CONTAINER" rm -rf /tmp/basebackup
test -f "$OUT/base.tar.gz" || { echo "no se generó base.tar.gz" >&2; exit 1; }

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
    echo "→ cifrando base backup con GPG para $BACKUP_GPG_RECIPIENT"
    for f in "$OUT"/*.tar.gz; do
        gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$f.gpg" "$f"
        rm -f "$f"
    done
fi

echo "→ base backup listo: $OUT ($(du -sh "$OUT" | cut -f1))"

# Retención de base backups (por mtime del directorio).
find "$BASEBACKUP_DIR" -maxdepth 1 -name 'base-*' -type d -mtime "+$RETENTION_DAYS" -print \
    | while read -r old; do
        echo "→ purgando base backup vencido: $old"
        rm -rf "$old"
    done

# Poda de WAL: borra segmentos anteriores al base backup retenido MÁS VIEJO
# (ese es el punto de partida más lejano al que podríamos restaurar). Best-effort.
if [[ -n "${WAL_ARCHIVE_DIR:-}" && -d "$WAL_ARCHIVE_DIR" ]]; then
    oldest="$(find "$BASEBACKUP_DIR" -maxdepth 1 -name 'base-*' -type d | sort | head -1)"
    label="$(ls "$oldest"/*.backup 2>/dev/null | head -1 || true)"
    if [[ -n "$label" ]]; then
        needed="$(basename "$label" | cut -d. -f1)"
        echo "→ podando WAL anterior a $needed (base backup más viejo retenido)"
        if command -v pg_archivecleanup >/dev/null 2>&1; then
            pg_archivecleanup "$WAL_ARCHIVE_DIR" "$needed" || true
        else
            docker run --rm -v "$WAL_ARCHIVE_DIR":/wal "$(docker inspect -f '{{.Config.Image}}' "$PG_CONTAINER")" \
                pg_archivecleanup /wal "$needed" || true
        fi
    fi
fi
