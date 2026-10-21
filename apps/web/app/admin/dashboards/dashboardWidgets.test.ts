import { describe, expect, it } from 'vitest';

import { widgetsDataChanged } from '@/hooks/useDashboards';
import { setTenantFormat } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { WidgetSpec } from '@/types/dashboard';

import { activeFilterValues, readDashboardFilterDefs } from './DashboardFiltersBar';
import { decodeWidgetFilters, listOptionLabel, presentationDefaults, widgetPreviewHint } from './WidgetFormDialog';
import { inkOn, sortChartRows } from './widgets/useChartColors';
import { bucketRange, segmentFilterTree } from './widgets/useSegmentNav';
import { formatBucketLabel, formatMetricValue, groupDisplayLabels } from './widgets/widgetFormat';

const field = (id: number, type: string, config: Record<string, unknown> = {}): FieldEntity =>
    ({ id, type, config, slug: `f${id}`, label: `Campo ${id}`, list_id: 1 }) as unknown as FieldEntity;

const widget = (config: Record<string, unknown>, type: WidgetSpec['type'] = 'chart_bar'): WidgetSpec => ({
    id: 'w1',
    type,
    list_id: 1,
    title: 'W',
    config,
    layout: { x: 0, y: 0, w: 4, h: 4 },
});

describe('v0.1.286 — formato de los widgets', () => {
    setTenantFormat({ number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' });

    it('formatea la métrica según el campo (duración, porcentaje, moneda, fechas)', () => {
        expect(formatMetricValue(90, 'sum', field(1, 'duration'))).toBe('1h 30m');
        expect(formatMetricValue(70, 'avg', field(2, 'percent'))).toBe('70%');
        expect(formatMetricValue(1234567, 'sum', field(3, 'currency', { precision: 0 }))).toBe('1.234.567');
        expect(formatMetricValue(1234567, 'sum', field(3, 'currency', { precision: 0, currency: 'USD' }), { withSymbol: true })).toMatch(/\$\s?1\.234\.567/);
        expect(formatMetricValue(12, 'count', field(1, 'duration'))).toBe('12');
        expect(formatMetricValue('2026-07-31', 'max', field(4, 'date'))).toBe('31/07/2026');
        expect(formatMetricValue('2026-05-06T11:30:00.000Z', 'max', field(5, 'datetime'))).toMatch(/^06\/05\/2026 \d{2}:\d{2}$/);
        expect(formatMetricValue(4.256, 'avg', field(6, 'rating'))).toBe('4,26');
    });

    it('buckets legibles y casillas como Sí/No', () => {
        expect(formatBucketLabel('2026-10')).toBe('oct 2026');
        expect(formatBucketLabel('2026-W43')).toBe('Sem 43 · 2026');
        expect(formatBucketLabel('2026-Q3')).toBe('T3 2026');
        expect(formatBucketLabel('2026-07-21')).toBe('21/07/2026');
        expect(formatBucketLabel('Abierto')).toBe('Abierto');
        const cb = groupDisplayLabels(['true', 'false'], { type: 'checkbox' });
        expect(cb.get('true')).toBe('Sí');
        expect(cb.get('false')).toBe('No');
        expect(groupDisplayLabels(['2026-07'], { type: 'date' }).get('2026-07')).toBe('jul 2026');
    });
});

describe('v0.1.286 — orden de categorías y "Otros"', () => {
    const rows = [
        { label: 'b', value: 5 },
        { label: '__others__', value: 9, others: 3 },
        { label: 'a', value: 1 },
        { label: 'c', value: 3 },
    ];
    it('por opciones del campo, por valor y alfabético — "Otros" siempre al final', () => {
        const order = new Map([['c', 0], ['a', 1], ['b', 2]]);
        expect(sortChartRows(rows, undefined, order, (l) => l).map((r) => r.label)).toEqual(['c', 'a', 'b', '__others__']);
        expect(sortChartRows(rows, undefined, new Map(), (l) => l).map((r) => r.label)).toEqual(['b', 'c', 'a', '__others__']);
        expect(sortChartRows(rows, 'value_asc', order, (l) => l).map((r) => r.label)).toEqual(['a', 'c', 'b', '__others__']);
        expect(sortChartRows(rows, 'label', order, (l) => l).map((r) => r.label)).toEqual(['a', 'b', 'c', '__others__']);
    });

    it('tinta legible sobre el color de la etapa', () => {
        expect(inkOn('hsl(var(--imcrm-opt-amber))')).not.toBe('#ffffff');
        expect(inkOn('hsl(var(--imcrm-opt-indigo))')).toBe('#ffffff');
        expect(inkOn('#fde047')).not.toBe('#ffffff');
    });
});

describe('v0.1.286 — click-through con TODO lo que contó el gráfico', () => {
    it('filtro del widget + período global + filtros del tablero + segmento', () => {
        const tree = segmentFilterTree({
            widget: widget({
                group_by_field_id: 10,
                date_field_id: 20,
                filter_tree: { type: 'condition', field_id: 30, op: 'eq', value: 'x' },
                period: { field_id: 20, preset: 'this_year' },
            }),
            field: { id: 10, type: 'select' },
            label: 'abierto',
            listFields: [{ id: 10, type: 'select' }, { id: 20, type: 'date' }, { id: 40, type: 'user' }],
            period: 'custom:2026-01-01:2026-01-31',
            filters: [{ field_id: 40, value: 'me' }, { field_id: 999, value: 'x' }],
            userId: 7,
        });
        expect(tree).toEqual({
            type: 'group',
            logic: 'and',
            children: [
                { type: 'condition', field_id: 30, op: 'eq', value: 'x' },
                { type: 'condition', field_id: 20, op: 'between_relative', value: { from: '2026-01-01', to: '2026-01-31' } },
                { type: 'condition', field_id: 40, op: 'eq', value: 7 },
                { type: 'condition', field_id: 10, op: 'eq', value: 'abierto' },
            ],
        });
    });

    it('multi_select por igualdad de conjunto, buckets como rango, "Otros" no navega', () => {
        const base = { listFields: [], period: '', filters: [], userId: 1 };
        const multi = segmentFilterTree({ ...base, widget: widget({ group_by_field_id: 10 }), field: { id: 10, type: 'multi_select' }, label: '["a", "b"]' });
        expect(multi!.children.at(-1)).toEqual({ type: 'condition', field_id: 10, op: 'eq', value: ['a', 'b'] });
        const month = segmentFilterTree({ ...base, widget: widget({ group_by_field_id: 20, time_bucket: 'month' }), field: { id: 20, type: 'date' }, label: '2026-02' });
        expect(month!.children.at(-1)).toEqual({ type: 'condition', field_id: 20, op: 'between_relative', value: { from: '2026-02-01', to: '2026-02-28' } });
        const empty = segmentFilterTree({ ...base, widget: widget({ group_by_field_id: 10 }), field: { id: 10, type: 'select' }, label: '(sin valor)' });
        expect(empty!.children.at(-1)).toMatchObject({ op: 'is_null' });
        expect(segmentFilterTree({ ...base, widget: widget({ group_by_field_id: 10 }), field: { id: 10, type: 'select' }, label: '__others__' })).toBeNull();
        expect(bucketRange('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
        expect(bucketRange('2026-Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    });
});

describe('v0.1.286 — diálogo del widget y tablero', () => {
    it('defaults reales de "Mostrar" por tipo', () => {
        expect(presentationDefaults('chart_bar')).toEqual({ average: false, labels: false, legend: false });
        expect(presentationDefaults('chart_line').average).toBe(true);
        expect(presentationDefaults('chart_pie')).toEqual({ average: false, labels: true, legend: true });
    });

    it('un filtro con raíz suelta se abre como grupo (no se pierde al guardar)', () => {
        const cond = { type: 'condition', field_id: 5, op: 'lte', value: 0 };
        expect(decodeWidgetFilters({ filter_tree: cond })).toEqual({ type: 'group', logic: 'and', children: [cond] });
    });

    it('listas homónimas se distinguen por carpeta o slug', () => {
        const all = [
            { id: 1, name: 'Contactos', slug: 'contactos', group_id: 9 },
            { id: 2, name: 'Contactos', slug: 'contactos-2', group_id: null },
            { id: 3, name: 'Ventas', slug: 'ventas', group_id: null },
        ];
        const groups = [{ id: 9, name: 'CRM' }];
        expect(listOptionLabel(all[0]!, all, groups)).toBe('Contactos · CRM');
        expect(listOptionLabel(all[1]!, all, groups)).toBe('Contactos · contactos-2');
        expect(listOptionLabel(all[2]!, all, groups)).toBe('Ventas');
    });

    it('arrastrar o redimensionar NO recalcula los datos; cambiar la config sí', () => {
        const a = widget({ metric: 'count' });
        expect(widgetsDataChanged([a], [{ ...a, layout: { x: 3, y: 1, w: 6, h: 2, hm: 3 } }])).toBe(false);
        expect(widgetsDataChanged([a], [{ ...a, config: { ...a.config, style: { bg: '#000' } } }])).toBe(false);
        expect(widgetsDataChanged([a], [{ ...a, config: { metric: 'sum', metric_field_id: 2 } }])).toBe(true);
        expect(widgetsDataChanged([a], [a, { ...a, id: 'w2' }])).toBe(true);
        expect(widgetsDataChanged([a, { ...a, id: 'w2' }], [a])).toBe(false);
    });

    it('filtros del tablero: definiciones tolerantes y sólo los valores elegidos', () => {
        const defs = readDashboardFilterDefs({ filters: [{ list_id: 1, field_id: 2 }, { list_id: 'x' }, { list_id: 1, field_id: 3 }] });
        expect(defs).toEqual([{ list_id: 1, field_id: 2 }, { list_id: 1, field_id: 3 }]);
        expect(activeFilterValues(defs, { '2': 'abierto', '3': '', '9': 'x' })).toEqual([{ field_id: 2, value: 'abierto' }]);
    });
});

describe('v0.1.286 — vista previa del widget', () => {
    it('un gráfico sin «Agrupar por» explica qué falta en vez de quedar en blanco', () => {
        expect(widgetPreviewHint({ type: 'chart_bar', config: { group_by_field_id: 0 } })).toMatch(/agrupar/);
        expect(widgetPreviewHint({ type: 'chart_pie', config: {} })).toMatch(/agrupar/);
        expect(widgetPreviewHint({ type: 'chart_bar', config: { group_by_field_id: 7 } })).toBeNull();
    });

    it('líneas y comparación piden el campo de fecha; el KPI no pide nada', () => {
        expect(widgetPreviewHint({ type: 'chart_line', config: { date_field_id: 0 } })).toMatch(/fecha/);
        expect(widgetPreviewHint({ type: 'chart_area', config: { date_field_id: 3 } })).toBeNull();
        expect(widgetPreviewHint({ type: 'kpi', config: {} })).toBeNull();
    });
});
