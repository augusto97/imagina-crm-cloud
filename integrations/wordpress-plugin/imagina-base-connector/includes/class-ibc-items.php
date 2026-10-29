<?php
/**
 * Lectura y escritura EN LOTE de lo que la app sincroniza: las columnas que
 * eligió (sólo esas), de hasta 100 entradas, términos o medios por pedido.
 * Nunca se devuelve el contenido de una entrada: de él sólo sale el número de
 * palabras.
 *
 * Cada objeto se chequea con los permisos de WordPress del usuario conectado
 * (`edit_post`, `edit_term`): lo que no puede editar no se lee ni se escribe.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class IBC_Items {

	const KINDS = array( 'post_type', 'taxonomy', 'media' );

	/** Tipos de contenido que la app ofrece (los mismos que ve en la API REST). */
	public static function post_types() {
		$out = array();
		foreach ( get_post_types( array( 'show_in_rest' => true ), 'objects' ) as $pt ) {
			if ( in_array( $pt->name, array( 'attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face' ), true ) ) {
				continue;
			}
			$out[] = $pt;
		}
		return $out;
	}

	public static function taxonomies() {
		$out = array();
		foreach ( get_taxonomies( array( 'show_in_rest' => true ), 'objects' ) as $tax ) {
			if ( in_array( $tax->name, array( 'nav_menu', 'wp_pattern_category', 'link_category', 'post_format', 'wp_theme', 'wp_template_part_area' ), true ) || ! $tax->show_ui ) {
				continue;
			}
			$out[] = $tax;
		}
		return $out;
	}

	/** Las columnas extra que da el complemento, por tipo de objeto. */
	public static function schema() {
		$objects = array();
		foreach ( self::post_types() as $pt ) {
			$cols = IBC_SEO::columns( 'post_type' );
			if ( post_type_supports( $pt->name, 'editor' ) ) {
				$cols[] = IBC_Util::column(
					'plugin:words',
					__( 'Palabras', 'imagina-base-connector' ),
					'number',
					array(
						'provider' => 'plugin',
						'group'    => 'seo',
						'hint'     => __( 'Cuántas palabras tiene el contenido (sin traer el contenido).', 'imagina-base-connector' ),
					)
				);
			}
			$cols      = array_merge( $cols, IBC_Fields::columns( 'post_type', $pt->name ) );
			$objects[] = array(
				'kind'    => 'post_type',
				'object'  => $pt->name,
				'columns' => $cols,
			);
		}
		foreach ( self::taxonomies() as $tax ) {
			$objects[] = array(
				'kind'    => 'taxonomy',
				'object'  => $tax->name,
				'columns' => array_merge( IBC_SEO::columns( 'taxonomy' ), IBC_Fields::columns( 'taxonomy', $tax->name ) ),
			);
		}
		$objects[] = array(
			'kind'    => 'media',
			'object'  => 'attachment',
			'columns' => array(
				IBC_Util::column(
					'plugin:used_in',
					__( 'Dónde se usa', 'imagina-base-connector' ),
					'long_text',
					array(
						'provider' => 'plugin',
						'hint'     => __( 'Las entradas y páginas que la muestran (como imagen destacada o dentro del contenido).', 'imagina-base-connector' ),
					)
				),
				IBC_Util::column(
					'plugin:used_count',
					__( 'Veces usada', 'imagina-base-connector' ),
					'number',
					array(
						'provider' => 'plugin',
						'hint'     => __( '0 = no la usa ninguna entrada ni página.', 'imagina-base-connector' ),
					)
				),
			),
		);
		return $objects;
	}

	private static function load( $kind, $object, $id ) {
		if ( 'taxonomy' === $kind ) {
			$t = get_term( $id, $object );
			return $t instanceof WP_Term ? $t : null;
		}
		$p = get_post( $id );
		if ( ! $p instanceof WP_Post ) {
			return null;
		}
		if ( 'media' === $kind ) {
			return 'attachment' === $p->post_type ? $p : null;
		}
		return $p->post_type === $object ? $p : null;
	}

	private static function can_edit( $kind, $item ) {
		return 'taxonomy' === $kind ? current_user_can( 'edit_term', $item->term_id ) : current_user_can( 'edit_post', $item->ID );
	}

	/**
	 * `{ items: { id: { clave: valor } }, skipped: [ids] }`. `skipped` = no
	 * existe o el usuario conectado no puede editarlo.
	 */
	public static function read( $kind, $object, array $ids, array $keys ) {
		$items   = array();
		$skipped = array();
		$seo     = array();
		$fields  = array();
		$plugin  = array();
		foreach ( $keys as $k ) {
			if ( 0 === strpos( $k, 'seo:' ) ) {
				$seo[] = $k;
			} elseif ( 0 === strpos( $k, 'cf:' ) ) {
				$fields[] = $k;
			} elseif ( 0 === strpos( $k, 'plugin:' ) ) {
				$plugin[] = $k;
			}
		}
		$loaded = array();
		foreach ( $ids as $id ) {
			$item = self::load( $kind, $object, $id );
			if ( ! $item || ! self::can_edit( $kind, $item ) ) {
				$skipped[] = $id;
				continue;
			}
			$loaded[ $id ] = $item;
		}
		$usage = ( 'media' === $kind && ! empty( $plugin ) ) ? self::media_usage( array_keys( $loaded ) ) : array();
		foreach ( $loaded as $id => $item ) {
			$values = array();
			if ( ! empty( $seo ) && 'media' !== $kind ) {
				$all = IBC_SEO::read( $item );
				foreach ( $seo as $k ) {
					$values[ $k ] = array_key_exists( $k, $all ) ? $all[ $k ] : null;
				}
			}
			if ( ! empty( $fields ) && 'media' !== $kind ) {
				$values = array_merge( $values, IBC_Fields::read( $kind, $item, $object, $fields ) );
			}
			foreach ( $plugin as $k ) {
				if ( 'plugin:words' === $k && $item instanceof WP_Post ) {
					$values[ $k ] = IBC_Util::word_count( $item->post_content );
				} elseif ( 'plugin:used_in' === $k ) {
					$titles       = isset( $usage[ $id ] ) ? array_values( $usage[ $id ] ) : array();
					$shown        = array_slice( $titles, 0, 10 );
					$more         = count( $titles ) - count( $shown );
					$values[ $k ] = empty( $shown ) ? null : implode( ', ', $shown ) . ( $more > 0 ? sprintf( __( ' y %d más', 'imagina-base-connector' ), $more ) : '' );
				} elseif ( 'plugin:used_count' === $k ) {
					$values[ $k ] = isset( $usage[ $id ] ) ? count( $usage[ $id ] ) : 0;
				}
			}
			$items[ (string) $id ] = (object) $values;
		}
		return array(
			'items'   => (object) $items,
			'skipped' => $skipped,
		);
	}

	/**
	 * `{ items: [ { id, ok, errors: { clave: motivo } } ] }`. Lo que se pudo se
	 * guarda aunque otra columna del mismo objeto falle (cada una con su motivo).
	 */
	public static function write( $kind, $object, array $rows ) {
		$out = array();
		foreach ( $rows as $row ) {
			$id     = isset( $row['id'] ) ? (int) $row['id'] : 0;
			$values = isset( $row['values'] ) && is_array( $row['values'] ) ? $row['values'] : array();
			$item   = $id > 0 ? self::load( $kind, $object, $id ) : null;
			if ( ! $item ) {
				$out[] = array( 'id' => $id, 'ok' => false, 'errors' => array( '*' => __( 'Ya no existe en el sitio.', 'imagina-base-connector' ) ) );
				continue;
			}
			if ( ! self::can_edit( $kind, $item ) ) {
				$out[] = array( 'id' => $id, 'ok' => false, 'errors' => array( '*' => __( 'El usuario conectado no puede editarlo en WordPress.', 'imagina-base-connector' ) ) );
				continue;
			}
			$seo    = array();
			$fields = array();
			$errors = array();
			foreach ( $values as $key => $value ) {
				if ( ! IBC_Util::valid_key( $key ) ) {
					continue;
				}
				if ( 0 === strpos( $key, 'seo:' ) && 'media' !== $kind ) {
					$seo[ $key ] = $value;
				} elseif ( 0 === strpos( $key, 'cf:' ) && 'media' !== $kind ) {
					$fields[ $key ] = $value;
				} else {
					$errors[ $key ] = __( 'Lo calcula WordPress: no se escribe.', 'imagina-base-connector' );
				}
			}
			if ( ! empty( $seo ) ) {
				$errors = array_merge( $errors, IBC_SEO::write( $item, $seo ) );
			}
			if ( ! empty( $fields ) ) {
				$errors = array_merge( $errors, IBC_Fields::write( $kind, $item, $object, $fields ) );
			}
			// Los plugins de caché vacían la página al limpiar la caché del objeto.
			if ( $item instanceof WP_Term ) {
				clean_term_cache( $item->term_id, $item->taxonomy );
			} else {
				clean_post_cache( $item->ID );
			}
			$out[] = array(
				'id'     => $id,
				'ok'     => empty( $errors ),
				'errors' => (object) $errors,
			);
		}
		return array( 'items' => $out );
	}

	/**
	 * Dónde se usa cada imagen: como imagen destacada o dentro del contenido
	 * (la clase `wp-image-N` del editor clásico y el `"id":N` del bloque).
	 * `id del medio => [id de la entrada => título]`.
	 */
	public static function media_usage( array $ids ) {
		global $wpdb;
		$ids   = IBC_Util::ids( $ids );
		$usage = array();
		if ( empty( $ids ) ) {
			return $usage;
		}
		$in       = implode( ',', array_map( 'intval', $ids ) );
		$statuses = "'publish','future','draft','pending','private'";
		$found    = array();
		$rows     = $wpdb->get_results( "SELECT pm.post_id AS post_id, pm.meta_value AS media_id FROM {$wpdb->postmeta} pm INNER JOIN {$wpdb->posts} p ON p.ID = pm.post_id WHERE pm.meta_key = '_thumbnail_id' AND pm.meta_value IN ({$in}) AND p.post_status IN ({$statuses})" ); // phpcs:ignore WordPress.DB.PreparedSQL
		foreach ( (array) $rows as $r ) {
			$found[ (int) $r->media_id ][ (int) $r->post_id ] = true;
		}
		$likes = array();
		foreach ( $ids as $id ) {
			$likes[] = $wpdb->prepare( 'post_content LIKE %s', '%wp-image-' . $id . '%' );
			$likes[] = $wpdb->prepare( 'post_content LIKE %s', '%"id":' . $id . '%' );
		}
		$types = "'revision','attachment','nav_menu_item','customize_changeset','oembed_cache','wp_global_styles'";
		$rows  = $wpdb->get_results( "SELECT ID, post_content FROM {$wpdb->posts} WHERE post_type NOT IN ({$types}) AND post_status IN ({$statuses}) AND (" . implode( ' OR ', $likes ) . ') LIMIT 5000' ); // phpcs:ignore WordPress.DB.PreparedSQL
		foreach ( (array) $rows as $r ) {
			foreach ( $ids as $id ) {
				if ( preg_match( '/wp-image-' . $id . '(?!\d)|"id":' . $id . '(?!\d)/', (string) $r->post_content ) ) {
					$found[ $id ][ (int) $r->ID ] = true;
				}
			}
		}
		foreach ( $found as $media_id => $posts ) {
			foreach ( array_keys( $posts ) as $pid ) {
				$title = get_the_title( $pid );
				$usage[ $media_id ][ $pid ] = '' !== $title ? html_entity_decode( $title, ENT_QUOTES, 'UTF-8' ) : sprintf( '#%d', $pid );
			}
		}
		return $usage;
	}
}
