<?php
/**
 * Campos personalizados con su TIPO: Advanced Custom Fields (todos sus campos,
 * también los que no tienen «Mostrar en la API REST»), Meta Box, JetEngine y
 * los metadatos sueltos que otros plugins guardan en la entrada o el término.
 *
 * Cada campo es una columna `cf:<proveedor>.<nombre>`:
 *  - `cf:acf.precio`  → ACF (se lee y escribe con `get_field`/`update_field`)
 *  - `cf:mb.precio`   → Meta Box (`rwmb_get_value`/`rwmb_set_meta`)
 *  - `cf:je.precio`   → JetEngine (metadatos con su formato)
 *  - `cf:meta.clave`  → metadato suelto (texto)
 *
 * Lo que tiene varias partes (un repetidor, una galería, una relación con
 * otras entradas) se trae como texto y NO se edita: no hay forma segura de
 * escribirlo desde una celda.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_Fields {

	/** Tipos de ACF que no guardan un valor (pestañas, mensajes). */
	const ACF_SKIP = array( 'message', 'tab', 'accordion', 'password', 'separator' );

	/** @var array<string, array> cache por objeto */
	private static $defs = array();

	public static function providers() {
		return array(
			'acf'       => function_exists( 'acf_get_field_groups' ) && function_exists( 'acf_get_fields' ),
			'metabox'   => function_exists( 'rwmb_get_registry' ) && function_exists( 'rwmb_get_value' ),
			'jetengine' => self::jet_available(),
		);
	}

	private static function jet_available() {
		return function_exists( 'jet_engine' ) && is_object( jet_engine() ) && isset( jet_engine()->meta_boxes ) && method_exists( jet_engine()->meta_boxes, 'get_meta_fields_for_object' );
	}

	/**
	 * Las definiciones de un tipo de objeto: `clave => [col, provider, name, raw]`.
	 * `$kind`: `post_type` | `taxonomy`.
	 *
	 * `$keys` = sólo lo necesario para esas columnas (al leer y escribir): un
	 * pedido con campos de ACF no pregunta por Meta Box ni por los metadatos
	 * sueltos. `$fresh` = no usar el descubrimiento guardado (el asistente).
	 */
	public static function defs( $kind, $object, $keys = null, $fresh = false ) {
		$want = array(
			'acf'  => true,
			'mb'   => true,
			'je'   => true,
			'meta' => true,
		);
		if ( is_array( $keys ) ) {
			foreach ( $want as $p => $_ ) {
				$want[ $p ] = false;
			}
			foreach ( $keys as $k ) {
				if ( preg_match( '/^cf:(acf|mb|je|meta)\./', (string) $k, $m ) ) {
					$want[ $m[1] ] = true;
				}
			}
		}
		$cache = $kind . ':' . $object . ':' . implode( '', array_map( 'intval', $want ) ) . ( $fresh ? ':f' : '' );
		if ( isset( self::$defs[ $cache ] ) ) {
			return self::$defs[ $cache ];
		}
		$out = array();
		if ( $want['acf'] || $want['meta'] ) {
			// Los nombres de ACF también hacen falta para no repetirlos como metadatos sueltos.
			foreach ( self::acf_defs( $kind, $object ) as $d ) {
				$out[ $d['col']['key'] ] = $d;
			}
		}
		if ( $want['mb'] || $want['meta'] ) {
			foreach ( self::metabox_defs( $kind, $object ) as $d ) {
				$out[ $d['col']['key'] ] = $d;
			}
		}
		if ( $want['je'] || $want['meta'] ) {
			foreach ( self::jet_defs( $kind, $object ) as $d ) {
				$out[ $d['col']['key'] ] = $d;
			}
		}
		if ( $want['meta'] ) {
			$taken = array();
			foreach ( $out as $d ) {
				$taken[ $d['name'] ] = true;
			}
			foreach ( self::loose_meta_defs( $kind, $object, $taken, $fresh ) as $d ) {
				$out[ $d['col']['key'] ] = $d;
			}
		}
		self::$defs[ $cache ] = $out;
		return $out;
	}

	public static function columns( $kind, $object, $fresh = false ) {
		$cols = array();
		foreach ( self::defs( $kind, $object, null, $fresh ) as $d ) {
			$cols[] = $d['col'];
		}
		return $cols;
	}

	// ── ACF ──────────────────────────────────────────────────────────────────

	private static function acf_defs( $kind, $object ) {
		$p = self::providers();
		if ( ! $p['acf'] ) {
			return array();
		}
		$filter = 'taxonomy' === $kind ? array( 'taxonomy' => $object ) : array( 'post_type' => $object );
		$out    = array();
		foreach ( (array) acf_get_field_groups( $filter ) as $group ) {
			foreach ( (array) acf_get_fields( $group ) as $f ) {
				if ( empty( $f['name'] ) || in_array( $f['type'], self::ACF_SKIP, true ) ) {
					continue;
				}
				$key = 'cf:acf.' . $f['name'];
				if ( ! ImaginaBC_Util::valid_key( $key ) ) {
					continue;
				}
				list( $type, $editable, $extra ) = self::acf_shape( $f );
				$hint = $editable ? null : __( 'Tiene varias partes o apunta a otros contenidos: se trae como texto y se edita en WordPress.', 'imagina-base-connector' );
				if ( 'wysiwyg' === $f['type'] ) {
					$hint = __( 'Es un texto con formato: se trae sin el formato y se edita en WordPress.', 'imagina-base-connector' );
				}
				$out[] = array(
					'col'      => ImaginaBC_Util::column(
						$key,
						! empty( $f['label'] ) ? $f['label'] : ImaginaBC_Util::humanize( $f['name'] ),
						$type,
						array_merge(
							array(
								'provider' => 'acf',
								'editable' => $editable,
								'hint'     => $hint,
								'group'    => isset( $group['title'] ) ? $group['title'] : null,
							),
							$extra
						)
					),
					'provider' => 'acf',
					'name'     => $f['name'],
					'raw'      => $f,
				);
			}
		}
		return $out;
	}

	/** Tipo de ACF → tipo de la app, si se edita desde la app y opciones/imagen. */
	private static function acf_shape( array $f ) {
		switch ( $f['type'] ) {
			case 'text':
			case 'email':
			case 'color_picker':
			case 'time_picker':
				return array( 'text', true, array() );
			case 'textarea':
				return array( 'long_text', true, array() );
			case 'wysiwyg':
				return array( 'long_text', false, array() );
			case 'number':
			case 'range':
				return array( 'number', true, array() );
			case 'url':
			case 'oembed':
				return array( 'url', true, array() );
			case 'page_link':
			case 'link':
			case 'file':
				return array( 'url', false, array() );
			case 'image':
				return array( 'url', false, array( 'image' => true ) );
			case 'true_false':
				return array( 'checkbox', true, array() );
			case 'select':
				$multi = ! empty( $f['multiple'] );
				return array( $multi ? 'multi_select' : 'select', true, array( 'options' => ImaginaBC_Util::options( isset( $f['choices'] ) ? $f['choices'] : array() ) ) );
			case 'radio':
			case 'button_group':
				return array( 'select', true, array( 'options' => ImaginaBC_Util::options( isset( $f['choices'] ) ? $f['choices'] : array() ) ) );
			case 'checkbox':
				return array( 'multi_select', true, array( 'options' => ImaginaBC_Util::options( isset( $f['choices'] ) ? $f['choices'] : array() ) ) );
			case 'date_picker':
				return array( 'date', true, array() );
			case 'date_time_picker':
				return array( 'datetime', true, array() );
			case 'post_object':
			case 'relationship':
			case 'taxonomy':
			case 'user':
			case 'google_map':
			case 'icon_picker':
				return array( 'text', false, array() );
			default:
				// repeater, group, flexible_content, clone, gallery y tipos de otros plugins.
				return array( 'long_text', false, array() );
		}
	}

	private static function acf_id( $object ) {
		return $object instanceof WP_Term ? 'term_' . $object->term_id : (int) $object->ID;
	}

	private static function acf_read( array $f, $object ) {
		$id  = self::acf_id( $object );
		$raw = get_field( $f['key'], $id, false );
		switch ( $f['type'] ) {
			case 'true_false':
				return ImaginaBC_Util::to_bool( $raw );
			case 'number':
			case 'range':
				return ImaginaBC_Util::to_number( $raw );
			case 'select':
			case 'checkbox':
			case 'radio':
			case 'button_group':
				if ( ( 'select' === $f['type'] && empty( $f['multiple'] ) ) || in_array( $f['type'], array( 'radio', 'button_group' ), true ) ) {
					$v = is_array( $raw ) ? reset( $raw ) : $raw;
					return null === $v || '' === $v || false === $v ? null : (string) $v;
				}
				return array_values( array_map( 'strval', array_filter( (array) $raw, 'strlen' ) ) );
			case 'date_picker':
				return ImaginaBC_Util::to_date( $raw );
			case 'date_time_picker':
				return ImaginaBC_Util::local_to_iso( $raw );
			case 'image':
				$url = is_numeric( $raw ) ? wp_get_attachment_image_url( (int) $raw, 'medium' ) : ( is_string( $raw ) ? $raw : '' );
				return $url ? $url : null;
			case 'file':
				$url = is_numeric( $raw ) ? wp_get_attachment_url( (int) $raw ) : ( is_string( $raw ) ? $raw : '' );
				return $url ? $url : null;
			case 'link':
				if ( is_array( $raw ) ) {
					return ! empty( $raw['url'] ) ? (string) $raw['url'] : null;
				}
				return is_string( $raw ) && '' !== $raw ? $raw : null;
			case 'page_link':
				$v = is_array( $raw ) ? reset( $raw ) : $raw;
				return is_numeric( $v ) ? get_permalink( (int) $v ) : ( is_string( $v ) && '' !== $v ? $v : null );
			case 'post_object':
			case 'relationship':
				$titles = array();
				foreach ( array_slice( array_filter( (array) $raw ), 0, 30 ) as $pid ) {
					$t = get_the_title( (int) $pid );
					if ( '' !== $t ) {
						$titles[] = html_entity_decode( $t, ENT_QUOTES, 'UTF-8' );
					}
				}
				return empty( $titles ) ? null : implode( ', ', $titles );
			case 'taxonomy':
				$names = array();
				foreach ( array_slice( array_filter( (array) $raw ), 0, 30 ) as $tid ) {
					$t = get_term( (int) $tid );
					if ( $t && ! is_wp_error( $t ) ) {
						$names[] = html_entity_decode( $t->name, ENT_QUOTES, 'UTF-8' );
					}
				}
				return empty( $names ) ? null : implode( ', ', $names );
			case 'user':
				$names = array();
				foreach ( array_slice( array_filter( (array) $raw ), 0, 30 ) as $uid ) {
					$u = get_userdata( (int) $uid );
					if ( $u ) {
						$names[] = $u->display_name;
					}
				}
				return empty( $names ) ? null : implode( ', ', $names );
			case 'google_map':
				return is_array( $raw ) && ! empty( $raw['address'] ) ? (string) $raw['address'] : null;
			case 'gallery':
				$urls = array();
				foreach ( array_slice( array_filter( (array) $raw ), 0, 30 ) as $aid ) {
					$u = wp_get_attachment_url( (int) $aid );
					if ( $u ) {
						$urls[] = $u;
					}
				}
				return empty( $urls ) ? null : implode( "\n", $urls );
			case 'wysiwyg':
				return '' === trim( (string) $raw ) ? null : ImaginaBC_Util::plain( $raw );
			case 'text':
			case 'email':
			case 'textarea':
			case 'url':
			case 'oembed':
			case 'color_picker':
			case 'time_picker':
				return null === $raw || '' === $raw || false === $raw ? null : (string) $raw;
			default:
				$formatted = get_field( $f['key'], $id, true );
				if ( null === $formatted || '' === $formatted || false === $formatted || array() === $formatted ) {
					return null;
				}
				return ImaginaBC_Util::plain( is_scalar( $formatted ) ? $formatted : self::summarize( $formatted ) );
		}
	}

	/** Un repetidor o un grupo, legible y corto (sin objetos enteros de WordPress). */
	private static function summarize( $value ) {
		if ( $value instanceof WP_Post ) {
			return get_the_title( $value );
		}
		if ( $value instanceof WP_Term ) {
			return $value->name;
		}
		if ( is_array( $value ) ) {
			if ( isset( $value['url'] ) && is_string( $value['url'] ) ) {
				return $value['url'];
			}
			$out = array();
			foreach ( $value as $k => $v ) {
				$out[ $k ] = is_scalar( $v ) || null === $v ? $v : self::summarize( $v );
			}
			return $out;
		}
		return is_object( $value ) ? null : $value;
	}

	/** Valor de la app → lo que guarda ACF. `WP_Error` = no se puede. */
	private static function acf_value( array $f, $value ) {
		$empty = null === $value || ( is_string( $value ) && '' === trim( $value ) ) || ( is_array( $value ) && empty( $value ) );
		switch ( $f['type'] ) {
			case 'true_false':
				return ImaginaBC_Util::to_bool( $value ) ? 1 : 0;
			case 'number':
			case 'range':
				if ( $empty ) {
					return '';
				}
				$n = ImaginaBC_Util::to_number( $value );
				if ( null === $n ) {
					return new WP_Error( 'ibc_number', __( 'Tiene que ser un número.', 'imagina-base-connector' ) );
				}
				if ( isset( $f['min'] ) && '' !== $f['min'] && $n < (float) $f['min'] ) {
					return new WP_Error( 'ibc_min', sprintf( /* translators: el valor mínimo del campo */ __( 'El mínimo es %s.', 'imagina-base-connector' ), $f['min'] ) );
				}
				if ( isset( $f['max'] ) && '' !== $f['max'] && $n > (float) $f['max'] ) {
					return new WP_Error( 'ibc_max', sprintf( /* translators: el valor máximo del campo */ __( 'El máximo es %s.', 'imagina-base-connector' ), $f['max'] ) );
				}
				return $n;
			case 'select':
			case 'radio':
			case 'button_group':
			case 'checkbox':
				$choices = array_map( 'strval', array_keys( isset( $f['choices'] ) ? (array) $f['choices'] : array() ) );
				$multi   = 'checkbox' === $f['type'] || ( 'select' === $f['type'] && ! empty( $f['multiple'] ) );
				$values  = $empty ? array() : array_map( 'strval', (array) $value );
				foreach ( $values as $v ) {
					if ( ! empty( $choices ) && ! in_array( $v, $choices, true ) ) {
						return new WP_Error( 'ibc_choice', sprintf( /* translators: el valor que se quiso guardar */ __( '«%s» no es una de las opciones del campo en WordPress.', 'imagina-base-connector' ), $v ) );
					}
				}
				return $multi ? $values : ( empty( $values ) ? '' : $values[0] );
			case 'date_picker':
				if ( $empty ) {
					return '';
				}
				$d = ImaginaBC_Util::to_date( $value );
				return $d ? str_replace( '-', '', $d ) : new WP_Error( 'ibc_date', __( 'La fecha no es válida.', 'imagina-base-connector' ) );
			case 'date_time_picker':
				if ( $empty ) {
					return '';
				}
				$local = ImaginaBC_Util::iso_to_local( $value );
				return $local ? $local : new WP_Error( 'ibc_datetime', __( 'La fecha y hora no es válida.', 'imagina-base-connector' ) );
			case 'email':
				if ( $empty ) {
					return '';
				}
				$e = sanitize_email( (string) $value );
				return is_email( $e ) ? $e : new WP_Error( 'ibc_email', __( 'El correo no es válido.', 'imagina-base-connector' ) );
			case 'url':
			case 'oembed':
				if ( $empty ) {
					return '';
				}
				$u = esc_url_raw( trim( (string) $value ), array( 'http', 'https' ) );
				return '' !== $u ? $u : new WP_Error( 'ibc_url', __( 'Tiene que ser una dirección web completa (https://…).', 'imagina-base-connector' ) );
			case 'textarea':
				return $empty ? '' : sanitize_textarea_field( (string) $value );
			case 'color_picker':
				if ( $empty ) {
					return '';
				}
				$c = sanitize_hex_color( (string) $value );
				return $c ? $c : new WP_Error( 'ibc_color', __( 'El color tiene que ser un código como #1a2b3c.', 'imagina-base-connector' ) );
			case 'text':
			case 'time_picker':
				if ( ! $empty && isset( $f['maxlength'] ) && (int) $f['maxlength'] > 0 && mb_strlen( (string) $value ) > (int) $f['maxlength'] ) {
					return new WP_Error( 'ibc_maxlength', sprintf( /* translators: cantidad máxima de caracteres */ __( 'Admite hasta %d caracteres.', 'imagina-base-connector' ), (int) $f['maxlength'] ) );
				}
				return $empty ? '' : sanitize_text_field( (string) $value );
			default:
				return new WP_Error( 'ibc_readonly', __( 'Este campo se edita en WordPress.', 'imagina-base-connector' ) );
		}
	}

	// ── Meta Box ─────────────────────────────────────────────────────────────

	private static function metabox_defs( $kind, $object ) {
		$p = self::providers();
		if ( ! $p['metabox'] ) {
			return array();
		}
		$registry = rwmb_get_registry( 'meta_box' );
		if ( ! $registry || ! method_exists( $registry, 'all' ) ) {
			return array();
		}
		$out = array();
		foreach ( $registry->all() as $mb ) {
			$type = method_exists( $mb, 'get_object_type' ) ? $mb->get_object_type() : 'post';
			$box  = isset( $mb->meta_box ) && is_array( $mb->meta_box ) ? $mb->meta_box : array();
			if ( 'taxonomy' === $kind ) {
				if ( 'term' !== $type || ! in_array( $object, (array) ( isset( $box['taxonomies'] ) ? $box['taxonomies'] : array() ), true ) ) {
					continue;
				}
			} elseif ( 'post' !== $type || ! in_array( $object, (array) ( isset( $box['post_types'] ) ? $box['post_types'] : array( 'post' ) ), true ) ) {
				continue;
			}
			foreach ( (array) ( isset( $box['fields'] ) ? $box['fields'] : array() ) as $f ) {
				if ( empty( $f['id'] ) || empty( $f['type'] ) || in_array( $f['type'], array( 'heading', 'divider', 'custom_html', 'button', 'tab' ), true ) ) {
					continue;
				}
				$key = 'cf:mb.' . $f['id'];
				if ( ! ImaginaBC_Util::valid_key( $key ) ) {
					continue;
				}
				list( $t, $editable, $extra ) = self::metabox_shape( $f );
				$out[] = array(
					'col'      => ImaginaBC_Util::column(
						$key,
						! empty( $f['name'] ) ? wp_strip_all_tags( $f['name'] ) : ImaginaBC_Util::humanize( $f['id'] ),
						$t,
						array_merge(
							array(
								'provider' => 'metabox',
								'editable' => $editable,
								'hint'     => $editable ? null : __( 'Tiene varias partes o apunta a otros contenidos: se trae como texto y se edita en WordPress.', 'imagina-base-connector' ),
								'group'    => isset( $box['title'] ) ? $box['title'] : null,
							),
							$extra
						)
					),
					'provider' => 'metabox',
					'name'     => $f['id'],
					'raw'      => $f,
				);
			}
		}
		return $out;
	}

	private static function metabox_shape( array $f ) {
		if ( ! empty( $f['clone'] ) ) {
			return array( 'long_text', false, array() );
		}
		switch ( $f['type'] ) {
			case 'text':
			case 'email':
			case 'color':
			case 'time':
			case 'tel':
				return array( 'text', true, array() );
			case 'textarea':
				return array( 'long_text', true, array() );
			case 'number':
			case 'range':
			case 'slider':
				return array( 'number', true, array() );
			case 'url':
			case 'oembed':
				return array( 'url', true, array() );
			case 'checkbox':
			case 'switch':
				return array( 'checkbox', true, array() );
			case 'select':
			case 'select_advanced':
			case 'radio':
			case 'button_group':
			case 'image_select':
				$multi = ! empty( $f['multiple'] );
				return array( $multi ? 'multi_select' : 'select', true, array( 'options' => ImaginaBC_Util::options( isset( $f['options'] ) ? $f['options'] : array() ) ) );
			case 'checkbox_list':
			case 'autocomplete':
				return array( 'multi_select', true, array( 'options' => ImaginaBC_Util::options( isset( $f['options'] ) ? $f['options'] : array() ) ) );
			case 'date':
				return array( 'date', empty( $f['timestamp'] ), array() );
			case 'datetime':
				return array( 'datetime', false, array() );
			case 'single_image':
			case 'image':
			case 'image_advanced':
			case 'image_upload':
				return array( 'url', false, array( 'image' => true ) );
			case 'file':
			case 'file_advanced':
			case 'file_upload':
			case 'file_input':
				return array( 'url', false, array() );
			default:
				return array( 'long_text', false, array() );
		}
	}

	private static function metabox_read( array $f, $object ) {
		$args = $object instanceof WP_Term ? array( 'object_type' => 'term' ) : array();
		$id   = $object instanceof WP_Term ? $object->term_id : $object->ID;
		$v    = rwmb_get_value( $f['id'], $args, $id );
		list( $type ) = self::metabox_shape( $f );
		switch ( $type ) {
			case 'checkbox':
				return ImaginaBC_Util::to_bool( $v );
			case 'number':
				return ImaginaBC_Util::to_number( $v );
			case 'select':
				$v = is_array( $v ) ? reset( $v ) : $v;
				return null === $v || '' === $v || false === $v ? null : (string) $v;
			case 'multi_select':
				return array_values( array_map( 'strval', array_filter( (array) $v, 'strlen' ) ) );
			case 'date':
				return is_numeric( $v ) && strlen( (string) $v ) >= 9 ? gmdate( 'Y-m-d', (int) $v ) : ImaginaBC_Util::to_date( $v );
			case 'datetime':
				return ImaginaBC_Util::local_to_iso( is_numeric( $v ) ? gmdate( 'Y-m-d H:i:s', (int) $v ) : $v );
			case 'url':
				if ( is_array( $v ) ) {
					$first = reset( $v );
					if ( is_array( $first ) && isset( $first['url'] ) ) {
						return (string) $first['url'];
					}
					return isset( $v['url'] ) ? (string) $v['url'] : null;
				}
				return is_string( $v ) && '' !== $v ? $v : null;
			default:
				if ( null === $v || '' === $v || false === $v || array() === $v ) {
					return null;
				}
				return ImaginaBC_Util::plain( is_scalar( $v ) ? $v : self::summarize( $v ) );
		}
	}

	private static function metabox_value( array $f, $value ) {
		list( $type, $editable ) = self::metabox_shape( $f );
		if ( ! $editable ) {
			return new WP_Error( 'ibc_readonly', __( 'Este campo se edita en WordPress.', 'imagina-base-connector' ) );
		}
		$empty = null === $value || ( is_string( $value ) && '' === trim( $value ) ) || ( is_array( $value ) && empty( $value ) );
		switch ( $type ) {
			case 'checkbox':
				return ImaginaBC_Util::to_bool( $value ) ? 1 : 0;
			case 'number':
				if ( $empty ) {
					return '';
				}
				$n = ImaginaBC_Util::to_number( $value );
				return null === $n ? new WP_Error( 'ibc_number', __( 'Tiene que ser un número.', 'imagina-base-connector' ) ) : $n;
			case 'select':
			case 'multi_select':
				$choices = array_map( 'strval', array_keys( isset( $f['options'] ) ? (array) $f['options'] : array() ) );
				$values  = $empty ? array() : array_map( 'strval', (array) $value );
				foreach ( $values as $v ) {
					if ( ! empty( $choices ) && ! in_array( $v, $choices, true ) ) {
						return new WP_Error( 'ibc_choice', sprintf( /* translators: el valor que se quiso guardar */ __( '«%s» no es una de las opciones del campo en WordPress.', 'imagina-base-connector' ), $v ) );
					}
				}
				return 'multi_select' === $type ? $values : ( empty( $values ) ? '' : $values[0] );
			case 'date':
				if ( $empty ) {
					return '';
				}
				$d = ImaginaBC_Util::to_date( $value );
				if ( ! $d ) {
					return new WP_Error( 'ibc_date', __( 'La fecha no es válida.', 'imagina-base-connector' ) );
				}
				$format = ! empty( $f['save_format'] ) ? $f['save_format'] : 'Y-m-d';
				return gmdate( $format, strtotime( $d . ' 00:00:00 UTC' ) );
			case 'url':
				if ( $empty ) {
					return '';
				}
				$u = esc_url_raw( trim( (string) $value ), array( 'http', 'https' ) );
				return '' !== $u ? $u : new WP_Error( 'ibc_url', __( 'Tiene que ser una dirección web completa (https://…).', 'imagina-base-connector' ) );
			case 'long_text':
				return $empty ? '' : sanitize_textarea_field( (string) $value );
			default:
				if ( 'email' === $f['type'] && ! $empty && ! is_email( (string) $value ) ) {
					return new WP_Error( 'ibc_email', __( 'El correo no es válido.', 'imagina-base-connector' ) );
				}
				return $empty ? '' : sanitize_text_field( (string) $value );
		}
	}

	// ── JetEngine ────────────────────────────────────────────────────────────

	private static function jet_defs( $kind, $object ) {
		if ( 'post_type' !== $kind || ! self::jet_available() ) {
			return array();
		}
		$fields = jet_engine()->meta_boxes->get_meta_fields_for_object( $object );
		$out    = array();
		foreach ( (array) $fields as $f ) {
			if ( ! is_array( $f ) || empty( $f['name'] ) || ( isset( $f['object_type'] ) && 'field' !== $f['object_type'] ) ) {
				continue;
			}
			$key = 'cf:je.' . $f['name'];
			if ( ! ImaginaBC_Util::valid_key( $key ) ) {
				continue;
			}
			list( $t, $editable, $extra ) = self::jet_shape( $f );
			$out[] = array(
				'col'      => ImaginaBC_Util::column(
					$key,
					! empty( $f['title'] ) ? $f['title'] : ImaginaBC_Util::humanize( $f['name'] ),
					$t,
					array_merge(
						array(
							'provider' => 'jetengine',
							'editable' => $editable,
							'hint'     => $editable ? null : __( 'Tiene varias partes o apunta a otros contenidos: se trae como texto y se edita en WordPress.', 'imagina-base-connector' ),
						),
						$extra
					)
				),
				'provider' => 'jetengine',
				'name'     => $f['name'],
				'raw'      => $f,
			);
		}
		return $out;
	}

	private static function jet_options( array $f ) {
		$opts = array();
		foreach ( (array) ( isset( $f['options'] ) ? $f['options'] : array() ) as $k => $o ) {
			if ( is_array( $o ) && isset( $o['key'] ) ) {
				$opts[ $o['key'] ] = isset( $o['value'] ) ? $o['value'] : $o['key'];
			} elseif ( is_scalar( $o ) ) {
				$opts[ $k ] = $o;
			}
		}
		return ImaginaBC_Util::options( $opts );
	}

	private static function jet_shape( array $f ) {
		switch ( isset( $f['type'] ) ? $f['type'] : 'text' ) {
			case 'text':
			case 'colorpicker':
			case 'time':
				return array( 'text', true, array() );
			case 'textarea':
				return array( 'long_text', true, array() );
			case 'wysiwyg':
				return array( 'long_text', false, array() );
			case 'number':
				return array( 'number', true, array() );
			case 'switcher':
				return array( 'checkbox', true, array() );
			case 'select':
			case 'radio':
				$multi = ! empty( $f['is_multiple'] );
				return array( $multi ? 'multi_select' : 'select', ! $multi, array( 'options' => self::jet_options( $f ) ) );
			case 'checkbox':
				return array( 'multi_select', false, array( 'options' => self::jet_options( $f ) ) );
			case 'date':
				return array( 'date', empty( $f['is_timestamp'] ), array() );
			case 'datetime-local':
				return array( 'datetime', false, array() );
			case 'media':
				return array( 'url', false, array( 'image' => true ) );
			default:
				return array( 'long_text', false, array() );
		}
	}

	private static function jet_read( array $f, $object ) {
		$v = get_post_meta( $object->ID, $f['name'], true );
		list( $type ) = self::jet_shape( $f );
		switch ( $type ) {
			case 'checkbox':
				return 'true' === $v || true === $v || '1' === (string) $v;
			case 'number':
				return ImaginaBC_Util::to_number( $v );
			case 'select':
				return '' === $v || null === $v ? null : (string) ( is_array( $v ) ? reset( $v ) : $v );
			case 'multi_select':
				if ( is_array( $v ) ) {
					$out = array();
					foreach ( $v as $k => $on ) {
						// El checkbox de JetEngine guarda `opción => 'true'|'false'`.
						if ( is_string( $k ) && ( 'true' === $on || true === $on ) ) {
							$out[] = $k;
						} elseif ( is_int( $k ) && is_scalar( $on ) ) {
							$out[] = (string) $on;
						}
					}
					return $out;
				}
				return '' === $v ? array() : array( (string) $v );
			case 'date':
				return is_numeric( $v ) && strlen( (string) $v ) >= 9 ? gmdate( 'Y-m-d', (int) $v ) : ImaginaBC_Util::to_date( $v );
			case 'datetime':
				return ImaginaBC_Util::local_to_iso( is_numeric( $v ) ? gmdate( 'Y-m-d H:i:s', (int) $v ) : $v );
			case 'url':
				$url = is_numeric( $v ) ? wp_get_attachment_url( (int) $v ) : ( is_array( $v ) && isset( $v['url'] ) ? $v['url'] : $v );
				return is_string( $url ) && '' !== $url ? $url : null;
			default:
				if ( '' === $v || null === $v || array() === $v ) {
					return null;
				}
				return ImaginaBC_Util::plain( is_scalar( $v ) ? $v : self::summarize( $v ) );
		}
	}

	private static function jet_value( array $f, $value ) {
		list( $type, $editable ) = self::jet_shape( $f );
		if ( ! $editable ) {
			return new WP_Error( 'ibc_readonly', __( 'Este campo se edita en WordPress.', 'imagina-base-connector' ) );
		}
		$empty = null === $value || ( is_string( $value ) && '' === trim( $value ) );
		switch ( $type ) {
			case 'checkbox':
				return ImaginaBC_Util::to_bool( $value ) ? 'true' : 'false';
			case 'number':
				if ( $empty ) {
					return '';
				}
				$n = ImaginaBC_Util::to_number( $value );
				return null === $n ? new WP_Error( 'ibc_number', __( 'Tiene que ser un número.', 'imagina-base-connector' ) ) : $n;
			case 'select':
				$choices = array();
				foreach ( self::jet_options( $f ) as $o ) {
					$choices[] = $o['value'];
				}
				$v = $empty ? '' : (string) ( is_array( $value ) ? reset( $value ) : $value );
				if ( '' !== $v && ! empty( $choices ) && ! in_array( $v, $choices, true ) ) {
					return new WP_Error( 'ibc_choice', sprintf( /* translators: el valor que se quiso guardar */ __( '«%s» no es una de las opciones del campo en WordPress.', 'imagina-base-connector' ), $v ) );
				}
				return $v;
			case 'date':
				if ( $empty ) {
					return '';
				}
				$d = ImaginaBC_Util::to_date( $value );
				return $d ? $d : new WP_Error( 'ibc_date', __( 'La fecha no es válida.', 'imagina-base-connector' ) );
			case 'long_text':
				return $empty ? '' : sanitize_textarea_field( (string) $value );
			default:
				return $empty ? '' : sanitize_text_field( (string) $value );
		}
	}

	// ── Metadatos sueltos ────────────────────────────────────────────────────

	/** Claves de otros plugins que ya tienen su propia columna (o son internas). */
	private static function owned_meta_key( $key ) {
		if ( 0 === strpos( $key, '_' ) || ImaginaBC_Util::sensitive_key( $key ) ) {
			return true;
		}
		foreach ( array( 'rank_math_', 'wpseo_', 'seopress_', 'aioseo_', '_yoast', 'imaginabc_', 'ibc_', 'footnotes', 'classic-editor-remember', 'inline_featured_image', 'ast-', 'site-sidebar-layout', 'site-content-layout', 'theme-transparent-header-meta', 'stick-header-meta' ) as $prefix ) {
			if ( 0 === strpos( $key, $prefix ) ) {
				return true;
			}
		}
		return false;
	}

	/** Cuántos objetos (los más nuevos) se miran para descubrir los metadatos sueltos. */
	const META_SAMPLE = 1000;

	/**
	 * Los metadatos que guardan otros plugins en este tipo de objeto. Se
	 * descubren mirando una MUESTRA (los 1.000 objetos más nuevos, no la tabla
	 * entera: en 1.0.0 esto recorría todos los metadatos del sitio en cada
	 * lectura) y el resultado se guarda 15 minutos.
	 */
	private static function loose_meta_rows( $kind, $object, $fresh ) {
		global $wpdb;
		$tkey = 'imaginabc_meta_' . md5( $kind . ':' . $object );
		if ( ! $fresh ) {
			$cached = get_transient( $tkey );
			if ( is_array( $cached ) ) {
				return $cached;
			}
		}
		if ( 'taxonomy' === $kind ) {
			$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- descubrimiento con muestra acotada y cacheado.
				$wpdb->prepare(
					"SELECT tm.meta_key AS k, COUNT(*) AS n, MAX(LEFT(tm.meta_value, 300)) AS sample FROM {$wpdb->termmeta} tm INNER JOIN (SELECT term_id FROM {$wpdb->term_taxonomy} WHERE taxonomy = %s ORDER BY term_id DESC LIMIT %d) s ON s.term_id = tm.term_id GROUP BY tm.meta_key ORDER BY n DESC LIMIT 80",
					$object,
					self::META_SAMPLE
				)
			);
		} else {
			$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- descubrimiento con muestra acotada y cacheado.
				$wpdb->prepare(
					"SELECT pm.meta_key AS k, COUNT(*) AS n, MAX(LEFT(pm.meta_value, 300)) AS sample FROM {$wpdb->postmeta} pm INNER JOIN (SELECT ID FROM {$wpdb->posts} WHERE post_type = %s ORDER BY ID DESC LIMIT %d) s ON s.ID = pm.post_id GROUP BY pm.meta_key ORDER BY n DESC LIMIT 80",
					$object,
					self::META_SAMPLE
				)
			);
		}
		$out = array();
		foreach ( (array) $rows as $r ) {
			$out[] = array(
				'k'      => (string) $r->k,
				'sample' => (string) $r->sample,
			);
		}
		set_transient( $tkey, $out, 15 * MINUTE_IN_SECONDS );
		return $out;
	}

	private static function loose_meta_defs( $kind, $object, array $taken, $fresh = false ) {
		$rows       = self::loose_meta_rows( $kind, $object, $fresh );
		$registered = array_keys( get_registered_meta_keys( 'taxonomy' === $kind ? 'term' : 'post', $object ) );
		$out        = array();
		foreach ( $rows as $r ) {
			$key = $r['k'];
			if ( isset( $taken[ $key ] ) || self::owned_meta_key( $key ) || in_array( $key, $registered, true ) ) {
				continue;
			}
			$col_key = 'cf:meta.' . $key;
			if ( ! ImaginaBC_Util::valid_key( $col_key ) ) {
				continue;
			}
			$sample     = $r['sample'];
			// La muestra viene recortada: se mira cómo EMPIEZA (no se exige que termine bien).
			$serialized = is_serialized( $sample, false );
			$type       = 'text';
			if ( $serialized ) {
				$type = 'long_text';
			} elseif ( is_numeric( $sample ) && strlen( $sample ) < 16 ) {
				$type = 'number';
			} elseif ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $sample ) ) {
				$type = 'date';
			} elseif ( preg_match( '/^https?:\/\/\S+$/i', $sample ) ) {
				$type = 'url';
			} elseif ( strlen( $sample ) > 120 || false !== strpos( $sample, "\n" ) ) {
				$type = 'long_text';
			}
			$out[] = array(
				'col'      => ImaginaBC_Util::column(
					$col_key,
					ImaginaBC_Util::humanize( $key ),
					$type,
					array(
						'provider' => 'meta',
						'editable' => ! $serialized,
						'hint'     => $serialized ? __( 'Tiene varias partes (lo guarda un plugin): se trae como texto y se edita en WordPress.', 'imagina-base-connector' ) : sprintf( /* translators: nombre del metadato */ __( 'Campo «%s» guardado por un plugin.', 'imagina-base-connector' ), $key ),
					)
				),
				'provider' => 'meta',
				'name'     => $key,
				'raw'      => array( 'type' => $type, 'serialized' => $serialized ),
			);
		}
		return $out;
	}

	private static function meta_read( array $d, $object ) {
		$v = $object instanceof WP_Term ? get_term_meta( $object->term_id, $d['name'], true ) : get_post_meta( $object->ID, $d['name'], true );
		if ( '' === $v || null === $v || false === $v || array() === $v ) {
			return null;
		}
		if ( ! is_scalar( $v ) ) {
			return ImaginaBC_Util::plain( self::summarize( $v ) );
		}
		switch ( $d['raw']['type'] ) {
			case 'number':
				return ImaginaBC_Util::to_number( $v );
			case 'date':
				return ImaginaBC_Util::to_date( $v );
			default:
				return (string) $v;
		}
	}

	private static function meta_value( array $d, $value ) {
		if ( ! empty( $d['raw']['serialized'] ) ) {
			return new WP_Error( 'ibc_readonly', __( 'Este campo se edita en WordPress.', 'imagina-base-connector' ) );
		}
		if ( null === $value || ( is_string( $value ) && '' === trim( $value ) ) ) {
			return null;
		}
		if ( 'number' === $d['raw']['type'] ) {
			$n = ImaginaBC_Util::to_number( $value );
			return null === $n ? new WP_Error( 'ibc_number', __( 'Tiene que ser un número.', 'imagina-base-connector' ) ) : $n;
		}
		if ( 'long_text' === $d['raw']['type'] ) {
			return sanitize_textarea_field( (string) $value );
		}
		return sanitize_text_field( (string) $value );
	}

	// ── Lectura y escritura ──────────────────────────────────────────────────

	/** `clave => valor` de las claves pedidas que son de este objeto. */
	public static function read( $kind, $wp_object, $object_name, array $keys ) {
		$defs = self::defs( $kind, $object_name, $keys );
		$out  = array();
		foreach ( $keys as $key ) {
			if ( ! isset( $defs[ $key ] ) ) {
				continue;
			}
			$d = $defs[ $key ];
			try {
				switch ( $d['provider'] ) {
					case 'acf':
						$out[ $key ] = self::acf_read( $d['raw'], $wp_object );
						break;
					case 'metabox':
						$out[ $key ] = self::metabox_read( $d['raw'], $wp_object );
						break;
					case 'jetengine':
						$out[ $key ] = self::jet_read( $d['raw'], $wp_object );
						break;
					default:
						$out[ $key ] = self::meta_read( $d, $wp_object );
				}
			} catch ( \Throwable $e ) {
				$out[ $key ] = null;
			}
		}
		return $out;
	}

	/** Escribe; devuelve `clave => motivo` de lo que no se pudo. */
	public static function write( $kind, $wp_object, $object_name, array $values ) {
		$defs   = self::defs( $kind, $object_name, array_keys( $values ) );
		$errors = array();
		foreach ( $values as $key => $value ) {
			try {
				$error = self::write_one( $defs, $kind, $wp_object, $key, $value );
			} catch ( \Throwable $e ) {
				// Un plugin que falla al guardar no tira abajo el pedido entero: ese campo lleva el motivo.
				$error = sprintf(
					/* translators: %s: el error que dio WordPress o el plugin del campo */
					__( 'WordPress no lo guardó: %s', 'imagina-base-connector' ),
					$e->getMessage()
				);
			}
			if ( null !== $error ) {
				$errors[ $key ] = $error;
			}
		}
		return $errors;
	}

	/**
	 * ¿Puede el usuario conectado cambiar ESTE metadato? Es la misma pregunta
	 * que hace WordPress en el cuadro «Campos personalizados»: respeta lo que
	 * otros plugins hayan restringido (`auth_post_meta_{clave}`).
	 */
	private static function can_edit_meta( $wp_object, $name ) {
		return $wp_object instanceof WP_Term
			? current_user_can( 'edit_term_meta', $wp_object->term_id, $name )
			: current_user_can( 'edit_post_meta', $wp_object->ID, $name );
	}

	/** Escribe un campo; devuelve el motivo si no se pudo, o null. */
	private static function write_one( array $defs, $kind, $wp_object, $key, $value ) {
		if ( ! isset( $defs[ $key ] ) ) {
			return __( 'El sitio ya no tiene ese campo.', 'imagina-base-connector' );
		}
		$d = $defs[ $key ];
		if ( empty( $d['col']['editable'] ) ) {
			return __( 'Este campo se edita en WordPress.', 'imagina-base-connector' );
		}
		if ( in_array( $d['provider'], array( 'jetengine', 'meta' ), true ) && ! self::can_edit_meta( $wp_object, $d['name'] ) ) {
			return __( 'El usuario conectado no puede cambiar este campo en WordPress.', 'imagina-base-connector' );
		}
		switch ( $d['provider'] ) {
			case 'acf':
				$v = self::acf_value( $d['raw'], $value );
				if ( is_wp_error( $v ) ) {
					return $v->get_error_message();
				}
				// ACF le pasa el valor directo a `update_metadata`, que quita las barras: se agregan antes.
				update_field( $d['raw']['key'], wp_slash( $v ), self::acf_id( $wp_object ) );
				break;
			case 'metabox':
				$v = self::metabox_value( $d['raw'], $value );
				if ( is_wp_error( $v ) ) {
					return $v->get_error_message();
				}
				$args = $wp_object instanceof WP_Term ? array( 'object_type' => 'term' ) : array();
				rwmb_set_meta( $wp_object instanceof WP_Term ? $wp_object->term_id : $wp_object->ID, $d['raw']['id'], wp_slash( $v ), $args );
				break;
			case 'jetengine':
				$v = self::jet_value( $d['raw'], $value );
				if ( is_wp_error( $v ) ) {
					return $v->get_error_message();
				}
				update_post_meta( $wp_object->ID, $d['name'], wp_slash( $v ) );
				break;
			default:
				$v = self::meta_value( $d, $value );
				if ( is_wp_error( $v ) ) {
					return $v->get_error_message();
				}
				$id = $wp_object instanceof WP_Term ? $wp_object->term_id : $wp_object->ID;
				if ( null === $v ) {
					$wp_object instanceof WP_Term ? delete_term_meta( $id, $d['name'] ) : delete_post_meta( $id, $d['name'] );
				} else {
					$wp_object instanceof WP_Term ? update_term_meta( $id, $d['name'], wp_slash( $v ) ) : update_post_meta( $id, $d['name'], wp_slash( $v ) );
				}
		}
		return null;
	}
}
