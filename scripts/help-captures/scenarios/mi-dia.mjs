/**
 * Capturas del módulo «Tu día a día» (centro de aprendizaje).
 * Corren sobre la empresa de ejemplo; lo que crean lo borran al final.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** DELETE sin cuerpo (el `api.del` del grabador manda content-type JSON y el servidor lo rechaza). */
async function del(ctx, url) {
    await ctx.page.request.fetch(`${ctx.base}/api/v1${url}`, { method: 'DELETE', headers: { 'x-tenant-id': String(ctx.tenantId) } });
}

const rows = (res) => (Array.isArray(res) ? res : (res?.data ?? []));

/** Recordatorios (ya vencidos) para que la campana tenga avisos reales. */
async function seedNotifications(ctx) {
    const { api } = ctx;
    const unread = rows(await api.get('/me/notifications?unread=1').catch(() => null));
    if (unread.length >= 3) return;
    const { data: lists } = await api.get('/lists');
    const byName = Object.fromEntries(lists.map((l) => [l.name, l]));
    const picks = [
        ['Clientes', 'Llamar para renovar el contrato', 'Clínica'],
        ['Oportunidades', 'Enviar la propuesta firmada', 'Hotel'],
        ['Tareas', 'Revisar antes de la reunión', 'Lanzamiento'],
    ];
    const past = new Date(Date.now() - 60_000).toISOString();
    for (const [name, note, q] of picks) {
        const list = byName[name];
        if (!list) continue;
        const hit = rows(await api.get(`/lists/${list.slug}/records?limit=1&search=${encodeURIComponent(q)}`).catch(() => null));
        const recs = hit.length ? hit : rows(await api.get(`/lists/${list.slug}/records?limit=3`).catch(() => null));
        const rec = recs[0];
        if (!rec) continue;
        await api.post('/me/reminders', { list_id: list.id, record_id: rec.id, remind_at: past, note }).catch(() => {});
    }
    await api.post('/me/reminders', { remind_at: past, note: 'Pagar el arriendo del local' }).catch(() => {});
    // El reloj de recordatorios corre cada minuto.
    for (let i = 0; i < 30; i++) {
        await sleep(4000);
        const n = rows(await api.get('/me/notifications?unread=1').catch(() => null));
        if (n.length >= 3) return;
    }
}

/** Recordatorios pendientes (no vencidos) para la pestaña «Recordatorios». */
async function seedPendingReminders(ctx) {
    const { api } = ctx;
    const pending = rows(await api.get('/me/reminders').catch(() => null)).filter((r) => !r.done_at && !r.fired_at);
    if (pending.length >= 2) return;
    // 9:00 y 15:30 de Bogotá (UTC-5) de los próximos días.
    const at = (days, h, m) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + days);
        d.setUTCHours(h + 5, m, 0, 0);
        return d.toISOString();
    };
    const tomorrow = at(1, 9, 0);
    const later = at(3, 15, 30);
    await api.post('/me/reminders', { remind_at: tomorrow, note: 'Revisar las facturas vencidas del mes' }).catch(() => {});
    await api.post('/me/reminders', { remind_at: later, note: 'Llamar al proveedor de café' }).catch(() => {});
}

export default [
    {
        key: 'dia-mi-trabajo',
        title: 'Mi trabajo',
        setup: seedPendingReminders,
        steps: [
            { go: '/my-work', wait: '[role="tablist"]', caption: 'Mi trabajo junta lo que tienes asignado en todas las listas, agrupado por vencimiento.' },
            { click: '[role="tab"]:has-text("Recordatorios")', caption: 'En «Recordatorios» están tus recordatorios, de registros o sueltos.' },
            { shot: '[role="tablist"]', caption: 'Desde aquí creas uno nuevo, lo marcas como hecho o lo borras.' },
            { click: '[data-tour="rail-mywork"]', caption: null },
            { shot: '[data-testid="mywork-panel"]', caption: 'El panel lateral resume cuánto está vencido, qué vence hoy y lo más urgente.' },
        ],
    },
    {
        key: 'dia-campana',
        title: 'La campana de avisos',
        setup: seedNotifications,
        steps: [
            { go: '/lists/{list:Tareas}/records', wait: '[data-tour="records-table"]', caption: 'El número rojo de la campana dice cuántos avisos no leíste.' },
            { click: '[data-tour="topbar-notifications"] button >> nth=0', caption: 'Toca la campana.', then: 'text=Marcar todo como leído' },
            { shot: '[data-testid="notification-bell"]', caption: 'La bandeja: Todos o Sin leer, y abajo Ir a Mi trabajo y Preferencias. Toca un aviso para abrir su registro.' },
        ],
    },
    {
        key: 'dia-recordarme',
        title: 'Crear un recordatorio',
        steps: [
            { go: '/lists/{list:Clientes}/records', wait: '[data-tour="records-table"]', caption: 'Abre el registro del que te quieres acordar.' },
            { click: '[data-tour="records-table"] >> text=Colegio Andino', caption: null, then: '[data-testid="record-remind"]' },
            { click: '[data-testid="record-remind"] >> nth=0', caption: 'En la barra de la ficha, toca «Recordarme» (el despertador).', then: '[data-testid="reminder-form"]' },
            { click: '[data-testid="reminder-form"] button:has-text("Mañana a las 9:00")', caption: 'Elige cuándo: por ejemplo «Mañana a las 9:00».' },
            { fill: '[data-testid="reminder-note"]', text: 'Llamar para renovar el contrato', caption: 'Escribe una nota con lo que tienes que hacer.' },
            { shot: '[data-testid="reminder-form"]', caption: 'Toca «Recordarme»: a esa hora te llega el aviso a la campana.' },
        ],
    },
    {
        key: 'dia-avisos',
        title: 'Preferencias de avisos',
        steps: [
            { go: '/settings?s=avisos', wait: 'text=Qué te llega, y por dónde', caption: 'En Ajustes → Avisos eliges qué te llega también por correo y al teléfono.' },
            { shot: 'text=Qué te llega, y por dónde', caption: 'Una fila por tipo de aviso, con su casilla de Correo y de Push. Se guarda al instante.' },
            { shot: 'text=Resumen diario por correo', caption: 'Más abajo, el resumen diario: un solo correo con lo vencido, lo de hoy y lo sin leer.' },
        ],
    },
    {
        key: 'dia-instalar',
        title: 'Instalar la app y las notificaciones',
        steps: [
            { go: '/settings?s=avisos', wait: '[data-tour="install-card"]', caption: 'Arriba de tus avisos están la app y las notificaciones de este dispositivo.' },
            { shot: '[data-tour="install-card"]', caption: '«App en este dispositivo» la instala o te muestra los pasos para tu navegador.' },
            { shot: '[data-tour="push-card"]', caption: '«Notificaciones en este dispositivo» las activa y te deja enviarte una prueba.' },
        ],
    },
    {
        key: 'dia-escaner',
        title: 'Escanear en una lista',
        steps: [
            { go: '/lists/{list:Productos}/records', wait: '[data-tour="records-table"]', caption: 'En una lista con códigos (SKU, serial, boleta), usa el botón de escanear.' },
            { click: '[data-testid="records-scan"]', caption: 'Toca «Escanear un código», junto al buscador.', then: 'role=dialog' },
            { wait: 1500 },
            { shot: '[role="dialog"]', caption: 'Elige «Un código» o «Escaneo continuo» y el campo donde buscar. Si el equipo no tiene cámara, escribe el código a mano.' },
        ],
    },
    {
        key: 'dia-favoritos',
        title: 'Anclar a favoritos',
        setup: async (ctx) => {
            // Oportunidades y Facturas ya ancladas; «Tareas» todavía no.
            const { data: lists } = await ctx.api.get('/lists');
            const ids = lists.filter((l) => l.name === 'Oportunidades' || l.name === 'Facturas').map((l) => l.id);
            await ctx.api.patch('/me/favorites', { lists: ids }).catch(() => {});
        },
        steps: [
            { go: '/lists/{list:Tareas}/records', wait: '[data-tour="panel-lists"]', caption: 'Pasa el mouse sobre una lista del panel: aparece el pin.' },
            { hover: '[data-tour="panel-lists"] li:has(a[href*="/lists/tareas/"])', caption: null },
            { click: '[data-tour="panel-lists"] li:has(a[href*="/lists/tareas/"]) button[aria-label="Anclar a favoritos"]', caption: 'Toca el pin para anclarla a favoritos.' },
            { click: '[data-tour="rail-favorites"]', caption: 'Después abre «Favoritos» en el riel.' },
            { shot: true, caption: 'Tus favoritos: listas, tableros y vistas, agrupados por carpeta o por tipo.' },
        ],
    },
];
