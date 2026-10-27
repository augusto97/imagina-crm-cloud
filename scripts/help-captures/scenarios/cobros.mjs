/**
 * Capturas del módulo «Cobros» del centro de aprendizaje.
 *
 * Necesitan una conexión de cobro (Mercado Pago o Wompi) en la empresa de
 * ejemplo con algunos links de pago. Conectar una de verdad exige una cuenta
 * del proveedor, así que `seed-cobros.mjs` siembra una conexión de PRUEBA
 * directamente en la base (sólo con `DATABASE_URL`, como en el release). Sin
 * ella las demos fallan y el centro muestra las ilustraciones de respaldo.
 * Ninguna demo crea un cobro.
 */

import { seedCobros } from '../seed-cobros.mjs';

/** Siembra la conexión de prueba si la empresa no tiene una (ver seed-cobros.mjs). */
async function ensureSeed({ tenantId }) {
    await seedCobros(tenantId);
}

/** La primera conexión de cobro y su detalle (con los últimos links). */
async function firstConnection(api) {
    const res = await api.get('/collections/connections');
    const conn = (Array.isArray(res) ? res : res?.data ?? [])[0];
    if (!conn) throw new Error('la empresa de ejemplo no tiene una conexión de cobro');
    return api.get(`/collections/connections/${conn.id}`);
}

/** Abre la ficha de una factura con un link pendiente y baja hasta «Cobros». */
async function openPendingRecord({ page, base, api, sleep }) {
    const detail = await firstConnection(api);
    const link = (detail?.links ?? []).find((l) => l.status === 'pending') ?? detail?.links?.[0];
    if (!link) throw new Error('la conexión no tiene links de pago');
    await page.goto(`${base}/#/lists/${link.list_slug}/records/${link.record_id}`);
    const panel = page.locator('[data-testid="imcrm-record-payments"]').first();
    await panel.waitFor({ state: 'visible', timeout: 40000 });
    await panel.scrollIntoViewIfNeeded();
    await sleep(1500);
}

export default [
    {
        key: 'cobro-demo-ficha',
        title: 'Cobrar desde la ficha de una factura',
        steps: [
            { run: ensureSeed },
            { run: openPendingRecord },
            { shot: '[data-testid="imcrm-record-payments"]', caption: 'En la ficha de la factura, la sección «Cobros» muestra sus links de pago con el estado de cada uno.' },
            { click: '[data-testid="imcrm-payment-collect"]', then: '[role="dialog"]', caption: 'Toca «Cobrar» para crear un link nuevo.' },
            { wait: 1200 },
            { fill: '[data-testid="imcrm-pay-amount"]', text: '1.250.000', caption: 'El concepto y el monto vienen del registro. Ajusta lo que haga falta: monto, moneda, correo del cliente y en cuántos días vence.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('#pay-currency').selectOption('COP');
                    await page.locator('#pay-email').fill('pagos@hotelbrisas.co');
                    await page.locator('#pay-days').fill('5');
                    await sleep(800);
                },
            },
            { shot: '[role="dialog"]', caption: 'Debajo ves cuánto se cobra. «Crear link de pago» lo crea y lo deja copiado para mandarlo por WhatsApp o por correo.' },
            { press: 'Escape' },
        ],
    },
    {
        key: 'cobro-demo-panel',
        title: 'El panel de cobros de una conexión',
        steps: [
            { run: ensureSeed },
            { go: '/settings?s=conectores', wait: '[data-testid="imcrm-integration-connected"]', caption: 'En Ajustes → Integraciones está tu conexión de cobro, en «Conectadas».' },
            { click: '[data-testid="imcrm-collections-open"]', caption: 'Toca «Cobros» en esa conexión.' },
            { wait: 3000 },
            { shot: true, caption: 'Ves cuántos links están pendientes, cuántos se pagaron y cuánto se cobró, los avisos de pago y cómo cobrar.' },
            {
                run: async ({ page, sleep }) => {
                    // El área de trabajo es el que scrollea: se baja hasta la tabla de links.
                    await page.evaluate(() => document.querySelectorAll('main').forEach((m) => m.scrollTo(0, m.scrollHeight)));
                    await sleep(1000);
                },
            },
            { shot: true, caption: 'Abajo, los últimos links con el registro, el concepto, el monto, el estado y el medio de pago.' },
        ],
    },
    {
        key: 'cobro-demo-automatizar',
        title: 'Crear un link de pago desde una automatización',
        steps: [
            {
                run: async ({ page, base, lists, sleep }) => {
                    await page.goto(`${base}/#/lists/${lists.Facturas.slug}/automations/new`);
                    await page.locator('[data-tour="automation-trigger"]').first().waitFor({ state: 'visible', timeout: 40000 });
                    await sleep(1500);
                },
            },
            { click: '[data-tour="automation-add-action"]', then: '[role="menu"]', caption: 'En una automatización de la lista, toca «Añadir la primera acción».' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[role="menu"] [role="menuitem"]:has-text("Crear link de pago")').first().scrollIntoViewIfNeeded();
                    await sleep(600);
                },
            },
            { click: '[role="menu"] [role="menuitem"]:has-text("Crear link de pago")', caption: 'En «Apps conectadas» elige «Crear link de pago».' },
            { wait: 2000 },
            { shot: true, caption: 'Completa el concepto y el monto con variables ({{numero}}, {{monto}}). Después agrega un WhatsApp o un correo con {{pago.link}}.' },
        ],
    },
];
