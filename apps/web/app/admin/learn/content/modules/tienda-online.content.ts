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
            { t: 'h', text: 'Publicar y compartir' },
            {
                t: 'steps',
                items: [
                    'En la sección **Publicar**, mira **Lo que falta para publicarla**: cada punto te lleva a donde se arregla.',
                    'Toca **Publicar**. Desde ese momento cualquiera con el enlace puede comprar.',
                    'Copia el enlace para mandarlo por WhatsApp o redes, el **código para tu sitio web** (la tienda se ve dentro de una página tuya) o descarga el **código QR** para imprimirlo.',
                ],
            },
            {
                t: 'example',
                title: 'Una tostadora de café en Manizales',
                md: 'Tenían su lista **Productos** con el café por libra, el precio y el stock. Crearon la tienda, activaron el pedido por WhatsApp y pegaron el QR en las bolsas: los clientes que vuelven a comprar escanean, eligen y les llega el pedido armado al WhatsApp del negocio.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Google muestra mi tienda?', a: 'No por ahora: la página no aparece en los buscadores. La compartes tú con el enlace, el código para tu sitio o el QR.' },
                    { q: '¿Puedo usar el color de mi marca?', a: 'Sí. En **Apariencia** usa el color de tu marca o eliges otro, el título, la descripción y cómo se ven las tarjetas.' },
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
                md: 'En **Datos y avisos** decides si pides el documento (opcional, obligatorio o no), si deja notas, si tiene que aceptar los términos, una **compra mínima** y si le llega un **correo de confirmación** con el detalle del pedido (sale por el correo de tu empresa). Si tu empresa pide la autorización de datos personales, la tienda la muestra y la guarda con cada pedido.',
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
                    { q: '¿Puedo poner la tienda dentro de mi sitio web?', a: 'Sí. En **Publicar** copia el código para tu sitio y pégalo en una página. En **Sitios que pueden insertarla** eliges en qué sitios se puede mostrar.' },
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
                    { q: '¿Dónde veo cuánto vendí?', a: 'En el tablero de ventas que se creó con la tienda: pedidos, total vendido y lo que falta cobrar.' },
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
];
