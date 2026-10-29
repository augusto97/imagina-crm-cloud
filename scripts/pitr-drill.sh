#!/usr/bin/env bash
#
# Drill de Point-In-Time Recovery (PITR) — F5, STANDALONE §14/§17.
#
# Prueba de punta a punta que el archivado de WAL + un base backup físico
# permiten restaurar la base a un instante ELEGIDO (no sólo al último dump):
#
#   1. Levanta el Postgres de PRODUCCIÓN tal cual (`deploy/docker-compose.prod.yml`,
#      con su entrypoint, su `archive_command` y su volumen nombrado de archivo)
#      en un proyecto de compose aparte.
#   2. Verifica que el archivado FUNCIONA: carpeta de `postgres`, segmentos
#      comprimidos y ningún intento fallido.
#   3. Toma un base backup físico (pg_basebackup, formato tar).
#   4. Inserta la fila A, fuerza un switch de WAL, y anota el instante T1.
#   5. Inserta la fila B, fuerza otro switch (queda archivada).
#   6. Restaura el base backup en un cluster nuevo con recovery_target_time=T1.
#   7. Verifica que el cluster restaurado tiene A pero NO B.
#
# v0.1.337 — Antes el drill levantaba su PROPIO Postgres con un bind mount en
# 777 y un `archive_command` copiado a mano: pasaba siempre, mientras en
# producción el volumen nombrado nacía `root:root` y el archivado fallaba desde
# el primer segmento (45 GB de WAL en 20 días). Ahora prueba lo que corre.
#
# Todo en contenedores y volúmenes throwaway; no toca datos reales.
#
# Uso:  ./scripts/pitr-drill.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/deploy/docker-compose.prod.yml}"
PROJECT="imagina-pitr-drill-$$"
DST="imagina-pitr-dst-$$"
WORK="$(mktemp -d /tmp/pitr-drill.XXXXXX)"
BASE="$WORK/base"             # base backup físico
DATA2="$WORK/data2"           # cluster restaurado
ENV_FILE="$WORK/drill.env"
mkdir -p "$BASE" "$DATA2"
chmod -R 777 "$WORK"          # postgres corre como uid 70 en alpine
cat > "$ENV_FILE" <<'EOF'
POSTGRES_USER=postgres
POSTGRES_PASSWORD=drillpass
POSTGRES_DB=postgres
POSTGRES_PORT=0
REDIS_PASSWORD=unused
REDIS_PORT=0
EOF

# Lo mismo que usa scripts/pitr-restore.sh: acepta segmentos comprimidos
# (v0.1.337) y sin comprimir (archivados por el comando anterior).
RESTORE_COMMAND='f=/wal_archive/%f; if [ -f "$f.gz" ]; then gunzip -c "$f.gz" > "%p"; else cp "$f" "%p"; fi'

log() { printf '→ %s\n' "$*"; }
compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
cleanup() {
    docker rm -f "$DST" >/dev/null 2>&1 || true
    compose down -v >/dev/null 2>&1 || true
    docker run --rm -v "$WORK":/w alpine:3 rm -rf /w/data2 /w/base >/dev/null 2>&1 || true
    rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

SRC="${PROJECT}-postgres-1"
psql_src() { docker exec "$SRC" psql -U postgres -d postgres -tAc "$1"; }
wait_ready() {
    local c="$1"
    # El entrypoint oficial arranca un Postgres temporal para el initdb y lo
    # apaga: esperar a que responda dos veces seguidas evita ese falso "listo".
    local ok=0
    for _ in $(seq 1 60); do
        if docker exec "$c" pg_isready -U postgres -d postgres >/dev/null 2>&1 && docker exec "$c" psql -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
            ok=$((ok + 1)); [[ $ok -ge 2 ]] && return 0
        else
            ok=0
        fi
        sleep 1
    done
    echo "postgres ($c) no quedó listo" >&2; return 1
}
fail() { echo "❌ $*" >&2; exit 1; }

# ── 1. El Postgres de producción, tal cual ──────────────────────────────────
log "levantando el Postgres de producción ($COMPOSE_FILE) como proyecto $PROJECT"
compose up -d postgres >/dev/null 2>"$WORK/compose.log" || { cat "$WORK/compose.log" >&2; fail "no se pudo levantar el Postgres de producción"; }
wait_ready "$SRC"
psql_src "CREATE TABLE drill (id int primary key, v text);" >/dev/null

# ── 2. ¿Archiva de verdad? ───────────────────────────────────────────────────
psql_src "SELECT pg_switch_wal();" >/dev/null
for _ in $(seq 1 30); do
    [[ "$(psql_src "SELECT archived_count FROM pg_stat_archiver;")" -ge 1 ]] && break
    sleep 1
done
owner="$(docker exec "$SRC" stat -c %U /wal_archive)"
archived="$(psql_src "SELECT archived_count FROM pg_stat_archiver;")"
failed="$(psql_src "SELECT failed_count FROM pg_stat_archiver;")"
log "archivo: dueño=$owner, archivados=$archived, fallidos=$failed"
[[ "$owner" == "postgres" ]] || fail "la carpeta del archivo es de '$owner', no de postgres: el archivado va a fallar siempre."
[[ "$archived" -ge 1 && "$failed" == "0" ]] || fail "el archivado no funciona (archivados=$archived, fallidos=$failed). Ver: docker logs $SRC"
docker exec "$SRC" sh -c 'ls /wal_archive/*.gz >/dev/null 2>&1' || fail "los segmentos archivados no están comprimidos (.gz)."

# ── 3. Base backup físico (pg_basebackup, formato tar) ──────────────────────
log "base backup físico (pg_basebackup)"
docker exec "$SRC" pg_basebackup -U postgres -D /tmp/base -Ft -z -Xs -P >/dev/null 2>&1
docker cp "$SRC":/tmp/base/. "$BASE"/ >/dev/null
test -f "$BASE/base.tar.gz" || fail "no se generó base.tar.gz"

# ── 4. Fila A + switch de WAL + instante objetivo T1 ────────────────────────
psql_src "INSERT INTO drill VALUES (1, 'A');" >/dev/null
psql_src "SELECT pg_switch_wal();" >/dev/null
sleep 1
T1="$(psql_src "SELECT now();")"
log "T1 (objetivo de restore, tras A) = $T1"
sleep 1

# ── 5. Fila B + switch (queda archivada, pero es POSTERIOR a T1) ─────────────
psql_src "INSERT INTO drill VALUES (2, 'B');" >/dev/null
last="$(psql_src "SELECT pg_walfile_name(pg_switch_wal());")"
psql_src "CHECKPOINT;" >/dev/null
for _ in $(seq 1 30); do
    [[ "$(psql_src "SELECT coalesce(last_archived_wal, '') >= '$last' FROM pg_stat_archiver;")" == "t" ]] && break
    sleep 1
done
log "fuente tiene: $(psql_src "SELECT string_agg(v, ',' ORDER BY id) FROM drill;") · último segmento archivado: $(psql_src "SELECT last_archived_wal FROM pg_stat_archiver;")"
docker stop "$SRC" >/dev/null

# ── 6. Restaurar el base backup en un cluster nuevo, recovery a T1 ──────────
log "restaurando base backup en cluster nuevo"
tar -xzf "$BASE/base.tar.gz" -C "$DATA2"
# WAL streamed (-Xs) viene en pg_wal.tar.gz → al pg_wal del cluster restaurado.
if [[ -f "$BASE/pg_wal.tar.gz" ]]; then
    tar -xzf "$BASE/pg_wal.tar.gz" -C "$DATA2/pg_wal"
fi
cat >> "$DATA2/postgresql.auto.conf" <<EOF
restore_command = '$RESTORE_COMMAND'
recovery_target_time = '$T1'
recovery_target_action = 'promote'
EOF
touch "$DATA2/recovery.signal"
chmod -R 777 "$DATA2"

log "levantando Postgres restaurado (replay de WAL hasta T1)"
docker run -d --name "$DST" \
    -e POSTGRES_PASSWORD=drillpass \
    -v "$DATA2":/var/lib/postgresql/data \
    -v "${PROJECT}_walarchive":/wal_archive:ro \
    "$(docker inspect -f '{{.Config.Image}}' "$SRC")" \
    -c archive_mode=off >/dev/null
wait_ready "$DST"
# Esperar a que termine el recovery (promote).
for _ in $(seq 1 30); do
    in_recovery="$(docker exec "$DST" psql -U postgres -d postgres -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo t)"
    [[ "$in_recovery" == "f" ]] && break
    sleep 1
done

# ── 7. Verificación: A presente, B ausente ──────────────────────────────────
RESULT="$(docker exec "$DST" psql -U postgres -d postgres -tAc "SELECT string_agg(v, ',' ORDER BY id) FROM drill;")"
log "cluster restaurado (recovery a T1) tiene: '$RESULT'"

if [[ "$RESULT" == "A" ]]; then
    echo "✅ PITR OK: archivado comprimido funcionando y restauración exacta al instante T1 (A sí, B no)."
    exit 0
else
    echo "❌ PITR FALLÓ: se esperaba 'A', se obtuvo '$RESULT'." >&2
    exit 1
fi
