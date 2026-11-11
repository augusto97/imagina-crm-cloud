/**
 * SEC-35 (v0.1.239) — Freno a los pedidos que cambian algo y vienen de OTRO
 * sitio (CSRF). La cookie de sesión es `SameSite=Lax`, y eso ya impide que un
 * sitio ajeno use la sesión de alguien en un POST. Lo que NO impedía es lo
 * contrario: un formulario oculto en otro sitio que hace POST a `/auth/login`
 * (o `/auth/register`, o al canje del portal) con las credenciales del
 * ATACANTE — la respuesta igual deja su cookie en el navegador de la víctima,
 * que sigue trabajando "en su cuenta" sin notarlo y carga datos que el
 * atacante después lee (login CSRF).
 *
 * Se decide con Fetch Metadata (`Sec-Fetch-Site`, lo mandan todos los
 * navegadores actuales): `same-origin` / `none` pasan, `cross-site` no, y con
 * `same-site` (un subdominio hermano) o sin la cabecera decide el `Origin`,
 * que tiene que ser el del propio pedido. Lo que no
 * trae ninguno de los dos no es un navegador (webhooks de pagos, curl, otros
 * servidores) y pasa. Las superficies públicas que se llaman desde OTROS
 * sitios a propósito quedan afuera: webhooks entrantes (un formulario en la
 * web del cliente), listas públicas embebidas, OAuth/MCP.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CROSS_SITE_ALLOWED_PREFIXES = [
    '/api/v1/public/',
    '/api/v1/oauth/',
    '/api/v1/mcp',
    '/api/v1/billing/webhook',
    '/.well-known/',
];

/**
 * Dentro de `/api/v1/oauth/` hay dos pantallas que usan la SESIÓN de la
 * persona (aprobar o rechazar el acceso de un cliente): ésas no son para
 * terceros y no quedan exentas. Sólo lo son register / token / revoke.
 */
const OAUTH_SESSION_PATH = /^\/api\/v1\/oauth\/authorize\//;

/** Consolas del operador: sus cambios viajan siempre como JSON (o un archivo). */
const OPERATOR_PREFIXES = ['/api/v1/platform/', '/api/v1/system/'];
/** Tipos de cuerpo que un `<form>` de otro sitio puede mandar sin permiso (sin preflight). */
const FORM_BODY_TYPES = ['application/x-www-form-urlencoded', 'text/plain'];

export interface CrossSiteInput {
    method: string;
    path: string;
    host: string;
    /** `http` | `https` del pedido, ya resuelto con el proxy de confianza. */
    protocol?: string;
    secFetchSite?: string;
    origin?: string;
    /** Orígenes cross-origin legítimos de un despliegue (WS_ALLOWED_ORIGINS). */
    allowedOrigins?: readonly string[];
    /** Origen de `APP_BASE_URL` (por si el proxy no pasa el Host original). */
    appOrigin?: string;
}

function exempt(path: string): boolean {
    if (OAUTH_SESSION_PATH.test(path)) return false;
    return CROSS_SITE_ALLOWED_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * ¿El `Origin` es el del propio pedido? Mismo host (el dominio de la
 * plataforma, el subdominio o el dominio propio de una empresa valen sólo
 * cuando SON el host pedido) y sin bajar de https a http; o el origen de
 * `APP_BASE_URL` / uno declarado por el despliegue.
 */
export function isOwnOrigin(input: Pick<CrossSiteInput, 'host' | 'protocol' | 'origin' | 'allowedOrigins' | 'appOrigin'>): boolean {
    const origin = input.origin?.trim();
    if (!origin || origin === 'null') return false;
    if (input.allowedOrigins?.includes(origin)) return true;
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (input.appOrigin && url.origin === input.appOrigin) return true;
    if (url.host.toLowerCase() !== input.host.toLowerCase()) return false;
    return !(input.protocol === 'https' && url.protocol === 'http:');
}

export function isBlockedCrossSite(input: CrossSiteInput): boolean {
    if (!MUTATING.has(input.method.toUpperCase())) return false;
    if (exempt(input.path)) return false;
    const origin = input.origin?.trim();
    if (origin && input.allowedOrigins?.includes(origin)) return false;
    const site = input.secFetchSite?.trim().toLowerCase();
    // El navegador dice que viene de la propia página (o que lo escribió la persona).
    if (site === 'same-origin' || site === 'none') return false;
    if (site === 'cross-site') return true;
    // `same-site` NO alcanza: es cualquier subdominio del mismo dominio (otra
    // app del operador, el sitio de marketing), y la cookie `SameSite=Lax`
    // viaja igual. Ahí —y cuando el navegador no manda Fetch Metadata— decide
    // el `Origin`, que tiene que ser el del propio pedido.
    if (!origin) return site !== undefined && site !== '';
    return !isOwnOrigin(input);
}

/**
 * Defensa en profundidad para las consolas del operador (`/platform/*`,
 * `/system/*`): un cambio con cuerpo de formulario (`urlencoded`,
 * `text/plain`) no viene de la app —que manda JSON— sino de un `<form>`.
 * (`multipart` no se frena aquí: lo usan las subidas de archivos, y las demás
 * rutas no lo leen como cuerpo.)
 */
export function isFormBodyOnOperatorRoute(input: { method: string; path: string; contentType?: string }): boolean {
    if (!MUTATING.has(input.method.toUpperCase())) return false;
    if (!OPERATOR_PREFIXES.some((p) => input.path.startsWith(p))) return false;
    const type = (input.contentType ?? '').split(';')[0]!.trim().toLowerCase();
    return FORM_BODY_TYPES.includes(type);
}

/**
 * Handshake del WebSocket (Socket.io): el navegador manda `Origin` siempre.
 * Tiene que ser el del propio pedido o uno declarado; sin `Origin` no es un
 * navegador (pasa: la sesión igual se exige al conectar).
 */
export function isAllowedSocketOrigin(input: Pick<CrossSiteInput, 'host' | 'protocol' | 'origin' | 'allowedOrigins' | 'appOrigin'>): boolean {
    const origin = input.origin?.trim();
    if (!origin) return true;
    return isOwnOrigin(input);
}

/** Origen (`https://host[:puerto]`) de una URL de configuración; undefined si no es http(s). */
export function ownOriginOf(url: string | undefined): string | undefined {
    try {
        const u = new URL(String(url ?? ''));
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : undefined;
    } catch {
        return undefined;
    }
}
