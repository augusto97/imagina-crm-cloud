/**
 * Capturas del módulo «Fichas de registro» del centro de aprendizaje.
 *
 * Abren registros de las listas de ejemplo (Oportunidades, Tareas, Clientes).
 * Ninguna guarda nada: el comentario y el recordatorio se arman pero no se
 * envían, la barra «/» se borra antes de salir, y la apariencia de Clientes
 * se vuelve a dejar como estaba al terminar.
 */

const OPEN = '[data-tour="records-row"]';
const MODAL = '[data-testid="imcrm-record-modal"]';

/** Los ajustes de Clientes antes de la demo de apariencia, para devolverlos. */
const saved = { settings: null };

async function firstRecordId(api, slug) {
    const res = await api.get(`/lists/${slug}/records?limit=1`);
    const r = (res.data ?? [])[0];
    if (!r) throw new Error(`la lista ${slug} no tiene registros`);
    return r.id;
}

export default [
    {
        key: 'ficha-abrir-registro',
        title: 'Abrir un registro',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: OPEN },
            { click: OPEN, then: MODAL, caption: 'Haz clic en el nombre de un registro de la tabla.' },
            { wait: 1200 },
            { click: '[data-testid="imcrm-record-next"]', caption: 'Se abre su ficha encima de la lista: arriba la barra con sus acciones, al centro el título, la descripción y los campos, y a la derecha los comentarios. Con las flechas de arriba (o las teclas J y K) pasas al siguiente o al anterior sin cerrarla.' },
            { wait: 1000 },
            { shot: true, caption: 'Ya estás en el siguiente registro de la lista. Escape la cierra.' },
        ],
    },
    {
        key: 'ficha-menu-barra',
        title: 'El menú «/» de la descripción',
        steps: [
            { go: '/lists/{list:Tareas}/records', wait: OPEN },
            { click: OPEN, then: '[data-tour="record-description"]', caption: 'Abre un registro: debajo del título está la descripción.' },
            { wait: 1200 },
            { click: '[data-tour="record-description"] [contenteditable="true"]', caption: 'Haz clic en ella para escribir.' },
            {
                run: async (ctx) => {
                    await ctx.page.keyboard.press('End');
                    await ctx.page.keyboard.type('/');
                    await ctx.sleep(700);
                },
            },
            { shot: true, caption: 'Escribe «/» y se abre el menú de bloques: títulos, listas, lista de control, tabla, cita, código, imagen, video, columnas, mención de registros y más.' },
            {
                run: async (ctx) => {
                    await ctx.page.keyboard.press('Escape');
                    await ctx.page.keyboard.press('Backspace');
                    await ctx.sleep(1500);
                },
            },
        ],
    },
    {
        key: 'ficha-comentar',
        title: 'Comentar y mencionar',
        steps: [
            { go: '/lists/{list:Oportunidades}/records', wait: OPEN },
            { click: OPEN, then: MODAL, caption: 'Abre un registro.' },
            { wait: 1200 },
            { click: `${MODAL} textarea`, caption: 'Escribe en la caja de comentarios, a la derecha de la ficha.' },
            {
                run: async (ctx) => {
                    await ctx.page.keyboard.type('@La', { delay: 80 });
                    await ctx.sleep(900);
                },
            },
            { shot: true, caption: 'Con «@» aparece la lista de personas y equipos: elige a quién avisarle.' },
            {
                run: async (ctx) => {
                    await ctx.page.keyboard.press('Escape').catch(() => {});
                    await ctx.page.locator(`${MODAL} textarea`).first().fill('@Laura revisa la propuesta antes del viernes, por favor.');
                    await ctx.sleep(500);
                },
            },
            { shot: true, caption: 'Termina el mensaje y toca «Enviar». La persona mencionada recibe el aviso en su campana.' },
        ],
    },
    {
        key: 'ficha-recordarme',
        title: 'Programar un recordatorio',
        steps: [
            { go: '/lists/{list:Tareas}/records', wait: OPEN },
            { click: OPEN, then: MODAL, caption: 'Abre un registro.' },
            { wait: 1200 },
            { click: '[data-testid="record-remind"]', then: '[data-testid="reminder-form"]', caption: 'Toca el reloj de la barra de la ficha: «Recordarme».' },
            { wait: 500 },
            { fill: '[data-testid="reminder-note"]', text: 'Llamar al cliente para confirmar la entrega', caption: 'Elige cuándo (en 1 hora, hoy a las 17:00, mañana a las 9:00, en 3 días, el lunes u otra fecha) y, si quieres, deja una nota de qué tienes que hacer.' },
            { shot: '[data-testid="reminder-form"]', caption: 'Toca «Recordarme»: a esa hora te llega el aviso, y lo ves en Mi trabajo → Recordatorios.' },
        ],
    },
    {
        key: 'ficha-apariencia',
        title: 'Elegir la apariencia de la ficha',
        setup: async ({ api, lists }) => {
            const res = await api.get(`/lists/${lists.Clientes.slug}`);
            saved.settings = (res.data ?? res).settings ?? {};
        },
        steps: [
            { go: '/lists/{list:Clientes}/edit?s=apariencia', wait: 'button:has-text("Ficha diseñada")', caption: 'En la configuración de la lista, pestaña «Apariencia», eliges cómo se ve la ficha de sus registros.' },
            { click: 'button:has-text("Ficha diseñada")', then: 'button:has-text("Contacto")', caption: 'Toca «Ficha diseñada».' },
            { wait: 800 },
            { click: 'button:has-text("Contacto")', caption: 'Elige una plantilla: aquí, «Contacto», pensada para clientes.' },
            { wait: 1000 },
            {
                run: async (ctx) => {
                    const id = await firstRecordId(ctx.api, ctx.lists.Clientes.slug);
                    await ctx.page.goto(`${ctx.base}/#/lists/${ctx.lists.Clientes.slug}/records/${id}`);
                    await ctx.page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
                    await ctx.sleep(2500);
                },
            },
            { shot: true, caption: 'La ficha se arma sola con tus campos y lo vinculado. Con «Abrir el editor» la retocas a tu gusto.' },
            {
                run: async ({ api, lists }) => {
                    if (saved.settings) await api.patch(`/lists/${lists.Clientes.id}`, { settings: saved.settings });
                },
            },
        ],
    },
];
