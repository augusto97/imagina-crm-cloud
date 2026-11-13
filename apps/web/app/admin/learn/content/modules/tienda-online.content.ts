import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-online-crear',
        route: '/lists',
        related: ['tienda-online-comprar', 'tienda-online-pedidos', 'formularios-publicar'],
        blocks: [
            {
                t: 'p',
                md: 'Si ya tienes una lista con tus productos (o servicios), puedes venderlos con una **tienda**: una página pública donde tus clientes ven el catálogo, arman su carrito y te hacen el pedido. Cada registro de la lista es un producto, y lo que cambias en la lista (un precio, una foto, el stock) se ve en la tienda en menos de un minuto.',
            },
            { t: 'anim', key: 'tienda-vitrina', caption: 'La lista se ve como una vitrina, el cliente hace el pedido y el stock baja solo.' },
            { t: 'h', text: 'Crear la tienda' },
            {
                t: 'steps',
                items: [
                    'Abre la lista de tus productos y toca **Configurar lista → Tienda**.',
                    'Escribe el nombre de la tienda y toca **Crear la tienda**.',
                    'Se crean tres listas nuevas, en la misma carpeta: **Pedidos**, **Líneas de pedido** (cada producto de cada pedido) y **Clientes**, y un tablero de ventas.',
                    'Se abre el editor de la tienda, con la vista previa a la derecha.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: '¿Varias tiendas con los mismos productos?',
                md: 'Puedes crear otra tienda con la misma lista (por ejemplo, una para mayoristas con otros textos). En **Configurar lista → Tienda**, toca **Otra tienda con estos productos**.',
            },
            { t: 'h', text: 'Productos: qué campo es cada cosa' },
            {
                t: 'settings',
                title: 'En la sección Productos',
                rows: [
                    { name: 'Nombre', what: 'El título del producto. Si no eliges, se usa el campo de título de la lista.' },
                    { name: 'Precio', what: 'Un campo de moneda o número. Es obligatorio: sin precio la tienda no se publica.' },
                    { name: 'Precio antes', what: 'Si es mayor que el precio, se muestra tachado (una oferta).', tip: 'Opcional.' },
                    { name: 'Foto', what: 'Un campo de archivos (fotos subidas) o un enlace mostrado como imagen. Las fotos se achican solas para que la página cargue rápido.' },
                    { name: 'Descripción corta', what: 'Un texto de una o dos frases que sale en la tarjeta y arriba en la ficha, junto al botón de comprar. La descripción completa va más abajo en la ficha.', tip: 'Opcional. Se elige sola si la columna se llama «Descripción corta», «Resumen» o «Extracto», y puedes ocultarla de las tarjetas en Apariencia.' },
                    { name: 'Categoría', what: 'Una selección o un texto: arma los filtros de la tienda («Cocina», «Ropa»…).' },
                    { name: 'Stock', what: 'Un número. Cada compra lo descuenta; en cero el producto sale como agotado. Un producto con el stock vacío se vende sin límite.' },
                    { name: 'Se vende', what: 'Una casilla: los registros sin marcar no aparecen en la tienda.', tip: 'Sirve para esconder un producto sin borrarlo.' },
                ],
            },
            {
                t: 'p',
                md: 'La app elige sola los campos por su nombre («Precio», «Stock», «Foto»…): revisa que estén bien. La moneda sale del campo del precio.',
            },
            { t: 'h', text: 'Productos con variantes: tallas, colores y más' },
            {
                t: 'p',
                md: 'Si un producto se vende en varias opciones (talla, color, tamaño), activa **Variantes** en la sección **Productos**. Cada combinación es una **subtarea** del producto en tu lista («Camiseta» → «M / Rojo», «L / Azul»), con su propio precio, stock, referencia y foto. En la tienda, tu cliente elige la talla y el color y compra esa variante.',
            },
            {
                t: 'steps',
                items: [
                    'En **Productos → Variantes**, activa **Productos con variantes**.',
                    'Elige hasta tres campos de la variante, como «Talla» y «Color» (de selección o de texto). Si todavía no existen, créalos en la lista.',
                    'Toca **Crear variantes de un producto**, busca el producto y marca los valores de cada campo (S, M, L × Rojo, Azul).',
                    'Escribe el precio y el stock si son los mismos para todas, y toca **Crear**. Se crean sólo las combinaciones que faltan.',
                ],
            },
            {
                t: 'settings',
                title: 'Qué toma cada variante',
                rows: [
                    { name: 'Precio', what: 'El de la variante; si lo dejas vacío, el del producto. La tarjeta muestra «Desde» con el más bajo.' },
                    { name: 'Stock', what: 'El de cada variante, por separado. El producto muestra la suma.', tip: 'Vacío = sin límite.' },
                    { name: 'Foto', what: 'La de la variante; si no tiene, las del producto.' },
                    { name: 'Referencia (SKU)', what: 'La de la variante; al crearlas se arma sola: CAM-01-M-ROJO.' },
                    { name: 'Se vende', what: 'Se decide en el producto: si lo escondes, se esconden todas sus variantes.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo agotado se ve tachado',
                md: 'Si una combinación no tiene stock, tu cliente la ve tachada; si no existe (no vendes la S en azul), no se puede elegir. El pedido guarda la variante exacta y el stock se descuenta de ella.',
            },
            { t: 'h', text: 'Vender por hora, por año o por kilo' },
            {
                t: 'p',
                md: 'Cada producto decide en qué se vende y cuánto se puede comprar. Una asesoría se vende por horas y desde 2; un café, por kilo y de a medio kilo; una licencia, por año y como máximo 5. Todo sale de cuatro columnas de tu lista, así que cada producto tiene lo suyo y lo que dejes vacío queda como siempre: por unidad, desde 1 y de a 1.',
            },
            {
                t: 'steps',
                items: [
                    'En **Productos → Unidades y cantidades**, toca **Crear las columnas**: se agregan a tu lista «Unidad de venta», «Cantidad mínima», «Cantidad máxima» y «De a cuánto», y quedan elegidas. Si ya tienes columnas así, elígelas ahí.',
                    'En tu lista, llena la unidad de cada producto que no se vende por unidad: «hora», «año», «kg», «licencia». El plural se arma solo («horas»); si es especial, escríbelo así: «mes/meses».',
                    'Escribe el mínimo, el máximo y de a cuánto se compra sólo donde haga falta. Para vender por kilo con decimales, pon «De a cuánto» en 0,5 (o 0,25).',
                ],
            },
            {
                t: 'settings',
                title: 'Cómo lo ve tu cliente',
                rows: [
                    { name: 'Precio', what: 'Con la unidad al lado: «$ 50.000 / hora».' },
                    { name: 'Cantidad', what: 'El selector sube y baja de a lo que dice «De a cuánto» y también se puede escribir (1,5 kg). Si escribe 1,3 con «de a 0,5», queda en 1,5.' },
                    { name: 'Regla', what: 'Debajo del stock, en una frase: «Mínimo 2 horas · máximo 40 horas».' },
                    { name: 'Carrito y pedido', what: '«Asesoría · 3 horas», «Café · 1,5 kg». En **Líneas de pedido** se guarda la cantidad con decimales y la columna **Unidad**.' },
                    { name: 'Stock', what: 'Se cuenta en la misma unidad: con 3,2 kg y de a 0,5, se pueden pedir hasta 3 kg.', tip: 'Si vendes con decimales, la columna de stock también necesita decimales (en sus ajustes).' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Las variantes heredan',
                md: 'Una variante usa la unidad y las cantidades de su producto si las dejas vacías, y las suyas si las llenas: el café molido y el café en grano pueden venderse distinto.',
            },
            { t: 'h', text: 'Productos digitales, servicios y suscripciones' },
            {
                t: 'p',
                md: 'No todo lo que vendes se envía. En **Productos → Tipos de producto** le dices a la tienda qué es cada producto: con una columna **Tipo** (Físico, Digital, Servicio o Suscripción) y una columna con los **archivos para descargar**. Si no las tienes, la tienda te ofrece crearlas con un clic. Sin columna «Tipo», un producto que tiene archivos se vende como digital.',
            },
            {
                t: 'settings',
                title: 'Cómo se vende cada tipo',
                rows: [
                    { name: 'Físico', what: 'Como siempre: va al carrito, se elige la entrega y se descuenta el stock.' },
                    { name: 'Digital', what: 'Un curso, una guía, una plantilla. No pide entrega ni dirección; cuando el pedido queda pagado, el enlace de descarga llega por correo y aparece en la página del pedido.', tip: 'Tú eliges cuántos días sirve el enlace (30 por defecto) y cuántas veces se puede bajar cada archivo (5 por defecto, o sin límite).' },
                    { name: 'Servicio', what: 'Una asesoría, una clase, un masaje. No va al carrito: su botón **Agendar** abre tu agenda con el servicio ya elegido, y tu cliente sólo escoge el día y la hora.', tip: 'Elige la agenda en esta misma sección. Cada producto va al servicio con el mismo nombre, o al que elijas tú.' },
                    { name: 'Suscripción', what: 'Una caja mensual, una membresía, una mensualidad. No va al carrito: su botón **Suscribirme** lleva a Mercado Pago o PayPal para autorizar la tarjeta una sola vez, y los cobros se hacen solos cada período. El pedido queda pagado cuando tu cliente autoriza la tarjeta.', tip: 'Cada producto usa el plan de suscripción con el mismo nombre, o el que elijas tú. Los planes se crean en **Ajustes → Integraciones → Cobros**; se cobra el precio del producto. Si mandas algo cada mes, activa **Pedir la dirección de entrega al suscribirse**. El stock, si lo escribes, son los cupos.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Gratis también se puede',
                md: 'Un producto de $0 (una guía de regalo, por ejemplo) se pide sin pasar por el pago: el pedido queda pagado al momento y, si es digital, la descarga llega enseguida. Sirve para armar tu lista de clientes.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Si cambio el archivo del producto, cambia lo que bajan los que ya compraron?', a: 'No: cada pedido guarda los archivos que tenía el producto cuando se compró. Los pedidos nuevos reciben el archivo nuevo.' },
                    { q: '¿Un servicio no aparece con el botón Agendar?', a: 'Revisa que la agenda esté publicada, que tenga ese servicio activo y que alguien lo atienda. Si no, la tarjeta dice que no se agenda en línea.' },
                    { q: '¿Dónde veo los cobros de una suscripción?', a: 'Abre el pedido: la sección **Suscripción** muestra cada cobro, si alguno se rechazó y el próximo. Desde ahí la pausas, cambias el valor o la cancelas.' },
                    { q: '¿Y si mi cliente perdió el correo con la descarga?', a: 'En la tienda, **Mis pedidos** le manda a su correo un enlace con todos sus pedidos y sus descargas. También puedes abrir el pedido y tocar **Reenviar las descargas**.' },
                ],
            },
            { t: 'h', text: 'Quién vende y las políticas' },
            {
                t: 'p',
                md: 'El Estatuto del Consumidor (Ley 1480 de 2011) pide mostrar quién vende y las condiciones **antes** de comprar. Por eso, en **Quién vende**, la tienda no se publica hasta que completes la razón social o el nombre, el NIT o la cédula, la dirección y la ciudad, un correo o teléfono de contacto y la política de devoluciones y retracto (trae un texto sugerido que puedes ajustar).',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'No es facturación electrónica',
                md: 'La tienda recibe pedidos; no emite la factura electrónica de la DIAN. Si la necesitas, sigue haciéndola con tu sistema de facturación.',
            },
            { t: 'h', text: 'Cómo se ve tu tienda' },
            { t: 'anim', key: 'tienda-vitrina', caption: 'La vitrina con tu estilo: encabezado, portada y tarjetas.' },
            {
                t: 'p',
                md: 'En **Estilo** decides cómo se ve la tienda. Empieza por una **plantilla** y ajusta lo que quieras: la vista previa de la derecha cambia al momento. Las plantillas sólo cambian el aspecto: tus productos, textos y la foto de la portada se conservan.',
            },
            {
                t: 'p',
                md: '**Toca la vista previa para ir al ajuste.** Al pasar el mouse por una parte de la tienda se marca con su nombre y dónde se cambia («Foto · Estilo», «Precio · Productos»); al tocarla, el editor abre esa sección y te lleva al ajuste. Para recorrer la tienda como un cliente (abrir productos, llenar el carrito), cambia a **Navegar** arriba de la vista previa.',
            },
            {
                t: 'settings',
                title: 'Estilo',
                rows: [
                    { name: 'Plantillas', what: 'Clásica, Minimalista, Boutique, Moderna, Mercado y Noche: colores, letra y formas que combinan.', tip: 'Puedes elegir una y después cambiar lo que quieras.' },
                    { name: 'Modo', what: 'Claro, oscuro o **automático**: se ve claro u oscuro según el celular o computador de cada persona.', tip: 'Con automático, la vista previa trae un botón para ver las dos.' },
                    { name: 'Colores', what: 'El color de la tienda (botones y precios), el fondo, las tarjetas y el texto. Si un texto no se lee bien sobre el fondo, se corrige solo.' },
                    { name: 'Letra', what: 'La de los textos y la de los títulos (por ejemplo, títulos con serifa), el tamaño y qué tan gruesos van los títulos.' },
                    { name: 'Encabezado', what: 'Blanco, de tu color, oscuro o sin fondo; el logo y su tamaño, a la izquierda o al centro, y si queda fijo arriba al bajar.' },
                    { name: 'Portada', what: 'Sencilla, a lo ancho (con una foto, cuánto se oscurece para que el título se lea, y su alto) o sin portada. Aquí también van el título y la descripción de la tienda.' },
                    { name: 'Tarjetas y botones', what: 'Con borde, con sombra, planas o sin fondo; esquinas rectas, suaves o redondas; texto a la izquierda o al centro; botón relleno o con contorno; el espacio entre productos y el ancho de la página.' },
                    { name: 'Fotos de los productos', what: 'La forma de la foto en la vitrina y en la ficha (cuadrada, vertical, horizontal, alta, de cámara o panorámica; en la ficha también «como es»), si se ve completa o recortada, las esquinas (como las tarjetas, rectas, suaves, redondas o en círculo), un borde con su grosor y color, un margen dentro de la tarjeta, una sombra y el color detrás de la foto.', tip: 'Con fotos de distintos tamaños, «completa» con un color detrás deja la vitrina pareja sin cortar nada.' },
                    { name: 'CSS propio', what: 'Para retoques finos. Lo agrega un administrador de la empresa y nunca puede cargar nada de afuera.' },
                ],
            },
            { t: 'h', text: 'Cómo se ve un producto al abrirlo' },
            {
                t: 'p',
                md: 'En **Estilo → Ficha del producto** eliges cómo se ve un producto cuando lo tocan. Al elegir un diseño, la vista previa abre un producto para que lo veas.',
            },
            {
                t: 'settings',
                title: 'Ficha del producto',
                rows: [
                    { name: 'Clásica', what: 'La foto a la izquierda y el nombre, el precio, la descripción corta y los botones a la derecha. Al bajar, la foto se queda a la vista.', tip: 'Es la que viene elegida.' },
                    { name: 'Descripción abajo', what: 'Como la clásica, pero la descripción completa va debajo, a lo ancho.', tip: 'Para descripciones largas, con tablas o fotos.' },
                    { name: 'Foto arriba', what: 'Una sola columna: la foto grande arriba y todo lo demás debajo.' },
                    { name: 'Compacta', what: 'Una ventana chica: la foto pequeña junto al nombre y el precio.', tip: 'Para productos donde la foto importa poco (servicios, recargas).' },
                    { name: 'Pantalla completa', what: 'La ficha ocupa toda la pantalla, como la página de un producto.' },
                    { name: 'Forma de la foto', what: 'Se elige en **Estilo → Fotos de los productos**: como es la foto (sin recortar ni franjas) o una forma fija, y si se ve completa o recortada para llenar el recuadro.' },
                    { name: 'Cómo se entrega', what: 'Junto al botón aparece «Envío a domicilio (2 a 3 días) · Recoger en el local» y desde cuánto es gratis.' },
                    { name: 'Barra de compra fija en el celular', what: 'Al bajar por la ficha en el celular, el precio y el botón quedan siempre abajo.' },
                ],
            },
            { t: 'h', text: 'Cómo se ve el pago' },
            {
                t: 'p',
                md: 'En **Estilo → Pago** eliges cómo se ve la página donde tu cliente escribe sus datos, elige la entrega y paga. Toca **Ver el pago en la vista previa** para recorrerla con productos de ejemplo (ahí no se hace ningún pedido).',
            },
            {
                t: 'settings',
                title: 'Pago',
                rows: [
                    { name: 'Clásico', what: 'El de siempre: el formulario a la izquierda y el resumen en una tarjeta a la derecha, con el encabezado de la tienda.', tip: 'Es el que viene elegido.' },
                    { name: 'Dos columnas', what: 'Una página limpia: el formulario a la izquierda y el pedido con las fotos de los productos en una columna aparte, a la derecha.', tip: 'El más usado por las tiendas en línea.' },
                    { name: 'Por pasos', what: 'Como «Dos columnas», pero de a un paso: tus datos, la entrega y el pago. Lo ya llenado queda arriba con «Cambiar» para corregirlo.', tip: 'Ayuda cuando pides muchos datos.' },
                    { name: 'Una columna', what: 'Todo en una columna angosta: el pedido arriba (se despliega) y después los datos y el pago, en secciones numeradas.', tip: 'Muy cómodo en el celular.' },
                    { name: 'Arriba del pago', what: 'Sólo el logo (para que nada distraiga) o el encabezado completo de la tienda.' },
                    { name: 'Nombres de los campos', what: 'Arriba del campo, o adentro: el nombre se achica al escribir y la página se ve más limpia.' },
                    { name: 'Fotos de los productos en el resumen', what: 'Cada producto con su foto y la cantidad encima.' },
                    { name: 'En el celular, el resumen abierto', what: 'Si está apagado, arriba queda una barra con el total que lo despliega.' },
                    { name: '«Compra segura»', what: 'Un candado bajo el botón de pagar con «tus datos viajan cifrados».' },
                    { name: 'Fondo del resumen', what: 'El color de la columna del pedido. Si no eliges uno, es un gris suave; si el texto no se lee sobre el que elijas, se corrige solo.' },
                ],
            },
            { t: 'h', text: 'Qué pasa al agregar al carrito' },
            {
                t: 'p',
                md: 'En **Apariencia → Al agregar al carrito** eliges lo que ve tu cliente después de tocar «Agregar al carrito». En la ficha de cada producto, además, elige cuántos antes de agregar.',
            },
            {
                t: 'settings',
                title: 'Al agregar al carrito',
                rows: [
                    { name: 'Se abre el carrito al costado', what: 'El carrito se abre a un lado con lo que agregó marcado y el total, y puede seguir comprando o finalizar.', tip: 'Es lo que viene elegido.' },
                    { name: 'Un aviso y sigue mirando', what: 'Sale un aviso abajo con «Ver carrito» y la persona sigue en la vitrina.', tip: 'Bueno para quien compra varias cosas.' },
                    { name: 'Va a la página del carrito', what: 'Pasa a una página con el carrito completo, el subtotal y «Finalizar compra». El botón del carrito de arriba también lleva ahí.' },
                    { name: 'Va directo al pago', what: 'Agregar lleva directo a pagar: para una tienda de un solo producto o compras rápidas.', tip: 'Quizás quieras que el botón diga «Comprar».' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'El botón «Comprar ahora»',
                md: 'Con el carrito al costado, el aviso o la página del carrito, la ficha del producto puede llevar **Comprar ahora**: agrega el producto y va directo al pago. Lo apagas en **Apariencia** y cambias su texto en **Textos de los botones**.',
            },
            { t: 'h', text: 'Publicar y compartir' },
            {
                t: 'steps',
                items: [
                    'En la sección **Publicar**, mira **Lo que falta para publicarla**: cada punto te lleva a donde se arregla.',
                    'Toca **Publicar**. Desde ese momento cualquiera con el enlace puede comprar.',
                    'Toca **Compartir** (arriba del editor). En **Enlace y QR** copias el enlace, lo mandas por WhatsApp o correo, o descargas el **código QR** para imprimirlo.',
                ],
            },
            { t: 'h', text: 'Vender en tu sitio web' },
            { t: 'anim', key: 'form-embed-side', caption: 'La tienda se abre en un panel al costado de tu página: tu cliente compra sin salir de tu sitio.' },
            {
                t: 'p',
                md: 'En **Compartir → Insertar en tu sitio** eliges cómo aparece la tienda en tu página web. La vista previa de la derecha la muestra funcionando (puedes navegarla y llenar el carrito; ahí no se hace ningún pedido).',
            },
            {
                t: 'settings',
                title: 'Cómo va en tu sitio',
                rows: [
                    { name: 'En la página', what: 'La tienda completa dentro del contenido de tu página, con su propio scroll.', tip: 'Ocupa 900 px de alto; lo cambias en el código.' },
                    { name: 'Ventana al hacer clic', what: 'Un botón (por ejemplo «Ver la tienda») la abre en una ventana grande al centro, en un panel desde un costado o a pantalla completa, con una barra con el nombre y la X para cerrar.', tip: 'Escape también la cierra.' },
                    { name: 'Botón flotante', what: 'Fijo en una esquina de todas las páginas donde lo pegues, como el de un chat.' },
                ],
            },
            {
                t: 'steps',
                items: [
                    'Elige la forma, el texto y el color del botón, y toca **Copiar código**.',
                    'Pégalo en tu sitio (en WordPress, en un bloque «HTML personalizado»).',
                    'Para un producto en particular, abre **Botón «Comprar» de un producto**, elige el producto y en **Al hacer clic** decide si el botón **abre la tienda en ese producto**, **lo agrega y lleva directo al pago** o **lo agrega y abre el carrito** (con la cantidad y, si tiene, la talla o el color). Copia el código y ponlo al lado de su foto o su precio.',
                    'Si tienes un **widget de contacto**, súmale el botón **Ver la tienda**: la tienda se abre dentro del panel del widget.',
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Enlaces que arman el carrito',
                md: 'El mismo **Botón «Comprar» de un producto** te da el enlace para una publicación, un anuncio o un correo. Con **abre la tienda en el producto** el enlace termina en `?producto=` y el número; con **lo agrega y lleva al pago**, en `?comprar=` y el número (`:2` para dos unidades); con **lo agrega y abre el carrito**, en `?agregar=`. Quien lo abre ya tiene el producto en el carrito.',
            },
            { t: 'h', text: 'Tu dominio y Google' },
            { t: 'anim', key: 'portal-domain', caption: 'Tu tienda en tu dominio: lo pides, pruebas que es tuyo y lo apuntas a la app.' },
            {
                t: 'p',
                md: 'En **Dominio y Google** pones la tienda en tu propio dominio (por ejemplo **tienda.tuempresa.com**). Ahí cada producto tiene su dirección con su nombre, la tienda le cuenta a Google el precio y si hay stock, y al compartir el enlace en WhatsApp se ve la foto. Lo configura un administrador de la empresa.',
            },
            {
                t: 'steps',
                items: [
                    'Escribe el dominio y toca **Guardar**: queda pendiente.',
                    'En el panel de tu dominio crea el registro **TXT** que te muestra la app y toca **Verificar propiedad**.',
                    'Crea el **CNAME** hacia la dirección que te indica y toca **Comprobar apuntamiento**. Cuando diga **El dominio responde**, la tienda ya abre ahí y los enlaces de los pedidos salen por tu dominio.',
                    'En **Aparecer en Google** elige el título y la descripción que muestra Google (la vista previa te enseña cómo se ve). Después agrega tu dominio en **Google Search Console** y envía **tu-dominio/sitemap.xml**.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Sólo tu dominio aparece en Google',
                md: 'La dirección de la plataforma (la del enlace de siempre) nunca se muestra en buscadores, y sigue funcionando aunque pongas tu dominio. Si apagas **Dejar que Google muestre la tienda**, la tienda abre igual en tu dominio pero Google no la lista.',
            },
            {
                t: 'example',
                title: 'Una tostadora de café en Manizales',
                md: 'Tenían su lista **Productos** con el café por libra, el precio y el stock. Crearon la tienda, activaron el pedido por WhatsApp y pegaron el QR en las bolsas: los clientes que vuelven a comprar escanean, eligen y les llega el pedido armado al WhatsApp del negocio.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Google muestra mi tienda?', a: 'Sólo si la pones en tu propio dominio (**Dominio y Google**): ahí cada producto tiene su dirección y Google la puede mostrar. La dirección de la plataforma nunca aparece en los buscadores.' },
                    { q: '¿Puedo usar el color de mi marca?', a: 'Sí. En **Estilo → Colores** la tienda usa el color de tu marca o el que elijas, y ahí mismo cambias el fondo, las tarjetas y el texto.' },
                    { q: '¿La tienda se ve oscura en los celulares en modo oscuro?', a: 'Sólo si eliges el modo **Oscuro** o **Automático** en **Estilo**. Con **Claro** se ve siempre clara.' },
                    { q: '¿Puedo vender servicios por hora y productos por unidad en la misma tienda?', a: 'Sí. Cada producto dice su unidad en su columna: los que la dejan vacía se venden por unidad, como siempre.' },
                    { q: '¿Puedo vender un producto con variantes y otros sin ellas?', a: 'Sí. Un producto sin subtareas se vende como siempre; uno con variantes pide elegir la opción antes de agregarlo al carrito.' },
                    { q: '¿Qué pasa si borro la tienda?', a: 'Se apaga la página. Los pedidos, las líneas y los clientes quedan en sus listas, como listas comunes.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Cómo compran tus clientes', article: 'tienda-online-comprar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-online-comprar',
        route: '/lists',
        related: ['tienda-online-crear', 'tienda-online-pedidos', 'wab-cual-elegir'],
        blocks: [
            {
                t: 'p',
                md: 'En la tienda, tu cliente busca o filtra por categoría, abre un producto, lo agrega al carrito y toca **Finalizar compra**. Ahí elige cómo lo recibe y cómo paga, escribe sus datos y hace el pedido. El carrito se recuerda en su teléfono aunque cierre la página.',
            },
            { t: 'anim', key: 'tienda-vitrina', caption: 'Agregar al carrito, hacer el pedido y el registro nuevo en Pedidos.' },
            { t: 'h', text: 'Formas de pago' },
            {
                t: 'cards',
                items: [
                    { icon: 'CreditCard', title: 'Pago en línea', md: 'Con tarjeta, PSE, Nequi o PayPal, con la cuenta de **Mercado Pago**, **Wompi** o **PayPal** de tu empresa (la misma de los links de pago). Al hacer el pedido lo llevamos a pagar y, cuando paga, el pedido queda **pagado solo**.', tone: 'violet' },
                    { icon: 'MessageCircle', title: 'Pedido por WhatsApp', md: 'El pedido queda guardado y tu cliente lo manda a tu WhatsApp ya escrito (productos, total, entrega y su dirección). Tu número nunca aparece en la página: sale sólo al tocar el botón.', tone: 'mint' },
                    { icon: 'Building2', title: 'Transferencia', md: 'Al terminar ve los datos de tu cuenta (los escribes tú en **Pago y entrega**) y el número de su pedido para el comprobante.', tone: 'blue' },
                    { icon: 'Wallet', title: 'Contra entrega', md: 'Paga cuando recibe. Escribe las instrucciones (efectivo, datáfono…) para que sepa qué esperar.', tone: 'amber' },
                ],
            },
            { t: 'h', text: 'Cómo funciona el pago en línea' },
            {
                t: 'steps',
                items: [
                    'En **Pago y entrega**, activa **Pago en línea** y elige la cuenta de cobro del equipo. Si no tienes ninguna, conéctala en **Ajustes → Integraciones**.',
                    'Elige **cuánto tiempo tiene para pagar** (30 minutos, por defecto). Mientras tanto, el stock queda apartado para ese pedido.',
                    'Tu cliente hace el pedido y lo llevamos a pagar. Si cierra la página, le llega un correo con el botón **Pagar mi pedido**.',
                    'Cuando paga, el pedido queda **Pagado**, a ti te llega el aviso y a tu cliente la confirmación. Si no paga a tiempo, el pedido se cancela solo y el stock vuelve a la tienda.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Si el pago llega tarde',
                md: 'Si tu cliente paga después del plazo y todavía queda stock, el pedido se reactiva solo. Si ya no queda, el pedido sigue cancelado pero pagado, y te llega un aviso para conseguir el producto o devolver el dinero. Wompi sólo cobra en pesos colombianos y PayPal no cobra en pesos: la tienda te avisa si la moneda no corresponde.',
            },
            { t: 'h', text: 'Formas de entrega' },
            {
                t: 'settings',
                title: 'En Pago y entrega',
                rows: [
                    { name: 'Nombre y descripción', what: 'Lo que ve tu cliente: «Envío a domicilio en Bogotá», «Recoger en el local».' },
                    { name: 'Precio', what: 'Se suma al total del pedido. En cero, la entrega es gratis.' },
                    { name: 'Pide dirección', what: 'Encendido para envíos a domicilio (pide dirección y ciudad); apagado para recoger en el local o productos que no se envían.' },
                    { name: 'Tiempo de entrega', what: 'Opcional: «2 a 4 días hábiles». Tu cliente lo ve al elegir la entrega.' },
                    { name: 'Envío gratis desde', what: 'Opcional: cuando los productos (con el descuento del cupón) llegan a ese monto, el envío sale gratis. Mientras tanto, tu cliente ve cuánto le falta.' },
                    { name: 'Zonas de envío', what: 'Opcional, en las entregas con dirección: tu ciudad, el área metropolitana, el resto del país… cada una con su costo, su tiempo y su «gratis desde». Tu cliente elige la zona y paga lo de esa zona.' },
                ],
            },
            { t: 'h', text: 'Cupones de descuento' },
            {
                t: 'p',
                md: 'En la sección **Cupones** de tu tienda creas códigos que tu cliente escribe al finalizar la compra. Ve el descuento en el resumen antes de pagar, y el pedido guarda el cupón y lo que se descontó.',
            },
            {
                t: 'settings',
                title: 'Al crear un cupón',
                rows: [
                    { name: 'Código', what: 'Letras, números, guion o guion bajo («BIENVENIDA10»). Tu cliente lo escribe sin importar mayúsculas.' },
                    { name: 'Qué da', what: 'Un **porcentaje** de descuento, un **monto fijo** o el **envío gratis**.' },
                    { name: 'Compra mínima', what: 'Opcional: sólo sirve desde ese monto en productos.' },
                    { name: 'Veces que se puede usar', what: 'En total (por ejemplo, los primeros 50) y, si quieres, **una sola vez por cliente** (por su correo).' },
                    { name: 'Desde y hasta', what: 'Las fechas en las que sirve, en la zona horaria de tu empresa.' },
                    { name: 'A qué aplica', what: 'Toda la tienda, o sólo algunos productos o categorías. Un producto con variantes incluye todas sus variantes.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Repártelo con el cupón ya puesto',
                md: 'Agrega `?cupon=CODIGO` al enlace de tu tienda (por ejemplo, en una campaña o un mensaje de WhatsApp). Tu cliente lo ve aplicado al finalizar la compra, sin escribir nada.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si cancelo un pedido que usó un cupón?', a: 'El uso vuelve: si el cupón tenía un límite, se puede volver a usar una vez más. Si el cliente pagó tarde y el pedido se reactiva, el uso cuenta de nuevo.' },
                    { q: '¿Y si borro un cupón?', a: 'Deja de servir en la tienda, pero los pedidos que ya lo usaron conservan el código y el descuento.' },
                    { q: '¿Pueden adivinar mis cupones?', a: 'No sin que se note: la tienda frena a quien prueba muchos códigos que no existen desde el mismo lugar.' },
                ],
            },
            { t: 'h', text: 'Lo que le pides a quien compra' },
            {
                t: 'p',
                md: 'En **Datos y avisos → Lo que se pide al comprar** decides qué datos pides. El **nombre** y el **correo** se piden siempre: al correo le llega la confirmación del pedido. La **dirección** y la **ciudad** las pide la forma de entrega (sólo cuando es a domicilio). Los demás los eliges tú:',
            },
            {
                t: 'settings',
                title: 'Lo que se pide al comprar',
                rows: [
                    { name: 'Celular', what: '**No pedirlo**, **Opcional** u **Obligatorio**. Obligatorio exige al menos 7 números.', tip: 'Cámbiale el nombre a «WhatsApp» si es por ahí que le escribes.' },
                    { name: 'Cédula o NIT', what: 'Igual: no pedirla, opcional u obligatoria, con el nombre de tu país («RUT», «DNI», «RFC»).' },
                    { name: 'Notas', what: 'Un espacio para indicaciones (talla, color, horario de entrega). También se puede volver obligatorio y cambiarle el nombre.' },
                ],
            },
            {
                t: 'p',
                md: 'Debajo, en **Preguntas propias**, toca **Agregar una pregunta** para pedir lo que tu negocio necesita: «Barrio», «¿Cómo nos conociste?», «Fecha del evento», «Mensaje para la tarjeta». Cada respuesta se guarda en **su columna de «Pedidos»**: la crea la tienda al guardar (o eliges una que ya tengas en **Se guarda en**), así la puedes filtrar, agrupar y usar en tus automatizaciones.',
            },
            {
                t: 'settings',
                title: 'Cada pregunta',
                rows: [
                    { name: 'Tipo de respuesta', what: 'Texto corto, texto largo, número, una opción de una lista, casilla (sí o no) o fecha.', tip: 'En una lista, escribe una opción por renglón.' },
                    { name: 'Dónde va', what: '**Con «Tus datos»**, **Con la dirección de entrega** (sólo se pide cuando la entrega es a domicilio) o **Al final, antes de pagar**.' },
                    { name: 'Opcional u obligatoria', what: 'Si es obligatoria, el pedido no se hace sin ella y la página marca la pregunta con lo que falta. Una casilla obligatoria se tiene que marcar.' },
                    { name: 'Ayuda y ejemplo', what: 'Una línea debajo de la pregunta y un ejemplo dentro del campo, los dos opcionales.' },
                ],
            },
            {
                t: 'p',
                md: 'Las respuestas también llegan en el **correo de confirmación** («Lo que nos contaste») y en el **mensaje de WhatsApp** del pedido. Además, en **Datos y avisos** eliges si tiene que aceptar los términos, una **compra mínima** y si le llega el correo de confirmación (sale por el correo de tu empresa). Si tu empresa pide la autorización de datos personales, la tienda la muestra y la guarda con cada pedido.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Precios y stock siempre al día',
                md: 'Al hacer el pedido, la app vuelve a leer el precio y el stock de tu lista. Si algo cambió (se agotó, subió el precio), el pedido no se crea y la página le muestra a tu cliente qué cambió para que lo revise. Dos personas comprando la última unidad a la vez: sólo una se la lleva.',
            },
            { t: 'h', text: 'Los avisos de cada pedido' },
            {
                t: 'p',
                md: 'Cada pedido nuevo llega a la **campana** (y al celular si activaste las notificaciones) de las personas que elijas en **Datos y avisos**; si no eliges a nadie, le llega a quien creó la tienda. También puedes armar una automatización con **Cuando se crea un registro** en la lista **Pedidos**: por ejemplo, mandarle un WhatsApp de gracias al cliente.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo poner la tienda dentro de mi sitio web?', a: 'Sí. En **Compartir → Insertar en tu sitio** eliges si va dentro de la página, en una ventana o panel al tocar un botón, o con un botón flotante, y copias el código. En **Sitios que pueden insertarla** eliges en qué sitios se puede mostrar.' },
                    { q: '¿Qué ve mi cliente después de comprar?', a: 'Una página con su pedido: el número, los productos, el total, cómo pagar y el estado, que se actualiza cuando lo cambias en la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Atender los pedidos', article: 'tienda-online-pedidos' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-online-pedidos',
        route: '/lists',
        related: ['tienda-online-crear', 'tienda-online-comprar'],
        blocks: [
            {
                t: 'p',
                md: 'Cada compra llega como un registro de **Pedidos**, con su número (PED-0001…), el cliente, el total, la forma de pago y una línea por producto en **Líneas de pedido**. El cliente queda en **Clientes**: si vuelve a comprar con el mismo correo, se usa el mismo registro.',
            },
            { t: 'anim', key: 'tienda-pedido', caption: 'Marcar como pagado y cancelar un pedido devuelve el stock.' },
            { t: 'h', text: 'El estado del pedido' },
            {
                t: 'p',
                md: 'La columna **Estado** del pedido la manejas tú: **Nuevo**, **En preparación**, **Enviado**, **Entregado** o **Cancelado**. Tu cliente ve el estado en la página de su pedido. Usa la vista **Por estado** (un tablero kanban) para moverlos arrastrando.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Las columnas que cuida la tienda',
                md: 'El total, los productos, la forma y el estado del pago, el correo y el cliente los escribe la tienda: llevan un candado para que el pedido no quede distinto de lo que se compró. Sí puedes cambiar el estado del pedido, la dirección, las notas y cualquier columna que agregues tú.',
            },
            { t: 'h', text: 'Marcar como pagado' },
            {
                t: 'steps',
                items: [
                    'Cuando te llega la transferencia o te pagan al entregar, abre el pedido.',
                    'En el recuadro del pedido (arriba de los campos), toca **Marcar como pagado** y confirma.',
                    'El estado del pago pasa a **Pagado** y queda la fecha. Si tienes una automatización que corre al cambiar el registro, corre sola.',
                    'Si el pedido tiene productos digitales, en ese momento le llega a tu cliente el correo con las descargas. ¿Lo perdió? Toca **Reenviar las descargas** en el mismo recuadro.',
                ],
            },
            { t: 'h', text: 'Cancelar devuelve el stock' },
            {
                t: 'p',
                md: 'Si pones el estado en **Cancelado**, las unidades de ese pedido vuelven al stock de cada producto. Si lo sacas de Cancelado, se vuelven a descontar. Así tu inventario de la lista siempre cuenta lo que de verdad queda.',
            },
            {
                t: 'example',
                title: 'Una tienda de ropa en Cali',
                md: 'Cuando alguien pide por transferencia y no paga en dos días, lo pasan a **Cancelado** desde el tablero: las tallas vuelven al stock y otro cliente las puede comprar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Dónde veo cuánto vendí?', a: 'En **Estadísticas**, arriba del editor de la tienda: visitas, pedidos, ventas y de dónde llegan. También en el tablero de ventas que se creó con la tienda.' },
                    { q: '¿Puedo agregar columnas a Pedidos?', a: 'Sí: la guía de envío, el repartidor, una nota interna. Son tuyas y nunca las toca la tienda.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Crear la tienda', article: 'tienda-online-crear' },
                ],
            },
        ],
    },
    {
        id: 'tienda-online-medir',
        route: '/lists',
        related: ['tienda-online-pedidos', 'tienda-online-comprar', 'formularios-medir-conversiones'],
        blocks: [
            {
                t: 'p',
                md: 'En el editor de la tienda, arriba, toca **Estadísticas**. Ves los últimos 7, 30 o 90 días: cuántas **visitas** tuvo la tienda, cuántos **pedidos** y cuántos se pagaron, cuánto **vendiste** y la **conversión** (las visitas que terminaron en un pedido pagado).',
            },
            { t: 'anim', key: 'tienda-medir', caption: 'Visitas, pedidos y ventas del mes, de la visita al pago y la campaña que más compras trae.' },
            { t: 'h', text: 'Qué te dicen las estadísticas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Día por día', what: 'Las visitas y los pedidos de cada día. Pasa el dedo o el mouse por un día para ver también lo que vendiste.' },
                    {
                        name: 'De la visita al pago',
                        what: 'Cuántas visitas abren un producto, lo agregan al carrito, empiezan la compra, hacen el pedido y lo pagan.',
                        tip: 'Si muchas abren productos pero pocas los agregan, revisa precios y fotos. Si muchas empiezan la compra y no la terminan, revisa los datos que pides y las formas de pago.',
                    },
                    { name: 'Productos', what: 'Los que más venden, con las unidades y el dinero, y cuántas veces los abren y los agregan al carrito.' },
                    { name: 'De dónde llegan', what: 'La campaña (por el «utm_source» del enlace), el sitio desde donde llegaron o «Directo», con sus visitas, pedidos y ventas.' },
                    { name: 'Desde qué dispositivo', what: 'Celular, tableta o computador.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Son conteos, no personas',
                md: 'Las visitas se cuentan como números por día: no se guarda la dirección IP ni nada de quien visita. Los pedidos y las ventas salen de los pedidos de verdad, así que también ves lo vendido antes de esta función.',
            },
            { t: 'h', text: 'Medir tus anuncios en Google Ads y Meta' },
            {
                t: 'p',
                md: 'Si la tienda está **insertada en tu sitio** (con el código de **Publicar**), le avisa a tu sitio cada paso de la compra. **Google Tag Manager** los entiende sin configurar nada: son los eventos de comercio electrónico de Google (`view_item`, `add_to_cart`, `begin_checkout` y `purchase`), con los productos, el valor, la moneda y el número del pedido.',
            },
            {
                t: 'steps',
                items: [
                    'En el editor de la tienda, entra a **Medir conversiones**.',
                    'Si usas Tag Manager, arma tus etiquetas con esos eventos (copia su nombre con un clic). La compra trae el número del pedido: Google y Meta no la cuentan dos veces.',
                    'Sin Tag Manager, pega el fragmento de tu conversión de compra de Google Ads (el que tiene «send_to») y activa **Avisar al píxel de Meta de tu sitio** si lo tienes: se registran ViewContent, AddToCart, InitiateCheckout y Purchase.',
                    'Si el anuncio lleva **directo al enlace de la tienda**, activa **Cargar mis etiquetas en el enlace directo** y pega el ID de Google Analytics (G-…) y el del píxel de Meta. Puedes mostrar un aviso de cookies al pie.',
                    'Toca **Guardar**.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Cuándo cuenta la compra',
                md: 'Con transferencia, WhatsApp o contra entrega, cuando se hace el pedido. Con pago en línea o una suscripción, cuando se paga. Un pedido cancelado no cuenta, y recargar la página del pedido no la cuenta otra vez. **Conversiones mejoradas** manda también el correo y el teléfono (cifrados por Google): actívalo sólo si tu política de datos lo contempla.',
            },
            { t: 'h', text: 'De dónde llegó cada pedido' },
            {
                t: 'p',
                md: 'Cada pedido guarda la campaña y el anuncio por el que llegó tu cliente. En la ficha del pedido lo ves arriba («Llegó desde: Campaña: google · Campaña: navidad · anuncio de Google») y la lista de **Pedidos** tiene las columnas **Llegó desde** y **Campaña** para filtrar, agrupar y armar tableros. Una tienda creada antes de esta función las agrega con el botón de **Medir conversiones**.',
            },
            {
                t: 'example',
                title: 'Una tostadora de café con campañas de temporada',
                md: 'Comparte la tienda con `?utm_source=google&utm_campaign=navidad` en sus anuncios. En **Estadísticas** ve que «Campaña: google» trajo 64 pedidos este mes, y en **Pedidos** agrupa por **Campaña** para saber cuánto vendió la de Navidad.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Necesito pegar algo en mi sitio además del código de la tienda?', a: 'No. El mismo código (el iframe y el script) manda los eventos a tu sitio. Lo que necesitas en tu sitio es tu propia etiqueta de Google o Tag Manager y, si lo usas, el píxel de Meta.' },
                    { q: '¿Por qué una visita no aparece al instante?', a: 'Aparece en segundos en Estadísticas. Los números se juntan y se guardan cada pocos minutos, para no cargar el servidor con cada visita.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Atender los pedidos', article: 'tienda-online-pedidos' },
                ],
            },
        ],
    },
];
