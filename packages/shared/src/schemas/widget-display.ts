/**
 * v0.1.396 (ADR-S99) — Dónde y cuándo aparece el widget de contacto, el
 * saludo que se adelanta y las estadísticas por botón. SIN Zod: lo importa la
 * página del widget, que tiene que ser chica. Los esquemas viven en
 * `contact-widget.ts`.
 *
 * Todo esto lo decide la PÁGINA del widget con lo que le cuenta `embed.js`
 * del sitio (la dirección, el ancho, cuánto lleva la persona en la página y
 * cuánto bajó): la página del widget sigue siendo la misma para todos y la
 * caché pública no cambia.
 */
import { pageMatchesAny } from './conversion-logic';

/** En qué páginas del sitio se ve: todas, sólo las que contienen…, todas menos… */
export const WIDGET_PAGE_MODES = ['all', 'only', 'except'] as const;
export type WidgetPageMode = (typeof WIDGET_PAGE_MODES)[number];

/** En qué dispositivos se ve (celular = pantalla de menos de 640 px, como el resto del widget). */
export const WIDGET_DEVICES = ['all', 'desktop', 'mobile'] as const;
export type WidgetDevice = (typeof WIDGET_DEVICES)[number];

export const WIDGET_MOBILE_MAX = 640;
export const WIDGET_MAX_DELAY_S = 120;
export const WIDGET_MAX_SCROLL_PCT = 90;
export const WIDGET_MAX_GREETING_RULES = 10;
export const WIDGET_GREETING_MAX = 160;

export interface PublicWidgetDisplay {
    pages: WidgetPageMode;
    /** Palabras de la dirección, separadas por coma (sin mayúsculas ni tildes). */
    page_terms: string;
    devices: WidgetDevice;
    /** Segundos en la página antes de aparecer (0 = enseguida). */
    delay_s: number;
    /** Cuánto tiene que bajar la persona, en % de la página (0 = no hace falta). */
    scroll_pct: number;
}

export interface PublicWidgetGreeting {
    /** El saludo de siempre (vacío = sólo en las páginas que tienen el suyo). */
    text: string;
    /** El saludo de una página: el primero cuya dirección contiene las palabras. */
    rules: Array<{ contains: string; text: string }>;
    /** Segundos en la página antes de saludar. */
    delay_s: number;
    /** También en el celular (ocupa más lugar: por defecto no). */
    mobile: boolean;
}

/** Lo que `embed.js` cuenta del sitio. */
export interface WidgetHostView {
    url: string | null;
    width: number;
    /** Milisegundos desde que se abrió la página del sitio. */
    since?: number;
    /** Cuánto bajó, en % del alto que se puede bajar (0-100). */
    scroll?: number;
}

/** ¿Esta página del sitio lleva el widget? (por la dirección; sin palabras, todas). */
export function widgetShownOnPage(d: Pick<PublicWidgetDisplay, 'pages' | 'page_terms'>, url: string | null | undefined): boolean {
    if (d.pages === 'all' || !d.page_terms.trim()) return true;
    const hit = pageMatchesAny(url ?? '', d.page_terms);
    return d.pages === 'only' ? hit : !hit;
}

export function widgetDeviceOk(d: Pick<PublicWidgetDisplay, 'devices'>, width: number): boolean {
    if (d.devices === 'all' || !(width > 0)) return true;
    const mobile = width < WIDGET_MOBILE_MAX;
    return d.devices === 'mobile' ? mobile : !mobile;
}

/**
 * ¿Ya puede aparecer? `wait` = cuántos milisegundos faltan por la demora
 * (null si no hay que esperar); `scroll` = si todavía falta que la persona
 * baje. Las dos condiciones se cumplen las dos (la que no se pidió, ya está).
 */
export function widgetRevealState(d: PublicWidgetDisplay, h: WidgetHostView): { shown: boolean; wait: number | null; needsScroll: boolean } {
    if (!widgetShownOnPage(d, h.url) || !widgetDeviceOk(d, h.width)) return { shown: false, wait: null, needsScroll: false };
    const since = typeof h.since === 'number' && h.since >= 0 ? h.since : 0;
    const left = d.delay_s > 0 ? d.delay_s * 1000 - since : 0;
    const wait = left > 0 ? left : null;
    // Un `embed.js` viejo (guardado en la caché del sitio) no cuenta cuánto bajó:
    // sin ese dato no se espera el scroll (nunca un widget que no aparece).
    const needsScroll = d.scroll_pct > 0 && typeof h.scroll === 'number' && h.scroll < d.scroll_pct;
    return { shown: wait === null && !needsScroll, wait, needsScroll };
}

/** El saludo para esta página (null = no saluda aquí). */
export function widgetGreetingFor(g: PublicWidgetGreeting | null | undefined, url: string | null | undefined, width: number): string | null {
    if (!g) return null;
    if (!g.mobile && width > 0 && width < WIDGET_MOBILE_MAX) return null;
    for (const r of g.rules) {
        if (r.contains.trim() && r.text.trim() && pageMatchesAny(url ?? '', r.contains)) return r.text.trim();
    }
    return g.text.trim() || null;
}

// ─────────────────────────── Estadísticas ───────────────────────────

export const WIDGET_STATS_RANGES = [7, 30, 90] as const;
export type WidgetStatsRange = (typeof WIDGET_STATS_RANGES)[number];
export const WIDGET_STAT_BUTTON_RE = /^[a-z0-9]{1,16}$/;

/**
 * Lo que manda la página del widget. Son CONTADORES por día: nunca la IP ni
 * nada de la persona.
 * - `view`: el widget apareció en una página (una vez por página abierta).
 * - `open`: abrió el panel o el menú.
 * - `click`: tocó un botón.
 * - `greet` / `greet_click`: vio el saludo / lo tocó.
 * - `lead`: dejó sus datos o agendó desde el formulario o la agenda de ese
 *   botón (la página del widget lo sabe porque le pasa la conversión al sitio).
 */
export interface WidgetStatEvent {
    kind: 'view' | 'open' | 'click' | 'greet' | 'greet_click' | 'lead';
    /** `click` y `lead` — qué botón. */
    button?: string;
    /** `view` — desde qué dispositivo. */
    dev?: 'mobile' | 'desktop';
}

/** Los contadores de un día: `v`, `o`, `g`, `gc`, `c:<botón>`, `l:<botón>`, `dev:m|d`. */
export type WidgetStatCounts = Record<string, number>;

/** Qué contadores suma un evento (lo que no tiene la forma esperada no suma nada). */
export function widgetStatFields(e: WidgetStatEvent): string[] {
    switch (e.kind) {
        case 'view':
            return ['v', `dev:${e.dev === 'mobile' ? 'm' : 'd'}`];
        case 'open':
            return ['o'];
        case 'greet':
            return ['g'];
        case 'greet_click':
            return ['gc'];
        case 'click':
            return e.button && WIDGET_STAT_BUTTON_RE.test(e.button) ? [`c:${e.button}`] : [];
        case 'lead':
            return e.button && WIDGET_STAT_BUTTON_RE.test(e.button) ? [`l:${e.button}`] : [];
        default:
            return [];
    }
}

export interface WidgetStatsDay {
    day: string;
    views: number;
    opens: number;
    clicks: number;
    leads: number;
}

export interface WidgetStatsButton {
    id: string;
    clicks: number;
    leads: number;
}

export interface WidgetStatsDto {
    from: string;
    to: string;
    views: number;
    opens: number;
    clicks: number;
    leads: number;
    greetings: number;
    greeting_clicks: number;
    mobile: number;
    desktop: number;
    buttons: WidgetStatsButton[];
    days: WidgetStatsDay[];
}

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Los días de un rango, ambos incluidos (`AAAA-MM-DD`). */
export function widgetStatsDayRange(from: string, to: string): string[] {
    const out: string[] = [];
    const d = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let i = 0; i < 400 && d.getTime() <= end.getTime(); i++) {
        out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

/** El resumen de un rango con los contadores por día (varias filas del mismo día se suman). */
export function summarizeWidgetStats(rows: ReadonlyArray<{ day: string; counts: WidgetStatCounts }>, range: { from: string; to: string }): WidgetStatsDto {
    const byDay = new Map<string, WidgetStatCounts>();
    for (const r of rows) {
        const into = byDay.get(r.day) ?? {};
        for (const [k, v] of Object.entries(r.counts)) into[k] = (into[k] ?? 0) + num(v);
        byDay.set(r.day, into);
    }
    const buttons = new Map<string, WidgetStatsButton>();
    const btn = (id: string): WidgetStatsButton => {
        let b = buttons.get(id);
        if (!b) buttons.set(id, (b = { id, clicks: 0, leads: 0 }));
        return b;
    };
    const out: WidgetStatsDto = {
        from: range.from,
        to: range.to,
        views: 0,
        opens: 0,
        clicks: 0,
        leads: 0,
        greetings: 0,
        greeting_clicks: 0,
        mobile: 0,
        desktop: 0,
        buttons: [],
        days: [],
    };
    for (const day of widgetStatsDayRange(range.from, range.to)) {
        const c = byDay.get(day) ?? {};
        const row: WidgetStatsDay = { day, views: num(c.v), opens: num(c.o), clicks: 0, leads: 0 };
        for (const [k, v] of Object.entries(c)) {
            if (k.startsWith('c:')) {
                row.clicks += num(v);
                btn(k.slice(2)).clicks += num(v);
            } else if (k.startsWith('l:')) {
                row.leads += num(v);
                btn(k.slice(2)).leads += num(v);
            }
        }
        out.views += row.views;
        out.opens += row.opens;
        out.clicks += row.clicks;
        out.leads += row.leads;
        out.greetings += num(c.g);
        out.greeting_clicks += num(c.gc);
        out.mobile += num(c['dev:m']);
        out.desktop += num(c['dev:d']);
        out.days.push(row);
    }
    out.buttons = [...buttons.values()].sort((a, b) => b.clicks + b.leads - (a.clicks + a.leads));
    return out;
}

/** Un porcentaje legible («38 %»; sin base, «—»). */
export function widgetRate(part: number, total: number): string {
    if (!(total > 0)) return '—';
    const p = Math.round((part / total) * 1000) / 10;
    return `${p % 1 === 0 ? p.toFixed(0) : p.toFixed(1).replace('.', ',')} %`;
}
