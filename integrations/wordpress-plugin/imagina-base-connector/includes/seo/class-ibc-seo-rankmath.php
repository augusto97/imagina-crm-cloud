<?php
/**
 * Rank Math: guarda el SEO en metadatos `rank_math_*` (entradas y términos) y
 * resuelve las variables con su propio reemplazador.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class IBC_SEO_RankMath extends IBC_SEO_Adapter {

	public static function active() {
		return class_exists( '\RankMath\Helper' ) && function_exists( 'rank_math' );
	}

	public function id() {
		return 'rank_math';
	}

	public function name() {
		return 'Rank Math';
	}

	public function version() {
		return defined( 'RANK_MATH_VERSION' ) ? RANK_MATH_VERSION : '';
	}

	public function example_template() {
		return '%title% %sep% %sitename%';
	}

	/**
	 * Rank Math arma su reemplazador de variables en la acción `wp` (sólo al
	 * mostrar una página), que en un pedido de la API no corre: se arma aquí.
	 * Sin la configuración inicial terminada (registro o «saltar»), Rank Math
	 * no carga nada y no hay variables que resolver.
	 */
	private function ready() {
		$rm = rank_math();
		if ( ! isset( $rm->variables ) || ! is_object( $rm->variables ) ) {
			return false;
		}
		if ( method_exists( $rm->variables, 'setup' ) ) {
			$rm->variables->setup();
		}
		return true;
	}

	/** Sin la configuración inicial, el plugin no imprime nada en el `<head>`. */
	public function setup_problem() {
		if ( class_exists( '\RankMath\Helper' ) && method_exists( '\RankMath\Helper', 'is_invalid_registration' ) && \RankMath\Helper::is_invalid_registration() ) {
			return __( 'Rank Math está instalado pero falta terminar su configuración inicial (conectar la cuenta o saltar ese paso en su asistente): mientras tanto no publica el SEO en el sitio.', 'imagina-base-connector' );
		}
		return null;
	}

	private function setting( $key, $default = null ) {
		return \RankMath\Helper::get_settings( $key, $default );
	}

	/** Si el robots efectivo incluye `noindex`: el de la entrada o, si no tiene, el de su tipo o el global. */
	private function noindex_of( $robots, $type_key ) {
		$robots = is_array( $robots ) ? $robots : array();
		if ( empty( $robots ) ) {
			$robots = $this->setting( "titles.{$type_key}_custom_robots" ) ? (array) $this->setting( "titles.{$type_key}_robots", array() ) : (array) $this->setting( 'titles.robots_global', array() );
		}
		return in_array( 'noindex', $robots, true );
	}

	private function robots_with( $current, $noindex ) {
		$robots = array_values( array_diff( is_array( $current ) ? $current : array(), array( 'index', 'noindex' ) ) );
		array_unshift( $robots, $noindex ? 'noindex' : 'index' );
		return $robots;
	}

	public function read_post( WP_Post $post ) {
		$id   = $post->ID;
		$type = 'pt_' . $post->post_type;
		$out  = array(
			'seo:title'          => $this->str( get_post_meta( $id, 'rank_math_title', true ) ),
			'seo:description'    => $this->str( get_post_meta( $id, 'rank_math_description', true ) ),
			'seo:focus_keyword'  => $this->str( get_post_meta( $id, 'rank_math_focus_keyword', true ) ),
			'seo:canonical'      => $this->str( get_post_meta( $id, 'rank_math_canonical_url', true ) ),
			'seo:noindex'        => $this->noindex_of( get_post_meta( $id, 'rank_math_robots', true ), $type ),
			'seo:google_title'   => null,
			'seo:google_description' => null,
			'seo:score'          => IBC_Util::to_number( get_post_meta( $id, 'rank_math_seo_score', true ) ),
		);
		if ( $this->ready() ) {
			$out['seo:google_title']       = $this->clean( \RankMath\Helper::replace_seo_fields( '%seo_title%', $post ) );
			$out['seo:google_description'] = $this->clean( \RankMath\Helper::replace_seo_fields( '%seo_description%', $post ) );
		}
		return $out;
	}

	public function write_post( WP_Post $post, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'post_type' );
		$map = array(
			'seo:title'         => 'rank_math_title',
			'seo:description'   => 'rank_math_description',
			'seo:focus_keyword' => 'rank_math_focus_keyword',
			'seo:canonical'     => 'rank_math_canonical_url',
		);
		foreach ( $clean as $key => $value ) {
			if ( 'seo:noindex' === $key ) {
				update_post_meta( $post->ID, 'rank_math_robots', $this->robots_with( get_post_meta( $post->ID, 'rank_math_robots', true ), $value ) );
				continue;
			}
			$this->update_meta( 'post', $post->ID, $map[ $key ], $value );
		}
		return $errors;
	}

	public function read_term( WP_Term $term ) {
		$id  = $term->term_id;
		$tax = 'tax_' . $term->taxonomy;
		$out = array(
			'seo:title'              => $this->str( get_term_meta( $id, 'rank_math_title', true ) ),
			'seo:description'        => $this->str( get_term_meta( $id, 'rank_math_description', true ) ),
			'seo:focus_keyword'      => $this->str( get_term_meta( $id, 'rank_math_focus_keyword', true ) ),
			'seo:canonical'          => $this->str( get_term_meta( $id, 'rank_math_canonical_url', true ) ),
			'seo:noindex'            => $this->noindex_of( get_term_meta( $id, 'rank_math_robots', true ), $tax ),
			'seo:google_title'       => null,
			'seo:google_description' => null,
		);
		if ( $this->ready() ) {
			$title = $out['seo:title'] ? $out['seo:title'] : $this->setting( "titles.{$tax}_title", '%term% %sep% %sitename%' );
			$desc  = $out['seo:description'] ? $out['seo:description'] : $this->setting( "titles.{$tax}_description", '%term_description%' );
			$out['seo:google_title']       = $this->clean( \RankMath\Helper::replace_vars( (string) $title, $term ) );
			$out['seo:google_description'] = $this->clean( \RankMath\Helper::replace_vars( (string) $desc, $term ) );
		}
		return $out;
	}

	public function write_term( WP_Term $term, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'taxonomy' );
		$map = array(
			'seo:title'         => 'rank_math_title',
			'seo:description'   => 'rank_math_description',
			'seo:focus_keyword' => 'rank_math_focus_keyword',
			'seo:canonical'     => 'rank_math_canonical_url',
		);
		foreach ( $clean as $key => $value ) {
			if ( 'seo:noindex' === $key ) {
				update_term_meta( $term->term_id, 'rank_math_robots', $this->robots_with( get_term_meta( $term->term_id, 'rank_math_robots', true ), $value ) );
				continue;
			}
			$this->update_meta( 'term', $term->term_id, $map[ $key ], $value );
		}
		return $errors;
	}
}
