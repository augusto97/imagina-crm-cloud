import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

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
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-destructive">
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error')}
                    </span>
                ) : data.data && 'value' in data.data ? (
                    <Gauge
                        value={typeof data.data.value === 'number' ? data.data.value : 0}
                        goal={goal}
                        prefix={prefix}
                        suffix={suffix}
                    />
                ) : null}
            </div>
        </div>
    );
}

function Gauge({
    value,
    goal,
    prefix,
    suffix,
}: {
    value: number;
    goal: number;
    prefix: string;
    suffix: string;
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
                    {prefix}{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}{suffix}
                    {' / '}
                    {prefix}{goal.toLocaleString()}{suffix}
                </text>
            </svg>
        </div>
    );
}
