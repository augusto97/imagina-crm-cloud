import { ganttTicks, type GanttBar, type GanttZoom } from '@imagina-base/shared';
import { pdfFontFamily, renderPdfDefinition } from '../documents/document-render';

/** Una fila del PDF, ya resuelta (lo mismo que se ve en la pantalla). */
export interface GanttPdfRow {
    kind: 'group' | 'record';
    /** Grupo: su nombre; registro: el título. */
    label: string;
    depth: 0 | 1;
    /** Valores de las columnas elegidas, ya formateados. */
    cells: string[];
    bar: GanttBar | null;
    /** Color de la barra (o del chip del grupo). */
    color: string;
    baseline: GanttBar | null;
    /** Grupo: cuántos registros tiene. */
    count?: number;
    id?: number;
}

export interface GanttPdfInput {
    title: string;
    subtitle: string;
    columns: string[];
    rows: GanttPdfRow[];
    /** Flechas «bloquea a» por id de registro. */
    deps: Array<{ blocker: number; blocked: number }>;
    from: number;
    to: number;
    today: number;
    preferredZoom: GanttZoom;
}

/** A4 apaisado menos los márgenes (puntos). */
const PAGE_W = 786;
const ROW_H = 16;
const HEAD_H = 30;
const ROWS_PER_PAGE = 28;
const TITLE_W = 170;
const COL_W = 64;

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Recorta un texto al ancho (aproximado por el ancho medio de un carácter). */
function fit(text: string, width: number, size: number): string {
    const max = Math.max(1, Math.floor(width / (size * 0.53)));
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/**
 * B1 — El Gantt en PDF, VECTORIAL: cada página es un SVG (encabezado del
 * tiempo, columnas, barras, hitos, línea base, flechas y la línea de hoy) que
 * pdfmake dibuja nítido a cualquier zoom. La escala se ajusta al rango que se
 * veía en la pantalla para que entre en el ancho de la hoja; el nivel de las
 * marcas baja solo si quedarían amontonadas.
 */
export async function renderGanttPdf(input: GanttPdfInput): Promise<Buffer> {
    const font = pdfFontFamily('inter');
    const cols = input.columns.slice(0, 3);
    const panelW = TITLE_W + COL_W * cols.length;
    const timeW = PAGE_W - panelW;
    const days = Math.max(1, input.to - input.from + 1);
    const pxDay = timeW / days;
    const order: GanttZoom[] = ['day', 'week', 'month', 'quarter'];
    const minPx: Record<GanttZoom, number> = { day: 16, week: 3.2, month: 0.9, quarter: 0 };
    let zoom = input.preferredZoom;
    while (pxDay < minPx[zoom] && order.indexOf(zoom) < order.length - 1) zoom = order[order.indexOf(zoom) + 1]!;
    const ticks = ganttTicks(zoom, input.from, input.to);
    const xOf = (day: number): number => panelW + (day - input.from) * pxDay;

    const pages: GanttPdfRow[][] = [];
    for (let i = 0; i < input.rows.length; i += ROWS_PER_PAGE) pages.push(input.rows.slice(i, i + ROWS_PER_PAGE));
    if (pages.length === 0) pages.push([]);

    const svgs = pages.map((rows) => {
        const height = HEAD_H + Math.max(1, rows.length) * ROW_H;
        const out: string[] = [];
        const text = (x: number, y: number, value: string, o: { size?: number; bold?: boolean; fill?: string; anchor?: string } = {}) =>
            out.push(
                `<text x="${n(x)}" y="${n(y)}" font-family="${esc(font)}" font-size="${o.size ?? 7.5}"${o.bold ? ' font-weight="bold"' : ''} fill="${o.fill ?? '#1f2937'}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(value)}</text>`,
            );
        // Encabezado.
        out.push(`<rect x="0" y="0" width="${PAGE_W}" height="${HEAD_H}" fill="#f3f4f6"/>`);
        text(6, 19, 'Nombre', { bold: true, size: 8 });
        cols.forEach((c, i) => text(TITLE_W + i * COL_W + 4, 19, fit(c, COL_W - 6, 8), { bold: true, size: 8 }));
        for (const t of ticks.top) {
            const x = xOf(t.day);
            text(x + 3, 11, fit(t.label, t.days * pxDay - 4, 7.5), { bold: true, size: 7.5, fill: '#374151' });
            out.push(`<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${HEAD_H}" stroke="#d1d5db" stroke-width="0.5"/>`);
        }
        for (const t of ticks.bottom) {
            const x = xOf(t.day);
            const w = t.days * pxDay;
            if (t.weekend) out.push(`<rect x="${n(x)}" y="${HEAD_H}" width="${n(w)}" height="${height - HEAD_H}" fill="#f9fafb"/>`);
            if (w >= 12) text(x + w / 2, 25, fit(t.label, w - 2, 6.5), { size: 6.5, fill: '#6b7280', anchor: 'middle' });
            out.push(`<line x1="${n(x)}" y1="${HEAD_H - 12}" x2="${n(x)}" y2="${height}" stroke="#e5e7eb" stroke-width="0.4"/>`);
        }
        out.push(`<line x1="0" y1="${HEAD_H}" x2="${PAGE_W}" y2="${HEAD_H}" stroke="#d1d5db" stroke-width="0.6"/>`);
        out.push(`<line x1="${panelW}" y1="0" x2="${panelW}" y2="${height}" stroke="#d1d5db" stroke-width="0.6"/>`);
        // Hoy.
        if (input.today >= input.from && input.today <= input.to) {
            const x = xOf(input.today) + pxDay / 2;
            out.push(`<line x1="${n(x)}" y1="${HEAD_H}" x2="${n(x)}" y2="${height}" stroke="#ef4444" stroke-width="0.8" stroke-dasharray="2 2"/>`);
        }
        const rowIndex = new Map<number, number>();
        rows.forEach((r, i) => {
            if (r.kind === 'record' && r.id !== undefined) rowIndex.set(r.id, i);
        });
        rows.forEach((r, i) => {
            const y = HEAD_H + i * ROW_H;
            if (r.kind === 'group') {
                out.push(`<rect x="0" y="${n(y)}" width="${PAGE_W}" height="${ROW_H}" fill="#f3f4f6"/>`);
                out.push(`<rect x="6" y="${n(y + 5)}" width="6" height="6" rx="1.5" fill="${esc(r.color)}"/>`);
                text(16, y + 11, fit(`${r.label} (${r.count ?? 0})`, panelW - 20, 8), { bold: true, size: 8 });
            } else {
                const indent = r.depth === 1 ? 12 : 0;
                text(6 + indent, y + 11, fit(r.label, TITLE_W - 10 - indent, 7.5), { size: 7.5, fill: r.depth === 1 ? '#4b5563' : '#111827' });
                r.cells.forEach((c, ci) => text(TITLE_W + ci * COL_W + 4, y + 11, fit(c, COL_W - 6, 7), { size: 7, fill: '#4b5563' }));
                if (r.baseline) {
                    const bx = Math.max(panelW, xOf(r.baseline.start));
                    const bw = Math.min(PAGE_W, xOf(r.baseline.end + 1)) - bx;
                    if (bw > 0) out.push(`<rect x="${n(bx)}" y="${n(y + 12)}" width="${n(bw)}" height="2" fill="#9ca3af"/>`);
                }
                if (r.bar) {
                    if (r.bar.milestone) {
                        const cx = xOf(r.bar.start) + pxDay / 2;
                        if (cx >= panelW && cx <= PAGE_W) {
                            const cy = y + 8;
                            out.push(`<polygon points="${n(cx)},${n(cy - 5)} ${n(cx + 5)},${n(cy)} ${n(cx)},${n(cy + 5)} ${n(cx - 5)},${n(cy)}" fill="${esc(r.color)}"/>`);
                        }
                    } else {
                        const x0 = Math.max(panelW, xOf(r.bar.start));
                        const x1 = Math.min(PAGE_W, xOf(r.bar.end + 1));
                        if (x1 > x0) out.push(`<rect x="${n(x0)}" y="${n(y + 4)}" width="${n(Math.max(1.5, x1 - x0))}" height="8" rx="2" fill="${esc(r.color)}"/>`);
                    }
                }
            }
            out.push(`<line x1="0" y1="${n(y + ROW_H)}" x2="${PAGE_W}" y2="${n(y + ROW_H)}" stroke="#eef0f3" stroke-width="0.4"/>`);
        });
        // Flechas (sólo entre filas de la MISMA página).
        for (const d of input.deps) {
            const a = rowIndex.get(d.blocker);
            const b = rowIndex.get(d.blocked);
            if (a === undefined || b === undefined) continue;
            const ra = rows[a]!;
            const rb = rows[b]!;
            if (!ra.bar || !rb.bar) continue;
            const x1 = ra.bar.milestone ? xOf(ra.bar.start) + pxDay / 2 + 5 : xOf(ra.bar.end + 1);
            const y1 = HEAD_H + a * ROW_H + 8;
            const x2 = rb.bar.milestone ? xOf(rb.bar.start) + pxDay / 2 - 5 : xOf(rb.bar.start);
            const y2 = HEAD_H + b * ROW_H + 8;
            if (Math.max(x1, x2) < panelW) continue;
            const midY = y2 > y1 ? HEAD_H + b * ROW_H + 1 : HEAD_H + b * ROW_H + ROW_H - 1;
            const path =
                x2 - x1 >= 10
                    ? `M${n(x1)},${n(y1)} H${n(x1 + 5)} V${n(y2)} H${n(x2)}`
                    : `M${n(x1)},${n(y1)} H${n(x1 + 5)} V${n(midY)} H${n(x2 - 6)} V${n(y2)} H${n(x2)}`;
            out.push(`<path d="${path}" fill="none" stroke="#6b7280" stroke-width="0.8"/>`);
            out.push(`<polygon points="${n(x2)},${n(y2)} ${n(x2 - 4)},${n(y2 - 2.5)} ${n(x2 - 4)},${n(y2 + 2.5)}" fill="#6b7280"/>`);
        }
        return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${height}" viewBox="0 0 ${PAGE_W} ${height}">${out.join('')}</svg>`, height };
    });

    const def = {
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: [28, 28, 28, 30],
        info: { title: input.title },
        defaultStyle: { font, fontSize: 10, color: '#1f2937' },
        content: [
            { text: input.title, fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
            { text: input.subtitle, fontSize: 9, color: '#6b7280', margin: [0, 0, 0, 10] },
            ...svgs.map((s, i) => ({
                svg: s.svg,
                width: PAGE_W,
                ...(i < svgs.length - 1 ? { pageBreak: 'after' } : {}),
            })),
            ...(input.rows.length === 0 ? [{ text: 'No hay registros con fechas en este rango.', color: '#6b7280', margin: [0, 8, 0, 0] }] : []),
        ],
        footer: (current: number, total: number) => ({
            text: `Página ${current} de ${total}`,
            alignment: 'right',
            fontSize: 8,
            color: '#9aa1ad',
            margin: [28, 10, 28, 0],
        }),
    };
    return renderPdfDefinition(def);
}
