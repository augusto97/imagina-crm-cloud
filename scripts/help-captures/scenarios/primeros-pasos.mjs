/**
 * Capturas del módulo «Primeros pasos» (centro de aprendizaje).
 * Corren sobre la empresa de ejemplo; lo que crean lo borran al final.
 */

/** DELETE sin cuerpo (el `api.del` del grabador manda content-type JSON y el servidor lo rechaza). */
async function del(ctx, url) {
    await ctx.page.request.fetch(`${ctx.base}/api/v1${url}`, { method: 'DELETE', headers: { 'x-tenant-id': String(ctx.tenantId) } });
}

async function deleteFolder(ctx, name) {
    const res = await ctx.api.get('/list-groups').catch(() => null);
    const groups = Array.isArray(res) ? res : (res?.data ?? []);
    for (const g of groups) if (g.name === name) await del(ctx, `/list-groups/${g.id}`).catch(() => {});
}

export default [
    {
        key: 'records-open',
        title: 'Abrir un registro',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-table"]', caption: 'Esta es la lista de clientes: cada fila es un registro y cada columna, un campo.' },
            { click: '[data-tour="records-table"] >> text=Clínica Norte', caption: 'Toca el nombre de un cliente para abrir su ficha.', then: '[data-tour="record-fields"]' },
            { shot: '[data-tour="record-fields"]', caption: 'En la ficha ves y cambias todos sus datos. A la derecha quedan los comentarios y la actividad.' },
            { click: '[aria-label="Registro siguiente (J o ↓)"]', caption: 'Con estas flechas (o las teclas J y K) pasas al siguiente registro sin cerrar la ficha.' },
            { shot: '[data-tour="record-title"]', caption: 'Ya estás en el siguiente cliente.' },
        ],
    },
    {
        key: 'pp-moverte',
        title: 'Moverte con el riel',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: '[data-tour="records-table"]', caption: 'A la izquierda está el riel con las secciones; al lado, el panel con tus listas.' },
            { click: '[data-tour="rail-mywork"]', caption: 'Toca «Mi trabajo» en el riel.', then: 'h1' },
            { shot: '[data-tour="rail-mywork"]', caption: 'Mi trabajo reúne lo que tienes asignado en todas las listas, agrupado por vencimiento.' },
            { click: '[data-tour="rail-favorites"]', caption: 'Toca «Favoritos» para ver lo que anclaste.' },
            { shot: true, caption: 'Cada sección cambia el panel de al lado y el área de trabajo.' },
        ],
    },
    {
        key: 'pp-primeros-pasos',
        title: 'El panel de Primeros pasos',
        setup: async ({ api }) => {
            await api.patch('/onboarding', { hidden: false }).catch(() => {});
        },
        steps: [
            { go: '/lists', wait: '[data-tour="getting-started"]', caption: 'Abajo a la derecha está «Primeros pasos», con cuántos pasos llevas.' },
            { click: '[data-tour="getting-started"]', caption: 'Tócalo para ver la lista.', then: 'text=Ocultar primeros pasos' },
            { shot: '[aria-label="Primeros pasos"][role="dialog"], [aria-label="Primeros pasos"]', caption: 'Cada paso se marca solo cuando lo haces. «Hacerlo» te lleva al lugar y «Muéstrame» abre un recorrido.' },
            {
                run: async ({ api, page }) => {
                    await page.keyboard.press('Escape').catch(() => {});
                    await api.patch('/onboarding', { hidden: true }).catch(() => {});
                },
            },
        ],
    },
    {
        key: 'pp-buscar',
        title: 'Buscar con Ctrl+K',
        steps: [
            { go: '/lists/{list:Tareas}/records', wait: '[data-tour="records-table"]', caption: 'Desde cualquier pantalla, aprieta Ctrl K o toca el cuadro de búsqueda.' },
            { click: '[data-testid="topbar-search"]', caption: 'Toca «Buscar listas, registros, dashboards…».', then: 'input[placeholder="Buscar listas, registros, dashboards…"]' },
            { fill: 'input[placeholder="Buscar listas, registros, dashboards…"]', text: 'clínica', caption: 'Escribe al menos dos letras de lo que buscas.' },
            { wait: '[role="dialog"] >> text=Clínica Norte' },
            { wait: 800 },
            { shot: '[role="dialog"]', caption: 'Aparecen los registros de todas tus listas, más listas, tableros y guías. Elige con las flechas y abre con Enter.' },
        ],
    },
    {
        key: 'pp-carpeta',
        title: 'Crear una carpeta y mover una lista',
        setup: async (ctx) => {
            await deleteFolder(ctx, 'Finanzas');
        },
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="panel-lists"]', caption: 'En el panel, junto a «Espacio de trabajo», están los botones de nueva lista y nueva carpeta.' },
            { click: '[data-tour="panel-lists"] button[title="Nueva carpeta"]', caption: 'Toca «Nueva carpeta».', then: 'input[placeholder="Nombre de la carpeta"]' },
            { fill: 'input[placeholder="Nombre de la carpeta"]', text: 'Finanzas', caption: 'Escribe el nombre y aprieta Enter.' },
            { press: 'Enter' },
            { wait: '[data-testid="folder-header"]:has-text("Finanzas")' },
            {
                drag: ['[data-tour="panel-lists"] li:has(a[href*="/lists/facturas/"])', '[data-testid="folder-header"]:has-text("Finanzas")'],
                caption: 'Arrastra la lista «Facturas» y suéltala sobre la carpeta.',
            },
            { wait: 1200 },
            { shot: '[data-tour="panel-lists"]', caption: 'Listo: Facturas quedó dentro de Finanzas. El menú «···» de la carpeta tiene color, ícono y más.' },
            {
                run: async (ctx) => {
                    await deleteFolder(ctx, 'Finanzas');
                },
            },
        ],
    },
    {
        key: 'pp-atajos',
        title: 'Ver los atajos de teclado',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-table"]', caption: 'Con el cursor fuera de cualquier campo, aprieta la tecla ?.' },
            { press: '?', caption: 'Aparece la lista completa de atajos: generales, de la tabla y del calendario.' },
            { press: 'Escape' },
            { click: '[data-tour="topbar-user"]', caption: 'También están en el menú de tu cuenta, junto al modo oscuro.', then: '[data-testid="user-menu-theme"]' },
            { shot: '[role="menu"]', caption: 'Aquí cambias a modo oscuro, instalas la app, abres Primeros pasos y ves los atajos.' },
        ],
    },
    {
        key: 'pp-ayuda',
        title: 'Abrir la ayuda',
        steps: [
            { go: '/lists/{list:Facturas}/records', wait: '[data-tour="records-table"]', caption: 'El botón ? de la barra superior abre la ayuda sin salir de donde estás.' },
            { click: '[data-tour="topbar-help"]', caption: 'Toca el botón de Ayuda.', then: '[data-testid="help-start"]' },
            { shot: '[data-testid="help-start"]', caption: 'En «Empieza aquí» están el recorrido por la app, Primeros pasos, los atajos y las novedades.' },
            { fill: 'input[placeholder="¿Qué quieres hacer? Ej.: importar un Excel"]', text: 'importar', caption: 'O busca lo que quieres hacer.' },
            { wait: 800 },
            { shot: '[data-testid="help-results"]', caption: 'Te muestra las guías rápidas que coinciden; tócala para leerla sin salir de la pantalla.' },
        ],
    },
];
