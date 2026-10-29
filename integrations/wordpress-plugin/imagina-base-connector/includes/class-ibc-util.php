<?php
/**
 * Utilidades compartidas: claves de columna, tipos y conversión de valores.
 *
 * Una columna se identifica por una CLAVE estable (`seo:title`, `cf:acf.precio`,
 * `plugin:words`), nunca por su nombre visible: así la app puede renombrarla
 * sin romper nada. Los tipos son los de la app: text, long_text, number, date,
 * datetime, checkbox, url, select, multi_select.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class IBC_Util {

	const TYPES = array( 'text', 'long_text', 'number', 'date', 'datetime', 'checkbox', 'url', 'select', 'multi_select' );

	/** Clave válida para la app: `fuente:nombre` con un juego acotado de caracteres. */
	public static function valid_key( $key ) {
		return is_string( $key ) && strlen( $key ) <= 200 && 1 === preg_match( '/^[a-z_]+(:[A-Za-z0-9_.-]{1,190})?$/', $key );
	}

	/** «garantia_meses» → «Garantia meses». */
	public static function humanize( $name ) {
		$t = trim( preg_replace( '/[_-]+/', ' ', ltrim( (string) $name, '_' ) ) );
		if ( '' === $t ) {
			return (string) $name;
		}
		return function_exists( 'mb_strtoupper' ) ? mb_strtoupper( mb_substr( $t, 0, 1 ) ) . mb_substr( $t, 1 ) : ucfirst( $t );
	}

	/** Una definición de columna con todos sus campos (lo que entiende la app). */
	public static function column( $key, $label, $type, $args = array() ) {
		return array(
			'key'      => $key,
			'label'    => (string) $label,
			'type'     => in_array( $type, self::TYPES, true ) ? $type : 'text',
			'provider' => isset( $args['provider'] ) ? (string) $args['provider'] : 'plugin',
			'editable' => ! empty( $args['editable'] ),
			'options'  => isset( $args['options'] ) && is_array( $args['options'] ) ? array_values( $args['options'] ) : null,
			'image'    => ! empty( $args['image'] ),
			'hint'     => isset( $args['hint'] ) ? (string) $args['hint'] : null,
			'private'  => ! empty( $args['private'] ),
			'group'    => isset( $args['group'] ) ? (string) $args['group'] : null,
		);
	}

	/** Opciones `valor => etiqueta` (ACF, Meta Box) → `[{value,label}]`, sin repetir ni vacías. */
	public static function options( $choices ) {
		$out = array();
		if ( ! is_array( $choices ) ) {
			return $out;
		}
		foreach ( $choices as $value => $label ) {
			if ( is_array( $label ) ) {
				// Grupos de opciones (optgroup de ACF): se aplanan.
				foreach ( $label as $v => $l ) {
					$out[ (string) $v ] = array( 'value' => (string) $v, 'label' => wp_strip_all_tags( (string) $l ) );
				}
				continue;
			}
			$value = (string) $value;
			if ( '' === $value ) {
				continue;
			}
			$out[ $value ] = array( 'value' => $value, 'label' => '' !== trim( wp_strip_all_tags( (string) $label ) ) ? wp_strip_all_tags( (string) $label ) : $value );
		}
		return array_slice( array_values( $out ), 0, 200 );
	}

	/** Texto plano corto (sin etiquetas ni saltos de más). */
	public static function plain( $value, $max = 8000 ) {
		if ( null === $value ) {
			return null;
		}
		if ( is_array( $value ) || is_object( $value ) ) {
			$value = wp_json_encode( $value );
		}
		$text = trim( html_entity_decode( wp_strip_all_tags( (string) $value ), ENT_QUOTES, 'UTF-8' ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max ) : substr( $text, 0, $max );
	}

	/** `Ymd` o `Y-m-d…` → `Y-m-d`; cualquier otra cosa → null. */
	public static function to_date( $value ) {
		$s = trim( (string) $value );
		if ( preg_match( '/^(\d{4})(\d{2})(\d{2})$/', $s, $m ) ) {
			return $m[1] . '-' . $m[2] . '-' . $m[3];
		}
		if ( preg_match( '/^(\d{4}-\d{2}-\d{2})/', $s, $m ) ) {
			return $m[1];
		}
		if ( preg_match( '/^(\d{2})\/(\d{2})\/(\d{4})$/', $s, $m ) ) {
			return $m[3] . '-' . $m[2] . '-' . $m[1];
		}
		return null;
	}

	/**
	 * Una fecha y hora del sitio (hora local de WordPress, sin zona) → ISO en
	 * UTC (`2026-10-29T14:05:00Z`), que es lo que guarda la app.
	 */
	public static function local_to_iso( $value ) {
		$s = trim( (string) $value );
		if ( '' === $s || 0 === strpos( $s, '0000' ) ) {
			return null;
		}
		if ( ctype_digit( $s ) && strlen( $s ) >= 9 ) {
			return gmdate( 'Y-m-d\TH:i:s\Z', (int) $s );
		}
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/', $s ) ) {
			return null;
		}
		$gmt = get_gmt_from_date( str_replace( 'T', ' ', strlen( $s ) === 16 ? $s . ':00' : $s ), 'Y-m-d H:i:s' );
		return str_replace( ' ', 'T', $gmt ) . 'Z';
	}

	/** ISO de la app (UTC) → hora local del sitio `Y-m-d H:i:s`. */
	public static function iso_to_local( $value ) {
		$s = trim( (string) $value );
		if ( '' === $s ) {
			return null;
		}
		$ts = strtotime( $s );
		if ( false === $ts ) {
			return null;
		}
		return get_date_from_gmt( gmdate( 'Y-m-d H:i:s', $ts ), 'Y-m-d H:i:s' );
	}

	public static function to_bool( $value ) {
		if ( is_bool( $value ) ) {
			return $value;
		}
		if ( is_numeric( $value ) ) {
			return (float) $value > 0;
		}
		return in_array( strtolower( trim( (string) $value ) ), array( '1', 'yes', 'si', 'sí', 'true', 'on' ), true );
	}

	/** Número o null (acepta coma decimal). */
	public static function to_number( $value ) {
		if ( null === $value || '' === $value || is_bool( $value ) || is_array( $value ) ) {
			return null;
		}
		if ( is_int( $value ) || is_float( $value ) ) {
			return is_finite( (float) $value ) ? $value + 0 : null;
		}
		$s = str_replace( ',', '.', trim( (string) $value ) );
		return is_numeric( $s ) ? $s + 0 : null;
	}

	/** Conteo de palabras SIN devolver el contenido (bloques, códigos cortos y etiquetas fuera). */
	public static function word_count( $content ) {
		$text = (string) $content;
		$text = preg_replace( '/<!--.*?-->/s', ' ', $text );
		$text = strip_shortcodes( $text );
		$text = html_entity_decode( wp_strip_all_tags( $text ), ENT_QUOTES, 'UTF-8' );
		if ( '' === trim( $text ) ) {
			return 0;
		}
		$n = preg_match_all( '/[\p{L}\p{N}]+(?:[\'’\-][\p{L}\p{N}]+)*/u', $text );
		return false === $n ? 0 : (int) $n;
	}

	/** Lista de ids enteros positivos, sin repetir, con tope. */
	public static function ids( $raw, $max = 100 ) {
		$out = array();
		foreach ( (array) $raw as $v ) {
			$n = (int) $v;
			if ( $n > 0 ) {
				$out[ $n ] = $n;
			}
		}
		return array_slice( array_values( $out ), 0, $max );
	}

	/** Lista de claves válidas, sin repetir, con tope. */
	public static function keys( $raw, $max = 150 ) {
		$out = array();
		foreach ( (array) $raw as $k ) {
			if ( self::valid_key( $k ) ) {
				$out[ $k ] = $k;
			}
		}
		return array_slice( array_values( $out ), 0, $max );
	}

	/** «La app» que está hablando (cabecera que manda la app en sus escrituras). */
	public static function request_from_app() {
		return isset( $_SERVER['HTTP_X_IMAGINA_SOURCE'] ) && 'app' === $_SERVER['HTTP_X_IMAGINA_SOURCE'];
	}
}
