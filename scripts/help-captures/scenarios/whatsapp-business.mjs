/** Capturas del módulo «WhatsApp Business oficial» (centro de aprendizaje). */

const HOOK_NAME = 'Clientes desde la web';

export default [
    {
        key: 'wab-conectar',
        title: 'Conectar WhatsApp Business oficial',
        steps: [
            { go: '/settings?s=conectores', wait: '[data-testid="imcrm-integration-connect"]:not([disabled])' },
            { click: '[data-integration="whatsapp_cloud"] [data-testid="imcrm-integration-connect"]', then: '[data-testid="imcrm-integration-dialog"]', caption: 'En Ajustes → Integraciones, toca «Conectar» en «WhatsApp Business (oficial)».' },
            { shot: '[data-testid="imcrm-integration-dialog"] ol', caption: 'El cuadro trae los pasos para sacar cada dato de tu cuenta de Meta.' },
            { fill: '[data-testid="imcrm-integration-field-phone_number_id"]', text: '123456789012345', caption: 'Pega el token permanente, los dos identificadores y la clave secreta de la app.' },
            { shot: '[data-testid="imcrm-integration-save"]', caption: 'Al tocar «Conectar», la app comprueba los datos con Meta: si algo no coincide, te dice qué revisar y no guarda nada.' },
        ],
    },
    {
        key: 'wab-disparador',
        title: 'Reaccionar a los mensajes que llegan',
        steps: [
            {
                run: async ({ page, api, lists, base }) => {
                    const slug = lists.Clientes.slug;
                    const { data } = await api.get(`/lists/${slug}/automations`);
                    let auto = data.find((a) => a.name === HOOK_NAME);
                    if (!auto) {
                        const res = await api.post(`/lists/${slug}/automations`, {
                            name: HOOK_NAME,
                            trigger_type: 'incoming_webhook',
                            trigger_config: {},
                            actions: [{ type: 'create_record', config: { values: { razon_social: '{{nombre}}' } } }],
                            is_active: false,
                        });
                        auto = res.data ?? res;
                    }
                    await page.goto(`${base}/#/lists/${slug}/automations/${auto.id}`);
                    await page.getByText('Cuando llega un webhook entrante').first().waitFor({ state: 'visible', timeout: 20000 });
                    await page.waitForTimeout(1500);
                },
            },
            { click: 'text=Cuando llega un webhook entrante', then: 'select[aria-label="Disparador"]', caption: 'En el editor de una automatización, abre la tarjeta «Cuando».' },
            {
                run: async ({ page }) => {
                    await page.locator('select[aria-label="Disparador"]').first().selectOption('whatsapp_message_received');
                    await page.waitForTimeout(800);
                },
            },
            { shot: 'select[aria-label="Disparador"]', caption: 'Elige «Cuando llega un mensaje de WhatsApp»: corre cada vez que un contacto le escribe a tu número.' },
        ],
    },
];
