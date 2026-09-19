import { useEffect, useState } from 'react';
import type { HScrollGroup } from './hscrollGroup';

/**
 * Barra de scroll horizontal FIJA al fondo del viewport (estilo ClickUp/
 * Sheets): el contenedor real de la tabla scrollea horizontal pero su
 * scrollbar nativa queda al fondo de la TABLA (que puede estar a miles de
 * px). Este componente renderiza una barra espejo `position: sticky;
 * bottom: 0` — visible siempre que la tabla esté en pantalla.
 *
 * La sincronía va por el `HScrollGroup` (v0.1.194): la barra es un miembro
 * más del grupo, así arrastrarla mueve TODOS los scrollers (en la agrupada,
 * cada cuerpo y cada cabecera) y el eco de esas copias no vuelve a escribir
 * sobre lo que la persona está arrastrando.
 *
 * Se oculta solo cuando la tabla cabe completa (sin overflow horizontal).
 * Montarlo como HERMANO del contenedor `overflow-x-auto`, dentro del mismo
 * flujo vertical que scrollea el `<main>`.
 *
 * `targetRef`: el scroller que se MIDE (ancho real vs. visible).
 * `retargetKey`: cambia cuando ese elemento se reemplaza (la vista agrupada
 * apunta al scroller del primer grupo montado, v0.1.193).
 */
export function StickyHScrollbar({
    targetRef,
    group,
    retargetKey = 0,
}: {
    targetRef: React.RefObject<HTMLDivElement>;
    group: HScrollGroup;
    retargetKey?: number;
}): JSX.Element | null {
    const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
    const [dims, setDims] = useState({ scrollWidth: 0, clientWidth: 0 });

    useEffect(() => {
        const target = targetRef.current;
        if (!target) {
            setDims({ scrollWidth: 0, clientWidth: 0 });
            return;
        }
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
        return () => ro.disconnect();
    }, [targetRef, retargetKey]);

    useEffect(() => {
        if (!barEl) return;
        return group.add(barEl);
    }, [barEl, group]);

    if (dims.scrollWidth <= dims.clientWidth + 2) return null;

    return (
        <div
            ref={setBarEl}
            aria-hidden
            className="imcrm-sticky imcrm-bottom-0 imcrm-z-30 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-bg-background"
        >
            <div style={{ width: dims.scrollWidth, height: 1 }} />
        </div>
    );
}
