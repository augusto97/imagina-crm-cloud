import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import type { WidgetSpec } from '@/types/dashboard';

import { AverageBadge, AVG_LINE_COLOR, useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

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

    const rows =
        data.data && 'data' in data.data
            ? data.data.data.map((r) => ({ label: r.label, value: typeof r.value === 'number' ? r.value : Date.parse(r.value) || 0 }))
            : [];
    const avg = rows.length > 0 ? rows.reduce((s, r) => s + r.value, 0) / rows.length : null;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-2 imcrm-min-h-0">
            <WidgetHeader
                title={widget.title || __('Tendencia mensual')}
                subtitle={subtitle}
                right={showAvg && avg !== null ? <AverageBadge value={avg} /> : null}
            />

            <div className="imcrm-flex imcrm-flex-1 imcrm-items-stretch imcrm-justify-center imcrm-min-h-0">
                {data.isLoading ? (
                    <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                    </div>
                ) : data.isError ? (
                    <div
                        className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive"
                        title={(data.error as Error).message}
                    >
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error')}
                    </div>
                ) : rows.length > 0 ? (
                    <SparkLine
                        rows={rows}
                        area={area ?? false}
                        showAvg={showAvg}
                        showLabels={showLabels}
                    />
                ) : (
                    <p className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-text-xs imcrm-text-muted-foreground">{__('Sin datos.')}</p>
                )}
            </div>
        </div>
    );
}

/**
 * Mide el tamaño real del contenedor con ResizeObserver. Permite que
 * el SVG use coordenadas 1:1 con los píxeles del layout — círculos
 * redondos y texto sin deformar, a cualquier tamaño de widget.
 */
function useElementSize(): {
    ref: React.RefObject<HTMLDivElement>;
    width: number;
    height: number;
} {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        const el = ref.current;
        if (! el) return;
        const measure = (): void => {
            const rect = el.getBoundingClientRect();
            setSize((prev) =>
                Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
                    ? prev
                    : { width: rect.width, height: rect.height },
            );
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return { ref, width: size.width, height: size.height };
}

const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 6;

function SparkLine({
    rows,
    area,
    showAvg,
    showLabels,
}: {
    rows: Array<{ label: string; value: number }>;
    area: boolean;
    showAvg: boolean;
    showLabels: boolean;
}): JSX.Element {
    const { ref, width, height } = useElementSize();
    // Id único por instancia — dos area charts en el mismo dashboard no
    // pueden compartir el id del gradiente (el <defs> del primero en el
    // DOM gana y el segundo puede quedar sin fill si se desmonta).
    const gradId = useId().replace(/:/g, '');

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
                            {formatNumber(max)}
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
                        {points.map((p) => (
                            <circle
                                key={p.label}
                                cx={p.x}
                                cy={p.y}
                                r={3}
                                className="imcrm-fill-primary"
                                stroke="hsl(var(--imcrm-card))"
                                strokeWidth="1.5"
                            >
                                <title>{`${p.label}: ${formatNumber(p.value)}`}</title>
                            </circle>
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
                                {formatNumber(p.value)}
                            </text>
                        ))}
                    </svg>
                )}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-justify-between imcrm-text-[10px] imcrm-text-muted-foreground">
                <span>{points[0]?.label}</span>
                {points.length > 1 && <span>{points[points.length - 1]?.label}</span>}
            </div>
        </div>
    );
}
