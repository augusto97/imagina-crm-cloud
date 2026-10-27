/**
 * Capturas del módulo «Trabajo en lote» del centro de aprendizaje.
 *
 * Trabajan sobre la lista Productos (vista Tabla). Ninguna deja cambios:
 * la edición masiva se queda en la vista previa; la del historial aplica
 * una subida de precios por la API en el `setup` y la demo la deshace desde
 * la interfaz; la de la papelera crea un cliente de prueba, lo borra, lo
 * restaura en pantalla y al final lo borra para siempre.
 */

const CHECK = (n) => `input[aria-label^="Seleccionar registro"] >> nth=${n}`;
const CELL = (row, col) => `[data-tour="records-table"] tbody tr >> nth=${row} >> td >> nth=${col}`;

async function fieldsOf(api, slug) {
    const res = await api.get(`/lists/${slug}/fields`);
    return res.data ?? [];
}

async function firstIds(api, slug, n) {
    const res = await api.get(`/lists/${slug}/records?limit=${n}`);
    return (res.data ?? []).slice(0, n).map((r) => r.id);
}

/** Selecciona las tres primeras filas con sus casillas. */
const selectThree = { run: async (ctx) => {
    for (const i of [0, 1, 2]) await ctx.page.locator('input[aria-label^="Seleccionar registro"]').nth(i).check();
    await ctx.sleep(400);
} };

// Estado compartido entre el setup y la limpieza de la demo de la papelera.
const trash = { id: null };

export default [
    {
        key: 'lote-seleccionar-filas',
        title: 'Seleccionar varias filas',
        steps: [
            { go: '/lists/{list:Productos}/records', wait: '[data-tour="records-table"]' },
            { hover: CELL(0, 1), caption: 'Al pasar el mouse por una fila aparece su casilla, a la izquierda.' },
            { click: CHECK(0), caption: 'Márcala para seleccionar la fila.' },
            { click: CHECK(1), caption: 'Sigue marcando las que quieras.' },
            { click: CHECK(2), caption: null },
            { shot: '[aria-label="Acciones masivas"]', caption: 'Abajo aparece la barra de acciones: cuántos hay, editar en lote, asignar, mover, duplicar o eliminar.' },
        ],
    },
    {
        key: 'lote-menu-celda',
        title: 'Elegir celdas y su menú',
        steps: [
            { go: '/lists/{list:Productos}/records', wait: '[data-tour="records-table"]' },
            { click: CELL(1, 4), caption: 'Un clic elige una celda (no la edita).' },
            { press: 'Shift+ArrowDown', caption: null },
            { press: 'Shift+ArrowDown', caption: 'Con Mayús + flechas (o arrastrando) eliges un rango: abajo ves cuántas celdas, la suma y el promedio.' },
            { click: CELL(1, 4), right: true, caption: 'Haz clic derecho sobre el rango.' },
            { wait: 600 },
            { shot: '[role="menu"]', caption: 'El menú de la celda: editar, cortar, copiar, pegar, borrar contenido, rellenar hacia abajo, deshacer y rehacer, con sus atajos.' },
        ],
    },
    {
        key: 'lote-edicion-masiva',
        title: 'Editar en lote',
        steps: [
            { go: '/lists/{list:Productos}/records', wait: '[data-tour="records-table"]' },
            selectThree,
            { click: '[data-testid="imcrm-bulk-edit-open"]', then: '[data-testid="imcrm-bulk-edit-dialog"]', caption: 'Con tres productos elegidos, toca «Editar en lote» en la barra de abajo.' },
            {
                run: async (ctx) => {
                    const d = ctx.page.locator('[data-testid="imcrm-bulk-edit-dialog"]');
                    await d.locator('[data-testid="imcrm-bulk-field-0"]').selectOption({ label: 'Precio' });
                    await ctx.sleep(300);
                    await d.locator('[data-testid="imcrm-bulk-kind-0"]').selectOption('percent');
                    await ctx.sleep(300);
                    await d.locator('input:visible').last().fill('10');
                    await ctx.sleep(400);
                },
            },
            { click: '[data-testid="imcrm-bulk-preview-btn"]', then: '[data-testid="imcrm-bulk-preview"]', caption: 'Elige la columna y qué hacer: aquí, «Precio» → «Subir o bajar un porcentaje» 10 (puedes encadenar más con «Agregar otro cambio»). Después toca «Ver vista previa».' },
            { wait: 600 },
            { shot: '[data-testid="imcrm-bulk-edit-dialog"]', caption: 'Antes de aplicar ves cada registro con su antes y su después. Si algo no cuadra, vuelve atrás; nada cambió todavía.' },
        ],
    },
    {
        key: 'lote-historial',
        title: 'Deshacer una edición masiva',
        setup: async ({ api, lists }) => {
            const slug = lists.Productos.slug;
            const precio = (await fieldsOf(api, slug)).find((f) => f.label === 'Precio');
            if (!precio) throw new Error('Productos no tiene el campo Precio');
            const ids = await firstIds(api, slug, 3);
            await api.post(`/lists/${slug}/records/bulk-edit`, { ids, operations: [{ op: 'percent', field_id: precio.id, percent: 10 }] });
        },
        steps: [
            { go: '/lists/{list:Productos}/records', wait: '[data-tour="records-customize"]' },
            { click: '[data-tour="records-customize"]', then: 'button:has-text("Historial de ediciones masivas")', caption: 'Abre «Personalizar» en la barra de la vista.' },
            { click: 'button:has-text("Historial de ediciones masivas")', then: '[data-testid="imcrm-bulk-history"]', caption: 'Toca «Historial de ediciones masivas».' },
            { wait: 600 },
            { click: '[data-testid="imcrm-bulk-history-undo"]', then: '[data-testid="imcrm-bulk-revert-dialog"]', caption: 'Cada edición en lote queda aquí 30 días: qué se hizo, quién, cuándo y a cuántos registros. Toca «Deshacer» en la que quieres revertir.' },
            { wait: 800 },
            { click: '[data-testid="imcrm-bulk-revert-apply"]', then: '[data-testid="imcrm-bulk-revert-result"]', caption: 'Ves cuántos vuelven atrás, cómo quedan y cuáles cambió alguien después (esos se respetan, salvo que marques que vuelvan igual). Confirma con «Volver atrás».' },
            { wait: 600 },
            { shot: '[data-testid="imcrm-bulk-revert-dialog"]', caption: 'Listo: los precios volvieron a como estaban.' },
        ],
    },
    {
        key: 'lote-papelera-abrir',
        title: 'Recuperar algo de la papelera',
        setup: async ({ api, lists }) => {
            const slug = lists.Clientes.slug;
            const fields = await fieldsOf(api, slug);
            const title = fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
            if (!title) throw new Error('Clientes no tiene un campo de texto');
            const res = await api.post(`/lists/${slug}/records`, { data: { [`f${title.id}`]: 'Panadería La Espiga' } });
            trash.id = res.data?.id ?? res.id;
            await api.del(`/lists/${slug}/records/${trash.id}`);
        },
        steps: [
            { go: '/settings?s=papelera', wait: '[data-testid="trash-panel"]', caption: 'En Ajustes → Papelera está todo lo borrado de los últimos 30 días: registros, listas, campos, vistas, automatizaciones y tableros.' },
            { fill: '[data-testid="trash-search"]', text: 'Espiga', caption: 'Busca por nombre o filtra por tipo.' },
            { wait: 900 },
            { click: '[data-testid="trash-restore"]', caption: 'Toca «Restaurar».' },
            { wait: 900 },
            { shot: true, caption: 'Vuelve a su lista tal cual, con sus subtareas, vínculos, archivos y comentarios.' },
            {
                run: async ({ api, lists }) => {
                    if (!trash.id) return;
                    const slug = lists.Clientes.slug;
                    await api.del(`/lists/${slug}/records/${trash.id}`).catch(() => {});
                    await api.del(`/trash/record/${trash.id}`).catch(() => {});
                },
            },
        ],
    },
];
