import { Loader2 } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { withAffixes } from '@/lib/affixes';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

import { WidgetError } from './WidgetError';
import { formatMetricValue } from './widgetFormat';
import { CompareDeltaLine } from './CompareParts';
import { widgetCompareOf } from './compareView';
import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface GaugeWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * Medidor semicircular (v0.1.99): progreso de una métrica contra una
 * META (`config.goal`). El backend evalúa igual que un KPI ({value});
 * el arco, el % y los colores son del front. Colores por tramo:
 * <50% rose, 50-99% amber, ≥100% emerald.
 */
export function GaugeWidget({ dashboardId, widget }: GaugeWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const subtitle = useWidgetSubtitle(widget);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const metricField = fields.data?.find((f) => f.id === widget.config.metric_field_id);
    const metric = typeof widget.config.metric === 'string' ? widget.config.metric : 'count';
    const fmt = (n: number): string => formatMetricValue(n, metric, metricField, { withSymbol: prefix === '' });
    const goal = typeof widget.config.goal === 'number' && widget.config.goal > 0
        ? widget.config.goal
        : 100;
    const prefix = typeof widget.config.prefix === 'string' ? widget.config.prefix : '';
    const suffix = typeof widget.config.suffix === 'string' ? widget.config.suffix : '';

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-1.5 imcrm-min-h-0">
            <WidgetHeader title={widget.title || __('Progreso')} subtitle={subtitle} />
            <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-min-h-0">
                {data.isLoading ? (
                    <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                ) : data.isError ? (
                    <WidgetError error={data.error} />
                ) : data.data && 'value' in data.data ? (
                    <div className="imcrm-flex imcrm-h-full imcrm-w-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-min-h-0">
                        <div className="imcrm-flex imcrm-w-full imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-min-h-0">
                            <Gauge
                                value={typeof data.data.value === 'number' ? data.data.value : 0}
                                previous={(() => {
                                    const c = widgetCompareOf(data.data);
                                    return c && typeof c.value === 'number' ? c.value : null;
                                })()}
                                goal={goal}
                                prefix={prefix}
                                suffix={suffix}
                                fmt={fmt}
                            />
                        </div>
                        <CompareDeltaLine
                            compare={widgetCompareOf(data.data)}
                            current={data.data.value}
                            format={fmt}
                            affix={(s) => withAffixes(s, prefix, suffix)}
                        />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function Gauge({
    value,
    previous,
    goal,
    prefix,
    suffix,
    fmt,
}: {
    value: number;
    /** v0.1.462 — el valor del período con el que se compara (una marca en el arco). */
    previous: number | null;
    goal: number;
    prefix: string;
    suffix: string;
    fmt: (n: number) => string;
}): JSX.Element {
    const pct = Math.max(0, Math.min(1, value / goal));
    const color = pct >= 1
        ? 'hsl(152 60% 40%)'
        : pct >= 0.5
            ? 'hsl(38 92% 50%)'
            : 'hsl(347 77% 55%)';

    // Semicírculo: arco de 180° (de izquierda a derecha), radio 40 en un
    // viewBox 100×58 (deja lugar para el número debajo del arco).
    const r = 40;
    const cx = 50;
    const cy = 50;
    const halfCirc = Math.PI * r;
    // El progreso se pinta con dasharray sobre el MISMO path del arco.
    const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

    return (
        <div className="imcrm-relative imcrm-flex imcrm-h-full imcrm-w-full imcrm-max-w-[240px] imcrm-items-center imcrm-justify-center">
            <svg viewBox="0 0 100 58" className="imcrm-h-full imcrm-w-full" preserveAspectRatio="xMidYMid meet">
                <path
                    d={arcPath}
                    fill="none"
                    strokeWidth="9"
                    strokeLinecap="round"
                    className="imcrm-stroke-muted"
                />
                <path
                    d={arcPath}
                    fill="none"
                    strokeWidth="9"
                    strokeLinecap="round"
                    stroke={color}
                    strokeDasharray={`${(pct * halfCirc).toFixed(1)} ${halfCirc.toFixed(1)}`}
                />
                {previous !== null && (() => {
                    // Marca de «antes» sobre el arco: dónde llegaba el período anterior.
                    const p = Math.max(0, Math.min(1, previous / goal));
                    const a = Math.PI * (1 - p);
                    const x1 = cx + (r - 7) * Math.cos(a);
                    const y1 = cy - (r - 7) * Math.sin(a);
                    const x2 = cx + (r + 7) * Math.cos(a);
                    const y2 = cy - (r + 7) * Math.sin(a);
                    return (
                        <line x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1.6" strokeDasharray="2 1.5" className="imcrm-stroke-muted-foreground" data-testid="imcrm-gauge-previous">
                            <title>{`${__('Antes')}: ${withAffixes(fmt(previous), prefix, suffix)}`}</title>
                        </line>
                    );
                })()}
                <text
                    x={cx}
                    y={cy - 8}
                    textAnchor="middle"
                    className="imcrm-fill-foreground"
                    style={{ fontSize: 14, fontWeight: 700 }}
                >
                    {(pct * 100).toFixed(0)}%
                </text>
                <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    className="imcrm-fill-muted-foreground"
                    style={{ fontSize: 6.5, fontWeight: 500 }}
                >
                    {withAffixes(fmt(value), prefix, suffix)}
                    {' / '}
                    {withAffixes(fmt(goal), prefix, suffix)}
                </text>
            </svg>
        </div>
    );
}
