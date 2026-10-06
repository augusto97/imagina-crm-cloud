import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';

/**
 * v0.1.253 — ruta activa para los items del panel lateral SIN suscribir cada
 * item al router. Con `NavLink`/`useLocation` en cada item, una navegación
 * re-renderizaba los cientos de items del menú y cada uno resolvía su `href`
 * (en HashRouter eso hace `querySelector('base')` sobre todo el documento):
 * medio segundo después del login en un workspace con 469 listas.
 *
 * Un solo componente (`ActivePathSync`) escucha al router y publica la ruta;
 * cada item se suscribe con un selector booleano, así sólo re-renderizan los
 * dos items que cambian de activo a inactivo.
 */
let current = '';
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function ActivePathSync(): null {
    const { pathname } = useLocation();
    useLayoutEffect(() => {
        if (pathname === current) return;
        current = pathname;
        for (const l of listeners) l();
    }, [pathname]);
    return null;
}

/** Igual que `NavLink` sin `end`: activo en `to` y en sus sub-rutas. */
export function isPathActive(pathname: string, to: string): boolean {
    if (pathname === to) return true;
    const prefix = to.endsWith('/') ? to : `${to}/`;
    return pathname.startsWith(prefix);
}

export function useIsPathActive(to: string): boolean {
    return useSyncExternalStore(subscribe, () => isPathActive(current, to));
}

/** Ruta actual sin suscribirse (para leerla dentro de un handler). */
export function currentPathname(): string {
    return current;
}

/**
 * Navegar desde un item del panel sin `useNavigate` (que suscribe el
 * componente al router y lo re-renderiza en cada navegación).
 */
export function goTo(path: string): void {
    window.location.hash = `#${path}`;
}
