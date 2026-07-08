#!/usr/bin/env bash
#
# Backup lógico de la base de Imagina Base (F5 — STANDALONE §14/§17).
# pg_dump en formato custom (comprimido, restaurable selectivamente). Si
# BACKUP_GPG_RECIPIENT está seteado, cifra el dump con GPG (backups cifrados).
#
# Uso:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup.sh [destino_dir]
#
# Variables:
#   DATABASE_URL            (requerida) conexión a la base a respaldar.
#   BACKUP_DIR              destino (default: ./backups). Arg 1 lo sobreescribe.
#   BACKUP_GPG_RECIPIENT    si está, cifra el .dump → .dump.gpg y borra el plano.
#   BACKUP_RETENTION_DAYS   borra backups más viejos que N días (default: 30).
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"
BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/imagina-base-$STAMP.dump"

echo "→ pg_dump (formato custom) → $OUT"
pg_dump --format=custom --no-owner --no-privileges --compress=9 --file="$OUT" "$DATABASE_URL"

if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
    echo "→ cifrando con GPG para $BACKUP_GPG_RECIPIENT"
    gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$OUT.gpg" "$OUT"
    rm -f "$OUT"
    OUT="$OUT.gpg"
fi

echo "→ backup listo: $OUT ($(du -h "$OUT" | cut -f1))"

# Retención: borra backups viejos (por mtime).
find "$BACKUP_DIR" -name 'imagina-base-*.dump*' -type f -mtime "+$RETENTION_DAYS" -print -delete \
    | sed 's/^/→ purgado (retención): /' || true
