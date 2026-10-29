<?php
/**
 * Actualizaciones como cualquier plugin, y a prueba de un servidor tomado.
 *
 *  - **De dónde**: el zip que se descarga de la app trae
 *    `includes/update-source.json` con la dirección de ESA app (datos, no
 *    código: en 1.0.0 era un `.php` que se ejecutaba). WordPress le pregunta
 *    ahí si hay una versión nueva (`/api/v1/public/wordpress-plugin/info`) y la
 *    actualización aparece en «Plugins» como la de cualquier plugin. Sólo por
 *    HTTPS (en un sitio de pruebas también `http://`).
 *  - **Firma** (si el operador firma sus versiones): cada versión trae
 *    `manifest.json` (el SHA-256 de cada archivo) y `manifest.sig` (firma
 *    Ed25519 de ese manifiesto, hecha al publicar la versión, FUERA del
 *    servidor). La versión instalada guarda la clave pública
 *    (`includes/release-key.json`) y antes de reemplazarse verifica la nueva:
 *    firma válida, todos los archivos con su huella, ninguno de más. Si algo
 *    no cuadra, WordPress cancela la actualización y el sitio sigue con la
 *    versión que tenía. Así, aunque alguien tomara el servidor de la app, no
 *    podría meterle código a los sitios.
 *  - **Nunca para atrás**: una «actualización» con una versión igual o más
 *    vieja que la instalada se rechaza.
 *
 * Instalado desde otro lado (sin `update-source.json`), no busca actualizaciones.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_Updater {

	const SLUG      = 'imagina-base-connector';
	const TRANSIENT = 'imaginabc_update_info';

	/** @var array|null|false */
	private static $source = false;

	/** @var string|null|false */
	private static $key = false;

	/** `{url, name}` de `update-source.json`, validado. */
	public static function source() {
		if ( false !== self::$source ) {
			return self::$source;
		}
		self::$source = null;
		$file         = IMAGINABC_DIR . 'includes/update-source.json';
		if ( ! is_readable( $file ) ) {
			return null;
		}
		$s = self::parse_source( (string) file_get_contents( $file ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- archivo propio del complemento.
		if ( is_array( $s ) ) {
			self::$source = $s;
		}
		return self::$source;
	}

	/** El contenido de `update-source.json`, o null si no es exactamente lo esperado. */
	public static function parse_source( $json ) {
		$s = json_decode( (string) $json, true );
		if ( ! is_array( $s ) || array_diff( array_keys( $s ), array( 'url', 'name' ) ) || empty( $s['url'] ) || ! is_string( $s['url'] ) ) {
			return null;
		}
		$scheme = ImaginaBC_Util::is_local_env() ? 'https?' : 'https';
		if ( ! preg_match( '#^' . $scheme . '://[a-z0-9.-]+(:\d{1,5})?/?$#i', $s['url'] ) ) {
			return null;
		}
		return array(
			'url'  => untrailingslashit( $s['url'] ),
			'name' => isset( $s['name'] ) && is_string( $s['name'] ) ? sanitize_text_field( substr( $s['name'], 0, 80 ) ) : 'Imagina Base',
		);
	}

	/** `https://app.ejemplo.com` (esquema + host + puerto) de una dirección. */
	private static function origin( $url ) {
		$p = wp_parse_url( (string) $url );
		if ( ! is_array( $p ) || empty( $p['scheme'] ) || empty( $p['host'] ) ) {
			return null;
		}
		return strtolower( $p['scheme'] . '://' . $p['host'] . ( isset( $p['port'] ) ? ':' . $p['port'] : '' ) );
	}

	/** ¿Es la dirección de avisos de la app de la que se descargó el complemento? */
	public static function is_app_hook_url( $url ) {
		$src = self::source();
		if ( ! $src ) {
			return false;
		}
		$p = wp_parse_url( (string) $url );
		return self::origin( $url ) === self::origin( $src['url'] )
			&& isset( $p['path'] ) && 1 === preg_match( '#^/api/v1/public/site-hooks/[A-Za-z0-9_-]{16,64}$#', $p['path'] )
			&& empty( $p['query'] ) && empty( $p['fragment'] );
	}

	/**
	 * `wp_safe_remote_post` (rechaza la red interna) dejando pasar SÓLO el host
	 * de la app de la que se descargó el complemento (puede estar en el mismo
	 * servidor que el sitio).
	 */
	public static function safe_post_to( $url, array $args ) {
		$src   = self::source();
		$host  = $src ? wp_parse_url( $src['url'], PHP_URL_HOST ) : null;
		$allow = function ( $external, $h ) use ( $host ) {
			return ( $host && strtolower( (string) $h ) === strtolower( (string) $host ) ) ? true : $external;
		};
		add_filter( 'http_request_host_is_external', $allow, 10, 2 ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals -- filtro de WordPress.
		try {
			return wp_safe_remote_post( $url, $args );
		} finally {
			remove_filter( 'http_request_host_is_external', $allow, 10 );
		}
	}

	private static function safe_get( $url, array $args ) {
		$src   = self::source();
		$host  = $src ? wp_parse_url( $src['url'], PHP_URL_HOST ) : null;
		$allow = function ( $external, $h ) use ( $host ) {
			return ( $host && strtolower( (string) $h ) === strtolower( (string) $host ) ) ? true : $external;
		};
		add_filter( 'http_request_host_is_external', $allow, 10, 2 ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals -- filtro de WordPress.
		try {
			return ImaginaBC_Util::is_local_env() ? wp_remote_get( $url, $args ) : wp_safe_remote_get( $url, $args );
		} finally {
			remove_filter( 'http_request_host_is_external', $allow, 10 );
		}
	}

	/** La clave pública con la que se firman las versiones (base64 de 32 bytes), si el operador firma. */
	public static function release_key() {
		if ( false !== self::$key ) {
			return self::$key;
		}
		self::$key = null;
		$file      = IMAGINABC_DIR . 'includes/release-key.json';
		if ( is_readable( $file ) ) {
			$k = json_decode( (string) file_get_contents( $file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- archivo propio del complemento.
			if ( is_array( $k ) && isset( $k['ed25519'] ) && is_string( $k['ed25519'] ) ) {
				$raw = base64_decode( $k['ed25519'], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- clave pública, no código.
				if ( false !== $raw && 32 === strlen( $raw ) ) {
					self::$key = $raw;
				}
			}
		}
		return self::$key;
	}

	/** Los ganchos de WordPress (registrarlos no cuesta nada: leen la fuente recién al usarse). */
	public static function boot() {
		add_filter( 'pre_set_site_transient_update_plugins', array( __CLASS__, 'check' ) );
		add_filter( 'plugins_api', array( __CLASS__, 'details' ), 10, 3 );
		add_filter( 'upgrader_source_selection', array( __CLASS__, 'verify_package' ), 10, 4 );
		add_action( 'upgrader_process_complete', array( __CLASS__, 'purge' ), 10, 2 );
	}

	/** Lo que dice la app de la última versión (cacheado 12 horas; un error, 3). */
	public static function info( $force = false ) {
		$src = self::source();
		if ( ! $src ) {
			return null;
		}
		if ( ! $force ) {
			$cached = get_site_transient( self::TRANSIENT );
			if ( is_array( $cached ) ) {
				return empty( $cached ) ? null : $cached;
			}
		}
		$res = self::safe_get( $src['url'] . '/api/v1/public/wordpress-plugin/info', array( 'timeout' => 5 ) );
		if ( is_wp_error( $res ) || 200 !== (int) wp_remote_retrieve_response_code( $res ) ) {
			set_site_transient( self::TRANSIENT, array(), 3 * HOUR_IN_SECONDS );
			return null;
		}
		$json = json_decode( wp_remote_retrieve_body( $res ), true );
		$data = is_array( $json ) && isset( $json['data'] ) && is_array( $json['data'] ) ? $json['data'] : $json;
		if ( ! is_array( $data ) || empty( $data['version'] ) || ! preg_match( '/^\d+\.\d+(\.\d+)?$/', (string) $data['version'] ) ) {
			set_site_transient( self::TRANSIENT, array(), 3 * HOUR_IN_SECONDS );
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
			'id'           => $src['url'],
			'slug'         => self::SLUG,
			'plugin'       => plugin_basename( IMAGINABC_FILE ),
			'new_version'  => $info['version'],
			'url'          => $src['url'],
			'package'      => $info['download_url'],
			'tested'       => isset( $info['tested'] ) ? sanitize_text_field( (string) $info['tested'] ) : '',
			'requires'     => isset( $info['requires'] ) ? sanitize_text_field( (string) $info['requires'] ) : '6.0',
			'requires_php' => isset( $info['requires_php'] ) ? sanitize_text_field( (string) $info['requires_php'] ) : '7.4',
			'icons'        => array(),
			'banners'      => array(),
		);
	}

	public static function check( $transient ) {
		if ( ! is_object( $transient ) || empty( $transient->checked ) || ! self::source() ) {
			return $transient;
		}
		$info = self::info();
		if ( ! $info ) {
			return $transient;
		}
		$basename = plugin_basename( IMAGINABC_FILE );
		$item     = self::item( $info );
		if ( version_compare( $info['version'], IMAGINABC_VERSION, '>' ) ) {
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
			'author'        => esc_html( $src['name'] ),
			'homepage'      => $src['url'],
			'requires'      => isset( $info['requires'] ) ? sanitize_text_field( (string) $info['requires'] ) : '6.0',
			'requires_php'  => isset( $info['requires_php'] ) ? sanitize_text_field( (string) $info['requires_php'] ) : '7.4',
			'tested'        => isset( $info['tested'] ) ? sanitize_text_field( (string) $info['tested'] ) : '',
			'last_updated'  => isset( $info['last_updated'] ) ? sanitize_text_field( (string) $info['last_updated'] ) : '',
			'download_link' => $info['download_url'],
			'sections'      => array(
				'description' => isset( $info['sections']['description'] ) ? wp_kses_post( $info['sections']['description'] ) : '',
				'changelog'   => isset( $info['sections']['changelog'] ) ? wp_kses_post( $info['sections']['changelog'] ) : '',
			),
		);
	}

	/**
	 * Antes de reemplazar el complemento por una versión nueva (ya descomprimida
	 * en `$source`): nunca para atrás y, si esta versión tiene la clave del
	 * operador, la nueva tiene que venir firmada con ella.
	 */
	public static function verify_package( $source, $remote_source = null, $upgrader = null, $hook_extra = array() ) {
		if ( is_wp_error( $source ) || ! is_array( $hook_extra ) || ! isset( $hook_extra['plugin'] ) || plugin_basename( IMAGINABC_FILE ) !== $hook_extra['plugin'] ) {
			return $source;
		}
		$check = self::check_package_dir( $source, IMAGINABC_VERSION, self::release_key() );
		return is_wp_error( $check ) ? $check : $source;
	}

	/**
	 * Revisa una carpeta del complemento descomprimida. PURO respecto de
	 * WordPress (sólo archivos), así se prueba aparte. `$key` = clave pública
	 * cruda de 32 bytes, o null si las versiones no se firman.
	 */
	public static function check_package_dir( $dir, $current_version, $key ) {
		$dir  = untrailingslashit( (string) $dir );
		$main = $dir . '/imagina-base-connector.php';
		if ( ! is_file( $main ) ) {
			return new WP_Error( 'imaginabc_bad_package', __( 'El paquete no es el complemento de Imagina Base.', 'imagina-base-connector' ) );
		}
		$head    = (string) file_get_contents( $main, false, null, 0, 4096 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- se lee la cabecera del archivo descomprimido.
		$version = preg_match( '/^\s*\*?\s*Version:\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s*$/im', $head, $m ) ? $m[1] : null;
		if ( ! $version || ! version_compare( $version, (string) $current_version, '>' ) ) {
			return new WP_Error( 'imaginabc_downgrade', __( 'La actualización no es más nueva que la versión instalada: no se instala.', 'imagina-base-connector' ) );
		}
		if ( ! $key ) {
			return true;
		}
		$manifest_raw = is_file( $dir . '/manifest.json' ) ? (string) file_get_contents( $dir . '/manifest.json' ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$sig_b64      = is_file( $dir . '/manifest.sig' ) ? trim( (string) file_get_contents( $dir . '/manifest.sig' ) ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$sig          = base64_decode( $sig_b64, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- firma, no código.
		if ( '' === $manifest_raw || false === $sig || 64 !== strlen( $sig ) ) {
			return new WP_Error( 'imaginabc_unsigned', __( 'La actualización no viene firmada: no se instala (el sitio sigue con la versión que tenía).', 'imagina-base-connector' ) );
		}
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) && is_readable( ABSPATH . WPINC . '/sodium_compat/autoload.php' ) ) {
			require_once ABSPATH . WPINC . '/sodium_compat/autoload.php';
		}
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
			return new WP_Error( 'imaginabc_no_sodium', __( 'Este servidor no puede verificar la firma de la actualización: no se instala.', 'imagina-base-connector' ) );
		}
		try {
			$ok = sodium_crypto_sign_verify_detached( $sig, $manifest_raw, $key );
		} catch ( \Throwable $e ) {
			$ok = false;
		}
		if ( ! $ok ) {
			return new WP_Error( 'imaginabc_bad_signature', __( 'La firma de la actualización no es válida: no se instala (el sitio sigue con la versión que tenía).', 'imagina-base-connector' ) );
		}
		$manifest = json_decode( $manifest_raw, true );
		if ( ! is_array( $manifest ) || ! isset( $manifest['files'] ) || ! is_array( $manifest['files'] ) || ( isset( $manifest['version'] ) && $manifest['version'] !== $version ) ) {
			return new WP_Error( 'imaginabc_bad_manifest', __( 'La lista de archivos de la actualización no coincide con su versión: no se instala.', 'imagina-base-connector' ) );
		}
		$seen = array();
		$it   = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ), RecursiveIteratorIterator::SELF_FIRST );
		foreach ( $it as $file ) {
			$rel = str_replace( '\\', '/', substr( $file->getPathname(), strlen( $dir ) + 1 ) );
			if ( $file->isLink() ) {
				return new WP_Error( 'imaginabc_bad_package', __( 'La actualización trae accesos directos a otros archivos: no se instala.', 'imagina-base-connector' ) );
			}
			if ( $file->isDir() ) {
				continue;
			}
			if ( in_array( $rel, array( 'manifest.json', 'manifest.sig' ), true ) ) {
				continue;
			}
			if ( 'includes/update-source.json' === $rel ) {
				// Lo agrega la app al repartir el zip: sólo datos con la forma exacta.
				if ( null === self::parse_source( (string) file_get_contents( $file->getPathname() ) ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
					return new WP_Error( 'imaginabc_bad_package', __( 'La actualización trae un origen de actualizaciones inválido: no se instala.', 'imagina-base-connector' ) );
				}
				continue;
			}
			if ( ! isset( $manifest['files'][ $rel ] ) || ! hash_equals( (string) $manifest['files'][ $rel ], hash_file( 'sha256', $file->getPathname() ) ) ) {
				return new WP_Error(
					'imaginabc_tampered',
					sprintf(
						/* translators: %s: archivo del complemento que no coincide con la firma */
						__( 'Un archivo de la actualización no coincide con la versión firmada (%s): no se instala.', 'imagina-base-connector' ),
						$rel
					)
				);
			}
			$seen[ $rel ] = true;
		}
		foreach ( array_keys( $manifest['files'] ) as $rel ) {
			if ( ! isset( $seen[ $rel ] ) ) {
				return new WP_Error( 'imaginabc_incomplete', __( 'A la actualización le falta un archivo de la versión firmada: no se instala.', 'imagina-base-connector' ) );
			}
		}
		return true;
	}

	public static function purge( $upgrader, $options ) {
		if ( is_array( $options ) && isset( $options['type'] ) && 'plugin' === $options['type'] ) {
			delete_site_transient( self::TRANSIENT );
		}
	}
}
