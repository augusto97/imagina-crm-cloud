/** Capturas del módulo «Tiendas WooCommerce» (centro de aprendizaje). */

async function fillKeys({ page }) {
    await page.locator('[data-testid="imcrm-integration-field-consumer_key"]').fill('ck_3f9a2c71d8e04b5a9c6e1f0b7d2a4c8e9f1b3d5a');
    await page.locator('[data-testid="imcrm-integration-field-consumer_secret"]').fill('cs_8b1e4d7a2c9f05e3b6a1d8c4f7e2b9a05c3d6e1f');
}

const GALLERY_READY = '[data-testid="imcrm-integration-connect"]:not([disabled])';

export default [
    {
        key: 'tienda-conectar',
        title: 'Conectar la tienda WooCommerce',
        steps: [
            { go: '/settings?s=conectores', wait: GALLERY_READY },
            {
                run: async ({ page }) => {
                    await page.locator('[data-integration="woocommerce"]').first().scrollIntoViewIfNeeded();
                    await page.waitForTimeout(400);
                },
            },
            { shot: '[data-integration="woocommerce"]', caption: 'En Ajustes → Integraciones, la tarjeta de WooCommerce está en «Tiendas online».' },
            { click: '[data-integration="woocommerce"] [data-testid="imcrm-integration-connect"]', then: '[data-testid="imcrm-integration-dialog"]', caption: 'Toca «Conectar»: el cuadro explica cómo generar la clave de la API en tu WordPress y qué datos pegar aquí.' },
            { fill: '[data-testid="imcrm-integration-field-store_url"]', text: 'https://cafeaurora.co', caption: 'Escribe la dirección de la tienda (con https).' },
            { run: fillKeys },
            { shot: '[data-testid="imcrm-integration-dialog"]', caption: 'Pega la clave del cliente (empieza con ck_) y la clave secreta (empieza con cs_), y toca «Conectar»: la app prueba la tienda antes de guardar y, si no responde, te dice por qué.' },
        ],
    },
    {
        key: 'tienda-error',
        title: 'Si la tienda no responde',
        steps: [
            { go: '/settings?s=conectores', wait: GALLERY_READY },
            {
                run: async (ctx) => {
                    await ctx.page.locator('[data-integration="woocommerce"] [data-testid="imcrm-integration-connect"]').first().click();
                    await ctx.page.locator('[data-testid="imcrm-integration-dialog"]').first().waitFor({ state: 'visible', timeout: 20000 });
                    await fillKeys(ctx);
                },
            },
            { fill: '[data-testid="imcrm-integration-field-store_url"]', text: 'https://cafeaurora-tiend.co', caption: 'Si la dirección de la tienda está mal escrita…' },
            { click: '[data-testid="imcrm-integration-save"]', then: '[data-testid="imcrm-integration-error"]', caption: '…al tocar «Conectar» la app prueba la tienda y no guarda nada.' },
            { shot: '[data-testid="imcrm-integration-error"]', caption: 'Te dice qué pasó: aquí, que no encontró esa dirección. Corrígela y vuelve a tocar «Conectar».' },
        ],
    },
];
