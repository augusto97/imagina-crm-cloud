import { useSyncExternalStore } from 'react';

/** Estado del panel de Ayuda: abierto, en qué guía y con qué búsqueda. */
export interface HelpPanelState {
    open: boolean;
    guideId: string | null;
    query: string;
    /** Sube en cada apertura pedida desde afuera (para enfocar el buscador). */
    seq: number;
}

let state: HelpPanelState = { open: false, guideId: null, query: '', seq: 0 };
const listeners = new Set<() => void>();

function set(next: Partial<HelpPanelState>): void {
    state = { ...state, ...next };
    for (const l of listeners) l();
}

export const helpPanel = {
    get: (): HelpPanelState => state,
    open(opts?: { guideId?: string; query?: string }): void {
        set({ open: true, guideId: opts?.guideId ?? null, query: opts?.query ?? '', seq: state.seq + 1 });
    },
    close(): void {
        if (state.open) set({ open: false });
    },
    toggle(): void {
        if (state.open) set({ open: false });
        else set({ open: true, guideId: null, query: '', seq: state.seq + 1 });
    },
    showGuide(guideId: string | null): void {
        set({ guideId });
    },
    setQuery(query: string): void {
        set({ query, guideId: null });
    },
    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useHelpPanel(): HelpPanelState {
    return useSyncExternalStore(helpPanel.subscribe, helpPanel.get, helpPanel.get);
}
