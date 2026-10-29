import { parseSignupAttribution, type SignupAttribution } from '@imagina-base/shared';

/**
 * v0.1.331 — De dónde vino quien se registra. El sitio del producto enlaza a
 * la app con etiquetas (`?utm_source=…&utm_campaign=…`, `?ref=…`); la app las
 * toma AL ENTRAR —antes de que la persona navegue y se pierdan—, las recuerda
 * en este dispositivo y las manda con el registro. Una visita directa no pisa
 * lo que trajo una visita con origen (la persona suele volver a escribir la
 * dirección antes de decidirse); una visita con origen nuevo, sí.
 */

const KEY = 'imcrm:signup-attribution';
/** Pasado esto, el origen recordado ya no cuenta para un alta. */
export const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PARAMS: ReadonlyArray<[param: string, key: keyof SignupAttribution]> = [
    ['utm_source', 'source'],
    ['utm_medium', 'medium'],
    ['utm_campaign', 'campaign'],
    ['utm_term', 'term'],
    ['utm_content', 'content'],
    ['ref', 'ref'],
];

interface Stored {
    data: SignupAttribution;
    at: number;
}

function safeStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

/** Lo que trae ESTA visita (null si es directa, sin etiquetas ni sitio de origen). */
export function attributionFromVisit(href: string, referrer: string): SignupAttribution | null {
    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    const raw: Record<string, string> = {};
    for (const [param, key] of PARAMS) {
        const value = url.searchParams.get(param);
        if (value) raw[key] = value;
    }
    let external: string | null = null;
    if (referrer) {
        try {
            const from = new URL(referrer);
            if (from.host !== url.host) external = referrer;
        } catch {
            /* referrer raro: se ignora */
        }
    }
    if (Object.keys(raw).length === 0 && external === null) return null;
    if (external) raw.referrer = external;
    raw.landing_url = url.href;
    return parseSignupAttribution(raw);
}

/** La dirección sin las etiquetas de campaña (la barra queda limpia). */
export function stripAttributionParams(href: string): string | null {
    try {
        const url = new URL(href);
        let changed = false;
        for (const [param] of PARAMS) {
            if (url.searchParams.has(param)) {
                url.searchParams.delete(param);
                changed = true;
            }
        }
        return changed ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
        return null;
    }
}

/** Se llama una vez al arrancar la app. */
export function captureSignupAttribution(): void {
    const visit = attributionFromVisit(window.location.href, document.referrer);
    if (visit) {
        try {
            safeStorage()?.setItem(KEY, JSON.stringify({ data: visit, at: Date.now() } satisfies Stored));
        } catch {
            /* sin almacenamiento: el alta sale sin origen */
        }
    }
    const clean = stripAttributionParams(window.location.href);
    if (clean !== null) window.history.replaceState(window.history.state, '', clean);
}

/** El origen recordado, si todavía vale. */
export function readSignupAttribution(now = Date.now()): SignupAttribution | null {
    try {
        const raw = safeStorage()?.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<Stored>;
        if (typeof parsed.at !== 'number' || now - parsed.at > ATTRIBUTION_TTL_MS) return null;
        return parseSignupAttribution(parsed.data);
    } catch {
        return null;
    }
}

/** Tras un alta: el origen ya quedó guardado en la empresa. */
export function clearSignupAttribution(): void {
    try {
        safeStorage()?.removeItem(KEY);
    } catch {
        /* nada */
    }
}

/** La landing enlaza a `/registro` (o `?registro`) para abrir directo el alta. */
export function isRegisterEntry(loc: Pick<Location, 'pathname' | 'search'> = window.location): boolean {
    const path = loc.pathname.replace(/\/+$/, '');
    if (path === '/registro' || path === '/register') return true;
    return new URLSearchParams(loc.search).has('registro');
}
