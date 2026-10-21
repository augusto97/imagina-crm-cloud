/**
 * v0.1.286 — atajos de teclado globales del shell.
 *
 *  - Ctrl/⌘+K: la paleta (también con el foco en un campo: es un atajo con
 *    modificador, no pisa lo que se escribe).
 *  - `?`: esta ayuda.
 *  - `g` y después una letra: ir a una sección (como GitHub/Linear).
 * Los atajos de UNA tecla se ignoran mientras se escribe.
 */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Pista visible del atajo de la paleta. */
export const PALETTE_SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl K';

export interface GoChord {
    key: string;
    path: string;
    label: string;
}

/** `g` + tecla → sección. Fuente única para el manejador y la ayuda. */
export const GO_CHORDS: readonly GoChord[] = [
    { key: 'l', path: '/lists', label: 'Ir a Listas' },
    { key: 't', path: '/my-work', label: 'Ir a Mi trabajo' },
    { key: 'f', path: '/favorites', label: 'Ir a Favoritos' },
    { key: 'd', path: '/dashboards', label: 'Ir a Dashboards' },
    { key: 's', path: '/settings', label: 'Ir a Ajustes' },
];

/** Ventana para la segunda tecla de un `g …`. */
export const CHORD_TIMEOUT_MS = 1200;

/** ¿El foco está en algo donde se escribe? (ahí no hay atajos de una tecla). */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return target.closest('[contenteditable="true"], [role="textbox"]') !== null;
}

/**
 * Resuelve un `g …`. Puro: recibe si la tecla anterior fue una `g` (aún dentro
 * de la ventana) y la tecla actual; devuelve la ruta destino o `null`.
 */
export function resolveGoChord(pendingG: boolean, key: string): string | null {
    if (!pendingG) return null;
    const k = key.toLowerCase();
    return GO_CHORDS.find((c) => c.key === k)?.path ?? null;
}
