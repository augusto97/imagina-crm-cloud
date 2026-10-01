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
 * navegadores actuales) y, si falta, con `Origin` contra el host. Lo que no
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

export interface CrossSiteInput {
    method: string;
    path: string;
    host: string;
    secFetchSite?: string;
    origin?: string;
    /** Orígenes cross-origin legítimos de un despliegue (WS_ALLOWED_ORIGINS). */
    allowedOrigins?: readonly string[];
}

export function isBlockedCrossSite(input: CrossSiteInput): boolean {
    if (!MUTATING.has(input.method.toUpperCase())) return false;
    if (CROSS_SITE_ALLOWED_PREFIXES.some((p) => input.path.startsWith(p))) return false;
    const origin = input.origin?.trim();
    if (origin && input.allowedOrigins?.includes(origin)) return false;
    const site = input.secFetchSite?.trim().toLowerCase();
    if (site) return site === 'cross-site';
    if (!origin) return false;
    if (origin === 'null') return true;
    try {
        return new URL(origin).host.toLowerCase() !== input.host.toLowerCase();
    } catch {
        return true;
    }
}
