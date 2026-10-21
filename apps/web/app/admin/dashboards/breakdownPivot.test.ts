import { describe, expect, it } from 'vitest';

import type { WidgetSpec } from '@/types/dashboard';

import { isBreakdownType, isStackableMetric, widgetPreviewHint } from './WidgetFormDialog';
import { buildBreakdown, groupStackSum, segmentFraction } from './widgets/breakdownModel';
import { buildPivot, heatAlpha } from './widgets/pivotModel';
import { segmentFilterTree } from './widgets/useSegmentNav';

const widget = (config: Record<string, unknown>, type: WidgetSpec['type'] = 'chart_bar'): WidgetSpec => ({
    id: 'w1',
    type,
    list_id: 1,
    title: 'W',
    config,
    layout: { x: 0, y: 0, w: 4, h: 4 },
});

describe('v0.1.291 — barras desglosadas', () => {
    const payload = {
        data: [
            { label: 'pendiente', value: 450, segments: [{ series: 'centro', value: 50 }, { series: 'norte', value: 400 }] },
            { label: 'hecho', value: 1017, segments: [{ series: 'centro', value: 1000 }, { series: '__others__', value: 17 }] },
        ],
        series: [
            { key: 'centro', value: 1050 },
            { key: '__others__', value: 17, others: 2 },
            { key: 'norte', value: 400 },
        ],
    };
    const opts = {
        groupLabel: (k: string) => k.toUpperCase(),
        seriesLabel: (k: string, o?: number) => (k === '__others__' ? `Otros (${o})` : k),
        seriesColor: (k: string) => `c-${k}`,
    };

    it('series en el orden de las opciones del campo, "Otros" al final; valores por grupo', () => {
        const m = buildBreakdown(payload, { ...opts, seriesOptionOrder: new Map([['norte', 0], ['centro', 1]]) });
        expect(m.series.map((s) => s.key)).toEqual(['norte', 'centro', '__others__']);
        expect(m.series[2]).toMatchObject({ label: 'Otros (2)', navigable: false, total: 17 });
        expect(m.groups.map((g) => g.label)).toEqual(['PENDIENTE', 'HECHO']);
        expect(m.groups[1]!.values.get('centro')).toBe(1000);
        expect(m.maxStack).toBe(1017);
        expect(m.maxValue).toBe(1000);
    });

    it('fracciones: apiladas sobre la mayor pila, al 100 % sobre su grupo, lado a lado sobre el mayor cruce', () => {
        const m = buildBreakdown(payload, opts);
        const g = m.groups[0]!;
        expect(groupStackSum(g)).toBe(450);
        expect(segmentFraction(g, 400, m, 'stacked', false)).toBeCloseTo(400 / 1017);
        expect(segmentFraction(g, 400, m, 'stacked', true)).toBeCloseTo(400 / 450);
        expect(segmentFraction(g, 400, m, 'grouped', false)).toBeCloseTo(0.4);
    });

    it('ocultar grupos en cero y ordenar grupos', () => {
        const m = buildBreakdown(
            { ...payload, data: [...payload.data, { label: 'vacio', value: 0, segments: [] }] },
            { ...opts, hideZero: true, sortGroups: (rows) => [...rows].sort((a, b) => a.value - b.value) },
        );
        expect(m.groups.map((g) => g.key)).toEqual(['pendiente', 'hecho']);
    });

    it('apiladas sólo con métricas que suman; qué gráficos desglosan', () => {
        expect(isStackableMetric('sum')).toBe(true);
        expect(isStackableMetric('avg')).toBe(false);
        expect(isBreakdownType('chart_bar')).toBe(true);
        expect(isBreakdownType('chart_pie')).toBe(false);
    });

    it('click en un segmento: la lista filtrada por el grupo Y la serie', () => {
        const tree = segmentFilterTree({
            widget: widget({ group_by_field_id: 10, sub_group_by_field_id: 11 }),
            field: { id: 10, type: 'select' },
            label: 'pendiente',
            listFields: [],
            period: '',
            filters: [],
            userId: 1,
            sub: { field: { id: 11, type: 'select' }, label: 'norte' },
        });
        expect(tree).toEqual({
            type: 'group',
            logic: 'and',
            children: [
                { type: 'condition', field_id: 10, op: 'eq', value: 'pendiente' },
                { type: 'condition', field_id: 11, op: 'eq', value: 'norte' },
            ],
        });
        // Serie "sin valor" → is_null; un mes del segundo campo → su rango; "Otros" no se abre.
        const empty = segmentFilterTree({
            widget: widget({ group_by_field_id: 10 }),
            field: { id: 10, type: 'select' },
            label: 'pendiente',
            listFields: [],
            period: '',
            filters: [],
            userId: 1,
            sub: { field: { id: 12, type: 'date' }, label: '2026-02' },
        });
        expect(empty!.children[1]).toEqual({ type: 'condition', field_id: 12, op: 'between_relative', value: { from: '2026-02-01', to: '2026-02-28' } });
        expect(
            segmentFilterTree({ widget: widget({}), field: { id: 10, type: 'select' }, label: 'a', listFields: [], period: '', filters: [], userId: 1, sub: { field: { id: 11, type: 'select' }, label: '__others__' } }),
        ).toBeNull();
    });
});

describe('v0.1.291 — tabla dinámica', () => {
    const data = {
        rows: [{ key: 'hecho', value: 1017 }, { key: 'pendiente', value: 450 }],
        cols: [{ key: 'centro', value: 1050 }, { key: '__others__', value: 417, others: 3 }],
        cells: [
            { row: 'hecho', col: 'centro', value: 1000 },
            { row: 'hecho', col: '__others__', value: 17 },
            { row: 'pendiente', col: 'centro', value: 50 },
            { row: 'pendiente', col: '__others__', value: 400 },
        ],
        total: 1467,
    };

    it('cruces indexados, totales, orden de filas y rango del mapa de calor', () => {
        const m = buildPivot(data, {
            rowLabel: (k) => k,
            colLabel: (k, o) => (k === '__others__' ? `Otros (${o})` : k),
            sortRows: (rows) => [...rows].sort((a, b) => a.value - b.value),
        });
        expect(m.rows.map((r) => r.key)).toEqual(['pendiente', 'hecho']);
        expect(m.cols[1]!.label).toBe('Otros (3)');
        expect(m.cell('pendiente', '__others__')).toBe(400);
        expect(m.cell('pendiente', 'nada')).toBeNull();
        expect([m.min, m.max]).toEqual([17, 1000]);
        expect(m.total).toBe(1467);
    });

    it('intensidad del mapa de calor acotada y creciente', () => {
        expect(heatAlpha(0, 0, 100)).toBeCloseTo(0.06);
        expect(heatAlpha(100, 0, 100)).toBeCloseTo(0.5);
        expect(heatAlpha(50, 0, 100)).toBeGreaterThan(heatAlpha(10, 0, 100));
    });

    it('la vista previa pide filas y columnas', () => {
        expect(widgetPreviewHint(widget({ group_by_field_id: 1 }, 'pivot'))).toMatch(/filas y el de las columnas/);
        expect(widgetPreviewHint(widget({ group_by_field_id: 1, sub_group_by_field_id: 2 }, 'pivot'))).toBeNull();
    });
});
