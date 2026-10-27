import { useEffect, useSyncExternalStore } from 'react';
import type { HelpGuide } from '@imagina-base/shared';

/**
 * Las guías del sistema se cargan a pedido (al abrir la ayuda o la búsqueda
 * global): son ~40 KB de texto que no tienen por qué viajar en la carga
 * inicial de la app.
 */
let cache: readonly HelpGuide[] | null = null;
let pending: Promise<readonly HelpGuide[]> | null = null;
const listeners = new Set<() => void>();

export function loadSystemGuides(): Promise<readonly HelpGuide[]> {
    if (cache) return Promise.resolve(cache);
    pending ??= import('./systemGuidesData').then((m) => {
        cache = m.SYSTEM_GUIDES;
        for (const l of listeners) l();
        return cache;
    });
    return pending;
}

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

/** `null` mientras se cargan. */
export function useSystemGuides(enabled = true): readonly HelpGuide[] | null {
    const guides = useSyncExternalStore(subscribe, () => cache, () => null);
    useEffect(() => {
        if (enabled && !cache) void loadSystemGuides().catch(() => undefined);
    }, [enabled]);
    return guides;
}
