<?php
/**
 * Al BORRAR el complemento (no al desactivarlo) se van sus opciones, sus
 * tareas programadas y su tabla de «Dónde se usa». No toca nada del contenido
 * del sitio: el SEO, los campos y los medios son del sitio y de sus plugins,
 * no de este complemento. En una red (multisitio), en todos los sitios.
 *
 * @package ImaginaBaseConnector
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/** Limpia el sitio actual. */
function imaginabc_uninstall_site() {
	global $wpdb;
	$options = array(
		'imaginabc_hook',
		'imaginabc_queue',
		'imaginabc_hook_state',
		'imaginabc_async_key',
		'imaginabc_delivering',
		'imaginabc_kick',
		'imaginabc_db_version',
		'imaginabc_media_index',
		'imaginabc_media_index_progress',
		'imaginabc_media_index_lock',
		// Los nombres de 1.0.0.
		'ibc_hook',
		'ibc_queue',
		'ibc_hook_state',
		'ibc_async_key',
		'ibc_delivering',
	);
	foreach ( $options as $option ) {
		delete_option( $option );
	}
	// El descubrimiento de campos guardado (transitorios `imaginabc_meta_*`).
	$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_imaginabc\\_meta\\_%' OR option_name LIKE '\\_transient\\_timeout\\_imaginabc\\_meta\\_%'" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}imaginabc_media_usage" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- tabla propia.
	foreach ( array( 'imaginabc_deliver_cron', 'imaginabc_deliver_event', 'imaginabc_index_media', 'ibc_deliver_cron', 'ibc_deliver_event' ) as $hook ) {
		wp_clear_scheduled_hook( $hook );
	}
}

if ( is_multisite() ) {
	foreach ( get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	) as $imaginabc_site_id ) {
		switch_to_blog( $imaginabc_site_id );
		imaginabc_uninstall_site();
		restore_current_blog();
	}
} else {
	imaginabc_uninstall_site();
}
delete_site_transient( 'imaginabc_update_info' );
delete_site_transient( 'ibc_update_info' );
