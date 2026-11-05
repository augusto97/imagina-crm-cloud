/**
 * Capturas del módulo «Agenda de citas» del centro de aprendizaje.
 *
 * Usan la página de agenda que trae la plantilla «Agenda de citas» en la
 * lista Citas. Ninguna guarda cambios de configuración; la de publicar
 * publica la agenda y al terminar la vuelve a dejar sin publicar.
 */

const LIST = 'Citas';

/** La primera página de agenda de la lista. */
async function bookingPage({ api, lists }) {
    const res = await api.get(`/lists/${lists[LIST].id}/booking-pages`);
    const page = (res.data ?? [])[0];
    if (!page) throw new Error('la lista Citas no tiene página de agenda');
    return page;
}

async function setEnabled(ctx, enabled) {
    const p = await bookingPage(ctx);
    if (p.enabled !== enabled) await ctx.api.patch(`/lists/${ctx.lists[LIST].id}/booking-pages/${p.id}`, { enabled });
}

export default [
    {
        key: 'citas-editar',
        title: 'Recorrer la agenda de citas',
        steps: [
            { go: '/lists/{list:Citas}/edit?s=agenda', wait: '[data-booking-edit]' },
            { click: '[data-booking-edit]', then: '[data-testid="booking-builder"]', caption: 'En la configuración de la lista de citas, pestaña «Agenda», abre la página con «Editar».' },
            { wait: 2200 },
            { shot: true, caption: 'A la izquierda, las partes de la página en el orden en que las recorre el cliente; al centro, la página real. Toca cualquier parte, aquí o en la vista previa, para editarla.' },
            { click: '[data-outline-element="@services"] button', then: '[data-testid="booking-element-inspector"]', caption: 'Toca «Servicios».' },
            { wait: 800 },
            { shot: true, caption: 'A la derecha, el nombre, la duración y el precio de cada servicio; en «Estilo», sus colores.' },
            { click: '[data-outline-element="@staff"] button', caption: 'Toca «Quién atiende».' },
            { wait: 800 },
            { shot: true, caption: 'Las personas del equipo que reciben citas, con sus servicios y su calendario; el cliente puede elegir o tomar «El primero disponible».' },
            { click: '[data-testid="booking-tab-settings"]', then: '[data-testid="booking-settings-index"]', caption: 'Lo que no es una parte de la página está en «Ajustes».' },
            { click: '[data-booking-section="disponibilidad"]', caption: 'Toca «Horario y disponibilidad».' },
            { wait: 800 },
            { shot: true, caption: 'El horario de cada día y los días especiales. La vista previa sólo ofrece las horas que de verdad están libres.' },
        ],
    },
    {
        key: 'citas-publicar',
        title: 'Publicar la agenda',
        setup: (ctx) => setEnabled(ctx, false),
        steps: [
            { go: '/lists/{list:Citas}/edit?s=agenda', wait: '[data-booking-edit]' },
            { click: '[data-booking-edit]', then: '[data-testid="booking-builder"]', caption: 'Abre la agenda con «Editar».' },
            { wait: 1800 },
            { click: '[data-testid="booking-tab-settings"]', then: '[data-testid="booking-settings-index"]', caption: 'Ve a «Ajustes».' },
            { click: '[data-booking-section="publicar"]', then: '[data-testid="booking-publish-button"]', caption: 'Toca «Publicar».' },
            { wait: 600 },
            { click: '[data-testid="booking-publish-button"]', then: '[data-testid="booking-share-panel"]', caption: 'Toca el botón para publicar: si falta algo, la sección te dice qué.' },
            { wait: 1200 },
            { shot: '[data-testid="booking-share-panel"]', caption: 'Se abre «Compartir»: copia el enlace para tu Instagram o WhatsApp.' },
            { click: '[data-testid="booking-share-tab-embed"]', then: '[data-testid="booking-embed-demo"]', caption: 'En «Insertar en tu sitio» eliges cómo va y al lado ves cómo queda, funcionando de verdad.' },
            { wait: 1800 },
            { shot: '[data-testid="booking-share-panel"]', caption: 'Copia el código y pégalo en tu sitio web.' },
            {
                run: async (ctx) => {
                    const p = await bookingPage(ctx);
                    await ctx.page.goto(`${ctx.base}${p.public_path}`);
                    await ctx.page.locator('body').first().waitFor({ state: 'visible', timeout: 15000 });
                    await ctx.sleep(1800);
                },
            },
            { shot: true, caption: 'Así la ven tus clientes: eligen el servicio, el día y una hora libre, y dejan sus datos.' },
            { run: (ctx) => setEnabled(ctx, false) },
        ],
    },
];
