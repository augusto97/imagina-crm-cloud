import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'correos-enviar',
        route: '/lists',
        related: ['correos-editor', 'correos-como-salen', 'automatizaciones-correos'],
        blocks: [
            {
                t: 'p',
                md: 'Los correos salen desde las **automatizaciones**: «cuando se crea una factura, mándale la cuenta de cobro al cliente», «cuando un ticket se cierra, pídele que califique la atención», «tres días antes del vencimiento, recuérdale el pago». Lo escribes una sola vez con **variables** y cada registro sale con sus propios datos: su nombre, su monto, su fecha.',
            },
            {
                t: 'p',
                md: 'Este módulo se concentra en el correo en sí: cómo se arma, cómo se ve y desde dónde sale. Si todavía no armaste una automatización, empieza por *Qué son las automatizaciones*; aquí damos por hecho que ya tienes una y le vas a agregar el paso **Enviar email**.',
            },
            { t: 'anim', key: 'correo-enviar', caption: 'La acción «Enviar email» con destinatario y asunto con variables, diseño visual, firma y la cuenta de cobro adjunta; y la prueba que llega a tu bandeja.' },
            { t: 'h', text: 'Agregar el paso «Enviar email»' },
            {
                t: 'steps',
                items: [
                    'Abre la lista (por ejemplo **Facturas**) y toca **Automatizaciones** arriba, junto al nombre.',
                    'Abre una automatización o crea una con **En blanco** o **Desde plantilla**, y elige el disparador en la tarjeta **Cuando**.',
                    'Toca **Añadir la primera acción** (o el **+** entre dos pasos) y elige **Enviar email**.',
                    'Completa **Para** y **Asunto**. Debajo de cada cuadro aparecen los **Campos** de la lista: tócalos para insertar la variable, o abre **+3** para ver el resto.',
                    'En **Contenido** elige el formato. Para un correo con diseño, toca **Diseño visual**: se abre el editor con las plantillas.',
                    'Toca **Enviarme una prueba**, revisa el correo en tu bandeja y, si te gusta, toca **Guardar** arriba de todo.',
                ],
            },
            { t: 'h', text: 'Los datos del correo' },
            {
                t: 'settings',
                rows: [
                    { name: 'Para', what: 'Uno o varios correos separados por coma. Acepta variables: un campo Email como {{email}}, el correo de un campo Persona como {{responsable.email}} o direcciones fijas.', tip: 'Hasta 25 destinatarios por correo.' },
                    { name: 'Asunto', what: 'Con variables: «Tu cuenta de cobro {{numero}} vence el {{vencimiento}}».' },
                    { name: 'Contenido', what: 'El cuerpo del correo, en uno de tres formatos: **Diseño visual**, **Texto** o **HTML**.' },
                    { name: 'Texto de vista previa', what: 'Sólo en diseño visual: la línea que se lee junto al asunto en la bandeja de entrada, antes de abrir el correo.', tip: 'Úsala para el dato clave: «Vence el viernes · $ 1.250.000».' },
                    { name: 'Agregar la firma al final del correo', what: 'Pega al final la firma de la persona que elijas en **Firma de**. Cada quien escribe la suya en Ajustes.' },
                    { name: 'Adjuntar PDF', what: 'Marca hasta cinco plantillas de documento de la lista (cuenta de cobro, cotización). Se arman con los datos del registro en el momento del envío.' },
                    { name: 'Enviarme una prueba', what: 'Manda el correo **sólo a tu dirección**, con los datos del último registro de la lista y con los adjuntos.' },
                    { name: 'Avanzado: remitente, Cc, Cco', what: '**Nombre remitente** (el nombre que se lee en la bandeja), **Cc** y **Cco**, separados por coma y con variables.' },
                    { name: 'Condición de ejecución (opcional)', what: 'Que este paso sólo corra si se cumple algo, por ejemplo «Estado es Pendiente».' },
                ],
            },
            { t: 'h', text: 'Diseño visual, texto o HTML' },
            {
                t: 'cards',
                items: [
                    { icon: 'Palette', title: 'Diseño visual', md: 'Recomendado. Armas el correo con bloques, ves el resultado real y se ve bien en Gmail, Outlook y el celular sin que hagas nada técnico.', tone: 'violet' },
                    { icon: 'Type', title: 'Texto', md: 'Un mensaje simple, como un correo escrito a mano. Rápido para avisos internos. La firma va sin imágenes ni colores.', tone: 'blue' },
                    { icon: 'Code', title: 'HTML', md: 'Para quien ya tiene su propio diseño. Usa tablas y estilos en línea para que Outlook y Gmail lo respeten. La firma se agrega debajo.', tone: 'slate' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si el contenido está vacío y eliges **Diseño visual**, el editor abre directo en **Elige una plantilla**. Si ya diseñaste el correo, el botón dice **Editar diseño** y muestra cuántos bloques tiene.',
            },
            { t: 'demo', key: 'correo-demo-plantilla', caption: 'Agregar «Enviar email», pasar a diseño visual, partir de una plantilla y revisarla con una factura real y en el celular.', fallback: 'correo-editor' },
            { t: 'h', text: 'Variables útiles en un correo' },
            {
                t: 'p',
                md: 'Cualquier campo del registro entra como variable con su nombre interno entre llaves dobles. Además de los campos, en un correo se usan mucho: **{{record.id}}** (el número del registro), **{{responsable.nombre}}** y **{{responsable.email}}** (de un campo Persona), **{{pdf.link}}** (un enlace al documento que generó un paso anterior) y **{{pago.link}}** (el link de pago de un paso «Crear link de pago»).',
            },
            {
                t: 'p',
                md: 'Un **modificador** después de una barra cambia cómo se escribe el valor: **{{monto|moneda}}** sale como «$ 1.250.000», **{{vencimiento|larga}}** como «15 de noviembre de 2026» y **{{estado|label}}** con la etiqueta de la opción en vez de su valor interno.',
            },
            {
                t: 'example',
                title: 'Un estudio de abogados en Bogotá',
                md: 'Cuando una cita pasa a **Confirmada**, sale un correo con diseño al cliente: título «Te esperamos el {{fecha|larga}}», la dirección de la oficina, un botón «Cómo llegar» con el enlace del mapa y la firma de la abogada a cargo (**Firma de**: el campo Persona **Responsable**). Con **Cco** a la secretaria para que quede en su bandeja.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿La prueba usa a un cliente real?', a: 'Usa los datos del último registro de la lista para armar el correo, pero **sólo te llega a ti**: el cliente no recibe nada.' },
                    { q: '¿Puedo mandar el correo al responsable en lugar del cliente?', a: 'Sí: en **Para** usa {{responsable.email}}, con el nombre de tu campo Persona.' },
                    { q: '¿Qué pasa si el registro no tiene correo?', a: 'Ese paso falla con el motivo, queda en el historial de la automatización y aparece en **Problemas**. Para evitarlo, agrega en el disparador un filtro «Email no está vacío».' },
                    { q: '¿Cambiar el diseño afecta a los correos ya enviados?', a: 'No. Lo que ya salió queda como salió; el diseño nuevo vale para los próximos envíos.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Recorrido de automatizaciones', tour: 'automation-basics' },
                    { label: 'El editor visual', article: 'correos-editor' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'correos-editor',
        route: '/lists',
        related: ['correos-estilo', 'correos-vista-previa', 'correos-enviar'],
        blocks: [
            {
                t: 'p',
                md: 'El **editor visual** se abre a pantalla completa desde la acción **Enviar email**, con el formato **Diseño visual**. Tiene tres partes: a la izquierda los bloques y los ajustes del correo, al centro **el correo real** tal como va a salir, y a la derecha los ajustes del bloque que elijas. No escribes código: cada cosa que agregas se ve al instante.',
            },
            { t: 'anim', key: 'correo-editor', caption: 'Se arrastra el bloque «Botón» al correo, cae donde marca la línea, y a la derecha se escribe su texto y su enlace.' },
            { t: 'h', text: 'Empezar desde una plantilla' },
            {
                t: 'p',
                md: 'Toca **Plantillas** arriba y elige un punto de partida. Después cambias todo: textos, colores y bloques. Si te equivocas, **Deshacer** vuelve al diseño anterior.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'En blanco', what: 'Una hoja vacía para armar desde cero.' },
                    { name: 'Mensaje simple', what: 'Título, texto y la firma. El correo de todos los días.' },
                    { name: 'Aviso con botón', what: 'Banda de color con el título, el mensaje y un botón de acción.' },
                    { name: 'Notificación con datos', what: 'Un resumen con los datos del registro en una tabla prolija.' },
                    { name: 'Recordatorio de pago', what: 'Monto destacado, fecha de vencimiento y el botón para pagar con {{pago.link}}.', tip: 'Cambia los «—» del texto por las variables de tu lista.' },
                    { name: 'Bienvenida', what: 'Imagen de cabecera, saludo, tres pasos en columnas y un botón.' },
                    { name: 'Novedades', what: 'Título, una imagen y dos noticias lado a lado.' },
                ],
            },
            { t: 'h', text: 'Los bloques' },
            {
                t: 'cards',
                items: [
                    { icon: 'Type', title: 'Título', md: 'Un título grande o un subtítulo.', tone: 'violet' },
                    { icon: 'PenLine', title: 'Texto', md: 'Párrafos con negrita, cursiva, listas, citas, colores, enlaces y variables.', tone: 'blue' },
                    { icon: 'MousePointerClick', title: 'Botón', md: 'Abre un enlace: pagar, ver el pedido, confirmar la cita.', tone: 'mint' },
                    { icon: 'Image', title: 'Imagen', md: 'Un logo, una foto o un banner, subido o con su dirección https.', tone: 'amber' },
                    { icon: 'Table', title: 'Datos del registro', md: 'Los campos que elijas, con su nombre y el valor ya formateado.', tone: 'cyan' },
                    { icon: 'Columns3', title: 'Columnas', md: 'Dos o tres columnas que en el celular se apilan solas.', tone: 'rose' },
                    { icon: 'Mail', title: 'Firma', md: 'La firma de la persona elegida, en el lugar que quieras.', tone: 'violet' },
                    { icon: 'Code', title: 'Separador, Espacio y HTML propio', md: 'Una línea fina, aire entre bloques, o tu propio HTML para casos especiales.', tone: 'slate' },
                ],
            },
            { t: 'h', text: 'Agregar, mover y editar' },
            {
                t: 'steps',
                items: [
                    'En la pestaña **Agregar**, **arrastra** un bloque al correo y suéltalo donde marca la línea, o **haz clic** en él para agregarlo debajo del bloque elegido.',
                    'Toca un bloque en la vista previa para elegirlo. Arriba del bloque aparece una barra con subir, bajar, duplicar y eliminar.',
                    'A la derecha edita sus ajustes en dos pestañas: **Contenido** (textos, enlace, imagen, campos) y **Estilo** (fuente, espaciado, borde, fondo).',
                    'En la pestaña **Estructura** ves el orden del correo de arriba hacia abajo: arrastra los bloques para cambiarlos de lugar, también entre columnas.',
                    'Cuando termines, toca **Listo**. Aparece «Diseño aplicado»: falta **Guardar** la automatización para que quede.',
                ],
            },
            { t: 'demo', key: 'correo-demo-estilo', caption: 'Abrir el estilo general, cambiar el color de acento y elegir el botón para cambiar su forma.', fallback: 'correo-estilo' },
            { t: 'h', text: 'Ajustes de los bloques más usados' },
            {
                t: 'settings',
                rows: [
                    { name: 'Botón → Texto del botón y Enlace', what: 'El enlace puede empezar con https:// o mailto: o ser una variable, como {{pago.link}} o la dirección de un campo Enlace.' },
                    { name: 'Botón → Color del botón y Ocupar todo el ancho', what: 'Sin color propio usa el acento del correo. A todo el ancho se toca mejor en el celular.' },
                    { name: 'Imagen → Subir imagen', what: 'PNG, JPG, GIF o WebP; mejor si pesa menos de 1 MB. También puedes pegar una dirección https://.' },
                    { name: 'Imagen → Texto alternativo', what: 'Lo que se lee si el programa de correo no muestra imágenes. Escribe qué hay en la foto.' },
                    { name: 'Imagen → De borde a borde', what: 'La imagen ocupa todo el ancho del correo, sin márgenes: ideal para un banner.' },
                    { name: 'Datos del registro → Campos a mostrar', what: 'Montos con separadores, fechas en tu formato y etiquetas de las opciones. Con **Forma**: Tabla o Uno debajo del otro.' },
                    { name: 'Columnas → Dos o Tres', what: 'Con su proporción, separación y alineación. Adentro van títulos, textos, botones, imágenes, separadores y espacios.' },
                    { name: 'Texto → Variable', what: 'El botón **Variable** de la barra del texto inserta un campo donde está el cursor.' },
                ],
            },
            { t: 'h', text: 'Atajos de teclado' },
            {
                t: 'keys',
                items: [
                    { keys: ['Ctrl', 'Z'], what: 'Deshacer' },
                    { keys: ['Ctrl', 'Shift', 'Z'], what: 'Rehacer' },
                    { keys: ['Supr'], what: 'Eliminar el bloque elegido' },
                    { keys: ['Ctrl', 'D'], what: 'Duplicar el bloque elegido' },
                    { keys: ['Alt', '↑'], what: 'Subir el bloque' },
                    { keys: ['Alt', '↓'], what: 'Bajar el bloque' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'En el teléfono el editor se organiza en pestañas: **Bloques**, **Vista previa** y **Editar**. Ahí no se arrastra: tocas un bloque para agregarlo debajo del elegido.',
            },
            {
                t: 'example',
                title: 'Una tienda de ropa en Medellín',
                md: 'El correo de «Tu pedido va en camino»: imagen del logo, título con el nombre del cliente, un **Datos del registro** con número de pedido, total y transportadora, un botón «Rastrear mi pedido» con el enlace de la guía y, abajo, dos **Columnas** con «Cambios y devoluciones» y «Escríbenos por WhatsApp».',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Se pierde el diseño si cierro el editor?', a: '**Cancelar** pregunta si quieres descartar los cambios. **Listo** los pasa a la automatización, que todavía tienes que **Guardar**.' },
                    { q: '¿Por qué no puedo poner los datos del registro dentro de una columna?', a: 'Los bloques Datos del registro, Firma y HTML propio van a lo ancho del correo: dentro de una columna quedarían ilegibles en el celular.' },
                    { q: '¿Puedo usar el mismo diseño en otra automatización?', a: 'Sí: guarda la automatización como plantilla desde su tarjeta, o duplícala y cambia lo necesario.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Colores y fuentes', article: 'correos-estilo' },
                    { label: 'Vista previa y modo oscuro', article: 'correos-vista-previa' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'correos-estilo',
        route: '/lists',
        related: ['correos-editor', 'correos-vista-previa', 'ajustes-empresa-marca'],
        blocks: [
            {
                t: 'p',
                md: 'El diseño de un correo se ajusta en dos niveles. El **Estilo general** vale para todo el correo: colores, fuentes, ancho, esquinas. El **estilo de cada bloque** (la pestaña **Estilo** del bloque elegido) cambia sólo ese bloque y **manda sobre el general**. Así pones la marca una vez y retocas lo que haga falta.',
            },
            { t: 'anim', key: 'correo-estilo', caption: 'Al cambiar el acento y la fuente de los títulos en «Estilo general», el botón, la banda, los enlaces y los títulos cambian a la vez.' },
            { t: 'h', text: 'Estilo general' },
            {
                t: 'p',
                md: 'En la columna izquierda toca **Estilo general**. Las opciones están agrupadas en secciones que se pliegan: **Colores**, **Texto**, **Hoja** y **Modo oscuro**.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Acento (botones y enlaces)', what: 'El color de tu marca: lo usan los botones y los enlaces que no tengan color propio.' },
                    { name: 'Fondo del correo y Fondo de afuera', what: 'La hoja del correo y lo que se ve alrededor en una pantalla ancha.' },
                    { name: 'Fuente del texto y Fuente de los títulos', what: 'Las letras del correo. Los títulos pueden usar **La misma del texto** u otra.' },
                    { name: 'Tamaño del texto e Interlineado', what: 'En píxeles y en proporción (1,6 es cómodo de leer).' },
                    { name: 'Color del texto, Texto secundario, Títulos y Enlaces del texto', what: 'Cada tono por separado.' },
                    { name: 'Ancho del correo', what: 'Entre 480 y 720 px. Con 600 se ve bien en casi todos los programas.' },
                    { name: 'Esquinas, Margen lateral y Aire alrededor', what: 'Lo redondeado de la hoja y el espacio interior y exterior.' },
                    { name: 'Borde de la hoja y Sombra de la hoja', what: 'Una línea alrededor del correo y una sombra **Sin**, **Suave**, **Media** o **Fuerte**.' },
                ],
            },
            { t: 'h', text: 'El estilo de un bloque' },
            {
                t: 'p',
                md: 'Toca un bloque en la vista previa y abre la pestaña **Estilo** a la derecha. Cada sección muestra «con cambios» cuando la tocaste y **Restablecer** la deja como el estilo general.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Texto', what: '**Fuente**, **Tamaño**, **Grosor** (Normal, Semi, Negrita, Extra), **Interlineado**, **Entre letras**, **Itálica** y **Mayúsculas** (todo en mayúsculas, en minúsculas o cada palabra con mayúscula).' },
                    { name: 'Fondo', what: 'Un **Color de fondo** y qué ocupa: **Una banda de borde a borde del correo** o **Una tarjeta dentro de los márgenes**.' },
                    { name: 'Espaciado', what: '**Margen arriba** y **Margen abajo** separan el bloque de los demás; el **Relleno** es el aire entre el borde y el contenido, igual en los cuatro lados o por lado.' },
                    { name: 'Borde, esquinas y sombra', what: '**Grosor del borde**, **Tipo de línea** (continua, rayada, punteada), color, en qué lados, **Esquinas redondeadas** y **Sombra**.' },
                    { name: 'Botón', what: 'Su color, alineación, **Ocupar todo el ancho**, **Relleno vertical** y **lateral**, o un **Ancho fijo**.' },
                    { name: 'Copiar y Pegar', what: '«Mismo estilo en otro bloque»: copia el texto, el espaciado y el borde de un bloque y pégalo en otro.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Un número exacto (por ejemplo 18 px) manda sobre los atajos (Chico, Normal, Grande). Deja el cuadro vacío para que siga al estilo general.',
            },
            { t: 'h', text: 'Fuentes que se ven en todos lados' },
            {
                t: 'cards',
                items: [
                    { icon: 'ShieldCheck', title: 'Del sistema', md: 'Arial, Verdana, Trebuchet, Tahoma, Georgia, Times New Roman, Courier y la **Moderna** (Segoe UI o Roboto). Se ven igual en todos los programas.', tone: 'mint' },
                    { icon: 'Globe', title: 'Web, con fuente de respaldo', md: 'Inter, Roboto, Open Sans, Lato, Montserrat, Poppins, Nunito, Raleway, Playfair Display, Merriweather y Lora. Apple Mail, el iPhone, Outlook de Mac, Samsung y Thunderbird las muestran.', tone: 'violet' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Gmail y Outlook de Windows no cargan fuentes web: muestran la fuente de respaldo, que se elige sola para que el correo no se desarme. Outlook de Windows además dibuja las **esquinas rectas** y **sin sombra**, y la seminegrita como negrita.',
            },
            {
                t: 'example',
                title: 'Una clínica odontológica en Lima',
                md: 'Acento en el azul de la marca, títulos en **Montserrat** y texto en la fuente **Moderna**. Al aviso «Recuerda tu cita de mañana» le pusieron fondo celeste como **tarjeta dentro de los márgenes** con esquinas de 12 px, y al botón «Confirmar asistencia» **Ocupar todo el ancho** para que se toque fácil desde el celular.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Uso el color de la marca de mi empresa?', a: 'Elígelo en **Acento**. Tip: copia el código del color (por ejemplo #0e7490) desde Ajustes → Marca y pégalo aquí.' },
                    { q: 'Cambié el estilo general y un bloque no cambió', a: 'Ese bloque tiene estilo propio, que manda. Ábrelo, ve a **Estilo** y toca **Restablecer** en la sección que corresponda.' },
                    { q: '¿Puedo usar una fuente que no está en la lista?', a: 'No en el diseño visual: las de la lista son las que se pueden garantizar en los programas de correo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ver en el celular y en modo oscuro', article: 'correos-vista-previa' },
                    { label: 'La marca de tu empresa', to: '/settings?s=marca' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'correos-vista-previa',
        route: '/lists',
        related: ['correos-editor', 'correos-estilo', 'correos-enviar'],
        blocks: [
            {
                t: 'p',
                md: 'La vista previa del centro del editor **es el correo real**, armado igual que cuando sale. Con los botones de la barra de arriba lo revisas como lo verá cada persona: en computador o en celular, con las variables o con los datos de un cliente, y en modo oscuro.',
            },
            { t: 'anim', key: 'correo-vista', caption: 'Primero con las variables a la vista, después con los datos de una factura real y al final en el celular con modo oscuro.' },
            { t: 'h', text: 'Los botones de la barra' },
            {
                t: 'settings',
                rows: [
                    { name: 'Escritorio y Celular', what: 'El ícono de la pantalla muestra el correo al ancho de un computador; el del teléfono, al de un celular (375 px).' },
                    { name: 'Ver las variables', what: 'Las variables se ven como etiquetas ({{nombre}}). Es el modo para editar: elegir, mover y arrastrar bloques.' },
                    { name: 'Ver con datos de un registro', what: 'Reemplaza las variables con los datos de un registro de la lista: «Con los datos del registro #101373». Para seguir editando, vuelve a **Ver las variables**.' },
                    { name: 'Sol y luna', what: 'Cambia la app entre claro y oscuro (tu pantalla), sin tocar el correo.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Si la lista todavía no tiene registros, la vista con datos muestra las variables vacías. Crea un registro de prueba para revisar el resultado.',
            },
            { t: 'h', text: 'En el celular' },
            {
                t: 'p',
                md: 'La mayoría de los correos se abren en el teléfono. Al pasar a **Celular**, las columnas se apilan una debajo de la otra, las imágenes se achican al ancho de la pantalla y los títulos grandes bajan un poco de tamaño. Si unas columnas tienen contenido corto (íconos, cifras), puedes desmarcar **En el celular, una debajo de la otra** para que queden lado a lado.',
            },
            { t: 'h', text: 'Modo oscuro' },
            {
                t: 'p',
                md: 'Mucha gente lee el correo con el teléfono en modo oscuro. Cada programa lo resuelve a su manera: **Gmail** aplica siempre su propio oscurecido, y **Apple Mail** y **Outlook** (Mac, iOS y web) respetan los colores que elijas. Lo controlas en **Estilo general → Modo oscuro**.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Usar mis colores cuando el correo se lee en modo oscuro', what: 'Activa colores propios para ese modo: **Fondo del correo**, **Fondo de afuera**, **Texto** y **Texto secundario**.', tip: 'Las bandas de color de los bloques conservan sus colores.' },
                    { name: 'Ver el correo como se lee en modo oscuro', what: 'Muestra la vista previa con tus colores oscuros.' },
                    { name: 'Ver cómo lo oscurecen Gmail y Outlook', what: 'Sin colores propios, simula cómo lo invierten esos programas por su cuenta. **Volver a la vista normal** sale de la simulación.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Un logo con fondo transparente y letras oscuras puede perderse en modo oscuro. Usa una versión del logo sobre un recuadro blanco o una banda del color de tu marca.',
            },
            { t: 'h', text: 'Funciona en Gmail y Outlook' },
            {
                t: 'p',
                md: 'El correo se arma con tablas y estilos en línea, el formato que entienden Gmail (web y celular), Outlook (Windows, Mac y web), Apple Mail y Yahoo. Además sale con una versión de **sólo texto** para los programas que no muestran diseño. No tienes que hacer nada: el diseño visual se encarga.',
            },
            {
                t: 'p',
                md: 'Aun así, la mejor prueba es la real: toca **Enviarme una prueba** en la acción y abre el correo en Gmail y en Outlook, en el computador y en el teléfono.',
            },
            {
                t: 'example',
                title: 'Una academia de idiomas en Ciudad de México',
                md: 'Antes de activar el correo de «Tu clase de prueba está confirmada», la coordinadora lo revisó con **Ver con datos de un registro** y vio que la hora salía vacía para quien no había elegido horario. Agregó en la automatización la condición «Horario no está vacío» y lo probó en su celular con modo oscuro antes de guardarlo.',
            },
            {
                t: 'faq',
                items: [
                    { q: 'En la vista con datos no puedo mover bloques', a: 'Es a propósito: con datos reales sólo se mira. Vuelve a **Ver las variables** para editar.' },
                    { q: '¿Qué registro usa la vista previa?', a: 'Uno de la lista, el mismo que usa **Enviarme una prueba**: el último que se creó.' },
                    { q: 'En Outlook las esquinas salen rectas', a: 'Outlook de Windows no dibuja esquinas redondeadas ni sombras. El resto del diseño se mantiene.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Mandar una prueba', article: 'correos-enviar' },
                    { label: 'Colores y fuentes', article: 'correos-estilo' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'correos-firma',
        route: '/settings?s=firma',
        related: ['correos-enviar', 'correos-editor', 'cuenta-y-seguridad-firma'],
        blocks: [
            {
                t: 'p',
                md: 'Tu **firma de email** es la que aparece al final de los correos de las automatizaciones que la tengan activada. Cada persona del equipo tiene la suya y la escribe una sola vez: si mañana cambias de cargo o de teléfono, la editas y todos los correos siguientes salen con la nueva.',
            },
            { t: 'anim', key: 'correo-firma', caption: 'La firma se escribe en Ajustes con formato, enlace y logo, se guarda, y aparece al final de los correos.' },
            { t: 'h', text: 'Escribir tu firma' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes** y, en la sección de tu cuenta, toca **Firma de email**.',
                    'Escríbela en el cuadro, como en Gmail. Con la barra de arriba aplicas **negrita**, cursiva, subrayado, un enlace, un color o agregas una **Imagen** (tu logo).',
                    'Revisa la **Vista previa** que aparece debajo.',
                    'Toca **Guardar firma**. **Descartar** vuelve a la última guardada.',
                ],
            },
            { t: 'demo', key: 'correo-demo-firma', caption: 'Escribir la firma en Ajustes → Firma de email.', fallback: 'correo-firma' },
            {
                t: 'settings',
                rows: [
                    { name: 'Visual', what: 'Escribes y das formato con los botones. Es la forma recomendada.' },
                    { name: 'HTML', what: 'Para pegar una firma que ya tienes armada en HTML (por ejemplo, la que te dio tu diseñador). Si tu firma tiene tablas, abre directo en este modo para no simplificarla.' },
                ],
            },
            { t: 'h', text: 'Usarla en un correo' },
            {
                t: 'p',
                md: 'En la acción **Enviar email**, marca **Agregar la firma al final del correo** y elige en **Firma de** a la persona del equipo. Puede ser alguien fijo o el responsable del registro. La firma se lee **en el momento del envío**: si esa persona la cambia, los próximos correos ya salen con la nueva.',
            },
            {
                t: 'p',
                md: 'En el diseño visual la firma va al final, salvo que pongas el bloque **Firma** en otro lugar (por ejemplo, antes de unas columnas de redes sociales). En un correo de **Texto** sale sin formato, sin imágenes ni colores.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Si la persona elegida todavía no cargó su firma, el editor lo avisa y el correo sale sin firma. Si ya no es del equipo, el correo sale igual y el historial lo dice.',
            },
            { t: 'h', text: 'Una buena firma' },
            {
                t: 'cards',
                items: [
                    { icon: 'UserCheck', title: 'Corta', md: 'Nombre, cargo, empresa y un teléfono. Tres o cuatro líneas.', tone: 'mint' },
                    { icon: 'Image', title: 'Logo liviano', md: 'Una imagen chica (menos de 100 KB). Algunos programas bloquean las imágenes al principio.', tone: 'amber' },
                    { icon: 'Link2', title: 'Enlaces que sirvan', md: 'Tu sitio, WhatsApp o el agendamiento de citas. Evita llenarla de redes.', tone: 'blue' },
                ],
            },
            {
                t: 'example',
                title: 'Una agencia de seguros en Santiago',
                md: 'Cada asesor escribió su firma con su nombre, su número de WhatsApp y el logo de la agencia. En la automatización de «Tu póliza vence en 30 días», **Firma de** es el campo Persona **Asesor**: cada cliente recibe el correo firmado por su propio asesor.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿La firma se usa en los correos que mando desde mi Gmail?', a: 'No. Es la firma de los correos que salen desde la app (las automatizaciones). La de tu Gmail se configura en Gmail.' },
                    { q: '¿Puedo ver cómo queda en un correo?', a: 'Sí: en el editor del correo, con **Ver con datos de un registro**, o mandándote una prueba.' },
                    { q: '¿Un administrador puede editar mi firma?', a: 'No: cada persona edita la suya desde su cuenta.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Editar mi firma', to: '/settings?s=firma' },
                    { label: 'Agregar la firma a un correo', article: 'correos-enviar' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'correos-como-salen',
        route: '/settings?s=correo',
        related: ['ajustes-empresa-correo', 'ajustes-empresa-plan', 'integraciones-google-microsoft'],
        blocks: [
            {
                t: 'p',
                md: 'Todos los correos que manda tu empresa desde la app —automatizaciones, enlaces del portal del cliente, avisos de formularios y de la agenda, envíos programados de tableros— salen por **una forma de envío** que elige un administrador en **Ajustes → Correo**. De esa elección dependen dos cosas: **desde qué dirección** le llega al cliente y **cuántos correos** puedes mandar al mes.',
            },
            { t: 'anim', key: 'correo-envio', caption: 'Tres formas de envío: el correo de la plataforma cuenta para la cuota del plan; con la cuenta de Google o Microsoft de la empresa, o su servidor, no hay cuota de la plataforma.' },
            { t: 'h', text: 'Las tres formas de envío' },
            {
                t: 'cards',
                items: [
                    { icon: 'Mail', title: 'Correo de la plataforma', md: 'Funciona sin configurar nada. Sale desde la dirección de la plataforma con el **nombre de tu empresa**, y las respuestas te llegan a ti. Cuenta para la **cuota mensual** de tu plan.', tone: 'slate' },
                    { icon: 'ShieldCheck', title: 'Tu cuenta de Google o Microsoft', md: 'Recomendada. Conectas un Gmail, Google Workspace, Outlook o Microsoft 365 de la empresa y los correos salen **desde esa dirección**, sin contraseñas raras. No cuenta para la cuota.', tone: 'blue' },
                    { icon: 'Server', title: 'Tu servidor SMTP', md: 'El servidor de correo de tu hosting o proveedor (Zoho, Brevo, tu dominio). Tú eliges la dirección remitente. No cuenta para la cuota.', tone: 'violet' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cambiar la forma de envío lo hace un **administrador** de la empresa. El detalle de cómo conectar cada una está en *Ajustes de la empresa → Correo de la empresa*.',
            },
            { t: 'h', text: 'Desde qué dirección sale' },
            {
                t: 'settings',
                rows: [
                    { name: 'Con el correo de la plataforma', what: 'La dirección es la de la plataforma, el **nombre** que se lee es el de tu empresa (o el de **Nombre remitente**) y el «responder a» es tu dirección: si el cliente responde, te llega a ti.' },
                    { name: 'Con tu cuenta de Google o Microsoft', what: 'Siempre sale desde esa cuenta (por ejemplo ventas@tuempresa.com) y queda guardado en sus **Enviados**.', tip: 'Conviene una casilla compartida del equipo, no la personal de alguien.' },
                    { name: 'Con tu servidor', what: 'Sale desde la dirección que configuraste en el servidor.' },
                ],
            },
            { t: 'h', text: 'La cuota de correos del mes' },
            {
                t: 'p',
                md: 'En **Ajustes → Plan y uso** (lo ven los administradores) está la barra **Correos este mes**, con lo usado y el límite de tu plan. Sólo cuentan los correos que salen por el correo de la plataforma, y cuenta **cada destinatario**: un correo con dos personas en Para y una en Cc suma tres. Incluye automatizaciones y accesos al portal.',
            },
            {
                t: 'p',
                md: 'Si llegas al límite, los correos siguientes no salen hasta el mes próximo: el paso de la automatización falla con el motivo y aparece en **Problemas**. Las opciones son subir de plan o conectar tu cuenta de Google o Microsoft, o tu servidor, que no tienen cuota de la plataforma.',
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Con tu propia cuenta rigen **los límites de tu proveedor**: una cuenta de Gmail personal, unos 500 correos al día; Google Workspace, 2.000; Microsoft 365, 10.000 destinatarios al día y 30 por minuto. Pasarse puede bloquear el envío hasta 24 horas. Ninguna sirve para campañas masivas de marketing.',
            },
            {
                t: 'p',
                md: 'Los correos de **tu cuenta** —verificar tu correo, recuperar la contraseña, las invitaciones al equipo— salen siempre por el correo de la plataforma y **nunca** cuentan para la cuota.',
            },
            { t: 'anim', key: 'empresa-mail', caption: 'En Ajustes → Correo se elige cómo salen los correos de la empresa.' },
            { t: 'h', text: 'Si un correo no llega' },
            {
                t: 'steps',
                items: [
                    'Revisa la carpeta de **spam** o correo no deseado del destinatario.',
                    'Abre el **Historial** de la automatización: cada corrida dice si el correo salió o por qué falló (sin destinatario, cuota agotada, servidor que rechazó el envío).',
                    'Mira **Problemas** en Ajustes: un fallo repetido se reporta ahí y te llega un aviso.',
                    'Si usas tu cuenta o tu servidor, en **Ajustes → Correo** toca **Probar envío** para confirmar que la conexión sigue funcionando.',
                    'Para que no caigan en spam, usa tu propia cuenta o servidor y configura en tu dominio los registros que el panel te indica.',
                ],
            },
            {
                t: 'example',
                title: 'Una distribuidora en Guayaquil',
                md: 'Empezaron con el correo de la plataforma y, con 600 clientes que reciben su factura y dos recordatorios al mes, la cuota del plan se quedaba corta. Conectaron la cuenta facturacion@ de su Google Workspace: ahora las facturas salen desde su propia dirección, sin cuota de la plataforma, y quedan en los Enviados de esa casilla.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cada destinatario cuenta aunque sea el mismo correo?', a: 'Sí: la cuota cuenta personas, no envíos. Un correo a 3 personas son 3.' },
                    { q: '¿Las copias ocultas (Cco) cuentan?', a: 'Sí, también son destinatarios.' },
                    { q: '¿Dónde veo cuánto llevo este mes?', a: 'Un administrador lo ve en **Ajustes → Plan y uso**, barra **Correos este mes**.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Elegir cómo salen los correos', to: '/settings?s=correo' },
                    { label: 'Ver mi cuota', to: '/settings?s=plan' },
                    { label: 'Conectar Google o Microsoft', article: 'integraciones-google-microsoft' },
                ],
            },
        ],
    },
];
