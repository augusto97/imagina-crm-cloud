import GridLayout, { WidthProvider } from 'react-grid-layout/legacy';
import type { Layout, LayoutItem } from 'react-grid-layout';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import {
    defaultLayoutForType,
    minLayoutForType,
    type WidgetSpec,
} from '@/types/dashboard';

// `WidthProvider` mide el contenedor y le pasa `width` al grid.
// Antes usábamos `Responsive` con breakpoints lg/md/sm/xs/xxs y
// distintos `cols` por breakpoint — eso recompactaba los widgets al
// achicar la ventana y disparaba `onLayoutChange` con el layout mobile,
// que terminaba persistido como canónico (¡pérdida de la posición
// real!). La UI del plugin es desktop-only (CLAUDE.md §17, ≥1024px),
// así que un grid no-responsive de 12 columnas fijas es lo correcto.
const SizedGrid = WidthProvider(GridLayout);

interface DashboardGridProps {
    widgets: WidgetSpec[];
    onLayoutChange: (layouts: Array<{ id: string; x: number; y: number; w: number; h: number }>) => void;
    children: (widget: WidgetSpec) => React.ReactNode;
}

/**
 * Grid resizable + drag-and-drop para los widgets del Dashboard.
 *
 * Persistencia: SOLO en `onDragStop` y `onResizeStop` — ambos disparan
 * únicamente cuando el usuario suelta el drag/resize manual. Antes
 * usábamos `onLayoutChange` que también dispara en mount inicial y en
 * cada paso del drag → causaba PATCHes espurios y, peor aún, persistía
 * el layout reorganizado por el responsive en breakpoints angostos.
 */
export function DashboardGrid({
    widgets,
    onLayoutChange,
    children,
}: DashboardGridProps): JSX.Element {
    const layout: LayoutItem[] = widgets.map((w, i) => {
        // 0.57.42 — defaults por TIPO si nunca se persistió un layout:
        // KPIs compactos 3×2, charts 4×4, tablas 6×5. Antes todo nacía
        // 4×3 y los KPIs quedaban con la mitad del card vacío.
        const def = defaultLayoutForType(w.type);
        const min = minLayoutForType(w.type);
        return {
            i: w.id,
            x: typeof w.layout?.x === 'number' ? w.layout.x : (i % 3) * 4,
            y: typeof w.layout?.y === 'number' ? w.layout.y : Math.floor(i / 3) * 3,
            w: typeof w.layout?.w === 'number' && w.layout.w > 0 ? w.layout.w : def.w,
            h: typeof w.layout?.h === 'number' && w.layout.h > 0 ? w.layout.h : def.h,
            minW: min.minW,
            minH: min.minH,
        };
    });

    const handleStop = (next: Layout): void => {
        onLayoutChange(
            next.map((l) => ({ id: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
        );
    };

    return (
        <SizedGrid
            className="imcrm-layout"
            cols={12}
            layout={layout}
            // 0.57.42 — densidad estilo Linear: rowHeight 80→64 y
            // margin 16→12. Un KPI h=2 pasa de 176px a 140px de alto;
            // el dashboard muestra ~25% más contenido por pantalla.
            rowHeight={64}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            isDraggable
            isResizable
            // `compactType="vertical"` deja que RGL apile widgets cuando
            // hay huecos verticales, pero NO los reordena horizontalmente
            // como `Responsive` con cols pequeños hacía. La posición x
            // que el usuario eligió se respeta.
            compactType="vertical"
            draggableHandle=".imcrm-drag-handle"
            draggableCancel=".imcrm-no-drag"
            onDragStop={handleStop}
            onResizeStop={handleStop}
        >
            {widgets.map((w) => (
                <div key={w.id}>{children(w)}</div>
            ))}
        </SizedGrid>
    );
}
