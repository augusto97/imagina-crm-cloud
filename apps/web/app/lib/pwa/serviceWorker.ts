/**
 * H1 — Registro del service worker de la app (`/sw.js`, alcance `/`).
 *
 * El SW sólo hace dos cosas: el HTML siempre primero a la red (con «Sin
 * conexión» si no hay) + los assets con hash desde el caché, y recibir los
 * push. Se registra después de que la página cargó (no compite con la carga
 * inicial) y se revisa si hay una versión nueva cada hora y al volver a la
 * pestaña: así un despliegue llega aunque nadie navegue.
 */

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function serviceWorkerSupported(win: Window = window): boolean {
    return win.isSecureContext === true && 'serviceWorker' in win.navigator;
}

export function registerServiceWorker(win: Window = window): Promise<ServiceWorkerRegistration | null> {
    if (registration) return registration;
    if (!serviceWorkerSupported(win)) {
        registration = Promise.resolve(null);
        return registration;
    }
    registration = new Promise((resolve) => {
        const go = (): void => {
            win.navigator.serviceWorker
                .register('/sw.js', { scope: '/', updateViaCache: 'none' })
                .then((reg) => {
                    const check = (): void => void reg.update().catch(() => undefined);
                    win.setInterval(check, 60 * 60 * 1000);
                    win.document.addEventListener('visibilitychange', () => {
                        if (win.document.visibilityState === 'visible') check();
                    });
                    resolve(reg);
                })
                .catch(() => resolve(null));
        };
        if (win.document.readyState === 'complete') go();
        else win.addEventListener('load', go, { once: true });
    });
    return registration;
}

/** La registración lista (`ready` espera a que haya un SW activo). */
export async function readyRegistration(win: Window = window): Promise<ServiceWorkerRegistration | null> {
    if (!serviceWorkerSupported(win)) return null;
    const reg = await registerServiceWorker(win);
    if (!reg) return null;
    // `ready` espera un SW ACTIVO; si nunca llega (bloqueado por el
    // navegador), no se cuelga la pantalla para siempre.
    return Promise.race([
        win.navigator.serviceWorker.ready,
        new Promise<null>((resolve) => win.setTimeout(() => resolve(null), 10_000)),
    ]);
}

export interface OpenMessage {
    type: 'imcrm:open';
    url: string;
    tenant_id: number | null;
}

export function isOpenMessage(data: unknown): data is OpenMessage {
    return (
        typeof data === 'object' &&
        data !== null &&
        (data as { type?: unknown }).type === 'imcrm:open' &&
        typeof (data as { url?: unknown }).url === 'string'
    );
}

/** Sólo rutas de ESTE origen (nada de `//otro` ni esquemas). */
export function safeAppPath(raw: string): string {
    if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
    return raw;
}

/**
 * `?t=<empresa>` con el que el SW abre una ventana nueva desde un aviso: se
 * lee ANTES de montar la app y se quita de la URL.
 */
export function takeTenantParam(loc: Location = window.location, hist: History = window.history): number | null {
    const params = new URLSearchParams(loc.search);
    const raw = params.get('t');
    if (raw === null) return null;
    params.delete('t');
    const search = params.toString();
    hist.replaceState(hist.state, '', `${loc.pathname}${search ? `?${search}` : ''}${loc.hash}`);
    return /^\d+$/.test(raw) ? Number(raw) : null;
}
