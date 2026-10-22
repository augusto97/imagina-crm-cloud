import { renderEmailHtml, renderEmailText, type EmailBlock, type EmailDesign } from '../schemas/email-design';
import { REPORT_NEUTRAL, type WidgetReport } from './report';

/**
 * v0.1.292 — El correo del envío programado de un tablero (ADR-S50). Se arma
 * con el MISMO compositor de los correos diseñados (`renderEmailHtml`: tablas,
 * estilos en línea, ancho fijo para Outlook, texto plano del multipart) y cada
 * widget va como un bloque HTML hecho de TABLAS: los KPIs en una grilla, los
 * gráficos como barras horizontales (celdas con `bgcolor`), las tablas y la
 * tabla dinámica como tablas. Nada de imágenes ni CSS externo: Gmail y Outlook
 * lo muestran igual.
 */

export interface DashboardEmailInput {
    dashboardName: string;
    /** Nombre de la empresa (o el de la app con white-label). */
    companyName: string;
    reports: WidgetReport[];
    /** Color de la marca (hex). */
    accent: string;
    /** «21/10/2026 08:00». */
    dateText: string;
    /** Mensaje de quien programó el envío (texto plano). */
    message?: string | null;
    subject: string;
    dashboardUrl: string;
    publicUrl?: string | null;
    senderName: string;
    /** Aviso de que va el PDF adjunto. */
    withPdf?: boolean;
}

const TEXT = '#1f2937';
const MUTED = '#6b7280';
const TRACK = '#eef0f3';
const LINE = '#e5e7eb';
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** Filas por gráfico en el correo (el resto: «y N más» + el tablero). */
const MAX_ROWS = 10;

/** Escapa para HTML y neutraliza `{{` (los bloques HTML resuelven variables). */
function esc(s: string): string {
    return s.replace(/[&<>"'{}]/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' })[c] ?? c,
    );
}

function hexRgb(hex: string): [number, number, number] | null {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
    if (!m) return null;
    let h = m[1]!;
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mezcla un color con blanco (Outlook no entiende transparencias). */
export function tintHex(hex: string, alpha: number): string {
    const rgb = hexRgb(hex);
    if (!rgb) return TRACK;
    const a = Math.max(0, Math.min(1, alpha));
    const mix = rgb.map((c) => Math.round(c * a + 255 * (1 - a)));
    return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function safeColor(c: string): string {
    return /^#[0-9a-f]{3,8}$/i.test(c) ? c : REPORT_NEUTRAL;
}

const TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"';

/** Una barra hecha de celdas: los tramos de color y el resto del riel. */
function barCells(parts: Array<{ frac: number; color: string }>): string {
    let used = 0;
    const cells: string[] = [];
    for (const p of parts) {
        const pct = Math.round(Math.max(0, Math.min(1, p.frac)) * 100);
        if (pct <= 0) continue;
        const w = Math.min(pct, 100 - used);
        if (w <= 0) break;
        used += w;
        const color = safeColor(p.color);
        cells.push(`<td width="${w}%" height="10" bgcolor="${color}" style="background:${color};height:10px;font-size:0;line-height:0;">&nbsp;</td>`);
    }
    if (used < 100) cells.push(`<td width="${100 - used}%" height="10" bgcolor="${TRACK}" style="background:${TRACK};height:10px;font-size:0;line-height:0;">&nbsp;</td>`);
    return `<table ${TABLE}><tr>${cells.join('')}</tr></table>`;
}

function barRow(label: string, parts: Array<{ frac: number; color: string }>, value: string): string {
    return `<tr>
<td width="36%" valign="middle" style="padding:5px 10px 5px 0;font-family:${FONT};font-size:13px;line-height:18px;color:${TEXT};">${esc(label)}</td>
<td valign="middle" style="padding:5px 0;">${barCells(parts)}</td>
<td width="24%" align="right" valign="middle" style="padding:5px 0 5px 10px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:${TEXT};white-space:nowrap;">${esc(value)}</td>
</tr>`;
}

function more(count: number): string {
    return count > 0
        ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};">y ${count} más en el tablero</p>`
        : '';
}

function header(r: WidgetReport): string {
    return `<p style="margin:0;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;color:${TEXT};">${esc(r.title)}</p>${
        r.subtitle ? `<p style="margin:2px 0 10px;font-family:${FONT};font-size:12px;line-height:16px;color:${MUTED};">${esc(r.subtitle)}</p>` : '<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>'
    }`;
}

function emptyNote(): string {
    return `<p style="margin:0;font-family:${FONT};font-size:13px;color:${MUTED};">Sin datos en este período.</p>`;
}

function legend(items: Array<{ label: string; color: string }>): string {
    const rows: string[] = [];
    for (let i = 0; i < items.length; i += 4) {
        const cells = items
            .slice(i, i + 4)
            .map(
                (it) =>
                    `<td width="10" valign="middle" style="padding:0 4px 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="10" height="10" bgcolor="${safeColor(it.color)}" style="background:${safeColor(it.color)};width:10px;height:10px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td><td valign="middle" style="padding:0 14px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};white-space:nowrap;">${esc(it.label)}</td>`,
            )
            .join('');
        rows.push(`<tr>${cells}<td width="100%"></td></tr>`);
    }
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">${rows.join('')}</table>`;
}

/** Grilla de KPIs (de a tres por fila). */
function kpiGrid(reports: Array<Extract<WidgetReport, { kind: 'kpi' }>>, accent: string): string {
    const rows: string[] = [];
    for (let i = 0; i < reports.length; i += 3) {
        const group = reports.slice(i, i + 3);
        const cells = group.map((r) => {
            let extra = '';
            if (r.goal) {
                const pct = Math.round(r.goal.pct);
                extra = `<p style="margin:6px 0 4px;font-family:${FONT};font-size:12px;color:${MUTED};">${pct} % de la meta (${esc(r.goal.text)})</p>${barCells([{ frac: r.goal.pct / 100, color: r.goal.pct >= 100 ? '#10b77f' : accent }])}`;
            } else if (r.delta) {
                const p = r.delta.pct;
                const color = p === null || p === 0 ? MUTED : p > 0 ? '#0f9d63' : '#d9304f';
                const sign = p === null ? '—' : `${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${Math.abs(Math.round(p * 10) / 10)} %`;
                extra = `<p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};"><span style="color:${color};font-weight:700;">${esc(sign)}</span> vs. ${esc(r.delta.previousText)}</p>`;
            }
            return `<td width="${Math.floor(100 / group.length)}%" valign="top" style="padding:12px 14px;border:1px solid ${LINE};">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:16px;color:${MUTED};">${esc(r.title)}</p>
<p style="margin:4px 0 0;font-family:${FONT};font-size:24px;line-height:30px;font-weight:700;color:${TEXT};">${esc(r.valueText)}</p>${extra}</td>`;
        });
        rows.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<table ${TABLE.replace('border-collapse:collapse;', 'border-collapse:collapse;table-layout:fixed;')}>${rows.join('')}</table>`;
}

function dataTable(head: string[], rows: string[][], opts: { numericFrom?: number; footer?: string[]; cellBg?: (ri: number, ci: number) => string | null } = {}): string {
    const th = head
        .map(
            (h, i) =>
                `<th align="${i >= (opts.numericFrom ?? Infinity) ? 'right' : 'left'}" style="padding:6px 8px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:11px;line-height:14px;font-weight:700;color:${MUTED};text-transform:none;">${esc(h)}</th>`,
        )
        .join('');
    const body = rows
        .map(
            (r, ri) =>
                `<tr>${r
                    .map((c, ci) => {
                        const bg = opts.cellBg?.(ri, ci) ?? null;
                        return `<td align="${ci >= (opts.numericFrom ?? Infinity) ? 'right' : 'left'}"${bg ? ` bgcolor="${bg}"` : ''} style="padding:6px 8px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:12px;line-height:16px;color:${TEXT};${bg ? `background:${bg};` : ''}">${esc(c)}</td>`;
                    })
                    .join('')}</tr>`,
        )
        .join('');
    const foot = opts.footer
        ? `<tr>${opts.footer
              .map(
                  (c, ci) =>
                      `<td align="${ci >= (opts.numericFrom ?? Infinity) ? 'right' : 'left'}" style="padding:6px 8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;color:${TEXT};">${esc(c)}</td>`,
              )
              .join('')}</tr>`
        : '';
    return `<table ${TABLE}><tr>${th}</tr>${body}${foot}</table>`;
}

/** El HTML (tablas) de UN widget que no es KPI. */
export function reportEmailHtml(r: WidgetReport, accent: string): string {
    switch (r.kind) {
        case 'kpi':
            return kpiGrid([r], accent);
        case 'categories': {
            if (r.rows.length === 0) return header(r) + emptyNote();
            const timeline = r.chart === 'line' || r.chart === 'area';
            // Una tendencia: los últimos períodos (lo más reciente importa más).
            const rows = timeline ? r.rows.slice(-MAX_ROWS) : r.rows.slice(0, MAX_ROWS);
            const rest = r.rows.length - rows.length;
            const max = Math.max(...rows.map((x) => x.value), 0);
            const total = r.rows.reduce((s, x) => s + Math.max(0, x.value), 0);
            const body = rows
                .map((x) => {
                    const value = r.chart === 'pie' && total > 0 ? `${x.text} · ${Math.round((x.value / total) * 100)} %` : x.text;
                    return barRow(x.label, [{ frac: max > 0 ? x.value / max : 0, color: timeline ? accent : x.color }], value);
                })
                .join('');
            return `${header(r)}<table ${TABLE}>${body}</table>${more(rest)}`;
        }
        case 'stacked': {
            if (r.groups.length === 0 || r.series.length === 0) return header(r) + emptyNote();
            const timeline = r.chart !== 'bar';
            const groups = timeline ? r.groups.slice(-MAX_ROWS) : r.groups.slice(0, MAX_ROWS);
            const rest = r.groups.length - groups.length;
            if (r.mode === 'grouped') {
                // Lado a lado no se apila: la grilla de valores es lo legible.
                const table = dataTable(
                    [r.dimension, ...r.series.map((s) => s.label), 'Total'],
                    groups.map((g) => [g.label, ...g.texts.map((t) => t || '—'), g.totalText]),
                    { numericFrom: 1 },
                );
                return `${header(r)}${legend(r.series)}${table}${more(rest)}`;
            }
            const sums = groups.map((g) => g.values.reduce((s, v) => s + Math.max(0, v), 0));
            const maxStack = Math.max(...sums, 0);
            const body = groups
                .map((g, gi) => {
                    const denom = r.percent ? sums[gi]! : maxStack;
                    const parts = g.values.map((v, si) => ({ frac: denom > 0 ? Math.max(0, v) / denom : 0, color: r.series[si]!.color }));
                    return barRow(g.label, parts, g.totalText);
                })
                .join('');
            return `${header(r)}${legend(r.series)}<table ${TABLE}>${body}</table>${more(rest)}`;
        }
        case 'table': {
            if (r.rows.length === 0) return header(r) + emptyNote();
            const cols = Math.min(6, r.columns.length);
            const rows = r.rows.slice(0, MAX_ROWS).map((row) => row.slice(0, cols));
            return `${header(r)}${dataTable(r.columns.slice(0, cols), rows)}${more(r.rows.length - rows.length)}`;
        }
        case 'pivot': {
            if (r.rows.length === 0) return header(r) + emptyNote();
            const maxCols = 6;
            const cols = r.cols.slice(0, maxCols);
            const rows = r.rows.slice(0, 12);
            const span = r.max - Math.min(r.min, 0);
            const head = [[r.rowHeader, r.colHeader].filter(Boolean).join(' \\ '), ...cols.map((c) => c.label), 'Total'];
            const body = rows.map((row) => [row.label, ...row.cells.slice(0, maxCols).map((c) => c.text), row.totalText]);
            const footer = ['Total', ...cols.map((c) => c.totalText), r.totalText];
            const table = dataTable(head, body, {
                numericFrom: 1,
                footer,
                cellBg: (ri, ci) => {
                    if (!r.heatmap || ci === 0 || ci > cols.length || span <= 0) return null;
                    const v = rows[ri]?.cells[ci - 1]?.value ?? null;
                    if (v === null) return null;
                    return tintHex(accent, 0.08 + Math.max(0, Math.min(1, (v - Math.min(r.min, 0)) / span)) * 0.42);
                },
            });
            const cut = rows.length < r.rows.length || cols.length < r.cols.length;
            return `${header(r)}${table}${cut ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:${MUTED};">Se muestran ${rows.length} de ${r.rows.length} filas y ${cols.length} de ${r.cols.length} columnas.</p>` : ''}`;
        }
    }
}

function paragraph(text: string, opts: { size?: number; color?: string; margin?: string } = {}): string {
    return `<p style="margin:${opts.margin ?? '0'};font-family:${FONT};font-size:${opts.size ?? 14}px;line-height:${Math.round((opts.size ?? 14) * 1.5)}px;color:${opts.color ?? TEXT};">${esc(text).replace(/\n/g, '<br>')}</p>`;
}

/** El diseño del correo (también sirve para la vista previa). */
export function dashboardEmailDesign(input: DashboardEmailInput): EmailDesign {
    let seq = 0;
    const bid = (): string => `b${++seq}`;
    const accent = /^#[0-9a-f]{6}$/i.test(input.accent) ? input.accent : '#0e7490';
    const blocks: EmailBlock[] = [];
    blocks.push({ id: bid(), type: 'heading', text: input.dashboardName, level: 2, align: 'left', padding: 'sm' } as EmailBlock);
    blocks.push({
        id: bid(),
        type: 'html',
        html: paragraph(`Resumen del ${input.dateText} · ${input.companyName}`, { size: 13, color: MUTED }),
        padding: 'none',
    } as EmailBlock);
    if (input.message && input.message.trim() !== '') {
        blocks.push({ id: bid(), type: 'html', html: paragraph(input.message.trim(), { margin: '12px 0 0' }), padding: 'none' } as EmailBlock);
    }
    blocks.push({ id: bid(), type: 'spacer', height: 12 } as EmailBlock);

    // Los KPIs seguidos van juntos en una grilla.
    let i = 0;
    const reports = input.reports;
    while (i < reports.length) {
        const r = reports[i]!;
        if (r.kind === 'kpi') {
            const run: Array<Extract<WidgetReport, { kind: 'kpi' }>> = [];
            while (i < reports.length && reports[i]!.kind === 'kpi') run.push(reports[i++] as Extract<WidgetReport, { kind: 'kpi' }>);
            blocks.push({ id: bid(), type: 'html', html: kpiGrid(run, accent), padding: 'sm' } as EmailBlock);
            continue;
        }
        blocks.push({ id: bid(), type: 'html', html: reportEmailHtml(r, accent), padding: 'md' } as EmailBlock);
        i++;
    }
    if (reports.length === 0) {
        blocks.push({ id: bid(), type: 'html', html: paragraph('Este tablero no tiene gráficos con datos para resumir.', { color: MUTED }), padding: 'sm' } as EmailBlock);
    }
    blocks.push({ id: bid(), type: 'spacer', height: 8 } as EmailBlock);
    blocks.push({ id: bid(), type: 'button', label: 'Ver el tablero', url: input.dashboardUrl, align: 'center', color: accent, full_width: false } as EmailBlock);
    const publicLink = input.publicUrl
        ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">También puedes verlo sin iniciar sesión en el <a href="${esc(input.publicUrl)}" style="color:${accent};">enlace público</a>.</p>`
        : '';
    blocks.push({
        id: bid(),
        type: 'html',
        html: `${input.withPdf ? `<p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};text-align:center;">Va adjunto el tablero en PDF.</p>` : ''}${publicLink}<p style="margin:18px 0 0;font-family:${FONT};font-size:11px;line-height:16px;color:${MUTED};text-align:center;">Lo envía ${esc(input.senderName)} desde ${esc(input.companyName)} con un envío programado. Si ya no quieres recibirlo, responde a este correo.</p>`,
        padding: 'sm',
    } as EmailBlock);
    return { version: 1, theme: { background: '#f4f5f7', surface: '#ffffff', text: TEXT, muted: MUTED, accent, font: 'modern', width: 600, radius: 8, dark: { enabled: false, background: '#0f1115', surface: '#1b1d22', text: '#e8eaed', muted: '#a1a7b3' } }, blocks } as EmailDesign;
}

/** El correo listo: HTML compatible con Gmail/Outlook y su texto plano. */
export function renderDashboardEmail(input: DashboardEmailInput): { html: string; text: string } {
    const design = dashboardEmailDesign(input);
    const opts = { resolve: (t: string) => t, subject: input.subject, preheader: `Resumen del ${input.dateText}` };
    return { html: renderEmailHtml(design, opts), text: renderEmailText(design, opts) };
}
