import type { TourContext, TourDef } from '../tour/tourTypes';

/**
 * Fase 7 — los recorridos de la app. Cada paso señala un elemento por su
 * `data-tour` (un test verifica que cada uno exista en el código) y se adapta
 * a quien mira: los pasos que su rol no puede usar se omiten, y en el celular
 * los que señalan el riel o el panel lateral cambian por el botón del menú.
 *
 * Los textos son cortos y nombran los botones tal como se ven en la app, en
 * **negrita**. `{app}` es el nombre de la app (white-label) o «la app».
 */

const recordsOf = (ctx: TourContext): string | null => (ctx.firstList ? `/lists/${ctx.firstList.slug}/records` : null);
const hasList = (ctx: TourContext): boolean => ctx.firstList !== null;
const canSeeDashboards = (ctx: TourContext): boolean =>
    ctx.can('manage_dashboards') || (ctx.can('access_admin') && ctx.can('view_dashboards'));

export const TOURS: TourDef[] = [
    // ── Recorrido por toda la app ─────────────────────────────────────────
    {
        id: 'welcome',
        title: 'Recorrido por la app',
        description: 'Lo principal en 2 minutos: listas, vistas, la ficha, avisos y dónde está todo.',
        available: () => true,
        steps: [
            {
                id: 'intro',
                title: 'Te damos la bienvenida',
                body: 'En 2 minutos te muestro lo principal de {app}. Puedes salir cuando quieras con **Saltar recorrido** o con la tecla Esc.',
            },
            {
                id: 'rail',
                route: '/lists',
                target: 'rail-lists',
                placement: 'right',
                title: 'Tus listas',
                body: 'Aquí vive la información de tu empresa: cada lista guarda registros (clientes, tareas, pedidos…). En el panel de al lado las ordenas en carpetas y anclas a **Favoritos** las que más usas.',
                mobile: {
                    target: 'topbar-menu',
                    title: 'El menú',
                    body: 'Toca aquí para moverte entre las secciones: tus listas, **Mi trabajo**, **Favoritos** y **Ajustes**.',
                },
            },
            {
                id: 'views',
                route: recordsOf,
                target: 'records-views',
                title: 'Cada lista, a tu manera',
                body: 'Cada pestaña es una vista: tabla, tablero por estado, calendario, Gantt… Con **+ Vista** creas otra con sus filtros.',
            },
            {
                id: 'filter',
                route: recordsOf,
                target: 'records-filter',
                title: 'Filtra y busca',
                body: '**Filtrar** te deja sólo lo que te interesa («Estado es Activo», «Vence antes de hoy»). El buscador de la derecha encuentra por cualquier texto.',
            },
            {
                id: 'new-record',
                route: recordsOf,
                target: 'records-new',
                title: 'Agrega registros',
                body: 'Con **Nuevo registro** completas uno en un formulario. También puedes escribir directo en la tabla, como en una hoja de cálculo.',
                when: (ctx) => ctx.can('create_records'),
            },
            {
                id: 'record',
                route: recordsOf,
                target: 'records-row',
                title: 'La ficha de cada registro',
                body: 'Haz clic en el nombre de un registro para abrir su ficha: todos sus campos, la descripción, los comentarios y el historial de cambios.',
            },
            {
                id: 'automations',
                route: recordsOf,
                target: 'records-automations',
                title: 'Que el trabajo se haga solo',
                body: 'En **Automatizaciones** decides qué pasa cuando algo cambia: avisar por correo, crear una tarea, esperar un plazo…',
                when: (ctx) => ctx.can('manage_automations'),
                mobile: 'skip',
            },
            {
                id: 'my-work',
                target: 'rail-mywork',
                placement: 'right',
                title: 'Mi trabajo',
                body: 'Lo que tienes asignado en todas las listas, ordenado por fecha: lo vencido, lo de hoy y lo que viene.',
                mobile: {
                    target: null,
                    body: 'En el menú, **Mi trabajo** reúne lo que tienes asignado en todas las listas, ordenado por fecha.',
                },
            },
            {
                id: 'notifications',
                target: 'topbar-notifications',
                placement: 'bottom',
                title: 'Avisos',
                body: 'La campana te avisa cuando te mencionan, te asignan algo o cambia un registro que sigues.',
            },
            {
                id: 'dashboards',
                target: 'rail-dashboards',
                placement: 'right',
                title: 'Tableros',
                body: 'Cifras y gráficos de tus listas en un solo lugar. Puedes compartirlos con un enlace o recibirlos por correo.',
                when: canSeeDashboards,
                mobile: 'skip',
            },
            {
                id: 'settings-admin',
                target: 'rail-settings',
                placement: 'right',
                title: 'Ajustes de la empresa',
                body: 'Invita a tu equipo, pon tu logo y tus colores, conecta otras apps y revisa tu plan.',
                when: (ctx) => ctx.isAdmin,
                mobile: 'skip',
            },
            {
                id: 'settings-account',
                target: 'rail-settings',
                placement: 'right',
                title: 'Tu cuenta',
                body: 'En **Ajustes** están tu contraseña, la verificación en dos pasos, qué avisos te llegan y el modo oscuro.',
                when: (ctx) => !ctx.isAdmin,
                mobile: 'skip',
            },
            {
                id: 'search',
                target: 'topbar-search',
                placement: 'bottom',
                title: 'Encuentra cualquier cosa',
                body: 'Busca listas, registros y tableros, o salta a cualquier sección. Atajo: **Ctrl+K** (⌘K en Mac).',
            },
            {
                id: 'help',
                target: 'topbar-help',
                placement: 'bottom',
                title: 'Ayuda cuando la necesites',
                body: 'Aquí tienes guías rápidas «¿Cómo hago…?» y puedes repetir este recorrido o los de cada tarea.',
                mobile: {
                    target: 'topbar-user',
                    body: 'En tu menú, **Ayuda** tiene guías rápidas «¿Cómo hago…?» y los recorridos de cada tarea.',
                },
            },
        ],
    },

    // ── Listas y registros ────────────────────────────────────────────────
    {
        id: 'lists-and-records',
        title: 'Listas y registros',
        description: 'Cómo se ve una lista, cómo se agregan, buscan y filtran los registros.',
        available: hasList,
        steps: [
            {
                id: 'cards',
                route: '/lists',
                target: 'lists-card',
                title: 'Tus listas',
                body: 'Cada tarjeta es una lista: un contenedor de registros con sus campos. Haz clic en una para abrirla.',
            },
            {
                id: 'table',
                route: recordsOf,
                target: 'records-table',
                title: 'Los registros',
                body: 'Cada fila es un registro y cada columna, un campo. Haz clic en una celda para elegirla y escribe para cambiarla, como en Excel.',
            },
            {
                id: 'new',
                route: recordsOf,
                target: 'records-new',
                title: 'Agrega registros',
                body: '**Nuevo registro** abre un formulario con todos los campos. También puedes usar **Agregar registro** al final de la tabla.',
                when: (ctx) => ctx.can('create_records'),
            },
            {
                id: 'search',
                route: recordsOf,
                target: 'records-search',
                title: 'Busca',
                body: 'Escribe y la lista se filtra al instante. Busca en todos los textos, también en la descripción de cada registro.',
            },
            {
                id: 'filter',
                route: recordsOf,
                target: 'records-filter',
                title: 'Filtra',
                body: '**Filtrar** arma condiciones («Estado es Activo», «Fecha antes de hoy»). Guárdalas como una vista para volver a ellas.',
            },
            {
                id: 'customize',
                route: recordsOf,
                target: 'records-customize',
                title: 'Personaliza la vista',
                body: 'Columnas, agrupar, colores, densidad, importar y exportar: todo está en **Personalizar vista**.',
                when: (ctx) => ctx.role !== 'guest',
            },
            {
                id: 'open',
                route: recordsOf,
                target: 'records-row',
                title: 'Abre un registro',
                body: 'Haz clic en el nombre de un registro para ver su ficha completa.',
            },
        ],
    },

    // ── Crear una lista ───────────────────────────────────────────────────
    {
        id: 'create-list',
        title: 'Crear una lista',
        description: 'Desde una plantilla, en blanco o duplicando una que ya tienes.',
        available: (ctx) => ctx.can('manage_lists'),
        steps: [
            {
                id: 'button',
                route: '/lists',
                target: 'lists-new',
                advanceOn: 'click',
                title: 'Crea una lista',
                body: 'Empieza con **Nueva lista**.',
            },
            {
                id: 'modes',
                target: 'list-create-modes',
                title: 'Tres caminos',
                body: '**Plantilla** nace con campos, vistas y automatizaciones listos. **En blanco** sólo pide el nombre. **Duplicar** copia una lista que ya tienes.',
            },
            {
                id: 'gallery',
                target: 'list-create-body',
                title: 'Elige una plantilla',
                body: 'Busca por tipo de negocio, mira qué trae cada una y créala con o sin datos de ejemplo.',
            },
            {
                id: 'after',
                title: 'Después, a tu medida',
                body: 'Con la lista creada, **Configurar lista** te deja agregar o cambiar campos, permisos, formularios y más.',
            },
        ],
    },

    // ── Importar ──────────────────────────────────────────────────────────
    {
        id: 'import',
        title: 'Importar desde Excel o CSV',
        description: 'Trae tus datos de una hoja de cálculo y actualiza los que ya tienes.',
        available: (ctx) => hasList(ctx) && ctx.can('import_records'),
        steps: [
            {
                id: 'open',
                route: recordsOf,
                target: 'records-customize',
                advanceOn: 'click',
                title: 'Importa tus datos',
                body: 'Abre **Personalizar vista**: ahí están las acciones de la lista.',
            },
            {
                id: 'import',
                target: 'view-settings-import',
                title: 'Importar registros',
                body: 'Elige tu archivo .xlsx o .csv. Las columnas se reconocen solas y puedes asignarlas a los campos o crear campos nuevos.',
            },
            {
                id: 'update',
                target: 'view-settings-update-file',
                title: '¿Ya los tienes cargados?',
                body: '**Actualizar desde un archivo** cambia los registros existentes usando una columna clave (ID, SKU, correo) en vez de duplicarlos.',
            },
            {
                id: 'export',
                target: 'view-settings-export',
                title: 'Y para sacarlos',
                body: '**Exportar registros** baja la vista a Excel o CSV, con sus filtros.',
                when: (ctx) => ctx.can('export_records'),
            },
        ],
    },

    // ── Vistas ────────────────────────────────────────────────────────────
    {
        id: 'views',
        title: 'Vistas',
        description: 'Tabla, kanban, calendario, Gantt… y cómo guardar tus filtros.',
        available: (ctx) => hasList(ctx) && ctx.role !== 'guest',
        steps: [
            {
                id: 'tabs',
                route: recordsOf,
                target: 'records-views',
                title: 'Las vistas de una lista',
                body: 'Una misma lista se ve de muchas formas. Cada pestaña es una vista guardada con sus filtros, orden y columnas.',
            },
            {
                id: 'new',
                target: 'records-new-view',
                advanceOn: 'click',
                title: 'Crea una vista',
                body: 'Haz clic en **+ Vista**.',
            },
            {
                id: 'name',
                target: 'view-create-name',
                title: 'Ponle un nombre',
                body: 'Por ejemplo, «Vencidos esta semana». La vista se guarda con los filtros, el orden y la búsqueda que tengas ahora.',
            },
            {
                id: 'type',
                target: 'view-create-types',
                title: 'Elige el tipo y guárdala',
                body: 'Lista, Hoja de cálculo, Kanban, Calendario, Tarjetas, Gantt o Carga de trabajo (algunas piden un campo de fecha, de selección o de persona). Termina con **Guardar vista**.',
            },
        ],
    },

    // ── La ficha ──────────────────────────────────────────────────────────
    {
        id: 'record',
        title: 'La ficha de un registro',
        description: 'Campos, descripción, comentarios, actividad y las acciones de cada registro.',
        available: hasList,
        steps: [
            {
                id: 'open',
                route: recordsOf,
                target: 'records-row',
                advanceOn: 'click',
                title: 'Abre un registro',
                body: 'Haz clic en el nombre de un registro.',
            },
            {
                id: 'title',
                target: 'record-title',
                title: 'La ficha',
                body: 'Aquí ves y cambias todo del registro. El título se edita directo.',
            },
            {
                id: 'description',
                target: 'record-description',
                title: 'Descripción',
                body: 'Un documento libre: escribe «/» para insertar títulos, listas, tablas o imágenes, y @ para mencionar a alguien.',
            },
            {
                id: 'fields',
                target: 'record-fields',
                title: 'Campos',
                body: 'Cada campo con su valor. Haz clic para cambiarlo y guarda con **Guardar cambios**. El reloj junto a un campo muestra su historial.',
            },
            {
                id: 'side',
                target: 'record-side',
                title: 'Comentarios y actividad',
                body: 'Conversa con tu equipo (escribe @ para mencionar) y mira en **Actividad** quién cambió qué y cuándo.',
            },
            {
                id: 'toolbar',
                target: 'record-toolbar',
                placement: 'bottom',
                title: 'Más acciones',
                body: 'Sigue el registro, ponte un recordatorio, genera un PDF o compártelo con alguien.',
                when: (ctx) => ctx.role !== 'guest',
            },
        ],
    },

    // ── Invitar al equipo ─────────────────────────────────────────────────
    {
        id: 'invite-team',
        title: 'Invitar a tu equipo',
        description: 'Suma personas, elige su rol y decide qué ve cada una.',
        available: (ctx) => ctx.isAdmin,
        steps: [
            {
                id: 'invite',
                route: '/settings?s=miembros',
                target: 'members-invite',
                title: 'Invita por correo',
                body: 'Escribe el correo, elige el rol y toca **Invitar**. Si la persona no tiene cuenta, le llega un correo para crear su contraseña.',
            },
            {
                id: 'roles',
                target: 'members-invite',
                title: 'El rol decide qué puede hacer',
                body: '**Admin**: todo. **Manager**: los registros, vistas y tableros del equipo. **Agente**: trabaja con sus registros. **Lector**: sólo mira.',
            },
            {
                id: 'list',
                target: 'members-list',
                title: 'Tu equipo',
                body: 'Cambia el rol de alguien o quítalo de la empresa desde su fila. Las invitaciones pendientes se pueden reenviar.',
            },
            {
                id: 'more',
                title: 'Más control',
                body: 'En **Roles** armas roles a tu medida, en **Equipos** agrupas personas (Ventas, Soporte) y en **Configurar lista → Permisos** decides qué ve cada rol en cada lista.',
            },
        ],
    },

    // ── Automatizaciones ─────────────────────────────────────────────────
    {
        id: 'automation-basics',
        title: 'Tu primera automatización',
        description: 'Cuándo se dispara, qué hace, cómo probarla y activarla.',
        available: (ctx) => hasList(ctx) && ctx.can('manage_automations'),
        steps: [
            {
                id: 'index',
                route: (ctx) => (ctx.firstList ? `/lists/${ctx.firstList.slug}/automations` : null),
                target: 'automations-new',
                title: 'Automatizaciones de la lista',
                body: 'Cada lista tiene las suyas. Empieza **Desde plantilla** (recetas listas para usar) o **En blanco**.',
            },
            {
                id: 'trigger',
                route: (ctx) => (ctx.firstList ? `/lists/${ctx.firstList.slug}/automations/new` : null),
                target: 'automation-trigger',
                title: 'Cuándo',
                body: 'El disparador: cuando se crea un registro, cuando cambia un campo, cuando llega una fecha, de forma programada…',
            },
            {
                id: 'action',
                target: 'automation-add-action',
                title: 'Qué hace',
                body: 'Agrega pasos: enviar un correo o un WhatsApp, cambiar un campo, crear un registro, **Esperar**, decidir con **Si / Si no**…',
            },
            {
                id: 'mode',
                target: 'automation-mode',
                placement: 'bottom',
                title: 'Flujo o lienzo',
                body: 'Mira los pasos en lista (**Flujo**) o como diagrama con las ramas lado a lado (**Lienzo**).',
                mobile: 'skip',
            },
            {
                id: 'test',
                target: 'automation-test',
                placement: 'bottom',
                title: 'Prueba antes de activar',
                body: '**Probar** la ejecuta con un registro real en modo simulación: ves qué haría sin enviar ni cambiar nada.',
            },
            {
                id: 'save',
                target: 'automation-save',
                placement: 'bottom',
                title: 'Guarda y activa',
                body: 'Guarda con **Guardar**. El interruptor **Activa** / **Pausada** la enciende o la detiene cuando quieras.',
            },
        ],
    },

    // ── Tableros ──────────────────────────────────────────────────────────
    {
        id: 'dashboards',
        title: 'Tableros',
        description: 'Cifras y gráficos de tus listas, período, widgets y cómo compartirlos.',
        available: canSeeDashboards,
        steps: [
            {
                id: 'new',
                route: '/dashboards',
                target: 'dashboards-new',
                title: 'Tus tableros',
                body: 'Cifras y gráficos de tus listas. **Nuevo dashboard** arma uno desde una plantilla o en blanco.',
                when: (ctx) => ctx.can('manage_dashboards'),
            },
            {
                id: 'open',
                route: '/dashboards',
                target: 'dashboard-card',
                advanceOn: 'click',
                title: 'Abre un tablero',
                body: 'Haz clic en un tablero.',
            },
            {
                id: 'period',
                target: 'dashboard-period',
                placement: 'bottom',
                title: 'El período',
                body: 'Cambia el período de todo el tablero a la vez: este mes, los últimos 30 días, un rango propio…',
            },
            {
                id: 'widget',
                target: 'dashboard-add-widget',
                placement: 'bottom',
                title: 'Agrega widgets',
                body: 'Cifras, barras, donas, embudos, tablas, medidores… cada uno sobre la lista que elijas.',
                when: (ctx) => ctx.can('manage_dashboards'),
            },
            {
                id: 'share',
                target: 'dashboard-share',
                placement: 'bottom',
                title: 'Compártelo',
                body: 'Con **Compartir** publicas un enlace que se abre sin entrar a la app, o programas un envío por correo.',
            },
        ],
    },

    // ── Formularios ───────────────────────────────────────────────────────
    {
        id: 'forms',
        title: 'Formularios públicos',
        description: 'Recibe solicitudes desde tu web: cada respuesta llega como un registro.',
        available: (ctx) => hasList(ctx) && ctx.can('manage_forms'),
        steps: [
            {
                id: 'new',
                route: (ctx) => (ctx.firstList ? `/lists/${ctx.firstList.slug}/edit?s=formularios` : null),
                target: 'forms-new',
                title: 'Formularios de la lista',
                body: 'Cada respuesta crea un registro en esta lista. Empieza con **Nuevo formulario**.',
            },
            {
                id: 'build',
                title: 'Arma, publica y comparte',
                body: 'Elige las preguntas (cada una llena un campo), agrega condiciones o páginas, publícalo y copia el enlace o el código para insertarlo en tu web.',
            },
        ],
    },

    // ── Portal del cliente ────────────────────────────────────────────────
    {
        id: 'portal',
        title: 'Portal del cliente',
        description: 'Una página privada para cada cliente, o la lista publicada en la web.',
        available: (ctx) => hasList(ctx) && ctx.can('manage_lists'),
        steps: [
            {
                id: 'portal',
                route: (ctx) => (ctx.firstList ? `/lists/${ctx.firstList.slug}/edit?s=compartir` : null),
                target: 'share-portal',
                title: 'Portal del cliente',
                body: 'Actívalo con **Activar el portal en esta lista**: cada registro tiene su página privada y el cliente entra con un enlace que le llega al correo.',
            },
            {
                id: 'public',
                target: 'share-public',
                title: 'Página pública',
                body: 'O publica la lista de sólo lectura en una dirección que cualquiera puede abrir, con los campos que elijas.',
            },
            {
                id: 'access',
                title: 'Dar acceso a un cliente',
                body: 'Con el portal activo, abre la ficha del registro y en **Acceso al portal del cliente** escribe su correo y toca **Dar acceso**.',
            },
        ],
    },

    // ── Marca ─────────────────────────────────────────────────────────────
    {
        id: 'branding',
        title: 'Tu marca',
        description: 'Logo, colores, nombre y dominio propio.',
        available: (ctx) => ctx.isAdmin,
        steps: [
            {
                id: 'brand',
                route: '/settings?s=marca',
                target: 'branding-card',
                title: 'Tu marca',
                body: 'Sube tu logo, elige el color principal y el nombre de la app. Lo ven tu equipo, tus clientes en el portal y los formularios.',
            },
            {
                id: 'domain',
                target: 'branding-domain',
                title: 'Tu dominio',
                body: 'Entra por tu propia dirección (por ejemplo, app.tuempresa.com). Primero verificas que el dominio es tuyo y después lo apuntas.',
            },
        ],
    },

    // ── Instalar la app ───────────────────────────────────────────────────
    {
        id: 'install-app',
        title: 'Instalar la app y recibir avisos',
        description: 'En tu teléfono o computador, con notificaciones aunque esté cerrada.',
        available: () => true,
        steps: [
            {
                id: 'install',
                target: 'topbar-user',
                placement: 'bottom',
                title: 'Instala la app',
                body: 'Abre tu menú y elige **Instalar la app**: queda como una aplicación más. En iPhone se instala desde Safari con **Compartir → Agregar a inicio**.',
            },
            {
                id: 'push',
                route: '/settings?s=avisos',
                target: 'push-card',
                title: 'Avisos en este dispositivo',
                body: 'Activa las notificaciones para enterarte aunque la app esté cerrada, y pruébalas con **Enviarme una prueba**.',
            },
            {
                id: 'prefs',
                route: '/settings?s=avisos',
                target: 'notification-prefs',
                title: 'Qué te llega',
                body: 'Elige, por tipo de aviso, si te llega también por correo o como notificación, y si quieres un resumen diario.',
            },
        ],
    },

    // ── Búsqueda y atajos ─────────────────────────────────────────────────
    {
        id: 'search-and-shortcuts',
        title: 'Búsqueda y atajos',
        description: 'Encuentra cualquier cosa y muévete con el teclado.',
        available: () => true,
        steps: [
            {
                id: 'search',
                target: 'topbar-search',
                placement: 'bottom',
                title: 'Búsqueda global',
                body: 'Encuentra listas, registros, tableros y guías por su nombre, o salta a una sección. Atajo: **Ctrl+K** (⌘K en Mac).',
            },
            {
                id: 'keys',
                title: 'Atajos de teclado',
                body: 'Pulsa **?** para verlos todos. **g** y luego una letra te lleva a una sección: **g l** Listas, **g t** Mi trabajo, **g s** Ajustes.',
                device: 'desktop',
            },
            {
                id: 'help',
                target: 'topbar-help',
                placement: 'bottom',
                title: 'Y la ayuda, aquí',
                body: 'Busca «cómo…» en la ayuda o en la búsqueda global: las guías también aparecen ahí.',
                mobile: { target: 'topbar-user', body: 'En tu menú está **Ayuda**: busca «cómo…» y encuentra la guía.' },
            },
        ],
    },

    // ── Asistente IA ──────────────────────────────────────────────────────
    {
        id: 'assistant',
        title: 'El asistente IA',
        description: 'Pídele en tus palabras una lista, un tablero, una automatización o un dato.',
        available: (ctx) => ctx.can('use_ai_assistant') && ctx.role !== 'guest',
        steps: [
            {
                id: 'open',
                target: 'topbar-assistant',
                placement: 'bottom',
                advanceOn: 'click',
                title: 'El asistente',
                body: 'Ábrelo con el botón de la chispa.',
            },
            {
                id: 'ask',
                target: 'assistant-input',
                placement: 'left',
                title: 'Pídele lo que necesites',
                body: '«Crea una lista de proveedores», «¿cuánto facturé este mes?»… Te propone los cambios y tú decides si aplicarlos. Si no está activado, aquí te dice qué falta.',
            },
        ],
    },
];

export function tourById(id: string): TourDef | undefined {
    return TOURS.find((t) => t.id === id);
}
