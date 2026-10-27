import { describe, expect, it } from 'vitest';
import type { ListBlueprint } from './list-template';
import {
    ONBOARDING_BUSINESS_TYPES,
    combineBlueprints,
    onboardingAiRequestSchema,
    onboardingApplySchema,
    onboardingPrefsSchema,
    pruneBlueprint,
} from './onboarding';

const f = (slug: string, type: string, config: Record<string, unknown> = {}) => ({
    label: slug.toUpperCase(),
    slug,
    type: type as never,
    config,
    is_required: false,
    is_unique: false,
    is_indexed: false,
    description: null,
});
const list = (key: string, name: string, fields: ReturnType<typeof f>[], rest: Partial<ListBlueprint['lists'][number]> = {}) => ({
    key,
    name,
    icon: null,
    color: null,
    settings: {},
    fields,
    views: [],
    automations: [],
    records: [],
    record_templates: [],
    booking_pages: [],
    ...rest,
});

/** Clientes ← Facturas (relación + rollup del saldo), con vistas, automatización y tablero. */
function agency(): ListBlueprint {
    return {
        version: 1,
        lists: [
            list(
                'clientes',
                'Clientes',
                [
                    f('nombre', 'text'),
                    f('email', 'email'),
                    f('saldo', 'rollup', {
                        relation_field_id: { $field: 'cliente', $list: 'facturas' },
                        target_field_id: { $field: 'monto', $list: 'facturas' },
                        operation: 'sum',
                    }),
                ],
                {
                    settings: { title_field_id: { $field: 'nombre' } },
                    records: [{ key: 'c1', data: { nombre: 'Acme', email: 'a@acme.co' } }],
                },
            ),
            list(
                'facturas',
                'Facturas',
                [
                    f('numero', 'text'),
                    f('cliente', 'relation', { target_list_id: { $list: 'clientes' } }),
                    f('monto', 'currency', { currency: 'COP' }),
                    f('estado', 'select', { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] }),
                    f('vence', 'date'),
                ],
                {
                    views: [
                        { name: 'Por estado', type: 'kanban', config: { group_by_field_id: { $field: 'estado' } }, is_default: false },
                        { name: 'Vencimientos', type: 'calendar', config: { date_field_id: { $field: 'vence' } }, is_default: false },
                    ],
                    automations: [
                        {
                            name: 'Marcar pagada',
                            description: null,
                            trigger_type: 'record_updated',
                            trigger_config: { changed_fields: ['estado'] },
                            actions: [{ type: 'update_field', config: { values: { vence: '' } } }],
                            is_active: true,
                        },
                    ],
                    records: [{ key: 'f1', data: { numero: 'F-1', monto: 100, estado: 'pendiente' }, relations: { cliente: ['c1'] } }],
                },
            ),
        ],
        dashboards: [
            {
                name: 'Cartera',
                description: null,
                settings: {},
                widgets: [
                    { type: 'kpi', list: { $list: 'facturas' }, title: 'Facturado', config: { metric: 'sum', metric_field_id: { $field: 'monto' } }, layout: { x: 0, y: 0, w: 3, h: 2 } },
                    { type: 'chart_pie', list: { $list: 'facturas' }, title: 'Por estado', config: { group_by_field_id: { $field: 'estado' } }, layout: { x: 3, y: 0, w: 6, h: 4 } },
                    { type: 'kpi', list: { $list: 'clientes' }, title: 'Clientes', config: { metric: 'count' }, layout: { x: 9, y: 0, w: 3, h: 2 } },
                ],
            },
        ],
    } as ListBlueprint;
}

describe('pruneBlueprint — quitar lo que la persona no quiere, en cascada', () => {
    it('sin cambios devuelve lo mismo y no reporta nada', () => {
        const { blueprint, report } = pruneBlueprint(agency(), {});
        expect(blueprint.lists.map((l) => l.key)).toEqual(['clientes', 'facturas']);
        expect(report).toEqual({ fields: [], views: [], automations: [], dashboards: [], widgets: 0 });
    });

    it('quitar una lista se lleva la relación hacia ella, el rollup que la cruza y sus widgets', () => {
        const { blueprint, report } = pruneBlueprint(agency(), { exclude_lists: ['facturas'] });
        expect(blueprint.lists.map((l) => l.key)).toEqual(['clientes']);
        // El rollup de Clientes cruzaba Facturas: se va solo (y se informa).
        expect(blueprint.lists[0]!.fields.map((x) => x.slug)).toEqual(['nombre', 'email']);
        expect(report.fields).toEqual([{ list: 'clientes', slug: 'saldo', label: 'SALDO' }]);
        // El tablero queda con el KPI de Clientes; los de Facturas se van.
        expect(blueprint.dashboards[0]!.widgets.map((w) => w.title)).toEqual(['Clientes']);
        expect(report.widgets).toBe(2);
    });

    it('quitar un campo se lleva la vista agrupada por él, la automatización que lo usa y los valores de ejemplo', () => {
        const { blueprint, report } = pruneBlueprint(agency(), { exclude_fields: { facturas: ['estado', 'vence'] } });
        const facturas = blueprint.lists.find((l) => l.key === 'facturas')!;
        expect(facturas.fields.map((x) => x.slug)).toEqual(['numero', 'cliente', 'monto']);
        expect(facturas.views).toEqual([]);
        expect(report.views.map((v) => v.name)).toEqual(['Por estado', 'Vencimientos']);
        expect(facturas.automations).toEqual([]);
        expect(report.automations.map((a) => a.name)).toEqual(['Marcar pagada']);
        expect(facturas.records[0]!.data).toEqual({ numero: 'F-1', monto: 100 });
        // El vínculo de la factura con su cliente sigue.
        expect(facturas.records[0]!.relations).toEqual({ cliente: ['c1'] });
        // El gráfico por estado se va; el KPI del monto queda.
        expect(blueprint.dashboards[0]!.widgets.map((w) => w.title)).toEqual(['Facturado', 'Clientes']);
    });

    it('quitar la relación se lleva el rollup de la otra lista y los vínculos de ejemplo', () => {
        const { blueprint, report } = pruneBlueprint(agency(), { exclude_fields: { facturas: ['cliente'] } });
        expect(blueprint.lists[0]!.fields.map((x) => x.slug)).not.toContain('saldo');
        expect(report.fields.map((x) => x.slug)).toEqual(['saldo']);
        expect(blueprint.lists[1]!.records[0]!.relations).toBeUndefined();
    });

    it('quitar el campo de título lo saca de los ajustes; renombrar listas; un tablero sin datos se va', () => {
        const { blueprint, report } = pruneBlueprint(agency(), {
            exclude_fields: { clientes: ['nombre'] },
            rename_lists: { clientes: '  Mis clientes ' },
            exclude_views: { facturas: [1] },
            exclude_automations: { facturas: [0] },
        });
        expect(blueprint.lists[0]!.settings).toEqual({});
        expect(blueprint.lists[0]!.name).toBe('Mis clientes');
        expect(blueprint.lists[1]!.views.map((v) => v.name)).toEqual(['Por estado']);
        expect(blueprint.lists[1]!.automations).toEqual([]);
        // Las elecciones explícitas no se reportan como arrastre.
        expect(report.views).toEqual([]);
        const onlyClientes = pruneBlueprint(agency(), { exclude_lists: ['facturas'], exclude_dashboards: [0] });
        expect(onlyClientes.blueprint.dashboards).toEqual([]);
    });
});

describe('combineBlueprints — varias plantillas a la vez', () => {
    it('renombra las keys que chocan (con sus referencias) y distingue los nombres repetidos', () => {
        const crm: ListBlueprint = { version: 1, lists: [list('clientes', 'Clientes', [f('nombre', 'text')])], dashboards: [] } as ListBlueprint;
        const out = combineBlueprints([
            { name: 'CRM de clientes', blueprint: crm },
            { name: 'Facturación', blueprint: agency() },
        ]);
        expect(out.lists.map((l) => l.key)).toEqual(['clientes', 'clientes_2', 'facturas']);
        expect(out.lists.map((l) => l.name)).toEqual(['Clientes', 'Clientes · Facturación', 'Facturas']);
        // La relación y el rollup de Facturación apuntan a SU lista de clientes.
        const facturas = out.lists[2]!;
        expect(facturas.fields.find((x) => x.slug === 'cliente')!.config).toEqual({ target_list_id: { $list: 'clientes_2' } });
        expect(out.lists[1]!.fields.find((x) => x.slug === 'saldo')!.config.relation_field_id).toEqual({ $field: 'cliente', $list: 'facturas' });
        expect(out.dashboards[0]!.widgets.map((w) => (w.list === 0 ? 0 : w.list.$list))).toEqual(['facturas', 'facturas', 'clientes_2']);
    });
});

describe('schemas de la bienvenida', () => {
    it('el pedido a la IA exige consentimiento y una descripción con sustancia', () => {
        expect(onboardingAiRequestSchema.safeParse({ description: 'Agencia de marketing', consent: true }).success).toBe(true);
        expect(onboardingAiRequestSchema.safeParse({ description: 'Agencia de marketing', consent: false }).success).toBe(false);
        expect(onboardingAiRequestSchema.safeParse({ description: 'corto', consent: true }).success).toBe(false);
        expect(onboardingAiRequestSchema.safeParse({ description: 'Agencia de marketing', focus: ['cualquier'], consent: true }).success).toBe(false);
    });

    it('aplicar plantillas sólo acepta las del sistema', () => {
        expect(onboardingApplySchema.safeParse({ source: 'templates', template_ids: ['sys:crm-clientes'] }).success).toBe(true);
        expect(onboardingApplySchema.safeParse({ source: 'templates', template_ids: ['12'] }).success).toBe(false);
    });

    it('preferencias tolerantes: un valor raro no rompe el resto', () => {
        expect(onboardingPrefsSchema.parse({ hidden: 'sí', skipped: ['branding', 'otra'], marks: ['my_work'] })).toEqual({
            hidden: false,
            skipped: [],
            marks: ['my_work'],
            celebrated: false,
            welcome_dismissed: false,
        });
    });

    it('cada tipo de negocio trae plantillas y un icono', () => {
        for (const t of ONBOARDING_BUSINESS_TYPES) {
            expect(t.templates.length).toBeGreaterThan(0);
            expect(t.icon).toMatch(/^[a-z_]+$/);
        }
    });
});
