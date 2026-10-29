<?php
/**
 * Al BORRAR el complemento (no al desactivarlo) se van sus opciones y sus
 * tareas programadas. No toca nada del contenido del sitio: el SEO, los campos
 * y los medios son del sitio y de sus plugins, no de este complemento.
 *
 * @package ImaginaBaseConnector
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

foreach ( array( 'ibc_hook', 'ibc_queue', 'ibc_hook_state', 'ibc_async_key', 'ibc_delivering' ) as $option ) {
	delete_option( $option );
}
delete_site_transient( 'ibc_update_info' );
wp_clear_scheduled_hook( 'ibc_deliver_cron' );
wp_clear_scheduled_hook( 'ibc_deliver_event' );
