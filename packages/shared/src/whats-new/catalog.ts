import type { WhatsNewCatalogEntry } from '../schemas/whats-new';

/**
 * Novedades que viajan con cada versión (fase 7 · entrega 3).
 *
 * Al arrancar, el servidor las copia a la tabla `whats_new_entries` (es
 * idempotente: inserta las nuevas, actualiza las que el operador no editó y
 * respeta las que editó u ocultó). Cómo se agrega la de una versión nueva:
 * `./README.md`.
 *
 * Reglas para escribirlas (las revisa `whats-new.test.ts`):
 *  - Para quien USA la app, no para el operador: qué puede hacer ahora y dónde
 *    está, en una o dos líneas. Español neutro con tuteo («puedes», «elige»).
 *  - Nunca el nombre del producto (hay empresas con su propia marca): «la app».
 *  - El botón lleva a donde se usa (una ruta de la app) y, si hay un recorrido
 *    que lo muestra, también su id: si existe para la persona, arranca el
 *    recorrido; si no, va a la ruta.
 *  - `audience.roles` sólo cuando la novedad no sirve para los demás (por
 *    ejemplo, algo que sólo un admin configura).
 *  - `featured: true` con mesura: a cada persona se le presenta en un diálogo
 *    UNA vez, una por sesión.
 *  - La clave no se cambia nunca: si cambia, es otra novedad.
 */
export const WHATS_NEW_CATALOG: readonly WhatsNewCatalogEntry[] = [
    {
        key: 'v0.1.296-papelera',
        version: '0.1.296',
        date: '2026-10-22',
        kind: 'feature',
        media: {
            illustration: 'empresa-trash',
            demo: 'lote-papelera-abrir',
        },
        title: 'Papelera: lo que borras se puede recuperar',
        summary:
            'Registros, listas, campos, vistas, automatizaciones y tableros borrados se guardan 30 días y vuelven tal cual estaban.',
        body: [
            'Justo después de borrar algo aparece **Deshacer** por unos segundos. Si ya pasó, búscalo en **Ajustes → Papelera**: desde ahí lo restauras o lo borras para siempre.',
            '',
            '- Una lista vuelve con sus registros, campos y vistas.',
            '- Un registro vuelve con sus subtareas, archivos y comentarios.',
        ].join('\n'),
        action: { label: 'Ver la papelera', href: '/settings?s=papelera' },
    },
    {
        key: 'v0.1.297-kanban-ventas',
        version: '0.1.297',
        date: '2026-10-22',
        kind: 'improvement',
        media: {
            slides: [
                {
                    title: 'Totales en cada columna',
                    text: 'Suma o promedia el valor de las tarjetas de cada etapa y de todo el embudo.',
                    illustration: 'vistas-kanban',
                },
                {
                    title: 'Arrastra y se guarda',
                    text: 'Mueve una tarjeta a otra columna o carril y el registro cambia al instante.',
                    illustration: 'kanban-drag',
                },
                {
                    title: 'Límites por columna',
                    text: 'Marca cuántas tarjetas caben en una etapa y la columna avisa cuando se pasa.',
                    illustration: 'vistas-personalizar',
                },
            ],
        },
        title: 'Kanban con totales, carriles y límites',
        summary: 'Cada columna del tablero suma el valor de sus tarjetas, se puede dividir en carriles y avisa cuando pasa su límite.',
        body: [
            'En una vista Kanban, toca **Configurar tablero**:',
            '',
            '- Suma o promedio de un campo de dinero en cada columna y en todo el embudo.',
            '- Carriles por persona, prioridad o cualquier selección.',
            '- Un límite de tarjetas por columna.',
            '- Campos que se piden al mover una tarjeta (por ejemplo, el motivo de pérdida).',
        ].join('\n'),
        action: { label: 'Pruébalo', href: '/lists', tour: 'views' },
    },
    {
        key: 'v0.1.299-excel',
        version: '0.1.299',
        date: '2026-10-23',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Exporta la vista a Excel',
                    text: 'Montos, fechas y opciones salen con su formato, respetando filtros, orden y columnas.',
                    illustration: 'ie-exportar',
                },
                {
                    title: 'Importa un .xlsx',
                    text: 'Arrastra el archivo, elige la hoja y revisa cómo se llena cada campo antes de crear.',
                    illustration: 'ie-importar',
                },
            ],
        },
        title: 'Exporta e importa archivos de Excel',
        summary: 'Descarga la vista en Excel con montos, fechas y opciones en su formato, e importa un .xlsx eligiendo la hoja.',
        body: [
            'En una lista, abre **Exportar** y elige **Excel (.xlsx)**: se respetan los filtros, el orden y las columnas de la vista.',
            '',
            'Para traer datos, arrastra el archivo en **Importar**. Si tiene varias hojas, eliges cuál.',
        ].join('\n'),
        action: { label: 'Pruébalo', href: '/lists', tour: 'import' },
    },
    {
        key: 'v0.1.301-calendario',
        version: '0.1.301',
        date: '2026-10-23',
        kind: 'improvement',
        media: {
            illustration: 'vistas-calendario',
            demo: 'vistas-calendario-semana',
        },
        title: 'Calendario por mes, semana, día y agenda',
        summary: 'Arrastra un evento para reprogramarlo, estíralo para cambiar su fin y crea un registro con un clic en un hueco.',
        body: [
            '- Cambia de vista con **M**, **S**, **D** o **A**, y vuelve a hoy con **H**.',
            '- Muestra varias fechas a la vez, cada una con su color.',
            '- En el teléfono se abre en la agenda del día.',
        ].join('\n'),
        action: { label: 'Pruébalo', href: '/lists', tour: 'views' },
    },
    {
        key: 'v0.1.302-gantt',
        version: '0.1.302',
        date: '2026-10-23',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Tu plan en una línea de tiempo',
                    text: 'Arrastra las barras para mover o estirar las fechas de cada registro.',
                    illustration: 'vistas-gantt',
                },
                {
                    title: 'Dependencias que se respetan',
                    text: 'Une dos barras: al correr una, lo que depende de ella se corre sola.',
                    illustration: 'ficha-dependencias',
                },
            ],
        },
        title: 'Vista Gantt y dependencias entre registros',
        summary: 'Planifica en una línea de tiempo y marca qué registro bloquea a otro: al correr uno, lo que depende de él se corre solo.',
        body: [
            'Crea una vista **Gantt** desde **+ Vista** en cualquier lista con fechas.',
            '',
            '- Arrastra las barras para mover o estirar las fechas.',
            '- Une dos barras para crear una dependencia.',
            '- Guarda una línea base y compara el plan con lo real.',
        ].join('\n'),
        action: { label: 'Ir a mis listas', href: '/lists', tour: 'views' },
        audience: { roles: ['admin', 'manager'] },
    },
    {
        key: 'v0.1.304-formulas-y-botones',
        version: '0.1.304',
        date: '2026-10-23',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Fórmulas como en una hoja de cálculo',
                    text: 'Escribe {Precio} * {Cantidad} y elige si el resultado es moneda, fecha o porcentaje.',
                    illustration: 'lc-formula',
                },
                {
                    title: 'Botones con una acción a un clic',
                    text: 'Abre WhatsApp, cambia campos o genera un PDF desde cada registro.',
                    illustration: 'lc-especiales',
                },
            ],
        },
        title: 'Fórmulas y botones en tus listas',
        summary:
            'Calcula como en una hoja de cálculo —SI, días hábiles y más de 40 funciones— y agrega botones que abren WhatsApp, cambian campos o generan un PDF.',
        body: [
            'Agrega un campo **Fórmula**: escribe «{Precio} * {Cantidad}» y elige cómo se muestra el resultado (moneda, fecha, porcentaje…).',
            '',
            'Con un campo **Botón**, cada registro tiene una acción a un clic.',
        ].join('\n'),
        action: { label: 'Ir a mis listas', href: '/lists' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.307-carga-de-trabajo',
        version: '0.1.307',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            illustration: 'vistas-carga',
        },
        title: 'Carga de trabajo por persona',
        summary: 'Mira cuánto tiene asignado cada persona por día o por semana, compáralo con su capacidad y reasigna arrastrando.',
        action: { label: 'Ir a mis listas', href: '/lists', tour: 'views' },
        audience: { roles: ['admin', 'manager'] },
    },
    {
        key: 'v0.1.309-aprobaciones',
        version: '0.1.309',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Arma el flujo una vez',
                    text: 'Elige quién aprueba en cada paso: una persona, un rol o un equipo.',
                    illustration: 'aprob-flujo',
                },
                {
                    title: 'Aprueba desde donde estés',
                    text: 'Desde la ficha, desde Mi trabajo o con los botones del correo.',
                    illustration: 'aprob-decidir',
                },
                {
                    title: 'Todo queda registrado',
                    text: 'Cada decisión deja quién, cuándo y el motivo en la actividad del registro.',
                    illustration: 'aprob-columna',
                },
            ],
        },
        title: 'Aprobaciones de uno o varios pasos',
        summary: 'Pide que alguien apruebe un registro antes de seguir. Se aprueba desde la ficha, desde Mi trabajo o desde el correo.',
        body: [
            'Los flujos se configuran por lista, en **Ajustes de la lista → Aprobaciones**.',
            '',
            'Lo que te toca aprobar aparece en **Mi trabajo → Aprobaciones**.',
        ].join('\n'),
        action: { label: 'Ver Mi trabajo', href: '/my-work' },
    },
    {
        key: 'v0.1.310-checklists',
        version: '0.1.310',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            illustration: 'ficha-checklist',
        },
        title: 'Checklists dentro de cada registro',
        summary: 'Divide el trabajo en pasos con responsable y fecha, y crea registros desde plantillas con sus subtareas y checklists listos.',
        body: [
            '- Pega varias líneas y cada una se vuelve un paso.',
            '- El avance se ve en la tabla y en el kanban.',
            '- Los pasos que te asignan aparecen en **Mi trabajo**.',
        ].join('\n'),
        action: { label: 'Pruébalo', href: '/lists', tour: 'record' },
    },
    {
        key: 'v0.1.312-equipos-roles-invitados',
        version: '0.1.312',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Equipos',
                    text: 'Agrupa a las personas y dale acceso a una lista a todo el equipo de una vez.',
                    illustration: 'equipo-teams',
                },
                {
                    title: 'Roles a tu medida',
                    text: 'Parte de Gerente, Agente o Lector y enciende sólo lo que hace falta.',
                    illustration: 'equipo-roles-custom',
                },
                {
                    title: 'Invitados de afuera',
                    text: 'Comparte una lista o un registro con un proveedor sin ocupar un usuario.',
                    illustration: 'equipo-guest',
                },
            ],
        },
        title: 'Equipos, roles a tu medida e invitados',
        summary:
            'Agrupa a las personas en equipos, crea roles con los permisos justos y comparte una lista o un registro con alguien de afuera.',
        body: [
            '- **Equipos**: asigna registros a un equipo y dale acceso a una lista de una vez.',
            '- **Roles**: parte de Gerente, Agente o Lector y enciende sólo lo que hace falta.',
            '- **Invitados**: comparte sólo lo necesario con un proveedor o un contador, sin que ocupe un usuario.',
        ].join('\n'),
        action: { label: 'Ver equipos', href: '/settings?s=equipos', tour: 'invite-team' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.313-agenda-de-citas',
        version: '0.1.313',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Tu página de citas',
                    text: 'Tus clientes eligen el servicio y con quién, desde el enlace o insertada en tu sitio.',
                    illustration: 'citas-hero',
                },
                {
                    title: 'Sólo horarios libres',
                    text: 'Respeta los horarios de cada persona, los festivos y lo que ya está ocupado.',
                    illustration: 'citas-slots',
                },
                {
                    title: 'Cambiar o cancelar',
                    text: 'Cada cita llega por correo con enlaces para reprogramarla o cancelarla.',
                    illustration: 'citas-reschedule',
                },
            ],
        },
        title: 'Agenda de citas en línea',
        summary: 'Publica una página donde tus clientes eligen el servicio, el día y la hora libres. Cada cita llega como un registro de la lista.',
        body: [
            'Se configura en **Ajustes de la lista → Agenda**: servicios, quién atiende, horarios y recordatorios.',
            '',
            'Si conectas Google Calendar u Outlook, la agenda respeta lo que ya tienes ocupado.',
        ].join('\n'),
        action: { label: 'Ir a mis listas', href: '/lists' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.314-app-instalable',
        version: '0.1.314',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'En tu pantalla de inicio',
                    text: 'Instala la app desde el menú de tu cuenta y ábrela como cualquier otra.',
                    illustration: 'dia-push',
                },
                {
                    title: 'Avisos aunque esté cerrada',
                    text: 'Menciones, asignaciones y aprobaciones llegan como notificación al teléfono.',
                    illustration: 'cuenta-avisos',
                },
                {
                    title: 'Escanea códigos',
                    text: 'Lee un QR o un código de barras con la cámara y abre el registro al instante.',
                    illustration: 'dia-escaner',
                },
            ],
        },
        title: 'Instala la app y recibe avisos en tu teléfono',
        summary: 'Agrégala a la pantalla de inicio, recibe notificaciones aunque esté cerrada y lee códigos QR o de barras con la cámara.',
        body: [
            '- **Instalar**: menú de tu cuenta → **Instalar la app**.',
            '- **Notificaciones**: en **Ajustes → Avisos**, actívalas en este dispositivo.',
            '- **Escáner**: en la búsqueda, toca **Escanear un código**.',
        ].join('\n'),
        action: { label: 'Activar avisos', href: '/settings?s=avisos', tour: 'install-app' },
        featured: true,
    },
    {
        key: 'v0.1.315-whatsapp-business',
        version: '0.1.315',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Conecta tu número',
                    text: 'Con la cuenta oficial de WhatsApp Business de tu empresa, en unos minutos.',
                    illustration: 'wab-setup',
                },
                {
                    title: 'Mensajes que llegan solos',
                    text: 'Cada mensaje crea o actualiza el contacto y puede disparar una automatización.',
                    illustration: 'wab-inbound',
                },
                {
                    title: 'Plantillas desde la ficha',
                    text: 'Envía plantillas aprobadas con los datos del registro, a un clic.',
                    illustration: 'wab-template-send',
                },
            ],
        },
        title: 'WhatsApp Business oficial',
        summary: 'Conecta el número de tu empresa: los mensajes que llegan crean o actualizan contactos, y desde la ficha envías plantillas aprobadas.',
        action: { label: 'Conectar WhatsApp', href: '/settings?s=conectores' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.316-mesa-de-ayuda',
        version: '0.1.316',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Cada correo, un ticket',
                    text: 'Lo que llega al buzón de soporte se vuelve un registro con su hilo completo.',
                    illustration: 'mesa-hero',
                },
                {
                    title: 'Responde desde la ficha',
                    text: 'Con respuestas guardadas y tu firma; la respuesta del cliente vuelve al mismo ticket.',
                    illustration: 'mesa-reply',
                },
                {
                    title: 'Tiempos de respuesta',
                    text: 'El SLA avisa antes de vencer y escala si nadie responde.',
                    illustration: 'mesa-sla',
                },
            ],
        },
        title: 'Mesa de ayuda por correo',
        summary:
            'Cada correo que llega al buzón de soporte crea un ticket, las respuestas se suman al mismo hilo y el tiempo de respuesta avisa antes de vencer.',
        body: [
            'Un admin conecta el buzón en **Ajustes de la lista → Correo entrante**.',
            '',
            'Desde la ficha del ticket respondes por correo, con respuestas guardadas y tu firma.',
        ].join('\n'),
        action: { label: 'Ir a mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.317-agentes-ia',
        version: '0.1.317',
        date: '2026-10-26',
        kind: 'feature',
        media: {
            slides: [
                {
                    title: 'Un compañero que trabaja solo',
                    text: 'Clasifica, resume, completa datos y sugiere respuestas con tus instrucciones.',
                    illustration: 'ia-agente',
                },
                {
                    title: 'Tú decides cuándo trabaja',
                    text: 'Al crear un registro, al cambiar un campo o en un horario, como cualquier automatización.',
                    illustration: 'ia-agente-cuando',
                },
            ],
        },
        title: 'Agentes de IA que trabajan contigo',
        summary:
            'Crea compañeros que clasifican, resumen, completan datos y sugieren respuestas. Tú decides si aplican los cambios o sólo los proponen.',
        body: [
            'Parte de una plantilla (clasificar tickets, resumir al cerrar, completar datos) y elige en qué listas trabaja y con qué herramientas.',
            '',
            'Un agente nunca tiene más acceso que la persona que lo configuró.',
        ].join('\n'),
        action: { label: 'Crear un agente', href: '/agents' },
        featured: true,
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.318-primeros-pasos',
        version: '0.1.318',
        date: '2026-10-27',
        kind: 'feature',
        media: {
            illustration: 'pp-empezar',
            demo: 'pp-primeros-pasos',
        },
        title: 'Primeros pasos y listas armadas con IA',
        summary:
            'Una guía que se completa sola a medida que usas la app, y la opción de describir lo que necesitas para que la IA te arme las listas.',
        body: [
            'Abre **Primeros pasos** con el botón de abajo a la derecha o desde el menú de tu perfil. Cada paso se marca solo cuando lo haces y trae **Hacerlo** para ir directo.',
            '',
            'Si administras la empresa, en **Primeros pasos → Agrega más con IA** describes tu negocio y revisas la propuesta (listas, campos, vistas y un tablero) antes de crearla.',
        ].join('\n'),
    },
    {
        key: 'v0.1.320-ayuda-y-recorridos',
        version: '0.1.320',
        date: '2026-10-27',
        kind: 'feature',
        media: {
            illustration: 'pp-ayuda',
            demo: 'pp-ayuda',
        },
        title: 'Ayuda dentro de la app',
        summary:
            'Toca Ayuda, junto a la campana: guías rápidas de cada tarea y recorridos que te muestran la app paso a paso.',
        body: [
            'En **Ayuda** buscas «¿Cómo hago…?» y ves las guías de la pantalla en la que estás. Cada guía trae **Muéstrame** para recorrerla en la app e **Ir ahí** para ir directo.',
            '',
            'También las encuentras con **Ctrl+K**, y en el celular, desde el menú de tu perfil.',
        ].join('\n'),
        action: { label: 'Ver el recorrido', href: '/lists', tour: 'welcome' },
    },
    {
        key: 'v0.1.321-instalar-la-app',
        version: '0.1.321',
        date: '2026-10-27',
        kind: 'improvement',
        media: {
            illustration: 'dia-push',
            demo: 'dia-instalar',
        },
        title: 'Instalar la app, en cualquier navegador',
        summary:
            '«Instalar la app» ahora está siempre en el menú de tu perfil y en Ajustes → Cuenta → Avisos, con los pasos para tu navegador.',
        body: [
            'Si tu navegador la instala con un clic, verás **Instalar ahora**. Si no, te mostramos los pasos exactos para tu navegador: Chrome, Edge, Safari en el Mac, Android, iPhone o iPad.',
            '',
            'También puedes ver los pasos para otro dispositivo, por ejemplo para explicarle a tu equipo cómo instalarla en el teléfono.',
        ].join('\n'),
        action: { label: 'Ver cómo instalarla', href: '/settings?s=avisos' },
    },
    {
        key: 'v0.1.322-centro-de-aprendizaje',
        version: '0.1.322',
        date: '2026-10-27',
        kind: 'feature',
        media: {
            illustration: 'learn-hero',
        },
        featured: true,
        title: 'Centro de aprendizaje',
        summary:
            'Guías completas de cada parte de la app, con animaciones y capturas paso a paso: qué hace cada ajuste, para qué sirve y cómo lo usan otras empresas.',
        body: [
            'Encuéntralo en **Aprende**, en el menú de la izquierda. Está organizado por módulos: listas y campos, vistas, automatizaciones, tableros, formularios, portal de clientes, integraciones y más.',
            '',
            'Cada guía trae una animación que explica la idea, una captura real que muestra dónde tocar, ejemplos de negocios y preguntas frecuentes. También puedes buscar con **Ctrl+K**.',
        ].join('\n'),
        action: { label: 'Abrir el centro', href: '/aprende' },
    },
    {
        key: 'v0.1.323-ideas-para-tu-negocio',
        version: '0.1.323',
        date: '2026-10-27',
        kind: 'feature',
        media: {
            illustration: 'auto-flujo',
        },
        title: 'Ideas para tu negocio, listas para activar',
        summary:
            'Casi 40 casos de uso reales —recordatorios de pago, avisos por WhatsApp, agendas, tableros— que se activan sobre tus listas con un clic.',
        body: [
            'Encuéntralas en **Aprende → Ideas para tu negocio**. Cada idea te cuenta qué resuelve, cómo funciona paso a paso y qué se crea.',
            '',
            'Al activarla, elegimos la lista y los campos por ti (los puedes cambiar) y te preguntamos lo justo: a quién avisar, cuántos días antes. En las **Automatizaciones** de cada lista verás las ideas que encajan con ella.',
        ].join('\n'),
        action: { label: 'Ver las ideas', href: '/ideas' },
    },
    {
        key: 'v0.1.324-recorridos-guiados',
        version: '0.1.324',
        date: '2026-10-27',
        kind: 'improvement',
        media: {
            illustration: 'pp-piezas',
        },
        title: 'Recorridos guiados, ahora con animaciones',
        summary:
            'Los recorridos te muestran cada pantalla con una animación, te invitan a probarlo tú y al final te dicen qué seguir aprendiendo.',
        body: [
            'Cada recorrido empieza con lo que vas a ver y cuánto dura. En cada paso, una animación explica la idea, una flecha señala dónde está y, cuando conviene, **lo haces tú**: abrir un registro, escribir en el buscador, crear una vista.',
            '',
            'Al terminar ves lo que aprendiste, el recorrido que sigue y la guía completa. Encuéntralos todos en **Aprende → Recorridos guiados**, incluidos dos nuevos: **Tu día a día** y **Aprende, ideas y novedades**.',
        ].join('\n'),
        action: { label: 'Ver los recorridos', href: '/aprende#recorridos' },
    },
    {
        key: 'v0.1.325-novedades-animadas',
        version: '0.1.325',
        date: '2026-10-27',
        kind: 'improvement',
        title: 'Novedades con animaciones',
        summary:
            'Cada novedad te muestra cómo funciona con una animación o un carrusel de diapositivas, también las que ya habías visto.',
        media: {
            slides: [
                {
                    title: 'Mira antes de leer',
                    text: 'Una animación con los colores de tu empresa explica la novedad en segundos.',
                    illustration: 'plat-novedades',
                },
                {
                    title: 'Varias cosas, un carrusel',
                    text: 'Si la novedad trae varias partes, pasa de una a otra con las flechas o los puntos.',
                    illustration: 'learn-hero',
                },
            ],
        },
        body: 'Ábrelas desde el megáfono, junto a la campana. Las de versiones anteriores también tienen su animación.',
        action: { label: 'Ver las novedades', href: '/novedades' },
    },
    {
        key: 'v0.1.326-app-instalada-neutra',
        version: '0.1.326',
        date: '2026-10-27',
        kind: 'improvement',
        title: 'La app instalada, más sobria y más fácil de instalar',
        summary:
            'Las barras del teléfono ya no se pintan con el color de la marca: salen blancas o negras, y la app te ofrece instalarla la primera vez.',
        media: {
            slides: [
                {
                    title: 'Barras neutras',
                    text: 'La barra de la hora y la de abajo salen blancas en modo claro y negras en oscuro, como la barra de la app.',
                    illustration: 'empresa-branding',
                },
                {
                    title: 'Te la ofrece sola',
                    text: 'La primera vez que entras desde un dispositivo, te propone instalarla con un clic o te muestra los pasos.',
                    illustration: 'dia-push',
                },
            ],
        },
        body: 'Si prefieres el color de tu marca u otro, un administrador lo elige en **Ajustes → Marca → Barras del teléfono**.',
        action: { label: 'Ver la marca', href: '/settings?s=marca' },
    },
    {
        key: 'v0.1.327-inicio-de-sesion-nuevo',
        version: '0.1.327',
        date: '2026-10-27',
        kind: 'improvement',
        title: 'Un inicio de sesión y una carga más limpios',
        summary:
            'La pantalla para entrar es nueva, la app arranca con una pantalla de carga sobria y ya no muestra un ícono genérico como si fuera un logo.',
        media: {
            slides: [
                {
                    title: 'Entrar, sin ruido',
                    text: 'Un formulario claro, con la opción de ver la contraseña y la ayuda para recuperarla a la vista.',
                    illustration: 'cuenta-sessions',
                },
                {
                    title: 'Tu marca al abrir la app',
                    text: 'Mientras carga se ve el logo o el nombre de tu empresa, sin pantallas en blanco.',
                    illustration: 'empresa-branding',
                },
            ],
        },
        body: 'Si tu empresa sube su logo en **Ajustes → Marca**, se usa en el menú, en la pestaña del navegador y al abrir la app.',
        action: { label: 'Ver la marca', href: '/settings?s=marca' },
    },
    {
        key: 'v0.1.328-barra-oscura',
        version: '0.1.328',
        date: '2026-10-27',
        kind: 'fix',
        title: 'La app instalada respeta el modo oscuro abajo',
        summary:
            'En Android, la barra de abajo de la app instalada ahora es oscura cuando usas el modo oscuro, como el resto de la app.',
        media: { illustration: 'dia-push' },
        body: 'Si ya tenías la app instalada, el teléfono lo actualiza solo en unos días. Para verlo ya, quita la app y vuelve a instalarla desde el menú de tu perfil.',
    },
    {
        key: 'v0.1.329-apertura-limpia',
        version: '0.1.329',
        date: '2026-10-27',
        kind: 'improvement',
        title: 'La app se abre más rápido a la vista',
        summary:
            'Mientras carga ya ves la forma de la app, con una línea de avance arriba, en vez de una pantalla con el logo.',
        media: { illustration: 'empresa-branding' },
        body: 'Si usas la app instalada en el teléfono, quítala y vuelve a instalarla para ver también el ícono nuevo al abrirla.',
    },
    {
        key: 'v0.1.330-sql-diagnostico',
        version: '0.1.330',
        date: '2026-10-28',
        kind: 'improvement',
        title: 'Cuando falla una conexión a SQL Server, sabes por qué',
        summary:
            'Si la base de datos no responde, el aviso dice en qué paso se cortó y qué contestó el servidor, y la app vuelve a intentar sola ante un corte pasajero.',
        media: { illustration: 'empresa-problems' },
        body: 'En **Ajustes → Problemas** verás si la red llega hasta el servidor, si el puerto abre y qué respondió la base, para saber si el problema está en la base, en la red o en la configuración.',
        action: { label: 'Ver problemas', href: '/settings?s=problemas' },
    },
    {
        key: 'v0.1.332-sms',
        version: '0.1.332',
        date: '2026-10-29',
        kind: 'feature',
        title: 'Manda SMS desde tus listas y automatizaciones',
        summary:
            'Conecta Twilio, BulkGate, Infobip, LabsMobile u Onurix y manda SMS desde un registro, a varios a la vez o en una automatización, con el estado de entrega en el registro.',
        media: {
            slides: [
                {
                    title: 'Conecta tu proveedor de SMS',
                    text: 'En Integraciones, con la clave de tu cuenta. La revisamos antes de guardarla y los SMS se cobran a esa cuenta.',
                    illustration: 'sms-hero',
                },
                {
                    title: 'Sabes cuántos SMS vas a pagar',
                    text: 'El contador te dice cuántos SMS ocupa el mensaje y te deja quitar las tildes para que entre en menos.',
                    illustration: 'sms-counter',
                },
                {
                    title: 'Respeta el horario de la Ley 2300',
                    text: 'Para cobros y mensajes comerciales, lo que salga fuera de horario queda programado para el siguiente momento permitido.',
                    illustration: 'sms-hours',
                },
            ],
        },
        body: 'Usa **Enviar SMS** en la ficha, el botón **SMS** al seleccionar varios registros o la acción **Enviar SMS** en una automatización. En la agenda de citas también puedes mandar los recordatorios por SMS.',
        action: { label: 'Ver integraciones', href: '/settings?s=conectores' },
        audience: { roles: ['admin', 'manager', 'agent'] },
    },
    {
        key: 'v0.1.333-sitios-wordpress',
        version: '0.1.333',
        date: '2026-10-29',
        kind: 'feature',
        title: 'Tu sitio WordPress, en listas',
        summary:
            'Conecta tu WordPress con un clic y trae entradas, páginas, tipos de contenido y sus campos de ACF a listas que se mantienen al día solas.',
        media: {
            slides: [
                {
                    title: 'Conectar con un clic',
                    text: 'Escribe la dirección del sitio, apruebas la conexión en tu propio WordPress y vuelves conectado: nadie copia contraseñas.',
                    illustration: 'sitio-hero',
                },
                {
                    title: 'Eliges qué traer',
                    text: 'Cada tipo de contenido llega a su lista, con las columnas que elijas, en una carpeta con el nombre del sitio.',
                    illustration: 'sitio-columnas',
                },
                {
                    title: 'El sitio manda',
                    text: 'Cambia desde aquí sólo las columnas que habilites: el cambio viaja a WordPress. Las columnas propias nunca salen de la app.',
                    illustration: 'sitio-lock',
                },
            ],
        },
        body: 'Ve a **Ajustes → Integraciones**, toca **Conectar** en la tarjeta **WordPress** y después **Sincronizar sitio**. La edición en lote y deshacer también llegan al sitio.',
        action: { label: 'Conectar un sitio', href: '/settings?s=conectores' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.334-complemento-wordpress',
        version: '0.1.334',
        date: '2026-10-29',
        kind: 'feature',
        title: 'El SEO de tu WordPress, en una tabla',
        summary:
            'Con el complemento para WordPress llegan el SEO de cada página, todos los campos personalizados con su tipo y las imágenes con su texto alternativo, y cada cambio llega al instante.',
        media: {
            slides: [
                {
                    title: 'Un complemento, una sola vez',
                    text: 'Lo descargas desde la página del sitio y lo subes en Plugins. La lista suma el SEO, los campos de ACF, Meta Box y JetEngine y el texto alternativo.',
                    illustration: 'sitio-complemento',
                },
                {
                    title: 'Auditoría SEO con un botón',
                    text: 'Vistas para lo que no tiene descripción o tiene el título demasiado largo, y la IA propone la meta descripción. La aplicas en lote y se puede deshacer.',
                    illustration: 'sitio-seo',
                },
                {
                    title: 'Texto alternativo para tus imágenes',
                    text: 'La IA mira cada imagen sin texto alternativo y lo propone. También ves dónde se usa cada una y cuáles pesan demasiado.',
                    illustration: 'sitio-alt',
                },
            ],
        },
        body: 'En la página de tu sitio, toca **Descargar el complemento** y súbelo en tu WordPress. Funciona con Rank Math, Yoast SEO, SEOPress y All in One SEO. Elige **Al instante** para que cada cambio llegue en segundos.',
        action: { label: 'Ir a Integraciones', href: '/settings?s=conectores' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.335-complemento-wordpress-seguro',
        version: '0.1.335',
        date: '2026-10-29',
        kind: 'improvement',
        title: 'El complemento para WordPress, más liviano y más seguro',
        summary:
            'La versión 1.1 del complemento no agrega ni una consulta a las páginas que ven tus visitantes, sólo avisa los cambios que importan y verifica sus actualizaciones antes de instalarlas.',
        media: {
            slides: [
                {
                    title: 'Tu sitio, igual de rápido',
                    text: 'Las páginas públicas no hacen ninguna consulta de más, y leer cientos de páginas o imágenes desde la app tarda menos de un segundo.',
                    illustration: 'sitio-complemento',
                },
                {
                    title: 'Sólo los avisos que importan',
                    text: 'Un contador de visitas o un plugin que guarda datos a cada rato ya no genera avisos: llegan sólo los cambios de las columnas que traes.',
                    illustration: 'sitio-hero',
                },
                {
                    title: 'Un Editor alcanza',
                    text: 'Conecta un usuario con el rol Editor creado sólo para la app, también para el modo «Al instante». El complemento respeta sus permisos campo por campo.',
                    illustration: 'sitio-lock',
                },
            ],
        },
        body: 'WordPress te ofrece la actualización del complemento en **Plugins**, como cualquier otra. Si tu sitio tiene **Wordfence**, la app te dice cómo dejar activas las contraseñas de aplicación sin apagar el resto de su protección.',
        action: { label: 'Ir a Integraciones', href: '/settings?s=conectores' },
        audience: { roles: ['admin'] },
    },
    {
        key: 'v0.1.336-lo-borrado-y-lo-nuevo',
        version: '0.1.336',
        date: '2026-10-29',
        kind: 'feature',
        title: 'Lo que borras en tu sitio o tu tienda ya no estorba',
        summary:
            'Lo que se borró en WordPress o en WooCommerce se quita de la app con un toque (o solo) y deja de contar para tu plan. Y si en tu sitio aparece un campo o un tipo de contenido nuevo, la app te avisa para traerlo.',
        media: {
            slides: [
                {
                    title: 'Quítalo de la app',
                    text: 'La lista cuenta lo que ya se borró allá. Con «Quitarlos de la app» sale de la lista, va a la papelera 30 días y deja de contar para tu plan.',
                    illustration: 'fuente-borrado',
                },
                {
                    title: 'O que salga solo',
                    text: 'En la página del sitio o de la tienda elige «Quitarlo de la app»: lo que se borre allá sale solo. Si lo restauran, vuelve el mismo registro.',
                    illustration: 'tienda-borrado',
                },
                {
                    title: 'Lo nuevo de tu sitio',
                    text: 'Un campo de ACF o un tipo de contenido nuevo aparece en «Novedades en tu sitio». Con «Traer», la columna llega llena con lo que tiene el sitio.',
                    illustration: 'sitio-novedades',
                },
            ],
        },
        body: 'Abre una lista que viene de tu sitio o de tu tienda: si algo ya se borró allá, verás la barra **Quitarlos de la app**. Las novedades del sitio aparecen en su página, en **Ajustes → Integraciones**.',
        action: { label: 'Ir a Integraciones', href: '/settings?s=conectores' },
        audience: { roles: ['admin', 'manager'] },
    },
    {
        key: 'v0.1.339-lista-desde-archivo',
        version: '0.1.339',
        date: '2026-10-31',
        kind: 'feature',
        title: 'Sube tu Excel y la lista se arma sola',
        summary:
            'Desde «Nueva lista → Desde un archivo», sube un Excel o un CSV: cada columna queda con el tipo que le corresponde, lo repetido pasa a su propia lista vinculada y al final te recomienda vistas, un tablero y automatizaciones.',
        media: {
            slides: [
                {
                    title: 'Cada columna, con su tipo',
                    text: 'Fechas, montos, teléfonos, correos y opciones con color, según los datos y no sólo el nombre. Te dice por qué, cómo van a quedar los valores y qué columnas conviene descartar.',
                    illustration: 'archivo-a-lista',
                },
                {
                    title: 'Lo repetido, en su lista',
                    text: 'Si el cliente se repite con su correo y su teléfono, te propone una lista de Clientes aparte, vinculada. Un Excel con varias hojas se convierte en varias listas conectadas.',
                    illustration: 'archivo-a-lista',
                },
                {
                    title: 'La IA lo afina, si quieres',
                    text: 'Con «Mejorar con IA» junta opciones escritas distinto y aclara los nombres. Sólo viaja un resumen: los correos, teléfonos, documentos y nombres van ocultos.',
                    illustration: 'ia-campo',
                },
                {
                    title: 'Y te recomienda el siguiente paso',
                    text: 'Un tablero por estado, un calendario, un tablero con tus números y automatizaciones para tus datos. Nada se crea solo: apruebas lo que te sirva.',
                    illustration: 'archivo-recomendaciones',
                },
            ],
        },
        body: 'Toca **Nueva lista** y elige **Desde un archivo**. Si tu plan no alcanza para todos los registros del archivo, te avisa antes de crear nada.',
        action: { label: 'Crear desde un archivo', href: '/lists/new/file' },
        audience: { roles: ['admin', 'manager'] },
    },
    {
        key: 'v0.1.340-duplicar-un-clic',
        version: '0.1.340',
        date: '2026-10-31',
        kind: 'improvement',
        title: 'Duplicar un registro es un solo clic',
        summary:
            'Ya no hay pasos ni ventanas que aceptar: la copia se crea al instante y un aviso que se cierra solo te dice cómo salió, con «Deshacer» por si te equivocaste.',
        media: { illustration: 'duplicar-rapido' },
        body: 'Haz clic derecho sobre una fila y elige **Duplicar**, o marca varias filas y toca **Duplicar** en la barra de abajo. Si el registro tiene subtareas, el menú te deja elegir **con** o **sin** ellas. Si algo no se pudo copiar, el aviso lo dice en rojo con el motivo.',
        action: { label: 'Ir a mis listas', href: '/lists' },
        audience: { roles: ['admin', 'manager', 'agent'] },
    },
    {
        key: 'v0.1.341-sugerencias-por-lista',
        version: '0.1.341',
        date: '2026-10-31',
        kind: 'feature',
        title: 'Sugerencias para cada lista, con tus propios datos',
        summary:
            'El botón «Sugerencias» de la cabecera te dice qué conviene armar en esa lista y por qué: vistas, un tablero, avisos de vencidos o repetidos. Y con «Analizar con IA» suma ideas propias cuando tú lo pides.',
        media: {
            slides: [
                {
                    title: 'Ideas que salen de tu lista',
                    text: 'Un tablero por estado si tus registros tienen etapas, un calendario si hay fechas, una vista de vencidos, un tablero con tus números. Cada una dice por qué con tus datos.',
                    illustration: 'sugerencias-lista',
                },
                {
                    title: 'Un clic y queda armado',
                    text: 'Toca el botón de la sugerencia y se crea al instante. Lo que no te sirve lo descartas con la X y no vuelve a aparecer.',
                    illustration: 'archivo-recomendaciones',
                },
                {
                    title: 'La IA, sólo cuando la pides',
                    text: 'Con «Analizar con IA» llegan hasta 6 ideas para tu negocio. Lee un resumen de la lista y, sólo si lo eliges, algunos ejemplos de texto con los datos personales tapados. Tu empresa tiene 5 análisis por mes.',
                    illustration: 'ia-campo',
                },
            ],
        },
        body: 'Abre una lista y toca **Sugerencias** en la cabecera. Si no quieres el aviso, desmárcalo al pie del panel; el administrador puede dejarlas sin IA o apagarlas para toda la empresa.',
        action: { label: 'Ir a mis listas', href: '/lists' },
        audience: { roles: ['admin', 'manager'] },
    },
    {
        key: 'v0.1.342-navegacion-celular',
        version: '0.1.342',
        date: '2026-11-02',
        kind: 'improvement',
        title: 'En el celular, todo a un toque desde la barra de abajo',
        summary:
            'En el teléfono y en la app instalada ya no hay menú escondido: abajo tienes Listas, Mi trabajo, Buscar, Avisos y Más, como en las apps. Ajustes y Plataforma se ven como una lista ordenada por tema.',
        media: {
            slides: [
                {
                    title: 'Una barra fija, al alcance del pulgar',
                    text: 'Listas, Mi trabajo, Buscar, Avisos con el número de los que no has leído, y Más. La pestaña en la que estás se ve resaltada; tocarla otra vez te sube al principio.',
                    illustration: 'celular-pestanas',
                },
                {
                    title: 'Tus avisos, a pantalla completa',
                    text: 'Menciones, asignaciones, recordatorios y aprobaciones en su propia pestaña, con «Sin leer» y «Marcar todo leído».',
                    illustration: 'dia-campana',
                },
                {
                    title: 'Todo lo demás, en «Más»',
                    text: 'Tu cuenta, cambiar de empresa, Favoritos, Tableros, Aprende, Ajustes, el tema claro u oscuro, instalar la app, la ayuda y cerrar sesión.',
                    illustration: 'cuenta-menu',
                },
                {
                    title: 'Ajustes sin listas desplegables',
                    text: 'Las secciones se ven como una lista por tema: Empresa, Personas, Conexiones, Clientes, Mantenimiento y Cuenta. Dentro de una, «‹ Ajustes» te devuelve.',
                    illustration: 'pp-menu',
                },
            ],
        },
        body: 'Abre la app en tu teléfono. Si perteneces a más de una empresa, toca su nombre en la barra de arriba para cambiar. En el computador todo sigue igual: el menú de la izquierda, ahora con Ajustes ordenado por tema.',
        action: { label: 'Ver cómo funciona', href: '/lists', tour: 'welcome' },
    },
    {
        key: 'v0.1.344-qr-etiquetas',
        version: '0.1.344',
        date: '2026-11-02',
        kind: 'feature',
        title: 'Cada registro tiene su código QR: imprime etiquetas y mándalo por correo',
        summary:
            'Imprime etiquetas con el QR de tus productos, equipos o carpetas y pégalas: al escanearlas con la app se abre su ficha. El QR de cada registro también viaja en correos, WhatsApp y PDF.',
        media: {
            slides: [
                {
                    title: 'Etiquetas listas para imprimir',
                    text: 'Marca los registros y toca «Etiquetas». Hojas Carta o A4 de las medidas comunes, o el rollo de una impresora térmica, con el nombre y hasta dos datos debajo del QR.',
                    illustration: 'etiquetas-qr',
                },
                {
                    title: 'Escanea y se abre la ficha',
                    text: 'Con el escáner de la lista o de la búsqueda, cada etiqueta abre su registro. La primera vez que lo abres, el escáner te explica cómo funciona.',
                    illustration: 'dia-escaner',
                },
                {
                    title: 'El QR en tus mensajes',
                    text: 'En un correo de una automatización, el bloque Imagen con «Usar el código QR del registro»: cada invitado recibe su entrada con su propio QR.',
                    illustration: 'correo-editor',
                },
            ],
        },
        body: 'El QR de un registro está en el ícono **Código QR** de su ficha. Para muchos, márcalos en la tabla y toca **Etiquetas**. En las automatizaciones tienes **{{registro.qr}}** (la imagen del QR) y **{{registro.enlace}}** (el enlace a la ficha).',
        action: { label: 'Ir a mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.346-barra-abajo-oscura',
        version: '0.1.346',
        date: '2026-11-02',
        kind: 'fix',
        title: 'Sin franja blanca abajo en modo oscuro',
        summary:
            'En Android, la barra de abajo de la app instalada ya no queda blanca cuando el teléfono está en modo oscuro: sigue el modo del teléfono.',
        media: { illustration: 'celular-pestanas' },
        body: 'Si ya tenías la app instalada, el teléfono la actualiza solo en uno o dos días. Para verlo ya, quita la app y vuelve a instalarla desde **Más → Instalar la app**.',
    },
    {
        key: 'v0.1.347-barra-personalizable',
        version: '0.1.347',
        date: '2026-11-03',
        kind: 'feature',
        title: 'Arma tu barra de abajo en el celular',
        summary:
            'Elige cuántos botones tiene la barra de abajo del celular y de la app instalada, y cuáles: Tableros en vez de Mi trabajo, una lista o un tablero que abres a diario, Escanear… Lo que quites sigue en «Más».',
        media: {
            slides: [
                {
                    title: 'Los botones que más usas',
                    text: 'Cambia uno por otro: secciones como Tableros, Favoritos o Aprende, acciones como Buscar, Escanear o el Asistente, o una lista o un tablero puntual que se abre con un toque.',
                    illustration: 'barra-personalizable',
                },
                {
                    title: 'De 3 a 6 botones',
                    text: 'Elige la cantidad, ordénalos y decide si se ven los nombres debajo de los íconos. «Más» va siempre al final, con todo lo que no pusiste en la barra.',
                    illustration: 'celular-pestanas',
                },
            ],
        },
        body: 'En el celular toca **Más → Barra de abajo**; desde el computador, **Ajustes → Cuenta → Apariencia**. Se guarda en tu cuenta: la ves igual en todos tus teléfonos. Si administras la empresa, puedes dejar tu barra como la del equipo.',
        action: { label: 'Armar mi barra', href: '/menu/barra' },
    },
    {
        key: 'v0.1.348-microsoft-teams',
        version: '0.1.348',
        date: '2026-11-03',
        kind: 'feature',
        title: 'Avisos en Microsoft Teams',
        summary:
            'Conecta Microsoft Teams y tus automatizaciones avisan en un canal o le escriben directo a una persona. Y los eventos de Outlook ya pueden llevar la reunión de Teams.',
        media: {
            slides: [
                {
                    title: 'Un canal o una persona',
                    text: 'Elige el canal de una lista con «Elegir canal», o escríbele directo al responsable del registro con su correo de trabajo.',
                    illustration: 'integ-connect-once',
                },
                {
                    title: 'Reuniones con enlace',
                    text: '«Crear evento en Outlook» puede agregar la reunión de Teams, y «Crear evento en Google Calendar» la videollamada de Meet: el enlace les llega a los invitados.',
                    illustration: 'vistas-calendario',
                },
            ],
        },
        body: 'Ve a **Ajustes → Integraciones**, conecta **Microsoft Teams** con tu cuenta de trabajo de Microsoft 365 y úsala en **Añadir acción** de cualquier automatización.',
        action: { label: 'Ir a Integraciones', href: '/settings?s=conectores' },
    },
    {
        key: 'v0.1.349-agenda-reglas',
        version: '0.1.349',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Una agenda de citas mucho más completa',
        summary:
            'Citas grupales con cupos, varias duraciones por servicio, festivos de tu país, vacaciones, asesores con foto y cargo, y topes por semana, por mes y por cliente.',
        media: {
            slides: [
                {
                    title: 'Grupales y con varias duraciones',
                    text: 'Una clase con 10 cupos que se ven bajar con cada reserva, o una consulta de 30 minutos o de una hora: el cliente elige. Cada servicio puede tener su propio horario y sus propias reglas.',
                    illustration: 'citas-cupos',
                },
                {
                    title: 'Festivos de tu país y vacaciones',
                    text: 'Elige el país y sus festivos oficiales se cierran solos cada año. Marca los que sí atiendes y cierra una semana de vacaciones de una vez.',
                    illustration: 'citas-festivos',
                },
                {
                    title: 'Quién atiende, con su foto',
                    text: 'El cliente ve la foto, el cargo y una descripción de cada asesor. Y tú eliges cómo se reparten las citas: por turno, equilibrando la carga o por prioridad.',
                    illustration: 'citas-roundrobin',
                },
            ],
        },
        body: 'Abre **Configurar lista → Agenda** y edita tu agenda. En **Reglas** también puedes limitar cuántas citas pendientes tiene un mismo cliente o abrir la agenda sólo entre dos fechas.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.350-agenda-calendarios',
        version: '0.1.350',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Tu calendario en la agenda, con Meet o Teams en cada cita',
        summary:
            'Cada persona conecta su Google Calendar u Outlook: la agenda no ofrece lo ocupado, las citas llegan con su enlace de Meet o Teams, y si las mueves o borras en tu calendario, se mueven o se cancelan solas.',
        media: {
            slides: [
                {
                    title: 'Mi calendario',
                    text: 'En Ajustes → Cuenta → Mi calendario conectas tu propia cuenta y eliges en cuáles calendarios se mira lo ocupado y en cuál se crean tus citas. Nadie más lo ve.',
                    illustration: 'citas-calendario-sync',
                },
                {
                    title: 'Videollamada en cada cita',
                    text: 'Elige «Dónde es → Videollamada» en el servicio: cada cita lleva su enlace de Google Meet o Microsoft Teams, que le llega al cliente en la confirmación. También hay en persona, por teléfono o con un enlace fijo.',
                    illustration: 'citas-email',
                },
                {
                    title: 'Los cambios van y vuelven',
                    text: 'Si arrastras una cita a otra hora en tu calendario, o la borras, la agenda la mueve o la cancela y le avisa al cliente.',
                    illustration: 'citas-reschedule',
                },
            ],
        },
        body: 'Conecta tu calendario en **Ajustes → Cuenta → Mi calendario**. Para la videollamada, abre **Configurar lista → Agenda** y en cada servicio elige **Dónde es**.',
        action: { label: 'Conectar mi calendario', href: '/settings?s=calendario' },
    },
    {
        key: 'v0.1.351-formularios-diseno',
        version: '0.1.351',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Formularios con tu diseño: plantillas, colores, fuentes y tamaños',
        summary:
            '13 plantillas de diseño, colores, 19 tipografías, tamaños, bordes y esquinas de todo, fondo con imagen o degradado, portada, modo oscuro, opciones como tarjetas con foto y tus propios temas para toda la empresa.',
        media: {
            slides: [
                {
                    title: 'Una plantilla en un clic',
                    text: 'En la pestaña Diseño del constructor eliges entre 13 plantillas —clásica, minimalista, oscura, píldoras, elegante…— que toman el color de tu marca. Después retocas lo que quieras.',
                    illustration: 'form-design',
                },
                {
                    title: 'Controla cada detalle',
                    text: 'Colores, tipografía de títulos y textos, tamaños, ancho de la página, esquinas, bordes y sombras de la tarjeta, los campos, las opciones y el botón. También fondo con imagen o degradado, portada y modo oscuro.',
                    illustration: 'form-builder',
                },
                {
                    title: 'Preguntas que se ven mejor',
                    text: 'Pon dos preguntas lado a lado, muestra las opciones como botones o como tarjetas con una foto cada una, y agrega imágenes entre las preguntas.',
                    illustration: 'form-conditional',
                },
                {
                    title: 'Tus temas, para todos los formularios',
                    text: 'Guarda un diseño en «Mis temas» y úsalo en cualquier formulario de la empresa. Si marcas uno como predeterminado, los formularios nuevos nacen con él.',
                    illustration: 'form-embed',
                },
            ],
        },
        body: 'Abre **Configurar lista → Formularios**, edita un formulario y toca la pestaña **Diseño**. Los formularios que ya tenías se siguen viendo igual hasta que elijas otro diseño.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.352-insertar-en-tu-sitio',
        version: '0.1.352',
        date: '2026-11-04',
        kind: 'improvement',
        title: 'Formularios y agenda en tu sitio: ventana, botón flotante y más rápidos',
        summary:
            'Al insertar un formulario o la agenda en tu web ahora eliges cómo se ve: dentro de la página, en una ventana que se abre con un botón o con un botón flotante en la esquina. Y aguantan muchas visitas a la vez sin ponerse lentos.',
        media: {
            slides: [
                {
                    title: 'Un botón que abre el formulario',
                    text: 'Con «Ventana al hacer clic» o «Botón flotante», el formulario o la agenda se abre sobre tu página cuando alguien toca el botón. Eliges el texto, el color y la esquina.',
                    illustration: 'embed-popup',
                },
                {
                    title: 'No se carga hasta que lo usan',
                    text: 'La mayoría de las visitas mira tu página y nunca abre el formulario: con la ventana o el botón flotante, ni lo pide. Lo más liviano para un sitio con mucho tráfico.',
                    illustration: 'form-embed',
                },
                {
                    title: 'Más rápido para todos',
                    text: 'La página del formulario y los horarios de la agenda se preparan una vez y se reusan unos segundos para todos los visitantes, así cargan al instante aunque lleguen muchos a la vez.',
                    illustration: 'citas-embed',
                },
            ],
        },
        body: 'Publica el formulario o la agenda y, en **Compartir → Insertar en tu sitio**, elige **En la página**, **Ventana al hacer clic** o **Botón flotante**. Los códigos que ya pegaste siguen funcionando igual.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.353-aprobar-citas',
        version: '0.1.353',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Aprueba las citas antes de confirmarlas y frena las reservas falsas',
        summary:
            'Cada cita de la agenda puede esperar la aprobación de alguien del equipo (todas o sólo la primera de cada cliente). Se aprueba o se rechaza desde la ficha del registro, y el cliente puede confirmar su correo con un código.',
        media: {
            slides: [
                {
                    title: 'Por confirmar, con el horario apartado',
                    text: 'Con la aprobación encendida, cada reserva queda «Por confirmar» y nadie más puede tomar ese horario. Al cliente le llega un correo «Recibimos tu solicitud».',
                    illustration: 'citas-aprobacion',
                },
                {
                    title: 'Aprueba o rechaza desde la ficha',
                    text: 'A quien aprueba le llega un aviso. En la ficha toca Aprobar —la cita llega al calendario con su videollamada y el cliente recibe la confirmación— o Rechazar con un motivo.',
                    illustration: 'citas-email',
                },
                {
                    title: 'Sin reservas falsas',
                    text: 'Pide que el cliente confirme su correo con un código de 6 números y no aceptes correos temporales. Además, un mismo correo no puede pedir citas sin parar.',
                    illustration: 'citas-hero',
                },
            ],
        },
        body: 'En **Configurar lista → Agenda → Editar**, abre **Aprobación y seguridad**. Elige si las citas se aprueban, quién decide y en cuánto tiempo. Cada servicio puede tener su propia regla.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.354-agenda-diseno',
        version: '0.1.354',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Tu agenda de citas, con tu diseño',
        summary:
            'La página donde tus clientes agendan ya se diseña como los formularios: plantillas, colores, tipografía, tamaños, portada y fondo. Además eliges qué se muestra (precios, fotos, lugar) y cómo se acomodan el calendario y los horarios.',
        media: {
            slides: [
                {
                    title: 'Plantillas listas',
                    text: 'Elige Clásico, Tarjetas, Oscuro, Píldoras, Con portada y más: toman el color de tu marca y lo ves al instante en la vista previa.',
                    illustration: 'agenda-diseno',
                },
                {
                    title: 'Muestra sólo lo que quieres',
                    text: 'Oculta los precios, las fotos o el lugar; pon el calendario al lado o arriba de los horarios, y los horarios en cuadrícula o en lista.',
                    illustration: 'citas-slots',
                },
                {
                    title: 'Un mismo estilo en todas tus páginas',
                    text: 'Guarda el diseño en «Mis temas» y úsalo en tus formularios y en tus otras agendas. También vale para la página donde el cliente cambia o cancela su cita.',
                    illustration: 'form-design',
                },
            ],
        },
        body: 'En **Configurar lista → Agenda → Editar**, abre **Diseño**. Las agendas que ya tenías siguen con su diseño de siempre hasta que elijas otro.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.355-formas-de-preguntar',
        version: '0.1.355',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Escalas, Sí o No, firma, matriz y más formas de preguntar',
        summary:
            'Tus formularios ya pueden preguntar con una escala del 0 al 10, un deslizador, botones Sí y No, una firma con el dedo, una lista con buscador u ordenar opciones. También hay «Otro» con espacio para escribir y una matriz para calificar varios aspectos a la vez.',
        media: {
            slides: [
                {
                    title: 'La escala, el deslizador y Sí o No',
                    text: 'Un número puede preguntarse como una escala del 0 al 10 (como el NPS) o un deslizador; una casilla, con dos botones grandes. Todo se cambia en «Cómo se pregunta».',
                    illustration: 'form-question-types',
                },
                {
                    title: 'Una matriz en vez de cinco preguntas',
                    text: 'Califica atención, rapidez y limpieza en una sola tabla. Cada fila guarda su respuesta en su propio campo, lista para filtrar y promediar.',
                    illustration: 'form-builder',
                },
                {
                    title: 'Firma, ordenar y «Otro»',
                    text: 'Pide una firma con el dedo, deja ordenar las prioridades de la más a la menos importante y agrega «Otro» con un espacio para escribir cuál.',
                    illustration: 'form-conditional',
                },
            ],
        },
        body: 'En **Configurar lista → Formularios → Editar**, toca una pregunta y elige **Cómo se pregunta**. La matriz está en la pestaña **Agregar**.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.356-logica-formularios',
        version: '0.1.356',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Formularios que se adaptan a cada persona',
        summary:
            'Salta las páginas que no le corresponden a cada persona, termina con un mensaje distinto según lo que respondió y salúdala por su nombre: «Gracias, {{nombre}}». Las condiciones ahora pueden tener varias reglas a la vez.',
        media: {
            slides: [
                {
                    title: 'Saltos entre páginas',
                    text: 'Si elige «Persona», pasa directo a la última página sin ver «Datos de la empresa». Lo que no le corresponde no se pide ni se guarda.',
                    illustration: 'form-logic',
                },
                {
                    title: 'Una pantalla final para cada caso',
                    text: 'A la empresa grande le dices «Te llamamos hoy»; al resto, «Te enviamos la cotización». Cada pantalla puede llevar a otra página.',
                    illustration: 'form-pages',
                },
                {
                    title: 'Todas o alguna',
                    text: 'Una pregunta, un salto o una pantalla final pueden depender de varias respuestas: que se cumplan todas o alguna.',
                    illustration: 'form-conditional',
                },
            ],
        },
        body: 'En **Configurar lista → Formularios → Editar**, abre la pestaña **Lógica**. Para recordar una respuesta, escribe su nombre entre llaves o usa **Agregar una respuesta** debajo de cada texto.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
    {
        key: 'v0.1.357-puntaje-conversacional',
        version: '0.1.357',
        date: '2026-11-04',
        kind: 'feature',
        title: 'Tests con puntaje y formularios de una pregunta por pantalla',
        summary:
            'Suma puntos según lo que responde cada persona y muéstrale el resultado: «Sacaste 8 puntos». Haz que pregunte de a una pregunta por pantalla, como una conversación, y recibe a cada persona con una bienvenida.',
        media: {
            slides: [
                {
                    title: 'Puntaje',
                    text: 'Cada respuesta suma sus puntos. Muestra el resultado al final, elige con él la pantalla final o el salto, y guárdalo en la lista.',
                    illustration: 'form-score',
                },
                {
                    title: 'Una pregunta por pantalla',
                    text: 'Al elegir una opción pasa sola a la siguiente, con el avance arriba. Ideal para responder desde el celular.',
                    illustration: 'form-conversational',
                },
                {
                    title: 'Una bienvenida',
                    text: 'Un título, un mensaje, una imagen y «Toma unos 2 minutos» antes de la primera pregunta.',
                    illustration: 'form-design',
                },
            ],
        },
        body: 'En **Configurar lista → Formularios → Editar**: el puntaje está en **Lógica → Cálculos y puntaje**; una pregunta por pantalla y la bienvenida, en los ajustes del formulario.',
        action: { label: 'Ver mis listas', href: '/lists' },
    },
];
