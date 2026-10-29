<?php
/**
 * Plugin "must use" del WordPress de pruebas del conector (scripts/dev/wordpress-up.sh).
 * Registra lo que un sitio real suele tener y que el conector tiene que saber leer:
 * un tipo de contenido propio con API REST, una taxonomía propia, un grupo de
 * campos de ACF con «Mostrar en la API REST» y un meta registrado en la API.
 */

add_action( 'init', function () {
	register_post_type( 'propiedad', array(
		'label'        => 'Propiedades',
		'labels'       => array( 'name' => 'Propiedades', 'singular_name' => 'Propiedad' ),
		'public'       => true,
		'show_in_rest' => true,
		'rest_base'    => 'propiedades',
		'has_archive'  => true,
		'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail', 'custom-fields', 'author' ),
	) );
	register_taxonomy( 'zona', array( 'propiedad' ), array(
		'label'        => 'Zonas',
		'labels'       => array( 'name' => 'Zonas', 'singular_name' => 'Zona' ),
		'public'       => true,
		'hierarchical' => true,
		'show_in_rest' => true,
		'rest_base'    => 'zonas',
	) );
	register_post_meta( 'propiedad', 'referencia_interna', array(
		'show_in_rest' => true,
		'single'       => true,
		'type'         => 'string',
	) );
} );

add_action( 'acf/init', function () {
	if ( ! function_exists( 'acf_add_local_field_group' ) ) {
		return;
	}
	acf_add_local_field_group( array(
		'key'          => 'group_imagina_propiedad',
		'title'        => 'Datos de la propiedad',
		'show_in_rest' => 1,
		'fields'       => array(
			array( 'key' => 'field_imagina_precio', 'label' => 'Precio', 'name' => 'precio', 'type' => 'number' ),
			array( 'key' => 'field_imagina_ciudad', 'label' => 'Ciudad', 'name' => 'ciudad', 'type' => 'text' ),
			array( 'key' => 'field_imagina_habitaciones', 'label' => 'Habitaciones', 'name' => 'habitaciones', 'type' => 'number' ),
			array( 'key' => 'field_imagina_destacada', 'label' => 'Destacada', 'name' => 'destacada', 'type' => 'true_false', 'ui' => 1 ),
		),
		'location'     => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'propiedad' ) ) ),
	) );
} );

/*
 * v0.1.334 (ADR-S84) — lo que sólo ve el complemento de la app:
 *  - un grupo de ACF SIN «Mostrar en la API REST» (la API de WordPress no lo
 *    expone; el complemento sí, con su tipo);
 *  - campos de Meta Box (si el plugin está activo);
 *  - Yoast arma sus «indexables» aunque el sitio sea local (en un sitio local
 *    no los arma y lo que se lee no es lo que ve Google en producción).
 */
add_action( 'acf/init', function () {
	if ( ! function_exists( 'acf_add_local_field_group' ) ) {
		return;
	}
	acf_add_local_field_group( array(
		'key'          => 'group_imagina_ficha_interna',
		'title'        => 'Ficha interna',
		'show_in_rest' => 0,
		'fields'       => array(
			array( 'key' => 'field_imagina_asesor', 'label' => 'Asesor', 'name' => 'asesor', 'type' => 'text' ),
			array( 'key' => 'field_imagina_comision', 'label' => 'Comisión (%)', 'name' => 'comision', 'type' => 'number' ),
			array(
				'key'     => 'field_imagina_estado_interno',
				'label'   => 'Estado interno',
				'name'    => 'estado_interno',
				'type'    => 'select',
				'choices' => array( 'disponible' => 'Disponible', 'reservada' => 'Reservada', 'vendida' => 'Vendida' ),
			),
			array( 'key' => 'field_imagina_fecha_captacion', 'label' => 'Fecha de captación', 'name' => 'fecha_captacion', 'type' => 'date_picker', 'return_format' => 'd/m/Y' ),
			array( 'key' => 'field_imagina_notas_internas', 'label' => 'Notas internas', 'name' => 'notas_internas', 'type' => 'textarea' ),
		),
		'location'     => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'propiedad' ) ) ),
	) );
} );

add_filter( 'rwmb_meta_boxes', function ( $boxes ) {
	$boxes[] = array(
		'id'         => 'imagina_catastro',
		'title'      => 'Catastro',
		'post_types' => array( 'propiedad' ),
		'fields'     => array(
			array( 'id' => 'mb_codigo_catastral', 'name' => 'Código catastral', 'type' => 'text' ),
			array( 'id' => 'mb_estrato', 'name' => 'Estrato', 'type' => 'number' ),
			array( 'id' => 'mb_tiene_parqueadero', 'name' => 'Tiene parqueadero', 'type' => 'checkbox' ),
		),
	);
	return $boxes;
} );

add_filter( 'Yoast\WP\SEO\should_index_indexables', '__return_true' );

// Sólo en este sitio de pruebas: WordPress no baja archivos de localhost ni de
// puertos raros (así protege las descargas). La app de desarrollo vive en
// localhost:5182: sin esto, «Actualizar» el complemento no podría bajar el zip.
add_filter( 'http_request_host_is_external', '__return_true' );
add_filter( 'http_allowed_safe_ports', function ( $ports ) {
	return array_merge( (array) $ports, array( 3102, 3101, 3100, 5182, 5181, 5180, 5173 ) );
} );
