<?php
/**
 * Rutas propias de la API REST (`/wp-json/imagina-base/v1/…`). Se usan con la
 * MISMA contraseña de aplicación con la que la app ya está conectada, y cada
 * una exige los permisos de WordPress del usuario conectado:
 *
 *  - `GET  info`        — versión, plugin de SEO, campos y avisos (edit_posts)
 *  - `GET  schema`      — columnas extra por tipo de objeto (edit_posts)
 *  - `POST items/read`  — leer en lote SÓLO las columnas pedidas (edit_posts + cada objeto)
 *  - `POST items/write` — escribir en lote, saneado por tipo (edit_posts + cada objeto)
 *  - `GET|POST|DELETE hooks` — avisos en tiempo real (manage_options, o
 *    edit_posts si los avisos van a la app de la que se descargó el complemento)
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_Rest {

	public static function register_routes() {
		$ns = IMAGINABC_REST_NAMESPACE;
		register_rest_route(
			$ns,
			'/info',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'info' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
			)
		);
		register_rest_route(
			$ns,
			'/schema',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'schema' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
			)
		);
		register_rest_route(
			$ns,
			'/items/read',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'read' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
			)
		);
		register_rest_route(
			$ns,
			'/items/write',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'write' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
			)
		);
		register_rest_route(
			$ns,
			'/hooks',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'hooks_status' ),
					'permission_callback' => array( __CLASS__, 'can_manage_hooks' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'hooks_register' ),
					// El destino se revisa al registrar (un Editor sólo puede apuntar a la app).
					'permission_callback' => array( __CLASS__, 'can_read' ),
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => array( __CLASS__, 'hooks_unregister' ),
					'permission_callback' => array( __CLASS__, 'can_manage_hooks' ),
				),
			)
		);
	}

	public static function can_read() {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'rest_not_logged_in', __( 'Hace falta la contraseña de aplicación del sitio.', 'imagina-base-connector' ), array( 'status' => 401 ) );
		}
		return current_user_can( 'edit_posts' ) ? true : new WP_Error( 'rest_forbidden', __( 'El usuario conectado no puede editar contenido en WordPress.', 'imagina-base-connector' ), array( 'status' => 403 ) );
	}

	public static function can_manage_hooks() {
		$read = self::can_read();
		if ( true !== $read ) {
			return $read;
		}
		return ImaginaBC_Hooks::can_manage_current() ? true : new WP_Error( 'ibc_needs_admin', __( 'Estos avisos los registró un Administrador del sitio: sólo un Administrador puede cambiarlos.', 'imagina-base-connector' ), array( 'status' => 403 ) );
	}

	/** ¿Puede este usuario tener avisos en tiempo real? (lo que la app necesita saber de antemano). */
	private static function can_hooks() {
		return current_user_can( 'manage_options' ) || ( current_user_can( 'edit_posts' ) && null !== ImaginaBC_Updater::source() );
	}

	public static function info() {
		global $wp_version;
		return rest_ensure_response(
			array(
				'plugin'       => 'imagina-base-connector',
				'version'      => IMAGINABC_VERSION,
				'wp_version'   => $wp_version,
				'php_version'  => PHP_VERSION,
				'seo'          => ImaginaBC_SEO::info(),
				'providers'    => ImaginaBC_Fields::providers(),
				'can_manage'   => current_user_can( 'manage_options' ),
				'can_hooks'    => self::can_hooks(),
				'hooks'        => ImaginaBC_Hooks::can_manage_current() ? ImaginaBC_Hooks::public_status() : null,
				'updates'      => null !== ImaginaBC_Updater::source(),
				'signed'       => null !== ImaginaBC_Updater::release_key(),
				'media_index'  => ImaginaBC_Media_Index::public_state(),
			)
		);
	}

	public static function schema( WP_REST_Request $req ) {
		return rest_ensure_response(
			array(
				'version' => IMAGINABC_VERSION,
				'seo'     => ImaginaBC_SEO::info(),
				'objects' => ImaginaBC_Items::schema( (bool) $req->get_param( 'fresh' ) ),
			)
		);
	}

	private static function parse_target( WP_REST_Request $req ) {
		$body   = $req->get_json_params();
		$body   = is_array( $body ) ? $body : array();
		$kind   = isset( $body['kind'] ) ? (string) $body['kind'] : '';
		$object = isset( $body['object'] ) ? sanitize_key( (string) $body['object'] ) : '';
		if ( ! in_array( $kind, ImaginaBC_Items::KINDS, true ) ) {
			return new WP_Error( 'ibc_bad_kind', __( 'Tipo de objeto inválido.', 'imagina-base-connector' ), array( 'status' => 400 ) );
		}
		// Sólo lo que la app ofrece (lo que está en la API REST, sin lo interno de WordPress ni de otros plugins).
		if ( 'media' === $kind ) {
			$object = 'attachment';
		} elseif ( ! in_array( $object, 'taxonomy' === $kind ? ImaginaBC_Items::taxonomy_names() : ImaginaBC_Items::post_type_names(), true ) ) {
			return new WP_Error(
				'ibc_unknown_object',
				sprintf(
					/* translators: %s: tipo de contenido o taxonomía pedido */
					__( 'El sitio no tiene «%s».', 'imagina-base-connector' ),
					$object
				),
				array( 'status' => 404 )
			);
		}
		return array( $kind, $object, $body );
	}

	public static function read( WP_REST_Request $req ) {
		$t = self::parse_target( $req );
		if ( is_wp_error( $t ) ) {
			return $t;
		}
		list( $kind, $object, $body ) = $t;
		$ids  = ImaginaBC_Util::ids( isset( $body['ids'] ) ? $body['ids'] : array(), 100 );
		$keys = ImaginaBC_Util::keys( isset( $body['fields'] ) ? $body['fields'] : array(), 150 );
		return rest_ensure_response( ImaginaBC_Items::read( $kind, $object, $ids, $keys ) );
	}

	public static function write( WP_REST_Request $req ) {
		$t = self::parse_target( $req );
		if ( is_wp_error( $t ) ) {
			return $t;
		}
		list( $kind, $object, $body ) = $t;
		$rows = isset( $body['items'] ) && is_array( $body['items'] ) ? array_slice( $body['items'], 0, 50 ) : array();
		return rest_ensure_response( ImaginaBC_Items::write( $kind, $object, $rows ) );
	}

	public static function hooks_status() {
		return rest_ensure_response( ImaginaBC_Hooks::public_status() );
	}

	public static function hooks_register( WP_REST_Request $req ) {
		$body = $req->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$res  = ImaginaBC_Hooks::register(
			isset( $body['url'] ) ? $body['url'] : '',
			isset( $body['secret'] ) ? $body['secret'] : '',
			isset( $body['objects'] ) && is_array( $body['objects'] ) ? $body['objects'] : array()
		);
		return is_wp_error( $res ) ? $res : rest_ensure_response( $res );
	}

	public static function hooks_unregister() {
		ImaginaBC_Hooks::unregister();
		return rest_ensure_response( array( 'registered' => false ) );
	}
}
