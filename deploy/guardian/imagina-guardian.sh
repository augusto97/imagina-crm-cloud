#!/usr/bin/env bash
# Guardián del servidor de Imagina Base (v0.1.431, ADR-S104).
#
# Corre como root cada minuto (imagina-guardian.timer) y cuando la app pide una
# reparación (imagina-guardian.path). Revisa y repara solo, sin consola:
#   · la app (API): si no responde 3 minutos seguidos, la reinicia; si deja de
#     responder justo después de una actualización, vuelve a la versión
#     anterior (sólo el código: la base no se toca);
#   · la base de datos (contenedor de Postgres): si está detenida, la levanta;
#   · Redis: si el servicio está detenido, lo levanta;
#   · la puerta de entrada (Nginx o Caddy): si está detenida la levanta, y si
#     ServerAvatar reescribió la configuración de Nginx, la repone con
#     serveravatar-nginx.sh (prueba con nginx -t y vuelve atrás si falla);
#   · el disco: si se está llenando, borra lo que sobra (versiones y copias
#     previas de más, registros del sistema, imágenes de Docker sin uso).
# Lo que ve y lo que hace queda en $STATE/status.json y $STATE/events.jsonl, que
# la app lee (Plataforma → Diagnóstico) y avisa por correo.
#
# La app sólo puede PEDIR una revisión (un archivo en $STATE/requests); el
# contenido del archivo no se lee: nunca ejecuta nada que venga de la app.
set -uo pipefail

GUARDIAN_VERSION=1
CONF="${GUARDIAN_CONF:-/etc/imagina-base/guardian.conf}"
STATE="${GUARDIAN_STATE:-/var/lib/imagina-base/guardian}"
LIB="${GUARDIAN_LIB:-/usr/local/lib/imagina-base}"
LOCK="${GUARDIAN_LOCK:-/run/imagina-guardian.lock}"

# ── configuración (la escribe el instalador; es de root) ──────────────────
BASE=/opt/imagina-base
DOMAIN=
API_PORT=3001
SERVICE=imagina-api
PG_CONTAINER=
REDIS_SERVICE=
WEB_MODE=none
APP_USER=
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

mkdir -p "$STATE/state" "$STATE/requests"
exec 9>"$LOCK"
flock -n 9 || exit 0

NOW=$(date +%s)
ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EVENTS="$STATE/events.jsonl"

json_str() {
    local s=${1//\\/\\\\}
    s=${s//\"/\\\"}
    s=${s//$'\n'/\\n}
    s=${s//$'\r'/}
    s=${s//$'\t'/ }
    printf '"%s"' "$s"
}

# event <kind> <ok:true|false> <mensaje>
event() {
    printf '{"id":"%s-%s","at":"%s","kind":"%s","ok":%s,"message":%s}\n' \
        "$NOW" "$RANDOM" "$ISO" "$1" "$2" "$(json_str "$3")" >> "$EVENTS"
    LAST_ACTION="{\"at\":\"$ISO\",\"kind\":\"$1\",\"ok\":$2,\"message\":$(json_str "$3")}"
}

# Cuenta acciones en la última hora (para no entrar en un bucle).
recent_count() {
    local f="$STATE/state/$1" n=0 t
    [ -f "$f" ] || { echo 0; return; }
    while read -r t; do [ -n "$t" ] && [ $((NOW - t)) -lt 3600 ] && n=$((n + 1)); done < "$f"
    echo "$n"
}
note_action() {
    local f="$STATE/state/$1"
    { [ -f "$f" ] && tail -n 20 "$f"; echo "$NOW"; } > "$f.tmp" 2>/dev/null
    mv -f "$f.tmp" "$f"
}

http_code() { curl -s -o /dev/null -w '%{http_code}' -m 8 "$@" 2>/dev/null || true; }
api_live() { [ "$(http_code "http://127.0.0.1:${API_PORT}/api/v1/health/live")" = "200" ]; }
wait_api() {
    local i
    for i in $(seq 1 30); do api_live && return 0; sleep 2; done
    return 1
}
tail_lines() { printf '%s' "$1" | tail -n "${2:-4}" | tr '\n' ' ' | cut -c1-400; }

LAST_ACTION=null
REQUESTED=false
if compgen -G "$STATE/requests/*" >/dev/null; then
    REQUESTED=true
    rm -f "$STATE"/requests/* 2>/dev/null || true
fi

CHECK_API=unknown
CHECK_DB=unknown
CHECK_REDIS=unknown
CHECK_FRONT=skipped
CHECK_WEB=skipped

# ── 1. Base de datos (contenedor) ──────────────────────────────────────────
if [ -n "$PG_CONTAINER" ] && command -v docker >/dev/null 2>&1; then
    running=$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null || echo missing)
    if [ "$running" = "true" ]; then
        CHECK_DB=ok
    elif [ "$running" = "false" ]; then
        if out=$(docker start "$PG_CONTAINER" 2>&1); then
            sleep 3
            CHECK_DB=ok
            event postgres_started true "La base de datos (contenedor $PG_CONTAINER) estaba detenida: se volvió a levantar."
        else
            CHECK_DB=down
            event postgres_start_failed false "La base de datos (contenedor $PG_CONTAINER) está detenida y no se pudo levantar: $(tail_lines "$out")"
        fi
    else
        CHECK_DB=down
        [ "$(recent_count db_missing)" -eq 0 ] && {
            note_action db_missing
            event postgres_missing false "No existe el contenedor de la base de datos ($PG_CONTAINER). Hay que recrearlo con docker compose (ver docs/runbook-disk.md)."
        }
    fi
fi

# ── 2. Redis ───────────────────────────────────────────────────────────────
if [ -n "$REDIS_SERVICE" ]; then
    if systemctl is-active --quiet "$REDIS_SERVICE"; then
        CHECK_REDIS=ok
    elif [ "$(recent_count redis)" -lt 3 ]; then
        note_action redis
        if systemctl restart "$REDIS_SERVICE" 2>/dev/null && sleep 2 && systemctl is-active --quiet "$REDIS_SERVICE"; then
            CHECK_REDIS=ok
            event redis_restarted true "Redis ($REDIS_SERVICE) estaba detenido: se volvió a levantar."
        else
            CHECK_REDIS=down
            event redis_restart_failed false "Redis ($REDIS_SERVICE) está detenido y no se pudo levantar."
        fi
    else
        CHECK_REDIS=down
    fi
fi

# ── 3. La app (API) ────────────────────────────────────────────────────────
CURRENT_TARGET=$(readlink -f "$BASE/current" 2>/dev/null || true)
CURRENT_AGE=999999
if [ -L "$BASE/current" ]; then CURRENT_AGE=$((NOW - $(stat -c %Y "$BASE/current"))); fi

if api_live; then
    CHECK_API=ok
    echo 0 > "$STATE/state/api_fail"
elif [ "$CURRENT_AGE" -lt 120 ]; then
    # Se está instalando una versión: el reinicio lo hace el actualizador.
    CHECK_API=updating
else
    fails=$(( $(cat "$STATE/state/api_fail" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" > "$STATE/state/api_fail"
    CHECK_API=down
    if [ "$fails" -ge 3 ] || [ "$REQUESTED" = true ]; then
        prev=
        # Volver atrás sólo una vez cada media hora: si la versión anterior
        # tampoco arranca, no se sigue bajando de versión en cadena.
        if [ -n "$CURRENT_TARGET" ] && [ "$CURRENT_AGE" -lt 1800 ] && [ "$(recent_count rollback)" -eq 0 ] && [ "$(cat "$STATE/state/rolled_back_from" 2>/dev/null)" != "$CURRENT_TARGET" ]; then
            cur_name=$(basename "$CURRENT_TARGET")
            for d in $(ls -1 "$BASE/releases" 2>/dev/null | sort); do
                [ "$d" \< "$cur_name" ] || continue
                [ -f "$BASE/releases/$d/apps/api/dist/main.js" ] && prev="$BASE/releases/$d"
            done
        fi
        if [ -n "$prev" ]; then
            echo "$CURRENT_TARGET" > "$STATE/state/rolled_back_from"
            note_action rollback
            ln -sfn "$prev" "$BASE/current"
            systemctl restart "$SERVICE" 2>/dev/null
            if wait_api; then
                CHECK_API=ok
                echo 0 > "$STATE/state/api_fail"
                event rolled_back true "La app no arrancó después de actualizar a $(basename "$CURRENT_TARGET"): se volvió a la versión anterior ($(basename "$prev")). Los datos no se tocaron."
            else
                event rollback_failed false "La app no arrancó después de actualizar a $(basename "$CURRENT_TARGET") y tampoco con la versión anterior ($(basename "$prev")). Hay que revisarla."
            fi
        elif [ "$(recent_count api_restart)" -lt 3 ]; then
            note_action api_restart
            systemctl restart "$SERVICE" 2>/dev/null
            if wait_api; then
                CHECK_API=ok
                echo 0 > "$STATE/state/api_fail"
                event api_restarted true "La app no respondía: se reinició y volvió."
            else
                event api_restart_failed false "La app no respondía y no volvió después de reiniciarla. Últimas líneas: $(tail_lines "$(journalctl -u "$SERVICE" -n 6 --no-pager 2>/dev/null)" 6)"
            fi
        elif [ "$(recent_count api_attention)" -eq 0 ]; then
            note_action api_attention
            event needs_attention false "La app sigue sin responder después de 3 reinicios en la última hora. No se reinicia más hasta que alguien la revise."
        fi
    fi
fi

# ── 4. La puerta de entrada (Nginx / Caddy) ────────────────────────────────
front_probe() {
    # Devuelve el código HTTP; 000 = no conecta; CERT = certificado inválido.
    local url=$1 code rc
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 --resolve "$DOMAIN:443:127.0.0.1" "$url" 2>/dev/null); rc=$?
    if [ "$rc" -eq 7 ] || [ "$rc" -eq 28 ] || [ "$rc" -eq 35 ]; then
        code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "$url" 2>/dev/null); rc=$?
    fi
    if [ "$rc" -eq 60 ] || [ "$rc" -eq 51 ] || [ "$rc" -eq 58 ]; then echo CERT; return; fi
    echo "${code:-000}"
}

if [ "$WEB_MODE" = serveravatar ] || [ "$WEB_MODE" = nginx ]; then
    CHECK_WEB=ok
    if ! systemctl is-active --quiet nginx; then
        if out=$(nginx -t 2>&1) && systemctl start nginx 2>/dev/null; then
            event nginx_started true "Nginx estaba detenido: se volvió a levantar."
        else
            CHECK_WEB=down
            [ "$(recent_count nginx_down)" -eq 0 ] && { note_action nginx_down; event nginx_start_failed false "Nginx está detenido y no arranca: $(tail_lines "$out")"; }
        fi
    fi
elif [ "$WEB_MODE" = caddy ]; then
    CHECK_WEB=ok
    if ! systemctl is-active --quiet caddy; then
        if systemctl restart caddy 2>/dev/null && sleep 2 && systemctl is-active --quiet caddy; then
            event caddy_restarted true "Caddy estaba detenido: se volvió a levantar."
        else
            CHECK_WEB=down
            [ "$(recent_count caddy_down)" -eq 0 ] && { note_action caddy_down; event caddy_start_failed false "Caddy está detenido y no arranca."; }
        fi
    fi
fi

if [ -n "$DOMAIN" ] && [ "$WEB_MODE" != none ] && [ "$CHECK_API" = ok ]; then
    api_code=$(front_probe "https://$DOMAIN/api/v1/health/live")
    root_code=$(front_probe "https://$DOMAIN/")
    if [ "$api_code" = CERT ] || [ "$root_code" = CERT ]; then
        CHECK_FRONT=cert
    elif [ "$api_code" = 200 ] && [ "$root_code" = 200 ]; then
        CHECK_FRONT=ok
    else
        CHECK_FRONT=down
    fi
    if [ "$WEB_MODE" = serveravatar ] && [ "$CHECK_FRONT" = down ]; then
        if [ "$REQUESTED" = true ] || [ "$(recent_count nginx_repair)" -lt 6 ]; then
            note_action nginx_repair
            if out=$(bash "$LIB/serveravatar-nginx.sh" "$DOMAIN" 2>&1); then
                sleep 1
                api_code=$(front_probe "https://$DOMAIN/api/v1/health/live")
                root_code=$(front_probe "https://$DOMAIN/")
                if [ "$api_code" = 200 ] && [ "$root_code" = 200 ]; then
                    event nginx_repaired true "La app no abría desde afuera: se repuso la configuración de Nginx (probablemente ServerAvatar la reescribió al emitir el certificado) y volvió."
                    CHECK_FRONT=ok
                else
                    CHECK_FRONT=down
                    event nginx_repair_failed false "Se repuso la configuración de Nginx pero la app sigue sin abrir (inicio: $root_code, /api: $api_code)."
                fi
            else
                event nginx_repair_failed false "No se pudo reponer la configuración de Nginx: $(tail_lines "$out" 6)"
            fi
        elif [ "$(recent_count front_attention)" -eq 0 ]; then
            note_action front_attention
            event needs_attention false "La app sigue sin abrir desde afuera después de 6 reparaciones de Nginx en la última hora."
        fi
    fi
fi

# ── 5. Disco ───────────────────────────────────────────────────────────────
read -r DISK_TOTAL DISK_FREE < <(df -PB1 "$BASE" 2>/dev/null | awk 'NR==2 {print $2, $4}')
read -r INO_TOTAL INO_FREE < <(df -Pi "$BASE" 2>/dev/null | awk 'NR==2 {print $2, $4}')
DISK_TOTAL=${DISK_TOTAL:-0}; DISK_FREE=${DISK_FREE:-0}; INO_TOTAL=${INO_TOTAL:-0}; INO_FREE=${INO_FREE:-0}
MIN_FREE=$((1024 * 1024 * 1024))
[ $((DISK_TOTAL / 20)) -gt "$MIN_FREE" ] && MIN_FREE=$((DISK_TOTAL / 20))
DISK_OK=true
if { [ "$DISK_TOTAL" -gt 0 ] && [ "$DISK_FREE" -lt "$MIN_FREE" ]; } || { [ "$INO_TOTAL" -gt 0 ] && [ "$INO_FREE" -lt 60000 ]; }; then
    DISK_OK=false
    if [ "$(recent_count cleanup)" -lt 2 ]; then
        note_action cleanup
        before=$DISK_FREE
        removed=0
        cur_name=$(basename "${CURRENT_TARGET:-none}")
        # Versiones: la activa + las 2 completas más nuevas; restos de descargas
        # y carpetas a medio extraer (de más de una hora: no la que se está
        # instalando ahora).
        keep=0
        for d in $(ls -1 "$BASE/releases" 2>/dev/null | sort -r); do
            p="$BASE/releases/$d"
            [ "$d" = "$cur_name" ] && continue
            if [ -d "$p" ] && [ -f "$p/apps/api/dist/main.js" ]; then
                keep=$((keep + 1))
                [ "$keep" -le 2 ] && continue
                rm -rf "$p" && removed=$((removed + 1))
            elif [ $((NOW - $(stat -c %Y "$p"))) -gt 3600 ]; then
                rm -rf "$p" && removed=$((removed + 1))
            fi
        done
        # Copias previas a cada actualización: las 5 más nuevas.
        for f in $(ls -1t "$BASE"/shared/backups/imagina-base-*.dump* 2>/dev/null | tail -n +6); do
            rm -f "$f" && removed=$((removed + 1))
        done
        journalctl --vacuum-size=200M >/dev/null 2>&1 || true
        command -v apt-get >/dev/null 2>&1 && apt-get clean >/dev/null 2>&1 || true
        command -v docker >/dev/null 2>&1 && docker image prune -f >/dev/null 2>&1 || true
        after=$(df -PB1 "$BASE" 2>/dev/null | awk 'NR==2 {print $4}')
        freed=$(( ${after:-$before} - before ))
        [ "$freed" -lt 0 ] && freed=0
        DISK_FREE=${after:-$DISK_FREE}
        INO_FREE=$(df -Pi "$BASE" 2>/dev/null | awk 'NR==2 {print $4}')
        INO_FREE=${INO_FREE:-0}
        if [ "$DISK_FREE" -ge "$MIN_FREE" ] && { [ "$INO_TOTAL" -eq 0 ] || [ "$INO_FREE" -ge 60000 ]; }; then
            DISK_OK=true
            event disk_cleaned true "El disco se estaba llenando: se liberaron $((freed / 1024 / 1024)) MB ($removed versiones y copias viejas, registros del sistema e imágenes sin uso)."
        else
            event disk_still_full false "El disco se estaba llenando y lo que se pudo limpiar ($((freed / 1024 / 1024)) MB) no alcanza: quedan $((DISK_FREE / 1024 / 1024)) MB libres. Hay que revisar qué ocupa el espacio."
        fi
    fi
fi

# ── 6. Estado para la app ──────────────────────────────────────────────────
if [ -f "$EVENTS" ] && [ "$(wc -l < "$EVENTS")" -gt 300 ]; then
    tail -n 300 "$EVENTS" > "$EVENTS.tmp" && mv -f "$EVENTS.tmp" "$EVENTS"
fi
cat > "$STATE/status.json.tmp" <<JSON
{"version":$GUARDIAN_VERSION,"updated_at":"$ISO","domain":$(json_str "$DOMAIN"),"web_mode":$(json_str "$WEB_MODE"),"requested":$REQUESTED,"current_release":$(json_str "$(basename "${CURRENT_TARGET:-}")"),"checks":{"api":"$CHECK_API","database":"$CHECK_DB","redis":"$CHECK_REDIS","web_server":"$CHECK_WEB","front":"$CHECK_FRONT","disk":{"ok":$DISK_OK,"free_bytes":$DISK_FREE,"total_bytes":$DISK_TOTAL,"free_inodes":$INO_FREE,"total_inodes":$INO_TOTAL}},"last_action":$LAST_ACTION}
JSON
mv -f "$STATE/status.json.tmp" "$STATE/status.json"
chmod 0644 "$STATE/status.json" "$EVENTS" 2>/dev/null || true
exit 0
