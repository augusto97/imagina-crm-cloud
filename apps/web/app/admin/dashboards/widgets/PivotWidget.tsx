import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { OTHERS_GROUP_KEY, type PivotData, type WidgetSpec } from '@/types/dashboard';

import { WidgetError } from './WidgetError';
import { buildPivot, heatAlpha, type PivotModel } from './pivotModel';
import { displayGroupLabel, othersAwareLabel, sortChartRows, useGroupLabelMap, useGroupOptionOrder, type ChartSort } from './useChartColors';
import { useSegmentNav, type SegmentNav } from './useSegmentNav';
import { formatMetricValue } from './widgetFormat';
import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

/**
 * v0.1.292 — Tabla dinámica: filas = un campo, columnas = otro, la métrica en
 * cada cruce, con el total de cada fila, de cada columna y el general
 * (calculados por el servidor sobre SUS registros: bien también para
 * promedio, mín/máx o únicos). Mapa de calor opcional en un solo tono (el
 * primario, con transparencia: legible en claro y en oscuro). Scroll propio
 * con la cabecera y la primera columna fijas. Click en una celda → la lista
 * filtrada por la fila Y la columna.
 */
export function PivotWidget({ dashboardId, widget }: { dashboardId: number; widget: WidgetSpec }): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const subtitle = useWidgetSubtitle(widget);
    const onCell = useSegmentNav(widget);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const metric = typeof widget.config.metric === 'string' ? widget.config.metric : 'count';
    const metricField = fields.data?.find((f) => f.id === widget.config.metric_field_id);
    const fmt = (v: number | string): string => formatMetricValue(v, metric, metricField);
    const rowFieldId = typeof widget.config.group_by_field_id === 'number' ? widget.config.group_by_field_id : undefined;
    const colFieldId = typeof widget.config.sub_group_by_field_id === 'number' ? widget.config.sub_group_by_field_id : undefined;
    const pivot = data.data && 'pivot' in data.data ? (data.data.pivot as PivotData) : null;
    const rowLabels = useGroupLabelMap(widget.list_id, rowFieldId, pivot?.rows.map((r) => r.key) ?? []);
    const colLabels = useGroupLabelMap(widget.list_id, colFieldId, pivot?.cols.map((c) => c.key) ?? []);
    const rowOrder = useGroupOptionOrder(widget.list_id, rowFieldId);
    const colOrder = useGroupOptionOrder(widget.list_id, colFieldId);
    const rowField = fields.data?.find((f) => f.id === rowFieldId);
    const colField = fields.data?.find((f) => f.id === colFieldId);
    const chrono = (t: string | undefined): boolean => t === 'date' || t === 'datetime';

    const model = useMemo<PivotModel | null>(() => {
        if (pivot === null) return null;
        return buildPivot(pivot, {
            rowLabel: (k, o) => othersAwareLabel({ label: k, others: o }, rowLabels),
            colLabel: (k, o) => othersAwareLabel({ label: k, others: o }, colLabels),
            sortRows: chrono(rowField?.type)
                ? undefined
                : (rows) => sortChartRows(rows, widget.config.sort as ChartSort | undefined, rowOrder, (l) => displayGroupLabel(l, rowLabels)),
            sortCols: chrono(colField?.type)
                ? undefined
                : (cols) => sortChartRows(cols, widget.config.col_sort as ChartSort | undefined, colOrder, (l) => displayGroupLabel(l, colLabels)),
        });
    }, [pivot, rowLabels, colLabels, rowOrder, colOrder, rowField?.type, colField?.type, widget.config.sort, widget.config.col_sort]);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col imcrm-gap-3">
            <WidgetHeader title={widget.title || __('Tabla dinámica')} subtitle={subtitle} />
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <WidgetError error={data.error} />
                ) : model !== null && model.rows.length > 0 ? (
                    <PivotTable
                        model={model}
                        format={fmt}
                        heatmap={widget.config.heatmap === true}
                        totals={widget.config.show_totals !== false}
                        rowHeader={rowField?.label ?? ''}
                        onCell={onCell}
                    />
                ) : (
                    <p className="imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">{__('Sin datos.')}</p>
                )}
                {pivot?.hidden_cells ? (
                    <p className="imcrm-mt-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                        {sprintf(__('Hay %d cruces más que no entran: acota el período o los filtros.'), pivot.hidden_cells)}
                    </p>
                ) : null}
            </div>
        </div>
    );
}

function PivotTable({
    model,
    format,
    heatmap,
    totals,
    rowHeader,
    onCell,
}: {
    model: PivotModel;
    format: (v: number | string) => string;
    heatmap: boolean;
    totals: boolean;
    rowHeader: string;
    onCell: SegmentNav | null;
}): JSX.Element {
    const cellText = (v: number | string | null): string => (v === null ? '—' : format(v));
    return (
        <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-auto imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="imcrm-pivot">
            <table className="imcrm-w-max imcrm-min-w-full imcrm-border-separate imcrm-border-spacing-0 imcrm-text-[12px]">
                <thead>
                    <tr>
                        <th
                            scope="col"
                            className="imcrm-sticky imcrm-left-0 imcrm-top-0 imcrm-z-[3] imcrm-border-b imcrm-border-r imcrm-border-border imcrm-bg-canvas imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground"
                        >
                            {rowHeader}
                        </th>
                        {model.cols.map((c) => (
                            <th
                                key={c.key}
                                scope="col"
                                title={c.label}
                                className="imcrm-sticky imcrm-top-0 imcrm-z-[2] imcrm-max-w-[10rem] imcrm-truncate imcrm-whitespace-nowrap imcrm-border-b imcrm-border-border imcrm-bg-canvas imcrm-px-2.5 imcrm-py-1.5 imcrm-text-right imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground"
                            >
                                {c.label}
                            </th>
                        ))}
                        {totals && (
                            <th scope="col" className="imcrm-sticky imcrm-top-0 imcrm-z-[2] imcrm-whitespace-nowrap imcrm-border-b imcrm-border-l imcrm-border-border imcrm-bg-canvas imcrm-px-2.5 imcrm-py-1.5 imcrm-text-right imcrm-text-[11px] imcrm-font-semibold imcrm-text-foreground">
                                {__('Total')}
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {model.rows.map((r) => (
                        <tr key={r.key} className="hover:imcrm-bg-accent/30">
                            <th
                                scope="row"
                                title={r.label}
                                className="imcrm-sticky imcrm-left-0 imcrm-z-[1] imcrm-max-w-[12rem] imcrm-truncate imcrm-whitespace-nowrap imcrm-border-b imcrm-border-r imcrm-border-border/60 imcrm-bg-card imcrm-px-2.5 imcrm-py-1 imcrm-text-left imcrm-font-medium imcrm-text-foreground"
                            >
                                {r.label}
                            </th>
                            {model.cols.map((c) => {
                                const v = model.cell(r.key, c.key);
                                const num = typeof v === 'number' ? v : null;
                                const navigable = onCell !== null && v !== null && r.key !== OTHERS_GROUP_KEY && c.key !== OTHERS_GROUP_KEY;
                                const alpha = heatmap && num !== null ? heatAlpha(num, model.min, model.max) : 0;
                                return (
                                    <td
                                        key={c.key}
                                        data-testid="imcrm-pivot-cell"
                                        data-row={r.key}
                                        data-col={c.key}
                                        title={`${r.label} · ${c.label}: ${cellText(v)}`}
                                        onClick={navigable && onCell !== null ? () => onCell(r.key, c.key) : undefined}
                                        className={cn(
                                            'imcrm-whitespace-nowrap imcrm-border-b imcrm-border-border/60 imcrm-px-2.5 imcrm-py-1 imcrm-text-right imcrm-tabular-nums',
                                            v === null ? 'imcrm-text-muted-foreground/60' : 'imcrm-text-foreground',
                                            navigable && 'imcrm-cursor-pointer hover:imcrm-underline',
                                            alpha >= 0.36 && 'imcrm-font-semibold',
                                        )}
                                        style={alpha > 0 ? { backgroundColor: `hsl(var(--imcrm-primary) / ${alpha.toFixed(2)})` } : undefined}
                                    >
                                        {cellText(v)}
                                    </td>
                                );
                            })}
                            {totals && (
                                <td className="imcrm-whitespace-nowrap imcrm-border-b imcrm-border-l imcrm-border-border/60 imcrm-bg-muted/30 imcrm-px-2.5 imcrm-py-1 imcrm-text-right imcrm-font-semibold imcrm-tabular-nums" data-testid="imcrm-pivot-row-total">
                                    {cellText(r.total)}
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
                {totals && (
                    <tfoot>
                        <tr>
                            <th scope="row" className="imcrm-sticky imcrm-bottom-0 imcrm-left-0 imcrm-z-[3] imcrm-border-r imcrm-border-t imcrm-border-border imcrm-bg-muted imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-font-semibold">
                                {__('Total')}
                            </th>
                            {model.cols.map((c) => (
                                <td key={c.key} className="imcrm-sticky imcrm-bottom-0 imcrm-z-[2] imcrm-whitespace-nowrap imcrm-border-t imcrm-border-border imcrm-bg-muted imcrm-px-2.5 imcrm-py-1.5 imcrm-text-right imcrm-font-semibold imcrm-tabular-nums" data-testid="imcrm-pivot-col-total">
                                    {cellText(c.total)}
                                </td>
                            ))}
                            <td className="imcrm-sticky imcrm-bottom-0 imcrm-z-[2] imcrm-whitespace-nowrap imcrm-border-l imcrm-border-t imcrm-border-border imcrm-bg-muted imcrm-px-2.5 imcrm-py-1.5 imcrm-text-right imcrm-font-bold imcrm-tabular-nums" data-testid="imcrm-pivot-total">
                                {cellText(model.total)}
                            </td>
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
    );
}
