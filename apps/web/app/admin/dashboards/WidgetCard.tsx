import { blockStyleClass, blockStyleCss, readBlockStyle, surfaceInkCss } from '@/lib/blockStyle';
import { cn } from '@/lib/utils';
import { isContentWidget, type WidgetSpec } from '@/types/dashboard';

/**
 * La tarjeta de un widget (v0.1.292: extraída de DashboardPage para que la
 * página pública del tablero dibuje EXACTAMENTE la misma): la capa de estilo
 * por widget (`config.style`, v0.1.98), los bloques de contenido sin tarjeta
 * y el padding vertical capado de los títulos (v0.1.106).
 */
export function WidgetCard({
    widget,
    dark,
    overlay,
    dragWhole = false,
    children,
}: {
    widget: WidgetSpec;
    /** ¿La superficie de abajo es oscura? (tinta de los bloques sin tarjeta). */
    dark: boolean;
    /** Lo que flota arriba a la derecha (período, botones). */
    overlay?: React.ReactNode;
    /** Al editar, un bloque de contenido no tiene encabezado: la tarjeta entera es el asa. */
    dragWhole?: boolean;
    children: React.ReactNode;
}): JSX.Element {
    const style = readBlockStyle(widget.config);
    const styled = style.bg !== undefined || style.border !== undefined;
    const content = isContentWidget(widget.type);
    const chromeless = content && !styled;
    // v0.1.106 — el default de la capa de estilo (fondo → padding md 16px
    // INLINE) recortaba los títulos con tipografía grande en cards de 1 fila:
    // sin un pad ELEGIDO, los bloques de contenido capan el padding VERTICAL a
    // 6px (el horizontal se conserva). Un pad explícito del panel Diseño manda.
    const styleCss = {
        // Un bloque de contenido SIN estilo propio se apoya en el lienzo: su tinta sale de ahí.
        ...(chromeless ? surfaceInkCss(dark) : {}),
        ...blockStyleCss(style, { dark }),
    } as React.CSSProperties;
    if (content && style.pad === undefined && styleCss.padding !== undefined) {
        styleCss.paddingTop = 6;
        styleCss.paddingBottom = 6;
    }
    return (
        <article
            className={cn(
                'imcrm-group imcrm-relative imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-transition-shadow imcrm-duration-200',
                chromeless
                    ? 'imcrm-rounded-xl imcrm-px-2 imcrm-py-1'
                    : // v0.1.105 — los bloques de CONTENIDO con estilo usan menos
                      // padding vertical: con p-4 el texto quedaba CORTADO en
                      // alturas de 1 fila.
                      content
                      ? 'imcrm-rounded-xl imcrm-px-4 imcrm-py-1.5'
                      : 'imcrm-rounded-xl imcrm-p-4',
                !chromeless && !styled && 'imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm hover:imcrm-shadow-imcrm-md hover:imcrm-border-primary/25',
                blockStyleClass(style),
            )}
            style={styleCss}
            data-widget-card={widget.id}
        >
            {overlay}
            <div className={cn('imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col', dragWhole && 'imcrm-drag-handle imcrm-cursor-grab active:imcrm-cursor-grabbing')}>
                {children}
            </div>
        </article>
    );
}
