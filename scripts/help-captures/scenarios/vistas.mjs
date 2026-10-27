/**
 * Capturas del módulo «Vistas» del centro de aprendizaje.
 *
 * Todas trabajan sobre las listas que deja la plantilla de ventas
 * (Oportunidades, con sus vistas Pipeline, Tabla y Cierres) y la de
 * productos. Ninguna guarda nada: crear la vista se cancela antes de
 * guardar, y los filtros quedan como cambios sin guardar que se pierden al
 * cerrar la página.
 */

const TAB = (name) => `[data-testid="view-tab"]:has-text("${name}")`;

export default [
    {
        key: 'vistas-crear-vista',
        title: 'Crear una vista nueva',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: '[data-tour="records-views"]', caption: 'Arriba de la lista están las pestañas de las vistas guardadas: cada una muestra los mismos registros de otra forma.' },
            { click: '[data-tour="records-new-view"]', then: '[data-tour="view-create-name"]', caption: 'Toca el «+» al final de las pestañas para crear una vista nueva.' },
            { fill: '#view-name', text: 'Cierres de este mes', caption: 'Ponle un nombre que diga para qué sirve.' },
            { run: (ctx) => ctx.page.selectOption('#view-type', 'calendar') },
            { shot: '[data-tour="view-create-types"]', caption: 'Elige el tipo: lista, hoja de cálculo, kanban, calendario, tarjetas, Gantt o carga de trabajo. Según el tipo te pide el campo que necesita (aquí, el de fecha); toca «Guardar vista» para crearla.' },
        ],
    },
    {
        key: 'vistas-menu-pestana',
        title: 'El menú de una pestaña',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: '[data-testid="view-tab"]' },
            { click: TAB('Tabla'), right: true, then: '[data-testid="view-rename-item"]', caption: 'Haz clic derecho sobre una pestaña (o toca sus tres puntos) para abrir su menú.' },
            { wait: 500 },
            { shot: '[role="menu"]', caption: 'Desde aquí la marcas como favorita, copias su enlace, le cambias el nombre, la haces privada o protegida, la exportas o la duplicas.' },
            { hover: '[role="menuitem"]:has-text("Color e")', caption: 'Pasa por «Color e ícono».' },
            { wait: 700 },
            { shot: true, caption: 'Elige un color y un ícono para reconocer la pestaña de un vistazo.' },
        ],
    },
    {
        key: 'vistas-filtrar',
        title: 'Filtrar una vista',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: '[data-tour="records-filter"]' },
            { click: TAB('Tabla'), then: '[data-tour="records-table"]', caption: 'Abre la vista de tabla.' },
            { click: '[data-tour="records-filter"]', then: 'button:has-text("Agregar filtro")', caption: 'Toca «Filtrar» en la barra de la vista.' },
            { click: 'button:has-text("Agregar filtro")', caption: 'Toca «Agregar filtro».' },
            {
                run: async (ctx) => {
                    const field = ctx.page.locator('select:has(option:text-is("Campo"))').first();
                    await field.selectOption({ label: 'Monto' });
                    await ctx.sleep(300);
                    await field.locator('xpath=following-sibling::select[1]').selectOption('gt');
                    await ctx.sleep(300);
                    await field.locator('xpath=following-sibling::div[1]//input').first().fill('3000000');
                    await ctx.sleep(1500);
                },
            },
            { shot: true, caption: 'Elige el campo, la condición y el valor: aquí, las oportunidades de más de 3 millones. La tabla se filtra al instante; puedes sumar más filtros y combinarlos con «Y» u «O».' },
            { press: 'Escape', caption: 'Al cerrar el panel quedan solo esas oportunidades, y la pestaña avisa «Cambios sin guardar»: guárdalos en la vista o descártalos.' },
        ],
    },
    {
        key: 'vistas-panel-personalizar',
        title: 'Personalizar la vista',
        steps: [
            { go: '/lists/{list:Productos}/records', wait: '[data-tour="records-customize"]' },
            { click: '[data-tour="records-customize"]', then: '[role="dialog"]', caption: 'Toca el botón de los controles, a la derecha del buscador.' },
            { wait: 600 },
            { shot: '[role="dialog"]', caption: 'Arriba, la densidad y el tamaño de letra; después, qué se muestra: ajustar texto, hoja de cálculo, columnas fijas y colores de las filas.' },
            {
                run: async (ctx) => {
                    await ctx.page
                        .locator('[role="dialog"] >> text=Qué se ve y en qué orden')
                        .first()
                        .evaluate((el) => el.scrollIntoView({ block: 'start' }));
                    await ctx.sleep(500);
                },
            },
            { shot: '[role="dialog"]', caption: 'Más abajo: las columnas que se ven y en qué orden, el filtro, agrupar, y las acciones de la vista y de la lista.' },
        ],
    },
    {
        key: 'vistas-calendario-semana',
        title: 'El calendario por semana',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: '[data-testid="view-tab"]' },
            { click: TAB('Cierres'), caption: 'Abre la vista de calendario.' },
            { wait: 1500 },
            { shot: true, caption: 'El mes completo: cada registro va el día de su fecha y «+N más» abre los demás de ese día.' },
            { press: 's', caption: 'Con la tecla S (o el selector de arriba) pasas a la semana: cada registro con su hora, y se arrastra para cambiarla.' },
        ],
    },
];
