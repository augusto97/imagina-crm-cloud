import { describe, expect, it } from 'vitest';

import { buildWidgetReport, reportFileName, type ReportContext, type ReportField } from './report';
import { csvDialect, csvSafeText, widgetReportCsv } from './report-csv';
import { reportEmailHtml } from './report-email';
import { widgetReportSvg } from './report-svg';

const fields: ReportField[] = [
    {
        id: 1,
        type: 'select',
        label: 'Estado',
        config: { options: [{ value: 'pendiente', label: 'Pendiente', color: 'amber' }, { value: 'hecho', label: 'Hecho', color: 'green' }] },
    },
    { id: 2, type: 'select', label: 'Región', config: { options: [{ value: 'norte', label: 'Norte', color: 'blue' }, { value: 'sur', label: 'Sur' }] } },
    { id: 3, type: 'currency', label: 'Monto', config: { currency: 'COP', precision: 0 } },
    { id: 4, type: 'user', label: 'Responsable', config: {} },
    { id: 5, type: 'date', label: 'Fecha', config: {} },
];

const ctx = (number_format: 'comma_dot' | 'dot_comma' = 'dot_comma'): ReportContext => ({
    field: (id) => fields.find((f) => f.id === Number(id)),
    userName: (id) => (id === 7 ? 'Ana Gómez' : null),
    format: { number_format, date_format: 'dmy', time_format: 'h24' },
    listName: () => 'Ventas',
});

describe('v0.1.292 — reporte de un widget (PNG, CSV, correo y PDF)', () => {
    it('categorías con la etiqueta y el color real de cada opción, monto con los separadores de la empresa', () => {
        const r = buildWidgetReport(
            { type: 'chart_bar', title: 'Por estado', list_id: 1, config: { metric: 'sum', metric_field_id: 3, group_by_field_id: 1 } },
            { data: [{ label: 'hecho', value: 1500000 }, { label: 'pendiente', value: 250000 }, { label: '(sin valor)', value: 1000 }] },
            ctx(),
        );
        expect(r?.kind).toBe('categories');
        if (r?.kind !== 'categories') return;
        expect(r.subtitle).toBe('Suma · Ventas');
        // Orden de las opciones del campo; "(sin valor)" al final, gris.
        expect(r.rows.map((x) => x.label)).toEqual(['Pendiente', 'Hecho', '(sin valor)']);
        expect(r.rows[0]!.color).toBe('#f59f0a');
        expect(r.rows[1]!.text).toBe('$1.500.000');
        expect(r.rows[2]!.color).toBe('#9aa1ad');
    });

    it('personas por su nombre y buckets de fecha legibles', () => {
        const byUser = buildWidgetReport(
            { type: 'chart_pie', title: '', list_id: 1, config: { group_by_field_id: 4 } },
            { data: [{ label: '7', value: 3 }, { label: '9', value: 1 }] },
            ctx(),
        );
        expect(byUser?.kind === 'categories' && byUser.rows.map((x) => x.label)).toEqual(['Ana Gómez', 'Usuario 9']);
        const trend = buildWidgetReport(
            { type: 'chart_line', title: 'Ventas', list_id: 1, config: { date_field_id: 5, time_bucket: 'month' } },
            { data: [{ label: '2026-07', value: 2 }, { label: '2026-08', value: 5 }, { label: '(sin valor)', value: 9 }] },
            ctx(),
        );
        // Los registros sin fecha no son un punto de la tendencia.
        expect(trend?.kind === 'categories' && trend.rows.map((x) => x.label)).toEqual(['jul 2026', 'ago 2026']);
    });

    it('barras desglosadas: series en el orden de las opciones, "Otros" al final, valores por grupo', () => {
        const r = buildWidgetReport(
            { type: 'chart_bar', title: 'Estado por región', list_id: 1, config: { group_by_field_id: 1, sub_group_by_field_id: 2, stack_percent: true } },
            {
                data: [
                    { label: 'pendiente', value: 5, segments: [{ series: 'sur', value: 2 }, { series: 'norte', value: 3 }] },
                    { label: 'hecho', value: 4, segments: [{ series: '__others__', value: 4 }] },
                ],
                series: [{ key: 'sur', value: 2 }, { key: '__others__', value: 4, others: 2 }, { key: 'norte', value: 3 }],
            },
            ctx(),
        );
        expect(r?.kind).toBe('stacked');
        if (r?.kind !== 'stacked') return;
        expect(r.series.map((s) => s.label)).toEqual(['Norte', 'Sur', 'Otros (2)']);
        expect(r.series[0]!.color).toBe('#3c83f6');
        expect(r.percent).toBe(true);
        expect(r.groups[0]).toMatchObject({ label: 'Pendiente', values: [3, 2, 0] });
        expect(r.groups[1]!.values).toEqual([0, 0, 4]);
    });

    it('tabla dinámica: cruces, totales y rango del mapa de calor', () => {
        const r = buildWidgetReport(
            { type: 'pivot', title: '', list_id: 1, config: { metric: 'sum', metric_field_id: 3, group_by_field_id: 1, sub_group_by_field_id: 2, heatmap: true } },
            {
                pivot: {
                    rows: [{ key: 'hecho', value: 300 }, { key: 'pendiente', value: 50 }],
                    cols: [{ key: 'norte', value: 320 }, { key: '(sin valor)', value: 30 }],
                    cells: [
                        { row: 'hecho', col: 'norte', value: 300 },
                        { row: 'pendiente', col: 'norte', value: 20 },
                        { row: 'pendiente', col: '(sin valor)', value: 30 },
                    ],
                    total: 350,
                },
            },
            ctx(),
        );
        expect(r?.kind).toBe('pivot');
        if (r?.kind !== 'pivot') return;
        expect(r.title).toBe('Tabla dinámica');
        expect(r.rows.map((x) => x.label)).toEqual(['Pendiente', 'Hecho']);
        expect(r.rows[1]!.cells.map((c) => c.text)).toEqual(['$300', '']);
        expect([r.min, r.max, r.totalText]).toEqual([20, 300, '$350']);
    });

    it('KPI con meta y variación', () => {
        const r = buildWidgetReport(
            { type: 'stat_delta', title: 'Ventas del mes', list_id: 1, config: { metric: 'sum', metric_field_id: 3, goal: 200 } },
            { value: 150, previous: 100, delta_pct: 50, period_days: 30 },
            ctx(),
        );
        expect(r).toMatchObject({ kind: 'kpi', valueText: '$150', goal: { pct: 75 }, delta: { pct: 50, previous: 100, periodDays: 30 } });
        expect(buildWidgetReport({ type: 'kpi', title: '', list_id: 1, config: {} }, { __error: 'x' }, ctx())).toBeNull();
    });

    it('CSV: números crudos con el decimal de la empresa, BOM, etiquetas legibles y sin fórmulas', () => {
        expect(csvDialect({ number_format: 'comma_dot' })).toEqual({ delimiter: ',', decimal: '.' });
        expect(csvDialect({ number_format: 'space_comma' })).toEqual({ delimiter: ';', decimal: ',' });
        const r = buildWidgetReport(
            { type: 'chart_bar', title: '', list_id: 1, config: { metric: 'avg', metric_field_id: 3, group_by_field_id: 4 } },
            { data: [{ label: '7', value: 1234.5 }, { label: '=HYPERLINK("x")', value: 2 }] },
            ctx(),
        )!;
        const latam = widgetReportCsv(r, { number_format: 'dot_comma' });
        expect(latam.startsWith('﻿Responsable;Promedio\r\n')).toBe(true);
        expect(latam).toContain('Ana Gómez;1234,5\r\n');
        expect(latam).toContain(`"'=HYPERLINK(""x"")";2`);
        const us = widgetReportCsv(r, { number_format: 'comma_dot' });
        expect(us).toContain('Ana Gómez,1234.5\r\n');
        expect(csvSafeText('-5')).toBe('-5');
        expect(csvSafeText('+57 300 111 2233')).toBe('+57 300 111 2233');
        expect(csvSafeText('@cmd')).toBe("'@cmd");
    });

    it('CSV de la tabla dinámica con fila y columna de totales; el de barras desglosadas en formato ancho', () => {
        const pivot = buildWidgetReport(
            { type: 'pivot', title: '', list_id: 1, config: { group_by_field_id: 1, sub_group_by_field_id: 2 } },
            { pivot: { rows: [{ key: 'hecho', value: 3 }], cols: [{ key: 'norte', value: 2 }, { key: 'sur', value: 1 }], cells: [{ row: 'hecho', col: 'norte', value: 2 }, { row: 'hecho', col: 'sur', value: 1 }], total: 3 } },
            ctx(),
        )!;
        expect(widgetReportCsv(pivot, { number_format: 'comma_dot' })).toBe('﻿Estado \\ Región,Norte,Sur,Total\r\nHecho,2,1,3\r\nTotal,2,1,3\r\n');
        const stacked = buildWidgetReport(
            { type: 'chart_bar', title: '', list_id: 1, config: { group_by_field_id: 1, sub_group_by_field_id: 2 } },
            { data: [{ label: 'hecho', value: 3, segments: [{ series: 'norte', value: 3 }] }], series: [{ key: 'norte', value: 3 }] },
            ctx(),
        )!;
        expect(widgetReportCsv(stacked, { number_format: 'dot_comma' })).toBe('﻿Estado;Norte;Total\r\nHecho;3;3\r\n');
    });

    it('SVG autocontenido y escapado; nombre de archivo sin acentos', () => {
        const r = buildWidgetReport(
            { type: 'chart_bar', title: 'Ventas <b>"Q3"</b>', list_id: 1, config: { group_by_field_id: 1 } },
            { data: [{ label: 'hecho', value: 3 }] },
            ctx(),
        )!;
        const svg = widgetReportSvg(r, { width: 600, height: 320, dateText: '21/10/2026' });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('Ventas &lt;b&gt;&quot;Q3&quot;&lt;/b&gt;');
        expect(svg).not.toMatch(/<script|href=|url\(/);
        expect(reportFileName('Estado por región ✓', '2026-10-21')).toBe('estado-por-region-2026-10-21');
    });
});

describe('v0.1.462 — la comparación y el pronóstico viajan en el reporte', () => {
    const meta = { mode: 'previous', label: 'Este mes vs. mes anterior', short: 'vs. mes anterior', detail: '1–19 nov 2026 vs. 1–19 oct 2026' };

    it('KPI: «+25 %» con el valor de antes; con «menos es mejor» la baja es buena', () => {
        const r = buildWidgetReport(
            { type: 'kpi', title: 'Ventas', list_id: 1, config: { metric: 'sum', metric_field_id: 3 } },
            { value: 1250000, compare: { ...meta, value: 1000000 } },
            ctx(),
        );
        expect(r?.kind).toBe('kpi');
        if (r?.kind !== 'kpi') return;
        expect(r.compare).toMatchObject({ label: 'Este mes vs. mes anterior', previousText: '$1.000.000', deltaText: '+25 %', pct: 25, tone: 'good' });
        const inv = buildWidgetReport(
            { type: 'kpi', title: 'Costos', list_id: 1, config: { metric: 'sum', metric_field_id: 3 } },
            { value: 900, compare: { ...meta, invert: true, value: 1000 } },
            ctx(),
        );
        expect(inv?.kind === 'kpi' && inv.compare).toMatchObject({ deltaText: '−10 %', tone: 'good' });
        // Sin comparación posible: no se inventa nada.
        const none = buildWidgetReport(
            { type: 'kpi', title: '', list_id: 1, config: {} },
            { value: 3, compare: { unavailable: 'Elige un período para comparar.' } },
            ctx(),
        );
        expect(none?.kind === 'kpi' && none.compare).toBeNull();
        const csv = widgetReportCsv(r, { number_format: 'dot_comma' });
        expect(csv).toContain('Antes (1–19 nov 2026 vs. 1–19 oct 2026);1000000');
        expect(csv).toContain('Variación (%);25');
    });

    it('barras: el valor de antes por categoría (con «Nuevo» si antes no había) en CSV, SVG y correo', () => {
        const r = buildWidgetReport(
            { type: 'chart_bar', title: 'Por estado', list_id: 1, config: { group_by_field_id: 1 } },
            {
                data: [{ label: 'hecho', value: 6 }, { label: 'pendiente', value: 3 }],
                compare: { ...meta, values: [{ label: 'hecho', value: 4 }, { label: 'pendiente', value: 0 }] },
            },
            ctx(),
        );
        expect(r?.kind).toBe('categories');
        if (r?.kind !== 'categories') return;
        expect(r.rows.map((x) => [x.label, x.previous, x.deltaText])).toEqual([
            ['Pendiente', 0, 'Nuevo'],
            ['Hecho', 4, '+50 %'],
        ]);
        expect(widgetReportCsv(r, { number_format: 'comma_dot' })).toBe('﻿Estado,Conteo,Antes,Variación (%)\r\nPendiente,3,0,\r\nHecho,6,4,50\r\n');
        const svg = widgetReportSvg(r, { width: 600, height: 320, dateText: '19/11/2026' });
        expect(svg).toContain('Este mes vs. mes anterior');
        expect(svg).toContain('+50');
        const html = reportEmailHtml(r, '#0f766e');
        expect(html).toContain('Antes');
        expect(html).toContain('+50');
    });

    it('línea: la serie anterior alineada por posición, punteada en el SVG', () => {
        const r = buildWidgetReport(
            { type: 'chart_line', title: 'Ventas por día', list_id: 1, config: { date_field_id: 5, time_bucket: 'day' } },
            {
                data: [{ label: '2026-11-01', value: 2 }, { label: '2026-11-02', value: 5 }],
                compare: {
                    ...meta,
                    points: [
                        { label: '2026-11-01', prev_label: '2026-10-01', value: 2, previous: 1 },
                        { label: '2026-11-02', prev_label: '2026-10-02', value: 5, previous: 4 },
                        { label: null, prev_label: '2026-10-03', value: null, previous: 7 },
                    ],
                },
            },
            ctx(),
        );
        expect(r?.kind === 'categories' && r.trend?.map((p) => [p.label, p.prevLabel, p.value, p.previous])).toEqual([
            ['01/11/2026', '01/10/2026', 2, 1],
            ['02/11/2026', '02/10/2026', 5, 4],
            ['', '03/10/2026', null, 7],
        ]);
        const svg = widgetReportSvg(r!, { width: 600, height: 320, dateText: '19/11/2026' });
        expect(svg).toContain('stroke-dasharray="5 4"');
        expect(widgetReportCsv(r!, { number_format: 'comma_dot' })).toContain('02/11/2026,5,02/10/2026,4,25');
    });

    it('tabla y tabla dinámica: totales con «Antes» y «Variación»', () => {
        const table = buildWidgetReport(
            { type: 'table', title: 'Últimas ventas', list_id: 1, config: {} },
            {
                columns: [{ label: 'Monto', slug: 'monto', type: 'currency', id: 3 }],
                rows: [{ id: 1, fields: { monto: 500 } }],
                compare: {
                    ...meta,
                    totals: [
                        { key: '__count', label: 'Registros', field_id: null, value: 2, previous: 4 },
                        { key: 'monto', label: 'Monto', field_id: 3, value: 1500, previous: 1000 },
                    ],
                },
            },
            ctx(),
        );
        expect(table?.kind === 'table' && table.totals?.map((t) => [t.label, t.valueText, t.previousText, t.deltaText])).toEqual([
            ['Registros', '2', '4', '−50 %'],
            ['Monto', '$1.500', '$1.000', '+50 %'],
        ]);
        const pivot = buildWidgetReport(
            { type: 'pivot', title: '', list_id: 1, config: { group_by_field_id: 1, sub_group_by_field_id: 2 } },
            {
                pivot: { rows: [{ key: 'hecho', value: 3 }], cols: [{ key: 'norte', value: 3 }], cells: [{ row: 'hecho', col: 'norte', value: 3 }], total: 3 },
                compare: { ...meta, rows: [{ key: 'hecho', value: 2 }], total: 2 },
            },
            ctx(),
        )!;
        expect(widgetReportCsv(pivot, { number_format: 'comma_dot' })).toBe('﻿Estado \\ Región,Norte,Total,Antes,Variación (%)\r\nHecho,3,3,2,50\r\nTotal,3,3,2,50\r\n');
    });

    it('pronóstico: ganado, ponderado y abierto por mes; total con la meta y la comparación', () => {
        const r = buildWidgetReport(
            { type: 'forecast', title: '', list_id: 1, config: { metric_field_id: 3, stage_field_id: 1, goal: 1000 } },
            {
                forecast: {
                    buckets: [
                        { key: '2026-11', won: 300, weighted: 200, open: 500, forecast: 500 },
                        { key: '', won: 0, weighted: 50, open: 100, forecast: 50 },
                    ],
                    totals: { won: 300, weighted: 250, open: 600, forecast: 550, unassigned: 0 },
                    stages: [{ key: 'pendiente', label: 'Pendiente', probability: 40, amount: 600 }],
                },
                compare: { ...meta, totals: { won: 100, weighted: 340, open: 0, lost: 0, forecast: 440 } },
            },
            ctx(),
        );
        expect(r?.kind).toBe('forecast');
        if (r?.kind !== 'forecast') return;
        expect(r.title).toBe('Pronóstico');
        expect(r.buckets.map((b) => [b.label, b.forecastText])).toEqual([['nov 2026', '$500'], ['Sin fecha', '$50']]);
        expect(r.goal?.pct).toBeCloseTo(55);
        expect(r.compare).toMatchObject({ previousText: '$440', deltaText: '+25 %' });
        const csv = widgetReportCsv(r, { number_format: 'comma_dot' });
        expect(csv).toContain('Período,Ganado,Ponderado,Abierto,Pronóstico\r\nnov 2026,300,200,500,500');
        expect(csv).toContain('Total,300,250,600,550');
        expect(csv).toContain('Pendiente,40,$600');
        expect(widgetReportSvg(r, { width: 600, height: 360, dateText: '19/11/2026' })).toContain('$550');
        expect(reportEmailHtml(r, '#0f766e')).toContain('Ponderado');
    });
});
