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
#
# v0.1.432 — También se usa a mano (comandos imagina-estado e imagina-reparar,
# como root) y desde la página de rescate (imagina-rescue.mjs, con su propio
# usuario sin permisos: deja pedidos en $STATE/rescue/requests, por NOMBRE —
# repair-, restart-, rollback-, cleanup- — y el guardián nunca lee su contenido):
#   --check     sólo revisa, no arregla nada
#   --human     cuenta en palabras lo que ve y lo que hace
#   --force     revisa y arregla todo ya, sin los límites por hora
#   --restart   reinicia la app
#   --rollback  vuelve a la versión anterior (sólo el código)
#   --cleanup   libera espacio aunque el disco no esté lleno
set -uo pipefail

GUARDIAN_VERSION=2
CONF="${GUARDIAN_CONF:-/etc/imagina-base/guardian.conf}"
STATE="${GUARDIAN_STATE:-/var/lib/imagina-base/guardian}"
LIB="${GUARDIAN_LIB:-/usr/local/lib/imagina-base}"
LOCK="${GUARDIAN_LOCK:-/run/imagina-guardian.lock}"

CHECK_ONLY=0
HUMAN=0
OPERATOR=0
FORCE_RESTART=0
FORCE_ROLLBACK=0
FORCE_CLEANUP=0
SOURCE=auto
for arg in "$@"; do
    case "$arg" in
        --check) CHECK_ONLY=1 ;;
        --human) HUMAN=1 ;;
        --force) OPERATOR=1 ;;
        --restart) OPERATOR=1; FORCE_RESTART=1 ;;
        --rollback) OPERATOR=1; FORCE_ROLLBACK=1 ;;
        --cleanup) OPERATOR=1; FORCE_CLEANUP=1 ;;
        *) echo "Uso: $0 [--check] [--human] [--force | --restart | --rollback | --cleanup]" >&2; exit 2 ;;
    esac
done
if [ "$CHECK_ONLY" = 1 ] && [ "$OPERATOR" = 1 ]; then
    echo "--check sólo revisa: no se combina con una reparación." >&2
    exit 2
fi
[ "$OPERATOR" = 1 ] && SOURCE=ssh

say() { [ "$HUMAN" = 1 ] && printf '%s\n' "$*"; return 0; }

# ── configuración (la escribe el instalador; es de root) ──────────────────
BASE=/opt/imagina-base
DOMAIN=
API_PORT=3001
SERVICE=imagina-api
PG_CONTAINER=
REDIS_SERVICE=
WEB_MODE=none
APP_USER=
RESCUE_ENABLED=0
RESCUE_PORT=8899
RESCUE_USER=
RESCUE_SERVICE=imagina-rescue
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"
CONF_DIR=$(dirname "$CONF")
RESCUE_TLS="${GUARDIAN_RESCUE_TLS:-$CONF_DIR/rescue-tls.conf}"
RESCUE_DIR="$STATE/rescue"

mkdir -p "$STATE/state" "$STATE/requests"
exec 9>"$LOCK"
if ! flock -n 9; then
    # A mano se espera a que termine la revisión que está corriendo; la del
    # timer simplemente no se superpone.
    [ "$HUMAN" = 1 ] || exit 0
    say "Hay una revisión en curso; espero a que termine…"
    flock -w 300 9 || { say "La revisión anterior no terminó en 5 minutos. Vuelve a intentarlo."; exit 1; }
fi

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
ISSUES=0
if [ "$CHECK_ONLY" = 0 ]; then
    if compgen -G "$STATE/requests/*" >/dev/null; then
        REQUESTED=true
        rm -f "$STATE"/requests/* 2>/dev/null || true
    fi
    # Pedidos de la página de rescate: sólo cuenta el NOMBRE del archivo.
    if [ -d "$RESCUE_DIR/requests" ] && compgen -G "$RESCUE_DIR/requests/*" >/dev/null; then
        for f in "$RESCUE_DIR"/requests/*; do
            case "$(basename -- "$f")" in
                repair-*) OPERATOR=1 ;;
                restart-*) OPERATOR=1; FORCE_RESTART=1 ;;
                rollback-*) OPERATOR=1; FORCE_ROLLBACK=1 ;;
                cleanup-*) OPERATOR=1; FORCE_CLEANUP=1 ;;
            esac
            rm -f -- "$f" 2>/dev/null || true
        done
        REQUESTED=true
        SOURCE=rescue
    fi
fi
[ "$OPERATOR" = 1 ] && REQUESTED=true

can_fix() { [ "$CHECK_ONLY" = 0 ]; }
# Los límites por hora evitan bucles; quien lo pide a mano (SSH o la página de
# rescate) los salta.
under_limit() { [ "$OPERATOR" = 1 ] || [ "$(recent_count "$1")" -lt "$2" ]; }
who() { case "$SOURCE" in rescue) echo "desde la página de rescate" ;; ssh) echo "por SSH" ;; *) echo "a pedido" ;; esac; }

if [ "$HUMAN" = 1 ]; then
    say "Revisando el servidor${DOMAIN:+ ($DOMAIN)}…"
    [ "$CHECK_ONLY" = 1 ] && say "(sólo revisar: no se arregla nada)"
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
        say "  ✓ Base de datos: funciona"
    elif [ "$running" = "false" ] && ! can_fix; then
        CHECK_DB=down
        say "  ✗ Base de datos: detenida"
    elif [ "$running" = "false" ]; then
        if out=$(docker start "$PG_CONTAINER" 2>&1); then
            sleep 3
            CHECK_DB=ok
            event postgres_started true "La base de datos (contenedor $PG_CONTAINER) estaba detenida: se volvió a levantar."
            say "  ✓ Base de datos: estaba detenida → se levantó"
        else
            CHECK_DB=down
            event postgres_start_failed false "La base de datos (contenedor $PG_CONTAINER) está detenida y no se pudo levantar: $(tail_lines "$out")"
            say "  ✗ Base de datos: detenida y no se pudo levantar: $(tail_lines "$out" 2)"
        fi
    else
        CHECK_DB=down
        say "  ✗ Base de datos: no existe el contenedor $PG_CONTAINER (hay que recrearlo: docs/runbook-disk.md)"
        can_fix && [ "$(recent_count db_missing)" -eq 0 ] && {
            note_action db_missing
            event postgres_missing false "No existe el contenedor de la base de datos ($PG_CONTAINER). Hay que recrearlo con docker compose (ver docs/runbook-disk.md)."
        }
    fi
fi

# ── 2. Redis ───────────────────────────────────────────────────────────────
if [ -n "$REDIS_SERVICE" ]; then
    if systemctl is-active --quiet "$REDIS_SERVICE"; then
        CHECK_REDIS=ok
        say "  ✓ Redis: funciona"
    elif can_fix && under_limit redis 3; then
        note_action redis
        if systemctl restart "$REDIS_SERVICE" 2>/dev/null && sleep 2 && systemctl is-active --quiet "$REDIS_SERVICE"; then
            CHECK_REDIS=ok
            event redis_restarted true "Redis ($REDIS_SERVICE) estaba detenido: se volvió a levantar."
            say "  ✓ Redis: estaba detenido → se levantó"
        else
            CHECK_REDIS=down
            event redis_restart_failed false "Redis ($REDIS_SERVICE) está detenido y no se pudo levantar."
            say "  ✗ Redis: detenido y no se pudo levantar"
        fi
    else
        CHECK_REDIS=down
        say "  ✗ Redis: detenido"
    fi
fi

# ── 3. La app (API) ────────────────────────────────────────────────────────
CURRENT_TARGET=$(readlink -f "$BASE/current" 2>/dev/null || true)
CURRENT_AGE=999999
if [ -L "$BASE/current" ]; then CURRENT_AGE=$((NOW - $(stat -c %Y "$BASE/current"))); fi

# La versión completa anterior a la activa (la más nueva de las más viejas).
previous_release() {
    local cur_name d prev=
    cur_name=$(basename "$CURRENT_TARGET")
    for d in $(ls -1 "$BASE/releases" 2>/dev/null | sort); do
        [ "$d" \< "$cur_name" ] || continue
        [ -f "$BASE/releases/$d/apps/api/dist/main.js" ] && prev="$BASE/releases/$d"
    done
    printf '%s' "$prev"
}

# do_rollback <kind-ok> <kind-fail> <texto-ok> <texto-fail>; devuelve 0 si volvió.
do_rollback() {
    local prev
    prev=$(previous_release)
    [ -n "$prev" ] || return 2
    echo "$CURRENT_TARGET" > "$STATE/state/rolled_back_from"
    note_action rollback
    ln -sfn "$prev" "$BASE/current"
    systemctl restart "$SERVICE" 2>/dev/null
    if wait_api; then
        CHECK_API=ok
        echo 0 > "$STATE/state/api_fail"
        event "$1" true "$3 ($(basename "$CURRENT_TARGET") → $(basename "$prev")). Los datos no se tocaron."
        say "  ✓ La app: volvió a la versión anterior ($(basename "$prev")) y responde"
        CURRENT_TARGET=$prev
        return 0
    fi
    event "$2" false "$4 ($(basename "$prev")). Últimas líneas: $(tail_lines "$(journalctl -u "$SERVICE" -n 6 --no-pager 2>/dev/null)" 6)"
    say "  ✗ La app: se volvió a la versión anterior ($(basename "$prev")) pero no responde"
    CURRENT_TARGET=$prev
    ISSUES=$((ISSUES + 1))
    return 1
}

if [ "$FORCE_ROLLBACK" = 1 ]; then
    if [ -z "$CURRENT_TARGET" ] || [ -z "$(previous_release)" ]; then
        CHECK_API=$(api_live && echo ok || echo down)
        event manual_rollback_failed false "Se pidió volver a la versión anterior $(who), pero no hay una versión anterior completa guardada."
        say "  ✗ No hay una versión anterior completa guardada: no se puede volver atrás."
        ISSUES=$((ISSUES + 1))
    else
        do_rollback manual_rollback manual_rollback_failed \
            "Se volvió a la versión anterior $(who)" \
            "Se volvió a la versión anterior $(who), pero la app no responde"
    fi
elif [ "$FORCE_RESTART" = 1 ]; then
    note_action api_restart
    systemctl restart "$SERVICE" 2>/dev/null
    if wait_api; then
        CHECK_API=ok
        echo 0 > "$STATE/state/api_fail"
        event manual_restart true "Se reinició la app $(who) y responde."
        say "  ✓ La app: se reinició y responde"
    else
        CHECK_API=down
        event manual_restart_failed false "Se reinició la app $(who), pero no responde. Últimas líneas: $(tail_lines "$(journalctl -u "$SERVICE" -n 6 --no-pager 2>/dev/null)" 6)"
        say "  ✗ La app: se reinició pero no responde"
        ISSUES=$((ISSUES + 1))
    fi
elif api_live; then
    CHECK_API=ok
    can_fix && echo 0 > "$STATE/state/api_fail"
    say "  ✓ La app: funciona"
elif [ "$CURRENT_AGE" -lt 120 ]; then
    # Se está instalando una versión: el reinicio lo hace el actualizador.
    CHECK_API=updating
    say "  … La app: se está instalando una versión"
elif ! can_fix; then
    CHECK_API=down
    say "  ✗ La app: no responde"
else
    fails=$(( $(cat "$STATE/state/api_fail" 2>/dev/null || echo 0) + 1 ))
    echo "$fails" > "$STATE/state/api_fail"
    CHECK_API=down
    if [ "$fails" -ge 3 ] || [ "$REQUESTED" = true ]; then
        rollback_ok=0
        # Volver atrás sólo una vez cada media hora: si la versión anterior
        # tampoco arranca, no se sigue bajando de versión en cadena.
        if [ -n "$CURRENT_TARGET" ] && [ "$CURRENT_AGE" -lt 1800 ] && [ "$(recent_count rollback)" -eq 0 ] && [ "$(cat "$STATE/state/rolled_back_from" 2>/dev/null)" != "$CURRENT_TARGET" ] && [ -n "$(previous_release)" ]; then
            rollback_ok=1
        fi
        if [ "$rollback_ok" = 1 ]; then
            do_rollback rolled_back rollback_failed \
                "La app no arrancó después de actualizar: se volvió a la versión anterior" \
                "La app no arrancó después de actualizar y tampoco con la versión anterior"
        elif under_limit api_restart 3; then
            note_action api_restart
            systemctl restart "$SERVICE" 2>/dev/null
            if wait_api; then
                CHECK_API=ok
                echo 0 > "$STATE/state/api_fail"
                event api_restarted true "La app no respondía: se reinició y volvió."
                say "  ✓ La app: no respondía → se reinició y volvió"
            else
                event api_restart_failed false "La app no respondía y no volvió después de reiniciarla. Últimas líneas: $(tail_lines "$(journalctl -u "$SERVICE" -n 6 --no-pager 2>/dev/null)" 6)"
                say "  ✗ La app: no responde, ni después de reiniciarla"
                ISSUES=$((ISSUES + 1))
            fi
        else
            [ "$(recent_count api_attention)" -eq 0 ] && {
                note_action api_attention
                event needs_attention false "La app sigue sin responder después de 3 reinicios en la última hora. No se reinicia más hasta que alguien la revise."
            }
            say "  ✗ La app: no responde (ya se reinició 3 veces en la última hora)"
            ISSUES=$((ISSUES + 1))
        fi
    else
        say "  ✗ La app: no responde (se reinicia si sigue así $((3 - fails)) minuto(s) más)"
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
    if systemctl is-active --quiet nginx; then
        say "  ✓ Nginx: funciona"
    elif ! can_fix; then
        CHECK_WEB=down
        say "  ✗ Nginx: detenido"
    elif out=$(nginx -t 2>&1) && systemctl start nginx 2>/dev/null; then
        event nginx_started true "Nginx estaba detenido: se volvió a levantar."
        say "  ✓ Nginx: estaba detenido → se levantó"
    else
        CHECK_WEB=down
        [ "$(recent_count nginx_down)" -eq 0 ] && { note_action nginx_down; event nginx_start_failed false "Nginx está detenido y no arranca: $(tail_lines "$out")"; }
        say "  ✗ Nginx: detenido y no arranca: $(tail_lines "$out" 2)"
        ISSUES=$((ISSUES + 1))
    fi
elif [ "$WEB_MODE" = caddy ]; then
    CHECK_WEB=ok
    if systemctl is-active --quiet caddy; then
        say "  ✓ Caddy: funciona"
    elif ! can_fix; then
        CHECK_WEB=down
        say "  ✗ Caddy: detenido"
    elif systemctl restart caddy 2>/dev/null && sleep 2 && systemctl is-active --quiet caddy; then
        event caddy_restarted true "Caddy estaba detenido: se volvió a levantar."
        say "  ✓ Caddy: estaba detenido → se levantó"
    else
        CHECK_WEB=down
        [ "$(recent_count caddy_down)" -eq 0 ] && { note_action caddy_down; event caddy_start_failed false "Caddy está detenido y no arranca."; }
        say "  ✗ Caddy: detenido y no arranca"
        ISSUES=$((ISSUES + 1))
    fi
fi

if [ -n "$DOMAIN" ] && [ "$WEB_MODE" != none ] && [ "$CHECK_API" = ok ]; then
    api_code=$(front_probe "https://$DOMAIN/api/v1/health/live")
    root_code=$(front_probe "https://$DOMAIN/")
    if [ "$api_code" = CERT ] || [ "$root_code" = CERT ]; then
        CHECK_FRONT=cert
        say "  ✗ Entrada por el dominio: el certificado no es válido (revísalo en ServerAvatar)"
        ISSUES=$((ISSUES + 1))
    elif [ "$api_code" = 200 ] && [ "$root_code" = 200 ]; then
        CHECK_FRONT=ok
        say "  ✓ Entrada por el dominio: abre"
    else
        CHECK_FRONT=down
        if [ "$WEB_MODE" != serveravatar ] || ! can_fix; then
            say "  ✗ Entrada por el dominio: no abre (inicio: $root_code, /api: $api_code)"
            ISSUES=$((ISSUES + 1))
        fi
    fi
    if [ "$WEB_MODE" = serveravatar ] && [ "$CHECK_FRONT" = down ] && can_fix; then
        if [ "$REQUESTED" = true ] || [ "$(recent_count nginx_repair)" -lt 6 ]; then
            note_action nginx_repair
            if out=$(bash "$LIB/serveravatar-nginx.sh" "$DOMAIN" 2>&1); then
                sleep 1
                api_code=$(front_probe "https://$DOMAIN/api/v1/health/live")
                root_code=$(front_probe "https://$DOMAIN/")
                if [ "$api_code" = 200 ] && [ "$root_code" = 200 ]; then
                    event nginx_repaired true "La app no abría desde afuera: se repuso la configuración de Nginx (probablemente ServerAvatar la reescribió al emitir el certificado) y volvió."
                    CHECK_FRONT=ok
                    say "  ✓ Entrada por el dominio: no abría → se repuso la configuración de Nginx y volvió"
                else
                    CHECK_FRONT=down
                    event nginx_repair_failed false "Se repuso la configuración de Nginx pero la app sigue sin abrir (inicio: $root_code, /api: $api_code)."
                    say "  ✗ Entrada por el dominio: se repuso Nginx pero sigue sin abrir (inicio: $root_code, /api: $api_code)"
                    ISSUES=$((ISSUES + 1))
                fi
            else
                event nginx_repair_failed false "No se pudo reponer la configuración de Nginx: $(tail_lines "$out" 6)"
                say "  ✗ Entrada por el dominio: no abre y no se pudo reponer Nginx: $(tail_lines "$out" 3)"
                ISSUES=$((ISSUES + 1))
            fi
        else
            [ "$(recent_count front_attention)" -eq 0 ] && {
                note_action front_attention
                event needs_attention false "La app sigue sin abrir desde afuera después de 6 reparaciones de Nginx en la última hora."
            }
            say "  ✗ Entrada por el dominio: no abre (ya se repuso Nginx 6 veces en la última hora)"
            ISSUES=$((ISSUES + 1))
        fi
    fi
elif [ -n "$DOMAIN" ] && [ "$WEB_MODE" != none ]; then
    say "  – Entrada por el dominio: sin revisar (primero tiene que responder la app)"
fi

# ── 5. Disco ───────────────────────────────────────────────────────────────
read -r DISK_TOTAL DISK_FREE < <(df -PB1 "$BASE" 2>/dev/null | awk 'NR==2 {print $2, $4}')
read -r INO_TOTAL INO_FREE < <(df -Pi "$BASE" 2>/dev/null | awk 'NR==2 {print $2, $4}')
DISK_TOTAL=${DISK_TOTAL:-0}; DISK_FREE=${DISK_FREE:-0}; INO_TOTAL=${INO_TOTAL:-0}; INO_FREE=${INO_FREE:-0}
MIN_FREE=$((1024 * 1024 * 1024))
[ $((DISK_TOTAL / 20)) -gt "$MIN_FREE" ] && MIN_FREE=$((DISK_TOTAL / 20))
DISK_OK=true
DISK_LOW=0
if { [ "$DISK_TOTAL" -gt 0 ] && [ "$DISK_FREE" -lt "$MIN_FREE" ]; } || { [ "$INO_TOTAL" -gt 0 ] && [ "$INO_FREE" -lt 60000 ]; }; then
    DISK_OK=false
    DISK_LOW=1
fi
if [ "$DISK_LOW" = 1 ] || [ "$FORCE_CLEANUP" = 1 ]; then
    if ! can_fix; then
        say "  ✗ Disco: quedan $((DISK_FREE / 1024 / 1024)) MB libres"
    elif [ "$FORCE_CLEANUP" = 1 ] || under_limit cleanup 2; then
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
            if [ "$DISK_LOW" = 1 ]; then
                event disk_cleaned true "El disco se estaba llenando: se liberaron $((freed / 1024 / 1024)) MB ($removed versiones y copias viejas, registros del sistema e imágenes sin uso)."
            else
                event manual_cleanup true "Se liberó espacio $(who): $((freed / 1024 / 1024)) MB ($removed versiones y copias viejas, registros del sistema e imágenes sin uso)."
            fi
            say "  ✓ Disco: se liberaron $((freed / 1024 / 1024)) MB; quedan $((DISK_FREE / 1024 / 1024)) MB libres"
        else
            event disk_still_full false "El disco se estaba llenando y lo que se pudo limpiar ($((freed / 1024 / 1024)) MB) no alcanza: quedan $((DISK_FREE / 1024 / 1024)) MB libres. Hay que revisar qué ocupa el espacio."
            say "  ✗ Disco: se liberaron $((freed / 1024 / 1024)) MB pero no alcanza: quedan $((DISK_FREE / 1024 / 1024)) MB libres"
            ISSUES=$((ISSUES + 1))
        fi
    else
        say "  ✗ Disco: quedan $((DISK_FREE / 1024 / 1024)) MB libres (ya se limpió 2 veces en la última hora)"
        ISSUES=$((ISSUES + 1))
    fi
else
    say "  ✓ Disco: $((DISK_FREE / 1024 / 1024)) MB libres"
fi

# ── 6. Página de rescate ───────────────────────────────────────────────────
# Un servicio aparte (imagina-rescue) que no depende de la app ni de Nginx.
# Arranca como root SÓLO para leer el certificado y abrir su puerto, y enseguida
# pasa a su usuario sin permisos. El guardián le dice qué certificado usar y lo
# reinicia cuando el certificado se renueva.

# El certificado del dominio, como lo usa Nginx o Caddy: "cert<TAB>key".
domain_cert() {
    local found=
    if [ "$WEB_MODE" = serveravatar ] || [ "$WEB_MODE" = nginx ]; then
        found=$(nginx -T 2>/dev/null | awk -v d="$DOMAIN" '
            function done_block() {
                if (insrv && hit && cert != "" && key != "") { print cert "\t" key; exit }
                insrv = 0; hit = 0; cert = ""; key = ""
            }
            {
                line = $0; sub(/#.*/, "", line)
                if (!insrv && line ~ /^[ \t]*server[ \t]*\{/) { insrv = 1; start = depth; hit = 0; cert = ""; key = "" }
                if (insrv) {
                    n = split(line, t, /[ \t;]+/)
                    for (i = 1; i <= n; i++) {
                        if (t[i] == "server_name") for (j = i + 1; j <= n; j++) if (t[j] == d) hit = 1
                        if (t[i] == "ssl_certificate" && i < n) cert = t[i + 1]
                        if (t[i] == "ssl_certificate_key" && i < n) key = t[i + 1]
                    }
                }
                o = gsub(/\{/, "{", line); c = gsub(/\}/, "}", line); depth += o - c
                if (insrv && depth <= start) done_block()
            }')
    elif [ "$WEB_MODE" = caddy ]; then
        local c
        for c in /var/lib/caddy/.local/share/caddy/certificates/*/"$DOMAIN"/"$DOMAIN".crt; do
            [ -f "$c" ] && [ -f "${c%.crt}.key" ] && { found="$c"$'\t'"${c%.crt}.key"; break; }
        done
    fi
    if [ -z "$found" ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        found="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"$'\t'"/etc/letsencrypt/live/$DOMAIN/privkey.pem"
    fi
    printf '%s' "$found"
}

RESCUE_ACTIVE=false
RESCUE_CERT_KIND=none
if [ "$RESCUE_ENABLED" = 1 ]; then
    pair=$(domain_cert)
    TAB=$'\t'
    cert=${pair%%"$TAB"*}; key=${pair#*"$TAB"}
    if [ -n "$pair" ] && [ -f "$cert" ] && [ -f "$key" ]; then
        RESCUE_CERT_KIND=domain
    elif [ -f "$CONF_DIR/rescue-self.crt" ] && [ -f "$CONF_DIR/rescue-self.key" ]; then
        cert="$CONF_DIR/rescue-self.crt"; key="$CONF_DIR/rescue-self.key"
        RESCUE_CERT_KIND=self
    fi
    if [ "$RESCUE_CERT_KIND" != none ] && can_fix; then
        wanted=$(printf 'CERT=%s\nKEY=%s\nKIND=%s\nMTIME=%s' "$cert" "$key" "$RESCUE_CERT_KIND" "$(stat -L -c %Y "$cert" 2>/dev/null || echo 0)")
        if [ "$wanted" != "$(cat "$RESCUE_TLS" 2>/dev/null)" ]; then
            had=$([ -f "$RESCUE_TLS" ] && echo 1 || echo 0)
            printf '%s\n' "$wanted" > "$RESCUE_TLS.tmp" && mv -f "$RESCUE_TLS.tmp" "$RESCUE_TLS"
            chmod 0644 "$RESCUE_TLS"
            # Certificado nuevo o renovado: la página lo toma al reiniciar.
            [ "$had" = 1 ] && systemctl is-active --quiet "$RESCUE_SERVICE" && systemctl restart "$RESCUE_SERVICE" 2>/dev/null
        fi
    fi
    if systemctl is-active --quiet "$RESCUE_SERVICE"; then
        RESCUE_ACTIVE=true
    elif can_fix && [ "$RESCUE_CERT_KIND" != none ] && under_limit rescue_start 3; then
        note_action rescue_start
        if systemctl restart "$RESCUE_SERVICE" 2>/dev/null && sleep 1 && systemctl is-active --quiet "$RESCUE_SERVICE"; then
            RESCUE_ACTIVE=true
        elif [ "$(recent_count rescue_fail)" -eq 0 ]; then
            note_action rescue_fail
            event rescue_page_failed false "La página de rescate no arranca: $(tail_lines "$(journalctl -u "$RESCUE_SERVICE" -n 4 --no-pager 2>/dev/null)" 4)"
        fi
    fi
    if [ "$RESCUE_ACTIVE" = true ]; then
        say "  ✓ Página de rescate: https://$DOMAIN:$RESCUE_PORT$([ "$RESCUE_CERT_KIND" = self ] && echo ' (certificado propio: el navegador va a avisar)')"
    else
        say "  ✗ Página de rescate: no está funcionando"
    fi
    if can_fix && [ -d "$RESCUE_DIR" ] && [ ! -L "$RESCUE_DIR" ]; then
        # Lo último que dijo la app, para leerlo cuando la app no abre.
        # Sin lo que va después de «?» en las direcciones: puede traer tokens.
        journalctl -u "$SERVICE" -n 60 --no-pager -o short-iso 2>/dev/null \
            | sed -E 's#\?[^[:space:]"]*#?…#g' > "$RESCUE_DIR/app-log.txt.tmp" || true
        mv -f "$RESCUE_DIR/app-log.txt.tmp" "$RESCUE_DIR/app-log.txt" 2>/dev/null || true
        chmod 0640 "$RESCUE_DIR/app-log.txt" 2>/dev/null || true
        [ -n "$RESCUE_USER" ] && chgrp "$(id -gn "$RESCUE_USER" 2>/dev/null || echo "$RESCUE_USER")" "$RESCUE_DIR/app-log.txt" 2>/dev/null || true
        # Quién entró a la página: lo anota la página (sólo puede escribir ese
        # archivo); aquí se copia a los eventos que la app avisa por correo. Del
        # archivo sólo se toman campos con forma conocida.
        audit="$RESCUE_DIR/audit.jsonl"
        if [ -f "$audit" ] && [ ! -L "$audit" ] && [ -s "$audit" ]; then
            n=0
            while IFS= read -r line && [ "$n" -lt 30 ]; do
                n=$((n + 1))
                what=$(printf '%s' "$line" | grep -oE '"what":"(login|blocked)"' | head -1 | cut -d'"' -f4)
                ip=$(printf '%s' "$line" | grep -oE '"ip":"[0-9A-Fa-f:.]{2,45}"' | head -1 | cut -d'"' -f4)
                case "$what" in
                    login) event rescue_login true "Alguien entró a la página de rescate${ip:+ desde $ip}." ;;
                    blocked) event rescue_blocked true "Se bloqueó por 15 minutos la página de rescate${ip:+ para $ip} después de varias claves equivocadas." ;;
                esac
            done < "$audit"
            : > "$audit"
        fi
    fi
fi

# ── 7. Estado para la app ──────────────────────────────────────────────────
if [ -f "$EVENTS" ] && [ "$(wc -l < "$EVENTS")" -gt 300 ]; then
    tail -n 300 "$EVENTS" > "$EVENTS.tmp" && mv -f "$EVENTS.tmp" "$EVENTS"
fi
cat > "$STATE/status.json.tmp" <<JSON
{"version":$GUARDIAN_VERSION,"updated_at":"$ISO","domain":$(json_str "$DOMAIN"),"web_mode":$(json_str "$WEB_MODE"),"requested":$REQUESTED,"current_release":$(json_str "$(basename "${CURRENT_TARGET:-}")"),"checks":{"api":"$CHECK_API","database":"$CHECK_DB","redis":"$CHECK_REDIS","web_server":"$CHECK_WEB","front":"$CHECK_FRONT","disk":{"ok":$DISK_OK,"free_bytes":$DISK_FREE,"total_bytes":$DISK_TOTAL,"free_inodes":$INO_FREE,"total_inodes":$INO_TOTAL}},"rescue":{"enabled":$([ "$RESCUE_ENABLED" = 1 ] && echo true || echo false),"port":${RESCUE_PORT:-0},"cert":"$RESCUE_CERT_KIND","active":$RESCUE_ACTIVE},"last_action":$LAST_ACTION}
JSON
# El modo «sólo revisar» no deja rastro: no cambia lo que ve la app.
if can_fix; then
    mv -f "$STATE/status.json.tmp" "$STATE/status.json"
    chmod 0644 "$STATE/status.json" "$EVENTS" 2>/dev/null || true
else
    rm -f "$STATE/status.json.tmp"
fi

if [ "$HUMAN" = 1 ]; then
    echo
    if { [ "$CHECK_API" = ok ] || [ "$CHECK_API" = updating ]; } && [ "$ISSUES" -eq 0 ] && [ "$CHECK_FRONT" != down ] && [ "$CHECK_FRONT" != cert ] && [ "$CHECK_DB" != down ] && [ "$CHECK_REDIS" != down ] && [ "$CHECK_WEB" != down ] && [ "$DISK_OK" = true ]; then
        say "Listo: todo funciona."
    elif [ "$CHECK_ONLY" = 1 ]; then
        say "Hay algo mal. Para que se arregle ahora: sudo imagina-reparar"
    else
        say "Quedó algo sin arreglar. Lo de arriba dice qué; los detalles de la app: journalctl -u $SERVICE -n 50"
        exit 1
    fi
fi
exit 0
