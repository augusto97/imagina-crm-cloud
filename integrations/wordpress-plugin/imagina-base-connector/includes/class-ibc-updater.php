<?php
/**
 * Actualizaciones como cualquier plugin: el zip que se descarga de la app trae
 * `includes/update-source.php` con la dirección de ESA app, y WordPress le
 * pregunta ahí si hay una versión nueva (`/api/v1/public/wordpress-plugin/info`).
 * La actualización aparece en «Plugins» y se instala con un clic (o sola, si
 * se activaron las actualizaciones automáticas).
 *
 * Instalado desde otro lado (sin ese archivo), no busca actualizaciones.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class IBC_Updater {

	const SLUG      = 'imagina-base-connector';
	const TRANSIENT = 'ibc_update_info';

	public static function source() {
		$file = IBC_DIR . 'includes/update-source.php';
		if ( ! is_readable( $file ) ) {
			return null;
		}
		$s = include $file;
		if ( ! is_array( $s ) || empty( $s['url'] ) || ! preg_match( '#^https?://#', $s['url'] ) ) {
			return null;
		}
		$s['url'] = untrailingslashit( $s['url'] );
		return $s;
	}

	public static function boot() {
		if ( ! self::source() ) {
			return;
		}
		add_filter( 'pre_set_site_transient_update_plugins', array( __CLASS__, 'check' ) );
		add_filter( 'plugins_api', array( __CLASS__, 'details' ), 10, 3 );
		add_action( 'upgrader_process_complete', array( __CLASS__, 'purge' ), 10, 2 );
	}

	/** Lo que dice la app de la última versión (cacheado 12 horas). */
	public static function info( $force = false ) {
		$src = self::source();
		if ( ! $src ) {
			return null;
		}
		if ( ! $force ) {
			$cached = get_site_transient( self::TRANSIENT );
			if ( is_array( $cached ) ) {
				return $cached;
			}
		}
		$res = wp_remote_get( $src['url'] . '/api/v1/public/wordpress-plugin/info', array( 'timeout' => 10 ) );
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			// Un error no se recuerda 12 horas: se vuelve a probar en una hora.
			set_site_transient( self::TRANSIENT, array(), HOUR_IN_SECONDS );
			return null;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		$data = is_array( $json ) && isset( $json['data'] ) && is_array( $json['data'] ) ? $json['data'] : $json;
		if ( ! is_array( $data ) || empty( $data['version'] ) || ! preg_match( '/^\d+\.\d+(\.\d+)?$/', (string) $data['version'] ) ) {
			set_site_transient( self::TRANSIENT, array(), HOUR_IN_SECONDS );
			return null;
		}
		// El zip sale SIEMPRE de la misma app (nunca de una dirección que diga la respuesta).
		$data['download_url'] = $src['url'] . '/api/v1/public/wordpress-plugin/download';
		set_site_transient( self::TRANSIENT, $data, 12 * HOUR_IN_SECONDS );
		return $data;
	}

	private static function item( array $info ) {
		$src = self::source();
		return (object) array(
			'id'            => $src['url'],
			'slug'          => self::SLUG,
			'plugin'        => plugin_basename( IBC_FILE ),
			'new_version'   => $info['version'],
			'url'           => $src['url'],
			'package'       => $info['download_url'],
			'tested'        => isset( $info['tested'] ) ? $info['tested'] : '',
			'requires'      => isset( $info['requires'] ) ? $info['requires'] : '6.0',
			'requires_php'  => isset( $info['requires_php'] ) ? $info['requires_php'] : '7.4',
			'icons'         => array(),
			'banners'       => array(),
		);
	}

	public static function check( $transient ) {
		if ( ! is_object( $transient ) || empty( $transient->checked ) ) {
			return $transient;
		}
		$info = self::info();
		if ( ! $info ) {
			return $transient;
		}
		$basename = plugin_basename( IBC_FILE );
		$item     = self::item( $info );
		if ( version_compare( $info['version'], IBC_VERSION, '>' ) ) {
			$transient->response[ $basename ] = $item;
		} else {
			// Necesario para que aparezca el interruptor de actualizaciones automáticas.
			$transient->no_update[ $basename ] = $item;
		}
		return $transient;
	}

	public static function details( $res, $action, $args ) {
		if ( 'plugin_information' !== $action || ! is_object( $args ) || ! isset( $args->slug ) || self::SLUG !== $args->slug ) {
			return $res;
		}
		$info = self::info();
		if ( ! $info ) {
			return $res;
		}
		$src = self::source();
		return (object) array(
			'name'          => 'Imagina Base Connector',
			'slug'          => self::SLUG,
			'version'       => $info['version'],
			'author'        => isset( $src['name'] ) ? esc_html( $src['name'] ) : 'Imagina',
			'homepage'      => $src['url'],
			'requires'      => isset( $info['requires'] ) ? $info['requires'] : '6.0',
			'requires_php'  => isset( $info['requires_php'] ) ? $info['requires_php'] : '7.4',
			'tested'        => isset( $info['tested'] ) ? $info['tested'] : '',
			'last_updated'  => isset( $info['last_updated'] ) ? $info['last_updated'] : '',
			'download_link' => $info['download_url'],
			'sections'      => array(
				'description' => isset( $info['sections']['description'] ) ? wp_kses_post( $info['sections']['description'] ) : '',
				'changelog'   => isset( $info['sections']['changelog'] ) ? wp_kses_post( $info['sections']['changelog'] ) : '',
			),
		);
	}

	public static function purge( $upgrader, $options ) {
		if ( is_array( $options ) && isset( $options['type'] ) && 'plugin' === $options['type'] ) {
			delete_site_transient( self::TRANSIENT );
		}
	}
}
