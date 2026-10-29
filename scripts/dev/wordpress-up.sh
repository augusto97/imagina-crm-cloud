#!/bin/sh
# WordPress REAL para probar el conector de WordPress (v0.1.333) — no un doble.
#
#   sh scripts/dev/wordpress-up.sh [puerto=8090] up       # MariaDB + WordPress + ACF + datos de prueba
#   sh scripts/dev/wordpress-up.sh [puerto] stop          # apaga el servidor PHP (la base queda)
#   sh scripts/dev/wordpress-up.sh [puerto] reset         # borra el sitio y su base y lo arma de nuevo
#   sh scripts/dev/wordpress-up.sh [puerto] status
#   sh scripts/dev/wordpress-up.sh [puerto] wp <args…>    # wp-cli contra ese sitio
#
# Qué deja armado (lo que usa el E2E del conector):
#  - WordPress en http://localhost:<puerto> con WP_ENVIRONMENT_TYPE=local (así
#    las contraseñas de aplicación funcionan sin HTTPS y la pantalla
#    «Autorizar aplicación» acepta un success_url http://).
#  - Usuarios: admin / admin-pass-1 (administrador) y lector / lector-pass-1
#    (suscriptor: sin permiso de editar, para el diagnóstico).
#  - Enlaces permanentes /%postname%/ (y el respaldo ?rest_route=/ igual anda).
#  - ACF (Advanced Custom Fields, de wordpress.org) con un grupo de campos
#    «Datos de la propiedad» (precio, ciudad, habitaciones, destacada) con
#    «Mostrar en la API REST», un tipo de contenido «Propiedades»
#    (rest_base propiedades) con la taxonomía «Zonas», y un meta registrado
#    (referencia_interna) en la API.
#  - Datos: 3 páginas (una hija), 5 entradas con categorías y etiquetas,
#    6 propiedades con sus campos ACF y su zona.
#
# Requiere Docker (MariaDB en el contenedor imagina-dev-wp-db, puerto 33306)
# y PHP ≥ 8.1 con mysqli. Logs en /tmp/imagina-dev-wp/<puerto>/server.log.
set -e
PORT=${1:-8090}
CMD=${2:-up}
[ "$#" -ge 2 ] && shift 2 || shift $#
ROOT=/tmp/imagina-dev-wp
SITE=$ROOT/$PORT
CACHE=$ROOT/cache
DB_CONTAINER=imagina-dev-wp-db
DB_PORT=33306
DB_NAME=wp_$PORT
DB_IMAGE=${WP_DB_IMAGE:-mirror.gcr.io/library/mariadb:11}
WPCLI=$CACHE/wp-cli.phar
URL=http://localhost:$PORT
mkdir -p "$CACHE"

wp() {
    php -d memory_limit=512M "$WPCLI" --path="$SITE/www" --allow-root "$@"
}

db_up() {
    if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
        if docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
            docker start "$DB_CONTAINER" >/dev/null
        else
            docker run -d --name "$DB_CONTAINER" -e MARIADB_ROOT_PASSWORD=wp -p "$DB_PORT:3306" "$DB_IMAGE" >/dev/null
        fi
    fi
    for i in $(seq 1 90); do
        # Por TCP y con la contraseña: durante el primer arranque MariaDB levanta
        # un servidor temporal que contesta el ping pero todavía sin la clave.
        docker exec "$DB_CONTAINER" mariadb -h127.0.0.1 -uroot -pwp -e 'select 1' >/dev/null 2>&1 && return 0
        sleep 1
    done
    echo "MariaDB no arrancó" >&2
    exit 1
}

server_stop() {
    if [ -f "$SITE/server.pid" ]; then
        kill "$(cat "$SITE/server.pid")" 2>/dev/null || true
        rm -f "$SITE/server.pid"
    fi
}

server_start() {
    server_stop
    # Varios procesos: la pantalla de autorizar y el API pueden pedir a la vez.
    (cd "$SITE/www" && PHP_CLI_SERVER_WORKERS=4 setsid nohup php -S "127.0.0.1:$PORT" "$SITE/router.php" >"$SITE/server.log" 2>&1 &
        echo $! >"$SITE/server.pid")
    for i in $(seq 1 30); do
        curl -s -o /dev/null "$URL/wp-json/" && return 0
        sleep 1
    done
    echo "El servidor de WordPress no respondió (ver $SITE/server.log)" >&2
    exit 1
}

install_site() {
    [ -f "$WPCLI" ] || curl -fsSL -o "$WPCLI" https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
    mkdir -p "$SITE/www"
    docker exec "$DB_CONTAINER" mariadb -h127.0.0.1 -uroot -pwp -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    [ -f "$SITE/www/wp-load.php" ] || wp core download
    mkdir -p "$SITE/www/wp-content/plugins" "$SITE/www/wp-content/themes" "$SITE/www/wp-content/mu-plugins"
    if [ ! -f "$SITE/www/wp-config.php" ]; then
        wp config create --dbname="$DB_NAME" --dbuser=root --dbpass=wp --dbhost="127.0.0.1:$DB_PORT" --skip-check --extra-php <<'PHP'
define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'WP_DEBUG_DISPLAY', false );
define( 'AUTOMATIC_UPDATER_DISABLED', true );
define( 'DISABLE_WP_CRON', true );
PHP
    fi
    # Router del servidor PHP: sirve archivos reales y manda el resto a WordPress
    # (así andan los enlaces permanentes /wp-json/…).
    cat >"$SITE/router.php" <<'PHP'
<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = $_SERVER['DOCUMENT_ROOT'] . $path;
if ($path !== '/' && is_file($file)) return false;
if (is_dir($file) && is_file(rtrim($file, '/') . '/index.php')) {
    $_SERVER['SCRIPT_NAME'] = rtrim($path, '/') . '/index.php';
    require rtrim($file, '/') . '/index.php';
    return true;
}
$_SERVER['SCRIPT_NAME'] = '/index.php';
require $_SERVER['DOCUMENT_ROOT'] . '/index.php';
PHP
    cp "$(dirname "$0")/wordpress-dev-plugin.php" "$SITE/www/wp-content/mu-plugins/imagina-dev.php"
    if ! wp core is-installed 2>/dev/null; then
        wp core install --url="$URL" --title="Sitio de prueba" --admin_user=admin --admin_password=admin-pass-1 \
            --admin_email=admin@wp.test --skip-email
        wp language core install es_ES --activate >/dev/null 2>&1 || true
        wp rewrite structure '/%postname%/' --hard
        wp plugin install advanced-custom-fields --activate
        wp user create lector lector@wp.test --role=subscriber --user_pass=lector-pass-1
        wp eval-file "$(dirname "$0")/wordpress-seed.php"
    fi
}

case "$CMD" in
    up)
        db_up
        install_site
        server_start
        echo "WordPress listo: $URL (admin / admin-pass-1) · logs $SITE/server.log"
        ;;
    stop)
        server_stop
        echo "Servidor de WordPress $PORT apagado"
        ;;
    reset)
        server_stop
        db_up
        docker exec "$DB_CONTAINER" mariadb -h127.0.0.1 -uroot -pwp -e "DROP DATABASE IF EXISTS \`$DB_NAME\`"
        rm -rf "$SITE"
        install_site
        server_start
        echo "WordPress rearmado: $URL"
        ;;
    status)
        printf 'WordPress %s · %s · base %s\n' "$URL" "$(curl -s -o /dev/null -w '%{http_code}' "$URL/wp-json/" 2>/dev/null || true)" "$DB_NAME"
        ;;
    wp)
        wp "$@"
        ;;
    *)
        echo "uso: sh scripts/dev/wordpress-up.sh [puerto] up|stop|reset|status|wp …" >&2
        exit 2
        ;;
esac
