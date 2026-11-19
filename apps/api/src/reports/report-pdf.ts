import {
    markdownToRichDoc,
    REPORT_LIGHT_THEME,
    suggestedReportHeight,
    widgetReportSvg,
    type RichMark,
    type RichNode,
    type WidgetReport,
} from '@imagina-base/shared';
import { pdfFontFamily, renderPdfDefinition } from '../documents/document-render';
import { renderViaPool } from '../documents/pdf-pool';

/** A4 menos los márgenes (puntos). */
const PAGE_W = 515;
/** Alto útil de la hoja: un gráfico más alto no entra en una página. */
const MAX_H = 700;
/** Separación entre columnas (puntos). */
const GAP = 12;
const MUTED = '#6b7280';
const TEXT = '#1f2937';

/** Un bloque de datos ya calculado (o su motivo si no se pudo). */
export interface ReportPdfData {
    title: string;
    report: WidgetReport | null;
    error?: string | null;
}

/** Los bloques del informe como DATOS (viajan al hilo de PDF: nada de funciones). */
export type ReportPdfItem =
    | { type: 'heading'; text: string; subtitle?: string }
    | { type: 'text'; text: string }
    | { type: 'widget'; data: ReportPdfData }
    | { type: 'columns'; children: ReportPdfData[] }
    | { type: 'divider' }
    | { type: 'page_break' };

export interface ReportPdfInput {
    title: string;
    description?: string | null;
    /** «Período: Este mes» / «Período: el de cada bloque». */
    periodText: string;
    /** «Comparado con el período anterior» (vacío = no compara). */
    compareText?: string;
    /** «Acme · 21/10/2026 08:00». */
    subtitle: string;
    accent?: string | null;
    items: ReportPdfItem[];
}

/**
 * v0.1.464 (J1) — El informe en PDF: una portada sencilla (nombre, período y
 * fecha) y los bloques en orden — títulos y textos con su formato, y cada
 * bloque de datos con el MISMO SVG de la imagen de un widget
 * (`widgetReportSvg`), que pdfmake dibuja VECTORIAL. Los saltos de página
 * del informe parten las hojas; el pie dice «Página x de y».
 */
export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
    // Al hilo de PDF van los datos; el armado y la maquetación, allá.
    return renderViaPool<Buffer>(() => ({ kind: 'report', input }), () => renderReportPdfLocal(input));
}

type Node = Record<string, unknown>;

function hasMark(marks: RichMark[] | undefined, type: string): RichMark | undefined {
    return marks?.find((m) => m.type === type);
}

/** Los tramos en línea de un párrafo (negrita, cursiva, tachado, código, enlaces). */
function inline(nodes: RichNode[] | undefined): Node[] {
    const out: Node[] = [];
    for (const n of nodes ?? []) {
        if (n.type === 'hardBreak') {
            out.push({ text: '\n' });
            continue;
        }
        if (n.type !== 'text' || !n.text) continue;
        const run: Node = { text: n.text };
        if (hasMark(n.marks, 'bold')) run.bold = true;
        if (hasMark(n.marks, 'italic')) run.italics = true;
        if (hasMark(n.marks, 'strike')) run.decoration = 'lineThrough';
        if (hasMark(n.marks, 'code')) run.background = '#f3f4f6';
        const link = hasMark(n.marks, 'link');
        const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : null;
        // Sólo enlaces web y de correo (nada de `javascript:` ni `file:`).
        if (href && /^(https?:\/\/|mailto:)/i.test(href)) {
            run.link = href;
            run.color = '#0e7490';
            run.decoration = 'underline';
        }
        out.push(run);
    }
    return out;
}

/** Los bloques de un texto con formato sencillo, como nodos de pdfmake. */
export function richTextNodes(markdown: string): Node[] {
    const doc = markdownToRichDoc(markdown);
    const blocks = (nodes: RichNode[] | undefined): Node[] => {
        const out: Node[] = [];
        for (const n of nodes ?? []) {
            switch (n.type) {
                case 'paragraph':
                    out.push({ text: inline(n.content), margin: [0, 0, 0, 6] });
                    break;
                case 'heading': {
                    const level = Number((n.attrs as { level?: number } | undefined)?.level ?? 2);
                    out.push({ text: inline(n.content), bold: true, fontSize: level <= 1 ? 16 : level === 2 ? 14 : 12, margin: [0, 4, 0, 4] });
                    break;
                }
                case 'bulletList':
                case 'orderedList': {
                    const items = (n.content ?? []).map((li) => blocks(li.content));
                    out.push({ [n.type === 'bulletList' ? 'ul' : 'ol']: items.map((parts) => ({ stack: parts })), margin: [0, 0, 0, 6] });
                    break;
                }
                case 'blockquote':
                    out.push({
                        table: { widths: ['*'], body: [[{ stack: blocks(n.content), color: MUTED, italics: true }]] },
                        layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => '#d1d5db', paddingLeft: () => 8 },
                        margin: [0, 0, 0, 6],
                    });
                    break;
                case 'horizontalRule':
                    out.push(rule());
                    break;
                default:
                    if (n.content) out.push(...blocks(n.content));
            }
        }
        return out;
    };
    return blocks(doc.content);
}

function rule(): Node {
    return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_W, y2: 0, lineWidth: 0.6, lineColor: '#d1d5db' }], margin: [0, 6, 0, 10] };
}

/** Un bloque de datos: el SVG del widget, o su motivo si no se pudo calcular. */
function dataNode(d: ReportPdfData, width: number, theme: typeof REPORT_LIGHT_THEME, font: string): Node {
    if (!d.report) {
        return {
            table: {
                widths: ['*'],
                body: [[{
                    stack: [
                        { text: d.title || 'Bloque de datos', bold: true, fontSize: 11 },
                        { text: d.error ? `No se pudo calcular: ${d.error}` : 'Sin datos en este período.', color: d.error ? '#b91c1c' : MUTED, fontSize: 9, margin: [0, 2, 0, 0] },
                    ],
                    margin: [8, 8, 8, 8],
                }]],
            },
            layout: { hLineColor: () => '#e5e7eb', vLineColor: () => '#e5e7eb', hLineWidth: () => 0.6, vLineWidth: () => 0.6 },
            width,
        };
    }
    const height = suggestedReportHeight(d.report, { max: MAX_H });
    return { svg: widgetReportSvg(d.report, { width, height, theme, font }), width };
}

/** El informe en el hilo actual (el de PDF, o el principal si no hay). */
export async function renderReportPdfLocal(input: ReportPdfInput): Promise<Buffer> {
    const font = pdfFontFamily('inter');
    const theme = { ...REPORT_LIGHT_THEME, ...(input.accent && /^#[0-9a-f]{6}$/i.test(input.accent) ? { accent: input.accent } : {}) };
    const accent = theme.accent;

    const content: Node[] = [];
    // Portada sencilla: nombre, período y fecha.
    content.push(
        { canvas: [{ type: 'rect', x: 0, y: 0, w: 56, h: 4, color: accent }], margin: [0, 180, 0, 16] },
        { text: input.title, fontSize: 28, bold: true, color: TEXT, margin: [0, 0, 0, 8] },
        ...(input.description ? [{ text: input.description, fontSize: 12, color: MUTED, margin: [0, 0, 0, 16] }] : []),
        { text: input.periodText, fontSize: 12, color: TEXT, margin: [0, 8, 0, 2] },
        ...(input.compareText ? [{ text: input.compareText, fontSize: 11, color: MUTED, margin: [0, 0, 0, 2] }] : []),
        { text: input.subtitle, fontSize: 11, color: MUTED, margin: [0, 2, 0, 0], pageBreak: 'after' },
    );

    for (const item of input.items) {
        switch (item.type) {
            case 'heading':
                content.push({ text: item.text, fontSize: 17, bold: true, color: TEXT, margin: [0, 6, 0, item.subtitle ? 2 : 10] });
                if (item.subtitle) content.push({ text: item.subtitle, fontSize: 10, color: MUTED, margin: [0, 0, 0, 10] });
                break;
            case 'text':
                content.push({ stack: richTextNodes(item.text), fontSize: 10.5, color: TEXT, margin: [0, 0, 0, 8] });
                break;
            case 'widget':
                content.push({ ...dataNode(item.data, PAGE_W, theme, font), margin: [0, 0, 0, 14], unbreakable: true });
                break;
            case 'columns': {
                const n = Math.max(1, item.children.length);
                const w = (PAGE_W - GAP * (n - 1)) / n;
                content.push({
                    columns: item.children.map((c) => dataNode(c, w, theme, font)),
                    columnGap: GAP,
                    margin: [0, 0, 0, 14],
                    unbreakable: true,
                });
                break;
            }
            case 'divider':
                content.push(rule());
                break;
            case 'page_break':
                content.push({ text: '', pageBreak: 'after' });
                break;
        }
    }
    if (input.items.length === 0) content.push({ text: 'Este informe todavía no tiene bloques.', color: MUTED });

    const def = {
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 44],
        info: { title: input.title },
        defaultStyle: { font, fontSize: 10, color: TEXT },
        content,
        footer: (current: number, total: number) => ({
            columns: [
                { text: current === 1 ? '' : input.title, fontSize: 8, color: '#9aa1ad' },
                { text: `Página ${current} de ${total}`, alignment: 'right', fontSize: 8, color: '#9aa1ad' },
            ],
            margin: [40, 12, 40, 0],
        }),
    };
    return renderPdfDefinition(def);
}
