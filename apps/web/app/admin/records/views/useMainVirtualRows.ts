import { useLayoutEffect, useState, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { RowDensity } from '../recordsState';

/** Alto estimado de una fila por densidad (el virtualizer mide la real). */
export function estimatedRowHeight(density: RowDensity | null | undefined): number {
    return density === 'compact' ? 25 : density === 'comfortable' ? 49 : 37;
}

export interface MainVirtualRows {
    /** Si la ventana está activa (si no, se dibujan todas las filas). */
    active: boolean;
    /** Índices a dibujar, en orden. */
    items: Array<{ index: number; key: string | number | bigint }>;
    paddingTop: number;
    paddingBottom: number;
    measureElement: (el: Element | null) => void;
}

/**
 * v0.1.256 — Ventana de filas contra el scroll del `<main>` (el único scroll
 * vertical de la app desde v0.1.70), para tablas que viven DENTRO del flujo de
 * la página: la vista agrupada tiene una tabla por grupo y, con 40 grupos
 * abiertos de 50 filas, dibujaba 2.000 filas aunque se vieran 20. Cada grupo
 * lleva su propio virtualizer sobre el mismo `<main>`; `scrollMargin` es dónde
 * empieza ese cuerpo dentro del contenido, y se re-mide cuando el contenido
 * cambia de alto (otro grupo se abre o se cierra arriba).
 */
export function useMainVirtualRows(
    bodyRef: RefObject<HTMLElement>,
    count: number,
    opts: { density?: RowDensity | null; threshold?: number; overscan?: number } = {},
): MainVirtualRows {
    const threshold = opts.threshold ?? 30;
    const wanted = count > threshold;
    const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
    const [scrollMargin, setScrollMargin] = useState(0);

    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body || !wanted) return;
        const main = body.closest<HTMLElement>('#imcrm-main');
        setScrollEl(main);
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
        getScrollElement: () => scrollEl,
        estimateSize: () => estimatedRowHeight(opts.density),
        scrollMargin,
        overscan: opts.overscan ?? 10,
        enabled: wanted && scrollEl !== null,
    });

    const active = wanted && scrollEl !== null;
    if (!active) {
        return { active: false, items: [], paddingTop: 0, paddingBottom: 0, measureElement: () => undefined };
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
        measureElement: virtualizer.measureElement,
    };
}
