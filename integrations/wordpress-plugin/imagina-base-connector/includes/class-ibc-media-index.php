<?php
/**
 * Dónde se usa cada imagen, en una tabla propia con índice.
 *
 * En 1.0.0 esto se calculaba buscando con `LIKE` dentro del contenido de TODAS
 * las entradas, una vez por cada 100 imágenes: en un sitio con 20.000
 * entradas eran ~35 segundos de base de datos por tanda (medido). Ahora:
 *
 *  - **Una tabla** `{prefijo}imaginabc_media_usage (media_id, post_id)` con
 *    clave primaria: leer el uso de 100 imágenes es una consulta por índice.
 *  - **Se arma UNA vez**, en segundo plano (WP-Cron, de a tandas cortas y con
 *    tope de tiempo), recién cuando la app pide «Dónde se usa». Mientras se
 *    arma, esas columnas llegan vacías y la app lo sabe (`building`).
 *  - **Se mantiene al guardar**: cuando alguien guarda una entrada se vuelve
 *    a leer SÓLO su contenido (una expresión regular, sin consultas pesadas) y
 *    se avisa a la app de las imágenes que empezaron o dejaron de usarse.
 *
 * Qué cuenta como «usada»: la imagen destacada, la clase `wp-image-N` del
 * editor clásico, el `"id":N` / `"ids":[…]` / `"mediaId":N` de los bloques y
 * el `[gallery ids="…"]`. Sólo en entradas publicadas, programadas, borradores,
 * pendientes o privadas.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_Media_Index {

	const TABLE    = 'imaginabc_media_usage';
	/** Estado (autocargado: se mira en cada pedido para saber si hay que mantener el índice). */
	const OPT = 'imaginabc_media_index';
	/** Avance del armado (sin autocarga: se lee siempre de la base, nunca de la memoria del pedido). */
	const OPT_PROGRESS = 'imaginabc_media_index_progress';
	/** Un solo armado a la vez (una tarea programada y una lectura de la app pueden coincidir). */
	const OPT_LOCK = 'imaginabc_media_index_lock';
	const CRON     = 'imaginabc_index_media';
	const STATUSES = array( 'publish', 'future', 'draft', 'pending', 'private' );
	const SKIP     = array( 'revision', 'attachment', 'nav_menu_item', 'customize_changeset', 'oembed_cache', 'wp_global_styles' );
	const CHUNK    = 100;
	/** Tope de imágenes por entrada (una galería enorme no infla la tabla). */
	const MAX_REFS = 500;

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . self::TABLE;
	}

	public static function create_table() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$t = self::table();
		dbDelta(
			"CREATE TABLE {$t} (
  media_id bigint(20) unsigned NOT NULL,
  post_id bigint(20) unsigned NOT NULL,
  PRIMARY KEY  (media_id,post_id),
  KEY post_id (post_id)
) " . $wpdb->get_charset_collate() . ';'
		);
	}

	/** `none` (nunca se pidió) | `building` | `ready`. Autocargada: sin consultas. */
	public static function state() {
		$s = get_option( self::OPT );
		return wp_parse_args(
			is_array( $s ) ? $s : array(),
			array(
				'status'     => 'none',
				'done'       => 0,
				'started_at' => null,
				'ready_at'   => null,
			)
		);
	}

	/** El avance, leído de la base (otro pedido pudo moverlo). */
	private static function progress() {
		wp_cache_delete( self::OPT_PROGRESS, 'options' );
		$p = get_option( self::OPT_PROGRESS );
		return wp_parse_args(
			is_array( $p ) ? $p : array(),
			array(
				'cursor' => 0,
				'done'   => 0,
			)
		);
	}

	private static function lock() {
		if ( add_option( self::OPT_LOCK, time(), '', false ) ) {
			return true;
		}
		wp_cache_delete( self::OPT_LOCK, 'options' );
		$at = (int) get_option( self::OPT_LOCK );
		// Un armado dura a lo sumo 20 segundos: un candado de más de un minuto quedó de un pedido que se cortó.
		if ( $at > 0 && time() - $at > 60 ) {
			update_option( self::OPT_LOCK, time(), false );
			return true;
		}
		return false;
	}

	private static function unlock() {
		delete_option( self::OPT_LOCK );
	}

	public static function active() {
		return 'none' !== self::state()['status'];
	}

	public static function ready() {
		return 'ready' === self::state()['status'];
	}

	/** Lo que la app puede saber del índice. */
	public static function public_state() {
		$s = self::state();
		return array(
			'status'   => $s['status'],
			'done'     => 'building' === $s['status'] ? (int) self::progress()['done'] : (int) $s['done'],
			'ready_at' => $s['ready_at'],
		);
	}

	/** Se pidió por primera vez: arranca a armarse en segundo plano. */
	public static function start() {
		if ( self::active() ) {
			return;
		}
		global $wpdb;
		self::create_table();
		$wpdb->query( "TRUNCATE TABLE {$wpdb->prefix}imaginabc_media_usage" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- tabla propia, sin datos de nadie.
		update_option(
			self::OPT_PROGRESS,
			array(
				'cursor' => 0,
				'done'   => 0,
			),
			false
		);
		update_option(
			self::OPT,
			array(
				'status'     => 'building',
				'done'       => 0,
				'started_at' => gmdate( 'c' ),
				'ready_at'   => null,
			),
			true
		);
		self::schedule( 5 );
	}

	/** Desactivado: los guardados dejan de anotarse, así que al volver se arma de nuevo. */
	public static function reset() {
		wp_clear_scheduled_hook( self::CRON );
		update_option( self::OPT, array(), true );
		delete_option( self::OPT_PROGRESS );
		delete_option( self::OPT_LOCK );
	}

	private static function schedule( $delay ) {
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_single_event( time() + $delay, self::CRON );
		}
	}

	/** Tarea programada: una tanda de hasta 20 segundos y, si falta, la siguiente en 10. */
	public static function cron() {
		if ( 'building' !== self::state()['status'] ) {
			return;
		}
		self::build( 20 );
		if ( 'building' === self::state()['status'] ) {
			self::schedule( 10 );
		}
	}

	/**
	 * Avanza el armado hasta `$budget` segundos. Recorre las entradas por id
	 * (de a 100, sólo id + contenido) y reemplaza sus filas en la tabla.
	 */
	public static function build( $budget ) {
		if ( 'building' !== self::state()['status'] || ! self::lock() ) {
			return;
		}
		try {
			self::build_locked( (float) $budget );
		} finally {
			self::unlock();
		}
	}

	private static function build_locked( $budget ) {
		global $wpdb;
		$until = microtime( true ) + $budget;
		$skip  = implode( ',', array_fill( 0, count( self::SKIP ), '%s' ) );
		$stat  = implode( ',', array_fill( 0, count( self::STATUSES ), '%s' ) );
		do {
			$s    = self::progress();
			$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- armado en segundo plano, de a tandas.
				$wpdb->prepare( // phpcs:ignore WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- los marcadores de las listas se arman con array_fill.
					"SELECT ID, post_content FROM {$wpdb->posts} WHERE ID > %d AND post_type NOT IN ({$skip}) AND post_status IN ({$stat}) ORDER BY ID ASC LIMIT %d", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- sólo marcadores (%s).
					array_merge( array( (int) $s['cursor'] ), self::SKIP, self::STATUSES, array( self::CHUNK ) )
				)
			);
			if ( empty( $rows ) ) {
				$st = self::state();
				update_option(
					self::OPT,
					array(
						'status'     => 'ready',
						'done'       => (int) $s['done'],
						'started_at' => $st['started_at'],
						'ready_at'   => gmdate( 'c' ),
					),
					true
				);
				delete_option( self::OPT_PROGRESS );
				return;
			}
			$ids    = array();
			$by_id  = array();
			foreach ( $rows as $r ) {
				$ids[]                  = (int) $r->ID;
				$by_id[ (int) $r->ID ] = self::refs_in_content( (string) $r->post_content );
			}
			foreach ( self::thumbnails( $ids ) as $pid => $mid ) {
				$by_id[ $pid ][ $mid ] = $mid;
			}
			self::replace_rows( $ids, $by_id );
			update_option(
				self::OPT_PROGRESS,
				array(
					'cursor' => (int) end( $ids ),
					'done'   => (int) $s['done'] + count( $ids ),
				),
				false
			);
		} while ( microtime( true ) < $until );
	}

	/** Ids de medios que aparecen en un contenido (sin repetir, con tope). */
	public static function refs_in_content( $content ) {
		$out = array();
		if ( '' === $content ) {
			return $out;
		}
		$patterns = array(
			'/wp-image-(\d+)(?!\d)/',
			'/"id":(\d+)(?!\d)/',
			'/"mediaId":(\d+)(?!\d)/',
		);
		foreach ( $patterns as $re ) {
			if ( preg_match_all( $re, $content, $m ) ) {
				foreach ( $m[1] as $id ) {
					$out[ (int) $id ] = (int) $id;
				}
			}
		}
		// Galerías: `"ids":[1,2]` (bloque viejo) y `[gallery ids="1,2"]`.
		if ( preg_match_all( '/"ids":\[([\d,\s]+)\]|\[gallery[^\]]*\bids=["\']?([\d,\s]+)/', $content, $m, PREG_SET_ORDER ) ) {
			foreach ( $m as $g ) {
				$list = '' !== $g[1] ? $g[1] : ( isset( $g[2] ) ? $g[2] : '' );
				foreach ( preg_split( '/[\s,]+/', $list, -1, PREG_SPLIT_NO_EMPTY ) as $id ) {
					$out[ (int) $id ] = (int) $id;
				}
			}
		}
		unset( $out[0] );
		return array_slice( $out, 0, self::MAX_REFS, true );
	}

	/** `post_id => media_id` de la imagen destacada de esas entradas (una consulta por índice). */
	private static function thumbnails( array $ids ) {
		global $wpdb;
		$out = array();
		if ( empty( $ids ) ) {
			return $out;
		}
		$in   = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT post_id, meta_value FROM {$wpdb->postmeta} WHERE meta_key = '_thumbnail_id' AND post_id IN ({$in})", array_map( 'intval', $ids ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQLPlaceholders,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- sólo marcadores (%d).
		foreach ( (array) $rows as $r ) {
			$mid = (int) $r->meta_value;
			if ( $mid > 0 ) {
				$out[ (int) $r->post_id ] = $mid;
			}
		}
		return $out;
	}

	/** Reemplaza las filas de esas entradas. */
	private static function replace_rows( array $post_ids, array $by_id ) {
		global $wpdb;
		if ( empty( $post_ids ) ) {
			return;
		}
		$post_ids = array_map( 'intval', $post_ids );
		$in       = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->prefix}imaginabc_media_usage WHERE post_id IN ({$in})", $post_ids ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQLPlaceholders,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- tabla propia, sólo marcadores (%d).
		$pairs = array();
		foreach ( $by_id as $pid => $mids ) {
			foreach ( $mids as $mid ) {
				$pairs[] = array( (int) $mid, (int) $pid );
			}
		}
		foreach ( array_chunk( $pairs, 500 ) as $chunk ) {
			$values = implode( ',', array_fill( 0, count( $chunk ), '(%d,%d)' ) );
			$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->prefix}imaginabc_media_usage (media_id, post_id) VALUES {$values}", array_merge( ...$chunk ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQLPlaceholders,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- tabla propia, sólo marcadores (%d).
		}
	}

	/**
	 * Al guardar una entrada: se recalcula SÓLO la suya. Devuelve las imágenes
	 * que cambiaron (empezó o dejó de usarlas) para avisar a la app.
	 */
	public static function sync_post( $post_id ) {
		global $wpdb;
		$post_id = (int) $post_id;
		if ( $post_id <= 0 || ! self::active() ) {
			return array();
		}
		$post = get_post( $post_id );
		if ( ! $post instanceof WP_Post || 'attachment' === $post->post_type ) {
			return array();
		}
		$now = array();
		if ( ! in_array( $post->post_type, self::SKIP, true ) && in_array( $post->post_status, self::STATUSES, true ) ) {
			$now   = self::refs_in_content( (string) $post->post_content );
			$thumb = (int) get_post_meta( $post_id, '_thumbnail_id', true );
			if ( $thumb > 0 ) {
				$now[ $thumb ] = $thumb;
			}
		}
		$before = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT media_id FROM {$wpdb->prefix}imaginabc_media_usage WHERE post_id = %d", $post_id ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- tabla propia, por índice.
		$before = array_combine( $before, $before );
		$added   = array_diff_key( $now, $before );
		$removed = array_diff_key( $before, $now );
		if ( empty( $added ) && empty( $removed ) ) {
			return array();
		}
		self::replace_rows( array( $post_id ), array( $post_id => $now ) );
		return array_values( array_merge( $added, $removed ) );
	}

	/** Se borró una entrada o un medio: fuera sus filas. */
	public static function forget( $post_id ) {
		global $wpdb;
		if ( ! self::active() ) {
			return;
		}
		$id = (int) $post_id;
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->prefix}imaginabc_media_usage WHERE post_id = %d OR media_id = %d", $id, $id ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- tabla propia, por índice.
	}

	/** Títulos que se traen por imagen (el resto sólo se cuenta). */
	const SHOWN = 10;

	/**
	 * `media_id => ['count' => N, 'titles' => [hasta 10 títulos]]` de esas
	 * imágenes, o `null` si el índice todavía se está armando.
	 */
	public static function usage( array $media_ids ) {
		global $wpdb;
		if ( ! self::ready() ) {
			return null;
		}
		$ids = ImaginaBC_Util::ids( $media_ids, 100 );
		$out = array();
		if ( empty( $ids ) ) {
			return $out;
		}
		$in   = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$stat = implode( ',', array_fill( 0, count( self::STATUSES ), '%s' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT u.media_id, u.post_id FROM {$wpdb->prefix}imaginabc_media_usage u INNER JOIN {$wpdb->posts} p ON p.ID = u.post_id WHERE u.media_id IN ({$in}) AND p.post_status IN ({$stat}) LIMIT 20000", array_merge( array_map( 'intval', $ids ), self::STATUSES ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery,WordPress.DB.PreparedSQLPlaceholders,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- tabla propia, sólo marcadores, por índice.
		$by_media = array();
		$titled   = array();
		foreach ( (array) $rows as $r ) {
			$mid = (int) $r->media_id;
			$pid = (int) $r->post_id;
			$by_media[ $mid ][] = $pid;
			if ( count( $by_media[ $mid ] ) <= self::SHOWN ) {
				$titled[ $pid ] = $pid;
			}
		}
		// Sólo las entradas cuyo título se muestra, en una consulta (sin sus metadatos).
		if ( ! empty( $titled ) ) {
			_prime_post_caches( array_values( $titled ), false, false );
		}
		foreach ( $by_media as $mid => $pids ) {
			$titles = array();
			foreach ( array_slice( $pids, 0, self::SHOWN ) as $pid ) {
				$title    = get_the_title( $pid );
				$titles[] = '' !== $title ? html_entity_decode( $title, ENT_QUOTES, 'UTF-8' ) : sprintf( '#%d', $pid );
			}
			$out[ $mid ] = array(
				'count'  => count( $pids ),
				'titles' => $titles,
			);
		}
		return $out;
	}
}
