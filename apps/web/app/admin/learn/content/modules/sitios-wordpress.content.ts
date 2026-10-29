import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-conectar',
        route: '/settings?s=conectores',
        related: ['sitio-sincronizar', 'integraciones-que-son', 'tienda-conectar'],
        blocks: [
            {
                t: 'p',
                md: 'Si tu sitio web está hecho con **WordPress**, puedes conectarlo a la app para tener tus entradas, páginas y tipos de contenido (propiedades, cursos, productos de un catálogo, lo que haya creado un plugin) en listas, al día solas, y cambiar desde aquí lo que habilites. Conectar es **un clic**: la app te lleva a tu WordPress, apruebas y vuelves conectado.',
            },
            { t: 'anim', key: 'sitio-hero', caption: 'Lo que publicas en el sitio llega solo a la lista; un precio cambiado aquí viaja de vuelta a WordPress.' },
            { t: 'h', text: 'Conectar con un clic' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Integraciones**, busca la tarjeta **WordPress** y toca **Conectar**.',
                    'Escribe la **Dirección del sitio** (por ejemplo https://misitio.com) y toca **Continuar en WordPress**.',
                    'Se abre la pantalla **Autorizar aplicación** de tu propio WordPress. Si no tenías la sesión abierta, entra con el usuario que vas a conectar (mira el consejo de abajo).',
                    'Toca **Sí, apruebo esta conexión**. WordPress crea una contraseña sólo para la app y te devuelve aquí.',
                    'Vuelves a la página del sitio con el aviso **¡Listo! El sitio quedó conectado** y ya puedes elegir qué traer.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Nadie ve ni copia la contraseña',
                md: 'La contraseña la crea WordPress y viaja directo a la app, que la guarda cifrada. Puedes revocarla cuando quieras desde **Usuarios → Perfil → Contraseñas de aplicación** en tu WordPress: desde ese momento la app deja de entrar.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Conecta un usuario Editor creado sólo para la app',
                md: 'Lo más seguro es crear en WordPress (**Usuarios → Añadir nuevo**) un usuario con el rol **Editor** que use sólo la app, en vez de conectar tu cuenta de administrador. Un Editor puede cambiar entradas, páginas, categorías y medios, pero no instalar plugins ni tocar los ajustes del sitio: si algún día la contraseña de la app se filtrara, no daría el control del sitio. Con el complemento 1.1 (o más nuevo) descargado desde la app, un Editor también sirve para el modo **Al instante**.',
            },
            { t: 'h', text: 'Si prefieres pegar una contraseña de aplicación' },
            {
                t: 'p',
                md: 'Algunos plugins de seguridad esconden la pantalla **Autorizar aplicación**. En ese caso, en el mismo cuadro toca **Prefiero pegar una contraseña de aplicación** y sigue los pasos:',
            },
            {
                t: 'steps',
                items: [
                    'En tu WordPress entra a **Usuarios → Perfil** con el usuario que vas a conectar (lo mejor es un Editor creado sólo para la app).',
                    'Baja hasta **Contraseñas de aplicación**, escribe un nombre (por ejemplo «App de gestión») y toca **Añadir**.',
                    'Copia la contraseña que aparece (se muestra una sola vez) y pégala en la app junto con tu **Usuario de WordPress**.',
                    'Toca **Conectar**. La app prueba el sitio antes de guardar: si algo falla, no guarda nada y te dice por qué.',
                ],
            },
            { t: 'h', text: 'Si no conecta' },
            {
                t: 'settings',
                rows: [
                    { name: 'No pudimos llegar al sitio', what: 'La dirección está mal escrita o el sitio no responde. Ábrela en el navegador para comprobarla.' },
                    { name: 'El sitio tiene que usar HTTPS', what: 'WordPress no permite contraseñas de aplicación sin conexión segura. Activa el certificado en tu hosting (casi todos lo dan gratis).' },
                    { name: 'Las contraseñas de aplicación están desactivadas', what: 'Las apaga WordPress si el sitio no usa HTTPS, o un plugin de seguridad. Busca la opción «Application Passwords» y actívala.' },
                    { name: 'Tienes Wordfence', what: 'Wordfence apaga las contraseñas de aplicación al instalarse. En **Wordfence → Login Security → Settings** (Configuración), desmarca **Disable WordPress application passwords** («Desactivar las contraseñas de aplicación de WordPress») y guarda. El resto de la protección de Wordfence sigue igual.' },
                    { name: 'El usuario no tiene permiso para editar', what: 'Conecta un usuario **Editor** (o Administrador): un Autor o un Suscriptor no alcanza.' },
                    { name: 'El hosting está borrando la cabecera de autorización', what: 'Pasa en algunos hostings. La app te dice la línea exacta para agregar al archivo de configuración del servidor, o puedes pedírselo al hosting.' },
                ],
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Conectar cambia algo en mi sitio?', a: 'No. Conectar sólo deja que la app lea. Los cambios llegan al sitio únicamente si activas **Editar desde la app** y habilitas columnas para editar.' },
                    { q: '¿Puedo conectar varios sitios?', a: 'Sí: cada sitio es una conexión, con su propia carpeta de listas.' },
                    { q: 'Revoqué la contraseña sin querer, ¿qué hago?', a: 'La sincronización se detiene y aparece en **Problemas**. En la página del sitio toca **Volver a conectar** y aprueba de nuevo: las listas siguen igual.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Sincronizar el sitio', article: 'sitio-sincronizar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-sincronizar',
        route: '/settings?s=conectores',
        related: ['sitio-el-sitio-manda', 'sitio-conectar', 'tienda-sincronizar'],
        blocks: [
            {
                t: 'p',
                md: 'Con el sitio conectado, la app abre su página: **Trae tu sitio a la app**. Ahí eliges qué traer y qué columnas tendrá cada lista. Al empezar se crea una **carpeta** con el nombre del sitio y **una lista por cada tipo de contenido**. Las entradas se siguen creando en WordPress: la app las refleja y las mantiene al día.',
            },
            { t: 'anim', key: 'sitio-columnas', caption: 'Elegir Propiedades, marcar sus columnas y cuáles se editan desde la app, y empezar.' },
            { t: 'h', text: '1. Qué traer' },
            {
                t: 'p',
                md: 'La app revisa tu sitio y te muestra lo que encontró, con cuántas entradas tiene cada cosa: **Entradas**, **Páginas**, los **tipos de contenido** que agregó un plugin o tu tema (propiedades, cursos, eventos…) y las **taxonomías** (categorías, etiquetas y las de los plugins). Marca las que quieras tener en listas.',
            },
            { t: 'h', text: '2. Qué columnas y cuáles se editan desde aquí' },
            {
                t: 'settings',
                title: 'Las columnas que puedes traer',
                rows: [
                    { name: 'Las de WordPress', what: 'Título, estado, fecha de publicación, última modificación, extracto, imagen destacada, enlace, **Editar en WordPress** y, en las páginas, la página madre y el orden.' },
                    { name: 'Categorías y etiquetas', what: 'Cada taxonomía del tipo de contenido es una columna de selección múltiple.', tip: 'Si escribes una categoría que no existe, se crea en WordPress al guardar.' },
                    { name: 'Campos de ACF', what: 'Si usas Advanced Custom Fields, cada campo aparece con un ejemplo de lo que guarda y el tipo de columna sugerido (número, fecha, enlace, texto).' },
                    { name: 'Campos personalizados', what: 'Los datos que guardan otros plugins. Los internos de los plugins aparecen aparte y plegados.' },
                    { name: 'Medios', what: 'La biblioteca de imágenes y archivos: la miniatura, el texto alternativo, la leyenda, el peso y las medidas.' },
                    { name: 'Con el complemento', what: 'El SEO de cada página y todos los campos personalizados con su tipo, aunque no estén a la vista de la API de WordPress.', tip: 'Ver «El complemento para WordPress».' },
                ],
            },
            {
                t: 'p',
                md: 'Junto a cada columna está la casilla **Editable**: lo que la tenga marcada se podrá cambiar desde la app y el cambio viajará a WordPress. Vienen marcadas sólo las más seguras —**Título**, **Extracto** y las **categorías**—; lo demás lo decides tú. Lo que calcula WordPress (la fecha de modificación, el enlace, el autor) no se puede marcar.',
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'El contenido completo no se trae',
                md: 'El texto de cada entrada se sigue editando en WordPress, con su editor. En la lista tienes **Editar en WordPress** en cada fila para abrirla allá con un clic.',
            },
            { t: 'h', text: '3. Mantener al día' },
            {
                t: 'settings',
                rows: [
                    { name: 'Al instante', what: 'Con el complemento para WordPress instalado, el sitio le avisa a la app cada cambio y llega en segundos. Una vez por hora se revisa todo, por si algo se perdió. Es lo recomendado.' },
                    { name: 'Cada cierto tiempo', what: 'Sin el complemento, la app le pregunta al sitio qué cambió: desde cada 5 minutos hasta una vez por día. Sólo se trae lo que cambió desde la vuelta anterior.' },
                    { name: 'Editar desde la app', what: 'Si está activado, lo que cambies en una columna editable se manda a WordPress. Apagado, todo lo que viene del sitio es de sólo lectura.' },
                    { name: 'Empezar a sincronizar', what: 'Crea la carpeta **WordPress · nombre del sitio** con sus listas y hace la primera vuelta.' },
                ],
            },
            { t: 'h', text: 'La página del sitio, ya sincronizado' },
            {
                t: 'settings',
                rows: [
                    { name: 'Sincronizar ahora', what: 'No espera a la próxima vuelta: trae ya lo que cambió.' },
                    { name: 'Pausar la sincronización', what: 'Detiene las actualizaciones sin borrar nada.' },
                    { name: 'Traer otra columna', what: 'En la tarjeta de cada lista: suma una columna y la llena con lo que ya hay.' },
                    { name: 'Traer otro tipo de contenido', what: 'Agrega una lista más a la carpeta.' },
                    { name: 'Dejar de sincronizar', what: 'Las listas y sus datos quedan y pasan a ser listas comunes: se editan libremente y ya no viajan a WordPress.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Las automatizaciones, sin sustos',
                md: 'Los cambios que llegan del sitio disparan las automatizaciones de cada lista (por ejemplo, avisar al equipo cuando se publica una propiedad). La **primera vuelta no dispara nada**: nadie recibe cientos de avisos al conectar.',
            },
            {
                t: 'example',
                title: 'Una inmobiliaria con su catálogo en WordPress',
                md: 'La inmobiliaria tiene un tipo de contenido **Propiedades** con campos de ACF: precio, ciudad y habitaciones. Trae Propiedades con esas tres columnas y marca **Precio** como editable. El equipo comercial ve todas las propiedades en un tablero por zona, suma una columna propia **Asesor** para repartirlas y actualiza los precios desde la lista: el sitio los muestra al instante.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'Borré una entrada en WordPress, ¿se borra aquí?', a: 'No se borra nada: el registro queda con el estado **Papelera**, así no pierdes su historial ni sus comentarios.' },
                    { q: '¿Qué pasa si se llega al límite de registros del plan?', a: 'La sincronización se detiene con el motivo a la vista. Puedes subir de plan o traer menos tipos de contenido.' },
                    { q: '¿Quién puede configurarlo?', a: 'Quien puede administrar listas y editar la conexión del sitio.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Qué se puede cambiar desde aquí', article: 'sitio-el-sitio-manda' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-el-sitio-manda',
        route: '/lists',
        related: ['sitio-editar-en-lote', 'sitio-sincronizar', 'tienda-la-tienda-manda'],
        blocks: [
            {
                t: 'p',
                md: 'En las listas que vienen de WordPress, **el sitio manda**: los datos vienen de allá y la app los refleja. Por eso no todo se edita aquí. Arriba de la lista hay un aviso **Sincronizada con WordPress** con **¿Qué puedo cambiar?**, y cada columna lleva una marca que dice qué se puede hacer con ella.',
            },
            { t: 'anim', key: 'sitio-lock', caption: 'El título se cambia aquí y llega al sitio, la fecha de modificación la pone WordPress y el responsable es una columna propia.' },
            { t: 'h', text: 'Las tres marcas' },
            {
                t: 'settings',
                rows: [
                    { name: 'Candado', what: 'Viene de WordPress: se edita allá. Al intentar cambiarla, la celda te dice el motivo.' },
                    { name: 'Flechas', what: 'Se puede cambiar desde aquí y el cambio viaja a WordPress.' },
                    { name: 'Lápiz', what: 'Columna propia: se guarda en la app y nunca viaja al sitio.' },
                ],
            },
            { t: 'h', text: 'Elegir qué columnas se editan' },
            {
                t: 'steps',
                items: [
                    'Abre la página del sitio (desde el aviso de la lista con **Ajustes del sitio**, o desde **Ajustes → Integraciones → Sincronizar sitio**).',
                    'Activa **Editar desde la app**.',
                    'En la tarjeta de cada lista, en **Columnas que se editan desde la app**, marca o desmarca cada columna. El cambio se guarda solo.',
                ],
            },
            {
                t: 'p',
                md: 'La misma elección aparece en **Ajustes → Campos** de cada lista del sitio: es la misma, vista desde dos lugares.',
            },
            { t: 'h', text: 'Lo que acepta WordPress' },
            {
                t: 'settings',
                rows: [
                    { name: 'Título', what: 'No puede quedar vacío.' },
                    { name: 'Estado', what: 'Publicado, borrador, pendiente de revisión o privado. Programar una fecha y mandar a la papelera se hacen en WordPress.' },
                    { name: 'Dirección', what: 'La parte final del enlace de la entrada. No puede quedar vacía ni llevar «/», «?» ni «#». WordPress la limpia (acentos, espacios) y la hace única.' },
                    { name: 'Categorías y etiquetas', what: 'Puedes elegir las que existen o escribir una nueva: se crea en WordPress al guardar.' },
                    { name: 'Campos de ACF', what: 'Los de un solo valor (texto, número, fecha, sí/no) se pueden habilitar. Los que tienen varias partes —una lista, un grupo— se traen para mirar y se editan en WordPress.' },
                ],
            },
            { t: 'h', text: 'Cómo viaja un cambio' },
            {
                t: 'p',
                md: 'Cuando cambias una celda, **sólo viaja lo que cambiaste**: si cambias el título, no se manda el estado ni los campos de ACF, así nunca se pisa lo que alguien cambió en el sitio mientras tanto. Lo mismo vale para lo que cambia una automatización. Si WordPress rechaza el cambio, la celda **vuelve al valor del sitio** y la página del sitio muestra el motivo.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Las entradas se crean y se borran en WordPress',
                md: 'En las listas del sitio no se crean ni se importan registros: ni a mano, ni con automatizaciones, ni con el asistente. Eso se hace en WordPress y llega solo; el aviso de la lista tiene el enlace **Crear en WordPress**. Lo que **ya se borró en WordPress** sí se puede quitar de la app (mira **Lo que se borra en tu sitio y lo nuevo que aparece**); lo que sigue vivo allá, no. Una entrada que está en la papelera de WordPress tampoco se edita aquí: hay que restaurarla allá.',
            },
            {
                t: 'example',
                title: 'Columnas propias para el equipo',
                md: 'El equipo de contenidos suma a la lista Entradas una columna propia **Revisó** (persona) y otra **Notas** (texto largo). Las usan para coordinar quién revisa qué antes de publicar. Esas columnas tienen lápiz: se editan libremente y jamás aparecen en el sitio.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo cambiarle el nombre a una columna del sitio?', a: 'Sí, el nombre y la descripción. El tipo lo define el sitio, y no se puede borrar mientras la lista esté sincronizada: para dejar de traerla, quítala de **Columnas que se traen** en la página del sitio: queda como columna propia, con lo que tenía.' },
                    { q: 'Apagué «Editar desde la app», ¿qué pasa con lo que ya cambié?', a: 'Lo que ya llegó a WordPress queda. Desde ese momento todas las columnas del sitio vuelven a tener candado.' },
                    { q: '¿Y si dejo de sincronizar?', a: 'Las listas quedan como listas comunes, con todo lo que tenían y sin candados.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Cambiar muchas entradas a la vez', article: 'sitio-editar-en-lote' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-complemento',
        route: '/settings?s=conectores',
        related: ['sitio-seo', 'sitio-medios', 'sitio-sincronizar'],
        blocks: [
            {
                t: 'p',
                md: 'Sin instalar nada, la app ya trae del sitio lo que WordPress muestra en su API: títulos, estados, fechas, categorías, los medios y los campos de ACF que tengan activado «Mostrar en la API REST». Para todo lo demás está el **complemento para WordPress**: un plugin gratuito que instalas una sola vez en tu sitio y que le abre a la app el SEO de cada página, todos los campos personalizados con su tipo y los avisos al instante.',
            },
            { t: 'anim', key: 'sitio-complemento', caption: 'Se descarga desde la página del sitio, se sube en «Plugins» y la lista suma sus columnas.' },
            { t: 'h', text: 'Qué suma el complemento' },
            {
                t: 'settings',
                rows: [
                    { name: 'El SEO de cada página', what: 'Con **Rank Math**, **Yoast SEO**, **SEOPress** o **All in One SEO**: el título y la descripción para Google, la palabra clave, la dirección canónica y «no indexar», que se pueden cambiar desde aquí. También lo que muestra Google de verdad y el puntaje del plugin, sólo para mirar.' },
                    { name: 'Todos los campos personalizados', what: 'Los de **ACF**, **Meta Box** y **JetEngine** con su tipo real (número, fecha, sí/no, selección con sus opciones), aunque no estén a la vista de la API. También los de otros plugins.' },
                    { name: 'Las categorías con su SEO', what: 'El título y la descripción para Google de categorías, etiquetas y taxonomías, si el plugin de SEO los guarda.' },
                    { name: 'Las palabras de cada página', what: 'Cuántas palabras tiene el contenido, sin traer el contenido.' },
                    { name: 'Dónde se usa cada imagen', what: 'En qué páginas aparece cada medio y cuántas veces.' },
                    { name: 'Al instante', what: 'Cada cambio que haces en WordPress llega en segundos, sin esperar la próxima revisión.' },
                ],
            },
            { t: 'h', text: 'Instalarlo paso a paso' },
            {
                t: 'steps',
                items: [
                    'En la página del sitio (desde **Ajustes → Integraciones → Sincronizar sitio**), toca **Descargar el complemento**. No descomprimas el archivo.',
                    'En tu WordPress, entra con un usuario **Administrador** y ve a **Plugins → Añadir nuevo → Subir plugin**. La app tiene un botón que abre esa pantalla directamente.',
                    'Elige el archivo, toca **Instalar ahora** y después **Activar plugin**.',
                    'Vuelve a la página del sitio y toca **Ya lo instalé**. La tarjeta pasa a **Complemento activo** y dice qué plugin de SEO encontró.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'No toca el contenido de tus páginas',
                md: 'El complemento sólo habla con la app, con la misma contraseña de aplicación de la conexión, y respeta los permisos del usuario conectado. No trae ni cambia el texto de tus páginas ni sus bloques, y no crea entradas: eso se sigue haciendo en WordPress.',
            },
            { t: 'h', text: 'Al instante o cada cierto tiempo' },
            {
                t: 'p',
                md: 'En la página del sitio, **Cómo se mantiene al día** tiene dos opciones. **Al instante** (recomendado) necesita el complemento: el sitio le avisa a la app cada cambio y, además, una vez por hora se revisa todo por si algo se perdió. Debajo ves **Escuchando al sitio** con cuántos avisos llegaron y el último. **Cada cierto tiempo** revisa el sitio con la frecuencia que elijas.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Si «Al instante» no se activa',
                md: 'La app te dice el motivo. Lo más común: el complemento es anterior a la versión 1.1 y la conexión no es de un administrador (actualízalo y un Editor alcanza), o el hosting no deja que WordPress se comunique hacia afuera (un firewall). Mientras tanto, el sitio se revisa cada cierto tiempo.',
            },
            { t: 'h', text: 'Seguro y liviano para tu sitio' },
            {
                t: 'p',
                md: 'El complemento está pensado para que instalarlo no le cueste nada a tu sitio ni lo exponga:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'No hace más lento el sitio', what: 'Las páginas que ven tus visitantes no hacen ninguna consulta de más a la base de datos por el complemento. Sólo trabaja cuando la app le pide algo o cuando alguien guarda un cambio en el escritorio de WordPress.' },
                    { name: 'Avisa sólo lo que importa', what: 'Un contador de visitas o un plugin que guarda datos a cada rato no genera avisos: el complemento sólo avisa los cambios en las columnas que traes a la app, y como mucho despierta el envío una vez cada 15 segundos.' },
                    { name: '«Dónde se usa» sin cargar el sitio', what: 'El índice de qué imágenes usa cada página se arma de a poco, en segundo plano, y después se mantiene solo al guardar. Mientras se arma, la columna aparece en blanco con un aviso.' },
                    { name: 'Respeta los permisos de WordPress', what: 'Sólo lee y cambia lo que el usuario conectado puede ver y editar, campo por campo. Nunca muestra contraseñas, claves ni datos internos de otros plugins, ni tipos de contenido privados.' },
                    { name: 'Nadie puede desviar los avisos', what: 'Los avisos van firmados y sólo a la dirección de tu app. Un usuario que no es administrador no puede cambiar a dónde van ni pisar lo que configuró un administrador.' },
                    { name: 'Actualizaciones verificadas', what: 'Antes de instalar una versión nueva, el complemento comprueba que la firmamos nosotros: un archivo alterado se rechaza. La tarjeta del sitio muestra **Actualizaciones verificadas** cuando está activo.' },
                    { name: 'Convive con otros plugins', what: 'Probado junto a WooCommerce, Elementor, Wordfence, cachés como WP Super Cache, Yoast SEO y Query Monitor, en PHP 7.4 y 8.3.' },
                ],
            },
            { t: 'h', text: 'Actualizaciones' },
            {
                t: 'p',
                md: 'El complemento se actualiza como cualquier plugin: cuando hay una versión nueva, WordPress te la ofrece en **Escritorio → Actualizaciones** y en **Plugins**. La página del sitio también te avisa.',
            },
            { t: 'h', text: 'Si lo desactivas o lo desinstalas' },
            {
                t: 'p',
                md: 'No se pierde nada. Las columnas que daba el complemento quedan **con lo último que llegó**, con un candado y el motivo, y no se pueden editar hasta que vuelva. Lo demás sigue funcionando igual, y el sitio se revisa cada cierto tiempo. Al activarlo de nuevo, toca **Ya lo activé**: las columnas se desbloquean y vuelve el modo al instante.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Necesito un plugin de SEO?', a: 'Para las columnas de SEO, sí: el complemento lee el que ya usas (Rank Math, Yoast SEO, SEOPress o All in One SEO). Sin ninguno, igual trae los campos, las palabras y los medios.' },
                    { q: 'Tengo dos plugins de SEO activos, ¿cuál usa?', a: 'Uno solo, en este orden: Rank Math, Yoast SEO, SEOPress y All in One SEO. La página del sitio te avisa cuál eligió.' },
                    { q: '¿Funciona con JetEngine?', a: 'Sí: lee los campos de los cuadros de JetEngine de cada tipo de contenido.' },
                    { q: '¿Qué pasa al desinstalarlo del todo?', a: 'Borra sus ajustes, sus tareas programadas y su índice de medios del sitio. Tus listas en la app quedan como estaban.' },
                    { q: '¿Puedo instalarlo con un usuario Editor?', a: 'No: instalar plugins es cosa de un **Administrador**. Una vez instalado, la conexión de la app puede ser de un Editor.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Revisar el SEO del sitio', article: 'sitio-seo' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-seo',
        route: '/settings?s=conectores',
        related: ['sitio-complemento', 'sitio-medios', 'ia-campos'],
        blocks: [
            {
                t: 'p',
                md: 'Con el complemento para WordPress y tu plugin de SEO, cada página llega con su **título SEO**, su **descripción para Google**, su **palabra clave** y **lo que muestra Google de verdad**. Así revisas todo el sitio en una tabla: qué páginas no tienen descripción, cuáles tienen el título demasiado largo, y lo arreglas desde aquí.',
            },
            { t: 'anim', key: 'sitio-seo', caption: 'La vista «Sin descripción», el largo en rojo, la propuesta de la IA y la edición en lote que la aplica.' },
            { t: 'h', text: 'Las columnas de SEO' },
            {
                t: 'settings',
                rows: [
                    { name: 'Título SEO', what: 'El título que pusiste en el plugin de SEO. Se puede cambiar desde aquí. Puede llevar las variables del plugin (como el nombre del sitio).' },
                    { name: 'Descripción SEO', what: 'La meta descripción. Se puede cambiar desde aquí.' },
                    { name: 'Palabra clave', what: 'La palabra clave principal de la página.' },
                    { name: 'Dirección canónica', what: 'La dirección que Google debe tomar como la principal. Tiene que ser una dirección completa (https://…).' },
                    { name: 'No indexar', what: 'Si la página se esconde de los buscadores.' },
                    { name: 'Título en Google y Descripción en Google', what: 'Lo que el plugin de SEO arma de verdad, con sus variables resueltas. Sólo para mirar: es lo que hay que medir.' },
                    { name: 'Puntaje', what: 'El puntaje del plugin (Rank Math y Yoast), sólo para mirar.' },
                ],
            },
            { t: 'h', text: 'La auditoría SEO, con un botón' },
            {
                t: 'steps',
                items: [
                    'En la página del sitio, en la tarjeta de **Entradas** (o de Páginas, o de un tipo de contenido), busca **Auditoría SEO** y toca **Armar**.',
                    'La app suma a esa lista las columnas de SEO que falten, dos columnas que cuentan los caracteres del título y de la descripción que ve Google, y las vistas **Sin descripción**, **Título de más de 60 caracteres**, **Descripción de más de 160 caracteres** y **Sin palabra clave**.',
                    'También crea la columna **Meta descripción sugerida**: la IA la escribe leyendo el título, la palabra clave y el extracto de cada página.',
                    'Toca **Calcular las sugerencias** (usa los pedidos de IA de tu plan) y ábrelas en la lista.',
                ],
            },
            { t: 'h', text: 'Aplicar lo que propone la IA' },
            {
                t: 'steps',
                items: [
                    'Abre la vista **Sin descripción** y revisa las sugerencias.',
                    'Marca las filas que te convencen y toca **Editar en lote**.',
                    'Elige **Descripción SEO → Copiar de otra columna → Meta descripción sugerida** y mira la vista previa.',
                    'Toca **Aplicar**: las descripciones viajan a WordPress y aparecen en el código de cada página. Si algo no te gusta, **Deshacer** las devuelve, también en el sitio.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'La IA nunca escribe sola en tu sitio',
                md: 'La columna sugerida es sólo una propuesta. Al sitio llega únicamente lo que tú copias a **Descripción SEO**.',
            },
            {
                t: 'example',
                title: 'Una agencia que cuida el SEO de un cliente',
                md: 'La agencia arma la auditoría en las entradas del blog de su cliente. La vista **Título de más de 60 caracteres** muestra 14 entradas: las acorta en la tabla, una por una. En **Sin descripción** calcula las sugerencias, corrige dos y las aplica en lote. En diez minutos el blog tiene todas sus descripciones, y el cliente ve los cambios en su WordPress.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Funciona con las categorías?', a: 'Sí, si tu plugin de SEO guarda el SEO de las categorías (Rank Math, Yoast SEO y SEOPress lo hacen).' },
                    { q: 'Cambié de plugin de SEO, ¿qué pasa?', a: 'En la próxima revisión las columnas leen el plugin nuevo. Lo que guardaste en el anterior sigue en tu sitio, en ese plugin.' },
                    { q: '¿Por qué el largo se mide en lo que ve Google?', a: 'Porque el título SEO puede llevar variables (como el nombre del sitio) que lo alargan: lo que se corta en Google es el resultado final.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'El texto alternativo de las imágenes', article: 'sitio-medios' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-medios',
        route: '/settings?s=conectores',
        related: ['sitio-seo', 'sitio-complemento', 'sitio-editar-en-lote'],
        blocks: [
            {
                t: 'p',
                md: 'La **biblioteca de medios** de tu WordPress puede llegar a su propia lista: cada imagen con su miniatura, su **texto alternativo**, su leyenda, su peso y sus medidas. El texto alternativo es lo que leen los lectores de pantalla y lo que entiende Google de una imagen: completarlo mejora la accesibilidad y el SEO.',
            },
            { t: 'anim', key: 'sitio-alt', caption: 'La IA mira cada imagen sin texto alternativo y lo propone; copiado, viaja a WordPress.' },
            { t: 'h', text: 'Traer los medios' },
            {
                t: 'p',
                md: 'Al elegir qué traer del sitio, marca **Medios**. Si ya sincronizas el sitio, usa **Traer otro tipo de contenido** en su página. Vienen marcados el título, la imagen, el texto alternativo, la leyenda, el tipo de archivo, las medidas, el peso y la fecha. El título, el texto alternativo, la leyenda y la descripción se pueden cambiar desde aquí.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Imagen', what: 'La miniatura, para reconocerla de un vistazo.' },
                    { name: 'Texto alternativo', what: 'Una frase corta que describe lo que se ve. Hasta 125 caracteres es lo ideal.' },
                    { name: 'Peso (KB)', what: 'Cuánto pesa el archivo. Una imagen pesada hace lento el sitio.' },
                    { name: 'Dónde se usa', what: 'Con el complemento para WordPress: en qué páginas aparece la imagen y cuántas veces.' },
                ],
            },
            { t: 'h', text: 'Texto alternativo con IA' },
            {
                t: 'steps',
                items: [
                    'En la página del sitio, en la tarjeta de **Medios**, busca **Texto alternativo con IA** y toca **Armar**.',
                    'Se crean las vistas **Sin texto alternativo** e **Imágenes de más de 300 KB**, y la columna **Texto alternativo sugerido**: la IA mira cada imagen y escribe una frase que la describe.',
                    'Toca **Calcular las sugerencias** (usa los pedidos de IA de tu plan).',
                    'En la vista **Sin texto alternativo**, marca las que te convencen y usa **Editar en lote → Texto alternativo → Copiar de otra columna → Texto alternativo sugerido**. Viaja a WordPress y se puede deshacer.',
                ],
            },
            {
                t: 'example',
                title: 'Una tienda con cientos de fotos sin describir',
                md: 'La tienda trae su biblioteca: 420 imágenes, 310 sin texto alternativo. Arma el kit, calcula las sugerencias y revisa la vista: corrige las que nombran mal un producto y aplica el resto en lote. Con **Imágenes de más de 300 KB** encuentra las fotos que conviene comprimir antes de subirlas de nuevo.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo subir imágenes desde aquí?', a: 'No: las imágenes se suben en WordPress y llegan solas. El aviso de la lista tiene el enlace **Subir en WordPress**.' },
                    { q: 'Borré una imagen en WordPress, ¿qué pasa aquí?', a: 'El registro queda con el estado **Borrado en WordPress**: no se pierde su historial.' },
                    { q: '¿La IA ve imágenes de otros sitios?', a: 'Sólo la miniatura de cada imagen de tu biblioteca, cuando tocas Calcular las sugerencias.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a Integraciones', to: '/settings?s=conectores' },
                    { label: 'Cambiar muchas entradas a la vez', article: 'sitio-editar-en-lote' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-editar-en-lote',
        route: '/lists',
        related: ['lote-editar-en-lote', 'lote-historial-deshacer', 'sitio-el-sitio-manda'],
        blocks: [
            {
                t: 'p',
                md: 'La **edición en lote** de la app también funciona en las listas del sitio: pasar veinte borradores a publicados, agregarles una categoría a todas las entradas de un filtro o poner el mismo valor de ACF en muchas propiedades. Cada cambio pasa por las mismas reglas que una celda y viaja a WordPress.',
            },
            { t: 'anim', key: 'sitio-hero', caption: 'Cada registro cambiado en lote viaja a WordPress como si lo hubieras cambiado a mano.' },
            { t: 'h', text: 'Paso a paso' },
            {
                t: 'steps',
                items: [
                    'En la lista del sitio, marca las filas (o filtra la vista: por ejemplo, el estado «Borrador»).',
                    'Toca **Editar en lote** en la barra de selección. Para todo lo que muestra la vista, ábrelo desde **Personalizar vista → Edición masiva**.',
                    'Elige la columna y el cambio: poner un valor, agregar o quitar categorías, sumar a un número de ACF.',
                    'Mira la vista previa: verás el antes y el después de cada entrada, y las que no se pueden cambiar con el motivo.',
                    'Toca **Aplicar**. Los cambios se guardan en tandas y se mandan a WordPress uno por uno.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Sólo las columnas habilitadas',
                md: 'En la edición en lote sólo puedes cambiar las columnas que habilitaste en **Columnas que se editan desde la app**, con **Editar desde la app** activado. Las demás aparecen con su motivo en la vista previa y no se tocan.',
            },
            { t: 'h', text: 'Deshacer' },
            {
                t: 'p',
                md: 'Al terminar, toca **Deshacer** en el resultado, o búscalo después en el **Historial de ediciones masivas** de la lista. Cada entrada vuelve a como estaba, **también en WordPress**. Lo que alguien cambió después no se pisa: se lista aparte para que decidas.',
            },
            {
                t: 'example',
                title: 'Publicar las propiedades revisadas',
                md: 'La inmobiliaria filtra Propiedades por **Estado: Borrador** y su columna propia **Revisó** con valor. Marca todas, abre **Editar en lote** y pone **Estado → Publicado**. Las doce propiedades aparecen en el sitio en un minuto. Si se apuraron, **Deshacer** desde el historial las vuelve a borrador en WordPress.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo borrar entradas en lote?', a: 'Se borran en WordPress: mándalas a la papelera allá y llegan solas con ese estado. Después, si ya no te sirven en la app, quítalas de una vez con **Quitarlos de la app** en la barra de la lista.' },
                    { q: '¿Dispara automatizaciones?', a: 'Sí: cada cambio es un cambio real del registro y dispara las automatizaciones de la lista.' },
                    { q: '¿Qué pasa si WordPress rechaza algunas?', a: 'Las rechazadas vuelven al valor del sitio y la página del sitio cuenta cuántos cambios no llegaron y por qué.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'La edición en lote en cualquier lista', article: 'lote-editar-en-lote' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'sitio-borrado-y-novedades',
        route: '/lists',
        related: ['sitio-el-sitio-manda', 'sitio-sincronizar', 'tienda-lo-que-se-borra', 'ajustes-empresa-papelera'],
        blocks: [
            {
                t: 'p',
                md: 'Tu sitio cambia: se borran entradas que ya no van, alguien crea un campo nuevo con ACF o un plugin suma un tipo de contenido. La app se entera sola de las dos cosas: lo que **se borra** en WordPress queda marcado en su lista (y si quieres, sale de la app), y lo **nuevo** aparece como novedad en la página del sitio para que decidas si traerlo.',
            },
            { t: 'anim', key: 'fuente-borrado', caption: 'Lo que se borró en WordPress queda marcado «Papelera»; con un toque sale de la lista y pasa a la papelera de la app.' },
            { t: 'h', text: 'Lo que se borra en WordPress' },
            {
                t: 'p',
                md: 'Cuando mandas una entrada a la papelera de WordPress (o la borras del todo), su registro queda en la lista con el estado **Papelera** y todos sus datos. Arriba de la lista aparece una barra que lo cuenta: **1 registro ya se borró en WordPress**.',
            },
            {
                t: 'steps',
                items: [
                    'En la lista, toca **Quitarlos de la app** en la barra. Para uno solo, abre el menú de su fila (clic derecho) o su ficha y toca **Quitar de la app**.',
                    'Revisa cuántos se quitan y toca **Quitar N registros de la app**.',
                    'Listo: salen de la lista, van a la **papelera de la app** por 30 días y **dejan de contar para tu plan**. Al terminar puedes **Deshacer**.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo que sigue en WordPress no se quita',
                md: 'Sólo se quita lo que ya se borró en el sitio. Si intentas quitar algo que sigue vivo allá, la app te dice **Sigue en WordPress: se borra allá**: si lo quitaras aquí, volvería en la próxima sincronización.',
            },
            { t: 'h', text: 'Que salga solo' },
            {
                t: 'p',
                md: 'Si nunca quieres conservar lo que se borra, en la página del sitio, en **Lo que se borra en WordPress**, elige **Quitarlo de la app**. Desde ese momento lo que se borre en WordPress sale solo de la lista, y lo que ya estaba marcado se quita al elegirlo (la app te pide confirmar y dice cuántos son). **Conservarlo marcado** es lo de siempre: queda en la lista con el estado **Papelera**.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Conservarlo marcado', what: 'Queda en la lista con el estado «Papelera» y todos sus datos. Lo quitas cuando quieras.' },
                    { name: 'Quitarlo de la app', what: 'Sale de la lista solo, va a la papelera de la app 30 días y deja de contar para tu plan.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Si vuelve en WordPress, vuelve aquí',
                md: 'Si alguien restaura la entrada en WordPress, en la próxima sincronización vuelve **el mismo registro**, con su historial, sus comentarios y sus columnas propias. También puedes recuperarlo a mano desde **Ajustes → Papelera** durante 30 días: vuelve marcado, porque sigue borrado en el sitio.',
            },
            { t: 'h', text: 'Lo nuevo de tu sitio' },
            { t: 'anim', key: 'sitio-novedades', caption: 'Un campo nuevo de ACF aparece como novedad; al tocar Traer, la columna llega llena con lo que tiene el sitio.' },
            {
                t: 'p',
                md: 'Una vez por día la app revisa tu sitio. Si aparece un **tipo de contenido nuevo** (por ejemplo, «Proyectos») o una **columna nueva** en algo que ya traes (un campo de ACF, un campo personalizado, el SEO de un plugin recién instalado), la página del sitio muestra la tarjeta **Novedades en tu sitio**, y la lista afectada lo avisa en su barra de arriba.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Traer / Traerlo', what: 'Suma la columna a su lista (se llena sola con lo que tiene el sitio) o crea la lista del tipo de contenido nuevo con sus columnas de siempre.' },
                    { name: 'Ya lo vi', what: 'Deja de mostrarlo. Si después lo quieres, lo traes desde **Traer otra columna** o **Traer otro tipo de contenido**.' },
                    { name: 'Buscar novedades ahora', what: 'Revisa el sitio en el momento, sin esperar a la revisión del día.' },
                ],
            },
            {
                t: 'p',
                md: 'Lo que ya estaba en el sitio cuando lo conectaste y elegiste no traer **no aparece como novedad**: la app sólo avisa lo que apareció después. Los campos internos de los plugins (los que empiezan con guion bajo) tampoco.',
            },
            {
                t: 'example',
                title: 'Una colección que no vuelve',
                md: 'Una tienda de ropa publicaba su colección de invierno como entradas. Termina la temporada y las manda a la papelera de WordPress: en la app aparecen marcadas. Como esas prendas no vuelven, toca **Quitarlos de la app**: la lista queda limpia y esos registros dejan de contar para el plan. En marzo crean con ACF un campo **Temporada**: la página del sitio lo avisa y con **Traer** ya tienen la columna llena.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quitar de la app borra algo en WordPress?', a: 'No. Sólo saca el registro de la app; en WordPress no se toca nada.' },
                    { q: '¿Qué pasa después de los 30 días?', a: 'El registro se borra de la papelera de la app para siempre. Si la entrada vuelve a estar en WordPress después, llega como registro nuevo.' },
                    { q: '¿Quién puede quitar registros?', a: 'Quien puede borrar registros en la lista. Para quitar varios de una vez hace falta poder hacer acciones en lote.' },
                    { q: '¿Las novedades se revisan solas?', a: 'Sí, una vez por día y cada vez que abres **Traer otra columna** o **Traer otro tipo de contenido**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Recuperar algo de la papelera', article: 'ajustes-empresa-papelera' },
                ],
            },
        ],
    },
];
