#!/usr/bin/env bash
#
# Drill de Point-In-Time Recovery (PITR) — F5, STANDALONE §14/§17.
#
# Prueba de punta a punta que el archivado de WAL + un base backup físico
# permiten restaurar la base a un instante ELEGIDO (no sólo al último dump):
#
#   1. Levanta un Postgres efímero con archive_mode=on (WAL → dir de archivo).
#   2. Toma un base backup físico (pg_basebackup, formato tar).
#   3. Inserta la fila A, fuerza un switch de WAL, y anota el instante T1.
#   4. Inserta la fila B, fuerza otro switch (queda archivada).
#   5. Restaura el base backup en un cluster nuevo con recovery_target_time=T1.
#   6. Verifica que el cluster restaurado tiene A pero NO B.
#
# Si eso se cumple, PITR funciona: podemos "viajar" a cualquier momento entre el
# base backup y el último WAL archivado. Todo en contenedores throwaway; no toca
# datos reales.
#
# Uso:  ./scripts/pitr-drill.sh
set -euo pipefail

IMAGE="${PG_IMAGE:-postgres:16-alpine}"
PW="drillpass"
SRC="imagina-pitr-src-$$"
DST="imagina-pitr-dst-$$"
WORK="$(mktemp -d /tmp/pitr-drill.XXXXXX)"
ARCHIVE="$WORK/archive"       # WAL archivado (compartido src → restore)
BASE="$WORK/base"             # base backup físico
DATA2="$WORK/data2"           # cluster restaurado
mkdir -p "$ARCHIVE" "$BASE" "$DATA2"
chmod -R 777 "$WORK"          # postgres corre como uid 70 en alpine

log() { printf '→ %s\n' "$*"; }
cleanup() {
    docker rm -f "$SRC" "$DST" >/dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

psql_src() { docker exec -e PGPASSWORD="$PW" "$SRC" psql -U postgres -d postgres -tAc "$1"; }
wait_ready() {
    local c="$1"
    for _ in $(seq 1 30); do
        if docker exec "$c" pg_isready -U postgres -d postgres >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    echo "postgres ($c) no quedó listo" >&2; return 1
}

# ── 1. Postgres fuente con archivado de WAL ─────────────────────────────────
log "levantando Postgres fuente con archive_mode=on"
docker run -d --name "$SRC" \
    -e POSTGRES_PASSWORD="$PW" \
    -v "$ARCHIVE":/wal_archive \
    "$IMAGE" \
    -c wal_level=replica \
    -c archive_mode=on \
    -c "archive_command=test ! -f /wal_archive/%f && cp %p /wal_archive/%f" \
    -c archive_timeout=30 >/dev/null
wait_ready "$SRC"

psql_src "CREATE TABLE drill (id int primary key, v text);" >/dev/null

# ── 2. Base backup físico (pg_basebackup, formato tar) ──────────────────────
log "base backup físico (pg_basebackup)"
docker exec -e PGPASSWORD="$PW" "$SRC" pg_basebackup -U postgres -D /tmp/base -Ft -z -Xs -P >/dev/null 2>&1
docker cp "$SRC":/tmp/base/. "$BASE"/ >/dev/null
test -f "$BASE/base.tar.gz" || { echo "no se generó base.tar.gz" >&2; exit 1; }

# ── 3. Fila A + switch de WAL + instante objetivo T1 ────────────────────────
psql_src "INSERT INTO drill VALUES (1, 'A');" >/dev/null
psql_src "SELECT pg_switch_wal();" >/dev/null
sleep 1
T1="$(psql_src "SELECT now();")"
log "T1 (objetivo de restore, tras A) = $T1"
sleep 1

# ── 4. Fila B + switch (queda archivada, pero es POSTERIOR a T1) ─────────────
psql_src "INSERT INTO drill VALUES (2, 'B');" >/dev/null
psql_src "SELECT pg_switch_wal();" >/dev/null
psql_src "CHECKPOINT;" >/dev/null
sleep 2  # dar tiempo a que archive_command copie el último segmento
log "fuente tiene: $(psql_src "SELECT string_agg(v, ',' ORDER BY id) FROM drill;")"
docker rm -f "$SRC" >/dev/null

# ── 5. Restaurar el base backup en un cluster nuevo, recovery a T1 ──────────
log "restaurando base backup en cluster nuevo"
tar -xzf "$BASE/base.tar.gz" -C "$DATA2"
# WAL streamed (-Xs) viene en pg_wal.tar.gz → al pg_wal del cluster restaurado.
if [[ -f "$BASE/pg_wal.tar.gz" ]]; then
    tar -xzf "$BASE/pg_wal.tar.gz" -C "$DATA2/pg_wal"
fi
cat >> "$DATA2/postgresql.auto.conf" <<EOF
restore_command = 'cp /wal_archive/%f %p'
recovery_target_time = '$T1'
recovery_target_action = 'promote'
EOF
touch "$DATA2/recovery.signal"
chmod -R 777 "$DATA2"

log "levantando Postgres restaurado (replay de WAL hasta T1)"
docker run -d --name "$DST" \
    -e POSTGRES_PASSWORD="$PW" \
    -v "$DATA2":/var/lib/postgresql/data \
    -v "$ARCHIVE":/wal_archive \
    "$IMAGE" \
    -c archive_mode=off >/dev/null
wait_ready "$DST"
# Esperar a que termine el recovery (promote).
for _ in $(seq 1 30); do
    in_recovery="$(docker exec -e PGPASSWORD="$PW" "$DST" psql -U postgres -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo t)"
    [[ "$in_recovery" == "f" ]] && break
    sleep 1
done

# ── 6. Verificación: A presente, B ausente ──────────────────────────────────
RESULT="$(docker exec -e PGPASSWORD="$PW" "$DST" psql -U postgres -d postgres -tAc "SELECT string_agg(v, ',' ORDER BY id) FROM drill;")"
log "cluster restaurado (recovery a T1) tiene: '$RESULT'"

if [[ "$RESULT" == "A" ]]; then
    echo "✅ PITR OK: se restauró exactamente al instante T1 (A sí, B no)."
    exit 0
else
    echo "❌ PITR FALLÓ: se esperaba 'A', se obtuvo '$RESULT'." >&2
    exit 1
fi
