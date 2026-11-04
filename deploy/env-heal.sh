#!/usr/bin/env bash
#
# v0.1.362 — Completa el .env de un servidor instalado con lo que la app
# necesita para correr como producción. Lo llama deploy.sh en cada
# actualización (best-effort: si no puede, avisa y el deploy sigue).
#
#   bash env-heal.sh /opt/imagina-base/shared/.env.production
#
# Por qué: el runbook de ServerAvatar daba una «config mínima» SIN
# NODE_ENV=production ni los secretos. Un servidor así corre en modo
# desarrollo: los formularios públicos quedaban en blanco (pedían un módulo
# de vite que en producción no existe), /metrics quedaba abierto, no salía
# HSTS, las credenciales (SMTP, conexiones, 2FA) se guardaban SIN cifrar y
# los enlaces firmados (logo, QR, adjuntos del portal) dejaban de valer en
# cada reinicio.
#
# Qué hace, en este orden:
#   1. SECRETS_KEY y FILES_SIGNING_SECRET: si faltan o están vacíos, genera
#      uno (96 hex). Es seguro: sin clave nada se cifró, y lo guardado en
#      claro se sigue leyendo (secret-box reconoce el texto sin prefijo).
#   2. NODE_ENV: si NO está, agrega NODE_ENV=production — sólo después de
#      que los secretos existen, porque en producción el API no arranca sin
#      ellos. Un NODE_ENV puesto a mano con otro valor se respeta (se avisa).
# Nunca imprime un secreto. Conserva dueño y permisos del archivo.
set -u

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
    echo "  (aviso: no existe el archivo de configuración ${FILE:-<vacío>})"
    exit 0
fi

KEY_RE='^[[:space:]]*(export[[:space:]]+)?'

has_key() {
    grep -Eq "${KEY_RE}$1[[:space:]]*=" "$FILE"
}

# Valor de la ÚLTIMA asignación (la que vale), sin comillas ni espacios.
value_of() {
    grep -E "${KEY_RE}$1[[:space:]]*=" "$FILE" | tail -n 1 | tr -d '\r' \
        | sed -E "s/${KEY_RE}$1[[:space:]]*=[[:space:]]*//; s/[[:space:]]+\$//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
}

new_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 48
    else
        node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("hex"))'
    fi
}

# Deja KEY=VALUE: reemplaza las líneas de KEY (vacías) o la agrega al final.
# Se escribe sobre el MISMO archivo (cat >) para no cambiarle dueño ni modo.
set_key() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp)" || return 1
    if has_key "$key"; then
        awk -v k="$key" -v v="$value" '
            { line = $0; sub(/\r$/, "", line) }
            line ~ "^[[:space:]]*(export[[:space:]]+)?" k "[[:space:]]*=" { print k "=" v; next }
            { print }
        ' "$FILE" > "$tmp" || { rm -f "$tmp"; return 1; }
    else
        cat "$FILE" > "$tmp" || { rm -f "$tmp"; return 1; }
        if [ -s "$tmp" ] && [ -n "$(tail -c 1 "$tmp")" ]; then printf '\n' >> "$tmp"; fi
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
    fi
    cat "$tmp" > "$FILE" || { rm -f "$tmp"; return 1; }
    rm -f "$tmp"
}

if [ ! -w "$FILE" ]; then
    # Sólo avisar si de verdad falta algo (el aviso sin motivo confunde).
    if [ -z "$(value_of SECRETS_KEY)" ] || [ -z "$(value_of FILES_SIGNING_SECRET)" ] || ! has_key NODE_ENV; then
        echo "  (aviso: falta configuración de producción en $FILE y no hay permiso para escribirlo;"
        echo "   ver Plataforma → Diagnóstico → Configuración del servidor)"
    fi
    exit 0
fi

changed=0
secrets_ok=1
for key in SECRETS_KEY FILES_SIGNING_SECRET; do
    if [ -z "$(value_of "$key")" ]; then
        secret="$(new_secret)"
        if [ -n "$secret" ] && set_key "$key" "$secret"; then
            echo "  + ${key} generado"
            changed=1
        else
            echo "  (aviso: no se pudo generar ${key})"
            secrets_ok=0
        fi
        unset secret
    fi
done

if has_key NODE_ENV; then
    current="$(value_of NODE_ENV)"
    if [ "$current" != "production" ]; then
        echo "  (aviso: NODE_ENV=${current} en un servidor instalado; se respeta, pero debería ser production)"
    fi
elif [ "$secrets_ok" = "1" ]; then
    if set_key NODE_ENV production; then
        echo "  + NODE_ENV=production"
        changed=1
    else
        echo "  (aviso: no se pudo agregar NODE_ENV=production)"
    fi
fi

if [ "$changed" = "0" ]; then echo "  ✓ configuración de producción completa"; fi
exit 0
