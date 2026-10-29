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
                    'Se abre la pantalla **Autorizar aplicación** de tu propio WordPress. Si no tenías la sesión abierta, entra con un usuario **Editor** o **Administrador**.',
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
            { t: 'h', text: 'Si prefieres pegar una contraseña de aplicación' },
            {
                t: 'p',
                md: 'Algunos plugins de seguridad esconden la pantalla **Autorizar aplicación**. En ese caso, en el mismo cuadro toca **Prefiero pegar una contraseña de aplicación** y sigue los pasos:',
            },
            {
                t: 'steps',
                items: [
                    'En tu WordPress entra a **Usuarios → Perfil** con un usuario Editor o Administrador.',
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
                    { name: 'El usuario no tiene permiso para editar', what: 'Conecta un usuario **Editor** o **Administrador**: un Autor o un Suscriptor no alcanza.' },
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
                    { name: 'Frecuencia', what: 'Cada cuánto la app le pregunta al sitio qué cambió: desde cada 5 minutos hasta una vez por día. Sólo se trae lo que cambió desde la vuelta anterior.' },
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
                title: 'No se crean ni se borran entradas desde aquí',
                md: 'En las listas del sitio no se crean, borran ni importan registros: ni a mano, ni con automatizaciones, ni con el asistente. Eso se hace en WordPress y llega solo; el aviso de la lista tiene el enlace **Crear en WordPress**. Una entrada que está en la papelera de WordPress tampoco se edita aquí: hay que restaurarla allá.',
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
                    { q: '¿Puedo borrar entradas en lote?', a: 'No: en las listas del sitio no se borra desde la app. Mándalas a la papelera en WordPress y llegan solas con ese estado.' },
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
];
