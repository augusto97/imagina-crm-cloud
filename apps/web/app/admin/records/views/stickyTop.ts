import { createContext, useContext, useEffect, useState } from 'react';

/** Id del scroller vertical de la app (el `<main>` del shell). */
export const MAIN_SCROLLER_ID = 'imcrm-main';

/**
 * v0.1.193 — línea (en px, desde el borde superior del área de trabajo)
 * bajo la que se pegan las cabeceras de columnas y los encabezados de
 * grupo: el alto de la cabecera fija de la página de registros. La
 * provee `RecordsPage` midiendo su bloque sticky; sin proveedor es 0.
 *
 * Todo lo que se pega usa `position: sticky` NATIVO con este `top`. La
 * versión por JavaScript de v0.1.192 (`transform` en el evento scroll)
 * llegaba un cuadro tarde con el scroll del compositor y se veía
 * "rebotar" en el navegador real — el E2E con `scrollTo` instantáneo no
 * lo mostraba.
 */
export const PageStickyTopContext = createContext<number>(0);

export function usePageStickyTop(): number {
    return useContext(PageStickyTopContext);
}

/**
 * Alto en px de un elemento, seguido en vivo con ResizeObserver. Recibe el
 * ELEMENTO (de un callback ref con `useState`), no un RefObject: la
 * cabecera se monta después de que carga la lista, y un efecto atado a un
 * ref estable corría una sola vez, con el ref todavía vacío.
 */
export function useElementHeight(el: HTMLElement | null): number {
    const [height, setHeight] = useState(0);
    useEffect(() => {
        if (!el) {
            setHeight(0);
            return;
        }
        const update = (): void => {
            const h = Math.round(el.getBoundingClientRect().height);
            setHeight((prev) => (prev === h ? prev : h));
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return height;
}

/**
 * `true` cuando el centinela (un div de 1px puesto justo ANTES del bloque
 * sticky) salió por arriba de la línea `offset` del scroller: o sea, el
 * bloque está pegado. Sirve para dibujar la sombra de separación sólo
 * mientras hay contenido pasando por debajo.
 */
export function useStuckSentinel(el: HTMLElement | null, offset = 0): boolean {
    const [stuck, setStuck] = useState(false);
    useEffect(() => {
        if (!el) {
            setStuck(false);
            return;
        }
        const root = el.closest(`#${MAIN_SCROLLER_ID}`);
        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry) return;
                const rootTop = entry.rootBounds?.top ?? 0;
                setStuck(!entry.isIntersecting && entry.boundingClientRect.top < rootTop + offset + 1);
            },
            { root, threshold: [0, 1], rootMargin: `-${Math.max(0, Math.round(offset))}px 0px 0px 0px` },
        );
        io.observe(el);
        return () => io.disconnect();
    }, [el, offset]);
    return stuck;
}
