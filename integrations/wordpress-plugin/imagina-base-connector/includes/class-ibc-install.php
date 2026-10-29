<?php
/**
 * Instalación y actualización del complemento.
 *
 *  - **Opciones que se leen en cada pedido** (`imaginabc_hook`,
 *    `imaginabc_db_version`, `imaginabc_media_index`) son chicas y van con
 *    autocarga: WordPress ya las trae en su consulta de siempre, así el
 *    complemento no suma ninguna consulta a las páginas del sitio. Existen
 *    SIEMPRE (vacías si no hay nada): una opción que no existe también cuesta
 *    una consulta por pedido.
 *  - **Desde 1.0.0**: las opciones se llamaban `ibc_*`. Se pasan a los
 *    nombres nuevos (con el prefijo del complemento, para no chocar con otros
 *    plugins) y se borran las viejas, junto con sus tareas programadas.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_Install {

	const DB_VERSION = '1.1.0';
	const OPT_DB     = 'imaginabc_db_version';

	/** Opciones de 1.0.0 → nombre nuevo (las que se conservan). */
	const LEGACY = array(
		'ibc_hook'       => 'imaginabc_hook',
		'ibc_hook_state' => 'imaginabc_hook_state',
		'ibc_async_key'  => 'imaginabc_async_key',
		'ibc_queue'      => 'imaginabc_queue',
	);

	public static function activate() {
		self::install();
	}

	/** Al desactivar: se apagan las tareas; el índice de medios deja de estar al día. */
	public static function deactivate() {
		ImaginaBC_Hooks::unschedule();
		ImaginaBC_Media_Index::reset();
	}

	/** En cada pedido: una comparación contra una opción autocargada (sin consultas). */
	public static function maybe_upgrade() {
		if ( self::DB_VERSION !== get_option( self::OPT_DB ) ) {
			self::install();
		}
	}

	public static function install() {
		ImaginaBC_Media_Index::create_table();

		foreach ( self::LEGACY as $old => $new ) {
			$value = get_option( $old, null );
			if ( null !== $value && false === get_option( $new, false ) ) {
				// La configuración del aviso se lee en cada pedido: autocarga. El resto, no.
				add_option( $new, $value, '', ImaginaBC_Hooks::OPT_HOOK === $new );
			}
			delete_option( $old );
		}
		delete_option( 'ibc_delivering' );
		delete_site_transient( 'ibc_update_info' );
		wp_clear_scheduled_hook( 'ibc_deliver_cron' );
		wp_clear_scheduled_hook( 'ibc_deliver_event' );

		// Lo que se lee en cada pedido existe siempre y con autocarga.
		if ( false === get_option( ImaginaBC_Hooks::OPT_HOOK, false ) ) {
			add_option( ImaginaBC_Hooks::OPT_HOOK, array(), '', true );
		} else {
			self::ensure_autoload( ImaginaBC_Hooks::OPT_HOOK );
		}
		if ( false === get_option( ImaginaBC_Media_Index::OPT, false ) ) {
			add_option( ImaginaBC_Media_Index::OPT, array(), '', true );
		}
		update_option( self::OPT_DB, self::DB_VERSION, true );
	}

	/** Una opción que ya existía sin autocarga pasa a tenerla. */
	private static function ensure_autoload( $name ) {
		$value = get_option( $name );
		delete_option( $name );
		add_option( $name, $value, '', true );
	}
}
