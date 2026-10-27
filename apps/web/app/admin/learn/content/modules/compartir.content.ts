import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'compartir-opciones',
        route: '/lists',
        related: ['compartir-lista-publica', 'compartir-tableros', 'compartir-personas', 'portal-que-es'],
        blocks: [
            {
                t: 'p',
                md: 'Tarde o temprano alguien de afuera tiene que ver algo de tu app: un cliente, un proveedor, tu contador, los socios, el público de tu página web. La app tiene una forma pensada para cada caso. La pregunta clave es doble: **¿quién mira?** (alguien conocido o cualquiera) y **¿qué tiene que poder hacer?** (sólo ver, responder, o trabajar contigo).',
            },
            { t: 'anim', key: 'comp-hero', caption: 'Una misma lista llega a cada persona por el camino que le corresponde.' },
            { t: 'h', text: 'La guía rápida' },
            {
                t: 'settings',
                title: 'Qué usar según el caso',
                rows: [
                    { name: 'Cualquiera tiene que VER una lista', what: '**Página pública**: una tabla de sólo lectura con los campos que elijas.', tip: 'El menú del día, los cupos disponibles, el inventario de usados, los resultados de un torneo.' },
                    { name: 'Cualquiera tiene que ENVIARTE datos', what: '**Formulario**: cada respuesta es un registro nuevo.', tip: 'Contacto, cotizaciones, inscripciones, encuestas.' },
                    { name: 'Cualquiera tiene que RESERVAR una hora', what: '**Agenda de citas**: elige servicio, día y hora libres.', tip: 'Consultorios, peluquerías, asesorías.' },
                    { name: 'Un cliente tiene que ver LO SUYO', what: '**Portal de clientes**: su página privada con sus facturas, pedidos y pagos.', tip: 'Estado de cuenta, seguimiento de proyecto, soporte.' },
                    { name: 'Alguien tiene que ver NÚMEROS', what: '**Tablero con enlace público** o **resumen por correo** programado.', tip: 'Socios, junta directiva, un inversionista, una franquicia.' },
                    { name: 'Alguien de afuera tiene que TRABAJAR contigo', what: '**Invitado**: un proveedor o tu contador entra a una lista o a un registro, con ver, comentar o editar.', tip: 'No ocupa un usuario de tu plan.' },
                    { name: 'Alguien de tu equipo tiene que llegar a algo', what: '**Enlace de la lista, de una vista o de un registro**, o darle acceso a esa lista.', tip: 'El enlace sólo abre si la persona tiene cuenta y permiso.' },
                    { name: 'Alguien necesita UN documento', what: '**Enlace del PDF** de un registro (vence en 30 días) o enviarlo por correo.', tip: 'Una cuenta de cobro o una cotización.' },
                ],
            },
            { t: 'h', text: 'Las opciones, una por una' },
            {
                t: 'cards',
                items: [
                    { icon: 'Globe', title: 'Página pública de una lista', md: 'Sólo lectura, sin iniciar sesión, con buscador y para insertar en tu sitio.', tone: 'blue' },
                    { icon: 'FormInput', title: 'Formulario', md: 'Una página que cualquiera llena; cada respuesta crea un registro.', tone: 'violet' },
                    { icon: 'CalendarCheck', title: 'Agenda de citas', md: 'Reservas en línea con confirmación y recordatorios.', tone: 'rose' },
                    { icon: 'AppWindow', title: 'Portal de clientes', md: 'Una página privada por cliente, con su marca y sus pagos.', tone: 'cyan' },
                    { icon: 'LayoutDashboard', title: 'Tablero público o por correo', md: 'Los indicadores de tu negocio para quien no usa la app.', tone: 'amber' },
                    { icon: 'UserPlus', title: 'Invitados', md: 'Un proveedor, un freelancer o el contador entran a lo que les compartas.', tone: 'mint' },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Antes de publicar, piensa en los datos',
                md: 'Lo que es «público» lo ve cualquiera con el enlace, incluso si lo reenvían. Para datos de clientes (montos, teléfonos, documentos) usa el **portal** o los **invitados**, que piden entrar. En una página pública muestra sólo lo que podrías pegar en una vitrina.',
            },
            {
                t: 'example',
                title: 'Una concesionaria de carros usados',
                md: 'Autos del Valle, en Cali, usa cuatro formas a la vez: una **página pública** de la lista **Inventario** con marca, modelo, año, kilometraje y precio (sin el costo ni el proveedor) insertada en su sitio; un **formulario** «Quiero este carro» que crea el prospecto; un **tablero** de ventas que llega por correo a los socios cada lunes; y el taller aliado entra como **invitado** a la lista **Revisiones técnicas** para cargar sus reportes.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Qué diferencia hay entre una página pública y el portal?', a: 'La página pública muestra lo mismo a todos y no pide entrar. El portal muestra a cada cliente sólo lo suyo y le pide entrar con un enlace a su correo.' },
                    { q: '¿Un invitado ocupa un usuario de mi plan?', a: 'No: los invitados tienen su propio tope por plan, aparte de los usuarios del equipo.' },
                    { q: '¿Puedo saber quién vio una página pública?', a: 'No: una página pública no pide identificarse. Si necesitas saber quién entra, usa el portal o invitados.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Publicar una lista', article: 'compartir-lista-publica' },
                    { label: 'Compartir un tablero', article: 'compartir-tableros' },
                    { label: 'Invitar a alguien de afuera', article: 'compartir-personas' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'compartir-lista-publica',
        route: '/lists',
        related: ['compartir-opciones', 'compartir-personas', 'formularios-publicar'],
        blocks: [
            {
                t: 'p',
                md: 'Una **página pública** muestra los registros de una lista en una tabla que cualquiera puede abrir con un enlace, sin cuenta. Es de **sólo lectura**: nadie puede editar nada desde ahí. Tú eliges **qué campos** se ven (lo que no marques nunca sale de la app), si sale **toda la lista o sólo una vista** filtrada, **hasta cuándo** funciona el enlace y **en qué sitios** se puede insertar.',
            },
            { t: 'anim', key: 'comp-public-list', caption: 'Marcas los campos visibles y la página pública muestra sólo esos; el costo nunca sale de la app.' },
            { t: 'h', text: 'Publicar en dos minutos' },
            {
                t: 'steps',
                items: [
                    'Abre la lista y toca **Compartir** (arriba, en la cabecera de la lista).',
                    'En **Con cualquiera**, enciende **Publicar en una página que cualquiera pueda abrir**.',
                    'En **Campos visibles**, marca los que quieres mostrar (con **Todos** y **Ninguno** de atajos).',
                    'En **Qué se publica**, deja **Toda la lista** o elige una **Vista** para que salgan sólo los registros que pasan sus filtros.',
                    'Opcional: una fecha en **El enlace vence el** y los **Sitios donde se puede insertar**.',
                    'Toca **Guardar**. Copia el **Enlace público** o el código de **Insertar en otra web**.',
                ],
            },
            { t: 'demo', key: 'comp-publicar-lista', caption: 'Publicar la lista de productos en una página pública desde Compartir.', fallback: 'comp-public-list' },
            { t: 'h', text: 'Todos los ajustes' },
            {
                t: 'settings',
                rows: [
                    { name: 'Campos visibles', what: 'Los únicos campos que viajan a la página. Lo que no marques nunca sale de la app, ni siquiera escondido.', tip: 'Revisa dos veces: costos, teléfonos y notas internas casi nunca van.' },
                    { name: 'Qué se publica', what: '**Toda la lista** (salen todos los registros) o **Vista: …** (salen sólo los que pasan los filtros de esa vista).', tip: 'Una vista «Disponibles» con el filtro Estado = Disponible publica sólo lo que se puede vender. Si cambias los filtros de la vista, la página cambia.' },
                    { name: 'El enlace vence el', what: 'Después de esa fecha el enlace deja de abrir. Sin fecha: no vence.', tip: 'Ideal para una promoción o una convocatoria con cierre.' },
                    { name: 'Sitios donde se puede insertar', what: 'Uno por línea. Vacío = cualquier web puede insertarla.' },
                    { name: 'Enlace público', what: 'La dirección de la página, para copiar y compartir.' },
                    { name: 'Insertar en otra web', what: 'El código para pegar la tabla dentro de tu página web.' },
                ],
            },
            {
                t: 'p',
                md: 'En **Configurar lista → Compartir**, la tarjeta **Página pública** tiene además tres ajustes de cómo se ve la tabla:',
            },
            {
                t: 'settings',
                title: 'Tarjeta «Página pública»',
                rows: [
                    { name: 'Qué campos se muestran', what: 'Los mismos campos visibles, en orden, y cuáles **se pueden ordenar** con un clic en la columna.' },
                    { name: 'Orden inicial', what: 'Cómo arranca ordenada la tabla. «— El de la lista —» respeta el orden de la lista.', tip: 'Un catálogo ordenado por precio, un ranking por puntaje.' },
                    { name: 'Filas por página', what: 'Cuántos registros muestra antes de pasar a la página siguiente.' },
                    { name: 'Buscador', what: '**Visible** u **Oculto**. Busca sólo dentro de los campos que publicaste.' },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'La página pública se adapta al celular, lleva tu logo y tu color, y la pestaña **Compartir** de **Configurar lista** muestra un punto verde cuando la lista tiene una página publicada. Si una vista publicada se borra o su filtro deja de servir, la página no muestra nada en vez de mostrar toda la lista.',
            },
            { t: 'h', text: 'Ideas para tu negocio' },
            {
                t: 'cards',
                items: [
                    { icon: 'Store', title: 'Catálogo o menú', md: 'Productos con foto, precio y disponibilidad, filtrados por la vista «Publicados».', tone: 'amber' },
                    { icon: 'CalendarDays', title: 'Programación', md: 'Los eventos o talleres del mes con fecha, lugar y cupos.', tone: 'violet' },
                    { icon: 'Building2', title: 'Inmuebles disponibles', md: 'Arriendos con barrio, habitaciones y canon, sin los datos del propietario.', tone: 'blue' },
                    { icon: 'TrendingUp', title: 'Resultados y rankings', md: 'Tabla de posiciones de un torneo o resultados de un concurso.', tone: 'mint' },
                ],
            },
            {
                t: 'example',
                title: 'Una panadería con pedidos para eventos',
                md: 'Panadería La Espiga, en Asunción, publicó su lista **Productos** con la vista «En vitrina» (filtro: Disponible = Sí), los campos Nombre, Foto, Precio y Categoría, el buscador visible y el orden por categoría. La insertó en su sitio con **Sitios donde se puede insertar** = `laespiga.com.py`. Cuando un producto se agota y lo marcan en la app, desaparece solo de la página.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quién puede publicar una lista?', a: 'Quien administra la lista. El resto del equipo ve la opción pero no puede activarla.' },
                    { q: '¿Cómo la despublico?', a: 'Apaga **Publicar en una página que cualquiera pueda abrir** y guarda: el enlace deja de funcionar al instante.' },
                    { q: '¿La página se actualiza sola?', a: 'Sí: muestra los datos de ese momento cada vez que alguien la abre.' },
                    { q: '¿Puedo tener dos páginas públicas de la misma lista con campos distintos?', a: 'Cada lista tiene una sola página pública. Si necesitas dos versiones, publica una vista distinta en cada lista o usa un tablero público para la otra.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Siguiente: compartir un tablero', article: 'compartir-tableros' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'compartir-tableros',
        route: '/dashboards',
        related: ['compartir-opciones', 'compartir-lista-publica', 'compartir-personas'],
        blocks: [
            {
                t: 'p',
                md: 'Un tablero resume tu negocio en gráficos e indicadores. Para mostrárselo a alguien que no usa la app —tus socios, un inversionista, el dueño de la franquicia— tienes dos caminos desde el botón **Compartir** del tablero: un **Enlace público** para verlo sin iniciar sesión, o un **Envío por correo** que le llega solo cada día, semana o mes.',
            },
            { t: 'anim', key: 'comp-dashboard', caption: 'Cada lunes a las 7:00 llega el resumen del tablero al correo de los socios, con sus indicadores y el PDF.' },
            { t: 'h', text: 'Enlace público' },
            {
                t: 'steps',
                items: [
                    'Abre el tablero y toca **Compartir**; queda abierta la pestaña **Enlace público**.',
                    'Toca **Publicar enlace**. Aparece el **Enlace público** con **Copiar** y **Abrir**.',
                    'Opcional: **Vence (opcional)**, **Quien mira puede cambiar el período** y **Sitios donde se puede insertar**, con su **Código para insertar**.',
                    'Toca **Guardar cambios**. Para cortarlo, **Dejar de publicar**; si el enlace se filtró, **Crear dirección nueva**.',
                ],
            },
            {
                t: 'settings',
                rows: [
                    { name: 'Los datos que se ven', what: 'Se calculan con lo que puede ver quien publicó: si deja de tener acceso, el enlace deja de funcionar.' },
                    { name: 'Tablas en el tablero', what: 'Si el tablero tiene widgets de tabla, cualquiera con el enlace verá esas filas, no sólo totales. La app te avisa.', tip: 'Para socios, mejor sólo gráficos e indicadores.' },
                    { name: 'Quien mira puede cambiar el período', what: 'Deja elegir «hoy, este mes, el año pasado…» y los datos se recalculan.' },
                    { name: 'Vence (opcional)', what: 'Funciona hasta el final de ese día. Vacío: no vence.' },
                ],
            },
            { t: 'h', text: 'Envío por correo' },
            {
                t: 'steps',
                items: [
                    'En **Compartir**, pasa a **Envío por correo** y toca **Programar un envío**.',
                    'Elige la **Frecuencia** (**Todos los días**, **Cada semana** con sus **Días de la semana**, o **Cada mes** con el **Día del mes** o **El último día**), la **Hora** y la **Zona horaria**.',
                    'Agrega **Personas del equipo** (tienen que poder ver el tablero) y **Correos externos (opcional)**.',
                    'Ajusta el **Asunto**, un **Mensaje (opcional)** y, si quieres, **Adjuntar el tablero en PDF**.',
                    'Guárdalo **Activo**. Con **Enviar ahora** lo pruebas al momento; con **Pausar** lo detienes sin borrarlo.',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                md: 'Cada destinatario recibe su propio correo (nadie ve a los demás) y cuenta para la cuota de correos del plan. El correo trae los indicadores y los valores principales de cada gráfico, con un botón para abrir el tablero.',
            },
            {
                t: 'example',
                title: 'Una cadena de tres cafeterías',
                md: 'Los socios de Café de Altura no usan la app. Cada lunes a las 7:00 les llega «Resumen de Ventas de la semana» con las ventas por sede, el ticket promedio y el producto más vendido, con el PDF adjunto. Y en el grupo de WhatsApp de los gerentes está el enlace público del tablero de metas, con **Quien mira puede cambiar el período** encendido.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Quién puede publicar un tablero?', a: 'Sólo quien creó el tablero o un administrador pueden publicarlo con un enlace.' },
                    { q: '¿Puedo insertar el tablero en mi sitio?', a: 'Sí, con el **Código para insertar**, y restringir los sitios permitidos.' },
                    { q: '¿Dónde aprendo a armar el tablero?', a: 'En el módulo de tableros del centro de aprendizaje: widgets, filtros y períodos.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis tableros', to: '/dashboards' },
                    { label: 'Ver el recorrido de tableros', tour: 'dashboards' },
                    { label: 'Siguiente: compartir con personas', article: 'compartir-personas' },
                ],
            },
        ],
    },
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'compartir-personas',
        route: '/lists',
        related: ['compartir-opciones', 'compartir-lista-publica', 'portal-dar-acceso'],
        blocks: [
            {
                t: 'p',
                md: 'No todo se comparte con «cualquiera». Muchas veces quieres darle acceso a **una persona en particular**: alguien de tu equipo que normalmente no ve esa lista, un **proveedor** que tiene que cargar sus despachos, el **contador** que revisa las facturas, un **freelancer** que trabaja en un solo proyecto. Para eso está la parte **Con tu equipo** del botón **Compartir** y el botón **Compartir** de cada registro.',
            },
            { t: 'anim', key: 'comp-guest', caption: 'Invitas al proveedor a una sola lista con «Puede comentar»: él entra y ve sólo eso.' },
            { t: 'h', text: 'Con tu equipo' },
            {
                t: 'settings',
                title: 'En Compartir → Con tu equipo',
                rows: [
                    { name: 'El enlace de la lista', what: 'Para pegar en un chat. Este enlace sólo lo abre quien tenga cuenta y permiso sobre la lista.' },
                    { name: 'Personas con acceso', what: 'Busca a alguien de tu empresa por nombre o correo y dale un nivel en esta lista. El acceso que le des aquí manda sobre el de su rol, sólo en esta lista.', tip: 'Sumar a la diseñadora a la lista de Proyectos sin cambiarle el rol en toda la empresa.' },
                    { name: 'Equipos con acceso', what: 'Lo mismo, pero para un equipo entero (Ventas, Soporte).' },
                    { name: 'Personas de afuera', what: 'Invitados: ven sólo esta lista (nada más de la empresa) y no ocupan un usuario de tu plan.' },
                ],
            },
            { t: 'h', text: 'Invitar a alguien de afuera' },
            {
                t: 'steps',
                items: [
                    'En **Compartir → Con tu equipo → Personas de afuera**, escribe el correo (por ejemplo `contador@deafuera.com`).',
                    'Elige el nivel: **Puede ver**, **Puede comentar** o **Puede editar** (crea y edita, pero no borra).',
                    'Toca **Invitar**. Si no tenía cuenta, le llega una invitación para crear su contraseña; queda como **Invitación pendiente** hasta que entra.',
                    'Para compartir **un solo registro**, abre su ficha y toca **Compartir**: en **Compartir este registro** invitas igual, y la persona ve SÓLO ese registro.',
                    'Cambia el nivel o quita el acceso desde la misma lista de personas.',
                ],
            },
            { t: 'demo', key: 'comp-invitado', caption: 'Invitar a una persona de afuera a la lista desde Compartir.', fallback: 'comp-guest' },
            {
                t: 'callout',
                tone: 'info',
                title: 'Qué ve un invitado',
                md: 'Entra a una pantalla **Compartido conmigo** con las listas y los registros que le compartieron, nada más: ni tus otras listas, ni tableros, ni automatizaciones, ni la información interna (tiempos, aprobaciones, checklists). Ve los campos como un lector y nunca las relaciones con otras listas.',
            },
            { t: 'h', text: 'Enlaces a una vista o a un registro' },
            {
                t: 'p',
                md: 'Para mandarle a un compañero «mira esto», copia el enlace exacto: en el menú de una pestaña de vista (clic derecho o «···»), **Copiar vínculo a la vista** abre la lista directamente en esa vista, con sus filtros; en el menú de una fila (clic derecho), **Copiar enlace** abre ese registro. Estos enlaces sólo funcionan para quien tiene cuenta y permiso: no hacen nada público.',
            },
            {
                t: 'example',
                title: 'Una distribuidora de alimentos',
                md: 'Distribuidora Sabores del Campo comparte la lista **Despachos** con su transportadora como invitada con **Puede editar**: el conductor marca cada entrega y sube la foto del recibido. Su revisor fiscal entra como invitado a **Facturas** con **Puede ver**. Ninguno ocupa un usuario del plan, y ninguno ve los costos ni los clientes de las otras listas.',
            },
            {
                t: 'faq',
                items: [
                    { q: '¿Cuál es la diferencia entre un invitado y un cliente del portal?', a: 'El invitado trabaja en tu lista (ve, comenta o edita los registros que le compartiste). El cliente del portal ve una página diseñada para él con SUS datos. Un proveedor suele ser invitado; un cliente, portal.' },
                    { q: '¿Cuántos invitados puedo tener?', a: 'Depende de tu plan: los invitados tienen su propio tope, aparte de los usuarios.' },
                    { q: '¿Puedo pasar un invitado a miembro del equipo?', a: 'Sí, desde **Ajustes → Miembros**, en la sección de invitados.' },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Ir a mis listas', to: '/lists' },
                    { label: 'Ver el recorrido para invitar', tour: 'invite-team' },
                    { label: 'Volver a la guía de opciones', article: 'compartir-opciones' },
                ],
            },
        ],
    },
];
