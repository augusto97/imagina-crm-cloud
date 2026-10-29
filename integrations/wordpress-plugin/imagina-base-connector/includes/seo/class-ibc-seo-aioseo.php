<?php
/**
 * All in One SEO: guarda el SEO de cada entrada en SU tabla (`aioseo_posts`),
 * no en metadatos, así que se lee y se escribe con su modelo (`Models\Post`),
 * que es lo que usa su propio editor (con sus filtros y su caché).
 *
 * La versión gratuita no guarda SEO propio por término: de las categorías y
 * etiquetas sólo se trae lo que ve Google (el formato por defecto resuelto).
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class IBC_SEO_AIOSEO extends IBC_SEO_Adapter {

	public static function active() {
		return defined( 'AIOSEO_VERSION' ) && function_exists( 'aioseo' ) && class_exists( '\AIOSEO\Plugin\Common\Models\Post' );
	}

	public function id() {
		return 'aioseo';
	}

	public function name() {
		return 'All in One SEO';
	}

	public function version() {
		return defined( 'AIOSEO_VERSION' ) ? AIOSEO_VERSION : '';
	}

	public function example_template() {
		return '#post_title #separator_sa #site_title';
	}

	public function supports_term_meta() {
		return false;
	}

	/** Desde la 5.0 la palabra clave vive en su propia columna (antes, en `keyphrases`). */
	private function has_focus_column() {
		return version_compare( $this->version(), '5.0', '>=' );
	}

	private function model( $id ) {
		return \AIOSEO\Plugin\Common\Models\Post::getPost( $id );
	}

	private function type_noindex( $post_type ) {
		try {
			$o = aioseo()->dynamicOptions->searchAppearance->postTypes->{$post_type}->advanced->robotsMeta;
			return ! $o->default && $o->noindex;
		} catch ( \Throwable $e ) {
			return false;
		}
	}

	private function focus_of( $m ) {
		if ( $this->has_focus_column() && isset( $m->focus_keyword ) ) {
			return $this->str( $m->focus_keyword );
		}
		$kp = isset( $m->keyphrases ) ? $m->keyphrases : null;
		if ( is_string( $kp ) ) {
			$kp = json_decode( $kp );
		}
		return is_object( $kp ) && isset( $kp->focus->keyphrase ) ? $this->str( $kp->focus->keyphrase ) : null;
	}

	public function read_post( WP_Post $post ) {
		$m     = $this->model( $post->ID );
		$score = isset( $m->seo_score ) ? (int) $m->seo_score : 0;
		$out   = array(
			'seo:title'              => $this->str( isset( $m->title ) ? $m->title : '' ),
			'seo:description'        => $this->str( isset( $m->description ) ? $m->description : '' ),
			'seo:focus_keyword'      => $this->focus_of( $m ),
			'seo:canonical'          => $this->str( isset( $m->canonical_url ) ? $m->canonical_url : '' ),
			'seo:noindex'            => ( isset( $m->robots_default ) && ! $m->robots_default ) ? ! empty( $m->robots_noindex ) : $this->type_noindex( $post->post_type ),
			'seo:google_title'       => null,
			'seo:google_description' => null,
			// 0 = todavía no se analizó en el editor.
			'seo:score'              => $score > 0 ? $score : null,
		);
		try {
			$out['seo:google_title']       = $this->clean( aioseo()->meta->title->getPostTitle( $post ) );
			$out['seo:google_description'] = $this->clean( aioseo()->meta->description->getPostDescription( $post ) );
		} catch ( \Throwable $e ) {
			// Sin resolver.
		}
		return $out;
	}

	public function write_post( WP_Post $post, array $values ) {
		list( $clean, $errors ) = $this->prepare( $values, 'post_type' );
		if ( empty( $clean ) ) {
			return $errors;
		}
		$data = array();
		foreach ( $clean as $key => $value ) {
			switch ( $key ) {
				case 'seo:title':
					$data['title'] = null === $value ? '' : $value;
					break;
				case 'seo:description':
					$data['description'] = null === $value ? '' : $value;
					break;
				case 'seo:canonical':
					$data['canonical_url'] = null === $value ? '' : $value;
					break;
				case 'seo:noindex':
					$data['robots_default'] = ! $value;
					$data['robots_noindex'] = (bool) $value;
					break;
				case 'seo:focus_keyword':
					if ( $this->has_focus_column() ) {
						$data['focus_keyword'] = null === $value ? '' : $value;
					} else {
						$data['keyphrases'] = array(
							'focus'      => array( 'keyphrase' => null === $value ? '' : $value ),
							'additional' => array(),
						);
					}
					break;
			}
		}
		$result = \AIOSEO\Plugin\Common\Models\Post::savePost( $post->ID, $data );
		if ( is_string( $result ) && '' !== $result ) {
			foreach ( array_keys( $clean ) as $key ) {
				$errors[ $key ] = sprintf( __( 'All in One SEO no lo guardó: %s', 'imagina-base-connector' ), $result );
			}
		}
		return $errors;
	}

	public function read_term( WP_Term $term ) {
		$out = array(
			'seo:google_title'       => null,
			'seo:google_description' => null,
		);
		try {
			$out['seo:google_title']       = $this->clean( aioseo()->meta->title->getTermTitle( $term ) );
			$out['seo:google_description'] = $this->clean( aioseo()->meta->description->getTermDescription( $term ) );
		} catch ( \Throwable $e ) {
			// Sin resolver.
		}
		return $out;
	}

	public function write_term( WP_Term $term, array $values ) {
		list( , $errors ) = $this->prepare( $values, 'taxonomy' );
		return $errors;
	}
}
