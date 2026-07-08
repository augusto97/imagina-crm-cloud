#!/usr/bin/env bash
#
# Restore drill (F5 — STANDALONE §14 "restore drill mensual"). Prueba de punta a
# punta que un backup es RESTAURABLE: respalda la base, restaura en una base
# scratch efímera, verifica y limpia. Falla (exit≠0) si algo no cuadra — apto
# para correr en CI/cron mensual.
#
# Uso:
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup-restore-drill.sh
#
# Verifica:
#   1. el backup se crea y no está vacío.
#   2. el pg_restore en la base scratch termina sin error.
#   3. el set de tablas del schema public coincide con el origen.
#   4. la tabla `users` (sin RLS) tiene el mismo conteo exacto.
#   5. el total estimado de tuplas (reltuples, ajeno a RLS) coincide ±2%.
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL}"

BASE="${DATABASE_URL%%\?*}"          # sin query string
SERVER="${BASE%/*}"                  # postgres://user:pass@host:port
SRCDB="${BASE##*/}"                  # nombre de la base origen
STAMP="$(date -u +%Y%m%d%H%M%S)"
SCRATCH="${SRCDB}_drill_${STAMP}"
ADMIN_URL="$SERVER/postgres"
RESTORE_URL="$SERVER/$SCRATCH"
WORK="$(mktemp -d)"
DUMP="$WORK/drill.dump"

cleanup() {
    psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

q() { psql -Atq "$1" -c "$2"; }

echo "→ [1/5] backup de $SRCDB"
pg_dump --format=custom --no-owner --no-privileges --compress=9 --file="$DUMP" "$DATABASE_URL"
[[ -s "$DUMP" ]] || { echo "✗ backup vacío"; exit 1; }
echo "   dump: $(du -h "$DUMP" | cut -f1)"

echo "→ [2/5] restore en scratch ($SCRATCH)"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$SCRATCH\";" >/dev/null
pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" "$DUMP"

echo "→ [3/5] comparando set de tablas (schema public)"
TABLES_SQL="SELECT string_agg(table_name, ',' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
SRC_TABLES="$(q "$DATABASE_URL" "$TABLES_SQL")"
DST_TABLES="$(q "$RESTORE_URL" "$TABLES_SQL")"
if [[ "$SRC_TABLES" != "$DST_TABLES" ]]; then
    echo "✗ difieren las tablas:"; echo "  origen : $SRC_TABLES"; echo "  restore: $DST_TABLES"; exit 1
fi
echo "   $(echo "$DST_TABLES" | tr ',' '\n' | wc -l | tr -d ' ') tablas OK"

echo "→ [4/5] conteo exacto de users (sin RLS)"
SRC_USERS="$(q "$DATABASE_URL" 'SELECT count(*) FROM users;')"
DST_USERS="$(q "$RESTORE_URL" 'SELECT count(*) FROM users;')"
if [[ "$SRC_USERS" != "$DST_USERS" ]]; then
    echo "✗ users: origen=$SRC_USERS restore=$DST_USERS"; exit 1
fi
echo "   users=$DST_USERS OK"

echo "→ [5/5] total estimado de tuplas (±2%)"
psql -q "$RESTORE_URL" -c "ANALYZE;" >/dev/null
psql -q "$DATABASE_URL" -c "ANALYZE;" >/dev/null
EST_SQL="SELECT COALESCE(sum(reltuples),0)::bigint FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace;"
SRC_EST="$(q "$DATABASE_URL" "$EST_SQL")"
DST_EST="$(q "$RESTORE_URL" "$EST_SQL")"
# tolerancia 2% (reltuples es estimación del planner)
if [[ "$SRC_EST" -gt 0 ]]; then
    DIFF=$(( SRC_EST > DST_EST ? SRC_EST - DST_EST : DST_EST - SRC_EST ))
    if (( DIFF * 100 > SRC_EST * 2 )); then
        echo "✗ tuplas estimadas fuera de tolerancia: origen=$SRC_EST restore=$DST_EST"; exit 1
    fi
fi
echo "   tuplas≈ origen=$SRC_EST restore=$DST_EST OK"

echo "✓ restore drill OK — el backup es restaurable"
