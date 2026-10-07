import { useLayoutEffect, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { RowDensity } from '../recordsState';
import { MAIN_SCROLLER_ID } from './stickyTop';

/** Alto estimado de una fila por densidad (se corrige con la primera fila real). */
export function estimatedRowHeight(density: RowDensity | null | undefined): number {
    return density === 'compact' ? 25 : density === 'comfortable' ? 49 : 37;
}

/**
 * Filas que se dibujan mientras todavía no se sabe dónde está la tabla
 * (el primer render, antes de que el ref apunte al DOM). Alcanza para cubrir
 * una pantalla; el layout effect la corrige antes de pintar.
 */
const FIRST_PAINT_ROWS = 30;

export interface MainVirtualRows {
    /** Si la ventana está activa (si no, se dibujan todas las filas). */
    active: boolean;
    /** Índices a dibujar, en orden. */
    items: Array<{ index: number; key: string | number | bigint }>;
    paddingTop: number;
    paddingBottom: number;
    /** Ref para cada `<tr>` (sólo mide de verdad cuando `measure` está activo). */
    measureElement: (el: Element | null) => void;
}

const noop = (): void => undefined;

/**
 * Ventana de filas contra el scroll del `<main>` (el único scroll vertical de
 * la app desde v0.1.70), para tablas que viven DENTRO del flujo de la página:
 * la tabla plana y cada grupo de la agrupada.
 *
 * v0.1.259 — dos costos que hacían lento cambiar de vista:
 * (a) el primer render dibujaba TODAS las filas (la ventana se activaba recién
 *     en el layout effect, cuando ya se sabía cuál era el `<main>`): 200 filas
 *     con sus celdas editables montadas y desmontadas por nada. Ahora el primer
 *     render ya es una ventana (`FIRST_PAINT_ROWS`).
 * (b) cada `<tr>` se medía con `getBoundingClientRect` al montarse
 *     (`measureElement`), y como el virtualizer ajusta el scroll entre medición
 *     y medición, eso forzaba un layout por fila. Con alto fijo (sin "Ajustar
 *     texto") las filas miden todas lo mismo: se mide UNA y listo.
 */
export function useMainVirtualRows(
    bodyRef: RefObject<HTMLElement>,
    count: number,
    opts: {
        density?: RowDensity | null;
        threshold?: number;
        overscan?: number;
        /** Filas de alto variable ("Ajustar texto"): medir cada una. */
        measure?: boolean;
    } = {},
): MainVirtualRows {
    const threshold = opts.threshold ?? 30;
    const wanted = count > threshold;
    const measureEach = opts.measure === true;
    // `undefined` = todavía no se buscó; `null` = no vive dentro del <main>
    // (p. ej. una tabla dentro de un modal): se dibujan todas.
    const [scrollEl, setScrollEl] = useState<HTMLElement | null | undefined>(undefined);
    const [scrollMargin, setScrollMargin] = useState(0);
    const estimate = estimatedRowHeight(opts.density);
    const [rowHeight, setRowHeight] = useState(estimate);
    useLayoutEffect(() => setRowHeight(estimate), [estimate]);

    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body || !wanted) return;
        const main = body.closest<HTMLElement>(`#${MAIN_SCROLLER_ID}`);
        setScrollEl(main ?? null);
        if (!main) return;
        const measure = (): void => {
            const m = body.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
            setScrollMargin((prev) => (Math.abs(prev - m) > 1 ? m : prev));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(main.firstElementChild ?? main);
        return () => ro.disconnect();
    }, [bodyRef, wanted]);

    const virtualizer = useVirtualizer({
        count,
        getScrollElement: () => scrollEl ?? null,
        estimateSize: () => rowHeight,
        scrollMargin,
        overscan: opts.overscan ?? 10,
        enabled: wanted && !!scrollEl,
    });

    // Alto fijo: se mide la primera fila dibujada una sola vez (por densidad).
    useLayoutEffect(() => {
        if (measureEach || !wanted || !scrollEl) return;
        const tr = bodyRef.current?.querySelector('tr[data-index]');
        if (!tr) return;
        const h = tr.getBoundingClientRect().height;
        if (h > 0 && Math.abs(h - rowHeight) > 0.5) setRowHeight(h);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [measureEach, wanted, scrollEl, estimate]);
    useLayoutEffect(() => {
        virtualizer.measure();
    }, [rowHeight, measureEach, virtualizer]);

    if (!wanted || scrollEl === null) {
        return { active: false, items: [], paddingTop: 0, paddingBottom: 0, measureElement: noop };
    }
    if (scrollEl === undefined) {
        // Primer render: una ventana fija desde arriba, sin medir nada.
        const n = Math.min(count, FIRST_PAINT_ROWS);
        return {
            active: true,
            items: Array.from({ length: n }, (_, index) => ({ index, key: index })),
            paddingTop: 0,
            paddingBottom: (count - n) * rowHeight,
            measureElement: noop,
        };
    }
    const items = virtualizer.getVirtualItems();
    const total = virtualizer.getTotalSize();
    const first = items[0];
    const last = items[items.length - 1];
    return {
        active: true,
        items: items.map((v) => ({ index: v.index, key: v.key })),
        paddingTop: first ? Math.max(0, first.start - scrollMargin) : 0,
        paddingBottom: last ? Math.max(0, total - (last.end - scrollMargin)) : 0,
        measureElement: measureEach ? virtualizer.measureElement : noop,
    };
}
