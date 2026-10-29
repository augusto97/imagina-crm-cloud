import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-conectar',
        route: '/settings?s=conectores',
        related: ['tienda-sincronizar', 'tienda-plugins-automatizaciones', 'integraciones-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'Si vendes en línea con **WooCommerce** (la tienda de WordPress), puedes conectarla a la app para tener tus productos, pedidos y clientes en listas, al día solos, y cambiar precios y stock desde aquí. Conectar es pegar una **clave de la API** que generas en tu WordPress; después eliges qué traer.',
            },
            { t: 'anim', key: 'tienda-hero', caption: 'Alguien compra en la tienda: el pedido llega solo, el stock baja y el tablero de ventas sube.' },
            { t: 'h', text: 'Paso 1: generar la clave en WordPress' },
            {
                t: 'steps',
                items: [
                    'Entra al panel de tu WordPress y ve a **WooCommerce → Ajustes → Avanzado → API REST**.',
                    'Toca **Añadir clave**. En la descripción pon algo que reconozcas, por ejemplo «App de gestión».',
                    'En **Usuario**, elige un administrador de la tienda.',
                    'En **Permisos** elige **Lectura/Escritura**. Con «Lectura» sólo podrás traer datos: no podrás cambiar precios ni stock desde la app, ni usar el modo en tiempo real.',
                    'Toca **Generar clave API**. WordPress te muestra la **clave del cliente** (empieza con ck_) y la **clave secreta** (empieza con cs_).',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Copia la clave secreta en ese momento',
                md: 'WordPress muestra la clave secreta **una sola vez**. Si cierras la página sin copiarla, tendrás que generar otra clave.',
            },
            { t: 'h', text: 'Paso 2: pegarla en la app' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, busca la tarjeta **WooCommerce** (Tiendas online) y toca **Conectar**.',
                    'Escribe la **Dirección de la tienda** (por ejemplo https://mitienda.com).',
                    'Pega la **Clave del cliente** y la **Clave secreta**.',
                    'Toca **Conectar**. La app **prueba la tienda antes de guardar**: si no responde, no se guarda nada y te dice por qué.',
                    'Ya conectada, en la fila de la tienda aparece **Sincronizar tienda**.',
                ],
            },
            { t: 'demo', key: 'tienda-conectar', caption: 'Conectar WooCommerce desde la galería de Integraciones.', fallback: 'tienda-hero' },
            {
                t: 'settings',
                title: 'Los datos del cuadro',
                rows: [
                    { name: 'Dirección de la tienda', what: 'La dirección de tu sitio de WordPress. Tiene que empezar con https://.', tip: 'Sin «/wp-admin» ni otras rutas al final.' },
                    { name: 'Clave del cliente', what: 'La que empieza con ck_.' },
                    { name: 'Clave secreta', what: 'La que empieza con cs_. Se guarda cifrada y no vuelve a mostrarse.' },
                ],
            },
            {
                t: 'p',
                md: 'La conexión se nombra sola con el nombre de tu sitio. Algunos hostings no dejan pasar la clave de la forma habitual o la tienda no usa enlaces permanentes: la app lo detecta al conectar y usa la forma que funcione en tu tienda, sin que tengas que tocar nada.',
            },
            { t: 'h', text: 'Si no conecta' },
            { t: 'demo', key: 'tienda-error', caption: 'Con una dirección mal escrita, la app no guarda la conexión y dice por qué.', fallback: 'tienda-hero' },
            {
                t: 'settings',
                rows: [
                    { name: 'No pudimos llegar a la tienda', what: 'La dirección está mal escrita o el sitio no responde. Ábrela en el navegador para comprobarla.' },
                    { name: 'La tienda tiene que usar HTTPS', what: 'WooCommerce no acepta claves de API sin conexión segura. Activa el certificado SSL en tu hosting (casi todos lo dan gratis).' },
                    { name: 'La clave fue rechazada', what: 'Se copió mal, se revocó en WordPress o es de otra tienda. Genera una nueva.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo conectar varias tiendas?', a: 'Sí: cada tienda es una conexión, con su propia carpeta de listas.' },
                    { q: '¿La conexión cambia algo en mi tienda?', a: 'Conectar no cambia nada. Los cambios llegan a la tienda sólo si activas **Editar desde la app** o usas una acción de WooCommerce en una automatización.' },
                    { q: '¿Y si cambio la clave en WordPress?', a: 'En la fila de la conexión, toca **Actualizar clave** y pega la nueva.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Sincronizar la tienda', article: 'tienda-sincronizar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-sincronizar',
        route: '/settings?s=conectores',
        related: ['tienda-listas', 'tienda-conectar', 'tienda-la-tienda-manda'],
        blocks: [
            {
                t: 'p',
                md: 'Con la tienda conectada, toca **Sincronizar tienda** en su fila de **Ajustes → Integraciones**. La app crea una **carpeta** con tres listas —**Productos**, **Pedidos** y **Clientes**— y dos tableros, **ventas** e **inventario**, y desde ese momento los mantiene al día. Los productos, pedidos y clientes se siguen creando en WooCommerce: la app los refleja.',
            },
            { t: 'anim', key: 'tienda-sync', caption: 'En tiempo real cada cambio llega en segundos; cada cierto tiempo, en tandas.' },
            { t: 'h', text: 'Qué traer' },
            {
                t: 'settings',
                title: 'Qué traer',
                rows: [
                    { name: 'Clientes', what: 'Los registrados. Los que compraron como invitados llegan igual, por sus pedidos.' },
                    { name: 'Productos', what: 'Con sus variaciones (talla, color…), precios, categorías e inventario.' },
                    { name: 'Pedidos', what: 'Con lo que se compró en cada uno (adentro del pedido).' },
                    { name: 'Pedidos desde', what: '**Todo el historial** o **Desde una fecha**.', tip: 'Cada pedido y cada línea ocupan un registro de tu plan: con años de pedidos, traer sólo los recientes ahorra lugar.' },
                ],
            },
            { t: 'h', text: 'Cómo se mantiene al día' },
            {
                t: 'cards',
                items: [
                    { icon: 'Zap', title: 'En tiempo real (Recomendado)', md: 'La tienda **avisa** al instante cada pedido, producto o cliente que cambia. Igual se revisa una vez por hora por si se perdió algún aviso. Necesita una clave con permiso de **Lectura/Escritura**.', tone: 'mint' },
                    { icon: 'Clock', title: 'Cada cierto tiempo', md: 'La app le pregunta a la tienda qué cambió cada 5, 15 o 30 minutos, cada hora, cada 3 o 6 horas o una vez por día. Sirve con una clave de solo lectura.', tone: 'blue' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Si el tiempo real no se puede activar',
                md: 'Si la clave es de solo lectura o la tienda no puede llegar a este servidor, la sincronización queda en **Cada cierto tiempo** y la pantalla te dice el motivo. Funciona igual; los cambios llegan con unos minutos de retraso.',
            },
            { t: 'h', text: 'Empezar y seguir el estado' },
            {
                t: 'steps',
                items: [
                    'Marca qué traer, desde qué fecha los pedidos y el modo, y toca **Empezar a sincronizar**.',
                    'La app crea las listas y empieza la primera vuelta. Verás **En cola…**, luego **Sincronizando…** con la barra de avance de cada parte, y al final **Al día**.',
                    'La primera importación puede tardar si la tienda es grande. No hace falta dejar la página abierta.',
                ],
            },
            {
                t: 'settings',
                title: 'Acciones de la pantalla de la tienda',
                rows: [
                    { name: 'Sincronizar ahora', what: 'No espera al próximo turno: trae ya lo que cambió.' },
                    { name: 'Pausar / Reanudar', what: 'Detiene las actualizaciones sin borrar nada.' },
                    { name: 'Recorrer todo de nuevo', what: 'Vuelve a leer todos los clientes, productos y pedidos. No duplica nada: actualiza lo que haya cambiado. Útil si notas datos desactualizados.' },
                    { name: 'Tablero de ventas / Inventario', what: 'Abren los tableros de la tienda.' },
                    { name: 'Dejar de sincronizar', what: 'Las listas y todo lo que se trajo quedan; sólo dejan de actualizarse.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Las automatizaciones, sin sustos',
                md: 'Los cambios que llegan de la tienda disparan las automatizaciones de cada lista (por ejemplo, avisar por WhatsApp de un pedido nuevo). La **primera importación no dispara nada**, y **Recorrer todo de nuevo** tampoco: nadie recibe tres mil mensajes al conectar.',
            },
            {
                t: 'example',
                title: 'Una tienda de café con 4.000 pedidos',
                md: 'Café Aurora vende hace tres años. Como su plan tiene un tope de registros, trae los pedidos **Desde** el 1 de enero de este año. Elige **En tiempo real**: cada compra aparece en **Pedidos** en segundos, y una automatización le avisa al equipo de despachos por WhatsApp.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué pasa si se llega al límite de registros del plan?', a: 'La sincronización se detiene con el motivo a la vista. Puedes subir de plan o traer pedidos desde una fecha más reciente.' },
                    { q: 'Borré un producto en WooCommerce, ¿se borra aquí?', a: 'Queda marcado con el estado «En la papelera», con su historial. Si ya no te sirve, quítalo de la app con **Quitarlos de la app**, o elige en la pantalla de la tienda que lo borrado salga solo.' },
                    { q: '¿Quién puede configurarlo?', a: 'Quien puede administrar listas y editar la conexión de la tienda.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Ver las listas de la tienda', article: 'tienda-listas' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-listas',
        route: '/lists',
        related: ['tienda-inventario', 'tienda-sincronizar', 'vistas-kanban'],
        blocks: [
            {
                t: 'p',
                md: 'La sincronización arma una carpeta con el nombre de la tienda. Adentro hay tres listas y dos tableros. Todo es un registro común: se filtra, se agrupa, se suma, se comenta y dispara automatizaciones, como cualquier otra lista.',
            },
            { t: 'anim', key: 'tienda-listas', caption: 'Cada pedido se despliega con sus líneas; cuánto compró cada cliente se calcula solo.' },
            { t: 'h', text: 'Productos' },
            {
                t: 'p',
                md: 'Una fila por producto. Si el producto tiene **variaciones** (talla, color, presentación), cada una es una **subtarea** del producto: toca la flecha de la fila para verlas. El producto variable muestra el resumen de sus variaciones: el stock sumado, el valor y el estado más urgente.',
            },
            {
                t: 'settings',
                title: 'Columnas principales de Productos',
                rows: [
                    { name: 'Imagen, Tipo, SKU, Categorías, Etiquetas', what: 'Los datos del producto. La imagen se ve como miniatura.' },
                    { name: 'Precio normal, Precio rebajado, Precio', what: 'Los precios de la tienda.' },
                    { name: 'Stock, Controla stock, Estado del stock, Alerta de stock bajo', what: 'El inventario tal como está en WooCommerce.' },
                    { name: 'Inventario, Valor en stock, Vendidas (30 días), Meses de cobertura', what: 'Lo que calcula la app para controlar el inventario.' },
                    { name: 'Unidades vendidas, Ingresos', what: 'Cuánto vendió cada producto y cada variación.' },
                    { name: 'Enlace, Editar en WooCommerce', what: 'Abren el producto en la tienda o en el panel de WordPress.' },
                ],
            },
            { t: 'h', text: 'Pedidos' },
            {
                t: 'p',
                md: 'Una fila por pedido, con su número, cliente (vinculado a la lista Clientes), estado, fecha, total, envío, descuento, impuestos, método de pago, datos de contacto y dirección, y **Ver en WooCommerce**. Lo que se compró va **adentro**: cada línea es una subtarea con el producto, el SKU, las unidades y el subtotal. La vista **Por estado** muestra los pedidos en un kanban.',
            },
            { t: 'h', text: 'Clientes' },
            {
                t: 'p',
                md: 'Una fila por cliente con nombre, correo, teléfono, empresa y dirección. Además se calcula solo lo que compró: **Pedidos**, **Total comprado**, **Ticket promedio** y **Último pedido**. Quien compró como invitado también aparece (se reconoce por su correo), y si después crea una cuenta, se une al mismo registro.',
            },
            {
                t: 'cards',
                items: [
                    { icon: 'BarChart3', title: 'Ventas', md: 'Ventas, pedidos, ticket promedio y clientes; ventas por mes, pedidos por estado, lo más vendido y los mejores clientes.', tone: 'violet' },
                    { icon: 'Package', title: 'Inventario', md: 'Agotados, con stock bajo, valor y unidades en stock, el reparto por estado y la tabla de lo que hay que reponer.', tone: 'amber' },
                ],
            },
            {
                t: 'example',
                title: 'Lo que hace el equipo con las listas',
                md: 'En **Clientes**, la vendedora ordena por **Total comprado** y les escribe a los diez mejores con una promoción. En **Pedidos**, despachos trabaja con el kanban **Por estado** y comenta en cada pedido el número de guía. En **Productos**, compras abre **Para reponer** cada lunes.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Agrega tus propias columnas',
                md: 'Puedes sumar columnas que la tienda no tiene —responsable, notas internas, costo del proveedor— a cualquiera de las tres listas. Son **columnas propias**: se editan libremente y nunca viajan a WooCommerce.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo crear un producto o un pedido desde aquí?', a: 'No: se crean en WooCommerce y llegan solos. En las listas de la tienda no aparece «Nuevo registro»; el aviso de arriba tiene el enlace **Crear en WooCommerce**.' },
                    { q: '¿Las variaciones cuentan dos veces en los totales?', a: 'No. El pie de la tabla, los grupos y los tableros cuentan sólo el primer nivel, y los cálculos usan la columna **Tipo** para no sumar dos veces.' },
                    { q: '¿Puedo crear más vistas?', a: 'Sí, las que quieras: tabla, kanban, calendario de pedidos por fecha, tarjetas con la imagen del producto…' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Controlar el inventario', article: 'tienda-inventario' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-la-tienda-manda',
        route: '/lists',
        related: ['tienda-edicion-masiva', 'tienda-listas', 'tienda-sincronizar'],
        blocks: [
            {
                t: 'p',
                md: 'En las listas de la tienda, **la tienda manda**: los datos vienen de WooCommerce y la app los refleja. Por eso no todo se edita aquí. Cada columna lleva una marca que dice qué se puede hacer con ella, y el aviso de arriba de la lista tiene **¿Qué puedo cambiar?** con la explicación.',
            },
            { t: 'anim', key: 'tienda-lock', caption: 'El precio se cambia aquí y llega a la tienda; el nombre está bloqueado; el costo es una columna propia.' },
            { t: 'h', text: 'Las tres marcas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Candado', what: 'Viene de WooCommerce: se edita allá. Al intentar cambiarla, la celda te dice el motivo.' },
                    { name: 'Flechas', what: 'Se puede cambiar desde aquí y el cambio viaja a WooCommerce.' },
                    { name: 'Lápiz', what: 'Columna propia: se guarda en la app y nunca viaja a la tienda.' },
                ],
            },
            { t: 'h', text: 'Activar «Editar desde la app»' },
            {
                t: 'steps',
                items: [
                    'Abre la pantalla de la tienda (desde **Ajustes → Integraciones → Sincronizar tienda**, o desde el aviso de la lista).',
                    'Activa **Editar desde la app**. Necesita una clave con permiso de **Lectura/Escritura**.',
                    'En **Columnas que se editan desde la app**, marca qué se puede cambiar en cada lista. Vienen marcadas las más usadas.',
                ],
            },
            {
                t: 'settings',
                title: 'Columnas que se pueden editar',
                rows: [
                    { name: 'Productos', what: '**Precio normal**, **Precio rebajado**, **Stock**, **Controla stock**, **Estado del stock**, **Alerta de stock bajo** y **Publicación** vienen marcadas. También puedes habilitar **Nombre**, **SKU**, la **dirección** del producto (la última parte de su enlace), **Categorías** y **Etiquetas**.', tip: 'Una etiqueta o categoría que no existe se crea en la tienda.' },
                    { name: 'Pedidos', what: '**Estado** viene marcado. También: **Nota del cliente**, **Email** y **Teléfono**.' },
                    { name: 'Clientes', what: '**Nombre**, **Email**, **Teléfono**, **Empresa** y **Ciudad**, sólo de clientes con cuenta.' },
                    { name: 'Campos de otros plugins', what: 'Los que trajiste como columna también se pueden habilitar.' },
                ],
            },
            {
                t: 'p',
                md: 'Cada fila acepta además lo que acepta la tienda: un producto con variaciones no tiene precio ni stock propio (se cambian en cada variación), el precio rebajado no puede superar al normal, el stock es un número entero y, con el stock controlado, el estado del stock lo calcula WooCommerce.',
            },
            { t: 'h', text: 'Cómo viaja un cambio' },
            {
                t: 'p',
                md: 'Cuando cambias una celda, **sólo viaja lo que cambiaste**: si cambias el precio, no se manda el stock, así nunca se pisa una venta que la tienda registró mientras tanto. Lo mismo vale para lo que cambia una automatización. Si la tienda rechaza el cambio (por ejemplo, un SKU que ya usa otro producto), la celda **vuelve al valor de la tienda** y la pantalla de la tienda muestra **El último cambio no llegó a la tienda** con el motivo.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Los registros se crean y se borran en WooCommerce',
                md: 'En las listas de la tienda no se crean ni se importan registros: ni a mano, ni con automatizaciones, ni con el asistente. Eso se hace en WooCommerce y llega solo. Lo que **ya se borró en la tienda** sí se puede quitar de la app (mira **Lo que se borra en la tienda**); lo que sigue vivo allá, no.',
            },
            {
                t: 'example',
                title: 'Cambio de precios de temporada',
                md: 'Llega diciembre y Café Aurora sube el **Precio normal** de la Taza Aurora en la tabla de Productos: en segundos la tienda ya muestra el precio nuevo. El nombre del producto sigue con candado porque nadie habilitó **Nombre**: así nadie cambia la ficha del producto por error.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiarle el nombre a una columna de la tienda?', a: 'Sí, el nombre y la descripción. El tipo y su configuración los define la tienda, y no se puede borrar mientras la lista esté sincronizada.' },
                    { q: 'Apagué «Editar desde la app», ¿qué pasa con lo que ya cambié?', a: 'Lo que ya llegó a la tienda queda. Desde ese momento todas las columnas de la tienda vuelven a tener candado.' },
                    { q: '¿Las columnas propias se pierden si dejo de sincronizar?', a: 'No. Al dejar de sincronizar, las listas quedan como listas comunes con todo lo que tenían.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Editar productos en lote', article: 'tienda-edicion-masiva' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-edicion-masiva',
        route: '/lists',
        related: ['tienda-la-tienda-manda', 'lote-editar-en-lote', 'lote-historial-deshacer'],
        blocks: [
            {
                t: 'p',
                md: '**Editar en la tienda** cambia muchos productos de una vez, directamente en WooCommerce: subir 10 % los precios de una categoría, poner una rebaja con fecha, sumar stock, agregar una etiqueta o un atributo. Calcula sobre lo que la tienda tiene **hoy**, te muestra una vista previa antes de aplicar y se puede deshacer.',
            },
            { t: 'anim', key: 'tienda-bulk', caption: 'Subir 10 % y redondear a precios terminados en 900: vista previa, aplicar y deshacer.' },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'En la lista **Productos**, marca los productos (o filtra la vista: por ejemplo, la categoría «Tazas»).',
                    'Toca **Editar en la tienda** en la barra de selección. Para todo lo que muestra la vista, ábrelo desde **Personalizar vista**.',
                    'En **A qué productos** elige la selección o **Todos los de la vista**, y si incluir las variaciones.',
                    'Agrega uno o varios cambios: cada uno parte del resultado del anterior.',
                    'Toca **Ver vista previa**: verás el antes y el después de cada producto y variación, y las notas de lo que no se puede cambiar.',
                    'Toca **Aplicar en la tienda**. Los cambios se aplican en tandas, con barra de avance, y llegan solos a la lista.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Qué necesitas',
                md: 'Tener activado **Editar desde la app** en la tienda y permiso para acciones masivas. Si una columna no está habilitada en **Columnas que se editan desde la app**, su cambio aparece deshabilitado con el motivo.',
            },
            { t: 'h', text: 'Lo que se puede cambiar' },
            {
                t: 'settings',
                rows: [
                    { name: 'Precios', what: '**Precio normal** y **Precio rebajado**: poner un precio, subir o bajar un %, sumar o restar. La rebaja también como descuento sobre el precio normal, quitarla o **programarla** con fecha de inicio y fin.' },
                    { name: 'Precio según una columna', what: 'Precio = una columna × un factor + un monto, por ejemplo **Costo × 1,35**. Se toma la columna de cada variación.', tip: 'Útil con una columna propia de costo.' },
                    { name: 'Inventario', what: 'Stock (sumar, restar o poner), controlar stock, estado del stock, permitir reservas y alerta de stock bajo.' },
                    { name: 'Publicación', what: 'Estado de publicación, visibilidad en el catálogo y destacado.' },
                    { name: 'Organización', what: 'Categorías y etiquetas (agregar, quitar o reemplazar todas), atributos y sus valores, y el nombre (agregar al inicio o al final, buscar y reemplazar).' },
                    { name: 'Envío e impuestos', what: 'Peso, medidas, clase de envío, estado y clase de impuesto.' },
                    { name: 'Campo de otro plugin', what: 'Un dato guardado por otro plugin, por su clave.' },
                ],
            },
            { t: 'h', text: 'Redondear el resultado' },
            {
                t: 'p',
                md: 'Al subir un porcentaje los precios quedan raros (38.500, 24.200). Con **Redondear el resultado** eliges la dirección —**Hacia arriba**, **Al más cercano** o **Hacia abajo**— y la grilla: «a múltiplos de 1.000 más −100» deja todos los precios **terminados en 900**. Hacia arriba nunca baja un precio: 38.500 pasa a 38.900.',
            },
            {
                t: 'example',
                title: 'Subir la línea de tazas antes de diciembre',
                md: 'Café Aurora filtra Productos por la categoría «Tazas», abre **Editar en la tienda**, elige **Precio normal → Subir o bajar un % → +10 %** y redondea hacia arriba a precios terminados en 900. La vista previa muestra cada color de cada taza con su precio nuevo. Toca **Aplicar en la tienda** y en un minuto la tienda ya cobra los precios nuevos.',
            },
            { t: 'h', text: 'Crear variaciones en lote' },
            {
                t: 'p',
                md: 'Con **Crear variaciones** (en la barra de selección o en **Personalizar vista**) eliges atributos y valores para combinar —por ejemplo **Color**: Rojo, Azul × **Talla**: M, L, XL— con su **Precio normal**, **Stock inicial** y estado. Cada producto variable recibe sólo las combinaciones que le faltan; las que ya existían no se duplican. La vista previa dice cuántas se crean y cuántas ya estaban.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Deshacer',
                md: 'Al terminar, toca **Deshacer** en el resultado, o búscalo después en el **Historial de ediciones masivas** de la lista. Los precios, el stock y lo demás vuelven a como estaban, también en WooCommerce. Lo que alguien cambió después no se pisa: se lista aparte.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Por qué un producto quedó igual?', a: 'La vista previa lo explica en sus notas: un producto variable no tiene precio propio (se cambia en sus variaciones), un precio rebajado no puede superar al normal, o una variación toma el stock de su producto.' },
                    { q: '¿Puedo quitar un atributo que usan las variaciones?', a: 'No: rompería las variaciones. Sí puedes agregarle valores.' },
                    { q: '¿Dispara automatizaciones?', a: 'Sí: lo que vuelve de la tienda es un cambio real y dispara las automatizaciones de la lista.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Edición en lote en cualquier lista', article: 'lote-editar-en-lote' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-inventario',
        route: '/lists',
        related: ['tienda-listas', 'tienda-edicion-masiva', 'tableros-explorar'],
        blocks: [
            {
                t: 'p',
                md: 'Con los productos sincronizados tienes el control del inventario sin abrir WordPress: qué está agotado, qué está por agotarse, cuánto vale lo que tienes y para cuántos meses alcanza. Cada venta baja el stock solo, también el de la variación vendida.',
            },
            { t: 'anim', key: 'tienda-stock', caption: 'Se vende un termo, el stock baja a la alerta y aparece en «Para reponer».' },
            { t: 'h', text: 'Los estados de inventario' },
            {
                t: 'settings',
                title: 'Columna Inventario',
                rows: [
                    { name: 'Agotado', what: 'Stock en cero o menos.' },
                    { name: 'Stock bajo', what: 'Stock igual o menor que la **Alerta de stock bajo** del producto (o la general de la tienda si el producto no tiene una).' },
                    { name: 'En stock', what: 'Por encima de la alerta.' },
                    { name: 'Por encargo', what: 'Sin stock, pero la tienda permite reservas.' },
                    { name: 'Sin control de stock', what: 'El producto no lleva la cuenta de unidades.' },
                ],
            },
            {
                t: 'p',
                md: 'Un producto con variaciones muestra el estado **más urgente** de sus variaciones y el stock sumado: si la taza negra está agotada, el producto lo dice aunque las otras tengan unidades.',
            },
            { t: 'h', text: 'Lo que calcula la app' },
            {
                t: 'settings',
                rows: [
                    { name: 'Valor en stock', what: 'Unidades × precio.' },
                    { name: 'Vendidas (30 días)', what: 'Unidades vendidas en pedidos pagados del último mes.' },
                    { name: 'Meses de cobertura', what: 'Para cuántos meses alcanza el stock al ritmo de venta actual.', tip: 'Menos de 1 = se acaba este mes.' },
                ],
            },
            { t: 'h', text: 'La vista «Para reponer» y el tablero' },
            {
                t: 'p',
                md: 'La lista Productos trae la vista **Para reponer**: sólo lo agotado y lo que tiene stock bajo, ordenado por stock. Y la vista **Por inventario** agrupa los productos por estado en un kanban. El tablero **Inventario** muestra los agotados, los que tienen stock bajo, el valor y las unidades en stock, el reparto por estado y la tabla de lo que hay que reponer.',
            },
            {
                t: 'example',
                title: 'El lunes de compras',
                md: 'Cada lunes, el encargado de compras de Café Aurora abre **Para reponer**: el café de origen está agotado y al termo Andes le queda medio mes. Hace el pedido al proveedor y, cuando llega la mercancía, suma el stock desde la tabla (con **Editar desde la app** activado) o en lote con **Editar en la tienda → Stock → Sumar**.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Que te avise solo',
                md: 'Crea una automatización en Productos: cuando **Inventario** cambie a **Stock bajo** o **Agotado**, mandar un correo o un WhatsApp a compras con el nombre del producto y su stock. La galería de plantillas de automatizaciones trae la receta **Stock bajo** lista para usar.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Vendí algo y el stock no bajó todavía', a: 'En tiempo real llega en segundos. Cada cierto tiempo, en la próxima vuelta. Además, una vez por día se revisa el stock de todos los productos, por si un plugin lo cambió sin pasar por un pedido.' },
                    { q: '¿Puedo cambiar la alerta de stock bajo desde aquí?', a: 'Sí, si está habilitada en **Columnas que se editan desde la app**. Déjala vacía para usar la general de la tienda.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver tableros', to: '/dashboards' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-plugins-automatizaciones',
        route: '/settings?s=conectores',
        related: ['tienda-la-tienda-manda', 'integraciones-en-automatizaciones', 'automatizaciones-acciones'],
        blocks: [
            {
                t: 'p',
                md: 'Muchas tiendas usan plugins que guardan datos propios en cada producto, pedido o cliente: el origen de un café, la fecha de entrega elegida, el NIT para la factura, los campos de un formulario de pago. La app los **descubre** y tú decides cuáles traer como columna. Y en las automatizaciones tienes acciones para actuar sobre la tienda.',
            },
            { t: 'anim', key: 'tienda-meta', caption: 'Con «Traer como columna», un dato de otro plugin se vuelve una columna ya llena.' },
            { t: 'h', text: 'Campos de otros plugins' },
            {
                t: 'steps',
                items: [
                    'En la pantalla de la tienda, baja a **Campos de otros plugins** y elige la pestaña: productos, pedidos o clientes.',
                    'Cada fila es un dato que encontró la app, con un **Ejemplo** y cuántos registros lo tienen. Los datos internos de los plugins van ocultos: los ves con **Mostrar los internos de los plugins**.',
                    'Toca **Traer como columna**, revisa el **Nombre de la columna** y el tipo sugerido (texto, número, fecha, sí/no, enlace…) y confirma.',
                    'La columna se crea y se llena con lo que ya hay en la tienda. Desde ahí se mantiene al día. Con **Dejar de traer** se detiene.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Se editan en WooCommerce',
                md: 'Las columnas que traes de otros plugins llegan con candado. Si quieres cambiarlas desde aquí, habilítalas en **Columnas que se editan desde la app**.',
            },
            { t: 'h', text: 'Acciones de WooCommerce en las automatizaciones' },
            {
                t: 'p',
                md: 'Con la tienda conectada, el menú de acciones del editor de automatizaciones muestra la sección de apps conectadas con estas acciones:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Actualizar producto en WooCommerce', what: 'Por ID del producto (y de la variación si corresponde): nombre, precio normal y rebajado, stock, estado del inventario, publicación y campos personalizados. Lo vacío no se cambia.' },
                    { name: 'Cambiar el estado de un pedido', what: 'Por ejemplo, a **Completado** cuando despachos marca el pedido como entregado.' },
                    { name: 'Agregar una nota al pedido', what: 'Interna, o visible para el cliente con **Enviársela al cliente**.' },
                    { name: 'Crear un cupón', what: 'Código, tipo de descuento (porcentaje o monto fijo), valor, vencimiento, usos, correos permitidos, compra mínima y envío gratis.' },
                ],
            },
            {
                t: 'example',
                title: 'Cupón de recompra para clientes que no vuelven',
                md: 'Una automatización programada cada lunes busca en **Clientes** a quienes no compran hace 60 días. Para cada uno, **Crear un cupón** con el código `VUELVE-{{record.id}}`, 15 % de descuento, válido para su correo y que vence en dos semanas, y después le manda el código por WhatsApp.',
            },
            {
                t: 'example',
                title: 'Avisar al cliente que su pedido salió',
                md: 'En **Pedidos**, cuando una columna propia «Guía de envío» se llena: **Agregar una nota al pedido** con «Tu pedido salió con la guía {{guia_de_envio}}», con **Enviársela al cliente** activado, y **Cambiar el estado de un pedido** a **Completado**. WooCommerce le manda al cliente su correo de siempre.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Las acciones funcionan sin sincronizar la tienda?', a: 'Sí: alcanza con conectarla. Pero sincronizada es más fácil, porque tienes los ID de productos y pedidos en las listas.' },
                    { q: 'Un dato de otro plugin no aparece', a: 'Puede ser interno: activa **Mostrar los internos de los plugins**. Si aun así no aparece, quizás el plugin lo guarda en otra parte de la tienda que la API no muestra.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Ver el recorrido de automatizaciones', tour: 'automation-basics' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'tienda-lo-que-se-borra',
        route: '/lists',
        related: ['tienda-la-tienda-manda', 'tienda-sincronizar', 'sitio-borrado-y-novedades', 'ajustes-empresa-papelera'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando mandas un producto o un pedido a la papelera de WooCommerce (o lo borras del todo), su registro queda en la lista marcado **En la papelera**, con todos sus datos. Si ya no te sirve —una colección que no vuelve, pedidos de prueba—, quítalo de la app: deja de estorbar y deja de contar para tu plan.',
            },
            { t: 'anim', key: 'tienda-borrado', caption: 'Lo que se borró en la tienda queda marcado; con un toque sale de la lista y pasa a la papelera de la app.' },
            { t: 'h', text: 'Quitar lo que ya se borró' },
            {
                t: 'steps',
                items: [
                    'En **Productos** o **Pedidos**, la barra de arriba cuenta lo que ya se borró en WooCommerce. Toca **Quitarlos de la app**.',
                    'Para uno solo, abre el menú de su fila (clic derecho) o su ficha y toca **Quitar de la app**.',
                    'Revisa cuántos se quitan y confirma. Un producto sale con sus variaciones y un pedido con sus líneas.',
                ],
            },
            {
                t: 'settings',
                title: 'En la pantalla de la tienda, «Lo que se borra en WooCommerce»',
                rows: [
                    { name: 'Conservarlo marcado', what: 'Queda en la lista con el estado de la papelera y todos sus datos. Lo quitas cuando quieras.' },
                    { name: 'Quitarlo de la app', what: 'Lo que se borre en la tienda sale solo de la lista, va a la papelera de la app 30 días y deja de contar para tu plan. Lo que ya estaba marcado se quita al elegirlo.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Funciona en los dos modos',
                md: 'Con **En tiempo real** la tienda avisa al instante; con **Cada cierto tiempo**, la app revisa en cada vuelta lo que está en la papelera de WooCommerce y, una vez por día, lo que se borró del todo.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Si vuelve en la tienda, vuelve aquí',
                md: 'Si restauras el producto en WooCommerce, en la próxima sincronización vuelve **el mismo registro**, con su historial y sus columnas propias. Mientras tanto, lo puedes recuperar desde **Ajustes → Papelera** durante 30 días. Lo que sigue a la venta en la tienda no se quita: volvería en la próxima vuelta.',
            },
            {
                t: 'example',
                title: 'Fin de la colección de invierno',
                md: 'Café Aurora sacó una línea de termos de edición limitada que se agotó y no vuelve. Mandan los termos a la papelera de WooCommerce y, en la app, eligen **Quitarlo de la app**: los productos y sus variaciones salen de la lista solos y dejan libres esos registros del plan para los pedidos nuevos.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quitar de la app borra algo en WooCommerce?', a: 'No. Sólo saca el registro de la app; la tienda no se toca.' },
                    { q: '¿Y los clientes?', a: 'Los clientes no se borran desde la sincronización: WooCommerce no los manda a una papelera.' },
                    { q: '¿Qué pasa con los pedidos de un producto que quité?', a: 'Siguen en Pedidos con sus líneas; la línea conserva el nombre y el precio del producto.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Recuperar algo de la papelera', article: 'ajustes-empresa-papelera' },
                ],
            },
        ],
    },
];
