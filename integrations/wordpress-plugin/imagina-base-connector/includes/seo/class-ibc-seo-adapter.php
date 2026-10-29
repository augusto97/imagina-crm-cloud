<?php
/**
 * Un plugin de SEO (Rank Math, Yoast, SEOPress, AIOSEO) visto con UNA sola
 * forma: las mismas claves de columna para todos.
 *
 *  - `seo:title`, `seo:description`, `seo:focus_keyword`, `seo:canonical`,
 *    `seo:noindex`: lo que se escribe (con las variables del plugin, como
 *    `%title%` o `%%sep%%`).
 *  - `seo:google_title`, `seo:google_description`: lo que ve Google, con las
 *    variables ya reemplazadas. De sólo lectura: se calculan con la API del
 *    propio plugin, así coinciden con lo que sale en el `<head>`.
 *  - `seo:score`: el puntaje del plugin, si lo tiene.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

abstract class IBC_SEO_Adapter {

	/** `rank_math`, `yoast`, `seopress`, `aioseo`. */
	abstract public function id();

	abstract public function name();

	abstract public function version();

	/** Las variables del plugin, para el texto de ayuda («%title% %sep% %sitename%»). */
	abstract public function example_template();

	/** Lee los valores SEO de una entrada. */
	abstract public function read_post( WP_Post $post );

	/** Escribe; devuelve `clave => motivo` de lo que no se pudo. */
	abstract public function write_post( WP_Post $post, array $values );

	/** Lee los valores SEO de un término (si el plugin los tiene). */
	abstract public function read_term( WP_Term $term );

	abstract public function write_term( WP_Term $term, array $values );

	/** El plugin guarda SEO propio por término (no sólo el formato por defecto). */
	public function supports_term_meta() {
		return true;
	}

	public function supports_score() {
		return true;
	}

	public function supports_term_focus() {
		return true;
	}

	/** Las columnas que ofrece este plugin para un tipo de objeto (`post_type` | `taxonomy`). */
	public function columns( $kind ) {
		$p    = array( 'provider' => 'seo', 'group' => 'seo' );
		$edit = array_merge( $p, array( 'editable' => true ) );
		$var  = sprintf(
			/* translators: 1: plugin de SEO, 2: ejemplo de variables */
			__( 'Puedes usar las variables de %1$s (por ejemplo %2$s). Vacío = el formato por defecto del plugin.', 'imagina-base-connector' ),
			$this->name(),
			$this->example_template()
		);
		$cols = array();
		if ( 'post_type' === $kind || $this->supports_term_meta() ) {
			$cols[] = IBC_Util::column( 'seo:title', __( 'Título SEO', 'imagina-base-connector' ), 'text', array_merge( $edit, array( 'hint' => $var ) ) );
			$cols[] = IBC_Util::column( 'seo:description', __( 'Descripción SEO', 'imagina-base-connector' ), 'long_text', array_merge( $edit, array( 'hint' => $var ) ) );
			if ( 'post_type' === $kind || $this->supports_term_focus() ) {
				$cols[] = IBC_Util::column( 'seo:focus_keyword', __( 'Palabra clave', 'imagina-base-connector' ), 'text', $edit );
			}
			$cols[] = IBC_Util::column( 'seo:canonical', __( 'URL canónica', 'imagina-base-connector' ), 'url', array_merge( $edit, array( 'hint' => __( 'Vacío = la dirección de la propia página.', 'imagina-base-connector' ) ) ) );
			$cols[] = IBC_Util::column( 'seo:noindex', __( 'No indexar', 'imagina-base-connector' ), 'checkbox', array_merge( $edit, array( 'hint' => __( 'Marcado, Google no muestra la página en los resultados.', 'imagina-base-connector' ) ) ) );
		}
		$cols[] = IBC_Util::column( 'seo:google_title', __( 'Título en Google', 'imagina-base-connector' ), 'text', array_merge( $p, array( 'hint' => __( 'El título que ve Google, con las variables ya reemplazadas.', 'imagina-base-connector' ) ) ) );
		$cols[] = IBC_Util::column( 'seo:google_description', __( 'Descripción en Google', 'imagina-base-connector' ), 'long_text', array_merge( $p, array( 'hint' => __( 'La descripción que ve Google, con las variables ya reemplazadas.', 'imagina-base-connector' ) ) ) );
		if ( 'post_type' === $kind && $this->supports_score() ) {
			$cols[] = IBC_Util::column( 'seo:score', __( 'Puntaje SEO', 'imagina-base-connector' ), 'number', array_merge( $p, array( 'hint' => __( 'Lo calcula el plugin de SEO al editar la entrada en WordPress.', 'imagina-base-connector' ) ) ) );
		}
		return $cols;
	}

	/** Texto resuelto para mostrar (sin etiquetas, entidades ni espacios dobles). */
	protected function clean( $text ) {
		if ( null === $text || false === $text ) {
			return null;
		}
		$t = html_entity_decode( wp_strip_all_tags( (string) $text ), ENT_QUOTES, 'UTF-8' );
		$t = trim( preg_replace( '/\s+/u', ' ', $t ) );
		return '' === $t ? null : $t;
	}

	/** `''`/`null` → null; el resto, texto. */
	protected function str( $v ) {
		if ( null === $v || false === $v || is_array( $v ) ) {
			return null;
		}
		$s = (string) $v;
		return '' === trim( $s ) ? null : $s;
	}

	/** Lo que se escribe, saneado por clave. `null` = borrar (volver al formato por defecto). */
	protected function sanitize( $key, $value ) {
		if ( 'seo:noindex' === $key ) {
			return IBC_Util::to_bool( $value );
		}
		if ( null === $value || ( is_string( $value ) && '' === trim( $value ) ) ) {
			return null;
		}
		switch ( $key ) {
			case 'seo:description':
				return sanitize_textarea_field( (string) $value );
			case 'seo:canonical':
				if ( ! preg_match( '#^https?://[^\s/$.?\#][^\s]*$#i', trim( (string) $value ) ) ) {
					return false;
				}
				$url = esc_url_raw( trim( (string) $value ), array( 'http', 'https' ) );
				return '' === $url ? false : $url;
			default:
				return sanitize_text_field( (string) $value );
		}
	}

	/**
	 * Recorre lo que llegó, sanea y devuelve `[clave => valor]` + errores. Las
	 * claves de sólo lectura (lo que ve Google, el puntaje) se rechazan.
	 */
	protected function prepare( array $values, $kind ) {
		$out    = array();
		$errors = array();
		$allowed = array( 'seo:title', 'seo:description', 'seo:focus_keyword', 'seo:canonical', 'seo:noindex' );
		foreach ( $values as $key => $value ) {
			if ( ! in_array( $key, $allowed, true ) ) {
				$errors[ $key ] = __( 'Lo calcula el plugin de SEO: no se escribe.', 'imagina-base-connector' );
				continue;
			}
			if ( 'taxonomy' === $kind && ! $this->supports_term_meta() ) {
				$errors[ $key ] = sprintf( __( '%s no guarda SEO propio por término en esta versión.', 'imagina-base-connector' ), $this->name() );
				continue;
			}
			$clean = $this->sanitize( $key, $value );
			if ( false === $clean ) {
				$errors[ $key ] = __( 'La URL canónica tiene que ser una dirección web completa (https://…).', 'imagina-base-connector' );
				continue;
			}
			$out[ $key ] = $clean;
		}
		return array( $out, $errors );
	}

	protected function update_meta( $type, $id, $meta_key, $value ) {
		if ( null === $value ) {
			'term' === $type ? delete_term_meta( $id, $meta_key ) : delete_post_meta( $id, $meta_key );
			return;
		}
		// `update_*_meta` quita las barras invertidas (`wp_unslash`): se agregan antes.
		$value = wp_slash( $value );
		'term' === $type ? update_term_meta( $id, $meta_key, $value ) : update_post_meta( $id, $meta_key, $value );
	}
}
