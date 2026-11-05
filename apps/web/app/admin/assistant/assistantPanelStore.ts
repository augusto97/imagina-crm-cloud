import { useSyncExternalStore } from 'react';

/**
 * Estado del panel del asistente (abierto/cerrado), fuera de React para que
 * el Topbar, el atajo de teclado y el propio panel lo compartan sin
 * contexto. La conversación en curso se recuerda por pestaña y empresa en
 * sessionStorage: cerrar el panel no la pierde; cerrar la pestaña sí.
 */
let open = false;
const listeners = new Set<() => void>();

function emit(): void {
    for (const l of listeners) l();
}

export const assistantPanel = {
    isOpen: (): boolean => open,
    open: (): void => {
        if (open) return;
        open = true;
        emit();
    },
    close: (): void => {
        if (!open) return;
        open = false;
        emit();
    },
    toggle: (): void => {
        open = !open;
        emit();
    },
    subscribe: (l: () => void): (() => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useAssistantPanelOpen(): boolean {
    return useSyncExternalStore(assistantPanel.subscribe, assistantPanel.isOpen, () => false);
}

const CONV_KEY = (tenantId: number | null): string => `imcrm:ai:conv:${tenantId ?? 'none'}`;

export function readConversationId(tenantId: number | null): string | null {
    try {
        return sessionStorage.getItem(CONV_KEY(tenantId));
    } catch {
        return null;
    }
}

export function writeConversationId(tenantId: number | null, id: string | null): void {
    try {
        if (id) sessionStorage.setItem(CONV_KEY(tenantId), id);
        else sessionStorage.removeItem(CONV_KEY(tenantId));
    } catch {
        // sin storage (modo privado) — la conversación dura lo que dure el panel
    }
}

/**
 * v0.1.370 — Modo ancho del panel (en el computador): se recuerda en el
 * dispositivo. En el teléfono el panel ocupa siempre toda la pantalla.
 */
const WIDE_KEY = 'imcrm:ai:wide';
let wide = ((): boolean => {
    try {
        return localStorage.getItem(WIDE_KEY) === '1';
    } catch {
        return false;
    }
})();
const wideListeners = new Set<() => void>();

export const assistantWide = {
    get: (): boolean => wide,
    set: (value: boolean): void => {
        if (wide === value) return;
        wide = value;
        try {
            if (value) localStorage.setItem(WIDE_KEY, '1');
            else localStorage.removeItem(WIDE_KEY);
        } catch {
            // sin storage: dura lo que dure la pestaña
        }
        for (const l of wideListeners) l();
    },
    subscribe: (l: () => void): (() => void) => {
        wideListeners.add(l);
        return () => wideListeners.delete(l);
    },
};

export function useAssistantWide(): boolean {
    return useSyncExternalStore(assistantWide.subscribe, assistantWide.get, () => false);
}
