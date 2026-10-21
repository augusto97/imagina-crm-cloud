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
    isOthersGroup,
    othersAwareLabel,
    sortChartRows,
    useGroupColorMap,
    useGroupLabelMap,
    useGroupOptionOrder,
    type ChartSort,
} from './useChartColors';
import { formatMetricValue } from './widgetFormat';
import { useSegmentNav } from './useSegmentNav';
import { AverageBadge, AVG_LINE_COLOR, useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface BarChartWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * Bar chart horizontal hecho con divs flexbox — sin librería de charts.
 * Cada barra es una row con label, fill proporcional al máximo y conteo
 * a la derecha.
 *
 * 0.57.39 — cada barra usa el color REAL de la opción del select
 * agrupado (mismos colores que Kanban/chips); fallback a paleta
 * rotativa para categorías sin color. Se muestra el % del total
 * junto al valor.
 *
 * Estilo ClickUp: badge "Promedio: N" arriba a la derecha del header
 * + línea de referencia punteada ROJA en el promedio. v0.1.286 — OPT-IN
 * (`show_average_line: true`): en categorías no tiene lectura útil.
 *
 * Toggles del widget config:
 *  - `show_average_line` → promedio en header + línea punteada (default off)
 *  - `show_data_labels`  → siempre mostramos el valor numérico, ya
 *                          es parte del layout base (no aplica aquí)
 */
export function BarChartWidget({ dashboardId, widget }: BarChartWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    // v0.1.286 — la línea de promedio es OPT-IN en barras por categoría: el
    // "promedio de los conteos por estado" no le dice nada a nadie. Sólo con
    // `show_average_line: true` (las tendencias la siguen trayendo).
    const showAvg = widget.config.show_average_line === true;
    const groupFieldId = widget.config.group_by_field_id ?? widget.config.date_field_id;
    const colorMap = useGroupColorMap(widget.list_id, groupFieldId);
    // v0.1.178 — las barras muestran la ETIQUETA de la opción, no el value.
    const labelMap = useGroupLabelMap(widget.list_id, groupFieldId, groupKeysOf(data.data));
    const optionOrder = useGroupOptionOrder(widget.list_id, groupFieldId);
    const subtitle = useWidgetSubtitle(widget);
    // v0.1.100 — click en una barra → lista filtrada a ese valor.
    const onSegment = useSegmentNav(widget);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const metricField = fields.data?.find((f) => f.id === widget.config.metric_field_id);
    const groupField = fields.data?.find((f) => f.id === groupFieldId);
    const metric = typeof widget.config.metric === 'string' ? widget.config.metric : 'count';
    const fmt = (n: number): string => formatMetricValue(n, metric, metricField);
    // Un eje temporal va en orden cronológico (como lo manda el servidor).
    const chronological = groupField?.type === 'date' || groupField?.type === 'datetime';

    const raw = applyHideZero(
        data.data && 'data' in data.data
            ? data.data.data.map((r) => ({ label: r.label, value: toNumber(r.value), others: r.others }))
            : [],
        widget.config.hide_zero_groups === true,
    );
    const rows = chronological
        ? raw
        : sortChartRows(raw, widget.config.sort as ChartSort | undefined, optionOrder, (l) => displayGroupLabel(l, labelMap));
    const avg = rows.length > 0 ? rows.reduce((s, r) => s + r.value, 0) / rows.length : null;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <WidgetHeader
                title={widget.title || __('Distribución')}
                subtitle={subtitle}
                right={showAvg && avg !== null ? <AverageBadge value={avg} format={fmt} /> : null}
            />

            {/* Sin justify-center en el scroll container: con muchas filas
              * + overflow, centraría recortando las primeras (inaccesibles).
              * El centrado vertical lo hace el my-auto del contenido. */}
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-min-h-0 imcrm-overflow-y-auto [&>*]:imcrm-my-auto">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-center">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <WidgetError error={data.error} />
                ) : rows.length > 0 ? (
                    <BarRows rows={rows} showAvg={showAvg} colorMap={colorMap} labelMap={labelMap} onSegment={onSegment} format={fmt} />
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
 * 0.36.9: las nuevas métricas min/max de fecha devuelven string ISO en
 * lugar de número. Las charts no las pueden representar como barra
 * proporcional, así que parseamos a timestamp; si no es fecha válida
 * cae a 0.
 */
function toNumber(v: number | string): number {
    if (typeof v === 'number') return v;
    const ts = Date.parse(v);
    return Number.isFinite(ts) ? ts : 0;
}

function BarRows({
    rows,
    showAvg,
    colorMap,
    labelMap,
    onSegment,
    format,
}: {
    rows: Array<{ label: string; value: number; others?: number }>;
    showAvg: boolean;
    colorMap: Map<string, string>;
    /** v0.1.178 — value → etiqueta de la opción (sólo display). */
    labelMap: Map<string, string>;
    onSegment: ((label: string) => void) | null;
    format: (n: number) => string;
}): JSX.Element {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const total = rows.reduce((sum, r) => sum + r.value, 0) || 1;
    const avg = total / rows.length;
    const avgPct = (avg / max) * 100;
    // v0.1.252 — la columna del valor se mide con el número más largo (antes
    // fija en 4rem: «84,219,000» salía cortado). `ch` + tabular-nums = exacto.
    const valueCh = Math.max(...rows.map((r) => format(r.value).length)) + 5;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {rows.map((row, i) => {
                    const pct = (row.value / max) * 100;
                    const sharePct = (row.value / total) * 100;
                    const color = categoryColor(colorMap, row.label, i);
                    // "Otros" junta varios grupos: no es un valor que se abra.
                    const navigable = onSegment !== null && !isOthersGroup(row.label);
                    const name = othersAwareLabel(row, labelMap);
                    return (
                        <li
                            key={row.label}
                            className={`imcrm-group/bar imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-text-xs${navigable ? ' imcrm-cursor-pointer hover:imcrm-bg-accent/40' : ''}`}
                            title={navigable
                                ? `${name}: ${format(row.value)} — ${__('click para ver los registros')}`
                                : `${name}: ${format(row.value)} (${sharePct.toFixed(1)}%)`}
                            onClick={navigable && onSegment !== null ? () => onSegment(row.label) : undefined}
                        >
                            <span className="imcrm-w-28 imcrm-shrink-0 imcrm-truncate imcrm-text-muted-foreground">
                                {name}
                            </span>
                            <div className="imcrm-relative imcrm-h-5 imcrm-flex-1 imcrm-overflow-hidden imcrm-rounded imcrm-bg-muted/40">
                                <div
                                    className="imcrm-absolute imcrm-inset-y-0 imcrm-left-0 imcrm-rounded imcrm-opacity-80 imcrm-transition-opacity group-hover/bar:imcrm-opacity-100"
                                    style={{ width: `${pct}%`, backgroundColor: color }}
                                    aria-hidden
                                />
                                {showAvg && (
                                    // Línea de referencia del promedio (paridad
                                    // ClickUp): punteada y roja. Es vertical
                                    // porque las barras son horizontales.
                                    <div
                                        className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-0 imcrm-w-px"
                                        style={{
                                            left: `${avgPct}%`,
                                            // Dash 6/4 (equivalente a strokeDasharray="6 4").
                                            backgroundImage: `repeating-linear-gradient(to bottom, ${AVG_LINE_COLOR} 0 6px, transparent 6px 10px)`,
                                        }}
                                        aria-hidden
                                    />
                                )}
                            </div>
                            <span
                                className="imcrm-shrink-0 imcrm-whitespace-nowrap imcrm-text-right imcrm-tabular-nums"
                                style={{ width: `${valueCh}ch` }}
                            >
                                <span className="imcrm-font-semibold imcrm-text-foreground">
                                    {format(row.value)}
                                </span>
                                <span className="imcrm-ml-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                                    {sharePct.toFixed(0)}%
                                </span>
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
