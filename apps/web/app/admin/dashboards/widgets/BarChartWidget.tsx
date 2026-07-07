import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

import { categoryColor, useGroupColorMap } from './useChartColors';

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
 * Toggles del widget config:
 *  - `show_average_line` → línea vertical punteada en el promedio
 *  - `show_data_labels`  → siempre mostramos el valor numérico, ya
 *                          es parte del layout base (no aplica acá)
 */
export function BarChartWidget({ dashboardId, widget }: BarChartWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const showAvg = Boolean(widget.config.show_average_line);
    const colorMap = useGroupColorMap(widget.list_id, widget.config.group_by_field_id);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-3">
            <header>
                <h3 className="imcrm-text-[11px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">
                    {widget.title || __('Distribución')}
                </h3>
            </header>

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
                ) : data.data && 'data' in data.data && data.data.data.length > 0 ? (
                    <BarRows
                        rows={data.data.data.map((r) => ({ label: r.label, value: toNumber(r.value) }))}
                        showAvg={showAvg}
                        colorMap={colorMap}
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
}: {
    rows: Array<{ label: string; value: number }>;
    showAvg: boolean;
    colorMap: Map<string, string>;
}): JSX.Element {
    const max = Math.max(...rows.map((r) => r.value), 1);
    const total = rows.reduce((sum, r) => sum + r.value, 0) || 1;
    const avg = total / rows.length;
    const avgPct = (avg / max) * 100;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            {showAvg && (
                <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-text-[10px] imcrm-text-muted-foreground">
                    {__('Promedio')}: <span className="imcrm-ml-1 imcrm-font-medium imcrm-text-foreground">{avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
            )}
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {rows.map((row, i) => {
                    const pct = (row.value / max) * 100;
                    const sharePct = (row.value / total) * 100;
                    const color = categoryColor(colorMap, row.label, i);
                    return (
                        <li
                            key={row.label}
                            className="imcrm-group/bar imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-text-xs"
                            title={`${row.label}: ${row.value.toLocaleString()} (${sharePct.toFixed(1)}%)`}
                        >
                            <span className="imcrm-w-28 imcrm-shrink-0 imcrm-truncate imcrm-text-muted-foreground">
                                {row.label}
                            </span>
                            <div className="imcrm-relative imcrm-h-5 imcrm-flex-1 imcrm-overflow-hidden imcrm-rounded imcrm-bg-muted/40">
                                <div
                                    className="imcrm-absolute imcrm-inset-y-0 imcrm-left-0 imcrm-rounded imcrm-opacity-80 imcrm-transition-opacity group-hover/bar:imcrm-opacity-100"
                                    style={{ width: `${pct}%`, backgroundColor: color }}
                                    aria-hidden
                                />
                                {showAvg && (
                                    <div
                                        className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-y-0 imcrm-w-px imcrm-border-l imcrm-border-dashed imcrm-border-destructive"
                                        style={{ left: `${avgPct}%` }}
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
