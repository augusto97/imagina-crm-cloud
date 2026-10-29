<?php
/**
 * Datos de prueba del complemento de WordPress (v0.1.334, ADR-S84). Lo corre
 * `wordpress-up.sh` con `wp eval-file` al instalar el sitio y con el comando
 * `extras` (sitios armados antes). Idempotente: se marca en una opción.
 *
 *  - 4 imágenes en la biblioteca (una con texto alternativo, tres sin él; la
 *    última pesada, para la vista «Imágenes de más de 300 KB»), dos como
 *    imagen destacada y una dentro del contenido de una entrada (para «Dónde
 *    se usa»).
 *  - Los campos de ACF de «Ficha interna» (un grupo SIN «Mostrar en la API
 *    REST»: sólo el complemento los ve) y los de Meta Box.
 */

if ( get_option( 'imagina_dev_seed_plugin' ) ) {
	echo "Los datos del complemento ya estaban\n";
	return;
}

require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';

/** Una imagen de prueba (con GD; si no hay, un PNG de 1×1). */
function imagina_dev_image( $w, $h, $rgb, $noise, $type ) {
	if ( ! function_exists( 'imagecreatetruecolor' ) ) {
		return base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' );
	}
	$im  = imagecreatetruecolor( $w, $h );
	$col = imagecolorallocate( $im, $rgb[0], $rgb[1], $rgb[2] );
	imagefilledrectangle( $im, 0, 0, $w, $h, $col );
	if ( $noise ) {
		// Ruido: no se comprime y el archivo queda pesado.
		for ( $y = 0; $y < $h; $y += 2 ) {
			for ( $x = 0; $x < $w; $x += 2 ) {
				$c = imagecolorallocate( $im, wp_rand( 0, 255 ), wp_rand( 0, 255 ), wp_rand( 0, 255 ) );
				imagefilledrectangle( $im, $x, $y, $x + 1, $y + 1, $c );
			}
		}
	}
	$white = imagecolorallocate( $im, 255, 255, 255 );
	imagefilledrectangle( $im, (int) ( $w * 0.1 ), (int) ( $h * 0.6 ), (int) ( $w * 0.9 ), (int) ( $h * 0.7 ), $white );
	ob_start();
	if ( 'jpg' === $type ) {
		imagejpeg( $im, null, 95 );
	} else {
		imagepng( $im );
	}
	imagedestroy( $im );
	return ob_get_clean();
}

function imagina_dev_attach( $name, $title, $alt, $caption, $bytes ) {
	$up = wp_upload_bits( $name, null, $bytes );
	if ( ! empty( $up['error'] ) ) {
		echo 'No se pudo subir ' . $name . ': ' . $up['error'] . "\n";
		return 0;
	}
	$type = wp_check_filetype( $up['file'] );
	$id   = wp_insert_attachment(
		array(
			'post_mime_type' => $type['type'],
			'post_title'     => $title,
			'post_excerpt'   => $caption,
			'post_status'    => 'inherit',
		),
		$up['file']
	);
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $up['file'] ) );
	if ( '' !== $alt ) {
		update_post_meta( $id, '_wp_attachment_image_alt', $alt );
	}
	return (int) $id;
}

$img1 = imagina_dev_attach( 'fachada-casa-jardin.png', 'Fachada de la casa con jardín', 'Fachada blanca de una casa con jardín al frente', 'La casa vista desde la calle.', imagina_dev_image( 800, 600, array( 46, 125, 50 ), false, 'png' ) );
$img2 = imagina_dev_attach( 'sala-apartamento.png', 'Sala del apartamento céntrico', '', '', imagina_dev_image( 800, 600, array( 21, 101, 192 ), false, 'png' ) );
$img3 = imagina_dev_attach( 'vista-penthouse.png', 'Vista desde el penthouse', '', 'Atardecer desde la terraza.', imagina_dev_image( 640, 480, array( 230, 81, 0 ), false, 'png' ) );
$img4 = imagina_dev_attach( 'plano-finca.jpg', 'Plano de la finca', '', '', imagina_dev_image( 1600, 1200, array( 120, 120, 120 ), true, 'jpg' ) );

// Por orden de alta (no por título: las pruebas cambian los títulos).
$ids_of    = function ( $type ) {
	return array_map( 'intval', get_posts( array( 'post_type' => $type, 'post_status' => array( 'publish', 'draft', 'private' ), 'numberposts' => 20, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ids' ) ) );
};
$props     = $ids_of( 'propiedad' );
$entries   = $ids_of( 'post' );
$casa      = $props[0] ?? 0;
$apto      = $props[1] ?? 0;
$penthouse = $props[5] ?? ( $props ? end( $props ) : 0 );
$guia      = $entries[0] ?? 0;
if ( $casa && $img1 ) {
	set_post_thumbnail( $casa, $img1 );
}
if ( $apto && $img2 ) {
	set_post_thumbnail( $apto, $img2 );
}
if ( $guia && $img2 ) {
	// La misma imagen dentro del contenido de una entrada (bloque de imagen).
	$src  = wp_get_attachment_url( $img2 );
	$post = get_post( $guia );
	wp_update_post(
		array(
			'ID'           => $guia,
			'post_content' => $post->post_content . "\n\n<!-- wp:image {\"id\":" . $img2 . "} -->\n<figure class=\"wp-block-image\"><img src=\"" . esc_url( $src ) . "\" alt=\"\" class=\"wp-image-" . $img2 . "\"/></figure>\n<!-- /wp:image -->",
		)
	);
}

// «Ficha interna» de ACF (no está en la API REST) y los campos de Meta Box.
$ficha = array(
	array( $casa, array( 'Laura Gómez', 3, 'disponible', '20260115', 'Dueño acepta permuta.' ) ),
	array( $apto, array( 'Pedro Ruiz', 2.5, 'reservada', '20260302', '' ) ),
	array( $penthouse, array( 'Laura Gómez', 4, 'disponible', '20251120', 'Mostrar sólo con cita.' ) ),
);
foreach ( $ficha as $pair ) {
	list( $id, $v ) = $pair;
	if ( ! $id ) {
		continue;
	}
	if ( function_exists( 'update_field' ) ) {
		update_field( 'asesor', $v[0], $id );
		update_field( 'comision', $v[1], $id );
		update_field( 'estado_interno', $v[2], $id );
		update_field( 'fecha_captacion', $v[3], $id );
		update_field( 'notas_internas', $v[4], $id );
	}
	update_post_meta( $id, 'mb_codigo_catastral', 'CAT-' . $id );
	update_post_meta( $id, 'mb_estrato', 3 + ( $id % 3 ) );
}
if ( $penthouse ) {
	update_post_meta( $penthouse, 'mb_tiene_parqueadero', 1 );
}

update_option( 'imagina_dev_seed_plugin', 1, false );
printf( "Datos del complemento listos (imágenes %d, %d, %d, %d)\n", $img1, $img2, $img3, $img4 );
