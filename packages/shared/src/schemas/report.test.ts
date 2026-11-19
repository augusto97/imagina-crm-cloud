import { describe, expect, it } from 'vitest';

import { buildWidgetReport, type ReportContext, type ReportField } from '../dashboard-report/report';
import { renderDashboardEmail } from '../dashboard-report/report-email';
import { reportWorkbookSheets } from '../dashboard-report/report-xlsx';
import { buildXlsxWorkbook, uniqueSheetNames } from '../xlsx/workbook';
import { openXlsx } from '../xlsx/reader';
import {
    REPORT_MAX_BLOCKS,
    readReportBlocks,
    readReportSettings,
    reportBlocksSchema,
    reportCompareText,
    reportDataBlocks,
    reportListIds,
    reportPeriodText,
} from './report';

const w = (id: string, list = 1, type = 'kpi') => ({ id, type: 'widget', widget: { type, list_id: list, title: id, config: {} } });

const fields: ReportField[] = [
    { id: 1, type: 'select', label: 'Estado', config: { options: [{ value: 'pendiente', label: 'Pendiente', color: 'amber' }, { value: 'pagada', label: 'Pagada', color: 'green' }] } },
    { id: 3, type: 'currency', label: 'Monto', config: { currency: 'COP', precision: 0 } },
];
const ctx: ReportContext = {
    field: (id) => fields.find((f) => f.id === Number(id)),
    userName: () => null,
    format: { number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' },
    listName: (id) => (id === 1 ? 'Facturas' : 'Clientes'),
};

describe('v0.1.464 (J1) — informes', () => {
    it('bloques al guardar: estrictos (ids únicos también dentro de columnas, tope de bloques)', () => {
        expect(reportBlocksSchema.safeParse([{ id: 'h', type: 'heading', text: 'Ventas' }, w('a'), { id: 'r', type: 'columns', children: [w('b', 2), w('c', 2)] }]).success).toBe(true);
        expect(reportBlocksSchema.safeParse([w('a'), { id: 'r', type: 'columns', children: [w('a'), w('c')] }]).success).toBe(false);
        expect(reportBlocksSchema.safeParse([{ id: 'r', type: 'columns', children: [w('b')] }]).success).toBe(false);
        expect(reportBlocksSchema.safeParse([w('x', 1, 'heading')]).success).toBe(false); // un título no es un bloque de datos
        expect(reportBlocksSchema.safeParse(Array.from({ length: REPORT_MAX_BLOCKS + 1 }, (_, i) => ({ id: `d${i}`, type: 'divider' }))).success).toBe(false);
    });

    it('lectura tolerante: un bloque roto se descarta y se cuenta, la fila con un solo bloque sano queda suelta', () => {
        const { blocks, dropped } = readReportBlocks([
            { id: 'h', type: 'heading', text: 'Hola' },
            { id: 'raro', type: 'video', url: 'x' },
            { id: 'r', type: 'columns', children: [w('a'), { id: 'b', type: 'widget', widget: { type: 'kpi' } }] },
            { id: 'h', type: 'divider' }, // id repetido
            w('c', 2),
        ]);
        expect(blocks.map((b) => b.id)).toEqual(['h', 'a', 'c']);
        expect(dropped).toBe(3);
        expect(readReportBlocks('no es una lista')).toEqual({ blocks: [], dropped: 1 });
        expect(readReportBlocks(null)).toEqual({ blocks: [], dropped: 0 });
        expect(reportDataBlocks(blocks).map((b) => b.id)).toEqual(['a', 'c']);
        expect(reportListIds(blocks)).toEqual([1, 2]);
    });

    it('ajustes tolerantes y el período/comparación en palabras', () => {
        expect(readReportSettings({ period: 'this_month', compare: 42, icon: '', extra: 1 })).toMatchObject({ period: 'this_month', compare: '', icon: null, extra: 1 });
        expect(reportPeriodText('')).toBe('El de cada bloque');
        expect(reportPeriodText('this_month')).toBe('Este mes');
        expect(reportPeriodText('custom:2026-10-01:2026-10-31')).toMatch(/oct/);
        expect(reportCompareText('previous')).toBe('Comparado con el período anterior');
        expect(reportCompareText('none')).toBe('Sin comparar');
        expect(reportCompareText('')).toBe('');
    });

    it('Excel: portada + una hoja por bloque, nombres únicos y fórmulas neutralizadas', () => {
        const kpi = buildWidgetReport({ type: 'kpi', title: 'Facturado', list_id: 1, config: { metric: 'sum', metric_field_id: 3 } }, { value: 1250000 }, ctx)!;
        const bars = buildWidgetReport(
            { type: 'chart_bar', title: 'Facturado', list_id: 1, config: { group_by_field_id: 1, metric: 'sum', metric_field_id: 3 } },
            { data: [{ label: 'pendiente', value: 750000 }, { label: 'pagada', value: 500000 }] },
            ctx,
        )!;
        const sheets = reportWorkbookSheets({
            name: 'Resumen =HYPERLINK("x")',
            periodText: 'Este mes',
            compareText: 'Comparado con el período anterior',
            dateText: '21/10/2026 08:00',
            entries: [
                { title: 'Facturado', subtitle: 'Suma · Facturas', report: kpi },
                { title: 'Facturado', report: bars },
                { title: 'Clientes nuevos', report: null, error: 'No tienes acceso a esta lista.' },
            ],
        });
        expect(sheets.map((s) => s.name)).toEqual(['Informe', 'Facturado', 'Facturado (2)', 'Clientes nuevos']);
        const book = openXlsx(buildXlsxWorkbook(sheets));
        expect(book.sheets.map((s) => s.name)).toEqual(['Informe', 'Facturado', 'Facturado (2)', 'Clientes nuevos']);
        const cell = (sheet: number, r: number, c: number) => book.readSheet(sheet).rows.find((x) => x.r === r)?.cells[c] ?? null;
        // La portada: el nombre como TEXTO (nunca fórmula), el período y el índice.
        expect(cell(0, 1, 0)).toEqual({ t: 'str', v: 'Resumen =HYPERLINK("x")' });
        expect(cell(0, 2, 1)).toEqual({ t: 'str', v: 'Este mes' });
        const cover = book.readSheet(0).rows.map((r) => r.cells.map((c) => (c && 'v' in c ? c.v : null)));
        expect(cover.some((r) => r[0] === 'Clientes nuevos' && String(r[2]).includes('No tienes acceso'))).toBe(true);
        // El gráfico: sus grupos con la ETIQUETA y el valor como NÚMERO.
        const bar = book.readSheet(2).rows.map((r) => r.cells.map((c) => (c && 'v' in c ? c.v : null)));
        expect(bar.some((r) => r[0] === 'Pendiente' && r[1] === 750000)).toBe(true);
        expect(bar.some((r) => r[0] === 'Pagada' && r[1] === 500000)).toBe(true);
        // El bloque que no se pudo calcular deja su motivo.
        expect(book.readSheet(3).rows.some((r) => r.cells.some((c) => c?.t === 'str' && c.v.includes('No tienes acceso')))).toBe(true);
        expect(uniqueSheetNames(['a/b', 'A/B', 'x'.repeat(40)])).toEqual(['a b', 'A B (2)', 'x'.repeat(31)]);
    });

    it('el correo de un informe dice «el informe»', () => {
        const table = buildWidgetReport(
            { type: 'table', title: 'Facturas', list_id: 1, config: {} },
            { columns: [{ field_id: 3, label: 'Monto', type: 'currency' }], rows: Array.from({ length: 30 }, (_, i) => ({ f3: i })) },
            ctx,
        );
        const { html } = renderDashboardEmail({
            kind: 'report',
            dashboardName: 'Resumen',
            companyName: 'Acme',
            reports: table ? [table] : [],
            accent: '#0e7490',
            dateText: '22/10/2026 08:00',
            message: '',
            subject: 'Resumen',
            dashboardUrl: 'https://app.ejemplo.com/#/reports/1',
            publicUrl: null,
            senderName: 'Ana',
            withPdf: true,
        });
        expect(html).toContain('Ver el informe');
        expect(html).toContain('Va adjunto el informe en PDF');
        expect(html).toContain('más en el informe');
        expect(html).not.toContain('el tablero');
    });
});
