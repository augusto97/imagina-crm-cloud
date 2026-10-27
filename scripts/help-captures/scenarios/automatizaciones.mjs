/**
 * Capturas del módulo «Automatizaciones» del centro de aprendizaje.
 *
 * La automatización de ejemplo («Cobro de facturas vencidas», en Facturas) se
 * crea PAUSADA si no existe: así no choca con el tope de automatizaciones
 * activas del plan de prueba ni le manda nada a nadie. El editor recuerda el
 * modo Flujo/Lienzo en el navegador: la demo del lienzo lo deja otra vez en
 * Flujo al terminar.
 */

const DEMO_NAME = 'Cobro de facturas vencidas';

const demoAutomation = (facturas) => ({
    name: DEMO_NAME,
    description: 'Un día después del vencimiento avisa a cartera; si en 3 días sigue sin pagar, la marca vencida.',
    trigger_type: 'due_date_reached',
    trigger_config: { due_field: 'vencimiento', offset_minutes: 1440, field_filters: [{ op: 'eq', slug: 'estado', value: 'pendiente' }] },
    actions: [
        {
            type: 'send_email',
            config: {
                to: 'cartera@cafeaurora.co',
                subject: 'Venció la factura {{numero}}',
                body: 'La factura {{numero}} por {{monto|moneda}} venció el {{vencimiento|larga}} y sigue pendiente. Llama al cliente hoy.',
            },
        },
        { type: 'wait', config: { mode: 'duration', amount: 3, unit: 'days', resume_condition: [{ slug: 'estado', op: 'eq', value: 'pendiente' }] } },
        {
            type: 'if_else',
            config: {
                condition: [{ slug: 'monto', op: 'gt', value: '1000000' }],
                then_actions: [
                    { type: 'update_field', config: { values: { estado: 'vencida' } } },
                    { type: 'send_email', config: { to: 'cartera@cafeaurora.co', subject: 'Factura grande sin pagar: {{numero}}', body: 'La factura {{numero}} por {{monto|moneda}} sigue pendiente.' } },
                ],
                else_actions: [{ type: 'update_field', config: { values: { estado: 'vencida' } } }],
            },
        },
    ],
    is_active: false,
    _list: facturas,
});

/** Crea (pausada) la automatización de ejemplo si falta y devuelve su id. */
async function ensureDemo({ api, lists }) {
    const facturas = lists.Facturas;
    if (!facturas) throw new Error('falta la lista Facturas');
    const res = await api.get(`/lists/${facturas.slug}/automations`);
    const all = Array.isArray(res) ? res : (res.data ?? []);
    const hit = all.find((a) => a.name === DEMO_NAME);
    if (hit) return { id: hit.id, slug: facturas.slug };
    const { _list, ...body } = demoAutomation(facturas);
    const created = await api.post(`/lists/${facturas.slug}/automations`, body);
    return { id: created.id ?? created.data?.id, slug: facturas.slug };
}

async function openDemo(ctx) {
    const { id, slug } = await ensureDemo(ctx);
    await ctx.page.goto(`${ctx.base}/#/lists/${slug}/automations/${id}`);
    await ctx.page.locator('[data-tour="automation-trigger"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await ctx.sleep(800);
}

export default [
    {
        key: 'auto-abrir',
        title: 'Dónde están las automatizaciones de una lista',
        steps: [
            { go: '/lists/{list:Facturas}/records', wait: '[data-tour="records-table"]', caption: 'Las automatizaciones viven dentro de cada lista. Abre la lista, por ejemplo «Facturas».' },
            { click: '[data-tour="records-automations"]', then: '[data-tour="automations-new"]', caption: 'Arriba, junto al nombre de la lista, toca «Automatizaciones».' },
            { shot: '[data-tour="automations-new"]', caption: 'Aquí ves todas las de esta lista con su interruptor de activa o pausada. Para crear una: «Desde plantilla» o «En blanco».' },
            { click: '[role="button"]:has-text("Marcar vencida")', then: '[data-tour="automation-trigger"]', caption: 'Toca una tarjeta para abrirla en el editor.' },
            { shot: '[data-tour="automation-trigger"]', caption: 'Cada automatización se lee de arriba abajo: «Cuando» pasa algo y después sus pasos.' },
        ],
    },
    {
        key: 'auto-crear',
        title: 'Crear una automatización en blanco',
        steps: [
            { go: '/lists/{list:Facturas}/automations', wait: '[data-tour="automations-new"]', caption: 'Desde las automatizaciones de la lista.' },
            { click: '[data-tour="automations-new"] a:has-text("En blanco")', then: '[data-tour="automation-trigger"]', caption: 'Toca «En blanco».' },
            { fill: 'input[placeholder="Nombre de la automatización"]', text: 'Aviso de factura nueva', caption: 'Ponle un nombre que diga qué hace.' },
            { shot: '[data-tour="automation-trigger"]', caption: 'En la tarjeta «Cuando» eliges el disparador: qué tiene que pasar para que corra.' },
            { click: '[data-tour="automation-add-action"]', then: '[role="menu"]', caption: 'Después toca «Añadir la primera acción».' },
            { shot: '[role="menu"]', caption: 'Elige qué hace: enviar un correo, cambiar campos, crear un registro, esperar, una acción de una app conectada…' },
        ],
    },
    {
        key: 'auto-lienzo',
        title: 'Ver una automatización como lienzo',
        steps: [
            { run: openDemo },
            { shot: '[data-tour="automation-mode"]', caption: 'El editor abre en «Flujo»: una tarjeta por paso, de arriba abajo.' },
            { click: '[data-tour="automation-mode"] button:has-text("Lienzo")', caption: 'Toca «Lienzo» para verla como un diagrama.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-tour="automation-mode"]').first().scrollIntoViewIfNeeded();
                    await page.evaluate(() => document.querySelector('main')?.scrollBy(0, 120));
                    for (let i = 0; i < 2; i++) {
                        await page.locator('button[aria-label="Acercar"]').first().click();
                        await sleep(250);
                    }
                },
            },
            { shot: true, caption: 'Las ramas de un «Si / Si no» se ven lado a lado. Toca el «+» de una conexión para insertar un paso justo ahí, o un paso para configurarlo.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-tour="automation-mode"] button:has-text("Flujo")').first().click();
                    await sleep(400);
                },
            },
        ],
    },
    {
        key: 'auto-probar',
        title: 'Probar una automatización paso a paso',
        steps: [
            { run: openDemo },
            { click: '[data-tour="automation-test"]', then: '[role="dialog"]', caption: 'Antes de activarla, toca «Probar».' },
            {
                run: async ({ page, api, lists, sleep }) => {
                    const res = await api.get(`/lists/${lists.Facturas.slug}/records?limit=200`);
                    const fields = await api.get(`/lists/${lists.Facturas.slug}/fields`);
                    const est = fields.data.find((f) => f.slug === 'estado');
                    const num = fields.data.find((f) => f.slug === 'numero');
                    const rec = (res.data ?? []).reverse().find((r) => r.data?.[`f${est?.id}`] === 'pendiente');
                    if (!rec || !num) return;
                    await page.locator('[role="dialog"] button:has-text("Elegir otro")').first().click();
                    await page.locator('[data-testid="imcrm-test-record-search"]').fill(String(rec.data[`f${num.id}`]));
                    await sleep(1200);
                    await page.locator(`[role="dialog"] button:has-text("${rec.data[`f${num.id}`]}")`).first().click();
                    await sleep(400);
                },
            },
            { click: '[role="dialog"] button:has-text("Probar") >> nth=-1', caption: 'Elige un registro real de la lista (o deja el último) y toca «Probar».' },
            { wait: 2500 },
            { shot: '[role="dialog"]', caption: 'Ves qué haría cada paso: si el disparador coincidiría, el correo armado, hasta cuándo esperaría y qué campo cambiaría. No se envía ni se cambia nada.' },
        ],
    },
    {
        key: 'auto-plantilla',
        title: 'Crear una automatización desde una plantilla',
        steps: [
            { go: '/lists/{list:Clientes}/automations', wait: '[data-tour="automations-new"]', caption: 'Abre las automatizaciones de la lista, por ejemplo «Clientes».' },
            { click: '[data-tour="automations-new"] button:has-text("Desde plantilla")', then: '[role="dialog"]', caption: 'Toca «Desde plantilla».' },
            { click: '[role="dialog"] button:has-text("Correo de bienvenida al crear")', caption: 'Elige una receta para ver qué hace.' },
            { click: '[role="dialog"] button:has-text("Abrir en el editor")', then: '[data-tour="automation-trigger"]', caption: 'Revisa qué campo de tu lista cumple cada rol (la app sugiere los que coinciden) y toca «Abrir en el editor».' },
            { shot: '[data-tour="automation-trigger"]', caption: 'La receta llega armada al editor, con tus campos. Revisa el texto, ajusta lo que quieras y toca «Guardar».' },
        ],
    },
];
