import { z } from 'zod';

/**
 * v0.1.385 — «Más usadas» del menú de Listas (reemplaza a «Recientes»).
 *
 * «Recientes» ordenaba por lo último abierto, y cualquier registro que se
 * abría un momento para corregir un dato pasaba a encabezarla: la sección
 * cambiaba con cada clic. Ahora se muestran las listas y los tableros que la
 * persona USA, con un orden que no se mueve mientras trabaja:
 *
 * - **Qué cuenta**: entrar a una lista (sus registros) o a un tablero. No
 *   cuentan los registros, las vistas, los filtros ni las pantallas de
 *   ajustes. Una misma lista cuenta como mucho una vez cada 30 minutos.
 * - **Cómo se ordena**: frecuencia con caducidad. Cada visita suma 1 y pierde
 *   la mitad de su peso cada 14 días.
 * - **Cuándo entra**: con visitas en al menos DOS días distintos y un puntaje
 *   reciente de 1,5 o más (una visita suelta, o dos separadas por meses, no
 *   entran).
 * - **Estable**: el cliente fija el orden al abrir la app y sólo agrega al
 *   final lo nuevo que califica (`stableMostUsed`).
 *
 * Se guarda en la cuenta de la persona, por empresa
 * (`memberships.settings.most_used`), y se puede apagar; apagada no se anota
 * nada. Todo lo de aquí es puro: lo usan el servidor (al anotar y al
 * ordenar) y los tests.
 */

export const MOST_USED_KINDS = ['list', 'dashboard'] as const;
export type MostUsedKind = (typeof MOST_USED_KINDS)[number];

/** Cuántas se muestran en el menú. */
export const MOST_USED_SHOWN = 5;
/** Cuántas devuelve el servidor (el cliente saltea las borradas o sin acceso). */
export const MOST_USED_RANKED = 12;
/** Vida media del peso de una visita. */
export const MOST_USED_HALF_LIFE_MS = 14 * 24 * 60 * 60_000;
/** Una misma lista o tablero cuenta como mucho una vez en este lapso. */
export const MOST_USED_DEDUPE_MS = 30 * 60_000;
/** Días distintos con visitas para aparecer. */
export const MOST_USED_MIN_DAYS = 2;
/** Puntaje reciente mínimo para aparecer. */
export const MOST_USED_MIN_SCORE = 1.5;
/** Entradas guardadas como máximo (las de menos peso se descartan). */
export const MOST_USED_MAX_ENTRIES = 60;
/** Por debajo de este peso una entrada ya no vale la pena guardarla. */
const MOST_USED_FORGET_SCORE = 0.05;
/** Visitas que llegan tarde (cola del navegador) se aceptan hasta 7 días atrás. */
const MOST_USED_MAX_LAG_MS = 7 * 24 * 60 * 60_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface MostUsedRef {
    kind: MostUsedKind;
    id: number;
}

/** Lo guardado por lista o tablero. */
export interface MostUsedEntry {
    /** Puntaje al momento `t`. */
    s: number;
    /** Última visita que contó (ms). */
    t: number;
    /** Días distintos con visitas. */
    d: number;
    /** Último día con visita (`YYYY-MM-DD`, el del dispositivo). */
    ld: string;
}

export interface MostUsedStore {
    /** Ausente = encendida (por defecto). */
    enabled: boolean;
    /** Por clave `l:<id>` / `d:<id>`. */
    items: Record<string, MostUsedEntry>;
}

export interface MostUsedState {
    enabled: boolean;
    /** Las que califican, de más a menos usada (hasta `MOST_USED_RANKED`). */
    items: MostUsedRef[];
}

export const mostUsedVisitSchema = z.object({
    kind: z.enum(MOST_USED_KINDS),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** Momento de la visita (ms). */
    at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** El día del dispositivo (`YYYY-MM-DD`): es el que la persona entiende por «día». */
    day: z.string().regex(DAY_RE),
});
export type MostUsedVisit = z.infer<typeof mostUsedVisitSchema>;

export const recordMostUsedVisitsSchema = z.object({
    visits: z.array(mostUsedVisitSchema).min(1).max(50),
});
export type RecordMostUsedVisitsInput = z.infer<typeof recordMostUsedVisitsSchema>;

export const updateMostUsedSchema = z
    .object({
        enabled: z.boolean().optional(),
        /** «Empezar de cero»: borra lo contado. */
        reset: z.literal(true).optional(),
    })
    .refine((v) => v.enabled !== undefined || v.reset === true, { message: 'Nada que cambiar' });
export type UpdateMostUsedInput = z.infer<typeof updateMostUsedSchema>;

export function mostUsedKey(ref: MostUsedRef): string {
    return `${ref.kind === 'list' ? 'l' : 'd'}:${ref.id}`;
}

export function parseMostUsedKey(key: string): MostUsedRef | null {
    const m = /^(l|d):([1-9]\d{0,15})$/.exec(key);
    if (!m) return null;
    const id = Number(m[2]);
    if (!Number.isSafeInteger(id)) return null;
    return { kind: m[1] === 'l' ? 'list' : 'dashboard', id };
}

/** Lectura tolerante de lo guardado: lo raro se descarta, nunca falla. */
export function readMostUsed(raw: unknown): MostUsedStore {
    const obj = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const enabled = obj.enabled !== false;
    const items: Record<string, MostUsedEntry> = {};
    const rawItems = obj.items;
    if (rawItems !== null && typeof rawItems === 'object' && !Array.isArray(rawItems)) {
        for (const [key, v] of Object.entries(rawItems as Record<string, unknown>)) {
            if (parseMostUsedKey(key) === null || v === null || typeof v !== 'object') continue;
            const e = v as Record<string, unknown>;
            const s = typeof e.s === 'number' && Number.isFinite(e.s) && e.s > 0 ? e.s : null;
            const t = typeof e.t === 'number' && Number.isFinite(e.t) && e.t > 0 ? e.t : null;
            const d = typeof e.d === 'number' && Number.isInteger(e.d) && e.d > 0 ? e.d : null;
            const ld = typeof e.ld === 'string' && DAY_RE.test(e.ld) ? e.ld : null;
            if (s === null || t === null || d === null || ld === null) continue;
            items[key] = { s, t, d, ld };
        }
    }
    return { enabled, items };
}

function decay(ms: number): number {
    return Math.pow(0.5, Math.max(0, ms) / MOST_USED_HALF_LIFE_MS);
}

/** El puntaje de una entrada ahora. */
export function mostUsedScore(entry: MostUsedEntry, now: number): number {
    return entry.s * decay(now - entry.t);
}

/**
 * Suma visitas a lo guardado. Ordena por momento, descarta lo que viene del
 * futuro (reloj adelantado) o de hace más de 7 días, aplica los 30 minutos
 * por lista/tablero y poda lo que ya no pesa (tope `MOST_USED_MAX_ENTRIES`).
 * No toca `enabled`.
 */
export function applyMostUsedVisits(store: MostUsedStore, visits: readonly MostUsedVisit[], now: number): MostUsedStore {
    const items: Record<string, MostUsedEntry> = { ...store.items };
    const sorted = [...visits]
        .filter((v) => v.at <= now + 60_000 && v.at >= now - MOST_USED_MAX_LAG_MS)
        .sort((a, b) => a.at - b.at);
    for (const v of sorted) {
        const key = mostUsedKey(v);
        const at = Math.min(v.at, now);
        const prev = items[key];
        if (!prev) {
            items[key] = { s: 1, t: at, d: 1, ld: v.day };
            continue;
        }
        if (Math.abs(at - prev.t) < MOST_USED_DEDUPE_MS) continue;
        const newDay = v.day !== prev.ld;
        if (at > prev.t) {
            items[key] = {
                s: prev.s * decay(at - prev.t) + 1,
                t: at,
                d: prev.d + (newDay ? 1 : 0),
                ld: v.day,
            };
        } else {
            // Una visita vieja que llega tarde: suma su peso de entonces sin
            // mover la última visita ni el último día.
            items[key] = { ...prev, s: prev.s + decay(prev.t - at), d: prev.d + (newDay ? 1 : 0) };
        }
    }
    return { enabled: store.enabled, items: prune(items, now) };
}

function prune(items: Record<string, MostUsedEntry>, now: number): Record<string, MostUsedEntry> {
    const kept = Object.entries(items)
        .map(([k, e]) => [k, e, mostUsedScore(e, now)] as const)
        .filter(([, , score]) => score >= MOST_USED_FORGET_SCORE)
        .sort((a, b) => b[2] - a[2])
        .slice(0, MOST_USED_MAX_ENTRIES);
    return Object.fromEntries(kept.map(([k, e]) => [k, e]));
}

/** Las que califican, de más a menos usada (empate: la última visitada primero). */
export function rankMostUsed(store: MostUsedStore, now: number, limit = MOST_USED_RANKED): MostUsedRef[] {
    return Object.entries(store.items)
        .map(([key, e]) => ({ ref: parseMostUsedKey(key), e, score: mostUsedScore(e, now) }))
        .filter((x): x is { ref: MostUsedRef; e: MostUsedEntry; score: number } =>
            x.ref !== null && x.e.d >= MOST_USED_MIN_DAYS && x.score >= MOST_USED_MIN_SCORE,
        )
        .sort((a, b) => b.score - a.score || b.e.t - a.e.t)
        .slice(0, limit)
        .map((x) => x.ref);
}

export function mostUsedState(store: MostUsedStore, now: number): MostUsedState {
    return { enabled: store.enabled, items: store.enabled ? rankMostUsed(store, now) : [] };
}

/**
 * El orden que se MUESTRA, estable mientras se trabaja: lo que ya se veía
 * conserva su lugar (si sigue existiendo), y lo nuevo que califica entra al
 * final si hay lugar. `shown` vacío = el orden de `fresh` tal cual. Trabaja
 * con claves para poder comparar sin importar de dónde vienen.
 */
export function stableMostUsed(shown: readonly string[], fresh: readonly string[], max = MOST_USED_SHOWN): string[] {
    const freshSet = new Set(fresh);
    const out = shown.filter((k) => freshSet.has(k)).slice(0, max);
    for (const k of fresh) {
        if (out.length >= max) break;
        if (!out.includes(k)) out.push(k);
    }
    return out;
}
