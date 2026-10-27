import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-que-es',
        route: '/lists',
        related: ['portal-dar-acceso', 'portal-disenar', 'portal-como-entra', 'compartir-opciones'],
        blocks: [
            {
                t: 'p',
                md: 'El **portal de clientes** es una página privada para cada uno de tus clientes. Entra con un enlace que le llega al correo, sin crear cuenta, y ve **sólo lo suyo**: sus datos, sus facturas, el estado de su pedido, sus tickets, sus documentos y sus pagos, con el logo y los colores de tu empresa. Tú decides qué ve y qué puede corregir.\n\nPiénsalo como la «sucursal virtual» de tu negocio: en vez de que el cliente te escriba «¿ya salió mi pedido?» o «mándame la factura otra vez», lo consulta él mismo a cualquier hora.',
            },
            { t: 'anim', key: 'portal-hero', caption: 'Tu cliente entra a su portal desde el celular y ve su saldo, sus facturas y el estado de su pedido.' },
            { t: 'h', text: 'Cómo sabe la app qué es de cada cliente' },
            {
                t: 'p',
                md: 'El portal se activa en **la lista donde están tus clientes** (por ejemplo **Clientes**). Cada cliente es un registro de esa lista y su acceso queda unido a **ese registro**. Lo demás que ve sale de las **relaciones**: si tu lista **Facturas** tiene un campo de relación **Cliente**, la app sabe qué facturas son de cada uno y le muestra sólo las suyas.',
            },
            { t: 'anim', key: 'portal-relations', caption: 'De todas las facturas, el portal de Ana muestra sólo las que están vinculadas a su registro.' },
            {
                t: 'callout',
                tone: 'info',
                title: 'Otra forma de vincular: un campo de persona',
                md: 'Si en otra lista hay un campo de tipo **persona** donde eliges al usuario del cliente, esa lista también puede aparecer en su portal, filtrada por ese campo. Lo más común, igual, es la relación con su registro de cliente.',
            },
            { t: 'h', text: 'Activarlo en una lista' },
            {
                t: 'steps',
                items: [
                    'Abre la lista de tus clientes y toca **Configurar lista**.',
                    'Entra a la pestaña **Compartir**. Arriba está la tarjeta **Portal del cliente**.',
                    'Enciende **Activar el portal en esta lista**. Aparece la sección **Diseño del portal** con **Elegir plantilla** y **Editar** (o **Diseñar**).',
                    'En **Qué más ve el cliente**, marca las listas vinculadas que quieres mostrarle (sus facturas, sus pedidos…). Por defecto no ve ninguna.',
                    'Si quieres que el cliente pueda abrir solicitudes, configura **Qué puede crear el cliente**.',
                    'Listo: ya puedes darle acceso a cada cliente desde su ficha.',
                ],
            },
            { t: 'demo', key: 'portal-activar', caption: 'Activar el portal en la lista de clientes y elegir qué más ve cada uno.', fallback: 'portal-relations' },
            {
                t: 'settings',
                title: 'La tarjeta «Portal del cliente»',
                rows: [
                    { name: 'Activar el portal en esta lista', what: 'Enciende el portal para los registros de esta lista. Sin esto no se pueden dar accesos.', tip: 'Apagarlo corta al instante a los clientes que estaban con la sesión abierta.' },
                    { name: 'Diseño del portal', what: 'Dice qué diseño está usando: el automático, una plantilla o uno propio, con **Elegir plantilla** y **Editar**.', tip: 'Sin diseño propio, el cliente ve «Mi cuenta» de sólo lectura con las listas que habilites.' },
                    { name: 'Qué más ve el cliente', what: 'Las listas vinculadas a ésta, cada una con el campo por el que se une («Se vincula por el campo «Cliente»»). Marca las que el cliente puede ver.', tip: 'Una lista interna que apunta al cliente (comisiones, costos) no se muestra si no la marcas.' },
                    { name: 'Qué puede crear el cliente', what: 'Una lista donde el cliente abre registros desde su portal (un ticket, un pedido), con el **Texto del botón** («Abrir un ticket») y los **Datos que completa el cliente**.', tip: 'El registro queda vinculado a él solo y el equipo recibe el aviso.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Ninguna otra lista vinculada',
                md: 'Si la tarjeta dice que **ninguna otra lista está vinculada a ésta**, agrega en la otra lista un campo de tipo **relación** que apunte a tus clientes (por ejemplo, en **Facturas**, el campo **Cliente**) y vuelve aquí.',
            },
            { t: 'h', text: 'Ideas por tipo de negocio' },
            {
                t: 'cards',
                items: [
                    { icon: 'Receipt', title: 'Estado de cuenta', md: 'Una distribuidora muestra a cada tienda sus facturas, el saldo y el botón para pagar.', tone: 'mint' },
                    { icon: 'Workflow', title: 'Seguimiento de proyecto', md: 'Una agencia de diseño muestra las etapas del proyecto, las entregas y los archivos para aprobar.', tone: 'violet' },
                    { icon: 'Headphones', title: 'Soporte', md: 'Una empresa de software deja que el cliente abra tickets y vea cómo van.', tone: 'rose' },
                    { icon: 'Package', title: 'Pedidos', md: 'Una mueblería muestra el estado del pedido, la fecha de entrega y el comprobante.', tone: 'amber' },
                    { icon: 'GraduationCap', title: 'Colegios y academias', md: 'Los padres ven las notas, los pagos de pensión y las circulares de su hijo.', tone: 'blue' },
                    { icon: 'Building2', title: 'Inmobiliarias', md: 'El arrendatario ve su contrato, sus pagos de canon y abre solicitudes de mantenimiento.', tone: 'cyan' },
                ],
            },
            {
                t: 'example',
                title: 'Un contador independiente',
                md: 'Carolina lleva la contabilidad de 40 pequeñas empresas en Cartagena. Activó el portal en **Clientes** y marcó **Obligaciones** (con fechas de vencimiento de impuestos) y **Documentos** (vinculadas por el campo **Cliente**). Cada empresa entra a su portal, ve qué declaración vence este mes, descarga sus estados financieros y le deja comentarios. Los «¿me reenvías el certificado?» por WhatsApp casi desaparecieron.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El cliente puede ver los datos de otros clientes?', a: 'No. Todo lo que ve se calcula en el servidor a partir de SU registro y sus vínculos. Si una lista no tiene forma de saber qué es suyo, no se le muestra nada de ella.' },
                    { q: '¿Los clientes ocupan usuarios de mi plan?', a: 'No. Los clientes del portal no cuentan como usuarios del equipo.' },
                    { q: '¿Puedo tener el portal en varias listas?', a: 'Sí, cada lista activa el suyo. Lo normal es activarlo sólo en la lista de clientes y mostrar lo demás a través de las relaciones.' },
                    { q: '¿El cliente puede borrar o cambiar cosas?', a: 'Sólo corrige los campos que tú marques como editables en el diseño, comenta y abre registros en las listas que permitas. Nunca borra nada.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido del portal', tour: 'portal' },
                    { label: 'Siguiente: dar acceso a un cliente', article: 'portal-dar-acceso' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-dar-acceso',
        route: '/lists',
        related: ['portal-que-es', 'portal-como-entra', 'compartir-personas'],
        blocks: [
            {
                t: 'p',
                md: 'Con el portal activo, cada cliente necesita su acceso. Se da desde **la ficha de su registro**, con su correo: la app le manda un **enlace de un solo uso** que lo deja entrar sin crear cuenta ni recordar contraseñas. Desde la misma ficha ves si ya entró, le reenvías el enlace o le quitas el acceso.',
            },
            { t: 'anim', key: 'portal-magic-link', caption: 'Escribes el correo del cliente, le llega el enlace y con un toque entra a su portal.' },
            { t: 'h', text: 'Dar acceso' },
            {
                t: 'steps',
                items: [
                    'Abre la lista de clientes y abre el registro del cliente (su ficha).',
                    'Busca la tarjeta **Acceso al portal del cliente**, debajo de los campos (en una ficha diseñada, en el bloque **Acceso al portal**).',
                    'Escribe el **email del cliente** y toca **Dar acceso**.',
                    'La app le envía el correo con el enlace y te confirma **Enlace de acceso enviado por correo a…**. El cliente queda en la lista de la tarjeta con **Todavía no entró**.',
                ],
            },
            { t: 'demo', key: 'portal-acceso', caption: 'Dar acceso al portal desde la ficha de un cliente.', fallback: 'portal-magic-link' },
            {
                t: 'callout',
                tone: 'info',
                title: 'Cuánto dura el enlace',
                md: 'El enlace es de un solo uso y vence en **24 horas**. Una vez que el cliente entra, su sesión dura **30 días** y se renueva cada vez que vuelve. Si se le vence, puede pedirse un enlace nuevo solo desde la pantalla del portal, escribiendo su correo.',
            },
            { t: 'h', text: 'Todo lo que hay en la tarjeta' },
            {
                t: 'settings',
                title: 'Tarjeta «Acceso al portal del cliente»',
                rows: [
                    { name: 'Activo · Última entrada', what: 'Cada persona con acceso, con la fecha de su última entrada o **Todavía no entró**.', tip: 'Si el cliente dice «no me llegó nada» y sigue en «Todavía no entró», reenvíale el enlace y pídele revisar el spam.' },
                    { name: 'Reenviar enlace', what: 'Le manda un enlace nuevo al mismo correo, sin escribir nada.' },
                    { name: 'Copiar el último enlace', what: 'Copia el último enlace emitido para pegarlo, por ejemplo, en un WhatsApp.', tip: 'Recuerda que es de un solo uso y vence en 24 horas.' },
                    { name: 'Copiar enlace de entrada al portal', what: 'Copia la dirección general del portal de tu empresa (no es personal): desde ahí el cliente pide su enlace o entra con contraseña.' },
                    { name: 'Dar acceso a otra persona', what: 'Suma a otra persona con acceso al mismo registro (el socio, la persona de compras, el contador del cliente).' },
                    { name: 'Quitar acceso', what: 'La persona deja de ver este registro. Si no tiene otros accesos en tu empresa, se cierran sus sesiones al instante.', tip: 'Puedes volver a darle acceso cuando quieras.' },
                ],
            },
            { t: 'h', text: 'Casos especiales' },
            {
                t: 'cards',
                items: [
                    { icon: 'Users', title: 'Una persona, varios registros', md: 'Si el correo ya tiene acceso a otro registro, la app te avisa **Ya tiene acceso al portal** y te ofrece **Dar acceso también a este**. Suma, no reemplaza: desde su portal elige cuál mirar.', tone: 'blue' },
                    { icon: 'UserCheck', title: 'Alguien de tu equipo', md: 'El portal es para clientes. Si el correo es de alguien de tu empresa, la app no lo deja: para que vea la lista, compártesela desde **Compartir → Con tu equipo**.', tone: 'amber' },
                    { icon: 'Building2', title: 'Cliente de otras empresas', md: 'Si esa persona ya tenía cuenta por su lado, el enlace sólo viaja por correo (la app no te lo muestra) y su acceso queda limitado al portal de tu empresa.', tone: 'violet' },
                    { icon: 'Mail', title: 'El correo no salió', md: 'Si ves **El enlace se generó, pero el correo no salió**, revisa el correo de la empresa en **Ajustes → Correo** y vuelve a enviarlo.', tone: 'rose' },
                ],
            },
            {
                t: 'example',
                title: 'Una constructora con compradores de apartamentos',
                md: 'Constructora Altos del Río, en Manizales, tiene la lista **Compradores** con un registro por apartamento vendido. Al firmar la promesa, la asesora abre la ficha y toca **Dar acceso** con el correo del comprador; como muchos compran en pareja, usa **Dar acceso a otra persona** para el segundo titular. Los dos ven el avance de obra, sus cuotas y los documentos del inmueble.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Dar acceso a muchos clientes',
                md: 'El acceso se da registro por registro, a propósito: así cada invitación es una decisión. Si tienes muchos clientes, pídele a tu equipo que lo haga al cerrar cada venta, o comparte el **enlace de entrada al portal** en tu sitio para quienes ya tienen acceso.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿No veo la tarjeta de acceso en la ficha?', a: 'Aparece sólo si la lista tiene el portal activado y tú puedes administrar la lista. Revisa **Configurar lista → Compartir → Portal del cliente**.' },
                    { q: '¿Puedo dar acceso desde una automatización?', a: 'No: el acceso se da desde la ficha. Una automatización sí puede avisarte cuando un cliente nuevo necesita su acceso.' },
                    { q: '¿Qué ve el cliente si le quito el acceso?', a: 'Deja de ver ese registro. Si era su único acceso en tu empresa, su sesión se cierra al instante y el enlace de entrada ya no le funciona.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Siguiente: cómo entra tu cliente', article: 'portal-como-entra' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-como-entra',
        route: '/settings?s=portal',
        related: ['portal-dar-acceso', 'portal-marca-datos', 'portal-que-es'],
        blocks: [
            {
                t: 'p',
                md: 'Conviene saber qué vive tu cliente para poder ayudarlo por teléfono. Lo normal es simple: abre el correo, toca el enlace y está adentro. Pero también puede entrar con **contraseña** (si la permites), pedir un **enlace nuevo** cuando el suyo vence, y cambiar entre **varias cuentas** si es cliente con varios registros o de varias empresas.',
            },
            { t: 'anim', key: 'portal-login', caption: 'La pantalla de entrar: con un enlace por correo o con contraseña, y el menú para cambiar de cuenta.' },
            { t: 'h', text: 'Entrar con el enlace del correo' },
            {
                t: 'steps',
                items: [
                    'Le llega un correo con tu marca: «Tu acceso al portal de…» y un botón para entrar.',
                    'Al tocarlo, la app valida el enlace y abre su portal. No tiene que registrarse ni inventar una contraseña.',
                    'Su sesión dura 30 días y se renueva cada vez que vuelve: si entra seguido, nunca tiene que hacer nada más.',
                    'Si el enlace venció (24 horas) o cerró sesión, ve **Entrar a tu portal**: escribe su correo, toca **Enviarme un enlace** y le llega uno nuevo.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Por seguridad, la pantalla responde lo mismo exista o no el correo: nadie puede usarla para averiguar quién es cliente tuyo. Sólo le llega el enlace a quien ya tiene acceso.',
            },
            { t: 'h', text: 'Entrar con contraseña (opcional)' },
            {
                t: 'p',
                md: 'Algunos clientes prefieren una contraseña. Un administrador lo habilita en **Ajustes → Portal y formularios**, tarjeta **Cómo entran tus clientes al portal**:',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Permitir contraseña en el portal', what: 'Cada cliente puede crear una contraseña desde su portal (menú de su cuenta → **Crear contraseña**) y después entrar con su correo y esa contraseña.', tip: 'Es una contraseña SÓLO para el portal de tu empresa: no sirve para ninguna otra cuenta ni para otras empresas.' },
                    { name: 'Enlace de entrada al portal', what: 'La dirección de la pantalla de entrar de tu empresa, con tu marca, para compartir en un correo o en tu sitio («Portal de clientes»).', tip: 'Ponlo en el menú de tu página web.' },
                ],
            },
            {
                t: 'p',
                md: 'Con la contraseña habilitada, la pantalla de entrar ofrece **Con un enlace por correo** y **Con contraseña**. Si el cliente la olvida, entra con un enlace y crea una nueva desde **Cambiar contraseña**. Al quitarle el acceso, su contraseña se borra.',
            },
            { t: 'h', text: 'Varias cuentas y varias empresas' },
            {
                t: 'settings',
                title: 'El menú de la cuenta del cliente (arriba a la derecha)',
                rows: [
                    { name: 'Sus cuentas', what: 'Si tiene acceso a varios registros (dos locales, dos proyectos), aparecen todos, agrupados por empresa, y elige cuál mirar.' },
                    { name: '¿Eres cliente de otra empresa?', what: 'Le manda a su correo un enlace con todas sus cuentas, también las de otras empresas que usan la app.' },
                    { name: 'Crear contraseña / Cambiar contraseña', what: 'Sólo si tu empresa permite contraseña en el portal.' },
                    { name: 'Mis datos personales', what: 'La autorización de tratamiento de datos que aceptó, con la opción de retirarla (si tu empresa la pide en el portal).' },
                    { name: 'Salir', what: 'Cierra su sesión en ese dispositivo.' },
                ],
            },
            {
                t: 'example',
                title: 'Una franquicia de lavanderías',
                md: 'Don Ramiro tiene dos lavanderías y es cliente de un proveedor de insumos que usa el portal. Cada local es un registro en **Clientes**, y los dos tienen acceso con su mismo correo. En su portal, el menú de la cuenta le muestra «Lavandería Centro» y «Lavandería Norte»: toca una y ve los pedidos y las facturas de ese local.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué hago si un cliente dice que el enlace no funciona?', a: 'Casi siempre es que ya lo usó o que pasaron más de 24 horas. Que entre a la pantalla del portal y pida uno nuevo con su correo, o tócale **Reenviar enlace** en su ficha.' },
                    { q: '¿El cliente ve la app de mi equipo?', a: 'No. El portal es una página aparte: el cliente nunca ve tus listas, tu menú ni a tu equipo. Su sesión del portal tampoco sirve para entrar a la app.' },
                    { q: '¿Puede entrar desde el celular?', a: 'Sí: el portal se adapta al teléfono. El enlace del correo se abre directo en el navegador del celular.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Permitir contraseña en el portal', to: '/settings?s=portal' },
                    { label: 'Siguiente: diseñar el portal', article: 'portal-disenar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-disenar',
        route: '/lists',
        related: ['portal-que-es', 'portal-pagos', 'portal-conversar'],
        blocks: [
            {
                t: 'p',
                md: 'Lo que ve el cliente se diseña con el **mismo editor de la ficha del registro**: pestañas, secciones con columnas y bloques (sus datos, gráficos y tablas de lo suyo, botones, textos, sus pagos). Para no empezar de cero hay **cinco plantillas** pensadas para el cliente, que se arman solas con tus campos y tus listas vinculadas.',
            },
            { t: 'anim', key: 'portal-templates', caption: 'Las cinco plantillas del portal, cada una pensada para un tipo de negocio.' },
            { t: 'h', text: 'Las cinco plantillas' },
            {
                t: 'cards',
                items: [
                    { icon: 'UserCheck', title: 'Mi cuenta', md: 'Sus cifras y cuántos registros tiene en cada lista en una banda, lo que tiene con ustedes como tarjetas, sus datos de contacto (que puede corregir) y un canal para escribirles.', tone: 'blue' },
                    { icon: 'Receipt', title: 'Estado de cuenta', md: 'Saldo pendiente, pagado y total facturado, una cuenta regresiva a su próximo vencimiento, su cuenta por estado y por mes, y la tabla de facturas con el comprobante.', tone: 'mint' },
                    { icon: 'Workflow', title: 'Seguimiento de proyecto', md: 'Las etapas del proyecto en la cabecera (las ve, no las cambia), el avance en anillo, la entrega contando los días y el trabajo como tablero por estado.', tone: 'violet' },
                    { icon: 'Headphones', title: 'Mis solicitudes', md: 'Cuántas tiene abiertas y resueltas, sus solicitudes como tablero por estado y un canal para pedir ayuda.', tone: 'rose' },
                    { icon: 'Package', title: 'Mi pedido', md: 'El estado del pedido como etapas, el total, la entrega estimada con cuenta regresiva, lo que pidió con cantidades y los comprobantes.', tone: 'amber' },
                ],
            },
            { t: 'h', text: 'Elegir y aplicar una plantilla' },
            {
                t: 'steps',
                items: [
                    'En **Configurar lista → Compartir → Portal del cliente**, toca **Elegir plantilla** (o, dentro del editor, el botón **Plantillas**).',
                    'Elige una a la izquierda: a la derecha ves qué incluye y **Qué más ve el cliente**, con una casilla por cada lista vinculada y las columnas que va a ver.',
                    'Revisa las listas marcadas (la app marca sola la que mejor cumple el papel de la plantilla). Si a la lista le falta algo, la plantilla te lo dice y no se aplica.',
                    'Toca **Usar esta plantilla**. El diseño se arma en el editor; no se guarda hasta que toques **Guardar**, y se deshace con Ctrl+Z.',
                    'Revísalo con un cliente de verdad (arriba eliges con qué cliente ver la vista previa) y toca **Guardar**.',
                ],
            },
            { t: 'demo', key: 'portal-plantillas', caption: 'La galería de plantillas del portal.', fallback: 'portal-templates' },
            {
                t: 'callout',
                tone: 'info',
                title: 'Lo interno no se muestra',
                md: 'Las plantillas dejan afuera a propósito lo que suena interno: costos, márgenes, comisiones, notas internas, las personas de tu equipo y los campos calculados. El cliente ve sólo SUS registros de cada lista.',
            },
            { t: 'h', text: 'El editor del portal' },
            {
                t: 'settings',
                title: 'Lo que puedes ajustar',
                rows: [
                    { name: 'Vista previa con un cliente', what: 'Arriba eliges un cliente real y ves el portal con sus datos, como los vería él. En **Escritorio** o **Celular**.' },
                    { name: 'Bloques', what: 'A la izquierda, los bloques: sus datos (**Propiedades**, **Un campo destacado**), **Etapas**, gráficos y tablas de lo vinculado, **Archivos**, **Comentarios**, **Pagos**, títulos, textos, avisos, imágenes, botones, videos…' },
                    { name: 'El cliente puede editarlo', what: 'En los bloques de datos, el interruptor que deja al cliente corregir esos campos (su teléfono, su dirección). Se guarda solo.', tip: 'Sin bloques editables, el cliente no puede cambiar nada.' },
                    { name: 'Cabecera del portal', what: 'El título, la línea de contexto y las etapas de arriba; se puede ocultar.' },
                    { name: 'Tema del portal y Página', what: 'Colores, esquinas y aire; y para la página, **Fondo de la página**, **Ancho máximo** y **Tipografía**.' },
                    { name: 'Automático', what: 'Vuelve al diseño automático: «Mi cuenta» de sólo lectura con las listas habilitadas.' },
                    { name: 'Guardar', what: 'Publica el diseño: tus clientes ya ven su portal así.' },
                ],
            },
            {
                t: 'callout',
                tone: 'tip',
                md: 'Cada gráfico o tabla de otra lista sale **acotado al cliente**: suma sus facturas, no las de todos. Por eso un indicador «Saldo pendiente» muestra el número de ESE cliente.',
            },
            {
                t: 'example',
                title: 'Una agencia de marketing',
                md: 'Agencia Brío, en Guadalajara, tiene **Clientes**, **Proyectos** (vinculados por **Cliente**) y **Entregables**. Aplicó **Seguimiento de proyecto**, cambió el texto de bienvenida y agregó un bloque **Video o documento** con su presentación. Marcó **Correo** y **Teléfono** como editables. Ahora cada cliente ve en qué etapa va su campaña, cuántos días faltan para la entrega y los archivos para aprobar.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo tener un diseño distinto para cada cliente?', a: 'El diseño es uno por lista, pero cada cliente ve SUS datos dentro de él. Si necesitas portales muy distintos (distribuidores y clientes finales), usa listas separadas.' },
                    { q: '¿Qué pasa con el diseño que tenía antes?', a: 'Si venías de una versión anterior del editor, tu portal se convierte solo al abrirlo; nada se pierde.' },
                    { q: '¿Puedo armarlo con el asistente de IA?', a: 'Sí: pídele al asistente «arma el portal de clientes con su estado de cuenta» y te propone el diseño para aplicarlo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido del portal', tour: 'portal' },
                    { label: 'Siguiente: comentarios y documentos', article: 'portal-conversar' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-conversar',
        route: '/lists',
        related: ['portal-disenar', 'portal-pagos', 'formularios-que-son'],
        blocks: [
            {
                t: 'p',
                md: 'El portal no es sólo para mirar. Tu cliente puede **conversar** contigo en el registro, **descargar documentos** (cuentas de cobro, cotizaciones, certificados) y **abrir solicitudes** él mismo. Todo queda en la ficha del registro, a la vista de tu equipo.',
            },
            { t: 'anim', key: 'portal-comments', caption: 'Un comentario marcado «Visible para el cliente» aparece en su portal; la nota interna, no. El cliente responde y el equipo recibe el aviso.' },
            { t: 'h', text: 'Comentarios: internos o visibles para el cliente' },
            {
                t: 'p',
                md: 'En la ficha de un registro, todo comentario nace **interno**: sólo lo ve tu equipo. Para que lo vea el cliente, marca **Visible para el cliente** antes de enviarlo. Los comentarios que escribe el cliente aparecen con la marca **Del cliente** y le avisan a tu equipo.',
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Visible para el cliente', what: 'El comentario aparece en el portal del cliente (si su diseño tiene el bloque **Comentarios**).', tip: 'Úsalo para avisos: «Tu pedido sale mañana». Para coordinar con el equipo, deja el comentario interno.' },
                    { name: 'Respuestas', what: 'Una respuesta hereda la visibilidad del comentario al que responde: si el primero es visible, todo el hilo lo es.' },
                    { name: 'Reacciones', what: 'El cliente puede reaccionar y responder en los comentarios visibles.' },
                    { name: 'Del cliente', what: 'Marca lo que escribió el cliente desde su portal.' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Revisa la casilla antes de enviar: un comentario marcado como visible lo lee el cliente. Las notas internas nunca salen de la app.',
            },
            { t: 'h', text: 'Documentos para descargar' },
            {
                t: 'p',
                md: 'Si tu lista tiene **plantillas de documentos PDF** (cuenta de cobro, cotización, factura), puedes publicarlas en el portal: en el editor del documento, marca **Disponible en el portal del cliente**. El cliente las ve en **Tus documentos** y las descarga armadas con SUS datos. Si el documento tiene numeración, bajarlo desde el portal emite su número igual que si lo generaras desde la ficha.',
            },
            { t: 'h', text: 'Que el cliente abra solicitudes' },
            {
                t: 'steps',
                items: [
                    'En **Configurar lista → Compartir → Portal del cliente**, ve a **Qué puede crear el cliente**.',
                    'Elige la lista (por ejemplo **Tickets**, que tiene una relación hacia tus clientes).',
                    'Escribe el **Texto del botón**: «Abrir un ticket», «Pedir una visita».',
                    'Marca los **Datos que completa el cliente** (asunto, descripción, prioridad…). Sin al menos uno, el botón no aparece.',
                    'En su portal, el cliente ve el botón, llena los datos y toca **Enviar**: el registro nace vinculado a él y tu equipo recibe el aviso.',
                ],
            },
            { t: 'h', text: 'Archivos y actividad' },
            {
                t: 'p',
                md: 'El bloque **Archivos** del diseño muestra los archivos del registro para descargar. El bloque de actividad muestra los cambios recientes en lenguaje claro («Café Aurora cambió Estado de Pendiente a Pagado»), a nombre de tu empresa y sin nombrar a las personas de tu equipo.',
            },
            {
                t: 'example',
                title: 'Un taller de mecánica',
                md: 'Taller AutoPro, en Lima, tiene **Vehículos** con portal activo. Cuando el mecánico termina el diagnóstico, comenta con **Visible para el cliente**: «Hay que cambiar las pastillas de freno, ¿lo autorizas?», y adjunta las fotos. El dueño del carro responde desde su celular «Sí, dale». Al terminar, descarga en **Tus documentos** la cotización con el número y el total.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿El cliente ve quién de mi equipo le respondió?', a: 'En los comentarios ve el nombre de quien le escribió. La actividad, en cambio, aparece a nombre de tu empresa: muestra qué cambió, no quién de tu equipo lo hizo.' },
                    { q: '¿Me entero cuando el cliente comenta?', a: 'Sí: lo que escribe el cliente avisa a tu equipo en la campana, y queda en la ficha con la marca **Del cliente**.' },
                    { q: '¿Puedo cambiar la visibilidad después de enviar?', a: 'Sí, en el comentario. Si cambias la del primero de un hilo, cambia todo el hilo.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Siguiente: cobrar desde el portal', article: 'portal-pagos' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-pagos',
        route: '/settings?s=conectores',
        related: ['portal-disenar', 'portal-conversar', 'portal-que-es'],
        blocks: [
            {
                t: 'p',
                md: 'El bloque **Pagos** convierte el portal en una caja: muestra los **links de pago** del cliente con su estado (pendiente, pagado, vencido…) y puede ofrecer un botón **«Pagar mi saldo»** que cobra lo que debe. El dinero va directo a la cuenta de tu empresa en **Mercado Pago** o **Wompi**; la app no cobra comisión.',
            },
            { t: 'anim', key: 'portal-pay', caption: 'El cliente toca «Pagar mi saldo», paga en la pasarela y el portal le muestra «¡Listo! Recibimos tu pago».' },
            { t: 'h', text: 'Antes de empezar' },
            {
                t: 'callout',
                tone: 'warn',
                md: 'Necesitas una **conexión de cobro del equipo** (Mercado Pago o Wompi) en **Ajustes → Integraciones**. Sin ella, tus clientes no ven el bloque **Pagos**.',
            },
            { t: 'h', text: 'Agregar el bloque' },
            {
                t: 'steps',
                items: [
                    'Abre el editor del portal (**Configurar lista → Compartir → Portal del cliente → Editar**).',
                    'Agrega el bloque **Pagos** desde la biblioteca de la izquierda y elígelo.',
                    'En **Sus pagos**, deja **Mostrar sus links de pago** y, si quieres, marca **También los de** sus otras listas (por ejemplo **Facturas**).',
                    'En **Botón para pagar**, enciende **Ofrecer «Pagar»**, elige la **Conexión de cobro** y el **Monto**: un campo de su registro (por ejemplo **Saldo pendiente**).',
                    'Opcional: **Concepto** (vacío = el título del registro) y **Texto del botón** («Pagar mi saldo»).',
                    'Toca **Guardar**. La plantilla **Estado de cuenta** ya trae este bloque si tienes cobros conectados.',
                ],
            },
            {
                t: 'settings',
                title: 'Opciones del bloque Pagos',
                rows: [
                    { name: 'Mostrar sus links de pago', what: 'Los links de su registro, con el estado de cada uno y el comprobante de los pagados.' },
                    { name: 'También los de', what: 'Suma los links de sus registros en otras listas vinculadas (sólo los que son del cliente).' },
                    { name: 'Ofrecer «Pagar»', what: 'El botón que cobra el monto de un campo de su registro. El monto lo lee el servidor, nunca el navegador.', tip: 'Si ya hay un link pendiente por ese monto, se reusa: el cliente no recibe dos cobros.' },
                    { name: 'Monto', what: 'Un campo de número, moneda, calculado o resumen del registro.', tip: 'Un resumen «Saldo pendiente» que suma sus facturas pendientes es lo ideal.' },
                    { name: 'Concepto', what: 'El texto que aparece en el cobro. Vacío = el título del registro.' },
                    { name: 'Texto del botón', what: 'Lo que dice el botón: «Pagar mi saldo», «Pagar cuota».' },
                ],
            },
            { t: 'h', text: 'Qué ve y hace el cliente' },
            {
                t: 'p',
                md: 'Arriba ve una tarjeta con el concepto, el monto y el botón. Al tocarlo, la pasarela se abre en otra pestaña («Pagas en Mercado Pago, se abre en otra pestaña…»). Mientras paga, el portal dice **Esperando la confirmación del pago…** y, cuando el proveedor lo aprueba, **¡Listo! Recibimos tu pago**. Abajo, la lista de sus pagos: los pendientes con **Pagar** y los pagados con **Ver comprobante**.',
            },
            {
                t: 'settings',
                title: 'Estados de un link de pago',
                rows: [
                    { name: 'Pendiente', what: 'Creado y esperando el pago.' },
                    { name: 'Pagado', what: 'El proveedor confirmó el pago. Se ve el comprobante.' },
                    { name: 'Rechazado', what: 'El pago no se aprobó (fondos, tarjeta, banco).' },
                    { name: 'Vencido', what: 'Pasó la fecha límite del link sin pagarse.' },
                    { name: 'Reembolsado', what: 'El pago se devolvió desde la pasarela.' },
                    { name: 'Monto distinto', what: 'Se pagó un monto diferente al del link: revísalo.' },
                ],
            },
            {
                t: 'example',
                title: 'Un colegio con pensiones',
                md: 'Colegio Nuevo Horizonte cobra la pensión mensual. Cada familia es un registro con un resumen **Saldo pendiente** que suma sus cuotas sin pagar. El portal (plantilla **Estado de cuenta**) muestra el saldo, la cuenta regresiva al próximo vencimiento y el botón **Pagar mi saldo** con Wompi. Las familias pagan con PSE desde el celular y la tesorera ve las cuotas pasar a **Pagado** solas.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quién confirma que el pago llegó?', a: 'El proveedor. La app consulta el pago directamente con Mercado Pago o Wompi antes de marcarlo como pagado.' },
                    { q: '¿Puedo avisar al equipo cuando alguien paga?', a: 'Sí, con una automatización con el disparador **Cuando se recibe un pago**.' },
                    { q: '¿Qué pasa si el saldo es cero?', a: 'El botón aparece sólo cuando el registro tiene un monto mayor a cero.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Conectar Mercado Pago o Wompi', to: '/settings?s=conectores' },
                    { label: 'Siguiente: marca y datos personales', article: 'portal-marca-datos' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'portal-marca-datos',
        route: '/settings?s=marca',
        related: ['portal-como-entra', 'formularios-correo-seguridad', 'portal-que-es'],
        blocks: [
            {
                t: 'p',
                md: 'Tu cliente nunca ve el nombre de la plataforma: el portal, la pantalla de entrar y el correo con el enlace llevan **tu logo, tu color y el nombre de tu empresa**. Y si quieres llegar más lejos, el portal puede vivir en **tu propia dirección** (por ejemplo `clientes.tuempresa.com`) y pedirle a cada cliente la **autorización de datos personales**.',
            },
            { t: 'anim', key: 'portal-domain', caption: 'El portal en la dirección propia de la empresa, con su marca, pidiendo la autorización de datos la primera vez.' },
            { t: 'h', text: 'Tu marca' },
            {
                t: 'p',
                md: 'El logo, el color principal y el nombre de la app se configuran una sola vez en **Ajustes → Marca**, y se aplican solos al portal, a la pantalla de entrar, a la pestaña del navegador y al correo de acceso («Tu acceso al portal de Café Aurora»). Dentro del editor del portal puedes ajustar además el tema, el fondo y la tipografía de la página.',
            },
            { t: 'h', text: 'Una dirección propia para el portal' },
            {
                t: 'steps',
                items: [
                    'Ve a **Ajustes → Marca** y busca la tarjeta del dominio del portal de clientes.',
                    'Escribe la dirección (por ejemplo `clientes.tuempresa.com`) y toca **Guardar**.',
                    'Crea en tu proveedor de dominio los dos registros DNS que te indica la app: uno de verificación (TXT) y uno que apunta el dominio (CNAME).',
                    'Vuelve y toca **Verificar propiedad**. Después, **Comprobar apuntamiento**: cuando el dominio responde, la app te lo dice.',
                    'Desde ese momento, los enlaces de acceso salen por tu dominio y la raíz de esa dirección lleva directo al portal.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Los cambios de DNS pueden tardar unos minutos (a veces horas) en propagarse. Mientras el dominio no responda, la app sigue mandando los enlaces por la dirección de siempre: tus clientes nunca reciben un enlace que no funciona.',
            },
            { t: 'h', text: 'La autorización de datos personales' },
            {
                t: 'settings',
                rows: [
                    { name: 'Pedirla también en el portal del cliente', what: 'En **Ajustes → Datos personales**. El cliente la ve la primera vez que entra y cada vez que cambia la versión del texto; sin aceptarla no puede seguir usando el portal (sí cerrar sesión).', tip: 'Útil si recoges datos de personas naturales: queda la prueba de cada aceptación.' },
                    { name: 'Mis datos personales', what: 'En el menú de la cuenta, el cliente ve lo que autorizó y puede **Retirar la autorización**.', tip: 'Si la retira, tu equipo recibe el aviso. Los datos no se borran solos: decides tú.' },
                ],
            },
            {
                t: 'example',
                title: 'Una clínica estética',
                md: 'Clínica Bella Piel, en Santiago, puso su portal en `pacientes.bellapiel.cl` con su logo y su color rosa. Cada paciente entra a ver sus próximas sesiones, sus consentimientos firmados y sus pagos. Como maneja datos de salud, pide la autorización de datos en el portal: cada paciente la acepta la primera vez y la clínica conserva la prueba con la versión del texto.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Puedo usar el mismo dominio para mi equipo y para mis clientes?', a: 'No: el dominio del portal es distinto del dominio de tu equipo. Por ejemplo, `app.tuempresa.com` para tu equipo y `clientes.tuempresa.com` para el portal.' },
                    { q: '¿El correo de acceso sale con mi marca aunque no tenga dominio propio?', a: 'Sí. El asunto, el nombre, el logo y el color son los de tu empresa siempre.' },
                    { q: '¿Qué ve un cliente que retira la autorización?', a: 'Puede seguir viendo la pantalla para aceptarla de nuevo o cerrar sesión. Tu equipo recibe el aviso para decidir qué hacer con sus datos.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Configurar mi marca y dominio', to: '/settings?s=marca' },
                    { label: 'Autorización de datos', to: '/settings?s=privacidad' },
                    { label: 'Ver el recorrido de marca', tour: 'branding' },
                ],
            },
        ],
    },
];
