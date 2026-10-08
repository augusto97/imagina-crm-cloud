import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * v0.1.265 — Vista previa del correo en un iframe aislado (ADR-S34).
 *
 * El HTML es EXACTAMENTE el que sale por correo (lo arma `renderEmailHtml`
 * de packages/shared): así lo que se ve acá es lo que recibe Gmail/Outlook,
 * sin que los estilos de la app lo contaminen. `sandbox` sin `allow-scripts`
 * — nada adentro ejecuta código (la firma y el bloque «HTML propio» los
 * escribe una persona) — pero con `allow-same-origin` para que la app pueda
 * escuchar los clicks y marcar el bloque elegido.
 */
const EDITOR_CSS = `
[data-ib-block]{cursor:pointer;outline:1px dashed transparent;outline-offset:-1px;transition:outline-color .12s;}
[data-ib-block]:hover{outline-color:rgba(14,116,144,.55);}
[data-ib-selected]{outline:2px solid #0e7490 !important;outline-offset:-2px;}
a{pointer-events:none;}
`;

export function EmailPreviewFrame({
    html,
    onSelect,
    width,
    className,
    interactive = true,
    title = 'Vista previa del correo',
}: {
    html: string;
    onSelect?: (id: string | null) => void;
    /** Ancho del "dispositivo" (px) o null = todo el espacio. */
    width?: number | null;
    className?: string;
    interactive?: boolean;
    title?: string;
}): JSX.Element {
    const ref = useRef<HTMLIFrameElement | null>(null);
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;

    useEffect(() => {
        const frame = ref.current;
        const doc = frame?.contentDocument;
        if (!frame || !doc) return;
        const scrollY = frame.contentWindow?.scrollY ?? 0;
        // `document.open()` borra los listeners del documento Y de su ventana
        // (spec HTML): se vuelven a poner después de cada escritura.
        doc.open();
        doc.write(html);
        doc.close();
        frame.contentWindow?.scrollTo(0, scrollY);
        if (!interactive) return;
        const style = doc.createElement('style');
        style.textContent = EDITOR_CSS;
        doc.head?.appendChild(style);
        const handler = (e: Event): void => {
            e.preventDefault();
            const target = e.target as Element | null;
            const block = target?.closest?.('[data-ib-block]');
            onSelectRef.current?.(block?.getAttribute('data-ib-block') ?? null);
        };
        doc.addEventListener('click', handler, true);
        return () => doc.removeEventListener('click', handler, true);
    }, [html, interactive]);

    return (
        <iframe
            ref={ref}
            title={title}
            sandbox="allow-same-origin"
            data-testid="email-preview-frame"
            className={cn('imcrm-block imcrm-h-full imcrm-border-0 imcrm-bg-white', className)}
            style={{ width: width ? `${width}px` : '100%', maxWidth: '100%' }}
        />
    );
}

/** Miniatura no interactiva (escala un render de 600px a `width`). */
export function EmailThumbnail({ html, width = 220, height = 150 }: { html: string; width?: number; height?: number }): JSX.Element {
    const scale = width / 660;
    return (
        <div
            className="imcrm-relative imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-white"
            style={{ width, height }}
            aria-hidden
        >
            <iframe
                title="Miniatura"
                sandbox=""
                srcDoc={html}
                tabIndex={-1}
                className="imcrm-pointer-events-none imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-origin-top-left imcrm-border-0"
                style={{ width: 660, height: height / scale, transform: `scale(${scale})` }}
            />
        </div>
    );
}
