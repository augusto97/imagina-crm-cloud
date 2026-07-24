import { useSyncExternalStore } from 'react';

/**
 * v0.1.112 — Tema claro / oscuro de la app.
 *
 * Los tokens del tema (`--imcrm-*`) ya tenían su bloque dark en `globals.css`
 * (`[data-imcrm-theme="dark"]`, el mismo selector que usa `darkMode` de
 * Tailwind) — lo que faltaba era ALGUIEN que lo activara. Este módulo es esa
 * pieza: guarda la preferencia del usuario, la resuelve contra el sistema y
 * pinta el atributo en `<html>`.
 *
 * Por qué en `documentElement` y no en `#root`: Radix (Dialog/Popover/Sheet)
 * portalea su contenido como hijo directo de `<body>`, fuera del árbol de la
 * app. Con el atributo en `<html>` el tema alcanza también a los flotantes.
 *
 * El primer pintado lo hace el script inline de `cloud/index.html` (evita el
 * flash blanco antes de que monte React); este módulo re-aplica al hidratar y
 * ante cada cambio.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'imcrm:theme';
export const THEME_ATTR = 'data-imcrm-theme';

/** Valor guardado → modo válido (cualquier basura cae en `system`). */
export function parseThemeMode(raw: string | null | undefined): ThemeMode {
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

/** Modo + preferencia del SO → el tema que se pinta. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
    if (mode === 'system') return prefersDark ? 'dark' : 'light';
    return mode;
}

function systemPrefersDark(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredMode(): ThemeMode {
    if (typeof window === 'undefined') return 'system';
    try {
        return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return 'system';
    }
}

export interface ThemeState {
    mode: ThemeMode;
    resolved: ResolvedTheme;
}

let state: ThemeState = (() => {
    const mode = readStoredMode();
    return { mode, resolved: resolveTheme(mode, systemPrefersDark()) };
})();

const listeners = new Set<() => void>();

/** Pinta (o quita) el atributo del tema en `<html>`. */
function paint(resolved: ResolvedTheme): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (resolved === 'dark') root.setAttribute(THEME_ATTR, 'dark');
    else root.removeAttribute(THEME_ATTR);
}

function commit(next: ThemeState): void {
    if (next.mode === state.mode && next.resolved === state.resolved) return;
    state = next;
    paint(state.resolved);
    for (const fn of listeners) fn();
}

export function getThemeState(): ThemeState {
    return state;
}

/** Cambia el modo: persiste la elección y re-pinta al instante. */
export function setThemeMode(mode: ThemeMode): void {
    if (typeof window !== 'undefined') {
        try {
            // `system` es el default: se BORRA la clave en vez de guardarla,
            // así una cuenta nueva en el mismo navegador arranca por el SO.
            if (mode === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
            else window.localStorage.setItem(THEME_STORAGE_KEY, mode);
        } catch {
            // modo incógnito / storage bloqueado: el cambio vale para la sesión
        }
    }
    commit({ mode, resolved: resolveTheme(mode, systemPrefersDark()) });
}

/** Atajo del botón del topbar: claro ⇄ oscuro (desde `system`, invierte lo visible). */
export function toggleTheme(): void {
    setThemeMode(state.resolved === 'dark' ? 'light' : 'dark');
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/**
 * Arranque: re-pinta según lo guardado y sigue los cambios del SO mientras el
 * modo sea `system`. Idempotente — lo llama el entrypoint del admin.
 */
export function initTheme(): void {
    paint(state.resolved);
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
        if (state.mode !== 'system') return;
        commit({ mode: state.mode, resolved: resolveTheme('system', mq.matches) });
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
}

/** Estado del tema para los componentes (topbar, panel de Apariencia). */
export function useTheme(): ThemeState & { setMode: (m: ThemeMode) => void; toggle: () => void } {
    const snapshot = useSyncExternalStore(subscribe, getThemeState, getThemeState);
    return { ...snapshot, setMode: setThemeMode, toggle: toggleTheme };
}
