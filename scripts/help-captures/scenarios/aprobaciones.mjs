/**
 * Capturas del módulo «Aprobaciones» del centro de aprendizaje.
 *
 * Sobre la lista «Oportunidades» de la empresa de ejemplo. La demo de alta
 * crea un flujo desde la pantalla (antes borra el de una corrida anterior);
 * las demás usan un flujo propio («Visto bueno de gerencia») que se crea por
 * la API si falta, con «quien pide puede aprobar» encendido: en la empresa de
 * ejemplo hay una sola persona, y así se ve «Pendiente de tu aprobación».
 */

const DEMO_FLOW = 'Visto bueno de gerencia';
const UI_FLOW = 'Descuento mayor al 15 %';

async function flowsOf(api, slug) {
    const res = await api.get(`/lists/${slug}/approval-flows`);
    return Array.isArray(res) ? res : (res.data ?? []);
}

/** El flujo de las demos de pedir/decidir (y la oportunidad sobre la que se pide). */
async function ensureDemoFlow({ api, lists }) {
    const list = lists.Oportunidades;
    if (!list) throw new Error('falta la lista Oportunidades');
    const me = await api.get('/auth/me');
    let flow = (await flowsOf(api, list.slug)).find((f) => f.name === DEMO_FLOW);
    if (!flow) {
        const created = await api.post(`/lists/${list.slug}/approval-flows`, {
            name: DEMO_FLOW,
            description: 'Descuentos y condiciones especiales',
            is_active: true,
            add_status_field: true,
            config: {
                steps: [{ id: 'gerencia', name: 'Gerencia', mode: 'any', approver: { type: 'users', approver_user_ids: [me.user.id] } }],
                on_approve: [],
                on_reject: [],
                allow_resubmit: true,
                self_approval: true,
            },
        });
        flow = created.data ?? created;
    }
    const recs = await api.get(`/lists/${list.slug}/records?limit=5`);
    const rec = (recs.data ?? [])[0];
    if (!rec) throw new Error('Oportunidades no tiene registros');
    return { list, flow, rec };
}

/** Cancela lo pendiente del registro (para poder volver a pedir en otra corrida). */
async function clearPending(api, slug, recId) {
    const res = await api.get(`/lists/${slug}/records/${recId}/approvals`);
    const all = res.data?.requests ?? [];
    for (const r of all) if (r.status === 'pending') await api.post(`/approvals/${r.id}/cancel`, { reason: '' }).catch(() => {});
}

export default [
    {
        key: 'aprob-crear-flujo',
        title: 'Crear un flujo de aprobación',
        steps: [
            {
                run: async ({ api, lists }) => {
                    const slug = lists.Oportunidades.slug;
                    for (const f of await flowsOf(api, slug)) if (f.name === UI_FLOW) await api.del(`/lists/${slug}/approval-flows/${f.id}`).catch(() => {});
                },
            },
            { go: '/lists/{list:Oportunidades}/edit?s=aprobaciones', wait: 'button:has-text("Nuevo flujo")', caption: 'Los flujos se arman en los ajustes de cada lista: «Configurar lista» → pestaña «Aprobaciones».' },
            { click: 'button:has-text("Nuevo flujo")', then: 'input[placeholder="Por ejemplo: Gasto mayor a $1M"]', caption: 'Toca «Nuevo flujo».' },
            { fill: 'input[placeholder="Por ejemplo: Gasto mayor a $1M"]', text: UI_FLOW, caption: 'Ponle un nombre que diga cuándo se usa.' },
            { shot: 'text=Pasos (en orden)', caption: 'Arma los pasos en orden: quién aprueba cada uno (un campo Persona, un rol, personas puntuales o un equipo) y si basta con uno o tienen que aprobar todos.' },
            {
                run: async ({ page }) => {
                    await page.locator('text=Al aprobar, poner').first().scrollIntoViewIfNeeded();
                },
            },
            { shot: 'text=Al aprobar, poner', caption: 'Elige qué campos se escriben solos al aprobar y al rechazar, y las reglas del flujo. Termina con «Crear flujo».' },
            { click: 'button:has-text("Crear flujo")', caption: null },
            { wait: 800 },
            { shot: true, caption: 'Listo: en la ficha de cada oportunidad aparece «Pedir aprobación».' },
        ],
    },
    {
        key: 'aprob-pedir',
        title: 'Pedir una aprobación desde la ficha',
        steps: [
            {
                run: async (ctx) => {
                    const { list, rec } = await ensureDemoFlow(ctx);
                    await clearPending(ctx.api, list.slug, rec.id);
                    await ctx.page.goto(`${ctx.base}/#/lists/${list.slug}/records/${rec.id}`);
                    await ctx.page.locator('[data-testid="imcrm-approval-ask"]').first().waitFor({ state: 'visible', timeout: 20000 });
                    await ctx.sleep(700);
                },
            },
            { click: '[data-testid="imcrm-approval-ask"]', then: '[data-testid="imcrm-approval-ask-form"]', caption: 'En la ficha del registro, toca «Pedir aprobación».' },
            {
                run: async ({ page }) => {
                    await page.locator('[data-testid="imcrm-approval-flow-select"]').selectOption({ label: DEMO_FLOW });
                },
            },
            { fill: '[data-testid="imcrm-approval-note"]', text: 'Piden 18 % de descuento por pagar el año completo.', caption: 'Elige el flujo y deja una nota para quienes aprueban (opcional).' },
            { click: '[data-testid="imcrm-approval-send"]', then: '[data-testid="imcrm-approval-mine"]', caption: 'Toca «Pedir aprobación»: a quien le toca decidir le llega el aviso.' },
            { shot: '[data-testid="imcrm-record-approvals"]', caption: 'La solicitud queda «Pendiente» y quien aprueba ve aquí mismo «Aprobar», «Rechazar» o «Devolver».' },
        ],
    },
    {
        key: 'aprob-mi-trabajo',
        title: 'Decidir desde Mi trabajo',
        steps: [
            {
                run: async (ctx) => {
                    const { list, rec } = await ensureDemoFlow(ctx);
                    const res = await ctx.api.get(`/lists/${list.slug}/records/${rec.id}/approvals`);
                    const all = res.data?.requests ?? [];
                    if (!all.some((r) => r.status === 'pending')) {
                        const flow = (await flowsOf(ctx.api, list.slug)).find((f) => f.name === DEMO_FLOW);
                        await ctx.api.post(`/lists/${list.slug}/records/${rec.id}/approvals`, { flow_id: flow.id, note: 'Piden 18 % de descuento por pagar el año completo.' });
                    }
                },
            },
            { go: '/my-work', wait: '[data-testid="my-work-tab-approvals"]', caption: 'Todo lo que te toca aprobar, de todas las listas, se junta en «Mi trabajo».' },
            { click: '[data-testid="my-work-tab-approvals"]', caption: 'Abre la pestaña «Aprobaciones».' },
            { wait: 800 },
            { shot: true, caption: 'Arriba, lo que espera tu decisión (con Aprobar, Rechazar y Devolver); abajo, lo que pediste tú y en qué paso va.' },
        ],
    },
];
