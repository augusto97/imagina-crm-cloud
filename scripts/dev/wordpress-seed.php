<?php
/**
 * Datos de prueba del WordPress del conector (lo corre wordpress-up.sh con
 * `wp eval-file`). Idempotente a medias: sólo se corre al instalar el sitio.
 */

$cat_noticias = wp_insert_term( 'Noticias', 'category', array( 'slug' => 'noticias' ) );
$cat_guias    = wp_insert_term( 'Guías', 'category', array( 'slug' => 'guias' ) );
$tag_hogar    = wp_insert_term( 'Hogar', 'post_tag', array( 'slug' => 'hogar' ) );
$tag_venta    = wp_insert_term( 'Venta', 'post_tag', array( 'slug' => 'venta' ) );
$zona_norte   = wp_insert_term( 'Norte', 'zona', array( 'slug' => 'norte' ) );
$zona_centro  = wp_insert_term( 'Centro', 'zona', array( 'slug' => 'centro' ) );
$zona_sur     = wp_insert_term( 'Sur', 'zona', array( 'slug' => 'sur' ) );
$term_id      = function ( $t ) {
	return is_array( $t ) ? (int) $t['term_id'] : 0;
};

// Páginas (una hija).
$about = wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Quiénes somos', 'post_excerpt' => 'Una inmobiliaria de barrio.', 'post_content' => str_repeat( 'Contenido largo de la página. ', 200 ), 'menu_order' => 1 ) );
wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Nuestro equipo', 'post_parent' => $about, 'menu_order' => 2 ) );
wp_insert_post( array( 'post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'Contacto (borrador)', 'menu_order' => 3 ) );

// Entradas.
$posts = array(
	array( 'Cómo elegir un apartamento', array( $term_id( $cat_guias ) ), array( 'hogar' ), 'publish' ),
	array( 'Abrimos oficina en el norte', array( $term_id( $cat_noticias ) ), array( 'venta' ), 'publish' ),
	array( 'Checklist de mudanza', array( $term_id( $cat_guias ) ), array( 'hogar', 'venta' ), 'publish' ),
	array( 'Precios del mercado en 2026', array( $term_id( $cat_noticias ), $term_id( $cat_guias ) ), array(), 'draft' ),
	array( 'Entrada privada del equipo', array( $term_id( $cat_noticias ) ), array(), 'private' ),
);
foreach ( $posts as $i => $p ) {
	$id = wp_insert_post( array(
		'post_type'     => 'post',
		'post_status'   => $p[3],
		'post_title'    => $p[0],
		'post_excerpt'  => 'Resumen de «' . $p[0] . '».',
		'post_content'  => str_repeat( 'Texto de la entrada que el conector NO debe traer. ', 100 ),
		'post_category' => $p[1],
	) );
	wp_set_post_tags( $id, $p[2] );
}

// Propiedades con sus campos ACF y su zona.
$props = array(
	array( 'Casa con jardín', 450000000, 'Medellín', 4, true, $zona_norte ),
	array( 'Apartamento céntrico', 280000000, 'Bogotá', 2, false, $zona_centro ),
	array( 'Estudio amoblado', 150000000, 'Bogotá', 1, false, $zona_centro ),
	array( 'Finca de descanso', 900000000, 'Rionegro', 6, true, $zona_sur ),
	array( 'Local comercial', 520000000, 'Cali', 0, false, $zona_sur ),
	array( 'Penthouse con vista', 1200000000, 'Medellín', 3, true, $zona_norte ),
);
foreach ( $props as $i => $p ) {
	$id = wp_insert_post( array(
		'post_type'    => 'propiedad',
		'post_status'  => 'publish',
		'post_title'   => $p[0],
		'post_excerpt' => 'Propiedad en ' . $p[2] . '.',
		'post_content' => str_repeat( 'Descripción larga de la propiedad. ', 80 ),
	) );
	update_field( 'precio', $p[1], $id );
	update_field( 'ciudad', $p[2], $id );
	update_field( 'habitaciones', $p[3], $id );
	update_field( 'destacada', $p[4] ? 1 : 0, $id );
	update_post_meta( $id, 'referencia_interna', 'REF-' . ( 100 + $i ) );
	wp_set_object_terms( $id, array( $term_id( $p[5] ) ), 'zona' );
}
echo "Datos de prueba listos\n";
