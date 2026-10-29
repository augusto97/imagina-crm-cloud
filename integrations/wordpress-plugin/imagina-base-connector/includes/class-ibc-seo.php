<?php
/**
 * Qué plugin de SEO usa el sitio. Si hay más de uno activo (pasa al migrar de
 * uno a otro) se usa el primero de esta lista y se avisa: el `<head>` lo arma
 * el que gana, y escribir en el otro no cambiaría nada de lo que ve Google.
 *
 * @package ImaginaBaseConnector
 */

defined( 'ABSPATH' ) || exit;

class ImaginaBC_SEO {

	const ADAPTERS = array( 'ImaginaBC_SEO_RankMath', 'ImaginaBC_SEO_Yoast', 'ImaginaBC_SEO_SEOPress', 'ImaginaBC_SEO_AIOSEO' );

	/** @var ImaginaBC_SEO_Adapter|null|false */
	private static $adapter = false;

	/** @return ImaginaBC_SEO_Adapter[] */
	public static function all_active() {
		$out = array();
		foreach ( self::ADAPTERS as $class ) {
			if ( call_user_func( array( $class, 'active' ) ) ) {
				$out[] = new $class();
			}
		}
		return $out;
	}

	/** @return ImaginaBC_SEO_Adapter|null */
	public static function adapter() {
		if ( false === self::$adapter ) {
			$all           = self::all_active();
			self::$adapter = empty( $all ) ? null : $all[0];
		}
		return self::$adapter;
	}

	public static function info() {
		$all = self::all_active();
		if ( empty( $all ) ) {
			return null;
		}
		$main   = $all[0];
		$others = array();
		foreach ( array_slice( $all, 1 ) as $a ) {
			$others[] = $a->name();
		}
		$problem = method_exists( $main, 'setup_problem' ) ? $main->setup_problem() : null;
		if ( ! empty( $others ) ) {
			$extra   = sprintf(
				/* translators: 1: plugin usado, 2: otros activos */
				__( 'Hay más de un plugin de SEO activo: se usa %1$s (%2$s también está activo y conviene desactivarlo para que no se pisen).', 'imagina-base-connector' ),
				$main->name(),
				implode( ', ', $others )
			);
			$problem = $problem ? $problem . ' ' . $extra : $extra;
		}
		return array(
			'plugin'  => $main->id(),
			'name'    => $main->name(),
			'version' => $main->version(),
			'terms'   => $main->supports_term_meta(),
			'others'  => $others,
			'problem' => $problem,
		);
	}

	/** Columnas SEO para un tipo de objeto (`post_type` | `taxonomy`). */
	public static function columns( $kind ) {
		$a = self::adapter();
		return $a ? $a->columns( $kind ) : array();
	}

	public static function read( $object ) {
		$a = self::adapter();
		if ( ! $a ) {
			return array();
		}
		try {
			return $object instanceof WP_Term ? $a->read_term( $object ) : $a->read_post( $object );
		} catch ( \Throwable $e ) {
			return array();
		}
	}

	public static function write( $object, array $values ) {
		$a = self::adapter();
		if ( ! $a ) {
			$errors = array();
			foreach ( array_keys( $values ) as $k ) {
				$errors[ $k ] = __( 'El sitio ya no tiene un plugin de SEO activo.', 'imagina-base-connector' );
			}
			return $errors;
		}
		try {
			return $object instanceof WP_Term ? $a->write_term( $object, $values ) : $a->write_post( $object, $values );
		} catch ( \Throwable $e ) {
			$errors = array();
			foreach ( array_keys( $values ) as $k ) {
				$errors[ $k ] = sprintf( /* translators: 1: plugin de SEO, 2: el error */ __( '%1$s no lo guardó: %2$s', 'imagina-base-connector' ), $a->name(), $e->getMessage() );
			}
			return $errors;
		}
	}
}
