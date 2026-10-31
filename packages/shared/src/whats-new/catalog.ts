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
];
