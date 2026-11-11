/**
 * Capturas del módulo «Compartir hacia afuera» del centro de aprendizaje.
 *
 * La de la página pública publica la lista Productos con algunos campos y al
 * terminar la despublica. La de invitados invita a una persona de afuera a
 * la lista Tareas y al terminar la quita de la empresa.
 */

const GUEST_EMAIL = 'disenos@estudiolumen.test';

/** DELETE sin cuerpo (el `api.del` del grabador manda content-type JSON y el servidor lo rechaza). */
async function del({ page, base, tenantId }, url) {
    await page.request.fetch(`${base}/api/v1${url}`, { method: 'DELETE', headers: { 'x-tenant-id': String(tenantId) } });
}

async function unpublish({ api, lists }) {
    await api.patch(`/lists/${lists.Productos.id}/public`, { enabled: false, visible_field_slugs: [] }).catch(() => {});
}

async function removeGuest(ctx) {
    const res = await ctx.api.get('/workspaces/current/guests').catch(() => null);
    for (const g of res?.data ?? []) {
        if (String(g.email).toLowerCase() === GUEST_EMAIL) await del(ctx, `/workspaces/current/guests/${g.user_id ?? g.id}`).catch(() => {});
    }
}

const field = (label) => `[data-tour="share-public"] label:has(span:text-is("${label}")) input[type="checkbox"]`;

export default [
    {
        key: 'comp-publicar-lista',
        title: 'Publicar una lista en una página pública',
        setup: unpublish,
        steps: [
            { go: '/lists/{list:Productos}/edit?s=compartir', wait: '[data-tour="share-public"]' },
            { click: '[data-tour="share-public"] label:has-text("Publicar esta lista") input', caption: 'En la sección «Compartir» de la lista, tarjeta «Página pública», marca «Publicar esta lista».' },
            { wait: 700 },
            { click: field('Producto'), caption: 'En «Qué campos se muestran», marca sólo lo que puede ver cualquiera.' },
            { click: field('Categoría'), caption: null },
            { click: field('Stock'), caption: null },
            { click: field('Precio'), caption: 'Producto, categoría, stock y precio. El proveedor y la ubicación quedan sin marcar: nunca salen de la app.' },
            { click: '[data-tour="share-public"] button:has-text("Guardar")', caption: 'Toca «Guardar»: se genera el enlace.' },
            { wait: 1500 },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-tour="share-public"] input[readonly]').first().scrollIntoViewIfNeeded();
                    await sleep(500);
                },
            },
            { shot: true, caption: 'Copia el enlace o el código para insertarla en tu sitio. Más abajo eliges orden, filas por página, buscador y los sitios permitidos.' },
            {
                run: async ({ page, base, api, lists, sleep }) => {
                    const res = await api.get(`/lists/${lists.Productos.id}/public`);
                    const pub = res.data ?? res;
                    if (!pub.public_path) throw new Error('la lista no quedó publicada');
                    await page.goto(`${base}/api/v1${pub.public_path}`);
                    await page.locator('table, main, body').first().waitFor({ state: 'visible', timeout: 15000 });
                    await sleep(1800);
                },
            },
            { shot: true, caption: 'Así la ve cualquiera con el enlace: sólo esas columnas, con buscador y sin poder editar nada.' },
            { run: unpublish },
        ],
    },
    {
        key: 'comp-invitado',
        title: 'Invitar a alguien de afuera',
        setup: removeGuest,
        steps: [
            { go: '/lists/{list:Tareas}/records', wait: '[data-tour="records-share"]' },
            { click: '[data-tour="records-share"]', then: '[data-testid="share-add-input"]', caption: 'En la lista, toca «Compartir»: se abre en «Personas».' },
            { fill: '[data-testid="share-add-input"]', text: GUEST_EMAIL, caption: 'En el buscador, escribe el correo completo del proveedor, el freelancer o el contador.' },
            { wait: '[data-testid="share-option-email"]' },
            { click: '[data-testid="share-option-email"]', caption: 'Toca «Invitar a…»: ve sólo esta lista y no ocupa un usuario de tu plan.' },
            { wait: '[data-testid="share-row-guest"]' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-testid="share-row-guest"] select').first().selectOption('comment');
                    await sleep(1200);
                },
            },
            { shot: '[data-testid="share-access-list"]', caption: 'Queda en «Quién tiene acceso» y le llega una invitación por correo. En su fila cambias el nivel —aquí «Puede comentar»— o le quitas el acceso con la ×.' },
            { run: removeGuest },
        ],
    },
];
