/**
 * Capturas del módulo «Correos con diseño» del centro de aprendizaje.
 *
 * Usan una automatización NUEVA de la lista «Facturas» que nunca se guarda:
 * se agrega la acción «Enviar email», se abre el editor visual y al final se
 * cierra con «Cancelar». La firma se escribe en Ajustes → Firma de email.
 */

const DESIGNER = '[data-testid="email-designer-apply"]';
const FRAME = '[data-testid="email-preview-frame"]';

/** Abre el editor de una automatización en blanco de «Facturas». */
async function newAutomation(ctx) {
    const { page, base, lists, sleep } = ctx;
    await page.goto(`${base}/#/lists/${lists.Facturas.slug}/automations/new`);
    await page.locator('[data-tour="automation-trigger"]').first().waitFor({ state: 'visible', timeout: 40000 });
    await sleep(1500);
}

/** Agrega «Enviar email» y deja a la vista el selector de formato. */
async function addEmailAction({ page, sleep }) {
    await page.locator('[data-tour="automation-add-action"]').first().click();
    await page.locator('[role="menu"] [role="menuitem"]:has-text("Enviar email")').first().click();
    await page.locator('[data-testid="email-mode"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-testid="email-mode"]').first().scrollIntoViewIfNeeded();
    await sleep(1000);
}

/** Abre el editor visual con la plantilla «Recordatorio de pago». */
async function openDesigner(ctx) {
    const { page, sleep } = ctx;
    await newAutomation(ctx);
    await addEmailAction(ctx);
    await page.locator('[data-testid="email-mode"] button:has-text("Diseño visual")').first().click();
    await page.locator('button:has-text("Recordatorio de pago")').first().waitFor({ state: 'visible', timeout: 60000 });
    await sleep(1200);
    await page.locator('button:has-text("Recordatorio de pago")').first().click();
    await page.locator(FRAME).first().waitFor({ state: 'visible', timeout: 30000 });
    await sleep(2500);
}

/** Cierra el editor sin aplicar nada. */
async function closeDesigner({ page, sleep }) {
    await page.locator('button:has-text("Cancelar")').first().click().catch(() => {});
    await sleep(600);
    const discard = page.locator('[role="alertdialog"] button:has-text("Descartar"), [role="dialog"] button:has-text("Descartar")');
    if (await discard.count()) await discard.first().click().catch(() => {});
    await sleep(600);
}

export default [
    {
        key: 'correo-demo-plantilla',
        title: 'Diseñar un correo desde una plantilla',
        steps: [
            { run: newAutomation },
            { click: '[data-tour="automation-add-action"]', then: '[role="menu"]', caption: 'En una automatización de la lista, toca «Añadir la primera acción».' },
            { click: '[role="menu"] [role="menuitem"]:has-text("Enviar email")', then: '[data-testid="email-mode"]', caption: 'Elige «Enviar email».' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-testid="email-mode"]').first().scrollIntoViewIfNeeded();
                    await sleep(800);
                },
            },
            { click: '[data-testid="email-mode"] button:has-text("Diseño visual")', then: 'button:has-text("Recordatorio de pago")', caption: 'En «Contenido», cambia el formato a «Diseño visual».' },
            { wait: 1500 },
            { click: 'button:has-text("Recordatorio de pago")', then: FRAME, caption: 'Se abre el editor con las plantillas. Elige una para empezar, por ejemplo «Recordatorio de pago».' },
            { wait: 2500 },
            { click: 'button[aria-label="Ver con datos de un registro"]', caption: 'La plantilla llega armada: a la izquierda los bloques, al centro el correo. Los «—» los cambias por variables (Monto, Vencimiento). Toca el ícono de datos para verlo con una factura real.' },
            { wait: 3000 },
            { click: 'button[aria-label="Celular"]', caption: 'Así se ve con los datos de esa factura. Toca el ícono del celular para revisarlo en una pantalla chica.' },
            { wait: 2500 },
            { shot: FRAME, caption: 'En el celular el correo se acomoda solo. Cuando te guste, toca «Listo» y guarda la automatización.' },
            { run: closeDesigner },
        ],
    },
    {
        key: 'correo-demo-estilo',
        title: 'Cambiar el estilo del correo y de un bloque',
        steps: [
            { run: openDesigner },
            { click: '[data-testid="email-left-style"]', caption: 'En «Estilo general» cambias lo que vale para todo el correo.' },
            { wait: 1200 },
            { shot: true, caption: 'Colores (acento, fondos), fuentes, tamaño, interlineado, el ancho, las esquinas, la sombra y el modo oscuro.' },
            {
                run: async ({ page, sleep }) => {
                    const hex = page.locator('input[value="#15803d"]').first();
                    await hex.fill('#7c3aed');
                    await page.keyboard.press('Tab');
                    await sleep(1500);
                },
            },
            { shot: FRAME, caption: 'Cambia el acento a violeta y el botón y los enlaces cambian a la vez.' },
            {
                run: async ({ page, sleep }) => {
                    // El correo vive en un iframe: se elige el bloque del botón con un clic dentro de él.
                    await page
                        .frameLocator(FRAME)
                        .locator('[data-ib-block]:has-text("Pagar ahora")')
                        .last()
                        .evaluate((el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
                    await sleep(1500);
                },
            },
            { shot: true, caption: 'Toca un bloque en la vista previa: a la derecha aparecen sus ajustes, en dos pestañas, «Contenido» y «Estilo».' },
            { click: '[role="tab"]:has-text("Estilo")', caption: 'En «Estilo» eliges la forma del botón, su fuente, márgenes, borde, esquinas y sombra.' },
            { wait: 1200 },
            { shot: true, caption: 'Lo que cambias en un bloque manda sobre el estilo general. «Deshacer» vuelve atrás cualquier cambio.' },
            { run: closeDesigner },
        ],
    },
    {
        key: 'correo-demo-firma',
        title: 'Escribir tu firma de correo',
        steps: [
            { go: '/settings?s=firma', wait: '[data-testid="signature-editor"]', caption: 'En Ajustes → Cuenta → «Firma de email» escribes tu firma una sola vez.' },
            {
                run: async ({ page, sleep }) => {
                    const ed = page.locator('[data-testid="signature-editor"]').first();
                    // Sin el subrayado rojo del corrector ortográfico en la captura.
                    await page.evaluate(() => document.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('spellcheck', 'false')));
                    await ed.click();
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Delete');
                    await page.keyboard.type('Saludos,');
                    await page.keyboard.press('Enter');
                    await page.keyboard.press('Control+B');
                    await page.keyboard.type('Laura Gómez');
                    await page.keyboard.press('Control+B');
                    await page.keyboard.press('Enter');
                    await page.keyboard.type('Gerente comercial · Café Aurora · 300 555 1234');
                    await sleep(1200);
                },
            },
            { shot: '[data-testid="signature-editor"]', caption: 'Escríbela como en Gmail: negrita, cursiva, color, enlaces y hasta tu logo con los botones de arriba.' },
            { shot: true, caption: 'Debajo ves la vista previa. Toca «Guardar firma» y actívala en cada correo con «Agregar la firma al final del correo».' },
        ],
    },
];
