/**
 * v0.1.327 — La pantalla de arranque.
 *
 * El `index.html` trae una pantalla propia (`#imcrm-boot`) que se ve DESDE el
 * primer cuadro, antes de que baje el JavaScript: el logo (o el nombre) de la
 * marca y una barra fina que avanza. El script inline del HTML la arma con lo
 * que la app recordó en la última visita (`SPLASH_KEY`); la primera vez sólo
 * muestra la barra (no hay ningún logo "de fábrica" que inventar).
 *
 * React no la reemplaza: queda ENCIMA hasta que la app tiene algo que mostrar
 * (el login o la app) y recién ahí se desvanece — así no hay pantalla en
 * blanco, ni una ruedita, ni un salto entre dos pantallas de carga distintas.
 */

export const SPLASH_KEY = 'imcrm:splash';
export const SPLASH_ID = 'imcrm-boot';

export interface SplashBrand {
    name: string | null;
    logo: string | null;
    logoDark: string | null;
}

/** Sólo rutas de la propia app (el script del HTML pone la URL en un `<img>`). */
export function sameOriginPath(url: string | null): string | null {
    if (!url) return null;
    return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\') ? url : null;
}

/** Recuerda la marca para la próxima vez que arranque la app en este dispositivo. */
export function rememberSplash(brand: SplashBrand, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
    if (!storage) return;
    const value: SplashBrand = {
        name: brand.name?.trim().slice(0, 60) || null,
        logo: sameOriginPath(brand.logo),
        logoDark: sameOriginPath(brand.logoDark),
    };
    try {
        storage.setItem(SPLASH_KEY, JSON.stringify(value));
    } catch {
        /* storage lleno o bloqueado: la próxima arranca sólo con la barra */
    }
}

function safeStorage(): Storage | null {
    try {
        return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
        return null;
    }
}

/** ¿Sigue la pantalla de arranque a la vista? */
export function bootSplashVisible(doc: Document = document): boolean {
    const el = doc.getElementById(SPLASH_ID);
    return el !== null && el.dataset.leaving !== '1';
}

/** La desvanece y la saca del DOM (idempotente). */
export function hideBootSplash(doc: Document = document): void {
    const el = doc.getElementById(SPLASH_ID);
    if (!el || el.dataset.leaving === '1') return;
    el.dataset.leaving = '1';
    el.setAttribute('aria-busy', 'false');
    const reduce =
        typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    window.setTimeout(() => el.remove(), reduce ? 0 : 260);
}
