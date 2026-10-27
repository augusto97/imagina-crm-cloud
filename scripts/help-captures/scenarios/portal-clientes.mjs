/**
 * Capturas del módulo «Portal de clientes» del centro de aprendizaje.
 *
 * Usan la lista Clientes. La primera demo arranca con el portal apagado y lo
 * enciende desde la interfaz; las otras lo dejan encendido por la API. La
 * última vuelve a dejar la lista como estaba (portal apagado, sin listas
 * vinculadas y sin accesos de demo).
 */

const LIST = 'Clientes';
const DEMO_EMAIL = 'compras@demo-cliente.test';

/** DELETE sin cuerpo (el `api.del` del grabador manda content-type JSON y el servidor lo rechaza). */
async function del({ page, base, tenantId }, url) {
    await page.request.fetch(`${base}/api/v1${url}`, { method: 'DELETE', headers: { 'x-tenant-id': String(tenantId) } });
}

/** Ajusta `settings.portal` de la lista conservando el resto de sus ajustes. */
async function setPortal({ api, lists }, portal) {
    const list = lists[LIST];
    const res = await api.get(`/lists/${list.id}`);
    const current = res.data ?? res;
    const settings = { ...(current.settings ?? {}) };
    if (portal === null) delete settings.portal;
    else settings.portal = { ...(settings.portal ?? {}), ...portal };
    await api.patch(`/lists/${list.id}`, { settings });
}

/** El primer cliente de la lista (el de la demo de acceso). */
async function firstRecord({ api, lists }) {
    const res = await api.get(`/lists/${lists[LIST].id}/records?limit=1`);
    const rows = res.data ?? [];
    if (!rows[0]) throw new Error('la lista Clientes no tiene registros');
    return rows[0];
}

/** Quita los accesos al portal que dejó la demo. */
async function clearAccess(ctx) {
    const list = ctx.lists[LIST];
    const rec = await firstRecord(ctx);
    const res = await ctx.api.get(`/lists/${list.id}/portal/access?record_id=${rec.id}`).catch(() => null);
    const users = res?.data ?? [];
    for (const u of users) await del(ctx, `/lists/${list.id}/portal/access/${u.user_id ?? u.id}`).catch(() => {});
}

export default [
    {
        key: 'portal-activar',
        title: 'Activar el portal de una lista',
        setup: (ctx) => setPortal(ctx, null),
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=compartir', wait: '[data-tour="share-portal"]', caption: 'En la configuración de la lista de clientes, pestaña «Compartir», está la tarjeta «Portal del cliente».' },
            { click: '[data-tour="share-portal"] label:has-text("Activar el portal en esta lista") input', then: '[data-testid="portal-choose-template"]', caption: 'Marca «Activar el portal en esta lista».' },
            { wait: 1200 },
            { click: '[data-tour="share-portal"] label:has-text("Facturas") input', caption: 'En «Qué más ve el cliente», marca las listas vinculadas que debe ver: aquí, sus facturas.' },
            { wait: 1200 },
            { shot: '[data-tour="share-portal"]', caption: 'Listo: cada cliente verá su ficha y sólo SUS facturas. Con «Elegir plantilla» diseñas lo que ve.' },
        ],
    },
    {
        key: 'portal-acceso',
        title: 'Dar acceso al portal a un cliente',
        setup: async (ctx) => {
            await setPortal(ctx, { enabled: true });
            await clearAccess(ctx);
        },
        steps: [
            {
                run: async (ctx) => {
                    const rec = await firstRecord(ctx);
                    await ctx.page.goto(`${ctx.base}/#/lists/${ctx.lists[LIST].slug}/records/${rec.id}`);
                    await ctx.page.locator('[data-testid="portal-access-email"]').first().waitFor({ state: 'visible', timeout: 20000 });
                    await ctx.page.locator('[data-testid="portal-access-email"]').first().scrollIntoViewIfNeeded();
                    await ctx.sleep(800);
                },
            },
            { shot: true, caption: 'Abre la ficha del cliente: abajo está la tarjeta «Acceso al portal del cliente».' },
            { fill: '[data-testid="portal-access-email"]', text: DEMO_EMAIL, caption: 'Escribe el correo del cliente.' },
            { click: '[data-testid="portal-access-grant"]', then: '[data-testid="portal-access-add-another"]', caption: 'Toca «Dar acceso»: le llega un correo con un enlace para entrar, sin usuario ni contraseña.' },
            { wait: 1200 },
            { shot: true, caption: 'Queda anotado quién tiene acceso, con «Reenviar enlace», «Quitar acceso» y su última entrada.' },
            { run: clearAccess },
        ],
    },
    {
        key: 'portal-plantillas',
        title: 'Elegir una plantilla del portal',
        setup: (ctx) => setPortal(ctx, { enabled: true }),
        steps: [
            { go: '/lists/{list:Clientes}/portal-editor?plantillas=1', wait: '[data-testid="portal-template-gallery"]', escape: false },
            { wait: 1500 },
            { shot: true, caption: 'En el editor del portal, «Plantillas» abre la galería: cinco diseños pensados para el cliente.' },
            { click: '[data-testid="portal-template-gallery"] [role="radio"]:has-text("Estado de cuenta")', caption: 'Elige la que se parece a tu caso: por ejemplo, «Estado de cuenta».' },
            { wait: 900 },
            { shot: '[data-testid="portal-template-gallery"]', caption: 'Ves qué incluye y qué listas vinculadas usa, con las columnas que verá el cliente.' },
            { click: '[data-testid="portal-template-apply"]', caption: 'Toca «Usar esta plantilla»: arma el diseño en el editor y lo revisas antes de guardar.' },
            { wait: 2000 },
            { shot: true, caption: 'El portal ya diseñado con los datos de un cliente real. Ajusta lo que quieras y toca «Guardar».' },
            { run: (ctx) => setPortal(ctx, null) },
        ],
    },
];
