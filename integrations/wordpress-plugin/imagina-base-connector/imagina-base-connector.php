<?php
/**
 * Plugin Name:       Imagina Base Connector
 * Description:       Conecta este sitio con tu cuenta de Imagina Base: SEO de tus entradas y términos, campos personalizados con su tipo, la biblioteca de medios y avisos en tiempo real de lo que cambia.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Imagina
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       imagina-base-connector
 *
 * Este complemento NO trae ni cambia el contenido de las entradas: sólo lo que
 * la app sincroniza (SEO, campos, medios) y sólo para el usuario conectado,
 * con sus propios permisos de WordPress. No habla con nadie más que con la app
 * a la que se conectó.
 */

defined( 'ABSPATH' ) || exit;

define( 'IBC_VERSION', '1.0.0' );
define( 'IBC_FILE', __FILE__ );
define( 'IBC_DIR', plugin_dir_path( __FILE__ ) );
define( 'IBC_REST_NAMESPACE', 'imagina-base/v1' );

require_once IBC_DIR . 'includes/class-ibc-util.php';
require_once IBC_DIR . 'includes/seo/class-ibc-seo-adapter.php';
require_once IBC_DIR . 'includes/seo/class-ibc-seo-rankmath.php';
require_once IBC_DIR . 'includes/seo/class-ibc-seo-yoast.php';
require_once IBC_DIR . 'includes/seo/class-ibc-seo-seopress.php';
require_once IBC_DIR . 'includes/seo/class-ibc-seo-aioseo.php';
require_once IBC_DIR . 'includes/class-ibc-seo.php';
require_once IBC_DIR . 'includes/class-ibc-fields.php';
require_once IBC_DIR . 'includes/class-ibc-items.php';
require_once IBC_DIR . 'includes/class-ibc-hooks.php';
require_once IBC_DIR . 'includes/class-ibc-updater.php';
require_once IBC_DIR . 'includes/class-ibc-rest.php';

add_action( 'rest_api_init', array( 'IBC_Rest', 'register_routes' ) );
add_action( 'init', array( 'IBC_Hooks', 'boot' ), 20 );
add_action( 'init', array( 'IBC_Updater', 'boot' ) );

register_deactivation_hook( __FILE__, array( 'IBC_Hooks', 'unschedule' ) );

/**
 * Enlace «Ajustes» en la lista de plugins: lleva a la pantalla de estado
 * (dónde está conectado y si los avisos en tiempo real están llegando).
 */
add_filter(
	'plugin_action_links_' . plugin_basename( __FILE__ ),
	function ( $links ) {
		$url = admin_url( 'tools.php?page=imagina-base-connector' );
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Estado', 'imagina-base-connector' ) . '</a>' );
		return $links;
	}
);

add_action(
	'admin_menu',
	function () {
		add_management_page(
			'Imagina Base Connector',
			'Imagina Base',
			'manage_options',
			'imagina-base-connector',
			array( 'IBC_Hooks', 'render_status_page' )
		);
	}
);
