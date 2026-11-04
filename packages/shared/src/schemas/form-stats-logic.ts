/**
 * v0.1.358 — La lógica de las estadísticas SIN Zod (la importa la página
 * pública del formulario, que tiene que ser chica). Los esquemas viven en
 * `form-stats.ts`.
 *
 * Estadísticas de un formulario público: cuántos lo vieron,
 * cuántos empezaron a responder, cuántos lo enviaron, hasta dónde llegaron,
 * dónde lo dejaron, de dónde vinieron y desde qué dispositivo.
 *
 * Son CONTADORES por día, nunca datos de una persona: no hay cookies ni se
 * guarda la IP. La página manda eventos sueltos («lo vi», «empecé», «llegué al
 * paso 3», «me fui en la pregunta X»); el servidor sólo suma.
 */

export const FORM_STAT_DEVICES = ['mobile', 'tablet', 'desktop'] as const;
export type FormStatDevice = (typeof FORM_STAT_DEVICES)[number];

export const FORM_STATS_RANGES = [7, 30, 90] as const;
export type FormStatsRange = (typeof FORM_STATS_RANGES)[number];

/** Pasos que se cuentan (una pregunta por pantalla puede tener muchos). */
export const FORM_STAT_MAX_STEP = 300;

/**
 * Origen de la visita, como clave corta:
 * - `d` = entró directo (o desde la propia app),
 * - `u:<etiqueta>` = el `utm_source` del enlace (una campaña),
 * - `h:<sitio>` = el sitio de donde vino (o donde está insertado).
 */
export const FORM_STAT_SOURCE_RE = /^(d|u:[a-z0-9._-]{1,40}|h:[a-z0-9.-]{1,80})$/;
export const FORM_STAT_ITEM_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;

export interface FormStatEvent {
    kind: 'view' | 'start' | 'step' | 'leave';
    /** `step` — el paso al que llegó (1 = el primero). */
    step?: number;
    /** `leave` — la última pregunta que tocó antes de irse. */
    item?: string;
    /** `view` — de dónde vino (ver `FORM_STAT_SOURCE_RE`). */
    src?: string;
    /** `view` — desde qué dispositivo. */
    dev?: FormStatDevice;
}

/** Los contadores de un día: `v`, `s`, `sub`, `st:<n>`, `lv:<id>`, `src:<k>`, `dev:<d>`, `tsum`, `tn`. */
export type FormStatCounts = Record<string, number>;

/** `URL` existe en Node y en el navegador; el `lib` del paquete no trae el DOM (ver `embeds.ts`). */
declare const URL: { new (input: string): { hostname: string } };

const DEV_KEY: Record<FormStatDevice, string> = { mobile: 'm', tablet: 't', desktop: 'd' };

/**
 * Qué contadores suma un evento. Lo que no tiene la forma esperada no suma
 * nada (una página vieja o un pedido armado a mano no ensucian los números).
 */
export function formStatFields(e: FormStatEvent): string[] {
    switch (e.kind) {
        case 'view': {
            const src = e.src && FORM_STAT_SOURCE_RE.test(e.src) ? e.src : 'd';
            return ['v', `src:${src}`, `dev:${DEV_KEY[e.dev ?? 'desktop']}`];
        }
        case 'start':
            return ['s'];
        case 'step':
            return e.step ? [`st:${e.step}`] : [];
        case 'leave':
            return e.item ? [`lv:${e.item}`] : [];
        default:
            return [];
    }
}

/** Un sitio, sin el `www.` ni los prefijos de los enlaces de redes («l.facebook.com»). */
function cleanHost(host: string): string {
    return host
        .toLowerCase()
        .replace(/\.$/, '')
        .replace(/^(www\d?|m|l|lm|mobile)\./, '');
}

function cleanTag(raw: string): string {
    return raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

/**
 * La clave de origen de una visita. Gana la campaña (`utm_source`); si no, el
 * sitio de donde vino; si vino de la propia app (o sin referencia), directo.
 */
export function formStatSource(input: { utm_source?: string | null; referrer?: string | null; own_hosts?: readonly string[] }): string {
    const tag = input.utm_source ? cleanTag(input.utm_source) : '';
    if (tag) return `u:${tag}`;
    if (!input.referrer) return 'd';
    let host = '';
    try {
        host = new URL(input.referrer).hostname;
    } catch {
        return 'd';
    }
    const clean = cleanHost(host).slice(0, 80);
    if (!clean || !/^[a-z0-9.-]+$/.test(clean)) return 'd';
    const own = (input.own_hosts ?? []).map(cleanHost);
    if (own.includes(clean)) return 'd';
    return `h:${clean}`;
}

/** Suma dos juegos de contadores (el de la base y el que todavía está en memoria). */
export function mergeFormStatCounts(a: FormStatCounts, b: FormStatCounts): FormStatCounts {
    const out: FormStatCounts = { ...a };
    for (const [k, v] of Object.entries(b)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n === 0) continue;
        out[k] = (out[k] ?? 0) + n;
    }
    return out;
}

export interface FormStatsDay {
    /** `YYYY-MM-DD` en la zona de la empresa. */
    day: string;
    views: number;
    starts: number;
    submits: number;
}

export interface FormStatsDto {
    range: { from: string; to: string; days: number };
    days: FormStatsDay[];
    totals: {
        views: number;
        starts: number;
        submits: number;
        /** Empezaron / vieron (null si nadie lo vio). */
        start_rate: number | null;
        /** Enviaron / empezaron (null si nadie empezó). */
        completion_rate: number | null;
        /** Tiempo promedio desde que empezó hasta que envió, en segundos. */
        avg_seconds: number | null;
    };
    /** Cuántos llegaron a cada paso (sólo con varias páginas o una pregunta por pantalla). */
    steps: Array<{ step: number; reached: number }>;
    /** Dónde lo dejaron: la última pregunta que tocaron antes de irse. */
    leaves: Array<{ item: string; count: number }>;
    /** De dónde vinieron (clave de `formStatSource`; `o` = los demás). */
    sources: Array<{ key: string; count: number }>;
    devices: Record<FormStatDevice, number>;
    /** Respuestas que llegaron desde siempre (el contador del formulario). */
    all_time_submits?: number;
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Los días de `from` a `to` (inclusive), en orden. */
export function formStatsDayRange(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
}

const MAX_SOURCES = 10;
const MAX_LEAVES = 15;

/**
 * El resumen que ve el equipo, a partir de los contadores de cada día. Puro:
 * lo usa el servidor y lo prueban los tests.
 */
export function summarizeFormStats(rows: ReadonlyArray<{ day: string; counts: FormStatCounts }>, range: { from: string; to: string }): FormStatsDto {
    const byDay = new Map<string, FormStatCounts>();
    for (const r of rows) {
        if (r.day < range.from || r.day > range.to) continue;
        byDay.set(r.day, mergeFormStatCounts(byDay.get(r.day) ?? {}, r.counts));
    }
    const all = [...byDay.values()].reduce<FormStatCounts>((acc, c) => mergeFormStatCounts(acc, c), {});
    const n = (k: string): number => Math.max(0, Math.round(all[k] ?? 0));
    const list = formStatsDayRange(range.from, range.to);
    const days = list.map((day) => {
        const c = byDay.get(day) ?? {};
        return { day, views: Math.round(c.v ?? 0), starts: Math.round(c.s ?? 0), submits: Math.round(c.sub ?? 0) };
    });
    const views = n('v');
    const starts = n('s');
    const submits = n('sub');
    const tn = n('tn');
    const prefixed = (prefix: string): Array<[string, number]> =>
        Object.entries(all)
            .filter(([k, v]) => k.startsWith(prefix) && v > 0)
            .map(([k, v]) => [k.slice(prefix.length), Math.round(v)] as [string, number]);

    const steps = prefixed('st:')
        .map(([k, v]) => ({ step: Number(k), reached: v }))
        .filter((s) => Number.isInteger(s.step) && s.step >= 1)
        .sort((a, b) => a.step - b.step);
    const leaves = prefixed('lv:')
        .map(([item, count]) => ({ item, count }))
        .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
        .slice(0, MAX_LEAVES);
    const sourcesAll = prefixed('src:')
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const sources = sourcesAll.slice(0, MAX_SOURCES);
    const rest = sourcesAll.slice(MAX_SOURCES).reduce((acc, s) => acc + s.count, 0);
    if (rest > 0) {
        const other = sources.find((s) => s.key === 'o');
        if (other) other.count += rest;
        else sources.push({ key: 'o', count: rest });
    }
    return {
        range: { from: range.from, to: range.to, days: list.length },
        days,
        totals: {
            views,
            starts,
            submits,
            start_rate: views > 0 ? Math.min(1, starts / views) : null,
            completion_rate: starts > 0 ? Math.min(1, submits / starts) : null,
            avg_seconds: tn > 0 ? Math.round(n('tsum') / tn) : null,
        },
        steps,
        leaves,
        sources,
        devices: { mobile: n('dev:m'), tablet: n('dev:t'), desktop: n('dev:d') },
    };
}

/** Lo que se ve de un origen: «Directo», «google.com», «Campaña: verano». */
export function formStatSourceLabel(key: string): string {
    if (key === 'd') return 'Directo';
    if (key === 'o') return 'Otros';
    // v0.1.359 — el QR del formulario lleva utm_source=qr.
    if (key === 'u:qr') return 'Código QR';
    if (key.startsWith('u:')) return `Campaña: ${key.slice(2)}`;
    if (key.startsWith('h:')) return key.slice(2);
    return key;
}

// ─────────────────────────── Guardar el avance ───────────────────────────

/** El código de un avance guardado (va en el enlace del correo). */
export const FORM_DRAFT_CODE_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** Un avance guardado dura esto (días). */
export const FORM_DRAFT_TTL_DAYS = 30;
/** Tope de lo que se guarda de un avance (JSON). */
export const FORM_DRAFT_MAX_BYTES = 64 * 1024;

export interface SaveFormDraftResult {
    ok: true;
    code: string;
    /** ¿Se mandó el correo con el enlace? (no, al actualizar uno que ya tenía). */
    email_sent: boolean;
    expires_at: string;
}

export interface PublicFormDraft {
    values: Record<string, unknown>;
    page: number;
    expires_at: string;
}
