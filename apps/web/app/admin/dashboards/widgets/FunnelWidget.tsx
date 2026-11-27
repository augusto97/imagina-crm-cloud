import { Loader2 } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

import { WidgetError } from './WidgetError';
import {
    applyHideZero,
    categoryColor,
    displayGroupLabel,
    groupKeysOf,
    inkOn,
    isOthersGroup,
    othersAwareLabel,
    sortChartRows,
    useGroupColorMap,
    useGroupLabelMap,
    useGroupOptionOrder,
    type ChartSort,
} from './useChartColors';
import { formatMetricValue } from './widgetFormat';
import { compareTipRows, openHint, shareText, useChartTip } from './ChartTip';
import { CompareBadge, RowDelta } from './CompareParts';
import { isAdditiveMetric, isReadyCompare, previousByKey, previousTotal, widgetCompareOf, type ReadyCompare } from './compareView';
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
 * value}]}`. El backend ordena por valor; aquí reordenamos por las
 * options del select.
 */
export function FunnelWidget({ dashboardId, widget }: FunnelWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const colorMap = useGroupColorMap(widget.list_id, widget.config.group_by_field_id);
    const orderMap = useGroupOptionOrder(widget.list_id, widget.config.group_by_field_id);
    // v0.1.178 — las etapas muestran la ETIQUETA de la opción, no el value.
    const labelMap = useGroupLabelMap(widget.list_id, widget.config.group_by_field_id, groupKeysOf(data.data));
    const subtitle = useWidgetSubtitle(widget);
    // v0.1.100 — click en una etapa → lista filtrada a ese valor.
    const onSegment = useSegmentNav(widget);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const metricField = fields.data?.find((f) => f.id === widget.config.metric_field_id);
    const metric = typeof widget.config.metric === 'string' ? widget.config.metric : 'count';
    const fmt = (n: number): string => formatMetricValue(n, metric, metricField);
    // v0.1.462 — «Comparar con…»: cada etapa contra la de antes.
    const compare = widgetCompareOf(data.data);
    const ready = isReadyCompare(compare) ? compare : null;
    const before = previousByKey(ready);
    const nowRows = data.data && 'data' in data.data ? data.data.data : [];
    const total = ready && isAdditiveMetric(metric)
        ? {
              current: nowRows.reduce((s, r) => s + (typeof r.value === 'number' ? r.value : 0), 0),
              previous: previousTotal(ready, nowRows.reduce((s, r) => s + (before.get(r.label) ?? 0), 0)),
          }
        : null;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <WidgetHeader title={widget.title || __('Embudo')} subtitle={subtitle} right={<CompareBadge compare={compare} total={total} format={fmt} />} />

            {/* Ver nota en BarChartWidget: my-auto en vez de justify-center
              * para que el scroll no recorte las primeras filas. */}
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-min-h-0 imcrm-overflow-y-auto [&>*]:imcrm-my-auto">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-center">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <WidgetError error={data.error} />
                ) : data.data && 'data' in data.data && data.data.data.length > 0 ? (
                    <FunnelRows
                        rows={sortChartRows(
                            applyHideZero(
                                data.data.data.map((r) => ({
                                    label: r.label,
                                    value: typeof r.value === 'number' ? r.value : 0,
                                    others: r.others,
                                })),
                                widget.config.hide_zero_groups === true,
                            ),
                            // El embudo va en el orden del pipeline (las opciones).
                            (widget.config.sort as ChartSort | undefined) ?? 'options',
                            orderMap,
                            (l) => displayGroupLabel(l, labelMap),
                        )}
                        format={fmt}
                        colorMap={colorMap}
                        labelMap={labelMap}
                        onSegment={onSegment}
                        compare={ready}
                        before={before}
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

function FunnelRows({
    rows,
    colorMap,
    labelMap,
    onSegment,
    format,
    compare,
    before,
}: {
    rows: Array<{ label: string; value: number; others?: number }>;
    colorMap: Map<string, string>;
    /** v0.1.178 — value → etiqueta de la opción (sólo display). */
    labelMap: Map<string, string>;
    onSegment: ((label: string) => void) | null;
    format: (n: number) => string;
    compare: ReadyCompare | null;
    before: Map<string, number | null>;
}): JSX.Element {
    const max = Math.max(...rows.map((r) => Math.max(r.value, compare ? (before.get(r.label) ?? 0) : 0)), 1);
    const first = rows[0]?.value ?? 0;
    // v0.1.474 — el recuadro de cada etapa, al instante (antes `title`).
    const tip = useChartTip();

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            {tip.layer}
            {rows.map((row, i) => {
                const widthPct = (row.value / max) * 100;
                // Conversión respecto de la PRIMERA etapa — la lectura
                // clásica de un embudo. Para la primera etapa es 100%.
                const convPct = first > 0 ? (row.value / first) * 100 : 0;
                const color = categoryColor(colorMap, row.label, i);
                const navigable = onSegment !== null && !isOthersGroup(row.label);
                const name = othersAwareLabel(row, labelMap);
                return (
                    <div
                        key={row.label}
                        className={`imcrm-group/stage imcrm-flex imcrm-items-center imcrm-gap-2${navigable ? ' imcrm-cursor-pointer hover:imcrm-bg-accent/40 imcrm-rounded' : ''}`}
                        data-testid="imcrm-funnel-stage"
                        {...tip.bind(
                            row.label,
                            () => ({
                                title: name,
                                subtitle: compare?.label,
                                rows: [
                                    ...(compare
                                        ? compareTipRows(compare, row.value, before.get(row.label), format)
                                        : [{ color, value: format(row.value) }]),
                                    { label: __('De la primera etapa'), value: shareText(row.value, first) },
                                ],
                                hint: openHint(navigable),
                            }),
                            navigable && onSegment !== null ? () => onSegment(row.label) : null,
                        )}
                    >
                        <span className="imcrm-w-24 imcrm-shrink-0 imcrm-truncate imcrm-text-right imcrm-text-xs imcrm-text-muted-foreground">
                            {name}
                        </span>
                        <div className="imcrm-relative imcrm-flex imcrm-h-7 imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                            {compare && (
                                // La etapa de antes: el contorno punteado detrás.
                                <div
                                    className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-0 imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-muted-foreground/60"
                                    style={{ width: `${((before.get(row.label) ?? 0) / max) * 100}%` }}
                                    data-testid="imcrm-funnel-previous"
                                    aria-hidden
                                />
                            )}
                            {/* Barra centrada — la forma del embudo emerge del
                              * estrechamiento progresivo de las etapas. */}
                            {/* v0.1.286 — la cifra con la tinta de mayor
                                contraste sobre el color de la etapa (blanco
                                sobre ámbar o verde daba 2,1:1). */}
                            <div
                                className="imcrm-flex imcrm-h-full imcrm-min-w-[2.25rem] imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-[11px] imcrm-font-semibold imcrm-opacity-90 imcrm-transition-opacity group-hover/stage:imcrm-opacity-100"
                                style={{ width: `${widthPct}%`, backgroundColor: color, color: inkOn(color) }}
                            >
                                {format(row.value)}
                            </div>
                        </div>
                        {compare ? (
                            <RowDelta current={row.value} previous={before.get(row.label)} invert={compare.invert === true} className="imcrm-w-12 imcrm-shrink-0 imcrm-text-right imcrm-text-[10px]" />
                        ) : (
                            <span className="imcrm-w-10 imcrm-shrink-0 imcrm-text-right imcrm-text-[10px] imcrm-tabular-nums imcrm-text-muted-foreground">
                                {i === 0 ? '100%' : `${convPct.toFixed(0)}%`}
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
