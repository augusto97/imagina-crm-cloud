import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Función de identidad ESTABLE que siempre llama a la última versión de `fn`.
 *
 * v0.1.224 — la página de registros le pasaba a las tablas callbacks inline
 * (una función nueva en cada render), así que memoizar la tabla no servía:
 * cada letra tipeada en el buscador re-dibujaba todas sus filas. Con esto la
 * tabla recibe siempre la misma función y sólo se re-dibuja cuando cambian
 * sus datos.
 *
 * No llamarla durante el render: la versión nueva se instala en el
 * layout-effect (antes de cualquier evento del usuario).
 */
export function useEventCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const ref = useRef(fn);
    useLayoutEffect(() => {
        ref.current = fn;
    });
    return useCallback((...args: A) => ref.current(...args), []);
}
