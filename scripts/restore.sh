#!/usr/bin/env bash
#
# Restore de un backup de Imagina Base (F5). Restaura un .dump (o .dump.gpg) en
# la base apuntada por TARGET_DATABASE_URL. Descifra con GPG si el archivo
# termina en .gpg.
#
# Uso:
#   TARGET_DATABASE_URL=postgres://user:pass@host:5432/db_restore \
#     ./scripts/restore.sh ./backups/imagina-base-XXXX.dump
#
# ⚠️  El target debe existir y estar VACÍO (o aceptar --clean). Nunca apuntes a
#     la base de producción por accidente.
set -euo pipefail

DUMP="${1:?Falta la ruta al archivo de backup}"
: "${TARGET_DATABASE_URL:?Falta TARGET_DATABASE_URL}"

if [[ ! -f "$DUMP" ]]; then
    echo "✗ no existe el backup: $DUMP" >&2
    exit 1
fi

TMP=""
cleanup() { [[ -n "$TMP" ]] && rm -f "$TMP"; }
trap cleanup EXIT

if [[ "$DUMP" == *.gpg ]]; then
    echo "→ descifrando $DUMP"
    TMP="$(mktemp --suffix=.dump)"
    gpg --batch --yes --decrypt --output "$TMP" "$DUMP"
    DUMP="$TMP"
fi

echo "→ pg_restore → $TARGET_DATABASE_URL"
# --clean --if-exists deja el target consistente si tenía objetos previos.
pg_restore --no-owner --no-privileges --clean --if-exists \
    --dbname="$TARGET_DATABASE_URL" "$DUMP"

echo "→ restore completo"
