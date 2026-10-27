/**
 * Capturas del módulo «Documentos PDF» del centro de aprendizaje.
 *
 * Usan la lista «Facturas» de la empresa de ejemplo. La primera demo arma una
 * cuenta de cobro desde la galería y cierra el editor SIN guardar; las otras
 * necesitan una plantilla guardada y la crean (una sola vez) por la interfaz
 * si todavía no existe.
 */

const TEMPLATE = 'Cuenta de cobro';
const docsPath = (lists) => `/lists/${lists.Facturas.slug}/edit?s=documentos`;

async function templates(ctx) {
    const res = await ctx.api.get(`/lists/${ctx.lists.Facturas.slug}/documents`);
    return Array.isArray(res) ? res : (res?.data ?? []);
}

/** Abre Ajustes de la lista → Documentos. */
async function openDocs(ctx) {
    const { page, base, lists, sleep } = ctx;
    await page.goto(`${base}/#${docsPath(lists)}`);
    await page.locator('[data-testid="doc-templates-panel"]').waitFor({ state: 'visible', timeout: 30000 });
    await sleep(1200);
}

/** Deja guardada una «Cuenta de cobro» (por la interfaz, como lo haría una persona). */
async function ensureTemplate(ctx) {
    const { page, sleep } = ctx;
    if ((await templates(ctx)).some((t) => t.name === TEMPLATE)) return;
    await openDocs(ctx);
    await page.locator('[data-testid="doc-new"]').click();
    await page.locator('[data-starter="cuenta_cobro"]').click();
    await page.locator('[data-testid="doc-starter"] input[aria-label="Nombre"]').fill('Laura Gómez');
    await page.locator('[data-testid="doc-starter"] input[aria-label="Número de documento"]').fill('52.345.678');
    await page.locator('[data-testid="doc-starter"] input[aria-label="Ciudad"]').fill('Bogotá');
    await page.locator('[data-testid="doc-starter"] input[aria-label="Banco"]').fill('Bancolombia');
    await page.locator('[data-testid="doc-starter"] input[aria-label="Número de cuenta"]').fill('123-456789-01');
    await page.locator('[data-testid="doc-starter-create"]').click();
    await page.locator('[data-testid="doc-save"]').waitFor({ state: 'visible', timeout: 60000 });
    await sleep(2500);
    await page.locator('[data-testid="doc-save"]').click();
    await sleep(2500);
    await page.keyboard.press('Escape');
    await sleep(800);
}

/** Abre la plantilla guardada en el editor y espera a que el PDF se dibuje. */
async function openEditor(ctx) {
    const { page, sleep } = ctx;
    await openDocs(ctx);
    await page.locator('[data-testid="doc-templates-panel"] li:has-text("Cuenta de cobro") button:has-text("Editar")').first().click();
    await page.locator('[data-testid="doc-designer"] img[src^="data:image"]').first().waitFor({ state: 'visible', timeout: 60000 });
    await sleep(3500);
}

/** Cierra el editor sin guardar (confirma si lo pregunta). */
async function closeEditor({ page, sleep }) {
    await page.locator('[data-testid="doc-designer"] button[aria-label="Cerrar"]').last().click().catch(() => {});
    await sleep(800);
    const discard = page.locator('button:has-text("Cerrar sin guardar")');
    if (await discard.count()) await discard.first().click();
    await sleep(600);
}

export default [
    {
        key: 'pdf-crear-plantilla',
        title: 'Crear una cuenta de cobro desde la galería',
        steps: [
            { run: openDocs },
            { click: '[data-testid="doc-new"]', caption: 'En los ajustes de la lista, sección «Documentos», toca «Nueva plantilla».', then: '[data-testid="doc-starter"]' },
            { wait: 800 },
            { click: '[data-starter="cuenta_cobro"]', caption: 'Elige un punto de partida: aquí, «Cuenta de cobro».' },
            { wait: 1200 },
            { shot: '[data-testid="doc-starter"]', caption: 'La app sugiere qué campo de la lista va en cada lugar. Debajo cargas quién cobra y dónde te pagan.' },
            { fill: '[data-testid="doc-starter"] input[aria-label="Nombre"]', text: 'Laura Gómez', caption: 'Escribe tu nombre o el de tu empresa, tu documento y tus datos bancarios.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-testid="doc-starter"] input[aria-label="Número de documento"]').fill('52.345.678');
                    await page.locator('[data-testid="doc-starter"] input[aria-label="Ciudad"]').fill('Bogotá');
                    await page.locator('[data-testid="doc-starter"] input[aria-label="Banco"]').fill('Bancolombia');
                    await page.locator('[data-testid="doc-starter"] input[aria-label="Número de cuenta"]').fill('123-456789-01');
                    await sleep(400);
                },
            },
            { click: '[data-testid="doc-starter-create"]', caption: 'Toca «Crear y abrir el editor».', then: '[data-testid="doc-designer"]' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-testid="doc-designer"] img[src^="data:image"]').first().waitFor({ state: 'visible', timeout: 60000 });
                    await sleep(3500);
                },
            },
            { shot: '[data-testid="doc-designer"]', caption: 'Listo: la cuenta de cobro con los datos de una factura real. Revísala y toca «Guardar».' },
            { run: closeEditor },
        ],
    },
    {
        key: 'pdf-editor-recorrido',
        title: 'Editar un bloque y la hoja',
        steps: [
            { run: ensureTemplate },
            { run: openEditor },
            { click: '[data-testid="doc-designer"] button:has-text("Estructura")', caption: 'En «Estructura» ves los bloques del documento de arriba hacia abajo.' },
            { wait: 800 },
            { click: '[data-testid="doc-outline"] button:has-text("Totales")', caption: 'Toca un bloque para editarlo, por ejemplo «Totales».' },
            { wait: 1500 },
            { shot: '[data-testid="doc-inspector"]', caption: 'A la derecha están sus ajustes: cada fila, cómo se calcula y cómo se ve.' },
            { click: '[data-testid="doc-designer"] button:has-text("Hoja y estilo")', caption: 'En «Hoja y estilo» eliges el tamaño, los márgenes, las fuentes, los colores, el pie y la numeración.' },
            { wait: 1200 },
            { shot: '[data-testid="doc-page-panel"]', caption: 'Todo lo que cambias se ve al instante en el PDF del centro.' },
            { run: closeEditor },
        ],
    },
    {
        key: 'pdf-generar',
        title: 'Generar el PDF desde un registro',
        steps: [
            { run: ensureTemplate },
            {
                run: async ({ page, base, lists, api, sleep }) => {
                    const res = await api.get(`/lists/${lists.Facturas.slug}/records?limit=1`);
                    const rec = (res?.data ?? res)[0];
                    if (!rec) throw new Error('la lista Facturas no tiene registros');
                    await page.goto(`${base}/#/lists/${lists.Facturas.slug}/records/${rec.id}`);
                    await page.locator('[data-testid="record-pdf"]').first().waitFor({ state: 'visible', timeout: 30000 });
                    await sleep(2500);
                },
            },
            { click: '[data-testid="record-pdf"] >> nth=0', caption: 'En la ficha de la factura, toca «Generar PDF».', then: '[role="menu"]' },
            { wait: 600 },
            { shot: '[role="menu"] [role="menuitem"]:has-text("Cuenta de cobro")', caption: 'Aparecen las plantillas de la lista. Elige «Cuenta de cobro».' },
            {
                // El submenú se abre con el teclado: así no se cierra cuando se toma la foto.
                run: async ({ page, sleep }) => {
                    await page.mouse.move(-10, -10);
                    await page.locator('[role="menu"] [role="menuitem"]:has-text("Cuenta de cobro")').first().focus();
                    await page.keyboard.press('ArrowRight');
                    await page.locator('[role="menu"] >> nth=1').waitFor({ state: 'visible', timeout: 15000 });
                    await sleep(600);
                },
            },
            { shot: '[role="menu"] >> nth=1', caption: 'Puedes verlo, descargarlo, copiar un enlace de 30 días o guardarlo en el registro.' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[role="menu"] >> nth=1 >> [role="menuitem"]:has-text("Ver")').first().focus();
                    await page.keyboard.press('Enter');
                    await page.locator('[role="dialog"] img[src^="data:image"]').first().waitFor({ state: 'visible', timeout: 60000 });
                    await sleep(3000);
                },
            },
            { shot: '[role="dialog"]', caption: 'Con «Ver» lo revisas con los datos de ahora, sin gastar ningún número: la cuenta de cobro de esta factura.' },
            { press: 'Escape' },
        ],
    },
];
