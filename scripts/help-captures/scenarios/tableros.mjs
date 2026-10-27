/**
 * Capturas del módulo «Tableros» del centro de aprendizaje.
 *
 * Trabajan sobre el tablero «Ventas» que trae la plantilla del pipeline (la
 * empresa de ejemplo lo tiene) y dejan todo como estaba: el tablero que se
 * crea desde la plantilla se borra al final, el widget que se agrega se quita,
 * el enlace público se despublica y el período vuelve a «Cada widget con su
 * período».
 */

/** Id de un tablero por nombre. */
async function dashboardId(api, name) {
    const res = await api.get('/dashboards');
    const list = Array.isArray(res) ? res : (res?.data ?? []);
    const d = list.find((x) => x.name === name);
    if (!d) throw new Error(`no existe el tablero «${name}» en la empresa de ejemplo`);
    return d.id;
}

/** Abre el tablero «Ventas» y espera a que sus widgets terminen de calcular. */
async function openVentas(ctx) {
    const { page, api, base, sleep } = ctx;
    ctx.ventasId = await dashboardId(api, 'Ventas');
    await page.goto(`${base}/#/dashboards/${ctx.ventasId}`);
    await page.locator('[data-tour="dashboard-add-widget"]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('[data-widget-card]').first().waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Cargando'), null, { timeout: 30000 }).catch(() => {});
    // El período del tablero se recuerda en el navegador: volver al de cada widget.
    const period = page.locator('[data-tour="dashboard-period"]');
    if ((await period.inputValue().catch(() => '')) !== '') {
        await period.selectOption('');
        await sleep(1500);
    }
    await sleep(2500);
}

/** Abre y cierra el formulario de widget una vez (en desarrollo, su código tarda en cargar la primera vez). */
async function warmWidgetDialog({ page, sleep }) {
    await page.locator('[data-tour="dashboard-add-widget"]').first().click();
    await page.locator('#w-title').waitFor({ state: 'visible', timeout: 90000 });
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(1200);
}

const dialog = '[role="dialog"]';

/** DELETE sin cuerpo (la API rechaza un DELETE con «content-type» y sin cuerpo). */
async function del({ page, base, tenantId }, url) {
    await page.request.fetch(`${base}/api/v1${url}`, { method: 'DELETE', headers: { 'x-tenant-id': String(tenantId) } }).catch(() => {});
}

export default [
    {
        key: 'tab-plantilla',
        title: 'Crear un tablero desde una plantilla',
        steps: [
            { go: '/dashboards', wait: '[data-tour="dashboard-card"]' },
            { click: '[data-tour="dashboards-new"]', caption: 'En «Tableros» están todos tus dashboards. Para crear uno, toca «Nuevo dashboard».', then: dialog },
            { wait: 1500 },
            { click: `${dialog} button:has-text("Embudo de ventas")`, caption: 'Elige la plantilla «Embudo de ventas». A la derecha ves qué widgets trae.' },
            { hover: `${dialog} select[aria-label="Lista"]`, caption: 'En «Sobre qué lista», elige tu lista de oportunidades.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator(`${dialog} select[aria-label="Lista"]`).first().selectOption({ label: 'Oportunidades' });
                    await page.locator('#map-main-responsable').waitFor({ state: 'attached', timeout: 20000 });
                    await sleep(1500);
                    await page.locator('#map-main-responsable').scrollIntoViewIfNeeded();
                    await sleep(500);
                },
            },
            { shot: `${dialog} aside fieldset`, caption: 'La app sugiere qué campo es la etapa, el monto, la fecha de cierre y el responsable. Revísalos y ponle nombre.' },
            { click: `${dialog} button:has-text("Crear dashboard")`, caption: 'Toca «Crear dashboard».', then: '[data-tour="dashboard-add-widget"]' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-widget-card]').first().waitFor({ state: 'visible', timeout: 30000 });
                    await sleep(5000);
                },
            },
            { shot: true, caption: 'Listo: el tablero nace con todos sus widgets, calculados con tus datos.' },
            {
                run: async (ctx) => {
                    const m = /#\/dashboards\/(\d+)/.exec(ctx.page.url());
                    if (m) await del(ctx, `/dashboards/${m[1]}`);
                },
            },
        ],
    },
    {
        key: 'tab-widget',
        title: 'Agregar un widget',
        steps: [
            { run: openVentas },
            { run: warmWidgetDialog },
            { click: '[data-tour="dashboard-add-widget"]', caption: 'En el tablero, toca «Añadir widget».', then: '#w-title' },
            { fill: '#w-title', text: 'Monto por responsable', caption: 'Escribe un título que diga qué muestra.' },
            { hover: '#w-type', caption: 'Elige el tipo: «Gráfico de barras».' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('#w-type').selectOption('chart_bar');
                    await sleep(400);
                    await page.locator('#w-list').selectOption({ label: 'Oportunidades' });
                    await sleep(1500);
                },
            },
            { hover: '#w-metric-field', caption: 'Elige qué medir: el campo «Monto». El cálculo pasa solo a «Suma».' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('#w-metric-field').selectOption({ label: 'Monto' });
                    await sleep(400);
                    await page.locator(`${dialog} div:has(> label:text-is("Agrupar por")) select`).first().selectOption({ label: 'Responsable' });
                    await sleep(3500);
                },
            },
            { shot: '[data-testid="imcrm-widget-preview"]', caption: 'Agrupado por «Responsable»: la vista previa muestra el resultado con tus datos antes de guardar.' },
            { click: `${dialog} button:has-text("Añadir widget")`, caption: 'Toca «Añadir widget»: aparece al final del tablero y lo mueves donde quieras.' },
            { wait: 2500 },
            {
                run: async ({ api, ventasId }) => {
                    // Deja el tablero como estaba.
                    const d = await api.get(`/dashboards/${ventasId}`);
                    const dash = d?.data ?? d;
                    const widgets = (dash.widgets ?? []).filter((w) => w.title !== 'Monto por responsable');
                    if (widgets.length !== (dash.widgets ?? []).length) await api.patch(`/dashboards/${ventasId}`, { widgets });
                },
            },
        ],
    },
    {
        key: 'tab-diseno',
        title: 'Editar un widget y la página',
        steps: [
            { run: openVentas },
            { click: '[data-widget-card] [aria-label="Editar widget"] >> nth=1', caption: 'Pasa el mouse por un widget y toca el lápiz para editarlo.', then: '#w-title' },
            { wait: 1200 },
            { click: `${dialog} summary:has-text("Diseño")`, caption: 'Abajo, abre «Diseño» para cambiar cómo se ve su tarjeta.' },
            { shot: `${dialog} details[open]`, caption: 'Elige un preset o ajusta fondo, color de texto, borde, relleno, esquinas, sombra y letra.' },
            { press: 'Escape' },
            { click: 'button:has-text("Página")', caption: 'Con «Página» cambias el fondo, el ancho y la tipografía de todo el tablero.' },
            { shot: 'div:has(> button:has-text("Página")) >> div.imcrm-w-72', caption: 'Un fondo gris claro, por ejemplo, hace que las tarjetas resalten.' },
            { press: 'Escape' },
        ],
    },
    {
        key: 'tab-filtros',
        title: 'Cambiar el período de todo el tablero',
        steps: [
            { run: openVentas },
            { hover: '[data-tour="dashboard-period"]', caption: 'Arriba del tablero está el período. Por defecto, cada widget usa el suyo.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-tour="dashboard-period"]').selectOption('this_year');
                    await sleep(5000);
                },
            },
            { shot: true, caption: 'Con «Este año», todos los widgets que tienen fecha se recalculan para el año. A los demás no les cambia nada.' },
            { click: '[data-testid="imcrm-dashboard-more"]', caption: 'En «⋯» están la configuración, los filtros del tablero, guardar como plantilla y eliminar.', then: '[role="menu"]' },
            { shot: '[role="menu"]', caption: '«Filtros del tablero» deja un selector arriba (por ejemplo, Responsable: yo) para que cada uno vea lo suyo.' },
            { press: 'Escape' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-tour="dashboard-period"]').selectOption('');
                    await sleep(800);
                },
            },
        ],
    },
    {
        key: 'tab-enlace',
        title: 'Publicar un enlace del tablero',
        steps: [
            { run: openVentas },
            { click: '[data-tour="dashboard-share"]', caption: 'Toca «Compartir».', then: dialog },
            { wait: 1500 },
            { click: '[data-testid="imcrm-public-link-publish"]', caption: 'En «Enlace público», toca «Publicar enlace».', then: '[data-testid="imcrm-public-link-url"]' },
            { wait: 1200 },
            { shot: dialog, caption: 'Ya tienes la dirección para copiar, la fecha en que vence, si quien mira puede cambiar el período, dónde se puede insertar y el código para tu sitio web.' },
            { click: `${dialog} button:has-text("Envío por correo")`, caption: 'En «Envío por correo» programas un resumen diario, semanal o mensual, con el PDF adjunto.' },
            { wait: 1200 },
            { shot: dialog, caption: 'Toca «Programar un envío», elige la frecuencia, la hora y quiénes lo reciben.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator(`${dialog} button:has-text("Enlace público")`).first().click();
                    await sleep(800);
                    const off = page.locator('[data-testid="imcrm-public-link-unpublish"]');
                    if (await off.count()) await off.first().click();
                    await sleep(1200);
                    await page.keyboard.press('Escape');
                },
            },
        ],
    },
];
