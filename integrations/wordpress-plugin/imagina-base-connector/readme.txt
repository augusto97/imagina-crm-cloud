=== Imagina Base Connector ===
Contributors: imagina
Tags: seo, acf, custom fields, media library, webhooks
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Conecta este sitio con tu cuenta de Imagina Base: SEO, campos personalizados con su tipo, la biblioteca de medios y avisos en tiempo real.

== Description ==

Con este complemento, la app puede:

* Leer y editar el SEO de tus entradas, páginas y términos con Rank Math, Yoast SEO, SEOPress o All in One SEO: el título, la descripción, la palabra clave, la URL canónica y «no indexar». También trae el título y la descripción que ve Google, con las variables ya reemplazadas.
* Traer todos los campos de Advanced Custom Fields (también los que no se muestran en la API REST), Meta Box, JetEngine y los metadatos de otros plugins, cada uno con su tipo.
* Traer el número de palabras de cada entrada, sin traer el contenido.
* Traer la biblioteca de medios con el texto alternativo, el título, la leyenda, la miniatura y en qué entradas se usa cada imagen.
* Recibir un aviso apenas algo cambia en el sitio (guardar, papelera o borrar), firmado y con reintentos, sin hacer más lento el guardado.

El complemento sólo habla con la app a la que te conectaste, usa la misma contraseña de aplicación y respeta los permisos de WordPress del usuario conectado. No trae ni cambia el contenido de las entradas.

== Seguridad y rendimiento ==

* **Nada en las páginas del sitio**: el complemento no suma consultas ni trabajo a lo que ven tus visitantes. Lo que necesita en cada pedido ya lo trae WordPress con sus opciones.
* **Avisos sólo de lo que importa**: un cambio avisa a la app sólo si toca algo que la app sincroniza (el SEO, un campo que trajiste). Los contadores de visitas, el CSS de los constructores de páginas o el stock que baja con una venta no generan avisos. Y a lo sumo hay un envío cada 15 segundos.
* **Consultas acotadas**: «Dónde se usa cada imagen» vive en una tabla propia con índice (se arma una vez, en segundo plano, y se mantiene al guardar). Los campos de otros plugins se descubren mirando una muestra de los 1.000 contenidos más nuevos, no la tabla entera.
* **Los permisos de WordPress**: lee y escribe con el usuario conectado y con sus permisos, objeto por objeto y campo por campo. Nunca ofrece los metadatos internos (los que empiezan con «_») ni los que tienen nombre de credencial (contraseñas, claves de API, tokens).
* **Avisos firmados** (HMAC-SHA256 con la hora dentro de la firma) y sólo por HTTPS. Un usuario que no es Administrador sólo puede mandar avisos a la app de la que descargaste el complemento.
* **Actualizaciones verificadas**: si tu proveedor firma sus versiones, cada actualización se verifica (firma Ed25519 y la huella de cada archivo) antes de instalarse; si algo no cuadra, el sitio sigue con la versión que tenía. Nunca se instala una versión más vieja.
* **Recomendación**: conéctalo con un usuario Editor creado sólo para la app (no con tu cuenta de Administrador).

== Installation ==

1. En la app, en la página de tu sitio, toca «Descargar el complemento».
2. En WordPress, ve a Plugins → Añadir nuevo → Subir plugin, elige el archivo y toca «Instalar ahora».
3. Activa el complemento y vuelve a la app: lo detecta sola.

== Changelog ==

= 1.1.0 =
* Rendimiento: sin consultas propias en las páginas del sitio; los avisos en tiempo real sólo salen por cambios en lo que la app sincroniza (no por contadores de visitas ni metadatos de otros plugins) y a lo sumo uno cada 15 segundos; «Dónde se usa cada imagen» en una tabla con índice (antes recorría el contenido de todas las entradas); el descubrimiento de campos mira una muestra y se guarda 15 minutos; las lecturas en lote cargan todo en una consulta.
* Seguridad: las actualizaciones se verifican con firma antes de instalarse y nunca vuelven a una versión más vieja; el origen de las actualizaciones es un archivo de datos (ya no código); los avisos en tiempo real funcionan con un usuario Editor, pero sólo hacia la app; se respetan los permisos por campo de otros plugins; los metadatos con nombre de credencial no se ofrecen; sólo se leen los tipos de contenido públicos de la API REST.
* Compatibilidad: todo el código lleva un prefijo propio para no chocar con otros plugins; un error de otro plugin al guardar un campo ya no corta el pedido.

= 1.0.0 =
* Primera versión: SEO (Rank Math, Yoast SEO, SEOPress, All in One SEO), campos con su tipo (ACF, Meta Box, JetEngine y metadatos), número de palabras, biblioteca de medios y avisos en tiempo real.
