import { useEffect, useRef, useState } from 'react';

/**
 * Mide el tamaño real del contenedor con ResizeObserver. Permite que
 * el SVG use coordenadas 1:1 con los píxeles del layout — círculos
 * redondos y texto sin deformar, a cualquier tamaño de widget.
 */
export function useElementSize(): {
    ref: React.RefObject<HTMLDivElement>;
    width: number;
    height: number;
} {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (! el) return;
        const measure = (): void => {
            const rect = el.getBoundingClientRect();
            setSize((prev) =>
                Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
                    ? prev
                    : { width: rect.width, height: rect.height },
            );
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return { ref, width: size.width, height: size.height };
}
