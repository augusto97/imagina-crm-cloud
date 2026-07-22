import { useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';

import { applyHideZero, categoryColor, prettyGroupLabel, useGroupColorMap } from './useChartColors';
import { useContainerWidth } from './useContainerWidth';
import { useSegmentNav } from './useSegmentNav';
import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface PieChartWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * Donut chart con leader-line labels (estilo ClickUp/Looker): cada
 * sector grande pinta su porcentaje + label afuera del aro con una
 * línea que conecta. Los segmentos chicos (<3%) caen sólo en la
 * leyenda lateral para no saturar.
 *
 * 0.57.39 — cada sector usa el color REAL de la opción del select
 * agrupado (coherente con Kanban/chips); leyenda muestra valor + %;
 * centro del donut con total + sublabel.
 *
 * Toggles del widget:
 *  - `show_data_labels` → labels alrededor del aro (default: on)
 *  - `show_legend`      → leyenda lateral (default: on)
 */
export function PieChartWidget({ dashboardId, widget }: PieChartWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    // v0.1.101 — responsive por ancho del CARD: en angosto (celular o
    // widget chico) los callouts externos se recortan en los bordes y la
    // leyenda lateral aplasta los nombres → labels off + layout apilado.
    const [measureRef, cardWidth] = useContainerWidth<HTMLDivElement>();
    const narrow = cardWidth > 0 && cardWidth < 420;
    const showLabels = widget.config.show_data_labels !== false && ! narrow;
    const showLegend = widget.config.show_legend !== false;
    const colorMap = useGroupColorMap(widget.list_id, widget.config.group_by_field_id);
    const subtitle = useWidgetSubtitle(widget);
    // v0.1.100 — click en un sector → lista filtrada a ese valor.
    const onSegment = useSegmentNav(widget);

    return (
        <div ref={measureRef} className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-2 imcrm-min-h-0">
            <WidgetHeader title={widget.title || __('Distribución')} subtitle={subtitle} />

            <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-min-h-0">
                {data.isLoading ? (
                    <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                ) : data.isError ? (
                    <span
                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive"
                        title={(data.error as Error).message}
                    >
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error')}
                    </span>
                ) : data.data && 'data' in data.data && data.data.data.length > 0 ? (
                    <Donut
                        rows={applyHideZero(
                            data.data.data.map((r) => ({ label: r.label, value: typeof r.value === 'number' ? r.value : Date.parse(r.value) || 0 })),
                            widget.config.hide_zero_groups === true,
                        )}
                        showLabels={showLabels}
                        showLegend={showLegend}
                        narrow={narrow}
                        colorMap={colorMap}
                        onSegment={onSegment}
                    />
                ) : (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin datos.')}</p>
                )}
            </div>
        </div>
    );
}

interface DonutProps {
    rows: Array<{ label: string; value: number }>;
    showLabels: boolean;
    showLegend: boolean;
    /** Card angosto: aro arriba (chico) + leyenda debajo a lo ancho. */
    narrow: boolean;
    colorMap: Map<string, string>;
    onSegment: ((label: string) => void) | null;
}

function Donut({ rows, showLabels, showLegend, narrow, colorMap, onSegment }: DonutProps): JSX.Element {
    // 0.57.40 — leyenda clicable: el usuario puede ocultar/mostrar
    // categorías. El donut y el total se recalculan con las visibles.
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const toggleLabel = (label: string): void => {
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            // No permitir ocultar TODAS las categorías.
            if (next.size >= rows.length) return prev;
            return next;
        });
    };
    const visible = rows.filter((r) => ! hidden.has(r.label));

    const total = visible.reduce((acc, r) => acc + r.value, 0) || 1;
    // v0.1.103 — se ELIMINARON los callouts externos con línea: a
    // cualquier tamaño real de card terminaban superpuestos o cortados
    // en los bordes (reporte del usuario). El % ahora vive DENTRO del
    // aro (slices grandes) y el detalle completo en la leyenda/tooltip.
    // ViewBox compacto único: el aro llena el SVG.
    const viewSize = 100;
    const cx = viewSize / 2;
    const cy = viewSize / 2;
    const radius = 40;
    const stroke = showLabels ? 15 : 13;
    const circumference = 2 * Math.PI * radius;

    let offset = 0;
    let cumulative = 0;
    return (
        <div
            className={cn(
                'imcrm-h-full imcrm-w-full imcrm-min-h-0',
                narrow
                    // Apilado (celular / card chico): aro centrado arriba,
                    // leyenda debajo ocupando TODO el ancho.
                    ? 'imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-overflow-y-auto'
                    // Desktop: par aro+leyenda CENTRADO, leyenda de ancho
                    // acotado (antes flex-1 → un océano entre nombre y valor).
                    : 'imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-6',
            )}
        >
            {/* max-h evita que el donut crezca desproporcionado en
              * widgets anchos — queda centrado con aire equilibrado. */}
            <div
                className={cn(
                    'imcrm-relative imcrm-flex imcrm-aspect-square imcrm-shrink-0 imcrm-items-center imcrm-justify-center',
                    narrow ? 'imcrm-h-[130px]' : 'imcrm-h-full imcrm-max-h-[260px]',
                )}
            >
                <svg
                    viewBox={`0 0 ${viewSize} ${viewSize}`}
                    className="imcrm-h-full imcrm-w-full"
                    preserveAspectRatio="xMidYMid meet"
                >
                    <circle
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill="none"
                        strokeWidth={stroke}
                        className="imcrm-stroke-muted"
                    />
                    {visible.map((row) => {
                        const pct = row.value / total;
                        const len = pct * circumference;
                        const dasharray = `${len} ${circumference - len}`;
                        // Índice ORIGINAL — el color de cada categoría no
                        // cambia al ocultar otras desde la leyenda.
                        const color = categoryColor(colorMap, row.label, rows.findIndex((r) => r.label === row.label));
                        const seg = (
                            <circle
                                key={`seg-${row.label}`}
                                cx={cx}
                                cy={cy}
                                r={radius}
                                fill="none"
                                strokeWidth={stroke}
                                stroke={color}
                                strokeDasharray={dasharray}
                                strokeDashoffset={-offset}
                                transform={`rotate(-90 ${cx} ${cy})`}
                                onClick={onSegment !== null ? () => onSegment(row.label) : undefined}
                                style={onSegment !== null ? { cursor: 'pointer' } : undefined}
                            >
                                <title>{`${prettyGroupLabel(row.label)}: ${row.value.toLocaleString()} (${(pct * 100).toFixed(1)}%)${onSegment !== null ? ` — ${__('click para ver los registros')}` : ''}`}</title>
                            </circle>
                        );
                        offset += len;
                        return seg;
                    })}

                    {showLabels && visible.map((row) => {
                        const pct = row.value / total;
                        // % DENTRO del aro, solo en slices con lugar (≥7%).
                        if (pct < 0.07) {
                            cumulative += pct;
                            return null;
                        }
                        const angleDeg = -90 + 360 * (cumulative + pct / 2);
                        const angle = (angleDeg * Math.PI) / 180;
                        cumulative += pct;
                        const x = cx + Math.cos(angle) * radius;
                        const y = cy + Math.sin(angle) * radius;
                        return (
                            <text
                                key={`pct-${row.label}`}
                                x={x}
                                y={y}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fill="#ffffff"
                                style={{ fontSize: 6.5, fontWeight: 700, pointerEvents: 'none' }}
                            >
                                {(pct * 100).toFixed(0)}%
                            </text>
                        );
                    })}

                    <text
                        x={cx}
                        y={cy - (showLabels ? 3 : 4)}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="imcrm-fill-foreground"
                        style={{ fontSize: showLabels ? 13 : 15, fontWeight: 700 }}
                    >
                        {total.toLocaleString()}
                    </text>
                    <text
                        x={cx}
                        y={cy + (showLabels ? 8 : 9)}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="imcrm-fill-muted-foreground"
                        style={{ fontSize: showLabels ? 6 : 7, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                    >
                        {__('Total')}
                    </text>
                </svg>
            </div>

            {showLegend && (() => {
                // v0.1.101 — leyenda ordenada por valor DESC: las categorías
                // que importan primero (antes: orden alfabético del backend →
                // en listas largas las primeras 8 podían ser todas 0 y el
                // segmento grande quedaba escondido en "+N más").
                const legendRows = [...rows].sort((a, b) => b.value - a.value);
                return (
                <ul
                    className={cn(
                        'imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5 imcrm-text-xs',
                        narrow
                            ? 'imcrm-w-full imcrm-shrink-0'
                            // Ancho acotado: nombre, valor y % quedan juntos.
                            : 'imcrm-w-[320px] imcrm-max-w-[55%] imcrm-shrink imcrm-overflow-y-auto',
                    )}
                >
                    {legendRows.slice(0, 8).map((row) => {
                        // Color por índice ORIGINAL — consistente con el aro.
                        const i = rows.findIndex((r) => r.label === row.label);
                        const isHidden = hidden.has(row.label);
                        const pct = isHidden ? 0 : (row.value / total) * 100;
                        return (
                            <li key={row.label}>
                                {/* Leyenda clicable — togglea la visibilidad de la
                                  * categoría en el donut (estado local de sesión). */}
                                <button
                                    type="button"
                                    onClick={() => toggleLabel(row.label)}
                                    title={isHidden ? __('Mostrar categoría') : __('Ocultar categoría')}
                                    className={cn(
                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1 imcrm-py-0.5 imcrm-text-left imcrm-transition-colors hover:imcrm-bg-accent/50',
                                        isHidden && 'imcrm-opacity-45',
                                    )}
                                >
                                    <span
                                        className="imcrm-h-2.5 imcrm-w-2.5 imcrm-shrink-0 imcrm-rounded-sm"
                                        style={{ backgroundColor: categoryColor(colorMap, row.label, i) }}
                                        aria-hidden
                                    />
                                    <span
                                        className={cn(
                                            'imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-muted-foreground',
                                            isHidden && 'imcrm-line-through',
                                        )}
                                    >
                                        {prettyGroupLabel(row.label)}
                                    </span>
                                    <span className="imcrm-shrink-0 imcrm-tabular-nums imcrm-font-semibold imcrm-text-foreground">
                                        {row.value.toLocaleString()}
                                    </span>
                                    <span className="imcrm-w-9 imcrm-shrink-0 imcrm-text-right imcrm-tabular-nums imcrm-text-[10px] imcrm-text-muted-foreground/80">
                                        {isHidden ? '—' : `${pct.toFixed(0)}%`}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                    {rows.length > 8 && (
                        <li className="imcrm-px-1 imcrm-text-[10px] imcrm-text-muted-foreground/70">
                            +{rows.length - 8} {__('más')}
                        </li>
                    )}
                </ul>
                );
            })()}
        </div>
    );
}
