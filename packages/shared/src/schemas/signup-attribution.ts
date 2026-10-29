import { z } from 'zod';

/**
 * v0.1.331 — De dónde vino cada alta (el sitio del producto, una campaña, un
 * artículo del blog). El navegador lo toma de la dirección con la que se
 * entró (`utm_*`, `ref`) y de la página anterior, lo recuerda mientras la
 * persona decide, y lo manda junto con el registro. Se guarda en
 * `tenants.settings.signup` y el operador lo ve en Plataforma → Empresas.
 *
 * No hay nada sensible acá (ni IP ni navegador): son las mismas etiquetas que
 * ya viajan en la dirección. Todo se recorta y se valida igual: un valor raro
 * se descarta en vez de hacer fallar el registro.
 */

/** El paquete compartido no carga los tipos del navegador: sólo lo que se usa. */
interface ParsedUrl {
    protocol: string;
    origin: string;
    hostname: string;
    pathname: string;
}
declare const URL: { new (input: string): ParsedUrl };

const short = z
    .string()
    .trim()
    .max(200)
    // Sin caracteres de control (no tienen nada que hacer en una etiqueta).
    .transform((s) => [...s].filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127).join(''))
    .pipe(z.string().min(1));

/** Una URL http(s) sin la parte de los parámetros (pueden traer tokens). */
const pageUrl = z
    .string()
    .trim()
    .max(1000)
    .transform((raw, ctx) => {
        try {
            const u = new URL(raw);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocolo');
            return `${u.origin}${u.pathname}`.slice(0, 500);
        } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL inválida' });
            return z.NEVER;
        }
    });

export const SIGNUP_ATTRIBUTION_KEYS = [
    'source',
    'medium',
    'campaign',
    'term',
    'content',
    'ref',
    'landing_url',
    'referrer',
] as const;

export const signupAttributionSchema = z.object({
    /** `utm_source` (google, instagram, newsletter…). */
    source: short.optional(),
    /** `utm_medium` (cpc, social, email…). */
    medium: short.optional(),
    /** `utm_campaign`. */
    campaign: short.optional(),
    /** `utm_term`. */
    term: short.optional(),
    /** `utm_content` (qué botón o anuncio). */
    content: short.optional(),
    /** `ref` (un código propio: un aliado, un evento). */
    ref: short.optional(),
    /** La página de la app por la que se entró. */
    landing_url: pageUrl.optional(),
    /** La página anterior, si vino de otro sitio (el sitio del producto, Google). */
    referrer: pageUrl.optional(),
});
export type SignupAttribution = z.infer<typeof signupAttributionSchema>;

/** Lo que se guarda en la empresa: lo anterior + cuándo se registró. */
export const storedSignupAttributionSchema = signupAttributionSchema.extend({
    at: z.string(),
});
export type StoredSignupAttribution = z.infer<typeof storedSignupAttributionSchema>;

/**
 * Lectura tolerante, campo por campo: lo que no valide se descarta (nunca
 * hace fallar el registro). Devuelve null si no queda nada.
 */
export function parseSignupAttribution(raw: unknown): SignupAttribution | null {
    if (raw === null || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of SIGNUP_ATTRIBUTION_KEYS) {
        const field = signupAttributionSchema.shape[key].safeParse(obj[key]);
        if (field.success && field.data !== undefined) out[key] = field.data;
    }
    return Object.keys(out).length > 0 ? (out as SignupAttribution) : null;
}

/** Igual que la anterior, para lo guardado (conserva la fecha si es válida). */
export function parseStoredSignupAttribution(raw: unknown): StoredSignupAttribution | null {
    const base = parseSignupAttribution(raw);
    if (!base) return null;
    const at = (raw as { at?: unknown }).at;
    return { ...base, at: typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : '' };
}

/** El host de una URL guardada, sin `www.` (para mostrar «desde imagina.cloud»). */
function hostOf(url: string | undefined): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

/**
 * El nombre con que se agrupan las altas: la fuente de la campaña, o el sitio
 * de donde vino, o «Directo». Mismo criterio en la consola y en el conteo.
 */
export function signupSourceKey(a: SignupAttribution | null | undefined): string {
    if (!a) return 'Directo';
    if (a.source) return a.source.toLowerCase();
    if (a.ref) return `ref: ${a.ref}`;
    return hostOf(a.referrer) ?? 'Directo';
}

/** Una línea legible: «google / cpc · lanzamiento · desde imagina.cloud/base». */
export function signupAttributionLabel(a: SignupAttribution | null | undefined): string {
    if (!a) return 'Directo (sin origen)';
    const parts: string[] = [];
    if (a.source || a.medium) parts.push([a.source, a.medium].filter(Boolean).join(' / '));
    if (a.campaign) parts.push(a.campaign);
    if (a.content) parts.push(a.content);
    if (a.ref) parts.push(`ref: ${a.ref}`);
    if (a.referrer) {
        try {
            const u = new URL(a.referrer);
            const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
            parts.push(`desde ${u.hostname.replace(/^www\./, '')}${path}`);
        } catch {
            /* ya validada al guardar */
        }
    }
    return parts.length > 0 ? parts.join(' · ') : 'Directo (sin origen)';
}
