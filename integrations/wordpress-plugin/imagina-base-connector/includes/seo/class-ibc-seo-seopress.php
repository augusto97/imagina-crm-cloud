<?php
/**
 * SEOPress: metadatos `_seopress_*` en entradas y términos. Lo que ve Google
 * sale de sus servicios `TitleMeta` y `DescriptionMeta` con el contexto de la
 * página, los mismos que arman el `<head>`.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class IBC_SEO_SEOPress extends IBC_SEO_Adapter {

	public static function active() {
		return defined( 'SEOPRESS_VERSION' ) && function_exists( 'seopress_get_service' );
	}

	public function id() {
		return 'seopress';
	}

	public function name() {
		return 'SEOPress';
	}

	public function version() {
		return defined( 'SEOPRESS_VERSION' ) ? SEOPRESS_VERSION : '';
	}

	public function example_template() {
		return '%%post_title%% %%sep%% %%sitetitle%%';
	}

	/** SEOPress no guarda un puntaje numérico. */
	public function supports_score() {
		return false;
	}

	public function supports_term_focus() {
		return false;
	}

	private function titles_option() {
		$o = get_option( 'seopress_titles_option_name' );
		return is_array( $o ) ? $o : array();
	}

	private function default_noindex( $group, $name ) {
		$o = $this->titles_option();
		return ! empty( $o[ $group ][ $name ]['noindex'] );
	}

	private function resolve( $context ) {
		try {
			return array(
				$this->clean( seopress_get_service( 'TitleMeta' )->getValue( $context ) ),
				$this->clean( seopress_get_service( 'DescriptionMeta' )->getValue( $context ) ),
			);
		} catch ( \Throwable $e ) {
			return array( null, null );
		}
	}

	public function read_post( WP_Post $post ) {
		$id    = $post->ID;
		$index = get_post_meta( $id, '_seopress_robots_index', true );
		$out   = array(
			'seo:title'              => $this->str( get_post_meta( $id, '_seopress_titles_title', true ) ),
			'seo:description'        => $this->str( get_post_meta( $id, '_seopress_titles_desc', true ) ),
			'seo:focus_keyword'      => $this->str( get_post_meta( $id, '_seopress_analysis_target_kw', true ) ),
			'seo:canonical'          => $this->str( get_post_meta( $id, '_seopress_robots_canonical', true ) ),
			'seo:noindex'            => 'yes' === $index ? true : $this->default_noindex( 'seopress_titles_single_titles', $post->post_type ),
			'seo:google_title'       => null,
			'seo:google_description' => null,
		);
		try {
			$ctx = seopress_get_service( 'ContextPage' )->buildContextWithCurrentId( $id );
			$ctx->setPostById( $id );
			$ctx->setIsSingle( true );
			list( $out['seo:google_title'], $out['seo:google_description'] ) = $this->resolve( $ctx->getContext() );
		} catch ( \Throwable $e ) {
			// Una versión de SEOPress sin estos servicios: queda sin resolver.
		}
		return $out;
	}

	private function write_meta( $type, $id, array $clean ) {
		$map = array(
			'seo:title'         => '_seopress_titles_title',
			'seo:description'   => '_seopress_titles_desc',
			'seo:focus_keyword' => '_seopress_analysis_target_kw',
			'seo:canonical'     => '_seopress_robots_canonical',
		);
		foreach ( $clean as $key => $value ) {
			if ( 'seo:noindex' === $key ) {
				$this->update_meta( $type, $id, '_seopress_robots_index', $value ? 'yes' : null );
				continue;
			}
			$this->update_meta( $type, $id, $map[ $key ], $value );
		}
	}

	public function write_post( WP_Post $post, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'post_type' );
		$this->write_meta( 'post', $post->ID, $clean );
		return $errors;
	}

	public function read_term( WP_Term $term ) {
		$id    = $term->term_id;
		$index = get_term_meta( $id, '_seopress_robots_index', true );
		$out   = array(
			'seo:title'              => $this->str( get_term_meta( $id, '_seopress_titles_title', true ) ),
			'seo:description'        => $this->str( get_term_meta( $id, '_seopress_titles_desc', true ) ),
			'seo:canonical'          => $this->str( get_term_meta( $id, '_seopress_robots_canonical', true ) ),
			'seo:noindex'            => 'yes' === $index ? true : $this->default_noindex( 'seopress_titles_tax_titles', $term->taxonomy ),
			'seo:google_title'       => null,
			'seo:google_description' => null,
		);
		try {
			$ctx = seopress_get_service( 'ContextPage' )->buildContextWithCurrentId( $id, array( 'type' => 'term', 'taxonomy' => $term->taxonomy ) );
			$ctx->setTermId( $id );
			list( $out['seo:google_title'], $out['seo:google_description'] ) = $this->resolve( $ctx->getContext() );
		} catch ( \Throwable $e ) {
			// Sin resolver.
		}
		return $out;
	}

	public function write_term( WP_Term $term, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'taxonomy' );
		unset( $clean['seo:focus_keyword'] );
		$this->write_meta( 'term', $term->term_id, $clean );
		return $errors;
	}
}
