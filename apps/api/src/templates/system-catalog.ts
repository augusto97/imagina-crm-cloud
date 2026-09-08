import {
    BLUEPRINT_VERSION,
    type BlueprintField,
    type BlueprintList,
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

const single = (l: BlueprintList): ListBlueprint => ({ version: BLUEPRINT_VERSION, lists: [l] });

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
    description: 'Candidatos por etapa de selección, con cargo, fuente, evaluación y fecha de entrevista.',
    icon: 'briefcase',
    color: '#14b8a6',
    category: 'personas',
    blueprint: single(
        list(
            'candidatos',
            'Candidatos',
            'briefcase',
            '#14b8a6',
            [
                f('Candidato', 'candidato', 'text', { is_required: true }),
                f('Cargo', 'cargo', 'text'),
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
            ],
            {
                settings: { title_field_id: ref('candidato') },
                views: [kanban('Proceso', 'etapa'), table('Tabla', false), calendar('Entrevistas', 'entrevista')],
                records: [
                    { data: { candidato: 'Laura Martínez', cargo: 'Diseñadora UX', etapa: 'entrevista', fuente: 'linkedin', evaluacion: 4 } },
                    { data: { candidato: 'Jorge Herrera', cargo: 'Desarrollador', etapa: 'recibido', fuente: 'portal' } },
                ],
            },
        ),
    ),
};

const eventos: SystemTemplate = {
    key: 'eventos',
    name: 'Eventos e invitados',
    description: 'Invitados con confirmación, mesa y restricciones. Calendario de fechas y tablero por confirmación.',
    icon: 'calendar',
    color: '#ec4899',
    category: 'otros',
    blueprint: single(
        list(
            'invitados',
            'Invitados',
            'calendar',
            '#ec4899',
            [
                f('Invitado', 'invitado', 'text', { is_required: true }),
                f('Email', 'email', 'email'),
                f('Teléfono', 'telefono', 'phone'),
                select('Confirmación', 'confirmacion', [
                    opt('pendiente', 'Pendiente', 'slate'),
                    opt('confirmado', 'Confirmado', 'emerald'),
                    opt('no_asiste', 'No asiste', 'rose'),
                ]),
                f('Acompañantes', 'acompanantes', 'number', { config: { precision: 0 } }),
                f('Mesa', 'mesa', 'text'),
                f('Evento', 'evento', 'text'),
                f('Fecha del evento', 'fecha', 'date'),
                f('Restricciones', 'restricciones', 'long_text'),
            ],
            {
                settings: { title_field_id: ref('invitado') },
                views: [table(), kanban('Confirmaciones', 'confirmacion'), calendar('Fechas', 'fecha')],
            },
        ),
    ),
};

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
    crmClientes,
    pipelineVentas,
    facturacion,
    proyectos,
    soporte,
    inventario,
    reclutamiento,
    eventos,
];

export function systemTemplate(key: string): SystemTemplate | undefined {
    return SYSTEM_TEMPLATES.find((t) => t.key === key);
}
