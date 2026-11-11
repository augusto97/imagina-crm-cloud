import { z } from 'zod';

/**
 * v0.1.409 (ADR-S102) — La «dirección rápida» de lo que se inserta en los
 * sitios web de las empresas (el script `embed.js`, el widget de contacto y
 * los formularios y agendas insertados), pensada para pasar por Cloudflare.
 *
 * Es una dirección APARTE de la de la app (`w.tudominio.com`): la app del
 * equipo y los dominios propios de las empresas (ADR-S17) siguen por la suya,
 * así Cloudflare sólo ve el tráfico público y un dominio propio que apunta a
 * la app nunca termina en una zona ajena de Cloudflare.
 *
 * `cloudflare`: las visitas llegan por Cloudflare, así que el servidor tiene
 * que creerle la IP que trae la cadena de proxies cuando viene de una
 * dirección de Cloudflare. Sin eso todos los visitantes parecerían la misma IP
 * y los límites por visitante los frenarían juntos.
 */
export const platformNetworkSchema = z.object({
    /** `https://w.tudominio.com` (sin ruta). null = los códigos usan la dirección de la app. */
    embed_origin: z.string().nullable().default(null),
    cloudflare: z.boolean().default(false),
});
export type PlatformNetwork = z.infer<typeof platformNetworkSchema>;

export const updatePlatformNetworkSchema = z.object({
    embed_origin: z.string().trim().max(200).nullable(),
    cloudflare: z.boolean(),
});
export type UpdatePlatformNetworkInput = z.infer<typeof updatePlatformNetworkSchema>;

interface ParsedOrigin {
    protocol: string;
    username: string;
    password: string;
    pathname: string;
    search: string;
    hash: string;
    hostname: string;
    origin: string;
}
// shared no carga los tipos del DOM ni de Node: el `URL` global existe en los dos.
declare const URL: { new (input: string): ParsedOrigin };

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/**
 * Lo que escribió la persona → el origen (`https://w.tudominio.com`), o null
 * si no es una dirección que sirva: sin ruta, sin consulta, sin usuario y con
 * https (http sólo en desarrollo, con `allowHttp`).
 */
export function normalizeEmbedOrigin(raw: string, opts: { allowHttp?: boolean } = {}): string | null {
    const text = raw.trim();
    if (text === '') return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let url: ParsedOrigin;
    try {
        url = new URL(withScheme);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && !(opts.allowHttp === true && url.protocol === 'http:')) return null;
    if (url.username !== '' || url.password !== '') return null;
    if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') return null;
    const host = url.hostname.toLowerCase();
    const localDev = opts.allowHttp === true && (host === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(host));
    if (!localDev && !HOST_RE.test(host)) return null;
    return url.origin;
}

/** Lectura tolerante de lo guardado (`platform:network`): lo que no sirve vuelve al de fábrica. */
export function parsePlatformNetwork(raw: unknown, opts: { allowHttp?: boolean } = {}): PlatformNetwork {
    const parsed = platformNetworkSchema.safeParse(raw ?? {});
    if (!parsed.success) return { embed_origin: null, cloudflare: false };
    const origin = parsed.data.embed_origin !== null ? normalizeEmbedOrigin(parsed.data.embed_origin, opts) : null;
    return { embed_origin: origin, cloudflare: parsed.data.cloudflare };
}

/**
 * La condición de la regla de caché de Cloudflare para esa dirección: todo lo
 * público. Cada respuesta ya dice si se puede guardar (`public, max-age=…`) o
 * no (`no-store`), y los envíos son POST: Cloudflare nunca guarda eso.
 */
export function cloudflareCacheRuleExpression(origin: string): string {
    let host = origin;
    try {
        host = new URL(origin).hostname;
    } catch {
        // se muestra tal cual
    }
    return `(http.host eq "${host}" and starts_with(http.request.uri.path, "/api/v1/public/"))`;
}

/** Lo que muestra Plataforma → Dominios. */
export interface PlatformNetworkView extends PlatformNetwork {
    /** La dirección de la app (de donde salen hoy los códigos si no hay una rápida). */
    app_origin: string;
    /** El servidor ya le cree la IP a Cloudflare (lo guardado o `TRUST_PROXY=…,cloudflare`). */
    cloudflare_trusted: boolean;
}

export type NetworkCheckStepId = 'reach' | 'same_app' | 'via_cloudflare' | 'real_ip' | 'cache_script' | 'cache_page';

export interface NetworkCheckStep {
    id: NetworkCheckStepId;
    /** true = bien; false = falta algo; null = no se pudo saber (o no aplica). */
    ok: boolean | null;
    detail: string;
}

export interface NetworkCheckResult {
    origin: string;
    /** Todo lo necesario está bien (los pasos sin respuesta no cuentan en contra). */
    ok: boolean;
    steps: NetworkCheckStep[];
}

/** La respuesta de `GET /api/v1/public/net-check` (lo que el servidor ve de quien pregunta). */
export interface NetCheckProbe {
    ok: true;
    /** Huella de esta instalación: dice que la dirección llega a ESTA app. */
    app: string;
    /** El pedido pasó por Cloudflare (trae `cf-ray`). */
    via_cloudflare: boolean;
    /** El que se conectó al proxy de esta máquina es una dirección de Cloudflare. */
    peer_is_cloudflare: boolean;
    /** La IP que el servidor le atribuye a quien pregunta es de Cloudflare (no ve la real). */
    ip_is_cloudflare: boolean;
}
