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
];
