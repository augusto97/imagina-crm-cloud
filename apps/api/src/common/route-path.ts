/**
 * La ruta sobre la que se toman las decisiones de seguridad de un pedido.
 *
 * El router (find-my-way) decodifica los `%XX` de caracteres no reservados y
 * descarta un `#fragmento` ANTES de buscar la ruta: `POST /api/v1/auth/logi%6e`
 * y `/api/v1/auth/login#x` llegan al mismo controlador que `/api/v1/auth/login`.
 * Una política que mira `req.url` crudo (el límite estricto del login, «esta
 * sesión es del portal») no veía esas variantes y aplicaba la regla más floja.
 *
 * Por eso se decide sobre el PATRÓN de la ruta que el router eligió
 * (`/api/v1/portal/me`, `/api/v1/lists/:list/records`): es el mismo para todas
 * las formas de escribir la dirección. Los hooks `onRequest` corren después
 * del ruteo, así que ya está disponible. Si no hubo ruta (404) se usa el path
 * sin query ni fragmento, decodificado una vez; uno mal codificado queda tal
 * cual (no coincide con ninguna regla que afloje nada).
 */
export interface RoutePathSource {
    url?: string;
    routeOptions?: { url?: string } | undefined;
}

export function normalizeUrlPath(url: string): string {
    const cut = url.search(/[?#]/);
    const raw = cut === -1 ? url : url.slice(0, cut);
    if (!raw.includes('%')) return raw;
    // Una barra codificada no es un separador para el router: se deja como está.
    if (/%2f|%5c/i.test(raw)) return raw;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

export function routePath(req: RoutePathSource): string {
    const matched = req.routeOptions?.url;
    if (typeof matched === 'string' && matched !== '') return matched;
    return normalizeUrlPath(req.url ?? '');
}
