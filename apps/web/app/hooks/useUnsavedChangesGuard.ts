import { useCallback, useEffect, useRef } from 'react';

import { useOptionalConfirm } from '@/components/ui/confirm-dialog';
import { __ } from '@/lib/i18n';

/**
 * Aviso de «cambios sin guardar» para cualquier editor (automatizaciones,
 * diseño de la ficha, correos, documentos…).
 *
 *   const dirty = JSON.stringify(state) !== initialJson.current;
 *   const { confirmLeave } = useUnsavedChangesGuard(dirty);
 *
 * Mientras `dirty` es true cubre las TRES salidas:
 *  1. Cerrar o recargar la pestaña → aviso nativo del navegador
 *     (`beforeunload`; el navegador no deja mostrar un diálogo propio ahí).
 *  2. Un enlace de la app (flecha de volver, menú lateral, breadcrumb…) →
 *     diálogo de la app («Salir sin guardar» / «Seguir editando»). Si se
 *     confirma, el MISMO enlace se vuelve a clickear, así la navegación es
 *     la de siempre (Link, NavLink o `<a href="#/…">`).
 *  3. Atrás / Adelante del navegador o un cambio de `#hash` → se deshace el
 *     paso antes de que el router lo vea, se pregunta, y si se confirma se
 *     vuelve a dar.
 *
 * Por qué no `useBlocker` de react-router: la app usa `HashRouter` (no es un
 * «data router») y ahí `useBlocker` no existe. Este hook funciona con
 * cualquier router y sin router.
 *
 * IMPORTANTE para (3): el listener de `popstate` tiene que registrarse ANTES
 * que el del router — Chrome dispara los listeners de `window` en orden de
 * registro, sin importar la fase de captura. Por eso el punto de entrada de
 * la app llama a `installUnsavedChangesGuard()` antes de montar el router;
 * el hook sólo anota/borra su guardia en el registro global.
 *
 * Lo que NO cubre: una navegación programática (`navigate()` en un botón).
 * Para esos casos está `confirmLeave()`: `if (await confirmLeave()) navigate(…)`.
 *
 * Usa el diálogo de la app (`ConfirmProvider`); fuera de él, `window.confirm`.
 */

interface PopGuard {
    /** URL y `history.state` del editor, para deshacer un «Atrás». */
    url: string;
    state: unknown;
    ask: () => Promise<boolean>;
}

/** Guardias activas (editores con cambios), la última es la que manda. */
const popGuards: PopGuard[] = [];
let installed = false;
/** El «Atrás» que el propio guard re-ejecuta tras confirmar. */
let bypassNextPop = false;

function onPopState(e: PopStateEvent): void {
    if (bypassNextPop) {
        bypassNextPop = false;
        return;
    }
    const guard = popGuards[popGuards.length - 1];
    if (!guard) return;
    // El navegador ya cambió la URL: se corta antes del router y se vuelve
    // al editor con el mismo `history.state` (el router no se entera).
    e.stopImmediatePropagation();
    window.history.pushState(guard.state, '', guard.url);
    void guard.ask().then((ok) => {
        if (!ok) return;
        // Tras el pushState, la entrada anterior ES el destino.
        bypassNextPop = true;
        window.history.back();
    });
}

/**
 * Registra el listener global de `popstate`. Llamarla en el punto de entrada
 * ANTES de montar el router (idempotente). Si no se llamó, el hook la llama
 * al montarse (funciona igual para enlaces y `beforeunload`; para «Atrás»
 * depende de que el navegador corra la captura primero).
 */
export function installUnsavedChangesGuard(): void {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    window.addEventListener('popstate', onPopState, true);
}

export function useUnsavedChangesGuard(dirty: boolean, message?: string): { confirmLeave: () => Promise<boolean> } {
    const confirm = useOptionalConfirm();
    const text = message ?? __('Tienes cambios sin guardar. Si sales ahora, se pierden.');
    // Un clic que el propio hook re-ejecuta tras confirmar.
    const bypassClick = useRef(false);
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;

    const ask = useCallback(async (): Promise<boolean> => {
        if (confirm) {
            return confirm({
                title: __('¿Salir sin guardar?'),
                description: text,
                confirmLabel: __('Salir sin guardar'),
                cancelLabel: __('Seguir editando'),
                destructive: true,
            });
        }
        return window.confirm(text);
    }, [confirm, text]);

    const confirmLeave = useCallback(async (): Promise<boolean> => (dirtyRef.current ? ask() : true), [ask]);

    // 1. Cerrar / recargar la pestaña.
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent): void => {
            e.preventDefault();
            // Chrome viejo / Safari: hace falta `returnValue` para mostrar el aviso.
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    // 2. Enlaces de la app. Fase de CAPTURA en `document`: corre antes que los
    //    handlers de React (que viven en el contenedor raíz), así un `Link`
    //    no llega a navegar.
    useEffect(() => {
        if (!dirty) return;
        const onClick = (e: MouseEvent): void => {
            if (bypassClick.current || e.defaultPrevented) return;
            // Abrir en otra pestaña / ventana no pierde nada.
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const target = e.target instanceof Element ? e.target : null;
            const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
            if (!anchor) return;
            if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
            let url: URL;
            try {
                url = new URL(anchor.href, window.location.href);
            } catch {
                return;
            }
            // Otro sitio: lo cubre `beforeunload`. El mismo lugar: nada que perder.
            if (url.origin !== window.location.origin || url.href === window.location.href) return;
            e.preventDefault();
            e.stopPropagation();
            void ask().then((ok) => {
                if (!ok) return;
                bypassClick.current = true;
                try {
                    anchor.click();
                } finally {
                    bypassClick.current = false;
                }
            });
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [dirty, ask]);

    // 3. Atrás / Adelante / cambio de hash: la guardia se anota en el registro
    //    global (ver `installUnsavedChangesGuard`).
    useEffect(() => {
        if (!dirty) return;
        installUnsavedChangesGuard();
        const guard: PopGuard = { url: window.location.href, state: window.history.state as unknown, ask };
        popGuards.push(guard);
        return () => {
            const i = popGuards.indexOf(guard);
            if (i >= 0) popGuards.splice(i, 1);
        };
    }, [dirty, ask]);

    return { confirmLeave };
}
