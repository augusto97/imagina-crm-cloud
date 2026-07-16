import { useEffect, useRef, useState } from 'react';

/**
 * Barra de scroll horizontal FIJA al fondo del viewport (estilo ClickUp/
 * Sheets): el contenedor real de la tabla scrollea horizontal pero su
 * scrollbar nativa queda al fondo de la TABLA (que puede estar a miles de
 * px). Este componente renderiza una barra espejo `position: sticky;
 * bottom: 0` — visible siempre que la tabla esté en pantalla — y sincroniza
 * el scrollLeft en ambos sentidos (asignar el mismo valor no re-dispara el
 * evento, así que no hay loop).
 *
 * Se oculta solo cuando la tabla cabe completa (sin overflow horizontal).
 * Montarlo como HERMANO inmediato del contenedor `overflow-x-auto`, dentro
 * del mismo flujo vertical que scrollea el `<main>`.
 */
export function StickyHScrollbar({
    targetRef,
}: {
    targetRef: React.RefObject<HTMLDivElement>;
}): JSX.Element | null {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [dims, setDims] = useState({ scrollWidth: 0, clientWidth: 0 });

    useEffect(() => {
        const target = targetRef.current;
        if (!target) return;

        const update = (): void => {
            setDims((prev) => {
                const next = { scrollWidth: target.scrollWidth, clientWidth: target.clientWidth };
                return prev.scrollWidth === next.scrollWidth && prev.clientWidth === next.clientWidth
                    ? prev
                    : next;
            });
        };
        update();

        const ro = new ResizeObserver(update);
        ro.observe(target);
        // El ancho real lo dicta la <table> hija (minWidth por columnas).
        for (const child of Array.from(target.children)) ro.observe(child);

        const onTargetScroll = (): void => {
            if (barRef.current) barRef.current.scrollLeft = target.scrollLeft;
        };
        target.addEventListener('scroll', onTargetScroll, { passive: true });
        return () => {
            ro.disconnect();
            target.removeEventListener('scroll', onTargetScroll);
        };
        // targetRef es un ref estable; el efecto corre al montar.
    }, [targetRef]);

    if (dims.scrollWidth <= dims.clientWidth + 2) return null;

    return (
        <div
            ref={barRef}
            onScroll={() => {
                const t = targetRef.current;
                if (t && barRef.current) t.scrollLeft = barRef.current.scrollLeft;
            }}
            aria-hidden
            className="imcrm-sticky imcrm-bottom-0 imcrm-z-30 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-bg-background"
        >
            <div style={{ width: dims.scrollWidth, height: 1 }} />
        </div>
    );
}
