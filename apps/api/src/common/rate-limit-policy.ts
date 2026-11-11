import { routePath, type RoutePathSource } from './route-path';

/**
 * Rate limiting por IP (SEC-05): bucket general + uno estricto para las rutas
 * sensibles (login/registro/reset/portal) para frenar fuerza bruta, credential
 * stuffing y el DoS de CPU del verify argon2.
 *
 * SEC-28 (v0.1.225): las decisiones se toman sobre el PATH, nunca sobre
 * `req.url` entero (`POST /auth/register?/health` salteaba el límite). Y sobre
 * la RUTA que resolvió el router (`routePath`), no sobre el texto de la
 * dirección: `/auth/logi%6e` y `/auth/login#x` llegan al mismo controlador que
 * `/auth/login` y antes se quedaban con el límite general (40 veces más alto).
 */
const SENSITIVE_ROUTES = new Set(
    [
        '/auth/login',
        '/auth/login/2fa',
        '/auth/register',
        '/auth/forgot-password',
        '/auth/reset-password',
        '/portal/consume',
        // v0.1.289 — entrar al portal con contraseña y pedir un enlace.
        '/portal/login',
        '/portal/request-access',
    ].map((p) => `/api/v1${p}`),
);

/**
 * Avisos que llegan todos de la misma IP y en ráfagas (van firmados o con token):
 * v0.1.207 tienda (WooCommerce APAGA el aviso tras varias entregas fallidas),
 * v0.1.251 pagos de Mercado Pago / Wompi, D3 WhatsApp, SMS (ADR-S82) y el
 * complemento de WordPress (ADR-S84).
 */
const BURST_PREFIXES = [
    '/api/v1/public/store-hooks/',
    '/api/v1/public/collections/',
    '/api/v1/public/whatsapp/',
    '/api/v1/public/sms/',
    '/api/v1/public/site-hooks/',
];

const HEALTH_ROUTES = new Set(['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready']);

export function isSensitiveRoute(req: RoutePathSource): boolean {
    return SENSITIVE_ROUTES.has(routePath(req));
}

export function rateLimitMaxFor(
    req: RoutePathSource,
    env: { RATE_LIMIT_AUTH_MAX: number; RATE_LIMIT_MAX: number },
): number {
    const path = routePath(req);
    if (SENSITIVE_ROUTES.has(path)) return env.RATE_LIMIT_AUTH_MAX;
    return BURST_PREFIXES.some((p) => path.startsWith(p)) ? env.RATE_LIMIT_MAX * 10 : env.RATE_LIMIT_MAX;
}

export function isHealthProbe(req: RoutePathSource): boolean {
    return HEALTH_ROUTES.has(routePath(req));
}
