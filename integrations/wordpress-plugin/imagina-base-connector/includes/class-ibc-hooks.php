<?php
/**
 * Avisos en tiempo real a la app: cuando alguien guarda, manda a la papelera o
 * borra una entrada, un término o un medio que la app sincroniza, se anota en
 * una COLA y se manda firmado (HMAC-SHA256) a la dirección que registró la app.
 *
 *  - **No frena el guardado**: el aviso no se manda en el mismo pedido de la
 *    persona. Al terminar el pedido se dispara un pedido aparte al propio sitio
 *    (sin esperar la respuesta, y a lo sumo uno cada 15 segundos) que vacía la
 *    cola; si el hosting no lo permite, WP-Cron la vacía al minuto, y cada 5
 *    minutos se reintenta lo pendiente.
 *  - **Sólo lo que la app sincroniza** (1.1.0): un metadato que cambia avisa
 *    SÓLO si es de una columna que la app trae (SEO, un campo de ACF…). Un
 *    contador de visitas, el CSS que regenera un constructor de páginas o el
 *    stock que baja con una venta no generan avisos ni pedidos (en 1.0.0 cada
 *    visita a una entrada con un contador de visitas disparaba un aviso).
 *  - **Reintentos con espera creciente** (1, 2, 5, 10, 30 y 60 minutos). Lo que
 *    lleva más de 48 horas sin poder salir se descarta: la app igual revisa el
 *    sitio entero cada hora (red de seguridad), así que nada se pierde.
 *  - **Sólo el id** viaja en el aviso (nunca el contenido): la app vuelve a
 *    leer el objeto con sus permisos.
 *  - **Sin ecos**: lo que cambia la propia app (cabecera `X-Imagina-Source`,
 *    con el mismo usuario que registró los avisos) no genera aviso.
 *  - **A dónde**: un Administrador puede registrar cualquier dirección HTTPS;
 *    un Editor, sólo la de la app de la que se descargó el complemento (así un
 *    usuario sin permisos de administrador no puede hacer que el sitio llame a
 *    otro lado).
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_Hooks {

	const OPT_HOOK  = 'imaginabc_hook';
	const OPT_QUEUE = 'imaginabc_queue';
	const OPT_STATE = 'imaginabc_hook_state';
	const OPT_KEY   = 'imaginabc_async_key';
	const OPT_LOCK  = 'imaginabc_delivering';
	const OPT_KICK  = 'imaginabc_kick';
	const CRON      = 'imaginabc_deliver_cron';
	const EVENT     = 'imaginabc_deliver_event';
	const AJAX      = 'imaginabc_deliver';
	const MAX_QUEUE = 1000;
	const BATCH     = 200;
	/** Lo que no pudo salir en 48 horas se descarta (la vuelta horaria de la app lo cubre). */
	const MAX_AGE = 172800;
	/** A lo sumo un pedido al propio sitio cada tantos segundos (el resto lo junta la cola). */
	const KICK_EVERY = 15;
	/** Tope de columnas que se recuerdan por objeto. */
	const MAX_WATCH = 300;

	/** Metadatos que WordPress toca solo (abrir el editor, papelera): no son cambios. */
	const NOISE_META = array( '_edit_lock', '_edit_last', '_wp_old_slug', '_encloseme', '_pingme', '_wp_trash_meta_status', '_wp_trash_meta_time', '_wp_desired_post_slug', '_wp_old_date' );

	/** Metadatos de los plugins de SEO (cuando la app trae alguna columna de SEO). */
	const SEO_META_PREFIXES = array( 'rank_math_', '_yoast_wpseo_', '_seopress_', '_aioseo_' );

	/** Metadatos del sitio que alimentan columnas que la app siempre trae. */
	const CORE_META = array(
		'post'  => array( '_thumbnail_id', '_wp_page_template' ),
		'media' => array( '_wp_attachment_image_alt', '_wp_attachment_metadata' ),
		'term'  => array(),
	);

	/** @var array<string, array> lo anotado en este pedido */
	private static $pending = array();

	// ── Configuración (la escribe la app al registrar) ───────────────────────

	/** Autocargada (ver ImaginaBC_Install): leerla no cuesta consultas. */
	public static function config() {
		$c = get_option( self::OPT_HOOK );
		return is_array( $c ) && ! empty( $c['url'] ) && ! empty( $c['secret'] ) ? $c : null;
	}

	public static function state() {
		$s = get_option( self::OPT_STATE );
		return wp_parse_args(
			is_array( $s ) ? $s : array(),
			array(
				'fails'      => 0,
				'next_at'    => 0,
				'last_ok_at' => null,
				'last_error' => null,
				'delivered'  => 0,
				'dropped'    => 0,
				'disabled'   => null,
			)
		);
	}

	private static function save_state( array $patch ) {
		update_option( self::OPT_STATE, array_merge( self::state(), $patch ), false );
	}

	/** Lo que la app puede saber del aviso (sin el secreto). */
	public static function public_status() {
		$c     = self::config();
		$state = self::state();
		$queue = get_option( self::OPT_QUEUE, array() );
		return array(
			'registered'         => null !== $c,
			'url'                => $c ? $c['url'] : null,
			'objects'            => $c && isset( $c['objects'] ) ? $c['objects'] : null,
			'watch_hash'         => $c && isset( $c['watch_hash'] ) ? $c['watch_hash'] : null,
			'pending'            => is_array( $queue ) ? count( $queue ) : 0,
			'delivered'          => (int) $state['delivered'],
			'fails'              => (int) $state['fails'],
			'last_ok_at'         => $state['last_ok_at'],
			'last_error'         => $state['last_error'],
			'disabled'           => $state['disabled'],
			// La huella del secreto: la app compara sin que el secreto viaje.
			'secret_fingerprint' => $c ? substr( hash( 'sha256', $c['secret'] ), 0, 16 ) : null,
		);
	}

	/**
	 * ¿Puede el usuario conectado registrar avisos hacia `$url`? Un
	 * Administrador, a cualquier dirección; un usuario que edita contenido,
	 * sólo a la app de la que se descargó el complemento.
	 */
	public static function can_register_to( $url ) {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}
		return current_user_can( 'edit_posts' ) && ImaginaBC_Updater::is_app_hook_url( $url );
	}

	/** ¿Puede el usuario conectado ver o apagar el aviso que hay registrado? */
	public static function can_manage_current() {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}
		$c = self::config();
		return current_user_can( 'edit_posts' ) && ( ! $c || ImaginaBC_Updater::is_app_hook_url( $c['url'] ) );
	}

	/**
	 * Las columnas que la app trae, por objeto (`post_type:post`,
	 * `taxonomy:category`, `media:attachment`) → los metadatos que importan.
	 */
	private static function watch_from_fields( $fields ) {
		$watch = array();
		if ( ! is_array( $fields ) ) {
			return null;
		}
		foreach ( $fields as $okey => $keys ) {
			if ( ! is_string( $okey ) || ! preg_match( '/^(post_type|taxonomy|media):[a-z0-9_-]{1,32}$/', $okey ) ) {
				continue;
			}
			$meta = array();
			$seo  = false;
			foreach ( array_slice( (array) $keys, 0, self::MAX_WATCH ) as $k ) {
				if ( ! ImaginaBC_Util::valid_key( $k ) ) {
					continue;
				}
				if ( 0 === strpos( $k, 'seo:' ) ) {
					$seo = true;
				} elseif ( preg_match( '/^cf:(acf|mb|je|meta)\.(.+)$/', $k, $m ) ) {
					$meta[ $m[2] ] = true;
				}
			}
			$watch[ $okey ] = array(
				'seo'  => $seo,
				'meta' => array_keys( $meta ),
			);
		}
		return $watch;
	}

	/**
	 * Registrar (o actualizar) a dónde se avisa. Prueba la dirección en el acto
	 * con un «ping» firmado: si la app no responde, se sabe ahora y no al
	 * primer cambio.
	 */
	public static function register( $url, $secret, array $objects ) {
		$url = esc_url_raw( trim( (string) $url ), array( 'http', 'https' ) );
		if ( '' === $url ) {
			return new WP_Error( 'ibc_bad_url', __( 'La dirección para los avisos no es válida.', 'imagina-base-connector' ), array( 'status' => 400 ) );
		}
		if ( 0 !== strpos( $url, 'https://' ) && ! ImaginaBC_Util::is_local_env() ) {
			return new WP_Error( 'ibc_https', __( 'La dirección para los avisos tiene que usar HTTPS.', 'imagina-base-connector' ), array( 'status' => 400 ) );
		}
		// Además: quien no es Administrador no reemplaza lo que registró un Administrador hacia otro lado.
		if ( ! self::can_register_to( $url ) || ! self::can_manage_current() ) {
			return new WP_Error( 'ibc_needs_admin', __( 'Para los avisos en tiempo real hace falta un usuario Administrador, o descargar el complemento desde la app (así los avisos sólo pueden ir a ella).', 'imagina-base-connector' ), array( 'status' => 403 ) );
		}
		if ( ! is_string( $secret ) || strlen( $secret ) < 24 ) {
			return new WP_Error( 'ibc_bad_secret', __( 'Falta el secreto para firmar los avisos.', 'imagina-base-connector' ), array( 'status' => 400 ) );
		}
		$clean = array(
			'post_types' => array_values( array_filter( array_map( 'sanitize_key', (array) ( isset( $objects['post_types'] ) ? $objects['post_types'] : array() ) ) ) ),
			'taxonomies' => array_values( array_filter( array_map( 'sanitize_key', (array) ( isset( $objects['taxonomies'] ) ? $objects['taxonomies'] : array() ) ) ) ),
			'media'      => ! empty( $objects['media'] ),
		);
		$watch  = self::watch_from_fields( isset( $objects['fields'] ) ? $objects['fields'] : null );
		$config = array(
			'url'           => $url,
			'secret'        => $secret,
			'objects'       => $clean,
			'watch'         => $watch,
			// La huella la calcula la app (así compara lo suyo sin depender de cómo PHP arma un JSON).
			'watch_hash'    => isset( $objects['watch_hash'] ) && is_string( $objects['watch_hash'] ) && preg_match( '/^[a-f0-9]{8,64}$/', $objects['watch_hash'] ) ? $objects['watch_hash'] : null,
			'user_id'       => get_current_user_id(),
			'registered_at' => gmdate( 'c' ),
		);
		update_option( self::OPT_HOOK, $config, true );
		self::save_state(
			array(
				'disabled'   => null,
				'fails'      => 0,
				'next_at'    => 0,
				'last_error' => null,
			)
		);
		self::ensure_schedule();
		// Si la app trae «Dónde se usa» de las imágenes, el índice empieza a armarse ya.
		if ( $clean['media'] ) {
			ImaginaBC_Media_Index::start();
		}
		$ping = self::send(
			array(
				'type' => 'ping',
				'site' => home_url(),
			),
			10
		);
		return array(
			'registered' => true,
			'ping'       => array(
				'ok'     => $ping['ok'],
				'status' => $ping['status'],
				'error'  => $ping['error'],
			),
		);
	}

	public static function unregister() {
		update_option( self::OPT_HOOK, array(), true );
		delete_option( self::OPT_QUEUE );
		delete_option( self::OPT_STATE );
		delete_option( self::OPT_KICK );
		self::unschedule();
	}

	// ── Captura de cambios ───────────────────────────────────────────────────

	public static function boot() {
		add_action( ImaginaBC_Media_Index::CRON, array( 'ImaginaBC_Media_Index', 'cron' ) );
		if ( ImaginaBC_Media_Index::active() ) {
			add_action( 'wp_after_insert_post', array( __CLASS__, 'on_any_post_saved' ), 30, 2 );
			add_action( 'deleted_post', array( 'ImaginaBC_Media_Index', 'forget' ) );
			add_action( 'added_post_meta', array( __CLASS__, 'on_thumbnail_meta' ), 10, 3 );
			add_action( 'updated_post_meta', array( __CLASS__, 'on_thumbnail_meta' ), 10, 3 );
			add_action( 'deleted_post_meta', array( __CLASS__, 'on_thumbnail_meta' ), 10, 3 );
		}
		if ( ! self::config() ) {
			return;
		}
		add_action( 'wp_ajax_' . self::AJAX, array( __CLASS__, 'async_deliver' ) );
		add_action( 'wp_ajax_nopriv_' . self::AJAX, array( __CLASS__, 'async_deliver' ) );
		add_action( self::EVENT, array( __CLASS__, 'deliver' ) );
		add_action( self::CRON, array( __CLASS__, 'deliver' ) );
		add_filter( 'cron_schedules', array( __CLASS__, 'cron_schedules' ) ); // phpcs:ignore WordPress.WP.CronInterval -- 5 minutos: reintentos de avisos, sólo con la app conectada.
		add_action( 'wp_after_insert_post', array( __CLASS__, 'on_post_saved' ), 20, 2 );
		add_action( 'trashed_post', array( __CLASS__, 'on_post_trashed' ) );
		add_action( 'untrashed_post', array( __CLASS__, 'on_post_untrashed' ) );
		add_action( 'deleted_post', array( __CLASS__, 'on_post_deleted' ), 10, 2 );
		add_action( 'added_post_meta', array( __CLASS__, 'on_post_meta' ), 10, 3 );
		add_action( 'updated_post_meta', array( __CLASS__, 'on_post_meta' ), 10, 3 );
		add_action( 'deleted_post_meta', array( __CLASS__, 'on_post_meta_deleted' ), 10, 3 );
		add_action( 'aioseo_insert_post', array( __CLASS__, 'on_post_id' ) );
		add_action( 'created_term', array( __CLASS__, 'on_term_saved' ), 10, 3 );
		add_action( 'edited_term', array( __CLASS__, 'on_term_saved' ), 10, 3 );
		add_action( 'delete_term', array( __CLASS__, 'on_term_deleted' ), 10, 3 );
		add_action( 'added_term_meta', array( __CLASS__, 'on_term_meta' ), 10, 3 );
		add_action( 'updated_term_meta', array( __CLASS__, 'on_term_meta' ), 10, 3 );
		add_action( 'deleted_term_meta', array( __CLASS__, 'on_term_meta_deleted' ), 10, 3 );
		add_action( 'update_option_wpseo_taxonomy_meta', array( __CLASS__, 'on_yoast_terms' ), 10, 2 );
		add_action( 'add_attachment', array( __CLASS__, 'on_media_saved' ) );
		add_action( 'edit_attachment', array( __CLASS__, 'on_media_saved' ) );
		add_action( 'delete_attachment', array( __CLASS__, 'on_media_deleted' ) );
		add_action( 'shutdown', array( __CLASS__, 'dispatch' ) );
		self::ensure_schedule();
	}

	public static function cron_schedules( $schedules ) {
		$schedules['imaginabc_five_minutes'] = array(
			'interval' => 300,
			'display'  => __( 'Cada 5 minutos (Imagina Base)', 'imagina-base-connector' ),
		);
		return $schedules;
	}

	private static function ensure_schedule() {
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + 300, 'imaginabc_five_minutes', self::CRON );
		}
	}

	public static function unschedule() {
		wp_clear_scheduled_hook( self::CRON );
		wp_clear_scheduled_hook( self::EVENT );
	}

	private static function tracks( $kind, $object ) {
		$c = self::config();
		if ( ! $c ) {
			return false;
		}
		$o = isset( $c['objects'] ) ? $c['objects'] : array();
		if ( 'media' === $kind ) {
			return ! empty( $o['media'] );
		}
		$list = 'term' === $kind ? ( isset( $o['taxonomies'] ) ? $o['taxonomies'] : array() ) : ( isset( $o['post_types'] ) ? $o['post_types'] : array() );
		return in_array( $object, (array) $list, true );
	}

	/**
	 * ¿Este metadato alimenta alguna columna que la app trae? Si la app no dijo
	 * qué columnas trae (registro de 1.0.0, hasta la próxima revisión horaria),
	 * sólo cuentan los del SEO y los del propio WordPress.
	 */
	private static function watches_meta( $kind, $object, $meta_key ) {
		if ( in_array( $meta_key, self::CORE_META[ $kind ], true ) ) {
			return true;
		}
		$c     = self::config();
		$okey  = ( 'term' === $kind ? 'taxonomy' : ( 'media' === $kind ? 'media' : 'post_type' ) ) . ':' . $object;
		$watch = isset( $c['watch'] ) && is_array( $c['watch'] ) ? $c['watch'] : null;
		$w     = null === $watch ? array(
			'seo'  => true,
			'meta' => array(),
		) : ( isset( $watch[ $okey ] ) ? $watch[ $okey ] : null );
		if ( null === $w ) {
			return false;
		}
		if ( ! empty( $w['seo'] ) ) {
			foreach ( self::SEO_META_PREFIXES as $prefix ) {
				if ( 0 === strpos( $meta_key, $prefix ) ) {
					return true;
				}
			}
		}
		// ACF guarda la clave del campo en `_<nombre>`: también cuenta.
		$name = 0 === strpos( $meta_key, '_' ) ? substr( $meta_key, 1 ) : $meta_key;
		return in_array( $meta_key, (array) $w['meta'], true ) || in_array( $name, (array) $w['meta'], true );
	}

	/**
	 * Anota un cambio. Se junta en memoria durante el pedido (un guardado toca
	 * muchos metadatos) y se escribe UNA vez al final, en `dispatch()`.
	 */
	public static function queue( $kind, $object, $id, $action ) {
		$id = (int) $id;
		if ( $id <= 0 || ImaginaBC_Util::request_from_app() || ! self::tracks( $kind, $object ) ) {
			return;
		}
		$key = $kind . ':' . $object . ':' . $id;
		// Borrar gana: un «guardar» que llega después de borrar (un plugin que
		// limpia metadatos) no lo resucita.
		if ( isset( self::$pending[ $key ] ) && 'deleted' === self::$pending[ $key ]['action'] && 'deleted' !== $action ) {
			return;
		}
		self::$pending[ $key ] = array(
			'kind'   => $kind,
			'object' => $object,
			'id'     => $id,
			'action' => $action,
			'at'     => time(),
		);
	}

	/** Suma lo anotado en este pedido a la cola guardada. */
	private static function flush_pending() {
		if ( empty( self::$pending ) ) {
			return false;
		}
		wp_cache_delete( self::OPT_QUEUE, 'options' );
		$queue = get_option( self::OPT_QUEUE, array() );
		$queue = is_array( $queue ) ? $queue : array();
		foreach ( self::$pending as $key => $event ) {
			// Los ids no se reutilizan: algo ya borrado sigue borrado.
			if ( isset( $queue[ $key ] ) && 'deleted' === $queue[ $key ]['action'] ) {
				continue;
			}
			unset( $queue[ $key ] );
			$queue[ $key ] = $event;
		}
		self::$pending = array();
		if ( count( $queue ) > self::MAX_QUEUE ) {
			$queue = array_slice( $queue, -self::MAX_QUEUE, null, true );
			$state = self::state();
			self::save_state( array( 'dropped' => (int) $state['dropped'] + 1 ) );
		}
		update_option( self::OPT_QUEUE, $queue, false );
		return true;
	}

	private static function post_kind( $post ) {
		return 'attachment' === $post->post_type ? 'media' : 'post';
	}

	/**
	 * Cualquier entrada guardada (aunque la app no sincronice su tipo): se pone
	 * al día el índice de «Dónde se usa» y se avisa de las imágenes que
	 * empezaron o dejaron de usarse.
	 */
	public static function on_any_post_saved( $post_id, $post ) {
		if ( ! $post instanceof WP_Post || wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) || 'auto-draft' === $post->post_status ) {
			return;
		}
		foreach ( ImaginaBC_Media_Index::sync_post( $post_id ) as $media_id ) {
			self::queue( 'media', 'attachment', $media_id, 'saved' );
		}
	}

	/** La imagen destacada cambió sin guardar la entrada (código de otro plugin): también cuenta. */
	public static function on_thumbnail_meta( $meta_id, $post_id, $meta_key ) {
		if ( '_thumbnail_id' !== $meta_key ) {
			return;
		}
		foreach ( ImaginaBC_Media_Index::sync_post( $post_id ) as $media_id ) {
			self::queue( 'media', 'attachment', $media_id, 'saved' );
		}
	}

	public static function on_post_saved( $post_id, $post ) {
		if ( ! $post instanceof WP_Post || wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) || 'auto-draft' === $post->post_status ) {
			return;
		}
		$kind = self::post_kind( $post );
		self::queue( $kind, 'media' === $kind ? 'attachment' : $post->post_type, $post_id, 'trash' === $post->post_status ? 'trashed' : 'saved' );
	}

	public static function on_post_id( $post_id ) {
		$post = get_post( $post_id );
		if ( $post ) {
			self::on_post_saved( $post_id, $post );
		}
	}

	public static function on_post_trashed( $post_id ) {
		$post = get_post( $post_id );
		if ( $post ) {
			$kind = self::post_kind( $post );
			self::queue( $kind, 'media' === $kind ? 'attachment' : $post->post_type, $post_id, 'trashed' );
		}
	}

	public static function on_post_untrashed( $post_id ) {
		$post = get_post( $post_id );
		if ( $post ) {
			$kind = self::post_kind( $post );
			self::queue( $kind, 'media' === $kind ? 'attachment' : $post->post_type, $post_id, 'saved' );
		}
	}

	public static function on_post_deleted( $post_id, $post = null ) {
		if ( ! $post instanceof WP_Post || wp_is_post_revision( $post_id ) ) {
			return;
		}
		$kind = self::post_kind( $post );
		self::queue( $kind, 'media' === $kind ? 'attachment' : $post->post_type, $post_id, 'deleted' );
	}

	public static function on_post_meta( $meta_id, $post_id, $meta_key ) {
		if ( in_array( $meta_key, self::NOISE_META, true ) ) {
			return;
		}
		$post = get_post( $post_id );
		if ( ! $post || wp_is_post_revision( $post ) || 'auto-draft' === $post->post_status ) {
			return;
		}
		$kind   = self::post_kind( $post );
		$object = 'media' === $kind ? 'attachment' : $post->post_type;
		if ( ! self::tracks( $kind, $object ) || ! self::watches_meta( $kind, $object, (string) $meta_key ) ) {
			return;
		}
		self::queue( $kind, $object, $post_id, 'trash' === $post->post_status ? 'trashed' : 'saved' );
	}

	public static function on_post_meta_deleted( $meta_ids, $post_id, $meta_key ) {
		self::on_post_meta( 0, $post_id, $meta_key );
	}

	public static function on_term_saved( $term_id, $tt_id, $taxonomy ) {
		self::queue( 'term', $taxonomy, $term_id, 'saved' );
	}

	public static function on_term_deleted( $term_id, $tt_id, $taxonomy ) {
		self::queue( 'term', $taxonomy, $term_id, 'deleted' );
	}

	public static function on_term_meta( $meta_id, $term_id, $meta_key ) {
		$term = get_term( $term_id );
		if ( $term instanceof WP_Term && self::tracks( 'term', $term->taxonomy ) && self::watches_meta( 'term', $term->taxonomy, (string) $meta_key ) ) {
			self::queue( 'term', $term->taxonomy, $term_id, 'saved' );
		}
	}

	public static function on_term_meta_deleted( $meta_ids, $term_id, $meta_key ) {
		self::on_term_meta( 0, $term_id, $meta_key );
	}

	/** Yoast guarda el SEO de todos los términos en UNA opción: se avisa de los que cambiaron. */
	public static function on_yoast_terms( $old, $new ) {
		$old = is_array( $old ) ? $old : array();
		$new = is_array( $new ) ? $new : array();
		foreach ( $new as $taxonomy => $terms ) {
			foreach ( (array) $terms as $term_id => $meta ) {
				$before = isset( $old[ $taxonomy ][ $term_id ] ) ? $old[ $taxonomy ][ $term_id ] : null;
				if ( $before !== $meta ) {
					self::queue( 'term', $taxonomy, $term_id, 'saved' );
				}
			}
		}
	}

	public static function on_media_saved( $post_id ) {
		self::queue( 'media', 'attachment', $post_id, 'saved' );
	}

	public static function on_media_deleted( $post_id ) {
		self::queue( 'media', 'attachment', $post_id, 'deleted' );
	}

	// ── Envío ────────────────────────────────────────────────────────────────

	private static function async_key() {
		$key = get_option( self::OPT_KEY );
		if ( ! is_string( $key ) || strlen( $key ) < 32 ) {
			$key = wp_generate_password( 40, false, false );
			update_option( self::OPT_KEY, $key, false );
		}
		return $key;
	}

	/**
	 * Al terminar el pedido de la persona: un pedido aparte al propio sitio
	 * (sin esperarlo, a lo sumo uno cada 15 segundos) vacía la cola. De
	 * respaldo, WP-Cron en un minuto.
	 */
	public static function dispatch() {
		if ( ! self::flush_pending() ) {
			return;
		}
		if ( ! wp_next_scheduled( self::EVENT ) ) {
			wp_schedule_single_event( time() + 60, self::EVENT );
		}
		$last = (int) get_option( self::OPT_KICK, 0 );
		if ( time() - $last < self::KICK_EVERY ) {
			return;
		}
		update_option( self::OPT_KICK, time(), false );
		wp_remote_post(
			admin_url( 'admin-ajax.php' ),
			array(
				'timeout'   => 0.01,
				'blocking'  => false,
				'sslverify' => apply_filters( 'https_local_ssl_verify', false ), // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals -- filtro de WordPress.
				'body'      => array(
					'action' => self::AJAX,
					'key'    => self::async_key(),
				),
			)
		);
	}

	public static function async_deliver() {
		$key = isset( $_POST['key'] ) ? sanitize_text_field( wp_unslash( $_POST['key'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification -- pedido del propio sitio, autenticado con una clave aleatoria (no hay usuario).
		if ( ! hash_equals( self::async_key(), $key ) ) {
			wp_die( '', '', array( 'response' => 403 ) );
		}
		ignore_user_abort( true );
		self::deliver();
		wp_die( '', '', array( 'response' => 200 ) );
	}

	/** Un candado corto (dos pedidos a la vez no mandan lo mismo dos veces). */
	private static function lock() {
		if ( add_option( self::OPT_LOCK, time(), '', false ) ) {
			return true;
		}
		$at = (int) get_option( self::OPT_LOCK );
		if ( $at > 0 && time() - $at > 120 ) {
			update_option( self::OPT_LOCK, time(), false );
			return true;
		}
		return false;
	}

	private static function unlock() {
		delete_option( self::OPT_LOCK );
	}

	/** Espera antes del próximo intento según cuántos fallaron seguidos. */
	private static function backoff( $fails ) {
		$steps = array( 60, 120, 300, 600, 1800, 3600 );
		return $steps[ min( max( 0, $fails - 1 ), count( $steps ) - 1 ) ];
	}

	public static function deliver( $force = false ) {
		$c = self::config();
		if ( ! $c ) {
			return;
		}
		// Cola vacía: no se toca nada más (sin candados ni escrituras cada 5 minutos).
		$queue = get_option( self::OPT_QUEUE, array() );
		if ( empty( $queue ) ) {
			return;
		}
		$state = self::state();
		if ( $state['disabled'] && ! $force ) {
			return;
		}
		if ( ! $force && (int) $state['next_at'] > time() ) {
			return;
		}
		if ( ! self::lock() ) {
			return;
		}
		try {
			for ( $round = 0; $round < 5; $round++ ) {
				wp_cache_delete( self::OPT_QUEUE, 'options' );
				$queue = get_option( self::OPT_QUEUE, array() );
				$queue = is_array( $queue ) ? $queue : array();
				// Lo que lleva demasiado sin salir se descarta (la vuelta horaria de la app lo cubre).
				$fresh = array();
				foreach ( $queue as $k => $e ) {
					if ( time() - (int) $e['at'] <= self::MAX_AGE ) {
						$fresh[ $k ] = $e;
					}
				}
				if ( count( $fresh ) !== count( $queue ) ) {
					update_option( self::OPT_QUEUE, $fresh, false );
				}
				if ( empty( $fresh ) ) {
					return;
				}
				$batch  = array_slice( $fresh, 0, self::BATCH, true );
				$events = array();
				foreach ( $batch as $e ) {
					$events[] = array(
						'kind'   => $e['kind'],
						'object' => $e['object'],
						'id'     => (int) $e['id'],
						'action' => $e['action'],
						'at'     => gmdate( 'Y-m-d\TH:i:s\Z', (int) $e['at'] ),
					);
				}
				$res = self::send(
					array(
						'type'   => 'events',
						'site'   => home_url(),
						'events' => $events,
					),
					15
				);
				if ( $res['ok'] ) {
					wp_cache_delete( self::OPT_QUEUE, 'options' );
					$now = get_option( self::OPT_QUEUE, array() );
					$now = is_array( $now ) ? $now : array();
					foreach ( $batch as $k => $e ) {
						// Si volvió a cambiar mientras se mandaba, queda para la próxima.
						if ( isset( $now[ $k ] ) && (int) $now[ $k ]['at'] === (int) $e['at'] && $now[ $k ]['action'] === $e['action'] ) {
							unset( $now[ $k ] );
						}
					}
					update_option( self::OPT_QUEUE, $now, false );
					$st = self::state();
					self::save_state(
						array(
							'fails'      => 0,
							'next_at'    => 0,
							'last_ok_at' => gmdate( 'c' ),
							'last_error' => null,
							'delivered'  => (int) $st['delivered'] + count( $events ),
						)
					);
					continue;
				}
				if ( 404 === $res['status'] || 410 === $res['status'] ) {
					// La app ya no conoce esta dirección (dejó de sincronizar o la cambió): se deja de avisar.
					delete_option( self::OPT_QUEUE );
					self::save_state(
						array(
							'disabled'   => 'gone',
							'last_error' => __( 'La app ya no espera avisos en esta dirección.', 'imagina-base-connector' ),
						)
					);
					return;
				}
				$fails = (int) $state['fails'] + 1;
				self::save_state(
					array(
						'fails'      => $fails,
						'next_at'    => time() + self::backoff( $fails ),
						'last_error' => $res['error'] ? $res['error'] : sprintf(
							/* translators: %d: código de respuesta HTTP de la app */
							__( 'La app respondió %d.', 'imagina-base-connector' ),
							$res['status']
						),
						'disabled'   => 401 === $res['status'] ? 'rejected' : null,
					)
				);
				return;
			}
		} finally {
			self::unlock();
		}
	}

	/**
	 * POST firmado: `X-Imagina-Signature: sha256=HMAC(secreto, "<timestamp>.<cuerpo>")`.
	 *
	 * Sale con `wp_safe_remote_post` (WordPress rechaza direcciones de la red
	 * interna), salvo hacia la app de la que se descargó el complemento —que
	 * puede estar en el mismo servidor— y en un sitio de pruebas.
	 */
	private static function send( array $payload, $timeout ) {
		$c = self::config();
		if ( ! $c ) {
			return array(
				'ok'     => false,
				'status' => 0,
				'error'  => __( 'No hay dirección registrada.', 'imagina-base-connector' ),
			);
		}
		$body = wp_json_encode( $payload );
		$ts   = (string) time();
		$args = array(
			'timeout'     => $timeout,
			'blocking'    => true,
			'redirection' => 0,
			'headers'     => array(
				'Content-Type'        => 'application/json; charset=utf-8',
				'X-Imagina-Timestamp' => $ts,
				'X-Imagina-Signature' => 'sha256=' . hash_hmac( 'sha256', $ts . '.' . $body, $c['secret'] ),
				'X-Imagina-Plugin'    => IMAGINABC_VERSION,
			),
			'user-agent'  => 'ImaginaBaseConnector/' . IMAGINABC_VERSION . '; ' . home_url(),
			'body'        => $body,
		);
		$res = ImaginaBC_Util::is_local_env() ? wp_remote_post( $c['url'], $args ) : ImaginaBC_Updater::safe_post_to( $c['url'], $args );
		if ( is_wp_error( $res ) ) {
			return array(
				'ok'     => false,
				'status' => 0,
				'error'  => $res->get_error_message(),
			);
		}
		$status = (int) wp_remote_retrieve_response_code( $res );
		return array(
			'ok'     => $status >= 200 && $status < 300,
			'status' => $status,
			'error'  => $status >= 200 && $status < 300 ? null : sprintf(
				/* translators: %d: código de respuesta HTTP de la app */
				__( 'La app respondió %d.', 'imagina-base-connector' ),
				$status
			),
		);
	}

	// ── Pantalla de estado (Herramientas → Imagina Base) ─────────────────────

	public static function render_status_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( isset( $_POST['imaginabc_deliver_now'] ) && check_admin_referer( 'imaginabc_deliver_now' ) ) {
			self::deliver( true );
			echo '<div class="notice notice-success"><p>' . esc_html__( 'Listo: se intentó mandar lo pendiente.', 'imagina-base-connector' ) . '</p></div>';
		}
		$s     = self::public_status();
		$seo   = ImaginaBC_SEO::info();
		$p     = ImaginaBC_Fields::providers();
		$index = ImaginaBC_Media_Index::public_state();
		echo '<div class="wrap"><h1>Imagina Base Connector</h1>';
		echo '<p>' . esc_html__( 'Este complemento le da a tu cuenta de Imagina Base el SEO de tus entradas y términos, los campos personalizados con su tipo, la biblioteca de medios y avisos en tiempo real. Se configura desde la app (Ajustes → Integraciones → tu sitio).', 'imagina-base-connector' ) . '</p>';
		echo '<table class="widefat striped" style="max-width:780px"><tbody>';
		echo '<tr><th>' . esc_html__( 'Versión', 'imagina-base-connector' ) . '</th><td>' . esc_html( IMAGINABC_VERSION ) . ( ImaginaBC_Updater::release_key() ? ' · ' . esc_html__( 'actualizaciones firmadas', 'imagina-base-connector' ) : '' ) . '</td></tr>';
		echo '<tr><th>' . esc_html__( 'Plugin de SEO', 'imagina-base-connector' ) . '</th><td>' . esc_html( $seo ? $seo['name'] . ' ' . $seo['version'] : __( 'Ninguno activo', 'imagina-base-connector' ) ) . ( $seo && $seo['problem'] ? '<br><em>' . esc_html( $seo['problem'] ) . '</em>' : '' ) . '</td></tr>';
		$fields = array();
		if ( $p['acf'] ) {
			$fields[] = 'ACF';
		}
		if ( $p['metabox'] ) {
			$fields[] = 'Meta Box';
		}
		if ( $p['jetengine'] ) {
			$fields[] = 'JetEngine';
		}
		echo '<tr><th>' . esc_html__( 'Campos personalizados', 'imagina-base-connector' ) . '</th><td>' . esc_html( empty( $fields ) ? __( 'Sólo los metadatos del sitio', 'imagina-base-connector' ) : implode( ', ', $fields ) ) . '</td></tr>';
		if ( 'none' !== $index['status'] ) {
			echo '<tr><th>' . esc_html__( 'Dónde se usa cada imagen', 'imagina-base-connector' ) . '</th><td>' . esc_html(
				'ready' === $index['status']
					? __( 'Al día', 'imagina-base-connector' )
					: sprintf(
						/* translators: %d: cuántas entradas ya se revisaron */
						__( 'Calculando (%d entradas revisadas)', 'imagina-base-connector' ),
						$index['done']
					)
			) . '</td></tr>';
		}
		echo '<tr><th>' . esc_html__( 'Avisos en tiempo real', 'imagina-base-connector' ) . '</th><td>';
		if ( ! $s['registered'] ) {
			echo esc_html__( 'Apagados (se activan desde la app, en el modo «En tiempo real»).', 'imagina-base-connector' );
		} else {
			$host = wp_parse_url( $s['url'], PHP_URL_HOST );
			echo esc_html(
				sprintf(
					/* translators: 1: dominio de la app, 2: avisos enviados, 3: avisos pendientes */
					__( 'A %1$s · %2$d enviados · %3$d pendientes', 'imagina-base-connector' ),
					$host,
					$s['delivered'],
					$s['pending']
				)
			);
			if ( $s['last_ok_at'] ) {
				echo '<br>' . esc_html(
					sprintf(
						/* translators: %s: fecha y hora del último aviso que llegó a la app */
						__( 'Último aviso que llegó: %s', 'imagina-base-connector' ),
						get_date_from_gmt( gmdate( 'Y-m-d H:i:s', strtotime( $s['last_ok_at'] ) ) )
					)
				);
			}
			if ( $s['last_error'] ) {
				echo '<br><strong>' . esc_html( $s['last_error'] ) . '</strong>';
			}
		}
		echo '</td></tr></tbody></table>';
		if ( $s['registered'] ) {
			echo '<form method="post" style="margin-top:12px">';
			wp_nonce_field( 'imaginabc_deliver_now' );
			echo '<button class="button" name="imaginabc_deliver_now" value="1">' . esc_html__( 'Mandar lo pendiente ahora', 'imagina-base-connector' ) . '</button></form>';
		}
		echo '</div>';
	}
}
