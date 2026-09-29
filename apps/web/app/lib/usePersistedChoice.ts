import { useCallback, useSyncExternalStore } from 'react';

/**
 * Preferencia de UI persistida por dispositivo (localStorage) y COMPARTIDA
 * entre los componentes que la leen (v0.1.211): la página de Favoritos y su
 * panel lateral muestran la misma agrupación, y cambiarla en uno repinta el
 * otro al instante — por eso es un store externo y no un `useState` local.
 * Un valor guardado que ya no está entre las opciones cae al default.
 */
const EVENT = 'imcrm:persisted-choice';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const v = window.localStorage.getItem(key);
        return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    } catch {
        return fallback;
    }
}

function subscribe(cb: () => void): () => void {
    window.addEventListener(EVENT, cb);
    window.addEventListener('storage', cb);
    return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener('storage', cb);
    };
}

export function usePersistedChoice<T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T,
): [T, (next: T) => void] {
    const value = useSyncExternalStore(
        subscribe,
        () => read(key, allowed, fallback),
        () => fallback,
    );
    const set = useCallback(
        (next: T) => {
            try {
                window.localStorage.setItem(key, next);
            } catch {
                // storage bloqueado (modo privado): la preferencia no persiste.
            }
            window.dispatchEvent(new Event(EVENT));
        },
        [key],
    );
    return [value, set];
}
