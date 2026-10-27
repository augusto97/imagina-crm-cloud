/**
 * Capturas del módulo «Formularios» del centro de aprendizaje.
 *
 * Todas usan la lista Tickets. Cada demo borra al empezar los formularios
 * que haya en esa lista y al terminar el que creó, así la empresa de ejemplo
 * queda como estaba (y una corrida repetida no acumula formularios).
 */

const LIST = 'Tickets';

/**
 * DELETE sin cuerpo: `api.del` del runner manda `content-type: json` sin
 * cuerpo y el servidor lo rechaza (400), así que se borra por la sesión.
 */
async function del({ page, base, tenantId }, url) {
    await page.request.fetch(`${base}/api/v1${url}`, { method: 'DELETE', headers: { 'x-tenant-id': String(tenantId) } });
}

/** Borra todos los formularios de la lista. */
async function clearForms(ctx) {
    const id = ctx.lists[LIST]?.id;
    if (!id) return;
    const { data } = await ctx.api.get(`/lists/${id}/forms`);
    for (const f of data ?? []) await del(ctx, `/lists/${id}/forms/${f.id}`).catch(() => {});
}

/** Un formulario de contacto de soporte listo para editar (sin publicar). */
async function createSupportForm({ api, lists }) {
    const list = lists[LIST];
    const { data: fields } = await api.get(`/lists/${list.id}/fields`);
    const by = Object.fromEntries(fields.map((f) => [f.slug, f.id]));
    const items = ['solicitante', 'canal', 'email', 'asunto', 'prioridad', 'descripcion', 'adjuntos']
        .filter((s) => by[s])
        .map((s, i) => ({ id: `demo${i}`, type: 'field', field_id: by[s], required: s === 'asunto' || s === 'email' || s === 'solicitante' }));
    const res = await api.post(`/lists/${list.id}/forms`, {
        name: 'Soporte en línea',
        config: { items, settings: { title: 'Cuéntanos qué pasó', description: 'Te respondemos en menos de 24 horas hábiles.', submit_label: 'Enviar' } },
    });
    return res.data ?? res;
}

export default [
    {
        key: 'form-crear',
        title: 'Crear un formulario',
        setup: clearForms,
        steps: [
            { go: '/lists/{list:Tickets}/edit?s=formularios', wait: '[data-tour="forms-new"]' },
            { click: '[data-tour="forms-new"]', caption: 'En la configuración de la lista, pestaña «Formularios», toca «Nuevo formulario»: arranca con las preguntas de la lista ya puestas.' },
            {
                // A veces el panel se vuelve a montar al refrescar la lista y el
                // constructor no se abre solo: en ese caso se abre con «Editar».
                run: async ({ page }) => {
                    const builder = page.locator('[data-testid="form-builder"]');
                    try {
                        await builder.waitFor({ state: 'visible', timeout: 6000 });
                    } catch {
                        await page.locator('[data-form-edit]').first().click();
                        await builder.waitFor({ state: 'visible', timeout: 15000 });
                    }
                },
            },
            { wait: 1800 },
            { shot: true, caption: 'Las preguntas a la izquierda, la página real en el centro y los ajustes a la derecha.' },
            { click: '[data-testid="form-builder"] [role="tab"]:has-text("Preguntas")', then: '[data-testid="form-structure"]', caption: 'En «Preguntas» ves el orden; arrastra para moverlas.' },
            { click: '[data-structure-item]:has-text("Canal") button >> nth=0', then: '[data-testid="form-item-inspector"]', caption: 'Toca una pregunta para editarla (también puedes tocarla en la vista previa).' },
            { fill: '[data-testid="form-item-label"]', text: '¿Por dónde prefieres que te contactemos?', caption: 'Cambia el texto de la pregunta: el campo de la lista sigue siendo el mismo.' },
            { click: '[data-testid="form-item-inspector"] button:has-text("Lista")', caption: 'En «Cómo se elige», pasa de botones a una lista desplegable.' },
            { wait: 900 },
            { shot: true, caption: 'La vista previa cambia al instante.' },
            { click: '[data-testid="form-save"]', caption: 'Toca «Guardar» y listo para publicar.' },
            { wait: 800 },
            { run: clearForms },
        ],
    },
    {
        key: 'form-condicion',
        title: 'Una pregunta que aparece sola',
        setup: async (ctx) => {
            await clearForms(ctx);
            await createSupportForm(ctx);
        },
        steps: [
            { go: '/lists/{list:Tickets}/edit?s=formularios', wait: '[data-form-edit]', caption: 'Abre el formulario con «Editar».' },
            { click: '[data-form-edit]', then: '[data-testid="form-builder"]', caption: null },
            { wait: 1500 },
            { click: '[data-testid="form-builder"] [role="tab"]:has-text("Preguntas")', then: '[data-testid="form-structure"]', caption: 'En «Preguntas», elige la que sólo debe aparecer en algunos casos.' },
            { click: '[data-structure-item]:has-text("Email") button >> nth=0', then: '[data-testid="form-item-inspector"]', caption: 'Por ejemplo, el correo: sólo hace falta si eligen que los contacten por correo.' },
            { click: '[data-testid="form-item-inspector"] button:has-text("Agregar una condición")', then: '[data-testid="form-condition"]', caption: 'En «Mostrar sólo si…», toca «Agregar una condición».' },
            {
                run: async ({ page, sleep }) => {
                    await page.locator('[data-testid="form-condition"] select[aria-label="Pregunta que controla"]').selectOption({ label: 'Canal' });
                    await sleep(300);
                    await page.locator('[data-testid="form-condition"] select[aria-label="Valor"]').selectOption({ label: 'Email' });
                    await sleep(900);
                },
            },
            { shot: '[data-testid="form-item-inspector"]', caption: 'Pregunta que controla: «Canal». Es: «Email». La pregunta queda marcada con «si…».' },
            { shot: true, caption: 'En la vista previa se ve atenuada: aparece sola cuando alguien elige «Email».' },
            { run: clearForms },
        ],
    },
    {
        key: 'form-publicar',
        title: 'Publicar el formulario',
        setup: async (ctx) => {
            await clearForms(ctx);
            await createSupportForm(ctx);
        },
        steps: [
            { go: '/lists/{list:Tickets}/edit?s=formularios', wait: '[data-form-edit]', caption: null },
            { click: '[data-form-edit]', then: '[data-testid="form-builder"]', caption: 'Abre el formulario que quieres compartir.' },
            { wait: 1500 },
            { click: '[data-testid="form-publish"]', then: '[data-testid="form-share-panel"]', caption: 'Enciende el interruptor de publicar: desde ese momento el enlace recibe respuestas.' },
            { wait: 1500 },
            { shot: '[data-testid="form-share-panel"]', caption: 'Copia el enlace para enviarlo, o el código para insertarlo en tu sitio web.' },
            {
                run: async ({ page, base, api, lists, sleep }) => {
                    const id = lists[LIST].id;
                    const { data } = await api.get(`/lists/${id}/forms`);
                    const form = (data ?? []).find((f) => f.enabled);
                    if (!form) throw new Error('el formulario no quedó publicado');
                    await page.goto(`${base}${form.public_path}`);
                    await page.locator('form, [data-form-root], main').first().waitFor({ state: 'visible', timeout: 15000 });
                    await sleep(900);
                },
            },
            { shot: true, caption: 'Así lo ve quien abre el enlace: sin cuenta y desde cualquier celular.' },
            { run: clearForms },
        ],
    },
];
