import { describe, expect, it } from 'vitest';

import type { ForecastData, WidgetSpec } from '@/types/dashboard';

import { isComparableType, widgetPreviewHint } from './WidgetFormDialog';
import {
    comparedPoints,
    compareTooltip,
    deltaView,
    diffText,
    isAdditiveMetric,
    isReadyCompare,
    previousByKey,
    trendTotals,
    widgetCompareOf,
    type ReadyCompare,
} from './widgets/compareView';
import { forecastFilterTree, forecastOf, forecastPreviousTotals, forecastStageKeys, goalPct } from './widgets/forecastView';
import { segmentFilterTree } from './widgets/useSegmentNav';

const widget = (config: Record<string, unknown>, type: WidgetSpec['type'] = 'forecast'): WidgetSpec => ({
    id: 'w1',
    type,
    list_id: 1,
    title: 'W',
    config,
    layout: { x: 0, y: 0, w: 8, h: 5 },
});

const ready: ReadyCompare = {
    mode: 'previous',
    label: 'Este mes vs. mes anterior',
    short: 'vs. mes anterior',
    detail: '1–19 nov 2026 vs. 1–19 oct 2026',
    value: 300,
    values: [
        { label: 'ganado', value: 300 },
        { label: 'propuesta', value: 0 },
        { label: 'raro', value: 'x' },
    ],
};

describe('v0.1.462 — «Comparar con…» en los widgets', () => {
    it('lee la comparación del dato y distingue «no disponible»', () => {
        expect(widgetCompareOf({ value: 1 })).toBeNull();
        expect(widgetCompareOf({ value: 1, compare: null })).toBeNull();
        const off = widgetCompareOf({ value: 1, compare: { unavailable: 'Elige un período para comparar.' } });
        expect(off?.unavailable).toBe('Elige un período para comparar.');
        expect(isReadyCompare(off)).toBe(false);
        expect(isReadyCompare(widgetCompareOf({ value: 1, compare: ready }))).toBe(true);
    });

    it('variación con signo, «Nuevo», «menos es mejor» y sin número', () => {
        expect(deltaView(375, 300)).toMatchObject({ text: '+25\u00a0%', tone: 'good', direction: 'up', diff: 75 });
        expect(deltaView(240, 300)).toMatchObject({ text: '−20\u00a0%', tone: 'bad', direction: 'down' });
        // Menos es mejor: una baja es buena.
        expect(deltaView(240, 300, true)).toMatchObject({ tone: 'good' });
        expect(deltaView(5, 0)?.text).toBe('Nuevo');
        expect(deltaView('2026-01-01', 300)).toBeNull();
        expect(diffText(-250, (n) => `$${n}`)).toBe('−$250');
        expect(diffText(1000, (n) => `$${n}`)).toBe('+$1000');
    });

    it('el tooltip trae los dos valores y la diferencia', () => {
        const t = compareTooltip({ compare: ready, name: 'Ganado', nowText: '$375', beforeText: '$300', diff: '+$75', delta: '+25 %' });
        expect(t.split('\n')).toEqual([
            'Ganado · Este mes vs. mes anterior',
            '1–19 nov 2026 vs. 1–19 oct 2026',
            'Ahora: $375',
            'Antes: $300',
            'Diferencia: +$75 (+25 %)',
        ]);
    });

    it('el valor de antes por grupo y los totales de una serie', () => {
        const before = previousByKey(ready);
        expect(before.get('ganado')).toBe(300);
        expect(before.get('propuesta')).toBe(0);
        expect(before.get('raro')).toBeNull();
        expect(before.has('nuevo')).toBe(false);
        // «Hasta hoy» en los dos lados: los puntos sin valor actual no suman.
        expect(
            trendTotals([
                { label: '2026-11-01', prev_label: '2026-10-01', value: 10, previous: 4 },
                { label: '2026-11-02', prev_label: '2026-10-02', value: 5, previous: null },
                { label: null, prev_label: '2026-10-31', value: null, previous: 99 },
            ]),
        ).toEqual({ current: 15, previous: 4 });
        expect(trendTotals([])).toBeNull();
        expect(isAdditiveMetric('sum')).toBe(true);
        expect(isAdditiveMetric('avg')).toBe(false);
    });

    it('una serie alineada por posición o, si no, por grupo', () => {
        const byPos: ReadyCompare = { ...ready, points: [{ label: '2026-11-01', prev_label: '2026-10-01', value: 3, previous: 7 }] };
        expect(comparedPoints(byPos, [])).toEqual([{ label: '2026-11-01', prevLabel: '2026-10-01', value: 3, previous: 7 }]);
        expect(comparedPoints(ready, [{ label: 'ganado', value: 400 }, { label: 'nuevo', value: 9 }])).toEqual([
            { label: 'ganado', prevLabel: 'ganado', value: 400, previous: 300 },
            { label: 'nuevo', prevLabel: 'nuevo', value: 9, previous: null },
        ]);
    });

    it('qué widgets comparan (lo mismo que el servidor)', () => {
        for (const t of ['kpi', 'gauge', 'chart_bar', 'chart_pie', 'chart_line', 'chart_area', 'funnel', 'table', 'pivot', 'forecast'] as const) {
            expect(isComparableType(t)).toBe(true);
        }
        expect(isComparableType('stat_delta')).toBe(false);
        expect(isComparableType('heading')).toBe(false);
    });
});

describe('v0.1.462 — pronóstico de ventas', () => {
    const data: ForecastData = {
        buckets: [
            { key: '2026-11', won: 300, weighted: 20, open: 200, lost: 0, forecast: 320, unassigned: 0 },
            { key: '', won: 100, weighted: 0, open: 0, lost: 0, forecast: 100, unassigned: 0 },
        ],
        totals: { won: 400, weighted: 20, open: 200, lost: 0, forecast: 420, unassigned: 0 },
        stages: [
            { key: 'prospecto', label: 'Prospecto', probability: 20, amount: 0 },
            { key: 'propuesta', label: 'Propuesta', probability: 10, amount: 200 },
            { key: 'ganado', label: 'Ganado', probability: 100, amount: 400 },
            { key: 'perdido', label: 'Perdido', probability: 0, amount: 0 },
        ],
        bucket: 'month',
    };

    it('lee el pronóstico y los totales de antes', () => {
        expect(forecastOf({ forecast: data })).toBe(data);
        expect(forecastOf({ value: 1 })).toBeNull();
        expect(forecastPreviousTotals({ won: 60, weighted: 40, open: 0, lost: 0, forecast: 100, unassigned: 0 })?.forecast).toBe(100);
        expect(forecastPreviousTotals([{ key: 'x' }])).toBeNull();
        expect(goalPct(420, 1000)).toBeCloseTo(42);
        expect(goalPct(420, null)).toBe(0);
    });

    it('las etapas de cada parte salen de su probabilidad', () => {
        expect(forecastStageKeys(data.stages, 'won')).toEqual(['ganado']);
        expect(forecastStageKeys(data.stages, 'open')).toEqual(['prospecto', 'propuesta']);
        expect(forecastStageKeys(data.stages, 'all')).toEqual(['prospecto', 'propuesta', 'ganado']);
    });

    it('un tramo abre la lista con lo que contó el widget + el mes + las etapas', () => {
        const w = widget({
            metric_field_id: 5,
            stage_field_id: 6,
            date_field_id: 7,
            time_bucket: 'month',
            period: { field_id: 7, preset: 'this_quarter' },
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 8, op: 'eq', value: 'norte' }] },
        });
        const tree = forecastFilterTree({
            widget: w,
            listFields: [],
            period: '',
            filters: [],
            userId: 1,
            stageFieldId: 6,
            stageKeys: ['prospecto', 'propuesta'],
            bucketKey: '2026-11',
        });
        expect(tree).toEqual({
            type: 'group',
            logic: 'and',
            children: [
                { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 8, op: 'eq', value: 'norte' }] },
                { type: 'condition', field_id: 7, op: 'between_relative', value: 'this_quarter' },
                { type: 'condition', field_id: 7, op: 'between_relative', value: { from: '2026-11-01', to: '2026-11-30' } },
                { type: 'condition', field_id: 6, op: 'in', value: ['prospecto', 'propuesta'] },
            ],
        });
        // El período del tablero pisa el del widget; «sin fecha» → vacío.
        const none = forecastFilterTree({ widget: w, listFields: [], period: 'custom:2028-02-01:2028-02-29', filters: [], userId: 1, stageFieldId: 6, stageKeys: ['ganado'], bucketKey: '' });
        expect(none?.children).toEqual([
            { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 8, op: 'eq', value: 'norte' }] },
            { type: 'condition', field_id: 7, op: 'between_relative', value: { from: '2028-02-01', to: '2028-02-29' } },
            { type: 'condition', field_id: 7, op: 'is_null', value: null },
            { type: 'condition', field_id: 6, op: 'in', value: ['ganado'] },
        ]);
        // Sin etapas que abrir no hay lista.
        expect(forecastFilterTree({ widget: w, listFields: [], period: '', filters: [], userId: 1, stageFieldId: 6, stageKeys: [], bucketKey: null })).toBeNull();
    });

    it('los gráficos siguen abriendo su segmento igual (refactor sin cambios)', () => {
        const tree = segmentFilterTree({
            widget: widget({ group_by_field_id: 10, period: { field_id: 7, preset: 'this_month' } }, 'chart_bar'),
            field: { id: 10, type: 'select' },
            label: 'pendiente',
            listFields: [],
            period: '',
            filters: [],
            userId: 1,
        });
        expect(tree?.children).toEqual([
            { type: 'condition', field_id: 7, op: 'between_relative', value: 'this_month' },
            { type: 'condition', field_id: 10, op: 'eq', value: 'pendiente' },
        ]);
    });

    it('la vista previa pide monto y etapa', () => {
        expect(widgetPreviewHint(widget({ metric_field_id: 5 }))).toBe('Elige el campo del monto y el de la etapa para ver el pronóstico.');
        expect(widgetPreviewHint(widget({ metric_field_id: 5, stage_field_id: 6 }))).toBeNull();
    });
});

