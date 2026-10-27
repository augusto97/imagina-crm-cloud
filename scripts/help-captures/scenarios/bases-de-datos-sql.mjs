/** Capturas del módulo «Bases de datos SQL» (centro de aprendizaje). */

export default [
    {
        key: 'sql-conectar',
        title: 'Conectar una base de SQL Server',
        steps: [
            { go: '/settings?s=conectores', wait: '[data-testid="imcrm-integration-connect"]:not([disabled])' },
            { click: '[data-integration="sqlserver"] [data-testid="imcrm-integration-connect"]', then: '[data-testid="imcrm-integration-dialog"]', caption: 'En Ajustes → Integraciones, toca «Conectar» en «SQL Server / Azure SQL».' },
            { shot: '[data-testid="imcrm-integration-dialog"] ol', caption: 'Primero, lo que tiene que preparar quien administra la base: un usuario de solo lectura y el firewall.' },
            { fill: '[data-testid="imcrm-integration-field-server"]', text: 'erp-cafeaurora.database.windows.net', caption: 'Escribe el servidor sin «https://», la base de datos, el usuario y la contraseña.' },
            { click: 'text=Opciones avanzadas', caption: 'En «Opciones avanzadas» están el puerto y las opciones de cifrado.' },
            { shot: '[data-testid="imcrm-integration-save"]', caption: 'Al tocar «Conectar», la app se conecta de verdad: si no puede, te dice por qué (firewall, usuario, base) y no guarda nada.' },
        ],
    },
    {
        key: 'sql-reaccionar',
        title: 'Reaccionar a lo que cambia en la base',
        steps: [
            {
                run: async ({ page, api, lists, base }) => {
                    const slug = lists.Facturas.slug;
                    const { data } = await api.get(`/lists/${slug}/automations`);
                    const auto = data[0];
                    if (!auto) throw new Error('la lista Facturas no tiene automatizaciones de ejemplo');
                    await page.goto(`${base}/#/lists/${slug}/automations/${auto.id}`);
                    await page.locator('[data-tour="automation-add-action"]').first().waitFor({ state: 'visible', timeout: 20000 });
                    await page.waitForTimeout(1500);
                    // Abre la tarjeta «Cuando» (el disparador).
                    await page.getByText('Cuando', { exact: true }).first().click();
                    await page.locator('select[aria-label="Disparador"]').first().waitFor({ state: 'visible', timeout: 10000 });
                    await page.locator('select[aria-label="Disparador"]').first().selectOption('field_changed');
                    await page.waitForTimeout(800);
                },
            },
            { shot: 'select[aria-label="Disparador"]', caption: 'Las corridas de la sincronización disparan automatizaciones como cualquier cambio: por ejemplo «Cuando cambia un campo».' },
            { shot: 'text=De (valor anterior)', caption: 'Elige el campo y, si quieres, el valor de antes y el de ahora: «Estado» de Pendiente a Pagada. (La primera carga nunca dispara nada.)' },
        ],
    },
];
