import {
    BLUEPRINT_VERSION,
    type BlueprintDashboard,
    type BlueprintField,
    type BlueprintList,
    type BlueprintWidget,
    type ListBlueprint,
    type TemplateCategory,
} from '@imagina-base/shared';

/**
 * Plantillas del SISTEMA (v0.1.166) — la biblioteca que trae la app, como el
 * Template Center de ClickUp o la galería de Airtable.
 *
 * Viven en código a propósito: se versionan con la app, no dependen de una
 * fila de la DB y se prueban como cualquier otra pieza. Están en el MISMO
 * formato que las plantillas del workspace (`listBlueprintSchema`), así que
 * el motor no distingue de dónde viene lo que materializa.
 *
 * Cada una trae campos con configuración real, vistas útiles y —donde tiene
 * sentido— una automatización y registros de muestra para que la lista no
 * nazca vacía (se pueden omitir al aplicar).
 */
export interface SystemTemplate {
    key: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    category: TemplateCategory;
    blueprint: ListBlueprint;
}

// ── Helpers de escritura compacta ────────────────────────────────────────

const f = (
    label: string,
    slug: string,
    type: BlueprintField['type'],
    extra: Partial<Omit<BlueprintField, 'label' | 'slug' | 'type'>> = {},
): BlueprintField => ({
    label,
    slug,
    type,
    config: {},
    is_required: false,
    is_unique: false,
    is_indexed: false,
    description: null,
    ...extra,
});

const opt = (value: string, label: string, color: string) => ({ value, label, color });
const select = (label: string, slug: string, options: Array<ReturnType<typeof opt>>) =>
    f(label, slug, 'select', { config: { options } });
const ref = (slug: string) => ({ $field: slug });
const listRef = (key: string) => ({ $list: key });
/** Campo de OTRA lista del pack (lookup/rollup a través de una relación, v0.1.171). */
const xref = (listKey: string, slug: string) => ({ $field: slug, $list: listKey });
/**
 * Lookup: muestra `otherKey.targetSlug` a través de la relación
 * `relKey.relSlug`. Las dos keys son distintas cuando la relación vive en la
 * propia lista (hacia afuera): el campo destino está del OTRO lado.
 */
const lookup = (
    label: string,
    slug: string,
    relKey: string,
    relSlug: string,
    otherKey: string,
    targetSlug: string,
    description: string,
) =>
    f(label, slug, 'lookup', {
        config: { relation_field_id: xref(relKey, relSlug), target_field_id: xref(otherKey, targetSlug) },
        description,
    });
/** Rollup hacia adentro: agrega `targetSlug` de los registros de `relKey` que apuntan acá por `relSlug`. */
const rollup = (
    label: string,
    slug: string,
    relKey: string,
    relSlug: string,
    operation: 'count' | 'sum' | 'avg' | 'min' | 'max',
    targetSlug: string | null,
    description: string,
    filter?: { slug: string; op: string; value: unknown },
) =>
    f(label, slug, 'rollup', {
        config: {
            relation_field_id: xref(relKey, relSlug),
            operation,
            ...(targetSlug ? { target_field_id: xref(relKey, targetSlug) } : {}),
            ...(filter
                ? {
                      filter_tree: {
                          type: 'group',
                          logic: 'and',
                          children: [{ type: 'condition', field_id: xref(relKey, filter.slug), op: filter.op, value: filter.value }],
                      },
                  }
                : {}),
        },
        description,
    });

const table = (name = 'Tabla', is_default = true) => ({ name, type: 'table' as const, config: {}, is_default });
const kanban = (name: string, bySlug: string) => ({
    name,
    type: 'kanban' as const,
    config: { group_by_field_id: ref(bySlug) },
    is_default: false,
});
const calendar = (name: string, dateSlug: string) => ({
    name,
    type: 'calendar' as const,
    config: { date_field_id: ref(dateSlug) },
    is_default: false,
});

const list = (
    key: string,
    name: string,
    icon: string,
    color: string,
    fields: BlueprintField[],
    rest: Partial<Omit<BlueprintList, 'key' | 'name' | 'icon' | 'color' | 'fields'>> = {},
): BlueprintList => ({
    key,
    name,
    icon,
    color,
    settings: {},
    fields,
    views: [table()],
    automations: [],
    records: [],
    ...rest,
});

const single = (l: BlueprintList, dashboards: BlueprintDashboard[] = []): ListBlueprint => ({
    version: BLUEPRINT_VERSION,
    lists: [l],
    dashboards,
});

// ── Tableros del pack (v0.1.167) ─────────────────────────────────────────
// Grilla de 12 columnas × filas de 64px. `$field` se resuelve contra la
// lista del propio widget.
const widget = (
    type: string,
    listKey: string,
    title: string,
    config: Record<string, unknown>,
    x: number,
    y: number,
    w: number,
    h: number,
): BlueprintWidget => ({ type, list: listRef(listKey), title, config, layout: { x, y, w, h } });
const kpi = (listKey: string, title: string, config: Record<string, unknown>, x: number, y = 0, w = 3) =>
    widget('kpi', listKey, title, { metric: 'count', ...config }, x, y, w, 2);
const dashboard = (name: string, description: string, widgets: BlueprintWidget[]): BlueprintDashboard => ({
    name,
    description,
    widgets,
    settings: {},
});

// ── Catálogo ─────────────────────────────────────────────────────────────

const ESTADO_LEAD = [
    opt('nuevo', 'Nuevo', 'sky'),
    opt('contactado', 'Contactado', 'blue'),
    opt('calificado', 'Calificado', 'violet'),
    opt('propuesta', 'Propuesta enviada', 'amber'),
    opt('ganado', 'Ganado', 'emerald'),
    opt('perdido', 'Perdido', 'rose'),
];

const crmClientes: SystemTemplate = {
    key: 'crm-clientes',
    name: 'CRM de clientes',
    description: 'Contactos y empresas con estado, responsable y seguimiento. La base de cualquier relación comercial.',
    icon: 'users',
    color: '#0ea5e9',
    category: 'clientes',
    blueprint: single(
        list(
            'clientes',
            'Clientes',
            'users',
            '#0ea5e9',
            [
                f('Nombre', 'nombre', 'text', { is_required: true }),
                f('Empresa', 'empresa', 'text'),
                f('Email', 'email', 'email'),
                f('Teléfono', 'telefono', 'phone'),
                select('Estado', 'estado', [
                    opt('activo', 'Activo', 'emerald'),
                    opt('prospecto', 'Prospecto', 'sky'),
                    opt('inactivo', 'Inactivo', 'slate'),
                ]),
                f('Responsable', 'responsable', 'user'),
                f('Último contacto', 'ultimo_contacto', 'date'),
                f('Ciudad', 'ciudad', 'text'),
                f('Notas', 'notas', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('nombre') },
                views: [table(), kanban('Por estado', 'estado')],
                records: [
                    { data: { nombre: 'Ana Gómez', empresa: 'Acme S.A.', email: 'ana@acme.com', estado: 'activo', ciudad: 'Bogotá' } },
                    { data: { nombre: 'Luis Pérez', empresa: 'Globex', email: 'luis@globex.com', estado: 'prospecto', ciudad: 'Medellín' } },
                    { data: { nombre: 'María Ruiz', empresa: 'Initech', estado: 'inactivo', ciudad: 'Cali' } },
                ],
            },
        ),
    ),
};

const pipelineVentas: SystemTemplate = {
    key: 'pipeline-ventas',
    name: 'Pipeline de ventas',
    description: 'Oportunidades por etapa con monto, probabilidad y fecha de cierre. Tablero kanban listo para mover tratos.',
    icon: 'target',
    color: '#a855f7',
    category: 'ventas',
    blueprint: single(
        list(
            'oportunidades',
            'Oportunidades',
            'target',
            '#a855f7',
            [
                f('Oportunidad', 'oportunidad', 'text', { is_required: true }),
                f('Cliente', 'cliente', 'text'),
                select('Etapa', 'etapa', ESTADO_LEAD),
                f('Monto', 'monto', 'currency', { config: { currency: 'USD', precision: 0 } }),
                f('Probabilidad', 'probabilidad', 'percent'),
                f('Cierre estimado', 'cierre_estimado', 'date', { config: { highlight_overdue: true } }),
                f('Responsable', 'responsable', 'user'),
                select('Origen', 'origen', [
                    opt('web', 'Web', 'sky'),
                    opt('referido', 'Referido', 'emerald'),
                    opt('evento', 'Evento', 'amber'),
                    opt('llamada', 'Llamada en frío', 'slate'),
                ]),
                f('Próximo paso', 'proximo_paso', 'text'),
            ],
            {
                settings: { title_field_id: ref('oportunidad') },
                views: [kanban('Pipeline', 'etapa'), table('Tabla', false), calendar('Cierres', 'cierre_estimado')],
                automations: [
                    {
                        name: 'Al ganar, marcar 100 %',
                        description: 'Cuando una oportunidad pasa a Ganado, la probabilidad queda en 100.',
                        trigger_type: 'record_updated',
                        trigger_config: {
                            changed_fields: ['etapa'],
                            field_filters: [{ slug: 'etapa', op: 'eq', value: 'ganado' }],
                        },
                        actions: [{ type: 'update_field', config: { values: { probabilidad: '100' } } }],
                        is_active: true,
                    },
                ],
                records: [
                    { data: { oportunidad: 'Renovación anual Acme', cliente: 'Acme S.A.', etapa: 'propuesta', monto: 12000, probabilidad: 60, origen: 'referido' } },
                    { data: { oportunidad: 'Implementación Globex', cliente: 'Globex', etapa: 'calificado', monto: 45000, probabilidad: 30, origen: 'web' } },
                    { data: { oportunidad: 'Licencias Initech', cliente: 'Initech', etapa: 'nuevo', monto: 3000, probabilidad: 10, origen: 'evento' } },
                ],
            },
        ),
    ),
};

const facturacion: SystemTemplate = {
    key: 'facturacion',
    name: 'Facturación',
    description: 'Clientes y facturas vinculadas, con vencimiento, estado de pago y aviso automático al vencer.',
    icon: 'receipt',
    color: '#22c55e',
    category: 'finanzas',
    blueprint: {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'clientes',
                'Clientes',
                'building',
                '#0ea5e9',
                [
                    f('Razón social', 'razon_social', 'text', { is_required: true }),
                    f('NIT / RUT', 'identificacion', 'text', { is_unique: true }),
                    f('Email de facturación', 'email_facturacion', 'email'),
                    f('Teléfono', 'telefono', 'phone'),
                    select('Modalidad', 'modalidad', [
                        opt('anticipado', 'Mes anticipado', 'sky'),
                        opt('vencido', 'Mes vencido', 'amber'),
                    ]),
                    f('Monto mensual', 'monto_mensual', 'currency', { config: { currency: 'USD', precision: 2 } }),
                    f('Próximo cobro', 'proximo_cobro', 'date'),
                    // v0.1.171 — el estado de cuenta del cliente, a través de
                    // Facturas.cliente: se recalcula en cada lectura.
                    rollup('Facturas', 'facturas', 'facturas', 'cliente', 'count', null,
                        'Cantidad de facturas emitidas a este cliente.'),
                    rollup('Total facturado', 'total_facturado', 'facturas', 'cliente', 'sum', 'monto',
                        'Suma del monto de todas sus facturas.'),
                    rollup('Saldo pendiente', 'saldo_pendiente', 'facturas', 'cliente', 'sum', 'monto',
                        'Lo que debe: suma de las facturas pendientes o vencidas.',
                        { slug: 'estado', op: 'in', value: ['pendiente', 'vencida'] }),
                    rollup('Última factura', 'ultima_factura', 'facturas', 'cliente', 'max', 'emision',
                        'Fecha de emisión de la factura más reciente.'),
                ],
                {
                    settings: { title_field_id: ref('razon_social') },
                    records: [
                        { key: 'c1', data: { razon_social: 'Acme S.A.', identificacion: '900123456', modalidad: 'anticipado', monto_mensual: 250 } },
                        { key: 'c2', data: { razon_social: 'Globex', identificacion: '900654321', modalidad: 'vencido', monto_mensual: 480 } },
                    ],
                },
            ),
            list(
                'facturas',
                'Facturas',
                'receipt',
                '#22c55e',
                [
                    f('Número', 'numero', 'text', { is_required: true }),
                    f('Cliente', 'cliente', 'relation', { config: { target_list_id: listRef('clientes') } }),
                    f('Monto', 'monto', 'currency', { config: { currency: 'USD', precision: 2 } }),
                    f('Emisión', 'emision', 'date'),
                    f('Vencimiento', 'vencimiento', 'date', { config: { highlight_overdue: true } }),
                    select('Estado', 'estado', [
                        opt('pendiente', 'Pendiente', 'amber'),
                        opt('pagada', 'Pagada', 'emerald'),
                        opt('vencida', 'Vencida', 'rose'),
                        opt('anulada', 'Anulada', 'slate'),
                    ]),
                    f('Período', 'periodo', 'text'),
                    // v0.1.171 — datos del cliente a la vista en la factura
                    // (para el envío y el recibo), sin abrir su ficha.
                    lookup('Email del cliente', 'email_cliente', 'facturas', 'cliente', 'clientes', 'email_facturacion',
                        'El email de facturación del cliente vinculado.'),
                    lookup('NIT del cliente', 'nit_cliente', 'facturas', 'cliente', 'clientes', 'identificacion',
                        'La identificación del cliente vinculado.'),
                ],
                {
                    settings: { title_field_id: ref('numero') },
                    views: [table(), kanban('Por estado', 'estado'), calendar('Vencimientos', 'vencimiento')],
                    automations: [
                        {
                            name: 'Marcar vencida',
                            description: 'Al llegar la fecha de vencimiento, si sigue pendiente pasa a Vencida.',
                            trigger_type: 'due_date_reached',
                            trigger_config: {
                                due_field: 'vencimiento',
                                offset_minutes: 0,
                                field_filters: [{ slug: 'estado', op: 'eq', value: 'pendiente' }],
                            },
                            actions: [{ type: 'update_field', config: { values: { estado: 'vencida' } } }],
                            is_active: true,
                        },
                    ],
                    records: [
                        { data: { numero: 'F-0001', monto: 250, estado: 'pagada', periodo: 'Enero' }, relations: { cliente: ['c1'] } },
                        { data: { numero: 'F-0002', monto: 480, estado: 'pendiente', periodo: 'Enero' }, relations: { cliente: ['c2'] } },
                    ],
                },
            ),
        ],
        dashboards: [
            dashboard('Cartera', 'Facturado, estado de pago y vencimientos.', [
                kpi('facturas', 'Facturas', { icon: 'receipt' }, 0),
                kpi('facturas', 'Facturado', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'wallet' }, 3),
                kpi('facturas', 'Pendiente de cobro', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'flag', filter_tree: { type: 'condition', field_id: ref('estado'), op: 'eq', value: 'pendiente' } }, 6),
                // v0.1.171 — el KPI filtra por el ROLLUP de la otra lista:
                // "clientes que deben" sale del saldo, no de una marca a mano.
                kpi('clientes', 'Clientes con saldo', { icon: 'users', filter_tree: { type: 'condition', field_id: ref('saldo_pendiente'), op: 'gt', value: 0 } }, 9),
                widget('chart_pie', 'facturas', 'Por estado de pago', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('estado'), center_label: 'Total' }, 0, 2, 6, 4),
                widget('chart_bar', 'facturas', 'Vencimientos por mes', { metric: 'sum', metric_field_id: ref('monto'), date_field_id: ref('vencimiento'), time_bucket: 'month' }, 6, 2, 6, 4),
                widget('table', 'facturas', 'Próximos vencimientos', { limit: 8, sort_field_id: ref('vencimiento'), sort_dir: 'asc' }, 0, 6, 12, 4),
            ]),
        ],
    },
};

const proyectos: SystemTemplate = {
    key: 'proyectos-tareas',
    name: 'Proyectos y tareas',
    description: 'Tareas con estado, prioridad, responsable y fecha límite. Kanban por estado y calendario de entregas.',
    icon: 'clipboard',
    color: '#eab308',
    category: 'proyectos',
    blueprint: single(
        list(
            'tareas',
            'Tareas',
            'clipboard',
            '#eab308',
            [
                f('Tarea', 'tarea', 'text', { is_required: true }),
                select('Estado', 'estado', [
                    opt('pendiente', 'Pendiente', 'slate'),
                    opt('en_curso', 'En curso', 'sky'),
                    opt('revision', 'En revisión', 'violet'),
                    opt('hecha', 'Hecha', 'emerald'),
                ]),
                select('Prioridad', 'prioridad', [
                    opt('alta', 'Alta', 'rose'),
                    opt('media', 'Media', 'amber'),
                    opt('baja', 'Baja', 'slate'),
                ]),
                f('Responsable', 'responsable', 'user'),
                f('Fecha límite', 'fecha_limite', 'date', { config: { highlight_overdue: true } }),
                f('Estimación', 'estimacion', 'duration'),
                f('Avance', 'avance', 'percent'),
                f('Proyecto', 'proyecto', 'text'),
                f('Etiquetas', 'etiquetas', 'multi_select', {
                    config: {
                        options: [opt('diseno', 'Diseño', 'pink'), opt('desarrollo', 'Desarrollo', 'blue'), opt('marketing', 'Marketing', 'orange')],
                    },
                }),
            ],
            {
                settings: { title_field_id: ref('tarea') },
                views: [kanban('Tablero', 'estado'), table('Tabla', false), calendar('Entregas', 'fecha_limite')],
                automations: [
                    {
                        name: 'Hecha = 100 % de avance',
                        description: null,
                        trigger_type: 'record_updated',
                        trigger_config: {
                            changed_fields: ['estado'],
                            field_filters: [{ slug: 'estado', op: 'eq', value: 'hecha' }],
                        },
                        actions: [{ type: 'update_field', config: { values: { avance: '100' } } }],
                        is_active: true,
                    },
                ],
                records: [
                    { key: 't1', data: { tarea: 'Lanzamiento del sitio', estado: 'en_curso', prioridad: 'alta', proyecto: 'Web 2026', avance: 40 } },
                    { data: { tarea: 'Diseñar la portada', estado: 'hecha', prioridad: 'media', proyecto: 'Web 2026', avance: 100 }, parent_key: 't1' },
                    { data: { tarea: 'Configurar dominio', estado: 'pendiente', prioridad: 'alta', proyecto: 'Web 2026' }, parent_key: 't1' },
                    { data: { tarea: 'Campaña de redes', estado: 'pendiente', prioridad: 'baja', proyecto: 'Marketing Q4' } },
                ],
            },
        ),
    ),
};

const soporte: SystemTemplate = {
    key: 'soporte-tickets',
    name: 'Soporte / Tickets',
    description: 'Solicitudes con canal, prioridad, asignado y SLA. Para atender clientes sin perder ninguna.',
    icon: 'lifebuoy',
    color: '#ef4444',
    category: 'operaciones',
    blueprint: single(
        list(
            'tickets',
            'Tickets',
            'lifebuoy',
            '#ef4444',
            [
                f('Asunto', 'asunto', 'text', { is_required: true }),
                f('Solicitante', 'solicitante', 'text'),
                f('Email', 'email', 'email'),
                select('Canal', 'canal', [
                    opt('email', 'Email', 'sky'),
                    opt('whatsapp', 'WhatsApp', 'emerald'),
                    opt('telefono', 'Teléfono', 'amber'),
                    opt('web', 'Formulario web', 'violet'),
                ]),
                select('Estado', 'estado', [
                    opt('abierto', 'Abierto', 'rose'),
                    opt('en_proceso', 'En proceso', 'amber'),
                    opt('esperando', 'Esperando al cliente', 'slate'),
                    opt('resuelto', 'Resuelto', 'emerald'),
                ]),
                select('Prioridad', 'prioridad', [
                    opt('urgente', 'Urgente', 'rose'),
                    opt('alta', 'Alta', 'orange'),
                    opt('normal', 'Normal', 'sky'),
                    opt('baja', 'Baja', 'slate'),
                ]),
                f('Asignado a', 'asignado', 'user'),
                f('Vence (SLA)', 'vence', 'datetime', { config: { highlight_overdue: true } }),
                f('Satisfacción', 'satisfaccion', 'rating', { config: { max: 5 } }),
                f('Descripción', 'descripcion', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('asunto') },
                views: [table(), kanban('Por estado', 'estado')],
                records: [
                    { data: { asunto: 'No puedo iniciar sesión', solicitante: 'Carlos Díaz', canal: 'email', estado: 'abierto', prioridad: 'alta' } },
                    { data: { asunto: 'Factura duplicada', solicitante: 'Ana Gómez', canal: 'whatsapp', estado: 'en_proceso', prioridad: 'normal' } },
                ],
            },
        ),
    ),
};

const inventario: SystemTemplate = {
    key: 'inventario',
    name: 'Inventario',
    description: 'Productos con SKU, stock, mínimo y proveedor. Aviso automático cuando el stock baja del mínimo.',
    icon: 'package',
    color: '#f97316',
    category: 'operaciones',
    blueprint: single(
        list(
            'productos',
            'Productos',
            'package',
            '#f97316',
            [
                f('Producto', 'producto', 'text', { is_required: true }),
                f('SKU', 'sku', 'text', { is_unique: true }),
                select('Categoría', 'categoria', [
                    opt('hardware', 'Hardware', 'slate'),
                    opt('software', 'Software', 'violet'),
                    opt('servicio', 'Servicio', 'sky'),
                    opt('consumible', 'Consumible', 'amber'),
                ]),
                f('Stock', 'stock', 'number', { config: { precision: 0 } }),
                f('Stock mínimo', 'stock_minimo', 'number', { config: { precision: 0 } }),
                f('Precio', 'precio', 'currency', { config: { currency: 'USD', precision: 2 } }),
                f('Proveedor', 'proveedor', 'text'),
                f('Activo', 'activo', 'checkbox'),
                f('Ubicación', 'ubicacion', 'text'),
            ],
            {
                settings: { title_field_id: ref('producto') },
                views: [table(), kanban('Por categoría', 'categoria')],
                records: [
                    { data: { producto: 'Monitor 27"', sku: 'MON-27', categoria: 'hardware', stock: 12, stock_minimo: 5, precio: 220, activo: true } },
                    { data: { producto: 'Licencia anual', sku: 'LIC-01', categoria: 'software', stock: 40, stock_minimo: 10, precio: 99, activo: true } },
                    { data: { producto: 'Cable HDMI', sku: 'CAB-HD', categoria: 'consumible', stock: 3, stock_minimo: 10, precio: 8, activo: true } },
                ],
            },
        ),
    ),
};

const reclutamiento: SystemTemplate = {
    key: 'reclutamiento',
    name: 'Reclutamiento',
    description: 'Vacantes con sus candidatos vinculados: cada vacante muestra cuántos postulan, cuántos avanzan y su evaluación media.',
    icon: 'briefcase',
    color: '#14b8a6',
    category: 'personas',
    blueprint: {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'vacantes',
                'Vacantes',
                'briefcase',
                '#14b8a6',
                [
                    f('Vacante', 'vacante', 'text', { is_required: true }),
                    select('Área', 'area', [
                        opt('producto', 'Producto', 'violet'),
                        opt('tecnologia', 'Tecnología', 'sky'),
                        opt('comercial', 'Comercial', 'amber'),
                        opt('operaciones', 'Operaciones', 'emerald'),
                    ]),
                    select('Estado', 'estado', [
                        opt('abierta', 'Abierta', 'emerald'),
                        opt('en_proceso', 'En proceso', 'sky'),
                        opt('cerrada', 'Cerrada', 'slate'),
                    ]),
                    f('Apertura', 'apertura', 'date'),
                    f('Responsable', 'responsable', 'user'),
                    f('Salario ofrecido', 'salario', 'currency', { config: { currency: 'USD', precision: 0 } }),
                    f('Descripción', 'descripcion', 'long_text'),
                    // v0.1.171 — el estado del proceso se lee de los candidatos.
                    rollup('Candidatos', 'candidatos', 'candidatos', 'vacante', 'count', null,
                        'Cuántas personas postularon a esta vacante.'),
                    rollup('En proceso', 'en_proceso', 'candidatos', 'vacante', 'count', null,
                        'Candidatos en entrevista, prueba técnica u oferta.',
                        { slug: 'etapa', op: 'in', value: ['entrevista', 'prueba', 'oferta'] }),
                    rollup('Contratados', 'contratados', 'candidatos', 'vacante', 'count', null,
                        'Candidatos ya contratados para esta vacante.',
                        { slug: 'etapa', op: 'eq', value: 'contratado' }),
                    rollup('Evaluación media', 'evaluacion_media', 'candidatos', 'vacante', 'avg', 'evaluacion',
                        'Promedio de la evaluación de sus candidatos.'),
                ],
                {
                    settings: { title_field_id: ref('vacante') },
                    views: [table(), kanban('Por estado', 'estado')],
                    records: [
                        { key: 'v1', data: { vacante: 'Diseñador/a UX', area: 'producto', estado: 'en_proceso', salario: 2200 } },
                        { key: 'v2', data: { vacante: 'Desarrollador/a backend', area: 'tecnologia', estado: 'abierta', salario: 3000 } },
                    ],
                },
            ),
            list(
                'candidatos',
                'Candidatos',
                'users',
                '#0ea5e9',
                [
                    f('Candidato', 'candidato', 'text', { is_required: true }),
                    f('Vacante', 'vacante', 'relation', { config: { target_list_id: listRef('vacantes') } }),
                    f('Email', 'email', 'email'),
                    f('Teléfono', 'telefono', 'phone'),
                    select('Etapa', 'etapa', [
                        opt('recibido', 'CV recibido', 'slate'),
                        opt('entrevista', 'Entrevista', 'sky'),
                        opt('prueba', 'Prueba técnica', 'violet'),
                        opt('oferta', 'Oferta', 'amber'),
                        opt('contratado', 'Contratado', 'emerald'),
                        opt('descartado', 'Descartado', 'rose'),
                    ]),
                    select('Fuente', 'fuente', [
                        opt('linkedin', 'LinkedIn', 'blue'),
                        opt('referido', 'Referido', 'emerald'),
                        opt('portal', 'Portal de empleo', 'amber'),
                    ]),
                    f('Evaluación', 'evaluacion', 'rating', { config: { max: 5 } }),
                    f('Entrevista', 'entrevista', 'datetime'),
                    f('Entrevistador', 'entrevistador', 'user'),
                    f('CV', 'cv', 'file'),
                    f('Notas', 'notas', 'long_text'),
                    // El área y el salario viven en la vacante: acá se leen.
                    lookup('Área', 'area_vacante', 'candidatos', 'vacante', 'vacantes', 'area',
                        'El área de la vacante a la que postula.'),
                    lookup('Salario de la vacante', 'salario_vacante', 'candidatos', 'vacante', 'vacantes', 'salario',
                        'Lo que ofrece la vacante, para la conversación con el candidato.'),
                ],
                {
                    settings: { title_field_id: ref('candidato') },
                    views: [kanban('Proceso', 'etapa'), table('Tabla', false), calendar('Entrevistas', 'entrevista')],
                    records: [
                        { data: { candidato: 'Laura Martínez', etapa: 'entrevista', fuente: 'linkedin', evaluacion: 4 }, relations: { vacante: ['v1'] } },
                        { data: { candidato: 'Jorge Herrera', etapa: 'recibido', fuente: 'portal' }, relations: { vacante: ['v2'] } },
                        { data: { candidato: 'Sofía Ruiz', etapa: 'oferta', fuente: 'referido', evaluacion: 5 }, relations: { vacante: ['v1'] } },
                    ],
                },
            ),
        ],
        dashboards: [
            dashboard('Selección', 'Vacantes abiertas, embudo de candidatos y contrataciones.', [
                kpi('vacantes', 'Vacantes abiertas', { icon: 'briefcase', filter_tree: { type: 'condition', field_id: ref('estado'), op: 'neq', value: 'cerrada' } }, 0),
                kpi('candidatos', 'Candidatos', { icon: 'users' }, 3),
                kpi('candidatos', 'Contratados', { icon: 'check', filter_tree: { type: 'condition', field_id: ref('etapa'), op: 'eq', value: 'contratado' } }, 6),
                kpi('candidatos', 'Evaluación media', { metric: 'avg', metric_field_id: ref('evaluacion'), icon: 'star' }, 9),
                widget('chart_funnel', 'candidatos', 'Embudo de selección', { metric: 'count', group_by_field_id: ref('etapa') }, 0, 2, 6, 4),
                widget('chart_pie', 'candidatos', 'Por fuente', { metric: 'count', group_by_field_id: ref('fuente') }, 6, 2, 6, 4),
                widget('table', 'vacantes', 'Vacantes y su avance', { limit: 8, sort_field_id: ref('apertura'), sort_dir: 'desc' }, 0, 6, 12, 4),
            ]),
        ],
    },
};

const eventos: SystemTemplate = {
    key: 'eventos',
    name: 'Eventos e invitados',
    description: 'Eventos con su lista de invitados vinculada: confirmados y personas esperadas se cuentan solos.',
    icon: 'calendar',
    color: '#ec4899',
    category: 'otros',
    blueprint: {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'eventos',
                'Eventos',
                'calendar',
                '#ec4899',
                [
                    f('Evento', 'evento', 'text', { is_required: true }),
                    f('Fecha', 'fecha', 'date'),
                    f('Lugar', 'lugar', 'text'),
                    f('Capacidad', 'capacidad', 'number', { config: { precision: 0 } }),
                    select('Estado', 'estado', [
                        opt('planificado', 'Planificado', 'slate'),
                        opt('confirmado', 'Confirmado', 'sky'),
                        opt('realizado', 'Realizado', 'emerald'),
                        opt('cancelado', 'Cancelado', 'rose'),
                    ]),
                    f('Notas', 'notas', 'long_text'),
                    // v0.1.171 — la asistencia se cuenta sola desde Invitados.
                    rollup('Invitados', 'invitados', 'invitados', 'evento', 'count', null,
                        'Cuántas personas están invitadas a este evento.'),
                    rollup('Confirmados', 'confirmados', 'invitados', 'evento', 'count', null,
                        'Invitados que confirmaron asistencia.',
                        { slug: 'confirmacion', op: 'eq', value: 'confirmado' }),
                    rollup('Acompañantes', 'acompanantes', 'invitados', 'evento', 'sum', 'acompanantes',
                        'Acompañantes que traen los que ya confirmaron.',
                        { slug: 'confirmacion', op: 'eq', value: 'confirmado' }),
                    // Un calculado SOBRE dos rollups: personas a sentar.
                    f('Personas esperadas', 'personas', 'computed', {
                        config: { operation: 'sum', inputs: [ref('confirmados'), ref('acompanantes')] },
                        description: 'Confirmados + sus acompañantes: lo que hay que sentar.',
                    }),
                ],
                {
                    settings: { title_field_id: ref('evento') },
                    views: [table(), calendar('Calendario', 'fecha'), kanban('Por estado', 'estado')],
                    records: [
                        { key: 'e1', data: { evento: 'Lanzamiento de producto', lugar: 'Auditorio central', capacidad: 120, estado: 'confirmado' } },
                        { key: 'e2', data: { evento: 'Cena de fin de año', lugar: 'Salón Norte', capacidad: 80, estado: 'planificado' } },
                    ],
                },
            ),
            list(
                'invitados',
                'Invitados',
                'users',
                '#a855f7',
                [
                    f('Invitado', 'invitado', 'text', { is_required: true }),
                    f('Evento', 'evento', 'relation', { config: { target_list_id: listRef('eventos') } }),
                    f('Email', 'email', 'email'),
                    f('Teléfono', 'telefono', 'phone'),
                    select('Confirmación', 'confirmacion', [
                        opt('pendiente', 'Pendiente', 'slate'),
                        opt('confirmado', 'Confirmado', 'emerald'),
                        opt('no_asiste', 'No asiste', 'rose'),
                    ]),
                    f('Acompañantes', 'acompanantes', 'number', { config: { precision: 0 } }),
                    f('Mesa', 'mesa', 'text'),
                    f('Restricciones', 'restricciones', 'long_text'),
                    // La fecha y el lugar viven en el evento: no se re-tipean.
                    lookup('Fecha del evento', 'fecha_evento', 'invitados', 'evento', 'eventos', 'fecha',
                        'La fecha del evento al que está invitado.'),
                    lookup('Lugar', 'lugar_evento', 'invitados', 'evento', 'eventos', 'lugar',
                        'El lugar del evento al que está invitado.'),
                ],
                {
                    settings: { title_field_id: ref('invitado') },
                    views: [table(), kanban('Confirmaciones', 'confirmacion')],
                    records: [
                        { data: { invitado: 'María Salas', confirmacion: 'confirmado', acompanantes: 1, mesa: '3' }, relations: { evento: ['e1'] } },
                        { data: { invitado: 'Pedro Lima', confirmacion: 'pendiente' }, relations: { evento: ['e1'] } },
                        { data: { invitado: 'Ana Duarte', confirmacion: 'confirmado', acompanantes: 2 }, relations: { evento: ['e2'] } },
                    ],
                },
            ),
        ],
        dashboards: [
            dashboard('Asistencia', 'Confirmaciones y personas esperadas por evento.', [
                kpi('eventos', 'Eventos', { icon: 'calendar' }, 0),
                kpi('invitados', 'Invitados', { icon: 'users' }, 3),
                kpi('invitados', 'Confirmados', { icon: 'check', filter_tree: { type: 'condition', field_id: ref('confirmacion'), op: 'eq', value: 'confirmado' } }, 6),
                kpi('eventos', 'Personas esperadas', { metric: 'sum', metric_field_id: ref('confirmados'), icon: 'users' }, 9),
                widget('chart_pie', 'invitados', 'Estado de las confirmaciones', { metric: 'count', group_by_field_id: ref('confirmacion') }, 0, 2, 6, 4),
                widget('table', 'eventos', 'Próximos eventos', { limit: 8, sort_field_id: ref('fecha'), sort_dir: 'asc' }, 6, 2, 6, 4),
            ]),
        ],
    },
};

// ── Más plantillas (v0.1.167) ────────────────────────────────────────────

const gastos: SystemTemplate = {
    key: 'gastos',
    name: 'Control de gastos',
    description: 'Gastos por categoría con monto, fecha, quién pagó, comprobante y aprobación. Tablero de dónde se va la plata.',
    icon: 'wallet',
    color: '#22c55e',
    category: 'finanzas',
    blueprint: single(
        list(
            'gastos',
            'Gastos',
            'wallet',
            '#22c55e',
            [
                f('Concepto', 'concepto', 'text', { is_required: true }),
                select('Categoría', 'categoria', [
                    opt('oficina', 'Oficina', 'slate'),
                    opt('viajes', 'Viajes', 'sky'),
                    opt('software', 'Software', 'violet'),
                    opt('marketing', 'Marketing', 'orange'),
                    opt('servicios', 'Servicios', 'amber'),
                    opt('otros', 'Otros', 'pink'),
                ]),
                f('Monto', 'monto', 'currency', { config: { currency: 'USD', precision: 2 }, is_required: true }),
                f('Fecha', 'fecha', 'date', { is_required: true }),
                f('Pagado por', 'pagado_por', 'user'),
                f('Proveedor', 'proveedor', 'text'),
                f('Comprobante', 'comprobante', 'file'),
                f('Aprobado', 'aprobado', 'checkbox'),
                f('Notas', 'notas', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('concepto') },
                views: [table(), kanban('Por categoría', 'categoria'), calendar('Por fecha', 'fecha')],
                records: [
                    { data: { concepto: 'Hosting mensual', categoria: 'software', monto: 49, aprobado: true } },
                    { data: { concepto: 'Pasajes a Bogotá', categoria: 'viajes', monto: 320, aprobado: false } },
                    { data: { concepto: 'Anuncios en redes', categoria: 'marketing', monto: 150, aprobado: true } },
                ],
            },
        ),
        [
            dashboard('Gastos', 'Cuánto se gasta, en qué y cuándo.', [
                kpi('gastos', 'Gastos registrados', { icon: 'wallet' }, 0),
                kpi('gastos', 'Total', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'receipt' }, 3),
                kpi('gastos', 'Promedio', { metric: 'avg', metric_field_id: ref('monto'), prefix: '$' }, 6),
                kpi('gastos', 'Sin aprobar', { metric: 'count_false', metric_field_id: ref('aprobado'), icon: 'flag' }, 9),
                widget('chart_pie', 'gastos', 'Por categoría', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('categoria'), center_label: 'Total' }, 0, 2, 6, 4),
                widget('chart_bar', 'gastos', 'Por mes', { metric: 'sum', metric_field_id: ref('monto'), date_field_id: ref('fecha'), time_bucket: 'month' }, 6, 2, 6, 4),
                widget('table', 'gastos', 'Últimos gastos', { limit: 8, sort_field_id: ref('fecha'), sort_dir: 'desc' }, 0, 6, 12, 4),
            ]),
        ],
    ),
};

const contratos: SystemTemplate = {
    key: 'contratos-suscripciones',
    name: 'Contratos y suscripciones',
    description: 'Servicios contratados con valor, periodicidad y fecha de renovación. Se marcan vencidos solos al pasar la fecha.',
    icon: 'file_text',
    color: '#6366f1',
    category: 'finanzas',
    blueprint: single(
        list(
            'contratos',
            'Contratos',
            'file_text',
            '#6366f1',
            [
                f('Cliente', 'cliente', 'text', { is_required: true }),
                f('Servicio', 'servicio', 'text'),
                select('Estado', 'estado', [
                    opt('activo', 'Activo', 'emerald'),
                    opt('pausado', 'Pausado', 'amber'),
                    opt('vencido', 'Vencido', 'rose'),
                    opt('cancelado', 'Cancelado', 'slate'),
                ]),
                f('Inicio', 'inicio', 'date'),
                f('Renovación', 'renovacion', 'date', { config: { highlight_overdue: true } }),
                f('Valor', 'valor', 'currency', { config: { currency: 'USD', precision: 2 } }),
                select('Periodicidad', 'periodicidad', [
                    opt('mensual', 'Mensual', 'sky'),
                    opt('trimestral', 'Trimestral', 'violet'),
                    opt('anual', 'Anual', 'amber'),
                ]),
                f('Responsable', 'responsable', 'user'),
                f('Contrato firmado', 'documento', 'file'),
            ],
            {
                settings: { title_field_id: ref('cliente') },
                views: [table(), kanban('Por estado', 'estado'), calendar('Renovaciones', 'renovacion')],
                automations: [
                    {
                        name: 'Marcar vencido al pasar la renovación',
                        description: 'Si llega la fecha de renovación y sigue activo, pasa a Vencido.',
                        trigger_type: 'due_date_reached',
                        trigger_config: {
                            due_field: 'renovacion',
                            offset_minutes: 0,
                            field_filters: [{ slug: 'estado', op: 'eq', value: 'activo' }],
                        },
                        actions: [{ type: 'update_field', config: { values: { estado: 'vencido' } } }],
                        is_active: true,
                    },
                ],
                records: [
                    { data: { cliente: 'Acme S.A.', servicio: 'Soporte premium', estado: 'activo', valor: 300, periodicidad: 'mensual' } },
                    { data: { cliente: 'Globex', servicio: 'Licencia anual', estado: 'activo', valor: 1200, periodicidad: 'anual' } },
                ],
            },
        ),
        [
            dashboard('Contratos', 'Ingresos recurrentes y renovaciones.', [
                kpi('contratos', 'Contratos', { icon: 'file_text' }, 0),
                kpi('contratos', 'Activos', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('estado'), op: 'eq', value: 'activo' }, icon: 'check_square' }, 3),
                kpi('contratos', 'Valor contratado', { metric: 'sum', metric_field_id: ref('valor'), prefix: '$', icon: 'wallet' }, 6),
                widget('stat_delta', 'contratos', 'Renovaciones (30 días)', { metric: 'count', date_field_id: ref('renovacion'), period_days: 30 }, 9, 0, 3, 2),
                widget('chart_pie', 'contratos', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 0, 2, 4, 4),
                widget('chart_bar', 'contratos', 'Valor por periodicidad', { metric: 'sum', metric_field_id: ref('valor'), group_by_field_id: ref('periodicidad') }, 4, 2, 8, 4),
                widget('table', 'contratos', 'Próximas renovaciones', { limit: 8, sort_field_id: ref('renovacion'), sort_dir: 'asc' }, 0, 6, 12, 4),
            ]),
        ],
    ),
};

const contenidos: SystemTemplate = {
    key: 'calendario-contenidos',
    name: 'Calendario de contenidos',
    description: 'Publicaciones por canal y estado, con fecha, responsable y enlace. Kanban editorial y calendario de salidas.',
    icon: 'megaphone',
    color: '#f97316',
    category: 'otros',
    blueprint: single(
        list(
            'contenidos',
            'Contenidos',
            'megaphone',
            '#f97316',
            [
                f('Título', 'titulo', 'text', { is_required: true }),
                f('Canales', 'canales', 'multi_select', {
                    config: {
                        options: [
                            opt('instagram', 'Instagram', 'pink'),
                            opt('linkedin', 'LinkedIn', 'blue'),
                            opt('blog', 'Blog', 'amber'),
                            opt('youtube', 'YouTube', 'rose'),
                            opt('newsletter', 'Newsletter', 'violet'),
                        ],
                    },
                }),
                select('Estado', 'estado', [
                    opt('idea', 'Idea', 'slate'),
                    opt('borrador', 'Borrador', 'sky'),
                    opt('revision', 'En revisión', 'violet'),
                    opt('programado', 'Programado', 'amber'),
                    opt('publicado', 'Publicado', 'emerald'),
                ]),
                f('Publicación', 'publicacion', 'date'),
                f('Responsable', 'responsable', 'user'),
                f('Enlace', 'enlace', 'url'),
                f('Pieza', 'pieza', 'file'),
                f('Guion / notas', 'notas', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('titulo') },
                views: [kanban('Editorial', 'estado'), table('Tabla', false), calendar('Salidas', 'publicacion')],
                records: [
                    { data: { titulo: 'Lanzamiento de la nueva versión', canales: ['linkedin', 'blog'], estado: 'borrador' } },
                    { data: { titulo: 'Tips de productividad', canales: ['instagram'], estado: 'idea' } },
                ],
            },
        ),
    ),
};

const incidencias: SystemTemplate = {
    key: 'incidencias-bugs',
    name: 'Incidencias / Bugs',
    description: 'Errores reportados con severidad, estado, módulo y asignado. Para equipos de producto o de TI interna.',
    icon: 'bug',
    color: '#ef4444',
    category: 'proyectos',
    blueprint: single(
        list(
            'incidencias',
            'Incidencias',
            'bug',
            '#ef4444',
            [
                f('Título', 'titulo', 'text', { is_required: true }),
                select('Severidad', 'severidad', [
                    opt('critica', 'Crítica', 'rose'),
                    opt('alta', 'Alta', 'orange'),
                    opt('media', 'Media', 'amber'),
                    opt('baja', 'Baja', 'slate'),
                ]),
                select('Estado', 'estado', [
                    opt('nueva', 'Nueva', 'sky'),
                    opt('confirmada', 'Confirmada', 'violet'),
                    opt('en_curso', 'En curso', 'amber'),
                    opt('resuelta', 'Resuelta', 'emerald'),
                    opt('cerrada', 'Cerrada', 'slate'),
                ]),
                f('Módulo', 'modulo', 'text'),
                f('Reportado por', 'reportado_por', 'text'),
                f('Asignado a', 'asignado', 'user'),
                f('Reportada el', 'fecha', 'date'),
                f('Pasos para reproducir', 'pasos', 'long_text'),
                f('Captura', 'captura', 'file'),
            ],
            {
                settings: { title_field_id: ref('titulo') },
                views: [table(), kanban('Por estado', 'estado')],
                records: [
                    { data: { titulo: 'El login no carga en Safari', severidad: 'alta', estado: 'confirmada', modulo: 'Acceso' } },
                    { data: { titulo: 'Tilde mal en el correo de bienvenida', severidad: 'baja', estado: 'nueva', modulo: 'Correo' } },
                ],
            },
        ),
        [
            dashboard('Incidencias', 'Cuántas hay abiertas, qué tan graves y quién las tiene.', [
                kpi('incidencias', 'Incidencias', { icon: 'bug' }, 0, 0, 4),
                kpi('incidencias', 'Críticas', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('severidad'), op: 'eq', value: 'critica' }, icon: 'flag' }, 4, 0, 4),
                widget('stat_delta', 'incidencias', 'Reportadas (7 días)', { metric: 'count', date_field_id: ref('fecha'), period_days: 7 }, 8, 0, 4, 2),
                widget('chart_pie', 'incidencias', 'Por severidad', { metric: 'count', group_by_field_id: ref('severidad') }, 0, 2, 4, 4),
                widget('chart_bar', 'incidencias', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 4, 2, 4, 4),
                widget('chart_bar', 'incidencias', 'Por asignado', { metric: 'count', group_by_field_id: ref('asignado'), hide_zero_groups: true }, 8, 2, 4, 4),
            ]),
        ],
    ),
};

const activos: SystemTemplate = {
    key: 'activos-equipos',
    name: 'Activos y equipos',
    description: 'Computadores, teléfonos, vehículos y mobiliario: a quién están asignados, en qué estado y cuándo vence la garantía.',
    icon: 'layers',
    color: '#64748b',
    category: 'operaciones',
    blueprint: single(
        list(
            'activos',
            'Activos',
            'layers',
            '#64748b',
            [
                f('Activo', 'nombre', 'text', { is_required: true }),
                select('Tipo', 'tipo', [
                    opt('laptop', 'Laptop', 'sky'),
                    opt('monitor', 'Monitor', 'violet'),
                    opt('telefono', 'Teléfono', 'emerald'),
                    opt('vehiculo', 'Vehículo', 'amber'),
                    opt('mobiliario', 'Mobiliario', 'slate'),
                    opt('otro', 'Otro', 'pink'),
                ]),
                f('Serie / placa', 'serie', 'text', { is_unique: true }),
                f('Asignado a', 'asignado_a', 'user'),
                select('Estado', 'estado', [
                    opt('en_uso', 'En uso', 'emerald'),
                    opt('disponible', 'Disponible', 'sky'),
                    opt('reparacion', 'En reparación', 'amber'),
                    opt('baja', 'Dado de baja', 'slate'),
                ]),
                f('Fecha de compra', 'compra', 'date'),
                f('Valor', 'valor', 'currency', { config: { currency: 'USD', precision: 0 } }),
                f('Garantía hasta', 'garantia', 'date', { config: { highlight_overdue: true } }),
                f('Ubicación', 'ubicacion', 'text'),
            ],
            {
                settings: { title_field_id: ref('nombre') },
                views: [table(), kanban('Por estado', 'estado')],
                records: [
                    { data: { nombre: 'MacBook Pro 14"', tipo: 'laptop', serie: 'C02XY123', estado: 'en_uso', valor: 2200 } },
                    { data: { nombre: 'Monitor Dell 27"', tipo: 'monitor', serie: 'DL27-889', estado: 'disponible', valor: 250 } },
                ],
            },
        ),
    ),
};

const compras: SystemTemplate = {
    key: 'proveedores-compras',
    name: 'Proveedores y compras',
    description: 'Proveedores calificados y órdenes de compra vinculadas, con estado, fecha de entrega y monto.',
    icon: 'shopping_cart',
    color: '#0ea5e9',
    category: 'operaciones',
    blueprint: {
        version: BLUEPRINT_VERSION,
        lists: [
            list(
                'proveedores',
                'Proveedores',
                'truck',
                '#64748b',
                [
                    f('Proveedor', 'nombre', 'text', { is_required: true }),
                    f('NIT / RUT', 'identificacion', 'text'),
                    f('Contacto', 'contacto', 'text'),
                    f('Email', 'email', 'email'),
                    f('Teléfono', 'telefono', 'phone'),
                    select('Categoría', 'categoria', [
                        opt('insumos', 'Insumos', 'amber'),
                        opt('servicios', 'Servicios', 'sky'),
                        opt('tecnologia', 'Tecnología', 'violet'),
                        opt('logistica', 'Logística', 'emerald'),
                    ]),
                    f('Calificación', 'calificacion', 'rating', { config: { max: 5 } }),
                    // v0.1.171 — historial de compras del proveedor, a través
                    // de Órdenes.proveedor.
                    rollup('Órdenes', 'ordenes', 'ordenes', 'proveedor', 'count', null,
                        'Cantidad de órdenes de compra a este proveedor.'),
                    rollup('Total comprado', 'total_comprado', 'ordenes', 'proveedor', 'sum', 'monto',
                        'Suma de las órdenes recibidas o pagadas.',
                        { slug: 'estado', op: 'in', value: ['recibida', 'pagada'] }),
                    rollup('Pendiente de pago', 'pendiente_pago', 'ordenes', 'proveedor', 'sum', 'monto',
                        'Órdenes recibidas que todavía no se pagaron.',
                        { slug: 'estado', op: 'eq', value: 'recibida' }),
                    rollup('Última compra', 'ultima_compra', 'ordenes', 'proveedor', 'max', 'fecha',
                        'Fecha de la orden más reciente.'),
                ],
                {
                    settings: { title_field_id: ref('nombre') },
                    records: [
                        { key: 'p1', data: { nombre: 'Papelería Central', categoria: 'insumos', calificacion: 4 } },
                        { key: 'p2', data: { nombre: 'CloudHost', categoria: 'tecnologia', calificacion: 5 } },
                    ],
                },
            ),
            list(
                'ordenes',
                'Órdenes de compra',
                'shopping_cart',
                '#0ea5e9',
                [
                    f('Número', 'numero', 'text', { is_required: true }),
                    f('Proveedor', 'proveedor', 'relation', { config: { target_list_id: listRef('proveedores') } }),
                    f('Fecha', 'fecha', 'date'),
                    f('Entrega estimada', 'entrega', 'date', { config: { highlight_overdue: true } }),
                    f('Monto', 'monto', 'currency', { config: { currency: 'USD', precision: 2 } }),
                    select('Estado', 'estado', [
                        opt('borrador', 'Borrador', 'slate'),
                        opt('enviada', 'Enviada', 'sky'),
                        opt('recibida', 'Recibida', 'emerald'),
                        opt('pagada', 'Pagada', 'violet'),
                        opt('cancelada', 'Cancelada', 'rose'),
                    ]),
                    f('Detalle', 'detalle', 'long_text'),
                    // v0.1.171 — contacto y categoría del proveedor en la orden.
                    lookup('Email del proveedor', 'email_proveedor', 'ordenes', 'proveedor', 'proveedores', 'email',
                        'Para mandar la orden sin buscar el contacto.'),
                    lookup('Categoría del proveedor', 'categoria_proveedor', 'ordenes', 'proveedor', 'proveedores', 'categoria',
                        'La categoría del proveedor vinculado.'),
                ],
                {
                    settings: { title_field_id: ref('numero') },
                    views: [table(), kanban('Por estado', 'estado'), calendar('Entregas', 'entrega')],
                    records: [
                        { data: { numero: 'OC-001', monto: 180, estado: 'recibida' }, relations: { proveedor: ['p1'] } },
                        { data: { numero: 'OC-002', monto: 1200, estado: 'enviada' }, relations: { proveedor: ['p2'] } },
                    ],
                },
            ),
        ],
        dashboards: [
            dashboard('Compras', 'Órdenes por estado, monto comprado y entregas.', [
                kpi('ordenes', 'Órdenes', { icon: 'shopping_cart' }, 0),
                kpi('ordenes', 'Monto comprado', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'wallet' }, 3),
                kpi('proveedores', 'Proveedores', { icon: 'truck' }, 6),
                kpi('proveedores', 'Pendiente de pago', { metric: 'sum', metric_field_id: ref('pendiente_pago'), prefix: '$', icon: 'flag' }, 9),
                widget('chart_bar', 'ordenes', 'Monto por estado', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('estado') }, 0, 2, 6, 4),
                widget('chart_pie', 'proveedores', 'Proveedores por categoría', { metric: 'count', group_by_field_id: ref('categoria') }, 6, 2, 6, 4),
                widget('table', 'ordenes', 'Próximas entregas', { limit: 8, sort_field_id: ref('entrega'), sort_dir: 'asc' }, 0, 6, 12, 4),
            ]),
        ],
    },
};

const inmuebles: SystemTemplate = {
    key: 'inmuebles',
    name: 'Inmobiliaria',
    description: 'Propiedades en venta o arriendo con precio, área, ubicación, propietario, fotos y asesor a cargo.',
    icon: 'home',
    color: '#14b8a6',
    category: 'ventas',
    blueprint: single(
        list(
            'propiedades',
            'Propiedades',
            'home',
            '#14b8a6',
            [
                f('Propiedad', 'titulo', 'text', { is_required: true }),
                select('Tipo', 'tipo', [
                    opt('casa', 'Casa', 'emerald'),
                    opt('apartamento', 'Apartamento', 'sky'),
                    opt('local', 'Local', 'amber'),
                    opt('oficina', 'Oficina', 'violet'),
                    opt('lote', 'Lote', 'slate'),
                ]),
                select('Operación', 'operacion', [opt('venta', 'Venta', 'rose'), opt('arriendo', 'Arriendo', 'blue')]),
                select('Estado', 'estado', [
                    opt('disponible', 'Disponible', 'emerald'),
                    opt('reservado', 'Reservado', 'amber'),
                    opt('vendido', 'Vendido', 'slate'),
                    opt('arrendado', 'Arrendado', 'violet'),
                ]),
                f('Precio', 'precio', 'currency', { config: { currency: 'USD', precision: 0 } }),
                f('Área (m²)', 'area', 'number', { config: { precision: 0 } }),
                f('Habitaciones', 'habitaciones', 'number', { config: { precision: 0 } }),
                f('Ciudad', 'ciudad', 'text'),
                f('Dirección', 'direccion', 'text'),
                f('Propietario', 'propietario', 'text'),
                f('Teléfono del propietario', 'telefono', 'phone'),
                f('Fotos', 'fotos', 'file'),
                f('Asesor', 'asesor', 'user'),
            ],
            {
                settings: { title_field_id: ref('titulo') },
                views: [table(), kanban('Por estado', 'estado')],
                records: [
                    { data: { titulo: 'Apartamento en Chapinero', tipo: 'apartamento', operacion: 'venta', estado: 'disponible', precio: 180000, area: 72, habitaciones: 2, ciudad: 'Bogotá' } },
                    { data: { titulo: 'Local en el centro', tipo: 'local', operacion: 'arriendo', estado: 'reservado', precio: 900, area: 45, ciudad: 'Medellín' } },
                ],
            },
        ),
        [
            dashboard('Portafolio', 'Propiedades por estado, tipo y operación.', [
                kpi('propiedades', 'Propiedades', { icon: 'home' }, 0),
                kpi('propiedades', 'Disponibles', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('estado'), op: 'eq', value: 'disponible' }, icon: 'check_square' }, 3),
                kpi('propiedades', 'Valor del portafolio', { metric: 'sum', metric_field_id: ref('precio'), prefix: '$', icon: 'wallet' }, 6),
                kpi('propiedades', 'Precio promedio', { metric: 'avg', metric_field_id: ref('precio'), prefix: '$' }, 9),
                widget('chart_pie', 'propiedades', 'Por tipo', { metric: 'count', group_by_field_id: ref('tipo') }, 0, 2, 4, 4),
                widget('chart_bar', 'propiedades', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 4, 2, 4, 4),
                widget('chart_bar', 'propiedades', 'Por asesor', { metric: 'count', group_by_field_id: ref('asesor'), hide_zero_groups: true }, 8, 2, 4, 4),
            ]),
        ],
    ),
};

const citas: SystemTemplate = {
    key: 'agenda-citas',
    name: 'Agenda de citas',
    description: 'Citas con cliente, servicio, profesional y estado. Calendario del día y recordatorio por correo la víspera.',
    icon: 'clock',
    color: '#ec4899',
    category: 'clientes',
    blueprint: single(
        list(
            'citas',
            'Citas',
            'clock',
            '#ec4899',
            [
                f('Cliente', 'cliente', 'text', { is_required: true }),
                f('Email', 'email', 'email'),
                f('Teléfono', 'telefono', 'phone'),
                select('Servicio', 'servicio', [
                    opt('consulta', 'Consulta', 'sky'),
                    opt('control', 'Control', 'violet'),
                    opt('tratamiento', 'Tratamiento', 'amber'),
                    opt('otro', 'Otro', 'slate'),
                ]),
                f('Fecha y hora', 'fecha', 'datetime', { is_required: true }),
                f('Duración', 'duracion', 'duration'),
                f('Profesional', 'profesional', 'user'),
                select('Estado', 'estado', [
                    opt('programada', 'Programada', 'sky'),
                    opt('confirmada', 'Confirmada', 'emerald'),
                    opt('atendida', 'Atendida', 'violet'),
                    opt('cancelada', 'Cancelada', 'rose'),
                    opt('no_asistio', 'No asistió', 'slate'),
                ]),
                f('Notas', 'notas', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('cliente') },
                views: [calendar('Agenda', 'fecha'), table('Tabla', true), kanban('Por estado', 'estado')],
                automations: [
                    {
                        name: 'Recordatorio el día anterior',
                        description: 'Un día antes de la cita, si está confirmada, le manda un recordatorio al cliente.',
                        trigger_type: 'due_date_reached',
                        trigger_config: {
                            due_field: 'fecha',
                            offset_minutes: -24 * 60,
                            field_filters: [{ slug: 'estado', op: 'eq', value: 'confirmada' }],
                        },
                        actions: [
                            {
                                type: 'send_email',
                                config: {
                                    to: '{{email}}',
                                    subject: 'Recordatorio de tu cita',
                                    body: 'Hola {{cliente}},\n\nTe recordamos tu cita el {{fecha}}. Si no podés asistir, avisanos para reprogramar.\n\n¡Hasta pronto!',
                                },
                            },
                        ],
                        is_active: true,
                    },
                ],
                records: [
                    { data: { cliente: 'Ana Gómez', servicio: 'consulta', estado: 'confirmada', duracion: 30 } },
                    { data: { cliente: 'Luis Pérez', servicio: 'control', estado: 'programada', duracion: 20 } },
                ],
            },
        ),
    ),
};

const okrs: SystemTemplate = {
    key: 'okrs',
    name: 'Objetivos y resultados (OKR)',
    description: 'Objetivos por trimestre con responsable, avance y estado. Medidor del avance global.',
    icon: 'rocket',
    color: '#a855f7',
    category: 'proyectos',
    blueprint: single(
        list(
            'objetivos',
            'Objetivos',
            'rocket',
            '#a855f7',
            [
                f('Objetivo', 'objetivo', 'text', { is_required: true }),
                f('Resultado clave', 'resultado_clave', 'text'),
                f('Responsable', 'responsable', 'user'),
                select('Trimestre', 'trimestre', [
                    opt('q1', 'Q1', 'sky'),
                    opt('q2', 'Q2', 'emerald'),
                    opt('q3', 'Q3', 'amber'),
                    opt('q4', 'Q4', 'violet'),
                ]),
                f('Avance', 'avance', 'percent'),
                select('Estado', 'estado', [
                    opt('en_curso', 'En curso', 'sky'),
                    opt('en_riesgo', 'En riesgo', 'rose'),
                    opt('logrado', 'Logrado', 'emerald'),
                ]),
                f('Fecha límite', 'fecha_limite', 'date', { config: { highlight_overdue: true } }),
                f('Notas', 'notas', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('objetivo') },
                views: [table(), kanban('Por trimestre', 'trimestre')],
                records: [
                    { data: { objetivo: 'Duplicar los clientes activos', resultado_clave: 'Pasar de 50 a 100', trimestre: 'q1', avance: 35, estado: 'en_curso' } },
                    { data: { objetivo: 'Reducir el tiempo de respuesta', resultado_clave: 'Menos de 4 horas', trimestre: 'q1', avance: 80, estado: 'logrado' } },
                ],
            },
        ),
        [
            dashboard('OKRs', 'Avance global y por responsable.', [
                widget('gauge', 'objetivos', 'Avance global', { metric: 'avg', metric_field_id: ref('avance'), goal: 100 }, 0, 0, 4, 4),
                kpi('objetivos', 'Objetivos', { icon: 'rocket' }, 4, 0, 4),
                kpi('objetivos', 'En riesgo', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('estado'), op: 'eq', value: 'en_riesgo' }, icon: 'flag' }, 8, 0, 4),
                widget('chart_bar', 'objetivos', 'Avance por responsable', { metric: 'avg', metric_field_id: ref('avance'), group_by_field_id: ref('responsable'), hide_zero_groups: true }, 4, 2, 8, 2),
                widget('chart_pie', 'objetivos', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 0, 4, 6, 4),
                widget('chart_bar', 'objetivos', 'Por trimestre', { metric: 'count', group_by_field_id: ref('trimestre') }, 6, 4, 6, 4),
            ]),
        ],
    ),
};

// ── Tableros para los packs de v0.1.166 ──────────────────────────────────

pipelineVentas.blueprint.dashboards.push(
    dashboard('Ventas', 'Pipeline, monto por etapa y cierres.', [
        kpi('oportunidades', 'Oportunidades', { icon: 'target' }, 0),
        kpi('oportunidades', 'Monto en pipeline', { metric: 'sum', metric_field_id: ref('monto'), prefix: '$', icon: 'wallet' }, 3),
        kpi('oportunidades', 'Ganadas', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('etapa'), op: 'eq', value: 'ganado' }, icon: 'check_square' }, 6),
        widget('stat_delta', 'oportunidades', 'Cierres (30 días)', { metric: 'count', date_field_id: ref('cierre_estimado'), period_days: 30 }, 9, 0, 3, 2),
        widget('funnel', 'oportunidades', 'Embudo', { metric: 'count', group_by_field_id: ref('etapa') }, 0, 2, 6, 5),
        widget('chart_bar', 'oportunidades', 'Monto por etapa', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('etapa') }, 6, 2, 6, 5),
        widget('chart_pie', 'oportunidades', 'Por origen', { metric: 'count', group_by_field_id: ref('origen') }, 0, 7, 4, 4),
        widget('chart_bar', 'oportunidades', 'Por responsable', { metric: 'sum', metric_field_id: ref('monto'), group_by_field_id: ref('responsable'), hide_zero_groups: true }, 4, 7, 8, 4),
    ]),
);

proyectos.blueprint.dashboards.push(
    dashboard('Avance del proyecto', 'Tareas por estado, prioridad y responsable.', [
        kpi('tareas', 'Tareas', { icon: 'clipboard' }, 0, 0, 4),
        kpi('tareas', 'Avance promedio', { metric: 'avg', metric_field_id: ref('avance'), suffix: '%', icon: 'target' }, 4, 0, 4),
        kpi('tareas', 'Horas estimadas', { metric: 'sum', metric_field_id: ref('estimacion'), icon: 'clock' }, 8, 0, 4),
        widget('chart_pie', 'tareas', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 0, 2, 4, 4),
        widget('chart_bar', 'tareas', 'Por prioridad', { metric: 'count', group_by_field_id: ref('prioridad') }, 4, 2, 4, 4),
        widget('chart_bar', 'tareas', 'Por responsable', { metric: 'count', group_by_field_id: ref('responsable'), hide_zero_groups: true }, 8, 2, 4, 4),
        widget('table', 'tareas', 'Próximas entregas', { limit: 8, sort_field_id: ref('fecha_limite'), sort_dir: 'asc' }, 0, 6, 12, 4),
    ]),
);

soporte.blueprint.dashboards.push(
    dashboard('Salud del soporte', 'Tickets abiertos, canales, prioridades y satisfacción.', [
        kpi('tickets', 'Tickets', { icon: 'lifebuoy' }, 0),
        kpi('tickets', 'Abiertos', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('estado'), op: 'eq', value: 'abierto' }, icon: 'flag' }, 3),
        kpi('tickets', 'Satisfacción', { metric: 'avg', metric_field_id: ref('satisfaccion'), icon: 'star' }, 6),
        widget('gauge', 'tickets', 'Satisfacción vs. meta', { metric: 'avg', metric_field_id: ref('satisfaccion'), goal: 4.5 }, 9, 0, 3, 4),
        widget('chart_pie', 'tickets', 'Por estado', { metric: 'count', group_by_field_id: ref('estado') }, 0, 2, 3, 4),
        widget('chart_bar', 'tickets', 'Por canal', { metric: 'count', group_by_field_id: ref('canal') }, 3, 2, 3, 4),
        widget('chart_bar', 'tickets', 'Por prioridad', { metric: 'count', group_by_field_id: ref('prioridad') }, 6, 2, 3, 4),
        widget('table', 'tickets', 'Vencen pronto (SLA)', { limit: 8, sort_field_id: ref('vence'), sort_dir: 'asc' }, 0, 6, 12, 4),
    ]),
);

inventario.blueprint.dashboards.push(
    dashboard('Stock', 'Unidades por categoría, valor y productos con poco stock.', [
        kpi('productos', 'Productos', { icon: 'package' }, 0),
        kpi('productos', 'Unidades', { metric: 'sum', metric_field_id: ref('stock'), icon: 'layers' }, 3),
        kpi('productos', 'Precio promedio', { metric: 'avg', metric_field_id: ref('precio'), prefix: '$', icon: 'tag' }, 6),
        kpi('productos', 'Sin stock', { metric: 'count', filter_tree: { type: 'condition', field_id: ref('stock'), op: 'lte', value: 0 }, icon: 'flag' }, 9),
        widget('chart_bar', 'productos', 'Stock por categoría', { metric: 'sum', metric_field_id: ref('stock'), group_by_field_id: ref('categoria') }, 0, 2, 6, 4),
        widget('chart_pie', 'productos', 'Productos por categoría', { metric: 'count', group_by_field_id: ref('categoria') }, 6, 2, 6, 4),
        widget('table', 'productos', 'Menos stock', { limit: 8, sort_field_id: ref('stock'), sort_dir: 'asc' }, 0, 6, 12, 4),
    ]),
);

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
    crmClientes,
    pipelineVentas,
    facturacion,
    proyectos,
    soporte,
    inventario,
    reclutamiento,
    eventos,
    gastos,
    contratos,
    contenidos,
    incidencias,
    activos,
    compras,
    inmuebles,
    citas,
    okrs,
];

export function systemTemplate(key: string): SystemTemplate | undefined {
    return SYSTEM_TEMPLATES.find((t) => t.key === key);
}
