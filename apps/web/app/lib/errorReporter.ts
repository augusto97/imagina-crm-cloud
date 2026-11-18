/**
 * v0.1.435 — Los errores de la PANTALLA (lo que falla en el navegador) llegan
 * a Plataforma → Diagnóstico. Antes quedaban en la consola de quien los veía y
 * el operador sólo se enteraba si alguien se quejaba.
 *
 * Qué se manda: el tipo, el mensaje, la pantalla (sin consulta ni ancla: puede
 * traer un token) y el stack. Nada de la persona: ni quién es ni qué escribió.
 * El servidor agrupa, recorta y frena.
 *
 * Qué NO se manda (no dice nada de la app o ya lo registra el servidor):
 * errores del API (`status`), la red caída, un pedido cancelado, un despliegue
 * nuevo con la pestaña abierta (se recarga sola), extensiones del navegador y
 * el «ResizeObserver loop» de los navegadores.
 */
export type ClientErrorKind = 'error' | 'rejection' | 'render';
export type ClientErrorSurface = 'app' | 'portal';

export interface ClientErrorPayload {
    kind: ClientErrorKind;
    surface: ClientErrorSurface;
    message: string;
    route: string;
    stack?: string;
    component?: string;
}

const NOISE: RegExp[] = [
    /^script error\.?$/i,
    /resizeobserver loop/i,
    /failed to fetch dynamically imported module/i,
    /importing a module script failed/i,
    /error loading dynamically imported module/i,
    /^(load failed|failed to fetch|networkerror when attempting to fetch resource\.?)$/i,
    /the (user|operation) aborted/i,
    /^cancelled?$/i,
];

const EXTENSION_SRC = /(chrome|moz|safari-web)-extension:\/\//;
const MAX_PER_PAGE = 10;

let surface: ClientErrorSurface = 'app';
let installed = false;
const seen = new Set<string>();
let sent = 0;

/** Lo que vale la pena mandar (puro: se prueba sin navegador). */
export function shouldReport(error: unknown, message: string): boolean {
    if (error && typeof error === 'object') {
        const e = error as { status?: unknown; name?: unknown; stack?: unknown };
        // Un error del API (CloudApiError / ApiError): el servidor ya lo registra.
        if (typeof e.status === 'number') return false;
        if (e.name === 'AbortError' || e.name === 'CanceledError') return false;
        if (typeof e.stack === 'string' && EXTENSION_SRC.test(e.stack) && !/\/assets\//.test(e.stack)) return false;
    }
    const m = message.trim();
    if (!m) return false;
    return !NOISE.some((r) => r.test(m));
}

/**
 * La pantalla sin consulta. La app navega por el ancla (`#/lists/3/records`):
 * esa es la pantalla de verdad, no la dirección (que queda en `/login` o `/`).
 */
export function currentRoute(loc: Pick<Location, 'pathname'> & Partial<Pick<Location, 'hash'>> = window.location): string {
    const hash = loc.hash ?? '';
    const route = hash.startsWith('#/') ? hash.slice(1).split('?')[0]! : loc.pathname || '/';
    return (route || '/').slice(0, 500);
}

function messageOf(error: unknown): string {
    if (error instanceof Error) return `${error.name && error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error)?.slice(0, 500) ?? String(error);
    } catch {
        return String(error);
    }
}

/** Arma lo que se manda (puro). */
export function buildPayload(kind: ClientErrorKind, error: unknown, route: string, extra: { component?: string } = {}): ClientErrorPayload | null {
    const message = messageOf(error).slice(0, 2000);
    if (!shouldReport(error, message)) return null;
    const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack.slice(0, 8000) : undefined;
    const component = extra.component
        ?.split('\n')
        .map((l) => l.trim())
        .find(Boolean)
        ?.slice(0, 300);
    return { kind, surface, message, route, ...(stack ? { stack } : {}), ...(component ? { component } : {}) };
}

function send(payload: ClientErrorPayload): void {
    const key = `${payload.kind}|${payload.message}|${payload.route}`;
    if (seen.has(key) || sent >= MAX_PER_PAGE) return;
    seen.add(key);
    sent += 1;
    try {
        void fetch('/api/v1/client-errors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            keepalive: true,
            body: JSON.stringify(payload),
        }).catch(() => undefined);
    } catch {
        /* nunca rompe nada */
    }
}

/** Para los límites de React (`ErrorBoundary`) y para quien atrapa un error a mano. */
export function reportClientError(error: unknown, kind: ClientErrorKind = 'error', extra: { component?: string } = {}): void {
    if (typeof window === 'undefined') return;
    const payload = buildPayload(kind, error, currentRoute(), extra);
    if (payload) send(payload);
}

/** Escucha los errores que nadie atrapó. Se llama una vez al arrancar cada SPA. */
export function installErrorReporter(where: ClientErrorSurface): void {
    surface = where;
    if (installed || typeof window === 'undefined') return;
    installed = true;
    window.addEventListener('error', (event: ErrorEvent) => {
        // Un archivo que no cargó (imagen, script) llega como error sin `message`.
        if (!event.message && !event.error) return;
        if (event.filename && !event.filename.startsWith(window.location.origin) && !event.filename.startsWith('/')) return;
        const payload = buildPayload('error', event.error ?? event.message, currentRoute());
        if (payload) send(payload);
    });
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const payload = buildPayload('rejection', event.reason, currentRoute());
        if (payload) send(payload);
    });
}

/** Sólo para las pruebas. */
export function resetErrorReporterForTests(): void {
    seen.clear();
    sent = 0;
}
