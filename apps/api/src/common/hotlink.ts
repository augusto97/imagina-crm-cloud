/**
 * v0.1.427 — Que la app no se use como un servidor de imágenes para otros
 * sitios ("hotlinking").
 *
 * Una imagen que se ve DENTRO de la app o de una página pública suya (la
 * tienda, un formulario, la agenda, una lista pública, el portal) la pide
 * siempre una página de la misma dirección: aunque esa página esté insertada
 * en el sitio de otra empresa, el marco es nuestro y el pedido sale de él.
 * Que la pida una página de OTRO sitio para mostrarla adentro (`<img>`,
 * `fetch`, un marco) es usar la app como CDN: se corta.
 *
 * Se decide con Fetch Metadata (`Sec-Fetch-Site` / `Sec-Fetch-Dest`), que pone
 * el navegador y una página no puede cambiar. Abrir el enlace (una navegación,
 * `Sec-Fetch-Dest: document`) no cuenta: es alguien que hizo clic. Un pedido
 * sin esas cabeceras no es un navegador moderno (lectores de vista previa,
 * proxies de imágenes de los correos) y pasa; si es un navegador viejo, decide
 * el `Referer`, que tiene que ser de la misma dirección.
 */

export interface FetchContext {
    /** `same-origin` | `same-site` | `cross-site` | `none` (lo pone el navegador). */
    secFetchSite?: string;
    /** `image` | `document` | `empty` | `iframe` … */
    secFetchDest?: string;
    referer?: string;
    /** La dirección a la que llegó el pedido (`req.host`). */
    host: string;
}

function header(raw: string | string[] | undefined): string | undefined {
    const v = Array.isArray(raw) ? raw[0] : raw;
    return typeof v === 'string' && v !== '' ? v.toLowerCase() : undefined;
}

export function fetchContextOf(req: { headers: Record<string, string | string[] | undefined>; host?: string; hostname?: string }): FetchContext {
    const referer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
    return {
        secFetchSite: header(req.headers['sec-fetch-site']),
        secFetchDest: header(req.headers['sec-fetch-dest']),
        referer: typeof referer === 'string' ? referer : undefined,
        host: String(req.host ?? req.hostname ?? '').toLowerCase(),
    };
}

/** ¿El `Referer` es una página web de OTRA dirección? (un correo no manda uno web). */
export function refererIsForeign(ctx: FetchContext): boolean {
    if (!ctx.referer) return false;
    let url: URL;
    try {
        url = new URL(ctx.referer);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return ctx.host !== '' && url.host.toLowerCase() !== ctx.host;
}

/**
 * ¿Una página de otro sitio está pidiendo este archivo para mostrarlo adentro
 * de ella? `false` para una navegación (abrir el enlace) y para lo que viene
 * de la misma dirección.
 */
export function isCrossSiteEmbed(ctx: FetchContext): boolean {
    if (ctx.secFetchSite !== undefined) {
        if (ctx.secFetchSite !== 'cross-site') return false;
        return ctx.secFetchDest !== 'document';
    }
    // Navegador sin Fetch Metadata (Safari < 16.4…): sólo el Referer.
    return refererIsForeign(ctx);
}

/** ¿Lo pide un navegador para dibujarlo en una página? (no un proxy ni un lector). */
export function isBrowserImageLoad(ctx: FetchContext): boolean {
    return ctx.secFetchDest === 'image' || ctx.secFetchDest === 'empty';
}
