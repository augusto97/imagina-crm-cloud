import { useSyncExternalStore } from 'react';

/**
 * Estado del panel de Novedades (abierto y en qué novedad), fuera de React
 * para que la barra superior, el menú de la persona, la franja de avisos y el
 * `helpBus` lo compartan sin contexto (como el panel del asistente).
 */
export interface WhatsNewPanelState {
    open: boolean;
    /** Novedad a mostrar abierta (id numérico o clave del catálogo). */
    focus: string | null;
}

let state: WhatsNewPanelState = { open: false, focus: null };
const listeners = new Set<() => void>();

function set(next: WhatsNewPanelState): void {
    state = next;
    for (const l of listeners) l();
}

export const whatsNewPanel = {
    get: (): WhatsNewPanelState => state,
    open: (focus?: string | null): void => set({ open: true, focus: focus ?? null }),
    close: (): void => {
        if (state.open) set({ open: false, focus: null });
    },
    subscribe: (l: () => void): (() => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

const CLOSED: WhatsNewPanelState = { open: false, focus: null };

export function useWhatsNewPanel(): WhatsNewPanelState {
    return useSyncExternalStore(whatsNewPanel.subscribe, whatsNewPanel.get, () => CLOSED);
}
