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

class ImaginaBC_Items {

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

	/** Los nombres de los tipos que se pueden leer y escribir (lo de WordPress por dentro, no). */
	public static function post_type_names() {
		return wp_list_pluck( self::post_types(), 'name' );
	}

	public static function taxonomy_names() {
		return wp_list_pluck( self::taxonomies(), 'name' );
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
	public static function schema( $fresh = false ) {
		$objects = array();
		foreach ( self::post_types() as $pt ) {
			$cols = ImaginaBC_SEO::columns( 'post_type' );
			if ( post_type_supports( $pt->name, 'editor' ) ) {
				$cols[] = ImaginaBC_Util::column(
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
			$cols      = array_merge( $cols, ImaginaBC_Fields::columns( 'post_type', $pt->name, $fresh ) );
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
				'columns' => array_merge( ImaginaBC_SEO::columns( 'taxonomy' ), ImaginaBC_Fields::columns( 'taxonomy', $tax->name, $fresh ) ),
			);
		}
		$objects[] = array(
			'kind'    => 'media',
			'object'  => 'attachment',
			'columns' => array(
				ImaginaBC_Util::column(
					'plugin:used_in',
					__( 'Dónde se usa', 'imagina-base-connector' ),
					'long_text',
					array(
						'provider' => 'plugin',
						'hint'     => __( 'Las entradas y páginas que la muestran (como imagen destacada o dentro del contenido).', 'imagina-base-connector' ),
					)
				),
				ImaginaBC_Util::column(
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
		// Todo lo que se va a leer, en una consulta (no una por objeto).
		if ( 'taxonomy' === $kind ) {
			ImaginaBC_Util::prime_terms( $ids );
		} else {
			ImaginaBC_Util::prime_posts( $ids );
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
		$usage = array();
		$index = null;
		if ( 'media' === $kind && ! empty( $plugin ) ) {
			ImaginaBC_Media_Index::start();
			// La primera vez se adelanta un poco del armado en este mismo pedido (sitios chicos quedan listos ya).
			if ( ! ImaginaBC_Media_Index::ready() ) {
				ImaginaBC_Media_Index::build( 3 );
			}
			$usage = ImaginaBC_Media_Index::usage( array_keys( $loaded ) );
			if ( null === $usage ) {
				$index = ImaginaBC_Media_Index::public_state();
			}
		}
		foreach ( $loaded as $id => $item ) {
			$values = array();
			if ( ! empty( $seo ) && 'media' !== $kind ) {
				$all = ImaginaBC_SEO::read( $item );
				foreach ( $seo as $k ) {
					$values[ $k ] = array_key_exists( $k, $all ) ? $all[ $k ] : null;
				}
			}
			if ( ! empty( $fields ) && 'media' !== $kind ) {
				$values = array_merge( $values, ImaginaBC_Fields::read( $kind, $item, $object, $fields ) );
			}
			foreach ( $plugin as $k ) {
				if ( 'plugin:words' === $k && $item instanceof WP_Post ) {
					$values[ $k ] = ImaginaBC_Util::word_count( $item->post_content );
				} elseif ( 'plugin:used_in' === $k && null !== $usage ) {
					$shown        = isset( $usage[ $id ] ) ? $usage[ $id ]['titles'] : array();
					$more         = isset( $usage[ $id ] ) ? $usage[ $id ]['count'] - count( $shown ) : 0;
					$values[ $k ] = empty( $shown ) ? null : implode( ', ', $shown ) . ( $more > 0 ? sprintf(
						/* translators: %d: cuántas entradas más usan la imagen */
						__( ' y %d más', 'imagina-base-connector' ),
						$more
					) : '' );
				} elseif ( 'plugin:used_count' === $k && null !== $usage ) {
					$values[ $k ] = isset( $usage[ $id ] ) ? (int) $usage[ $id ]['count'] : 0;
				}
			}
			$items[ (string) $id ] = (object) $values;
		}
		$out = array(
			'items'   => (object) $items,
			'skipped' => $skipped,
		);
		if ( null !== $index ) {
			// «Dónde se usa» todavía se está calculando: esas columnas no vienen (la app vuelve a leerlas al terminar).
			$out['media_index'] = $index;
		}
		return $out;
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
				if ( ! ImaginaBC_Util::valid_key( $key ) ) {
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
			try {
				if ( ! empty( $seo ) ) {
					$errors = array_merge( $errors, ImaginaBC_SEO::write( $item, $seo ) );
				}
				if ( ! empty( $fields ) ) {
					$errors = array_merge( $errors, ImaginaBC_Fields::write( $kind, $item, $object, $fields ) );
				}
			} catch ( \Throwable $e ) {
				$errors['*'] = sprintf(
					/* translators: %s: el error que dio WordPress o un plugin */
					__( 'WordPress no lo guardó: %s', 'imagina-base-connector' ),
					$e->getMessage()
				);
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
}
