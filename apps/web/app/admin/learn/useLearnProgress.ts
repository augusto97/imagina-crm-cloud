import { useCallback, useSyncExternalStore } from 'react';

/**
 * Qué artículos del manual ya leyó esta persona en este navegador (una marca
 * de «leído» en el índice). Es una comodidad por dispositivo: va en
 * localStorage y si falla no pasa nada.
 */
const KEY = 'imcrm:learn:read';
const listeners = new Set<() => void>();

function read(): string[] {
    try {
        const raw = localStorage.getItem(KEY);
        const v = raw ? (JSON.parse(raw) as unknown) : [];
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-500) : [];
    } catch {
        return [];
    }
}

let snapshot = '';
function getSnapshot(): string {
    const s = JSON.stringify(read());
    if (s !== snapshot) snapshot = s;
    return snapshot;
}

export function markArticleRead(id: string): void {
    const list = read();
    if (list.includes(id)) return;
    list.push(id);
    try {
        localStorage.setItem(KEY, JSON.stringify(list.slice(-500)));
    } catch {
        /* sin almacenamiento: no se recuerda */
    }
    for (const l of listeners) l();
}

export function useLearnProgress(): { read: ReadonlySet<string>; isRead: (id: string) => boolean } {
    const snap = useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        getSnapshot,
        () => '[]',
    );
    const set = new Set<string>(JSON.parse(snap) as string[]);
    const isRead = useCallback((id: string) => set.has(id), [snap]); // eslint-disable-line react-hooks/exhaustive-deps
    return { read: set, isRead };
}
