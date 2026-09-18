import { useEffect, useRef, useState, type RefObject } from 'react';

/** Id del scroller vertical de la app (el `<main>` del shell). */
export const MAIN_SCROLLER_ID = 'imcrm-main';
/** Marca de la cabecera fija de la página: la línea bajo la que se pega todo. */
export const STICKY_TOP_ATTR = 'data-imcrm-sticky-top';

/**
 * `true` cuando el centinela (un div de 1px puesto justo ANTES del bloque
 * sticky) salió por arriba del scroller: o sea, el bloque está pegado.
 * Sirve para dibujar la línea de separación sólo mientras hay contenido
 * pasando por debajo.
 */
export function useStuckSentinel(sentinelRef: RefObject<HTMLElement>): boolean {
    const [stuck, setStuck] = useState(false);
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const root = el.closest(`#${MAIN_SCROLLER_ID}`);
        const io = new IntersectionObserver(
            ([entry]) => setStuck(entry ? !entry.isIntersecting && entry.boundingClientRect.top < 0 + (root?.getBoundingClientRect().top ?? 0) + 1 : false),
            { root, threshold: [0, 1] },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [sentinelRef]);
    return stuck;
}

interface PinOptions {
    /** Caja que limita el recorrido: el elemento nunca sale de ella (su tabla, su sección). */
    boundsRef: RefObject<HTMLElement>;
    /** Píxeles extra bajo la cabecera fija (p. ej. el alto del encabezado del grupo). */
    extraTop?: () => number;
    enabled?: boolean;
}

/**
 * v0.1.192 — "sticky" por JavaScript para lo que vive DENTRO del scroller
 * horizontal de la tabla. `position: sticky` sólo se pega al scroll
 * container más cercano, y el wrapper `overflow-x-auto` de la tabla lo es:
 * el `<thead sticky>` se pegaba a un contenedor que nunca scrollea en
 * vertical (el vertical es el del `<main>`, v0.1.70), o sea, a nada. Sacar
 * el thead del wrapper (tabla partida) o hacer que el main scrollee en
 * horizontal rompen la alineación de columnas o el chrome de la página.
 *
 * Acá el elemento se DESPLAZA con `transform: translateY` lo justo para
 * quedar bajo la cabecera fija de la página (`[data-imcrm-sticky-top]`)
 * mientras su caja (`boundsRef`) siga en pantalla — y al terminar la caja
 * se va con ella, que es lo que hace que el encabezado del siguiente grupo
 * lo reemplace. Lecturas de layout primero y UNA escritura de transform
 * (propiedad compuesta: no invalida el layout) por frame.
 */
export function usePinToTop<T extends HTMLElement>(
    elRef: RefObject<T>,
    { boundsRef, extraTop, enabled = true }: PinOptions,
): boolean {
    const [pinned, setPinned] = useState(false);
    const pinnedRef = useRef(false);
    const offsetRef = useRef(0);
    const extraTopRef = useRef(extraTop);
    extraTopRef.current = extraTop;

    useEffect(() => {
        const el = elRef.current;
        const bounds = boundsRef.current;
        if (!enabled || !el || !bounds) return;
        const scroller = (el.closest(`#${MAIN_SCROLLER_ID}`) as HTMLElement | null)
            ?? (document.scrollingElement as HTMLElement | null);
        if (!scroller) return;

        let raf = 0;
        const apply = (): void => {
            raf = 0;
            const header = scroller.querySelector<HTMLElement>(`[${STICKY_TOP_ATTR}]`);
            const scrollerTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
            const line = (header ? header.getBoundingClientRect().bottom : scrollerTop) + (extraTopRef.current?.() ?? 0);
            const b = bounds.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            // Posición natural (sin el desplazamiento que ya lleva).
            const naturalTop = elRect.top - offsetRef.current;
            let y = line - naturalTop;
            if (y < 0) y = 0;
            const maxY = b.bottom - elRect.height - naturalTop;
            // Al terminar la caja, el elemento se va con ella (empujado).
            const leaving = y > maxY;
            if (leaving) y = Math.max(0, maxY);
            y = Math.round(y);
            if (y !== offsetRef.current) {
                offsetRef.current = y;
                el.style.transform = y > 0 ? `translateY(${y}px)` : '';
            }
            // "Pegado" = quieto en la línea (no mientras se lo lleva la caja).
            const isPinned = y > 0 && !leaving;
            if (isPinned !== pinnedRef.current) {
                pinnedRef.current = isPinned;
                el.toggleAttribute('data-pinned', isPinned);
                setPinned(isPinned);
            }
        };
        const schedule = (): void => {
            if (raf === 0) raf = requestAnimationFrame(apply);
        };

        apply();
        scroller.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const ro = new ResizeObserver(schedule);
        ro.observe(bounds);
        ro.observe(scroller);
        return () => {
            if (raf !== 0) cancelAnimationFrame(raf);
            scroller.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            ro.disconnect();
            el.style.transform = '';
            el.removeAttribute('data-pinned');
            offsetRef.current = 0;
            pinnedRef.current = false;
        };
    }, [elRef, boundsRef, enabled]);

    return pinned;
}
