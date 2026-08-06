import { useSyncExternalStore } from 'react';

/**
 * ¿Se cumple una media query? (v0.1.165)
 *
 * Para los casos en que la diferencia entre celular y escritorio NO es sólo
 * de estilo sino de ESTRUCTURA — por ejemplo, un panel que en pantalla ancha
 * es una columna fija y en angosta tiene que abrirse como sheet. Con clases
 * responsive solos se renderizarían los dos y el sheet quedaría montado
 * (invisible) robándose el foco.
 *
 * `useSyncExternalStore` en vez de useEffect+useState: sin parpadeo en el
 * primer paint y sin estado duplicado si el hook se usa en varios lugares.
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const mql = window.matchMedia(query);
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        },
        () => window.matchMedia(query).matches,
        // SSR / entornos sin `window`: asumimos angosto, que es el layout que
        // funciona en cualquier ancho.
        () => false,
    );
}
