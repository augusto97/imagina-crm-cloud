import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

import { applyHideZero, categoryColor, prettyGroupLabel, useGroupColorMap } from './useChartColors';
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
 * + línea de referencia punteada ROJA en el promedio. Default ON;
 * `show_average_line: false` explícito lo apaga.
 *
 * Toggles del widget config:
 *  - `show_average_line` → promedio en header + línea punteada (default on)
 *  - `show_data_labels`  → siempre mostramos el valor numérico, ya
 *                          es parte del layout base (no aplica acá)
 */
export function BarChartWidget({ dashboardId, widget }: BarChartWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const showAvg = widget.config.show_average_line !== false;
    const colorMap = useGroupColorMap(widget.list_id, widget.config.group_by_field_id);
    const subtitle = useWidgetSubtitle(widget);
    // v0.1.100 — click en una barra → lista filtrada a ese valor.
    const onSegment = useSegmentNav(widget);

    const rows = applyHideZero(
        data.data && 'data' in data.data
            ? data.data.data.map((r) => ({ label: r.label, value: toNumber(r.value) }))
            : [],
        widget.config.hide_zero_groups === true,
    );
    const avg = rows.length > 0 ? rows.reduce((s, r) => s + r.value, 0) / rows.length : null;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <WidgetHeader
                title={widget.title || __('Distribución')}
                subtitle={subtitle}
                right={showAvg && avg !== null ? <AverageBadge value={avg} /> : null}
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
                    <div
                        className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive"
                        title={(data.error as Error).message}
                    >
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error')}
                    </div>
                ) : rows.length > 0 ? (
                    <BarRows rows={rows} showAvg={showAvg} colorMap={colorMap} onSegment={onSegment} />
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
    onSegment,
}: {
    rows: Array<{ label: string; value: number }>;
    showAvg: boolean;
    colorMap: Map<string, string>;
    onSegment: ((label: string) => void) | null;
}): JSX.Element {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const total = rows.reduce((sum, r) => sum + r.value, 0) || 1;
    const avg = total / rows.length;
    const avgPct = (avg / max) * 100;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {rows.map((row, i) => {
                    const pct = (row.value / max) * 100;
                    const sharePct = (row.value / total) * 100;
                    const color = categoryColor(colorMap, row.label, i);
                    return (
                        <li
                            key={row.label}
                            className={`imcrm-group/bar imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-text-xs${onSegment !== null ? ' imcrm-cursor-pointer hover:imcrm-bg-accent/40' : ''}`}
                            title={onSegment !== null
                                ? `${prettyGroupLabel(row.label)}: ${row.value.toLocaleString()} — ${__('click para ver los registros')}`
                                : `${prettyGroupLabel(row.label)}: ${row.value.toLocaleString()} (${sharePct.toFixed(1)}%)`}
                            onClick={onSegment !== null ? () => onSegment(row.label) : undefined}
                        >
                            <span className="imcrm-w-28 imcrm-shrink-0 imcrm-truncate imcrm-text-muted-foreground">
                                {prettyGroupLabel(row.label)}
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
                            <span className="imcrm-w-16 imcrm-shrink-0 imcrm-text-right imcrm-tabular-nums">
                                <span className="imcrm-font-semibold imcrm-text-foreground">
                                    {row.value.toLocaleString()}
                                </span>
                                <span className="imcrm-ml-1 imcrm-text-[10px] imcrm-text-muted-foreground/80">
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
