#!/usr/bin/env bash
#
# Filtro ÚNICO del `.env` que viaja dentro de una copia completa (ADR-S20).
# Lo cargan (con `source`) snapshot-restore.sh, bootstrap-server.sh y
# recover-from-snapshot.sh; viaja en el bundle junto a ellos (deploy/).
#
# Por qué una lista de PERMITIDAS y no de prohibidas (SEC-37, reforzado): el
# `.env` de una copia lo escribe quien armó la copia (otro proveedor, alguien
# con acceso a la carpeta de copias). Todo lo que ese archivo trae termina
# exportado en los scripts de restauración y en el proceso del API. Con una
# lista de prohibidas se colaban MIGRATE_CMD / STOP_CMD / START_CMD (que los
# scripts ejecutan con `eval`), BACKUPS_SCRIPTS_DIR / RECOVERY_SCRIPT (qué
# scripts corre el API), UPDATER_GITHUB_REPO / UPDATER_PUBLIC_KEY (de dónde se
# actualiza y con qué clave se verifica), PG_CONTAINER y las direcciones de
# los proveedores (adónde viajan las credenciales). Aquí sólo pasa lo que es
# CONFIGURACIÓN DE LA APP; lo que decide qué se ejecuta, dónde vive la
# instalación o de dónde se actualiza es siempre de ESTE servidor.
#
# Uso:
#   source snapshot-env-filter.sh
#   filter_snapshot_env <entrada> <salida>   # deja en SNAPSHOT_ENV_DROPPED lo descartado
#   append_local_env <env-local> <salida> [regex-de-claves-a-omitir]
#   is_snapshot_version "0.1.404"            # x.y.z estricto

# Claves que una copia puede traer.
SNAPSHOT_ENV_ALLOW=" \
POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB REDIS_PASSWORD POSTGRES_PORT REDIS_PORT \
NODE_ENV PORT DATABASE_URL REDIS_URL REDIS_COMMAND_TIMEOUT_MS SESSION_TTL_SECONDS COOKIE_SECURE \
APP_BASE_URL PUBLIC_BASE_DOMAIN TRUST_PROXY \
DB_POOL_MAX DB_STATEMENT_TIMEOUT_MS DB_IDLE_IN_TX_TIMEOUT_MS DB_JIT \
BODY_LIMIT_BYTES FILE_IMPORT_BODY_LIMIT_BYTES MAX_UPLOAD_BYTES RATE_LIMIT_MAX RATE_LIMIT_AUTH_MAX \
PUBLIC_DB_CONCURRENCY AUTOMATIONS_CONCURRENCY AUTOMATIONS_MAX_CHAIN_DEPTH HELPDESK_POLL_CONCURRENCY \
TRASH_RETENTION_DAYS SECRETS_KEY FILES_SIGNING_SECRET METRICS_TOKEN PLATFORM_SUPERADMINS WS_ALLOWED_ORIGINS \
MAIL_TRANSPORT MAIL_FROM SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASS \
BILLING_WEBHOOK_SECRET PAYPAL_ENV PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET PAYPAL_WEBHOOK_ID \
MERCADOPAGO_ACCESS_TOKEN MERCADOPAGO_WEBHOOK_SECRET AI_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
STORAGE_DRIVER S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_FORCE_PATH_STYLE \
UPDATER_CHANNEL UPDATER_KEEP_RELEASES UPDATER_MIN_FREE_MB BACKUP_KEEP \
SMTP_ALLOW_PRIVATE_HOSTS SQL_ALLOW_PRIVATE_HOSTS STORAGE_ALLOW_PRIVATE_HOSTS "

# Pasan, pero se avisan: aflojan la protección de las conexiones salientes.
SNAPSHOT_ENV_WARN=" SMTP_ALLOW_PRIVATE_HOSTS SQL_ALLOW_PRIVATE_HOSTS STORAGE_ALLOW_PRIVATE_HOSTS "

# Nombres que NUNCA se toman de un archivo .env al cargarlo en un script de
# operación (ni siquiera del instalado): lo que el script ejecuta con `eval` y
# lo que cambia cómo arranca un proceso. Llegan sólo por el entorno de quien
# llama al script.
# shellcheck disable=SC2034  # lo usa quien carga este archivo
SNAPSHOT_ENV_NEVER_LOAD_RE='^([A-Z_]*_CMD|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_REPL_EXTERNAL_MODULE|LD_[A-Z_]+|DYLD_[A-Z_]+|PATH|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|IFS|GCONV_PATH|PERL5OPT|PERL5LIB|PYTHONPATH|PYTHONSTARTUP|RUBYOPT|npm_config_[A-Za-z_]+|NPM_CONFIG_[A-Z_]+|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|SSL_CERT_FILE|SSL_CERT_DIR|OPENSSL_CONF|SYSTEMD_[A-Z_]+)$'

snapshot_env_key_allowed() {
    [[ "$SNAPSHOT_ENV_ALLOW" == *" $1 "* ]]
}

# Clave de una línea `CLAVE=valor` (o `export CLAVE=valor`); vacío si no lo es.
snapshot_env_key_of() {
    if [[ "${1%$'\r'}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
        printf '%s' "${BASH_REMATCH[2]}"
    fi
}

# filter_snapshot_env <entrada> <salida>
# Copia sólo comentarios, líneas en blanco y `CLAVE=valor` de una clave
# permitida. Cualquier otra línea (clave desconocida, continuación de un valor
# de varias líneas, basura) se descarta. Deja en SNAPSHOT_ENV_DROPPED las
# claves descartadas y en SNAPSHOT_ENV_WARNED las que conviene revisar.
# Entrada y salida pueden ser el mismo archivo.
filter_snapshot_env() {
    local in="$1" out="$2" line clean key tmp
    SNAPSHOT_ENV_DROPPED=""
    SNAPSHOT_ENV_WARNED=""
    tmp="$out.filter.$$"
    : > "$tmp"
    chmod 600 "$tmp"
    while IFS= read -r line || [[ -n "$line" ]]; do
        clean="${line%$'\r'}"
        if [[ "$clean" =~ ^[[:space:]]*$ || "$clean" =~ ^[[:space:]]*# ]]; then
            printf '%s\n' "$line" >> "$tmp"
            continue
        fi
        key="$(snapshot_env_key_of "$line")"
        if [[ -z "$key" ]]; then
            SNAPSHOT_ENV_DROPPED="$SNAPSHOT_ENV_DROPPED (línea-sin-clave)"
        elif snapshot_env_key_allowed "$key"; then
            printf '%s\n' "$line" >> "$tmp"
            if [[ "$SNAPSHOT_ENV_WARN" == *" $key "* ]]; then SNAPSHOT_ENV_WARNED="$SNAPSHOT_ENV_WARNED $key"; fi
        else
            SNAPSHOT_ENV_DROPPED="$SNAPSHOT_ENV_DROPPED $key"
        fi
    done < "$in"
    mv "$tmp" "$out"
}

# append_local_env <env-local> <salida> [regex-de-claves-a-omitir]
# Agrega a <salida> las líneas del env de ESTE servidor cuya clave una copia
# NO puede traer (rutas, contenedor, de dónde se actualiza…): al reemplazar el
# env por el de una copia, lo local se conserva.
append_local_env() {
    local local_env="$1" out="$2" skip_re="${3:-}" line key first=1
    [[ -f "$local_env" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        key="$(snapshot_env_key_of "$line")"
        [[ -n "$key" ]] || continue
        snapshot_env_key_allowed "$key" && continue
        if [[ -n "$skip_re" && "$key" =~ $skip_re ]]; then continue; fi
        if [[ $first -eq 1 ]]; then printf '\n# — de este servidor (no viaja en la copia) —\n' >> "$out"; first=0; fi
        printf '%s\n' "${line%$'\r'}" >> "$out"
    done < "$local_env"
}

# Versión de una copia: x.y.z estricto. Se usa en una URL y en una ruta de
# disco, así que nada de barras, puntos de más ni espacios.
is_snapshot_version() {
    [[ "$1" =~ ^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$ ]]
}
