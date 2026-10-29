<?php
/**
 * Yoast SEO: metadatos `_yoast_wpseo_*` en las entradas y la opción
 * `wpseo_taxonomy_meta` en los términos. Lo que ve Google sale de su API de
 * metadatos (`YoastSEO()->meta`), la misma que imprime el `<head>`.
 *
 * En un sitio de producción Yoast guarda una copia de cada objeto en su tabla
 * de «indexables»; al escribir se reconstruye, si no el `<head>` seguiría
 * mostrando el valor viejo hasta la próxima edición en WordPress.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_SEO_Yoast extends ImaginaBC_SEO_Adapter {

	public static function active() {
		return defined( 'WPSEO_VERSION' ) && class_exists( 'WPSEO_Meta' );
	}

	public function id() {
		return 'yoast';
	}

	public function name() {
		return 'Yoast SEO';
	}

	public function version() {
		return defined( 'WPSEO_VERSION' ) ? WPSEO_VERSION : '';
	}

	public function example_template() {
		return '%%title%% %%sep%% %%sitename%%';
	}

	private function option( $key, $default = '' ) {
		if ( class_exists( 'WPSEO_Options' ) ) {
			$v = WPSEO_Options::get( $key, $default );
			return null === $v ? $default : $v;
		}
		return $default;
	}

	/** El indexable guardado, reconstruido con lo que hay ahora en los metadatos. */
	private function rebuild( $id, $type ) {
		if ( ! function_exists( 'YoastSEO' ) ) {
			return;
		}
		try {
			$repo    = YoastSEO()->classes->get( 'Yoast\WP\SEO\Repositories\Indexable_Repository' );
			$builder = YoastSEO()->classes->get( 'Yoast\WP\SEO\Builders\Indexable_Builder' );
			if ( ! $repo || ! $builder ) {
				return;
			}
			$indexable = $repo->find_by_id_and_type( $id, $type, false );
			if ( $indexable ) {
				$builder->build_for_id_and_type( $id, $type, $indexable );
			}
		} catch ( \Throwable $e ) {
			// Un Yoast distinto (otra versión): el valor ya está guardado; el `<head>` se pone al día en la próxima edición.
		}
	}

	public function read_post( WP_Post $post ) {
		$id      = $post->ID;
		$noindex = WPSEO_Meta::get_value( 'meta-robots-noindex', $id );
		$out     = array(
			'seo:title'              => $this->str( WPSEO_Meta::get_value( 'title', $id ) ),
			'seo:description'        => $this->str( WPSEO_Meta::get_value( 'metadesc', $id ) ),
			'seo:focus_keyword'      => $this->str( WPSEO_Meta::get_value( 'focuskw', $id ) ),
			'seo:canonical'          => $this->str( WPSEO_Meta::get_value( 'canonical', $id ) ),
			'seo:noindex'            => '1' === (string) $noindex ? true : ( '2' === (string) $noindex ? false : (bool) $this->option( 'noindex-' . $post->post_type, false ) ),
			'seo:google_title'       => null,
			'seo:google_description' => null,
			'seo:score'              => ImaginaBC_Util::to_number( WPSEO_Meta::get_value( 'linkdex', $id ) ),
		);
		$meta = function_exists( 'YoastSEO' ) ? YoastSEO()->meta->for_post( $id ) : false;
		if ( $meta ) {
			$out['seo:google_title']       = $this->clean( $meta->title );
			$out['seo:google_description'] = $this->clean( $meta->description );
		} elseif ( function_exists( 'wpseo_replace_vars' ) ) {
			$title = $out['seo:title'] ? $out['seo:title'] : $this->option( 'title-' . $post->post_type, '' );
			$desc  = $out['seo:description'] ? $out['seo:description'] : $this->option( 'metadesc-' . $post->post_type, '' );
			$out['seo:google_title']       = $this->clean( wpseo_replace_vars( (string) $title, $post ) );
			$out['seo:google_description'] = $this->clean( wpseo_replace_vars( (string) $desc, $post ) );
		}
		return $out;
	}

	public function write_post( WP_Post $post, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'post_type' );
		$map = array(
			'seo:title'         => 'title',
			'seo:description'   => 'metadesc',
			'seo:focus_keyword' => 'focuskw',
			'seo:canonical'     => 'canonical',
		);
		foreach ( $clean as $key => $value ) {
			if ( 'seo:noindex' === $key ) {
				WPSEO_Meta::set_value( 'meta-robots-noindex', $value ? '1' : '2', $post->ID );
				continue;
			}
			if ( null === $value ) {
				WPSEO_Meta::delete( $map[ $key ], $post->ID );
			} else {
				WPSEO_Meta::set_value( $map[ $key ], $value, $post->ID );
			}
		}
		if ( ! empty( $clean ) ) {
			$this->rebuild( $post->ID, 'post' );
		}
		return $errors;
	}

	private function term_meta( WP_Term $term ) {
		if ( ! class_exists( 'WPSEO_Taxonomy_Meta' ) ) {
			return array();
		}
		$all = WPSEO_Taxonomy_Meta::get_term_meta( $term->term_id, $term->taxonomy );
		return is_array( $all ) ? $all : array();
	}

	public function read_term( WP_Term $term ) {
		$m       = $this->term_meta( $term );
		$noindex = isset( $m['wpseo_noindex'] ) ? $m['wpseo_noindex'] : 'default';
		$out     = array(
			'seo:title'              => $this->str( isset( $m['wpseo_title'] ) ? $m['wpseo_title'] : '' ),
			'seo:description'        => $this->str( isset( $m['wpseo_desc'] ) ? $m['wpseo_desc'] : '' ),
			'seo:focus_keyword'      => $this->str( isset( $m['wpseo_focuskw'] ) ? $m['wpseo_focuskw'] : '' ),
			'seo:canonical'          => $this->str( isset( $m['wpseo_canonical'] ) ? $m['wpseo_canonical'] : '' ),
			'seo:noindex'            => 'noindex' === $noindex ? true : ( 'index' === $noindex ? false : (bool) $this->option( 'noindex-tax-' . $term->taxonomy, false ) ),
			'seo:google_title'       => null,
			'seo:google_description' => null,
		);
		$meta = function_exists( 'YoastSEO' ) ? YoastSEO()->meta->for_term( $term->term_id ) : false;
		if ( $meta ) {
			$out['seo:google_title']       = $this->clean( $meta->title );
			$out['seo:google_description'] = $this->clean( $meta->description );
		} elseif ( function_exists( 'wpseo_replace_vars' ) ) {
			$title = $out['seo:title'] ? $out['seo:title'] : $this->option( 'title-tax-' . $term->taxonomy, '' );
			$desc  = $out['seo:description'] ? $out['seo:description'] : $this->option( 'metadesc-tax-' . $term->taxonomy, '' );
			$out['seo:google_title']       = $this->clean( wpseo_replace_vars( (string) $title, $term ) );
			$out['seo:google_description'] = $this->clean( wpseo_replace_vars( (string) $desc, $term ) );
		}
		return $out;
	}

	public function write_term( WP_Term $term, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'taxonomy' );
		if ( empty( $clean ) || ! class_exists( 'WPSEO_Taxonomy_Meta' ) ) {
			return $errors;
		}
		// Yoast valida el conjunto ENTERO (lo que falta, como la canónica, se
		// borraría): se parte de lo que ya tiene el término.
		$all = $this->term_meta( $term );
		$map = array(
			'seo:title'         => 'wpseo_title',
			'seo:description'   => 'wpseo_desc',
			'seo:focus_keyword' => 'wpseo_focuskw',
			'seo:canonical'     => 'wpseo_canonical',
		);
		foreach ( $clean as $key => $value ) {
			if ( 'seo:noindex' === $key ) {
				$all['wpseo_noindex'] = $value ? 'noindex' : 'index';
				continue;
			}
			$all[ $map[ $key ] ] = null === $value ? '' : $value;
		}
		WPSEO_Taxonomy_Meta::set_values( $term->term_id, $term->taxonomy, $all );
		$this->rebuild( $term->term_id, 'term' );
		return $errors;
	}
}
