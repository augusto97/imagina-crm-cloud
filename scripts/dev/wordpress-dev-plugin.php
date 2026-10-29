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
