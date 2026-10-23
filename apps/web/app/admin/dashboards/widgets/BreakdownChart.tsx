import { useMemo, useRef, useState } from 'react';

import { asDisplayField } from '@/lib/fieldTypeCatalog';
import { useFields } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';

import {
    buildBreakdown,
    groupStackSum,
    segmentFraction,
    type BreakdownModel,
    type BreakdownPayload,
    type ChartGroup,
    type ChartSeries,
} from './breakdownModel';
import {
    categoryColor,
    displayGroupLabel,
    othersAwareLabel,
    sortChartRows,
    useGroupColorMap,
    useGroupLabelMap,
    useGroupOptionOrder,
    type ChartSort,
} from './useChartColors';
import type { SegmentNav } from './useSegmentNav';

/**
 * v0.1.292 — El modelo de un gráfico desglosado con las etiquetas y los
 * colores REALES: las series toman el color de la opción del campo por el que
 * se desglosa (el mismo de la tabla y el kanban), y las etiquetas de opciones,
 * personas, buckets de fecha y casillas como en el resto de los gráficos.
 */
export function useBreakdownModel(widget: WidgetSpec, payload: BreakdownPayload | null): BreakdownModel {
    const groupFieldId = widget.config.group_by_field_id ?? widget.config.date_field_id;
    const subFieldId = typeof widget.config.sub_group_by_field_id === 'number' ? widget.config.sub_group_by_field_id : undefined;
    const groupKeys = payload?.data.map((r) => r.label) ?? [];
    const seriesKeys = payload?.series?.map((s) => s.key) ?? [];
    const groupLabels = useGroupLabelMap(widget.list_id, groupFieldId, groupKeys);
    const seriesLabels = useGroupLabelMap(widget.list_id, subFieldId, seriesKeys);
    const seriesColors = useGroupColorMap(widget.list_id, subFieldId);
    const seriesOrder = useGroupOptionOrder(widget.list_id, subFieldId);
    const groupOrder = useGroupOptionOrder(widget.list_id, groupFieldId);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const rawGroupField = fields.data?.find((f) => f.id === groupFieldId);
    const groupField = rawGroupField ? asDisplayField(rawGroupField) : undefined;
    const chronological = groupField?.type === 'date' || groupField?.type === 'datetime';
    const sort = widget.config.sort as ChartSort | undefined;
    const hideZero = widget.config.hide_zero_groups === true;
    return useMemo(
        () =>
            payload === null
                ? { groups: [], series: [], maxValue: 0, maxStack: 0 }
                : buildBreakdown(payload, {
                      groupLabel: (key, others) => othersAwareLabel({ label: key, others }, groupLabels),
                      seriesLabel: (key, others) => othersAwareLabel({ label: key, others }, seriesLabels),
                      // «Sin valor» en un gris neutro: con el color de la paleta
                      // se confundía con la opción que tuviera ese mismo color.
                      seriesColor: (key, i) => (key === '(sin valor)' ? 'hsl(var(--imcrm-opt-slate) / 0.55)' : categoryColor(seriesColors, key, i)),
                      seriesOptionOrder: seriesOrder,
                      sortGroups: chronological
                          ? undefined
                          : (rows) => sortChartRows(rows, sort, groupOrder, (l) => displayGroupLabel(l, groupLabels)),
                      hideZero,
                  }),
        [payload, groupLabels, seriesLabels, seriesColors, seriesOrder, groupOrder, chronological, sort, hideZero],
    );
}

interface HoverState {
    group: number;
    x: number;
    y: number;
}

/**
 * Barras desglosadas: horizontales (una fila por grupo) o verticales (una
 * columna por grupo), con las series apiladas (también al 100 %) o lado a
 * lado. Al pasar el mouse por un grupo, un recuadro con el desglose completo;
 * click en un segmento abre la lista filtrada por el grupo Y la serie.
 */
export function BreakdownBars({
    model,
    orientation,
    mode,
    percent,
    format,
    onSegment,
    showLegend,
}: {
    model: BreakdownModel;
    orientation: 'horizontal' | 'vertical';
    mode: 'stacked' | 'grouped';
    percent: boolean;
    format: (n: number) => string;
    onSegment: SegmentNav | null;
    showLegend: boolean;
}): JSX.Element {
    const boxRef = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<HoverState | null>(null);
    const track = (e: React.MouseEvent, index: number): void => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        setHover({ group: index, x: e.clientX - box.left, y: e.clientY - box.top });
    };
    const clickable = (g: ChartGroup, s: ChartSeries): boolean => onSegment !== null && g.navigable && s.navigable;
    const segTitle = (g: ChartGroup, s: ChartSeries, v: number): string => {
        const sum = groupStackSum(g);
        const share = sum > 0 && mode === 'stacked' ? ` (${Math.round((v / sum) * 100)}%)` : '';
        return `${g.label} · ${s.label}: ${format(v)}${share}`;
    };

    const segmentProps = (g: ChartGroup, s: ChartSeries, v: number) => ({
        'data-testid': 'imcrm-chart-segment',
        'data-series': s.key,
        'data-group': g.key,
        title: segTitle(g, s, v),
        role: clickable(g, s) ? 'button' : undefined,
        tabIndex: clickable(g, s) ? 0 : undefined,
        onClick: clickable(g, s) && onSegment !== null ? () => onSegment(g.key, s.key) : undefined,
        onKeyDown: clickable(g, s) && onSegment !== null
            ? (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSegment(g.key, s.key);
                  }
              }
            : undefined,
    });

    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2">
            {showLegend && <SeriesLegend series={model.series} format={format} />}
            <div
                ref={boxRef}
                className={cn(
                    'imcrm-relative imcrm-min-h-0 imcrm-flex-1',
                    orientation === 'horizontal' ? 'imcrm-overflow-y-auto' : 'imcrm-overflow-x-auto',
                )}
                onMouseLeave={() => setHover(null)}
            >
                {orientation === 'horizontal' ? (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-breakdown-bars">
                        {model.groups.map((g, gi) => (
                            <li
                                key={g.key}
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs"
                                onMouseMove={(e) => track(e, gi)}
                            >
                                <span className="imcrm-w-28 imcrm-shrink-0 imcrm-truncate imcrm-text-muted-foreground" title={g.label}>
                                    {g.label}
                                </span>
                                {mode === 'stacked' ? (
                                    <div className="imcrm-flex imcrm-h-5 imcrm-flex-1 imcrm-overflow-hidden imcrm-rounded imcrm-bg-muted/40">
                                        {model.series.map((s) => {
                                            const v = g.values.get(s.key) ?? 0;
                                            if (v <= 0) return null;
                                            return (
                                                <div
                                                    key={s.key}
                                                    {...segmentProps(g, s, v)}
                                                    className={cn('imcrm-h-full imcrm-opacity-90 hover:imcrm-opacity-100', clickable(g, s) && 'imcrm-cursor-pointer')}
                                                    style={{ width: `${segmentFraction(g, v, model, 'stacked', percent) * 100}%`, backgroundColor: s.color }}
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-px">
                                        {model.series.map((s) => {
                                            const v = g.values.get(s.key) ?? 0;
                                            return (
                                                <div key={s.key} className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-sm imcrm-bg-muted/30">
                                                    <div
                                                        {...segmentProps(g, s, v)}
                                                        className={cn('imcrm-h-full imcrm-rounded-sm', clickable(g, s) && 'imcrm-cursor-pointer')}
                                                        style={{ width: `${segmentFraction(g, v, model, 'grouped', false) * 100}%`, backgroundColor: s.color }}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                <span className="imcrm-w-[7ch] imcrm-shrink-0 imcrm-text-right imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">
                                    {format(g.total)}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <VerticalBreakdown
                        model={model}
                        mode={mode}
                        percent={percent}
                        segmentProps={segmentProps}
                        clickable={clickable}
                        onHover={track}
                        format={format}
                    />
                )}
                {hover !== null && model.groups[hover.group] && (
                    <BreakdownTooltip
                        group={model.groups[hover.group]!}
                        series={model.series}
                        format={format}
                        mode={mode}
                        x={hover.x}
                        y={hover.y}
                        boxWidth={boxRef.current?.clientWidth ?? 0}
                    />
                )}
            </div>
        </div>
    );
}

function VerticalBreakdown({
    model,
    mode,
    percent,
    segmentProps,
    clickable,
    onHover,
    format,
}: {
    model: BreakdownModel;
    mode: 'stacked' | 'grouped';
    percent: boolean;
    segmentProps: (g: ChartGroup, s: ChartSeries, v: number) => Record<string, unknown>;
    clickable: (g: ChartGroup, s: ChartSeries) => boolean;
    onHover: (e: React.MouseEvent, index: number) => void;
    format: (n: number) => string;
}): JSX.Element {
    // Columnas de al menos 28 px: con muchos grupos, scroll horizontal.
    const minColumn = mode === 'grouped' ? Math.max(28, model.series.length * 8 + 8) : 28;
    return (
        <div
            className="imcrm-flex imcrm-h-full imcrm-min-h-[8rem] imcrm-items-stretch imcrm-gap-1.5"
            style={{ minWidth: model.groups.length * (minColumn + 6) }}
            data-testid="imcrm-breakdown-columns"
        >
            {model.groups.map((g, gi) => (
                <div
                    key={g.key}
                    className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-items-stretch imcrm-gap-1"
                    style={{ minWidth: minColumn }}
                    onMouseMove={(e) => onHover(e, gi)}
                >
                    <span className="imcrm-truncate imcrm-text-center imcrm-text-[10px] imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground">
                        {format(g.total)}
                    </span>
                    {mode === 'stacked' ? (
                        <div className="imcrm-relative imcrm-flex imcrm-flex-1 imcrm-flex-col-reverse imcrm-overflow-hidden imcrm-rounded-t imcrm-bg-muted/30">
                            {model.series.map((s) => {
                                const v = g.values.get(s.key) ?? 0;
                                if (v <= 0) return null;
                                return (
                                    <div
                                        key={s.key}
                                        {...segmentProps(g, s, v)}
                                        className={cn('imcrm-w-full imcrm-opacity-90 hover:imcrm-opacity-100', clickable(g, s) && 'imcrm-cursor-pointer')}
                                        style={{ height: `${segmentFraction(g, v, model, 'stacked', percent) * 100}%`, backgroundColor: s.color }}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="imcrm-flex imcrm-flex-1 imcrm-items-end imcrm-gap-px imcrm-rounded-t imcrm-bg-muted/20">
                            {model.series.map((s) => {
                                const v = g.values.get(s.key) ?? 0;
                                return (
                                    <div
                                        key={s.key}
                                        {...segmentProps(g, s, v)}
                                        className={cn('imcrm-min-w-[3px] imcrm-flex-1 imcrm-rounded-t-sm', clickable(g, s) && 'imcrm-cursor-pointer')}
                                        style={{ height: `${segmentFraction(g, v, model, 'grouped', false) * 100}%`, backgroundColor: s.color }}
                                    />
                                );
                            })}
                        </div>
                    )}
                    <span className="imcrm-truncate imcrm-text-center imcrm-text-[10px] imcrm-text-muted-foreground" title={g.label}>
                        {g.label}
                    </span>
                </div>
            ))}
        </div>
    );
}

/** Leyenda de las series: el color real de cada opción y su total. */
export function SeriesLegend({ series, format }: { series: ChartSeries[]; format: (n: number) => string }): JSX.Element | null {
    if (series.length === 0) return null;
    return (
        <ul className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-1 imcrm-text-[11px]" data-testid="imcrm-series-legend">
            {series.map((s) => (
                <li key={s.key} className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5" title={`${s.label}: ${format(s.total)}`}>
                    <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-shrink-0 imcrm-rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
                    <span className="imcrm-max-w-[12rem] imcrm-truncate imcrm-text-muted-foreground">{s.label}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * Recuadro con el desglose de UN grupo (al pasar el mouse): cada serie con su
 * color, su valor y su parte del total; al pie, el total del grupo.
 */
export function BreakdownTooltip({
    group,
    series,
    format,
    mode,
    x,
    y,
    boxWidth,
}: {
    group: ChartGroup;
    series: ChartSeries[];
    format: (n: number) => string;
    mode: 'stacked' | 'grouped';
    x: number;
    y: number;
    boxWidth: number;
}): JSX.Element {
    const sum = groupStackSum(group);
    const rows = series.filter((s) => (group.values.get(s.key) ?? 0) !== 0);
    // Del lado del cursor donde haya lugar.
    const left = boxWidth > 0 && x > boxWidth / 2 ? undefined : x + 12;
    const right = boxWidth > 0 && x > boxWidth / 2 ? boxWidth - x + 12 : undefined;
    return (
        <div
            role="tooltip"
            data-testid="imcrm-breakdown-tooltip"
            className="imcrm-pointer-events-none imcrm-absolute imcrm-z-20 imcrm-w-max imcrm-max-w-[16rem] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-2 imcrm-text-[11px] imcrm-text-popover-foreground imcrm-shadow-imcrm-md"
            style={{ left, right, top: Math.max(0, y - 8) }}
        >
            <p className="imcrm-mb-1 imcrm-truncate imcrm-font-semibold">{group.label}</p>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                {rows.length === 0 && <li className="imcrm-text-muted-foreground">{__('Sin datos.')}</li>}
                {rows.map((s) => {
                    const v = group.values.get(s.key) ?? 0;
                    return (
                        <li key={s.key} className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            <span className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{s.label}</span>
                            <span className="imcrm-font-semibold imcrm-tabular-nums">{format(v)}</span>
                            {mode === 'stacked' && sum > 0 && (
                                <span className="imcrm-w-[4ch] imcrm-text-right imcrm-tabular-nums imcrm-text-muted-foreground">{Math.round((v / sum) * 100)}%</span>
                            )}
                        </li>
                    );
                })}
            </ul>
            <p className="imcrm-mt-1 imcrm-flex imcrm-justify-between imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-1">
                <span className="imcrm-text-muted-foreground">{__('Total')}</span>
                <span className="imcrm-font-semibold imcrm-tabular-nums">{format(group.total)}</span>
            </p>
        </div>
    );
}
