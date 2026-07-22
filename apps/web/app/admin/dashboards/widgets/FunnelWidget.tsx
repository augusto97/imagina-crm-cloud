import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

import { applyHideZero, categoryColor, prettyGroupLabel, useGroupColorMap, useGroupOptionOrder } from './useChartColors';
import { useSegmentNav } from './useSegmentNav';
import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface FunnelWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * Embudo de etapas (0.57.40) — pensado para pipelines: cuántos
 * registros hay en cada etapa de un select y qué % representa cada
 * etapa respecto de la primera (conversión acumulada).
 *
 * Render: barras horizontales centradas con ancho proporcional al
 * valor de la primera etapa (la más ancha). Cada etapa usa el color
 * real de su opción del select. El orden de las etapas es el orden
 * de las opciones del campo (el orden del pipeline que definió el
 * usuario) — no por valor.
 *
 * Reusa el evaluador de chart_bar del backend: `{data: [{label,
 * value}]}`. El backend ordena por valor; acá reordenamos por las
 * options del select.
 */
export function FunnelWidget({ dashboardId, widget }: FunnelWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const colorMap = useGroupColorMap(widget.list_id, widget.config.group_by_field_id);
    const orderMap = useGroupOptionOrder(widget.list_id, widget.config.group_by_field_id);
    const subtitle = useWidgetSubtitle(widget);
    // v0.1.100 — click en una etapa → lista filtrada a ese valor.
    const onSegment = useSegmentNav(widget);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <WidgetHeader title={widget.title || __('Embudo')} subtitle={subtitle} />

            {/* Ver nota en BarChartWidget: my-auto en vez de justify-center
              * para que el scroll no recorte las primeras filas. */}
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-min-h-0 imcrm-overflow-y-auto [&>*]:imcrm-my-auto">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-center">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <div
                        className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive"
                        title={(data.error as Error).message}
                    >
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error')}
                    </div>
                ) : data.data && 'data' in data.data && data.data.data.length > 0 ? (
                    <FunnelRows
                        rows={sortByPipeline(
                            applyHideZero(
                                data.data.data.map((r) => ({
                                    label: r.label,
                                    value: typeof r.value === 'number' ? r.value : 0,
                                })),
                                widget.config.hide_zero_groups === true,
                            ),
                            orderMap,
                        )}
                        colorMap={colorMap}
                        onSegment={onSegment}
                    />
                ) : (
                    <p className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Sin datos.')}
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * Ordena las etapas por el orden de las opciones del select (el orden
 * del pipeline). Las labels que no están en las options (datos
 * legacy, "Sin valor") van al final, ordenadas por valor descendente.
 */
function sortByPipeline(
    rows: Array<{ label: string; value: number }>,
    orderMap: Map<string, number>,
): Array<{ label: string; value: number }> {
    if (orderMap.size === 0) {
        return [...rows].sort((a, b) => b.value - a.value);
    }
    return [...rows].sort((a, b) => {
        const ia = orderMap.get(a.label);
        const ib = orderMap.get(b.label);
        if (ia !== undefined && ib !== undefined) return ia - ib;
        if (ia !== undefined) return -1;
        if (ib !== undefined) return 1;
        return b.value - a.value;
    });
}

function FunnelRows({
    rows,
    colorMap,
    onSegment,
}: {
    rows: Array<{ label: string; value: number }>;
    colorMap: Map<string, string>;
    onSegment: ((label: string) => void) | null;
}): JSX.Element {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const first = rows[0]?.value ?? 0;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            {rows.map((row, i) => {
                const widthPct = (row.value / max) * 100;
                // Conversión respecto de la PRIMERA etapa — la lectura
                // clásica de un embudo. Para la primera etapa es 100%.
                const convPct = first > 0 ? (row.value / first) * 100 : 0;
                const color = categoryColor(colorMap, row.label, i);
                return (
                    <div
                        key={row.label}
                        className={`imcrm-group/stage imcrm-flex imcrm-items-center imcrm-gap-2${onSegment !== null ? ' imcrm-cursor-pointer hover:imcrm-bg-accent/40 imcrm-rounded' : ''}`}
                        title={`${prettyGroupLabel(row.label)}: ${row.value.toLocaleString()} (${convPct.toFixed(1)}% ${__('de la primera etapa')})${onSegment !== null ? ` — ${__('click para ver los registros')}` : ''}`}
                        onClick={onSegment !== null ? () => onSegment(row.label) : undefined}
                    >
                        <span className="imcrm-w-24 imcrm-shrink-0 imcrm-truncate imcrm-text-right imcrm-text-xs imcrm-text-muted-foreground">
                            {prettyGroupLabel(row.label)}
                        </span>
                        <div className="imcrm-relative imcrm-flex imcrm-h-7 imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                            {/* Barra centrada — la forma del embudo emerge del
                              * estrechamiento progresivo de las etapas. */}
                            <div
                                className="imcrm-flex imcrm-h-full imcrm-min-w-[2.25rem] imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-[11px] imcrm-font-semibold imcrm-text-white imcrm-opacity-85 imcrm-transition-opacity group-hover/stage:imcrm-opacity-100"
                                style={{ width: `${widthPct}%`, backgroundColor: color }}
                            >
                                {row.value.toLocaleString()}
                            </div>
                        </div>
                        <span className="imcrm-w-10 imcrm-shrink-0 imcrm-text-right imcrm-text-[10px] imcrm-tabular-nums imcrm-text-muted-foreground">
                            {i === 0 ? '100%' : `${convPct.toFixed(0)}%`}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
