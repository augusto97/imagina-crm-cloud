/** Capturas del módulo «Integraciones» (centro de aprendizaje). */

const HOOK_NAME = 'Clientes desde la web';

/** Crea (una vez) la automatización con webhook entrante en Clientes. */
async function ensureHookAutomation({ api, lists }) {
    const slug = lists.Clientes.slug;
    const { data } = await api.get(`/lists/${slug}/automations`);
    let auto = data.find((a) => a.name === HOOK_NAME);
    if (!auto) {
        auto = await api.post(`/lists/${slug}/automations`, {
            name: HOOK_NAME,
            description: 'El formulario de contacto del sitio web crea el cliente.',
            trigger_type: 'incoming_webhook',
            trigger_config: {},
            actions: [{ type: 'create_record', config: { values: { razon_social: '{{nombre}}', email_facturacion: '{{correo}}' } } }],
            // Pausada: el plan de prueba tiene un tope de automatizaciones activas.
            is_active: false,
        });
        auto = auto.data ?? auto;
    }
    return auto;
}

export default [
    {
        key: 'integ-galeria',
        title: 'Conectar una app desde la galería',
        steps: [
            { go: '/settings?s=conectores', wait: '[data-testid="imcrm-integration-connect"]:not([disabled])', caption: 'En Ajustes → Integraciones está la galería: cada tarjeta es una app que puedes conectar.' },
            { click: '[data-integration="whatsapp"] [data-testid="imcrm-integration-connect"]', then: '[data-testid="imcrm-integration-dialog"]', caption: 'Toca «Conectar» en la app que quieres usar.' },
            { shot: '[data-testid="imcrm-integration-dialog"]', caption: 'El cuadro trae los pasos para sacar la clave en el otro servicio y los datos que hay que pegar.' },
            { fill: '[data-testid="imcrm-integration-field-secret"]', text: 'clave-de-ejemplo-123', caption: 'Pega la clave: se guarda cifrada y nunca se vuelve a mostrar.' },
            { shot: '[data-testid="imcrm-integration-test-to"]', caption: 'Mándate un mensaje de prueba a tu número. Si te llega, toca «Conectar» y listo.' },
        ],
    },
    {
        key: 'integ-api-personalizada',
        title: 'Crear una API personalizada',
        steps: [
            { go: '/settings?s=conectores', wait: '[data-testid="imcrm-integrations-advanced"]' },
            { click: '[data-testid="imcrm-integrations-advanced"]', then: '[data-testid="imcrm-connector-new"]', caption: 'Al final de la galería, abre «Avanzado: API personalizada».' },
            { click: '[data-testid="imcrm-connector-new"]', then: '#conn-name', caption: 'Toca «Nueva conexión».' },
            { fill: '#conn-name', text: 'Mi sistema de facturación', caption: 'Ponle un nombre que el equipo reconozca.' },
            { fill: '#conn-url', text: 'https://api.mifactura.co/v1', caption: 'Escribe la URL base del servicio: todas sus acciones parten de ahí.' },
            { shot: '#conn-auth', caption: 'Elige cómo se autentica y pega su clave. Con «Probar conexión» ves si responde antes de guardar.' },
        ],
    },
    {
        key: 'integ-webhook-entrante',
        title: 'Recibir datos de otro sistema',
        steps: [
            {
                run: async (ctx) => {
                    const auto = await ensureHookAutomation(ctx);
                    ctx.hookAutomationId = auto.id;
                },
            },
            {
                run: async (ctx) => {
                    await ctx.page.goto(`${ctx.base}/#/lists/${ctx.lists.Clientes.slug}/automations/${ctx.hookAutomationId}`);
                    await ctx.page.getByText('Cuando llega un webhook entrante').first().waitFor({ state: 'visible', timeout: 20000 });
                },
            },
            { wait: 2000 },
            { click: 'text=Cuando llega un webhook entrante', then: '[data-testid="webhook-test-panel"]', caption: 'Una automatización con el disparador «Webhook entrante» tiene su propia dirección pública. Abre la tarjeta «Cuando».' },
            { shot: 'input[aria-label="URL del webhook"]', caption: 'Copia esta URL y pégala en tu formulario, tu tienda o Zapier: lo que manden ahí dispara la automatización.' },
            { click: '[data-testid="webhook-test-panel"] button', caption: 'Toca «Escuchar datos de prueba» y manda un envío de prueba desde el otro sistema.' },
            {
                // Un envío de prueba, como el que haría el formulario del sitio web.
                run: async ({ page, base }) => {
                    const url = await page.locator('input[aria-label="URL del webhook"]').first().inputValue();
                    const token = url.split('/public/hooks/')[1];
                    await page.request.post(`${base}/api/v1/public/hooks/${token}`, {
                        data: { nombre: 'Hotel Brisas del Mar', correo: 'reservas@hotelbrisas.co', ciudad: 'Cartagena', contacto: { telefono: '+573104445566' } },
                    });
                    await page.waitForTimeout(4500);
                },
            },
            { shot: '[data-testid="webhook-test-panel"]', caption: 'Lo que llega aparece aquí, campo por campo, con la variable lista para copiar y usar en las acciones.' },
        ],
    },
    {
        key: 'integ-acciones-apps',
        title: 'Usar una app conectada en una automatización',
        steps: [
            {
                run: async (ctx) => {
                    const auto = await ensureHookAutomation(ctx);
                    await ctx.page.goto(`${ctx.base}/#/lists/${ctx.lists.Clientes.slug}/automations/${auto.id}`);
                    await ctx.page.locator('[data-tour="automation-add-action"]').first().waitFor({ state: 'visible', timeout: 20000 });
                    await ctx.page.waitForTimeout(1500);
                },
            },
            { click: '[data-tour="automation-add-action"]', then: '[role="menu"]', caption: 'En cualquier automatización, toca «Añadir acción».' },
            {
                run: async ({ page }) => {
                    await page.locator('[role="menu"]').first().evaluate((el) => {
                        el.scrollTop = el.scrollHeight;
                    });
                    await page.waitForTimeout(400);
                },
            },
            { shot: '[data-testid="imcrm-action-connect-more"]', caption: 'Abajo del menú están las «Apps conectadas», cada acción con el logo de su app. Si falta una, «Conectar una app» te lleva a la galería.' },
        ],
    },
];
