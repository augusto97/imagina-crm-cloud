import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Wrapper de `React.lazy` con dos correcciones críticas:
 *
 * 1. **Cache de la promise (fix del bug "Cargando vista..." infinito
 *    al cambiar entre vistas lazy)**.
 *
 *    React.lazy llama a su factory MÚLTIPLES VECES durante un
 *    concurrent render (cuando se cambia de un componente lazy a
 *    otro). La implementación anterior hacía `factory().catch(...)`
 *    en cada llamada, creando una NUEVA promise cada vez. Si una
 *    promise quedaba huérfana porque React abandonó ese render por
 *    otro nuevo, el Suspense quedaba colgado esperando una promise
 *    que nadie iba a resolver.
 *
 *    Síntoma observado: cambias de Kanban a Cards → "Cargando
 *    vista..." infinito. Cambias a Calendar → vuelves a Cards →
 *    carga. Pasaba porque el segundo intento usaba el chunk ya
 *    cacheado del module system, así que el nuevo `factory()`
 *    resolvía inmediatamente.
 *
 *    Fix: cacheamos la promise resultante en una closure. La
 *    factory devuelve siempre la misma promise hasta que falle.
 *
 * 2. **Reload automático cuando el chunk no existe (deploy stale)**.
 *
 *    El navegador tenía cargado el bundle viejo (build N). El admin
 *    actualiza el plugin a build N+1 — los chunks viejos ya no
 *    existen en el server porque Vite usa content-hashing. Al
 *    navegar a una ruta lazy-loaded, el dynamic import falla con
 *    `Failed to fetch dynamically imported module: <chunk>-<hash>.js`.
 *
 *    Solución: si el import falla con un error que matchea ese
 *    patrón, recargamos la página automáticamente. Solo UNA vez
 *    por session (guardado en sessionStorage) para evitar loop
 *    infinito si el problema es otro.
 *
 * 3. **Retry transiente para network glitches**.
 *
 *    Si el chunk falla por error de red transitorio (no chunk
 *    stale, no hash mismatch), reintentamos 2 veces con backoff
 *    antes de tirar la toalla. Cubre el caso donde el wifi se
 *    cae por un segundo justo cuando el user clicka una vista.
 */

const RELOADED_KEY = 'imcrm:reloaded-after-chunk-fail';
const RETRY_DELAYS_MS = [500, 1500];

function isChunkLoadError(err: unknown): boolean {
    if (! err) return false;
    const msg = err instanceof Error ? err.message : String(err);
    return (
        msg.includes('Failed to fetch dynamically imported module')
        || msg.includes('Loading chunk')
        || msg.includes('Importing a module script failed')
        || /chunk\s+\S+\s+failed/i.test(msg)
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Lazy component con un método extra `preload()` para gatillar la
 * descarga antes de que React monte el componente. Útil para
 * prefetch en `useEffect` (e.g. paralelizar descarga del chunk con
 * el fetch de records). Usa el mismo cache interno que `React.lazy`
 * — un solo `import()` se ejecuta sin importar cuántas veces se
 * llame entre `preload` y el mount.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PreloadableLazy<T extends ComponentType<any>> =
    LazyExoticComponent<T> & { preload: () => Promise<{ default: T }> };

/**
 * Reemplazo drop-in de `React.lazy`. Cachea la promise + retry +
 * reload-on-stale + expone `.preload()`.
 *
 * Uso:
 *   const Page = lazyWithReload(() => import('./Page').then(m => ({ default: m.Page })));
 *   // ...después, opcional para prefetch:
 *   void Page.preload();
 */
// `ComponentType<any>` aquí es a propósito — es la misma firma que
// `React.lazy` para que el drop-in replacement sea transparente con
// componentes que tienen props específicos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
): PreloadableLazy<T> {
    // Cache de la promise resuelta o pending. Una vez que la
    // factory tiene éxito, cualquier llamada futura devuelve la
    // misma promise resuelta sin re-ejecutar el import.
    let cached: Promise<{ default: T }> | null = null;

    const loadWithRetries = async (): Promise<{ default: T }> => {
        let lastErr: unknown = null;
        // Intento inicial + N retries.
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
            try {
                return await factory();
            } catch (err) {
                lastErr = err;
                // Si es chunk stale (hash no existe), no tiene sentido
                // reintentar — sale del loop y maneja con reload.
                if (isChunkLoadError(err)) {
                    break;
                }
                // Network glitch transient: esperar y reintentar.
                const delay = RETRY_DELAYS_MS[attempt];
                if (delay === undefined) break;
                await sleep(delay);
            }
        }

        // Llegamos acá solo si fallaron todos los intentos.
        if (isChunkLoadError(lastErr)) {
            try {
                const already = window.sessionStorage.getItem(RELOADED_KEY);
                if (already !== '1') {
                    window.sessionStorage.setItem(RELOADED_KEY, '1');
                    window.location.reload();
                    // Promise que nunca resuelve — el reload ya va
                    // en camino, no queremos que React muestre el
                    // error boundary mientras tanto.
                    return new Promise(() => undefined);
                }
            } catch {
                window.location.reload();
                return new Promise(() => undefined);
            }
        }

        // Limpiamos el cache para permitir un retry manual en el
        // próximo intento de render.
        cached = null;
        throw lastErr;
    };

    const preload = (): Promise<{ default: T }> => {
        if (cached === null) {
            cached = loadWithRetries();
        }
        return cached;
    };

    const Component = lazy(preload) as PreloadableLazy<T>;
    Component.preload = preload;
    return Component;
}
