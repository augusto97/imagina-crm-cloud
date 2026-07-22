import { useEffect, useRef, useState } from 'react';

/**
 * Ancho REAL del contenedor del widget (v0.1.101). Los widgets no pueden
 * decidir su layout por el viewport (un card puede ser angosto en un
 * desktop ancho): miden su propio ancho con ResizeObserver y se
 * reacomodan — donut apilado, callouts apagados, etc.
 */
export function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (el === null) return;
        setWidth(el.clientWidth);
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (typeof w === 'number') setWidth(Math.round(w));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return [ref, width];
}
