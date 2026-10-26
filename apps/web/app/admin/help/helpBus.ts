import { useSyncExternalStore } from 'react';

/**
 * Fase 7 — el contrato que conecta las tres piezas de ayuda sin que dependan
 * entre sí: «Empezar fácil» (primeros pasos), las guías y recorridos
 * interactivos, y las novedades.
 *
 * Cada pieza, al montarse, registra los handlers que implementa. Quien llama
 * no necesita saber si la otra pieza existe: si nadie registró la acción, la
 * llamada no hace nada y `useHelpAvailability()` lo dice, así un botón
 * «Muéstrame» o «Pruébalo» se oculta en vez de quedar muerto.
 *
 * Convención de anclas para los recorridos: los elementos que un recorrido
 * señala llevan `data-tour="<area>-<cosa>"` (p. ej. `rail-lists`,
 * `topbar-help`, `records-new`). Cada pieza pone las anclas de lo que dibuja.
 */
export interface HelpHandlers {
    /** Arranca un recorrido. Devuelve false si no existe o no aplica a esta persona. */
    startTour?: (tourId: string) => boolean;
    /** Si el recorrido existe y aplica a esta persona (rol, pantalla, permisos). */
    hasTour?: (tourId: string) => boolean;
    /** Abre el panel de ayuda, opcionalmente en una guía o con una búsqueda. */
    openHelp?: (opts?: { guideId?: string; query?: string }) => void;
    /** Abre la lista de «Primeros pasos» de la empresa. */
    openGettingStarted?: () => void;
    /** Abre las novedades, opcionalmente en una entrada. */
    openWhatsNew?: (opts?: { id?: string }) => void;
}

type Key = keyof HelpHandlers;

const handlers: { [K in Key]?: HelpHandlers[K] } = {};
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
    version += 1;
    for (const l of listeners) l();
}

/**
 * Registra handlers; devuelve la función que los quita (para el `useEffect`
 * de quien los registra). Sólo quita los que siguen siendo suyos: si otro los
 * reemplazó mientras tanto, no los toca.
 */
export function registerHelpHandlers(partial: HelpHandlers): () => void {
    const keys = Object.keys(partial) as Key[];
    for (const k of keys) {
        (handlers as Record<Key, unknown>)[k] = partial[k];
    }
    emit();
    return () => {
        let changed = false;
        for (const k of keys) {
            if (handlers[k] === partial[k]) {
                delete handlers[k];
                changed = true;
            }
        }
        if (changed) emit();
    };
}

export const help = {
    startTour(tourId: string): boolean {
        return handlers.startTour ? handlers.startTour(tourId) : false;
    },
    hasTour(tourId: string): boolean {
        return handlers.hasTour ? handlers.hasTour(tourId) : false;
    },
    openHelp(opts?: { guideId?: string; query?: string }): void {
        handlers.openHelp?.(opts);
    },
    openGettingStarted(): void {
        handlers.openGettingStarted?.();
    },
    openWhatsNew(opts?: { id?: string }): void {
        handlers.openWhatsNew?.(opts);
    },
};

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

export interface HelpAvailability {
    tours: boolean;
    help: boolean;
    gettingStarted: boolean;
    whatsNew: boolean;
}

let snapshot: HelpAvailability = { tours: false, help: false, gettingStarted: false, whatsNew: false };
let snapshotVersion = -1;

function getAvailability(): HelpAvailability {
    if (snapshotVersion !== version) {
        snapshotVersion = version;
        snapshot = {
            tours: Boolean(handlers.startTour),
            help: Boolean(handlers.openHelp),
            gettingStarted: Boolean(handlers.openGettingStarted),
            whatsNew: Boolean(handlers.openWhatsNew),
        };
    }
    return snapshot;
}

const EMPTY: HelpAvailability = { tours: false, help: false, gettingStarted: false, whatsNew: false };

/** Qué piezas de ayuda están montadas (para mostrar u ocultar botones). */
export function useHelpAvailability(): HelpAvailability {
    return useSyncExternalStore(subscribe, getAvailability, () => EMPTY);
}

/** Si un recorrido puntual existe para esta persona (re-evalúa al registrarse handlers). */
export function useHasTour(tourId: string | null | undefined): boolean {
    useSyncExternalStore(subscribe, () => version, () => 0);
    return tourId ? help.hasTour(tourId) : false;
}
