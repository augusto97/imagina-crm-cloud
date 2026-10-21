import { useEffect, useState, type RefObject } from 'react';

/**
 * v0.1.287 — Ancho visible de un elemento (ResizeObserver). Lo usan las
 * columnas fijas: en una pantalla angosta, si lo fijado taparía casi todo,
 * se fija sólo la primera. `null` mientras no se midió.
 */
export function useWidth(ref: RefObject<HTMLElement>, enabled = true): number | null {
    const [width, setWidth] = useState<number | null>(null);
    useEffect(() => {
        const el = ref.current;
        if (!enabled || el === null) return;
        setWidth(el.clientWidth);
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (typeof w === 'number') setWidth(Math.round(w));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, enabled]);
    return width;
}
