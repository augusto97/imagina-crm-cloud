import {
    OPTION_COLOR_HEX,
    REPORT_LIGHT_THEME,
    REPORT_PALETTE,
    type ReportContext,
    type ReportField,
    type ReportSvgTheme,
} from '@imagina-base/shared';

import type { WidgetSpec } from '@/types/dashboard';

/**
 * v0.1.291 — Piezas del navegador para exportar un widget (la imagen PNG y el
 * CSV). El dibujo y los datos salen del modelo compartido (`buildWidgetReport`
 * + `widgetReportSvg` / `widgetReportCsv`): lo mismo que usa el correo
 * programado en el servidor.
 */

/** `"220 9% 46%"` (o `"220 9% 46% / 0.5"`, el formato de los tokens) → `#rrggbb`. */
export function hslTripletToHex(triplet: string): string | null {
    const m = /^\s*(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%/.exec(triplet);
    if (!m) return null;
    const h = (((Number(m[1]) % 360) + 360) % 360) / 360;
    const s = Math.min(1, Number(m[2]) / 100);
    const l = Math.min(1, Number(m[3]) / 100);
    const hue = (p: number, q: number, t: number): number => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    let r = l;
    let g = l;
    let b = l;
    if (s > 0) {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue(p, q, h + 1 / 3);
        g = hue(p, q, h);
        b = hue(p, q, h - 1 / 3);
    }
    const hex = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Un token del tema (`--imcrm-card`) leído en un elemento → hex. */
function tokenHex(style: CSSStyleDeclaration, name: string): string | null {
    const raw = style.getPropertyValue(name).trim();
    if (raw === '') return null;
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    return hslTripletToHex(raw);
}

/**
 * Colores de la tarjeta TAL COMO SE VE: los tokens leídos en el propio
 * elemento (un widget con estilo propio los re-tiñe) y en el tema activo
 * (claro u oscuro).
 */
export function themeFromElement(el: Element | null): ReportSvgTheme {
    if (!el || typeof getComputedStyle !== 'function') return REPORT_LIGHT_THEME;
    const s = getComputedStyle(el);
    return {
        background: tokenHex(s, '--imcrm-card') ?? REPORT_LIGHT_THEME.background,
        text: tokenHex(s, '--imcrm-card-foreground') ?? tokenHex(s, '--imcrm-foreground') ?? REPORT_LIGHT_THEME.text,
        muted: tokenHex(s, '--imcrm-muted-foreground') ?? REPORT_LIGHT_THEME.muted,
        border: tokenHex(s, '--imcrm-border') ?? REPORT_LIGHT_THEME.border,
        accent: tokenHex(s, '--imcrm-primary') ?? REPORT_LIGHT_THEME.accent,
    };
}

/** Color de una opción (`blue` o un hex) con el tono del tema activo. */
export function optionColorFrom(el: Element | null): (color: string) => string {
    const s = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    return (color: string) => {
        if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
        const fromTheme = s ? tokenHex(s, `--imcrm-opt-${color}`) : null;
        return fromTheme ?? OPTION_COLOR_HEX[color] ?? '#9aa1ad';
    };
}

const PALETTE_KEYS = ['blue', 'amber', 'green', 'violet', 'rose', 'cyan', 'orange', 'teal', 'pink', 'lime', 'indigo', 'slate'];

export function paletteFrom(el: Element | null): string[] {
    const color = optionColorFrom(el);
    const out = PALETTE_KEYS.map((k) => color(k));
    return out.length > 0 ? out : [...REPORT_PALETTE];
}

/**
 * Ids de las personas que aparecen en los datos de un widget (para resolver
 * sus nombres antes de exportar): grupos y series por un campo persona, y las
 * celdas de las columnas persona de una tabla.
 */
export function userIdsInData(widget: Pick<WidgetSpec, 'type' | 'config'>, data: unknown, field: (id: unknown) => ReportField | undefined): number[] {
    if (typeof data !== 'object' || data === null) return [];
    const ids = new Set<number>();
    const add = (v: unknown): void => {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) ids.add(n);
    };
    const isUser = (id: unknown): boolean => field(id)?.type === 'user';
    const cfg = widget.config ?? {};
    const d = data as Record<string, unknown>;
    const groupIsUser = isUser(cfg.group_by_field_id);
    const subIsUser = isUser(cfg.sub_group_by_field_id);
    if (Array.isArray(d.data)) {
        for (const row of d.data as Array<{ label?: unknown; segments?: Array<{ series?: unknown }> }>) {
            if (groupIsUser) add(row.label);
            if (subIsUser) for (const s of row.segments ?? []) add(s.series);
        }
    }
    if (Array.isArray(d.series) && subIsUser) for (const s of d.series as Array<{ key?: unknown }>) add(s.key);
    const pivot = d.pivot as { rows?: Array<{ key?: unknown }>; cols?: Array<{ key?: unknown }> } | undefined;
    if (pivot) {
        if (groupIsUser) for (const r of pivot.rows ?? []) add(r.key);
        if (subIsUser) for (const c of pivot.cols ?? []) add(c.key);
    }
    if (widget.type === 'table' && Array.isArray(d.columns) && Array.isArray(d.rows)) {
        const cols = (d.columns as Array<{ slug: string; type: string }>).filter((c) => c.type === 'user');
        for (const row of d.rows as Array<{ fields?: Record<string, unknown> }>) {
            for (const c of cols) {
                const v = row.fields?.[c.slug];
                if (Array.isArray(v)) v.forEach(add);
                else add(v);
            }
        }
    }
    return [...ids];
}

/** Contexto del reporte a partir de los campos de la lista y los nombres resueltos. */
export function reportContext(opts: {
    fields: readonly ReportField[];
    names: ReadonlyMap<number, string>;
    format: ReportContext['format'];
    listName: string | null;
    el: Element | null;
}): ReportContext {
    const byId = new Map(opts.fields.map((f) => [f.id, f]));
    return {
        field: (id) => byId.get(Number(id)),
        userName: (id) => opts.names.get(id) ?? null,
        format: opts.format,
        optionColor: optionColorFrom(opts.el),
        palette: paletteFrom(opts.el),
        listName: () => opts.listName,
    };
}

/** El SVG del widget → PNG (al doble de resolución, para pantallas retina). */
export async function svgToPngBlob(svg: string, width: number, height: number, background: string, scale = 2): Promise<Blob> {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
        const img = new Image();
        img.decoding = 'sync';
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('No se pudo dibujar la imagen del widget.'));
            img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('El navegador no permite dibujar la imagen.');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar el PNG.'))), 'image/png');
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Descarga un archivo generado en el navegador. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `YYYY-MM-DD` de hoy (para el nombre del archivo). */
export function todayYmd(): string {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
