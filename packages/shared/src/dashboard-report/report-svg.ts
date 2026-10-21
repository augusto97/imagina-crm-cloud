import type { WidgetReport } from './report';

/**
 * v0.1.291 — Un widget dibujado como SVG autocontenido (sin CSS, sin
 * fuentes externas, sin imágenes): la imagen PNG que se descarga desde el
 * tablero (el navegador lo pasa a un canvas) y los gráficos del PDF del envío
 * programado (pdfmake lo dibuja vectorial). Mismo dibujo en los dos lados.
 */

export interface ReportSvgTheme {
    /** Fondo de la tarjeta. */
    background: string;
    text: string;
    muted: string;
    border: string;
    /** Color de acento (línea de tendencia, mapa de calor). */
    accent: string;
}

export const REPORT_LIGHT_THEME: ReportSvgTheme = {
    background: '#ffffff',
    text: '#1f2937',
    muted: '#6b7280',
    border: '#e5e7eb',
    accent: '#0e7490',
};

export interface ReportSvgOptions {
    width: number;
    height: number;
    theme?: ReportSvgTheme;
    /** Pila de fuentes (en el PDF se mapea a la del documento). */
    font?: string;
    /** «Generado el 21/10/2026 15:30», arriba a la derecha. */
    dateText?: string | null;
    /** Sin el encabezado (título/subtítulo): el PDF pone el suyo. */
    bare?: boolean;
}

const DEFAULT_FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Recorta un texto al ancho disponible (estimado por tamaño de letra). */
export function fitText(text: string, maxWidth: number, size: number): string {
    const max = Math.max(1, Math.floor(maxWidth / (size * 0.56)));
    return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

const n2 = (v: number): string => (Math.round(v * 10) / 10).toString();

interface Ctx {
    W: number;
    H: number;
    t: ReportSvgTheme;
    font: string;
    pad: number;
    top: number;
    bottom: number;
    out: string[];
}

function text(c: Ctx, x: number, y: number, s: string, o: { size?: number; weight?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; maxWidth?: number } = {}): void {
    const size = o.size ?? 12;
    const value = o.maxWidth !== undefined ? fitText(s, o.maxWidth, size) : s;
    c.out.push(
        `<text x="${n2(x)}" y="${n2(y)}" font-family="${esc(c.font)}" font-size="${size}"${o.weight ? ` font-weight="${o.weight}"` : ''} fill="${esc(o.fill ?? c.t.text)}"${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}>${esc(value)}</text>`,
    );
}

function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string, o: { rx?: number; opacity?: number; stroke?: string } = {}): void {
    if (w <= 0 || h <= 0) return;
    c.out.push(
        `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${esc(fill)}"${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''}${o.stroke ? ` stroke="${esc(o.stroke)}"` : ''}/>`,
    );
}

function line(c: Ctx, x1: number, y1: number, x2: number, y2: number, stroke: string, o: { width?: number; dash?: string; opacity?: number } = {}): void {
    c.out.push(
        `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${esc(stroke)}" stroke-width="${o.width ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}${o.opacity !== undefined ? ` stroke-opacity="${o.opacity}"` : ''}/>`,
    );
}

/** Leyenda en una o varias líneas; devuelve la altura que ocupó. */
function legend(c: Ctx, items: Array<{ label: string; color: string }>, x0: number, y0: number, maxX: number): number {
    let x = x0;
    let y = y0;
    for (const it of items) {
        const label = fitText(it.label, 150, 11);
        const w = 14 + label.length * 11 * 0.56 + 14;
        if (x + w > maxX && x > x0) {
            x = x0;
            y += 16;
        }
        rect(c, x, y - 8, 9, 9, it.color, { rx: 2 });
        text(c, x + 13, y, label, { size: 11, fill: c.t.muted });
        x += w;
    }
    return y - y0 + 16;
}

/** Arco de dona entre dos ángulos (radianes, 0 = arriba, sentido horario). */
function arcPath(cx: number, cy: number, r: number, ri: number, a0: number, a1: number): string {
    const p = (rad: number, a: number): string => `${n2(cx + rad * Math.sin(a))},${n2(cy - rad * Math.cos(a))}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${p(r, a0)} A ${n2(r)} ${n2(r)} 0 ${large} 1 ${p(r, a1)} L ${p(ri, a1)} A ${n2(ri)} ${n2(ri)} 0 ${large} 0 ${p(ri, a0)} Z`;
}

function heat(alpha: number): string {
    return alpha.toFixed(2);
}

export function widgetReportSvg(report: WidgetReport, opts: ReportSvgOptions): string {
    const W = Math.max(200, Math.round(opts.width));
    const H = Math.max(120, Math.round(opts.height));
    const t = opts.theme ?? REPORT_LIGHT_THEME;
    const c: Ctx = { W, H, t, font: opts.font ?? DEFAULT_FONT, pad: 20, top: 0, bottom: H - 16, out: [] };
    rect(c, 0, 0, W, H, t.background);
    if (opts.bare) {
        c.top = 12;
    } else {
        const dateW = opts.dateText ? opts.dateText.length * 11 * 0.56 + 12 : 0;
        text(c, c.pad, 30, report.title, { size: 15, weight: 700, maxWidth: W - c.pad * 2 - dateW });
        if (opts.dateText) text(c, W - c.pad, 30, opts.dateText, { size: 11, fill: t.muted, anchor: 'end' });
        if (report.subtitle) text(c, c.pad, 48, report.subtitle, { size: 11, fill: t.muted, maxWidth: W - c.pad * 2 });
        c.top = report.subtitle ? 66 : 50;
    }
    switch (report.kind) {
        case 'kpi':
            drawKpi(c, report);
            break;
        case 'categories':
            if (report.chart === 'pie') drawDonut(c, report);
            else if (report.chart === 'line' || report.chart === 'area') drawTrend(c, report);
            else drawBars(c, report);
            break;
        case 'stacked':
            drawStacked(c, report);
            break;
        case 'table':
            drawTable(c, report.columns, report.rows);
            break;
        case 'pivot':
            drawPivot(c, report);
            break;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${c.out.join('')}</svg>`;
}

function emptyNote(c: Ctx): void {
    text(c, c.W / 2, (c.top + c.bottom) / 2, 'Sin datos.', { size: 12, fill: c.t.muted, anchor: 'middle' });
}

const GOOD = '#10b77f';
const WARN = '#f59f0a';
const BAD = '#e84a6f';

function drawKpi(c: Ctx, r: Extract<WidgetReport, { kind: 'kpi' }>): void {
    const bodyH = c.bottom - c.top;
    if (r.gauge && r.goal) {
        const pct = Math.max(0, r.goal.pct);
        const cx = c.W / 2;
        const rad = Math.max(30, Math.min(c.W * 0.32, bodyH * 0.62));
        const cy = c.top + rad + 8;
        const sw = Math.max(10, rad * 0.18);
        const color = pct >= 100 ? GOOD : pct >= 50 ? WARN : BAD;
        const arc = (frac: number): string => {
            const a = Math.PI * Math.min(1, frac);
            const x = cx - rad * Math.cos(a);
            const y = cy - rad * Math.sin(a);
            return `M ${n2(cx - rad)},${n2(cy)} A ${n2(rad)} ${n2(rad)} 0 0 1 ${n2(x)},${n2(y)}`;
        };
        c.out.push(`<path d="${arc(1)}" fill="none" stroke="${esc(c.t.border)}" stroke-width="${n2(sw)}" stroke-linecap="round"/>`);
        if (pct > 0) c.out.push(`<path d="${arc(pct / 100)}" fill="none" stroke="${color}" stroke-width="${n2(sw)}" stroke-linecap="round"/>`);
        text(c, cx, cy - rad * 0.15, `${Math.round(pct)}%`, { size: Math.round(Math.min(34, rad * 0.45)), weight: 700, anchor: 'middle' });
        text(c, cx, cy + 18, `${r.valueText} / ${r.goal.text}`, { size: 12, fill: c.t.muted, anchor: 'middle', maxWidth: c.W - 2 * c.pad });
        return;
    }
    const size = Math.round(Math.max(22, Math.min(44, bodyH * 0.38, (c.W - 2 * c.pad) / Math.max(4, r.valueText.length * 0.62))));
    const y = c.top + size + 4;
    text(c, c.pad, y, r.valueText, { size, weight: 700 });
    let y2 = y + 22;
    if (r.delta) {
        const pct = r.delta.pct;
        const up = pct !== null && pct > 0;
        const down = pct !== null && pct < 0;
        const label = pct === null ? '—' : `${up ? '▲' : down ? '▼' : '•'} ${Math.abs(Math.round(pct * 10) / 10)}%`;
        text(c, c.pad, y2, label, { size: 12, weight: 700, fill: up ? GOOD : down ? BAD : c.t.muted });
        text(c, c.pad + label.length * 12 * 0.6 + 8, y2, `vs. ${r.delta.previousText}${r.delta.periodDays ? ` (${r.delta.periodDays} días antes)` : ''}`, {
            size: 11,
            fill: c.t.muted,
            maxWidth: c.W - c.pad * 2 - label.length * 8,
        });
        y2 += 20;
    }
    if (r.goal) {
        const w = c.W - c.pad * 2;
        const pct = Math.max(0, Math.min(100, r.goal.pct));
        rect(c, c.pad, y2 - 4, w, 8, c.t.border, { rx: 4 });
        rect(c, c.pad, y2 - 4, (w * pct) / 100, 8, r.goal.pct >= 100 ? GOOD : WARN, { rx: 4 });
        text(c, c.pad, y2 + 20, `${Math.round(r.goal.pct)}% de la meta (${r.goal.text})`, { size: 11, fill: c.t.muted });
    }
}

function drawBars(c: Ctx, r: Extract<WidgetReport, { kind: 'categories' }>): void {
    if (r.rows.length === 0) return emptyNote(c);
    const rowH = 24;
    const fit = Math.max(1, Math.floor((c.bottom - c.top) / rowH));
    const rows = r.rows.length > fit ? r.rows.slice(0, fit - 1) : r.rows;
    const rest = r.rows.length - rows.length;
    const labelW = Math.min(180, (c.W - c.pad * 2) * 0.32);
    const valueW = Math.min(110, Math.max(...rows.map((x) => x.text.length)) * 11 * 0.6 + 8);
    const x0 = c.pad + labelW + 8;
    const barW = Math.max(20, c.W - c.pad - valueW - x0);
    const max = Math.max(...rows.map((x) => x.value), 1);
    rows.forEach((row, i) => {
        const y = c.top + i * rowH;
        text(c, c.pad, y + 15, row.label, { size: 11, fill: c.t.muted, maxWidth: labelW });
        const w = (Math.max(0, row.value) / max) * barW;
        if (r.chart === 'funnel') rect(c, x0 + (barW - w) / 2, y + 4, w, 15, row.color, { rx: 3 });
        else {
            rect(c, x0, y + 4, barW, 15, c.t.border, { rx: 3, opacity: 0.45 });
            rect(c, x0, y + 4, w, 15, row.color, { rx: 3 });
        }
        text(c, c.W - c.pad, y + 15, row.text, { size: 11, weight: 700, anchor: 'end' });
    });
    if (rest > 0) text(c, c.pad, c.top + rows.length * rowH + 15, `y ${rest} más…`, { size: 11, fill: c.t.muted });
}

function drawDonut(c: Ctx, r: Extract<WidgetReport, { kind: 'categories' }>): void {
    const rows = r.rows.filter((x) => x.value > 0);
    if (rows.length === 0) return emptyNote(c);
    const bodyH = c.bottom - c.top;
    const R = Math.max(30, Math.min(bodyH / 2 - 4, (c.W - c.pad * 2) * 0.24));
    const ri = R * 0.62;
    const cx = c.pad + R;
    const cy = c.top + bodyH / 2;
    const total = rows.reduce((s, x) => s + x.value, 0);
    let a = 0;
    for (const row of rows) {
        const span = (row.value / total) * Math.PI * 2;
        if (span >= Math.PI * 2 - 1e-6) {
            c.out.push(`<path d="${arcPath(cx, cy, R, ri, 0, Math.PI)}" fill="${esc(row.color)}"/>`);
            c.out.push(`<path d="${arcPath(cx, cy, R, ri, Math.PI, Math.PI * 2 - 1e-4)}" fill="${esc(row.color)}"/>`);
        } else {
            c.out.push(`<path d="${arcPath(cx, cy, R, ri, a, a + span)}" fill="${esc(row.color)}"/>`);
        }
        a += span;
    }
    text(c, cx, cy + 4, r.totalText, { size: Math.round(Math.min(18, ri * 0.45)), weight: 700, anchor: 'middle', maxWidth: ri * 1.7 });
    text(c, cx, cy + 18, 'Total', { size: 10, fill: c.t.muted, anchor: 'middle' });
    const lx = cx + R + 24;
    const lw = c.W - c.pad - lx;
    const rowH = 18;
    const fit = Math.max(1, Math.floor(bodyH / rowH));
    const shown = rows.length > fit ? rows.slice(0, fit - 1) : rows;
    const y0 = cy - (Math.min(rows.length, fit) * rowH) / 2 + 12;
    shown.forEach((row, i) => {
        const y = y0 + i * rowH;
        rect(c, lx, y - 9, 10, 10, row.color, { rx: 2 });
        const pct = `${Math.round((row.value / total) * 100)}%`;
        const valueText = `${row.text} · ${pct}`;
        text(c, lx + 16, y, row.label, { size: 11, fill: c.t.text, maxWidth: Math.max(30, lw - 16 - valueText.length * 6.2) });
        text(c, c.W - c.pad, y, valueText, { size: 11, fill: c.t.muted, anchor: 'end' });
    });
    if (shown.length < rows.length) text(c, lx, y0 + shown.length * rowH, `y ${rows.length - shown.length} más…`, { size: 11, fill: c.t.muted });
}

function drawTrend(c: Ctx, r: Extract<WidgetReport, { kind: 'categories' }>): void {
    const pts = r.rows;
    if (pts.length === 0) return emptyNote(c);
    const left = c.pad;
    const right = c.W - c.pad;
    const top = c.top + 12;
    const bottom = c.bottom - 16;
    const max = Math.max(...pts.map((p) => p.value), 1);
    const xAt = (i: number): number => (pts.length === 1 ? (left + right) / 2 : left + (i / (pts.length - 1)) * (right - left));
    const yAt = (v: number): number => bottom - (Math.max(0, v) / max) * (bottom - top);
    for (const f of [0.25, 0.5, 0.75]) line(c, left, yAt(max * f), right, yAt(max * f), c.t.border, { opacity: 0.8 });
    const maxRow = pts.find((p) => p.value === max);
    text(c, right, top - 2, maxRow?.text ?? '', { size: 10, fill: c.t.muted, anchor: 'end' });
    const poly = pts.map((p, i) => `${n2(xAt(i))},${n2(yAt(p.value))}`).join(' ');
    if (r.chart === 'area' && pts.length > 1) {
        c.out.push(`<path d="M ${n2(xAt(0))},${n2(bottom)} L ${poly.split(' ').join(' L ')} L ${n2(xAt(pts.length - 1))},${n2(bottom)} Z" fill="${esc(c.t.accent)}" fill-opacity="0.18"/>`);
    }
    c.out.push(`<polyline points="${poly}" fill="none" stroke="${esc(c.t.accent)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    pts.forEach((p, i) => c.out.push(`<circle cx="${n2(xAt(i))}" cy="${n2(yAt(p.value))}" r="2.5" fill="${esc(c.t.accent)}"/>`));
    text(c, left, c.bottom, pts[0]!.label, { size: 10, fill: c.t.muted });
    if (pts.length > 1) text(c, right, c.bottom, pts[pts.length - 1]!.label, { size: 10, fill: c.t.muted, anchor: 'end' });
}

function drawStacked(c: Ctx, r: Extract<WidgetReport, { kind: 'stacked' }>): void {
    if (r.groups.length === 0 || r.series.length === 0) return emptyNote(c);
    const legendH = legend(c, r.series.map((s) => ({ label: s.label, color: s.color })), c.pad, c.top + 10, c.W - c.pad);
    const top = c.top + legendH + 6;
    const sums = r.groups.map((g) => g.values.reduce((s, v) => s + Math.max(0, v), 0));
    const maxStack = Math.max(...sums, 1);
    const maxValue = Math.max(...r.groups.flatMap((g) => g.values), 1);
    const frac = (gi: number, v: number): number =>
        r.mode === 'grouped' ? Math.max(0, v) / maxValue : r.percent ? (sums[gi]! > 0 ? Math.max(0, v) / sums[gi]! : 0) : Math.max(0, v) / maxStack;

    if (r.chart !== 'bar') {
        // Área/línea apilada (o superpuesta).
        const left = c.pad;
        const right = c.W - c.pad;
        const bottom = c.bottom - 16;
        const n = r.groups.length;
        const xAt = (i: number): number => (n === 1 ? (left + right) / 2 : left + (i / (n - 1)) * (right - left));
        const yAt = (f: number): number => bottom - f * (bottom - top);
        const acc = r.groups.map(() => 0);
        r.series.forEach((s, si) => {
            const lows = r.groups.map((_, gi) => (r.mode === 'stacked' ? acc[gi]! : 0));
            const highs = r.groups.map((g, gi) => lows[gi]! + frac(gi, g.values[si] ?? 0));
            if (r.mode === 'stacked') r.groups.forEach((_, gi) => (acc[gi] = highs[gi]!));
            const topPts = highs.map((h, gi) => `${n2(xAt(gi))},${n2(yAt(h))}`);
            const lowPts = lows.map((l, gi) => `${n2(xAt(gi))},${n2(yAt(l))}`).reverse();
            if (n > 1 && (r.mode === 'stacked' || r.chart === 'area')) {
                c.out.push(`<path d="M ${topPts.join(' L ')} L ${lowPts.join(' L ')} Z" fill="${esc(s.color)}" fill-opacity="${r.mode === 'stacked' ? 0.45 : 0.12}"/>`);
            }
            c.out.push(`<polyline points="${topPts.join(' ')}" fill="none" stroke="${esc(s.color)}" stroke-width="2" stroke-linejoin="round"/>`);
        });
        text(c, left, c.bottom, r.groups[0]!.label, { size: 10, fill: c.t.muted });
        if (n > 1) text(c, right, c.bottom, r.groups[n - 1]!.label, { size: 10, fill: c.t.muted, anchor: 'end' });
        return;
    }

    if (r.vertical) {
        const n = r.groups.length;
        const area = c.W - c.pad * 2;
        const colW = area / n;
        const barW = Math.max(4, colW * 0.7);
        const bottom = c.bottom - 16;
        const h = bottom - (top + 14);
        r.groups.forEach((g, gi) => {
            const x = c.pad + gi * colW + (colW - barW) / 2;
            text(c, x + barW / 2, top + 10, g.totalText, { size: 10, weight: 700, anchor: 'middle', maxWidth: colW });
            if (r.mode === 'stacked') {
                let y = bottom;
                g.values.forEach((v, si) => {
                    const hh = frac(gi, v) * h;
                    y -= hh;
                    rect(c, x, y, barW, hh, r.series[si]!.color);
                });
            } else {
                const each = barW / r.series.length;
                g.values.forEach((v, si) => {
                    const hh = frac(gi, v) * h;
                    rect(c, x + si * each, bottom - hh, Math.max(1, each - 1), hh, r.series[si]!.color);
                });
            }
            text(c, x + barW / 2, c.bottom, g.label, { size: 10, fill: c.t.muted, anchor: 'middle', maxWidth: colW });
        });
        return;
    }

    const rowH = r.mode === 'grouped' ? Math.max(22, r.series.length * 6 + 10) : 24;
    const fit = Math.max(1, Math.floor((c.bottom - top) / rowH));
    const groups = r.groups.length > fit ? r.groups.slice(0, fit - 1) : r.groups;
    const labelW = Math.min(170, (c.W - c.pad * 2) * 0.3);
    const valueW = Math.min(100, Math.max(...groups.map((g) => g.totalText.length)) * 11 * 0.6 + 8);
    const x0 = c.pad + labelW + 8;
    const barW = Math.max(20, c.W - c.pad - valueW - x0);
    groups.forEach((g, gi) => {
        const y = top + gi * rowH;
        text(c, c.pad, y + 15, g.label, { size: 11, fill: c.t.muted, maxWidth: labelW });
        if (r.mode === 'stacked') {
            let x = x0;
            g.values.forEach((v, si) => {
                const w = frac(gi, v) * barW;
                rect(c, x, y + 4, w, 15, r.series[si]!.color);
                x += w;
            });
        } else {
            const each = (rowH - 8) / r.series.length;
            g.values.forEach((v, si) => rect(c, x0, y + 4 + si * each, frac(gi, v) * barW, Math.max(1, each - 1), r.series[si]!.color));
        }
        text(c, c.W - c.pad, y + 15, g.totalText, { size: 11, weight: 700, anchor: 'end' });
    });
    if (groups.length < r.groups.length) text(c, c.pad, top + groups.length * rowH + 15, `y ${r.groups.length - groups.length} más…`, { size: 11, fill: c.t.muted });
}

function drawTable(c: Ctx, columns: string[], rows: string[][]): void {
    if (rows.length === 0) return emptyNote(c);
    const rowH = 22;
    const fit = Math.max(1, Math.floor((c.bottom - c.top) / rowH) - 1);
    const shown = rows.length > fit ? rows.slice(0, fit - 1) : rows;
    const cols = columns.length;
    const colW = (c.W - c.pad * 2) / Math.max(1, cols);
    columns.forEach((col, i) => text(c, c.pad + i * colW, c.top + 14, col, { size: 10, weight: 700, fill: c.t.muted, maxWidth: colW - 6 }));
    line(c, c.pad, c.top + 20, c.W - c.pad, c.top + 20, c.t.border);
    shown.forEach((row, ri) => {
        const y = c.top + 20 + (ri + 1) * rowH;
        row.forEach((cell, i) => text(c, c.pad + i * colW, y - 6, cell, { size: 11, maxWidth: colW - 6 }));
        line(c, c.pad, y, c.W - c.pad, y, c.t.border, { opacity: 0.6 });
    });
    if (shown.length < rows.length) text(c, c.pad, c.top + 20 + (shown.length + 1) * rowH - 6, `y ${rows.length - shown.length} más…`, { size: 11, fill: c.t.muted });
}

function drawPivot(c: Ctx, r: Extract<WidgetReport, { kind: 'pivot' }>): void {
    if (r.rows.length === 0) return emptyNote(c);
    const rowH = 22;
    const fitRows = Math.max(1, Math.floor((c.bottom - c.top) / rowH) - 2);
    const rows = r.rows.length > fitRows ? r.rows.slice(0, fitRows) : r.rows;
    const firstW = Math.min(170, (c.W - c.pad * 2) * 0.28);
    const area = c.W - c.pad * 2 - firstW;
    const colW = Math.max(56, area / (r.cols.length + 1));
    const maxCols = Math.max(1, Math.floor(area / colW) - 1);
    const cols = r.cols.slice(0, maxCols);
    const xCol = (i: number): number => c.pad + firstW + (i + 1) * colW;
    text(c, c.pad, c.top + 14, r.rowHeader, { size: 10, weight: 700, fill: c.t.muted, maxWidth: firstW - 6 });
    cols.forEach((col, i) => text(c, xCol(i) - 4, c.top + 14, col.label, { size: 10, weight: 700, fill: c.t.muted, anchor: 'end', maxWidth: colW - 6 }));
    const totalX = xCol(cols.length);
    text(c, totalX - 4, c.top + 14, 'Total', { size: 10, weight: 700, anchor: 'end' });
    line(c, c.pad, c.top + 20, c.W - c.pad, c.top + 20, c.t.border);
    const span = r.max - Math.min(r.min, 0);
    rows.forEach((row, ri) => {
        const y = c.top + 20 + (ri + 1) * rowH;
        text(c, c.pad, y - 6, row.label, { size: 11, maxWidth: firstW - 6 });
        cols.forEach((_, ci) => {
            const cell = row.cells[ci]!;
            if (r.heatmap && cell.value !== null && span > 0) {
                const alpha = 0.06 + Math.max(0, Math.min(1, (cell.value - Math.min(r.min, 0)) / span)) * 0.44;
                c.out.push(`<rect x="${n2(xCol(ci) - colW)}" y="${n2(y - rowH)}" width="${n2(colW)}" height="${rowH}" fill="${esc(c.t.accent)}" fill-opacity="${heat(alpha)}"/>`);
            }
            text(c, xCol(ci) - 4, y - 6, cell.text, { size: 11, anchor: 'end', maxWidth: colW - 6 });
        });
        text(c, totalX - 4, y - 6, row.totalText, { size: 11, weight: 700, anchor: 'end', maxWidth: colW - 6 });
        line(c, c.pad, y, c.W - c.pad, y, c.t.border, { opacity: 0.6 });
    });
    const yt = c.top + 20 + (rows.length + 1) * rowH;
    text(c, c.pad, yt - 6, 'Total', { size: 11, weight: 700 });
    cols.forEach((col, ci) => text(c, xCol(ci) - 4, yt - 6, col.totalText, { size: 11, weight: 700, anchor: 'end', maxWidth: colW - 6 }));
    text(c, totalX - 4, yt - 6, r.totalText, { size: 11, weight: 700, anchor: 'end', maxWidth: colW - 6 });
    if (rows.length < r.rows.length || cols.length < r.cols.length) {
        text(c, c.pad, Math.min(c.H - 4, yt + 14), `Se muestran ${rows.length} de ${r.rows.length} filas y ${cols.length} de ${r.cols.length} columnas.`, { size: 10, fill: c.t.muted });
    }
}

/**
 * Alto con el que el widget se lee completo (sin «y N más…» mientras quepa en
 * un tope razonable): la imagen PNG lo usa como mínimo y el PDF como alto de
 * cada gráfico.
 */
export function suggestedReportHeight(report: WidgetReport, opts: { bare?: boolean; max?: number } = {}): number {
    const head = opts.bare ? 16 : report.subtitle ? 70 : 54;
    const max = opts.max ?? 1400;
    let body: number;
    switch (report.kind) {
        case 'kpi':
            body = report.gauge ? 170 : 60 + (report.delta ? 22 : 0) + (report.goal ? 36 : 0);
            break;
        case 'categories':
            body = report.chart === 'pie'
                ? Math.max(200, Math.min(report.rows.length, 14) * 18 + 30)
                : report.chart === 'line' || report.chart === 'area'
                  ? 220
                  : Math.max(1, report.rows.length) * 24 + 16;
            break;
        case 'stacked': {
            const legendRows = Math.ceil(report.series.length / 4);
            body = report.chart !== 'bar' || report.vertical
                ? 240 + legendRows * 16
                : legendRows * 16 + 16 + Math.max(1, report.groups.length) * (report.mode === 'grouped' ? Math.max(22, report.series.length * 6 + 10) : 24);
            break;
        }
        case 'table':
            body = (Math.max(1, report.rows.length) + 2) * 22;
            break;
        case 'pivot':
            body = (Math.max(1, report.rows.length) + 3) * 22 + 10;
            break;
    }
    return Math.min(max, Math.round(head + body + 16));
}
