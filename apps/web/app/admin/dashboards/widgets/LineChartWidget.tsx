import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import { OTHERS_GROUP_KEY, type WidgetSpec } from '@/types/dashboard';

import { WidgetError } from './WidgetError';
import { formatBucketLabel, formatMetricValue } from './widgetFormat';
import { AverageBadge, AVG_LINE_COLOR, useWidgetSubtitle, WidgetHeader } from './WidgetHeader';
import { useBreakdownModel } from './BreakdownChart';
import { BreakdownLines } from './BreakdownLines';
import type { BreakdownPayload } from './breakdownModel';
import { useChartTip } from './ChartTip';
import { useSegmentNav } from './useSegmentNav';
import { useElementSize } from './useElementSize';
import { CompareBadge, compareLegendText } from './CompareParts';
import {
    deltaView,
    diffText,
    isAdditiveMetric,
    isReadyCompare,
    comparedPoints,
    toneClass,
    trendTotals,
    widgetCompareOf,
    type ComparedPoint,
    type ReadyCompare,
} from './compareView';

interface LineChartWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
    /** Si `true`, dibuja un area fill bajo la línea (variant chart_area). */
    area?: boolean;
}

/**
 * Line / area chart minimalista con SVG vanilla. El backend agrupa por
 * la granularidad del config (`time_bucket`); cada punto es un bucket.
 *
 * 0.57.39 — el SVG usa las dimensiones REALES del contenedor (medidas
 * con ResizeObserver) en lugar de `preserveAspectRatio="none"` sobre un
 * viewBox fijo. Antes los puntos se estiraban a elipses y los textos se
 * deformaban al agrandar el widget. Además: grid lines horizontales
 * sutiles con valores de referencia, y el id del gradiente del area es
 * único por widget (antes dos area charts en el mismo dashboard
 * colisionaban en `#imcrm-area-grad` — el segundo quedaba sin fill).
 *
 * Estilo ClickUp: badge "Promedio: N" arriba a la derecha del header +
 * línea de referencia horizontal punteada ROJA en el promedio.
 * Default ON; `show_average_line: false` explícito lo apaga.
 *
 * Toggles del widget:
 *  - `show_average_line` → promedio en header + línea punteada (default on)
 *  - `show_data_labels`  → valor numérico encima de cada punto
 */
export function LineChartWidget({ dashboardId, widget, area }: LineChartWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const showAvg = widget.config.show_average_line !== false;
    const showLabels = Boolean(widget.config.show_data_labels);
    const subtitle = useWidgetSubtitle(widget);
    // v0.1.286 — valores según el campo medido y buckets legibles
    // ("oct 2026", "Sem 43 · 2026", "T3 2026") en vez de "2026-10".
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const metricField = fields.data?.find((f) => f.id === widget.config.metric_field_id);
    const metric = typeof widget.config.metric === 'string' ? widget.config.metric : 'count';
    const fmt = (n: number): string => formatMetricValue(n, metric, metricField);

    const rows =
        data.data && 'data' in data.data
            ? data.data.data
                  // v0.1.252 — los registros SIN fecha no son un punto del
                  // tiempo: dibujarlos al final deformaba la tendencia.
                  .filter((r) => r.label !== '(sin valor)' && r.label !== OTHERS_GROUP_KEY)
                  .map((r) => ({ label: r.label, value: typeof r.value === 'number' ? r.value : Date.parse(r.value) || 0 }))
            : [];
    const avg = rows.length > 0 ? rows.reduce((s, r) => s + r.value, 0) / rows.length : null;
    // v0.1.292 — con "Desglosar por": una serie por valor del segundo campo,
    // apiladas (también al 100 %) o superpuestas.
    const payload = data.data && 'data' in data.data && Array.isArray(data.data.series)
        ? ({ ...data.data, data: data.data.data.filter((r) => r.label !== OTHERS_GROUP_KEY) } as BreakdownPayload)
        : null;
    const breakdown = useBreakdownModel(widget, payload);
    const onSegment = useSegmentNav(widget);
    // v0.1.462 — «Comparar con…»: la serie de antes, punteada.
    const compare = widgetCompareOf(data.data);
    const ready = isReadyCompare(compare) ? compare : null;
    const compared = ready ? comparedPoints(ready, rows) : null;
    const compareTotal = compared && isAdditiveMetric(metric) ? trendTotals(compared.map((p) => ({ label: p.label, prev_label: p.prevLabel, value: p.value, previous: p.previous }))) : null;

    if (payload !== null) {
        const stacked = widget.config.stack_mode !== 'grouped';
        // Los registros sin fecha no son un punto del tiempo.
        const model = { ...breakdown, groups: breakdown.groups.filter((g) => g.key !== '(sin valor)') };
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-2 imcrm-min-h-0">
                <WidgetHeader title={widget.title || __('Tendencia mensual')} subtitle={subtitle} right={<CompareBadge compare={compare} />} />
                {data.isError ? (
                    <WidgetError error={data.error} />
                ) : model.groups.length > 0 ? (
                    <BreakdownLines
                        model={model}
                        area={area ?? false}
                        mode={stacked ? 'stacked' : 'grouped'}
                        percent={stacked && widget.config.stack_percent === true}
                        format={fmt}
                        onSegment={onSegment}
                        showLegend={widget.config.show_legend !== false}
                    />
                ) : (
                    <p className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-text-xs imcrm-text-muted-foreground">{__('Sin datos.')}</p>
                )}
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-2 imcrm-min-h-0">
            <WidgetHeader
                title={widget.title || __('Tendencia mensual')}
                subtitle={subtitle}
                right={
                    compare ? (
                        <CompareBadge compare={compare} total={compareTotal} format={fmt} />
                    ) : showAvg && avg !== null ? (
                        <AverageBadge value={avg} format={fmt} />
                    ) : null
                }
            />

            <div className="imcrm-flex imcrm-flex-1 imcrm-items-stretch imcrm-justify-center imcrm-min-h-0">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <WidgetError error={data.error} />
                ) : ready && compared && compared.length > 0 ? (
                    <ComparedSparkLine points={compared} area={area ?? false} showLabels={showLabels} format={fmt} compare={ready} />
                ) : rows.length > 0 ? (
                    <SparkLine
                        rows={rows}
                        area={area ?? false}
                        showAvg={showAvg}
                        showLabels={showLabels}
                        format={fmt}
                    />
                ) : (
                    <p className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-text-xs imcrm-text-muted-foreground">{__('Sin datos.')}</p>
                )}
            </div>
        </div>
    );
}

const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 6;

function SparkLine({
    rows,
    area,
    showAvg,
    showLabels,
    format,
}: {
    rows: Array<{ label: string; value: number }>;
    area: boolean;
    showAvg: boolean;
    showLabels: boolean;
    format: (n: number) => string;
}): JSX.Element {
    const { ref, width, height } = useElementSize();
    // Id único por instancia — dos area charts en el mismo dashboard no
    // pueden compartir el id del gradiente (el <defs> del primero en el
    // DOM gana y el segundo puede quedar sin fill si se desmonta).
    const gradId = useId().replace(/:/g, '');
    // v0.1.474 — recuadro al instante + línea vertical en el punto (antes,
    // un `<title>` sobre un círculo de 3 px: tardaba y casi no se acertaba).
    const tip = useChartTip();
    const [hover, setHover] = useState<number | null>(null);

    const max = Math.max(...rows.map((r) => r.value), 1);
    const min = 0;
    const avg = rows.reduce((s, r) => s + r.value, 0) / rows.length;

    const innerW = Math.max(width - PAD_X * 2, 0);
    const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 0);

    const yFor = (value: number): number =>
        PAD_TOP + innerH - ((value - min) / (max - min || 1)) * innerH;

    const points = rows.map((row, i) => {
        const x =
            rows.length === 1
                ? PAD_X + innerW / 2
                : PAD_X + (i / (rows.length - 1)) * innerW;
        return { x, y: yFor(row.value), ...row };
    });

    const polylinePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const baseY = PAD_TOP + innerH;
    const areaPath =
        points.length > 0
            ? `M ${points[0]!.x.toFixed(1)},${baseY.toFixed(1)} L ${polylinePoints} L ${points[points.length - 1]!.x.toFixed(1)},${baseY.toFixed(1)} Z`
            : '';

    // Grid lines: 25% / 50% / 75% del rango. Sutiles, estilo Linear.
    const gridFractions = [0.25, 0.5, 0.75];

    return (
        <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-1 imcrm-min-h-0">
            <div ref={ref} className="imcrm-relative imcrm-w-full imcrm-flex-1 imcrm-min-h-0">
                {width > 0 && height > 0 && (
                    <svg
                        width={width}
                        height={height}
                        viewBox={`0 0 ${width} ${height}`}
                        className="imcrm-absolute imcrm-inset-0"
                        role="img"
                        aria-label={__('Tendencia')}
                    >
                        <defs>
                            <linearGradient id={`imcrm-area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--imcrm-primary))" stopOpacity="0.30" />
                                <stop offset="100%" stopColor="hsl(var(--imcrm-primary))" stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        {/* Grid lines de referencia + valor máx a la derecha. */}
                        {gridFractions.map((f) => {
                            const v = min + (max - min) * f;
                            return (
                                <line
                                    key={f}
                                    x1={PAD_X}
                                    x2={width - PAD_X}
                                    y1={yFor(v)}
                                    y2={yFor(v)}
                                    stroke="hsl(var(--imcrm-border))"
                                    strokeWidth="1"
                                    opacity="0.45"
                                />
                            );
                        })}
                        <text
                            x={width - PAD_X}
                            y={PAD_TOP - 3}
                            textAnchor="end"
                            className="imcrm-fill-muted-foreground"
                            style={{ fontSize: 9 }}
                        >
                            {format(max)}
                        </text>

                        {area && areaPath !== '' && <path d={areaPath} fill={`url(#imcrm-area-${gradId})`} />}
                        {showAvg && (
                            // Línea de referencia del promedio — punteada y
                            // roja (paridad ClickUp).
                            <line
                                x1={PAD_X}
                                x2={width - PAD_X}
                                y1={yFor(avg)}
                                y2={yFor(avg)}
                                stroke={AVG_LINE_COLOR}
                                strokeWidth="1"
                                strokeDasharray="6 4"
                                opacity="0.85"
                            />
                        )}
                        <polyline
                            points={polylinePoints}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="imcrm-text-primary"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                        {hover !== null && points[hover] && (
                            <line x1={points[hover]!.x} x2={points[hover]!.x} y1={PAD_TOP} y2={baseY} stroke="hsl(var(--imcrm-border))" strokeWidth="1" />
                        )}
                        {points.map((p, i) => (
                            <circle
                                key={p.label}
                                cx={p.x}
                                cy={p.y}
                                r={hover === i ? 4.5 : 3}
                                className="imcrm-fill-primary"
                                stroke="hsl(var(--imcrm-card))"
                                strokeWidth="1.5"
                            />
                        ))}
                        {showLabels && points.map((p) => (
                            <text
                                key={`label-${p.label}`}
                                x={p.x}
                                y={p.y - 7}
                                textAnchor="middle"
                                className="imcrm-fill-foreground"
                                style={{ fontSize: 10, fontWeight: 600 }}
                            >
                                {format(p.value)}
                            </text>
                        ))}
                        {/* Zonas anchas para pasar el mouse o tocar cada punto. */}
                        {points.map((p, i) => {
                            const step = points.length > 1 ? innerW / (points.length - 1) : innerW;
                            const h = tip.bind(p.label, () => ({
                                title: formatBucketLabel(p.label),
                                rows: [{ value: format(p.value) }],
                            }));
                            return (
                                <rect
                                    key={`h-${p.label}`}
                                    x={Math.max(0, p.x - step / 2)}
                                    y={0}
                                    width={Math.max(step, 8)}
                                    height={height}
                                    fill="transparent"
                                    data-testid="imcrm-line-hit"
                                    {...h}
                                    onPointerEnter={(e) => {
                                        h.onPointerEnter(e);
                                        if (e.pointerType !== 'touch') setHover(i);
                                    }}
                                    onPointerLeave={(e) => {
                                        h.onPointerLeave(e);
                                        if (e.pointerType !== 'touch') setHover((cur) => (cur === i ? null : cur));
                                    }}
                                    onClick={(e) => {
                                        h.onClick(e);
                                        setHover(i);
                                    }}
                                />
                            );
                        })}
                    </svg>
                )}
                {tip.layer}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-justify-between imcrm-text-[10px] imcrm-text-muted-foreground">
                <span>{points[0] ? formatBucketLabel(points[0].label) : null}</span>
                {points.length > 1 && <span>{formatBucketLabel(points[points.length - 1]!.label)}</span>}
            </div>
        </div>
    );
}

function capitalize(t: string): string {
    return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Arma un trazo que se corta donde falta el valor. */
function brokenPath(pts: Array<{ x: number; y: number } | null>): string {
    let d = '';
    let pen = false;
    for (const p of pts) {
        if (!p) {
            pen = false;
            continue;
        }
        d += `${pen ? 'L' : 'M'} ${p.x.toFixed(1)},${p.y.toFixed(1)} `;
        pen = true;
    }
    return d.trim();
}

/**
 * v0.1.462 — La línea de ahora (llena) y la de antes (punteada), alineadas
 * por posición. Al pasar el mouse (o tocar) un punto, los dos valores y la
 * diferencia.
 */
function ComparedSparkLine({
    points,
    area,
    showLabels,
    format,
    compare,
}: {
    points: ComparedPoint[];
    area: boolean;
    showLabels: boolean;
    format: (n: number) => string;
    compare: ReadyCompare;
}): JSX.Element {
    const { ref, width, height } = useElementSize();
    const gradId = useId().replace(/:/g, '');
    const [hover, setHover] = useState<number | null>(null);

    const max = Math.max(...points.flatMap((p) => [p.value ?? 0, p.previous ?? 0]), 1);
    const innerW = Math.max(width - PAD_X * 2, 0);
    const innerH = Math.max(height - PAD_TOP - PAD_BOTTOM, 0);
    const baseY = PAD_TOP + innerH;
    const yFor = (v: number): number => PAD_TOP + innerH - (v / (max || 1)) * innerH;
    const xFor = (i: number): number => (points.length === 1 ? PAD_X + innerW / 2 : PAD_X + (i / (points.length - 1)) * innerW);

    const cur = points.map((p, i) => (p.value === null ? null : { x: xFor(i), y: yFor(p.value) }));
    const prev = points.map((p, i) => (p.previous === null ? null : { x: xFor(i), y: yFor(p.previous) }));
    const curPath = brokenPath(cur);
    const prevPath = brokenPath(prev);
    const curPts = cur.filter((p): p is { x: number; y: number } => p !== null);
    const areaPath = area && curPts.length > 0
        ? `M ${curPts[0]!.x.toFixed(1)},${baseY.toFixed(1)} ${curPts.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L ${curPts[curPts.length - 1]!.x.toFixed(1)},${baseY.toFixed(1)} Z`
        : '';
    const legend = compareLegendText(compare);
    const step = points.length > 1 ? innerW / (points.length - 1) : innerW;
    const shown = hover !== null ? points[hover] : undefined;
    const pointName = (p: ComparedPoint): string =>
        p.label !== null ? formatBucketLabel(p.label) : p.prevLabel !== null ? formatBucketLabel(p.prevLabel) : '—';
    const hoverText = (p: ComparedPoint): { now: string; before: string; delta: ReturnType<typeof deltaView> } => ({
        now: p.value === null ? '—' : format(p.value),
        before: p.previous === null ? '—' : `${format(p.previous)}${p.prevLabel !== null && p.prevLabel !== p.label ? ` (${formatBucketLabel(p.prevLabel)})` : ''}`,
        delta: deltaView(p.value, p.previous, compare.invert === true),
    });
    const first = points[0];
    // El eje dice el período ACTUAL: su último punto se rotula donde está
    // (hoy, o su último dato), no en la punta derecha si el anterior sigue.
    let lastIdx = points.length - 1;
    while (lastIdx > 0 && points[lastIdx]!.label === null) lastIdx--;
    const last = points[lastIdx];
    const lastX = xFor(lastIdx);
    const showLast = points.length > 1 && lastIdx > 0 && lastX > 100;

    return (
        <div className="imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-1 imcrm-min-h-0" data-testid="imcrm-line-compare">
            <div ref={ref} className="imcrm-relative imcrm-w-full imcrm-flex-1 imcrm-min-h-0" onMouseLeave={() => setHover(null)}>
                {width > 0 && height > 0 && (
                    <svg
                        width={width}
                        height={height}
                        viewBox={`0 0 ${width} ${height}`}
                        className="imcrm-absolute imcrm-inset-0"
                        role="img"
                        aria-label={compare.label}
                    >
                        <defs>
                            <linearGradient id={`imcrm-area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--imcrm-primary))" stopOpacity="0.26" />
                                <stop offset="100%" stopColor="hsl(var(--imcrm-primary))" stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        {[0.25, 0.5, 0.75].map((f) => (
                            <line key={f} x1={PAD_X} x2={width - PAD_X} y1={yFor(max * f)} y2={yFor(max * f)} stroke="hsl(var(--imcrm-border))" strokeWidth="1" opacity="0.45" />
                        ))}
                        <text x={width - PAD_X} y={PAD_TOP - 3} textAnchor="end" className="imcrm-fill-muted-foreground" style={{ fontSize: 9 }}>
                            {format(max)}
                        </text>
                        {areaPath !== '' && <path d={areaPath} fill={`url(#imcrm-area-${gradId})`} />}
                        {prevPath !== '' && (
                            <path
                                d={prevPath}
                                fill="none"
                                stroke="hsl(var(--imcrm-muted-foreground))"
                                strokeWidth="1.75"
                                strokeDasharray="5 4"
                                strokeLinecap="round"
                                opacity="0.85"
                                data-testid="imcrm-line-previous"
                            />
                        )}
                        {curPath !== '' && (
                            <path d={curPath} fill="none" stroke="currentColor" strokeWidth="2" className="imcrm-text-primary" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                        {hover !== null && (
                            <line x1={xFor(hover)} x2={xFor(hover)} y1={PAD_TOP} y2={baseY} stroke="hsl(var(--imcrm-border))" strokeWidth="1" />
                        )}
                        {cur.map((p, i) =>
                            p && (points.length <= 40 || hover === i) ? (
                                <circle key={`c-${i}`} cx={p.x} cy={p.y} r={hover === i ? 4 : 2.5} className="imcrm-fill-primary" stroke="hsl(var(--imcrm-card))" strokeWidth="1.5" />
                            ) : null,
                        )}
                        {hover !== null && prev[hover] && (
                            <circle cx={prev[hover]!.x} cy={prev[hover]!.y} r={3.5} fill="hsl(var(--imcrm-card))" stroke="hsl(var(--imcrm-muted-foreground))" strokeWidth="1.5" />
                        )}
                        {showLabels && cur.map((p, i) =>
                            p && points[i]!.value !== null ? (
                                <text key={`l-${i}`} x={p.x} y={p.y - 7} textAnchor="middle" className="imcrm-fill-foreground" style={{ fontSize: 10, fontWeight: 600 }}>
                                    {format(points[i]!.value!)}
                                </text>
                            ) : null,
                        )}
                        {/* Zonas para pasar el mouse o tocar cada punto. */}
                        {points.map((_p, i) => {
                            return (
                                <rect
                                    key={`h-${i}`}
                                    x={Math.max(0, xFor(i) - step / 2)}
                                    y={0}
                                    width={Math.max(step, 6)}
                                    height={height}
                                    fill="transparent"
                                    // Con el dedo, el toque simula un «mouseenter» y después el
                                    // click: con un interruptor se abría y se cerraba solo.
                                    onPointerEnter={(e) => {
                                        if (e.pointerType === 'mouse') setHover(i);
                                    }}
                                    onClick={() => setHover(i)}
                                    data-testid="imcrm-line-compare-hit"
                                />
                            );
                        })}
                    </svg>
                )}
                {shown && hover !== null && (() => {
                    const t = hoverText(shown);
                    const left = Math.min(Math.max(xFor(hover), 70), Math.max(width - 70, 70));
                    return (
                        <div
                            className="imcrm-pointer-events-none imcrm-absolute imcrm-top-1 imcrm-z-10 imcrm--translate-x-1/2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-popover-foreground imcrm-shadow-md"
                            style={{ left }}
                            data-testid="imcrm-line-compare-tooltip"
                        >
                            <div className="imcrm-font-semibold">{pointName(shown)}</div>
                            <div className="imcrm-flex imcrm-justify-between imcrm-gap-3">
                                <span className="imcrm-text-muted-foreground">{__('Ahora')}</span>
                                <span className="imcrm-tabular-nums">{t.now}</span>
                            </div>
                            <div className="imcrm-flex imcrm-justify-between imcrm-gap-3">
                                <span className="imcrm-text-muted-foreground">{__('Antes')}</span>
                                <span className="imcrm-tabular-nums">{t.before}</span>
                            </div>
                            {t.delta && (
                                <div className={`imcrm-text-right imcrm-font-semibold imcrm-tabular-nums ${toneClass(t.delta.tone)}`}>
                                    {sprintf(__('%1$s (%2$s)'), diffText(t.delta.diff, format), t.delta.text)}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
            <div className="imcrm-relative imcrm-h-3.5 imcrm-shrink-0 imcrm-text-[10px] imcrm-text-muted-foreground" data-testid="imcrm-line-compare-axis">
                <span className="imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-whitespace-nowrap">{first ? pointName(first) : null}</span>
                {showLast && last && (
                    <span
                        className="imcrm-absolute imcrm-top-0 imcrm-whitespace-nowrap"
                        style={{ left: lastX, transform: lastX > width - 40 ? 'translateX(-100%)' : 'translateX(-50%)' }}
                    >
                        {pointName(last)}
                    </span>
                )}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-text-[10px] imcrm-text-muted-foreground">
                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                    <span className="imcrm-inline-block imcrm-h-0.5 imcrm-w-4 imcrm-rounded imcrm-bg-primary" aria-hidden />
                    {capitalize(legend.now)}
                </span>
                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                    <span className="imcrm-inline-block imcrm-w-4 imcrm-border-t-2 imcrm-border-dashed imcrm-border-muted-foreground" aria-hidden />
                    {capitalize(legend.before)}
                </span>
            </div>
        </div>
    );
}
