import { Loader2, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';

import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface StatDeltaWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * KPI con comparación vs período anterior — el clásico "growth tile"
 * de cualquier dashboard SaaS. Backend computa current + previous
 * + delta_pct sobre 2 ventanas consecutivas de N días definidas en
 * `config.period_days`.
 */
export function StatDeltaWidget({ dashboardId, widget }: StatDeltaWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const subtitle = useWidgetSubtitle(widget);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-1.5">
            <WidgetHeader title={widget.title || __('Crecimiento')} subtitle={subtitle} />

            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-justify-center imcrm-gap-1 imcrm-min-h-0">
                {data.isLoading ? (
                    <Loader2 className="imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-muted-foreground" />
                ) : data.isError ? (
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive">
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error al cargar')}
                    </span>
                ) : data.data && 'previous' in data.data ? (
                    <Body
                        value={data.data.value}
                        previous={data.data.previous}
                        deltaPct={data.data.delta_pct as number | null}
                        periodDays={data.data.period_days as number}
                    />
                ) : null}
            </div>
        </div>
    );
}

function Body({
    value,
    previous,
    deltaPct,
    periodDays,
}: {
    value: number | string;
    previous: number | string;
    deltaPct: number | null;
    periodDays: number;
}): JSX.Element {
    const isUp   = deltaPct !== null && deltaPct >= 0;
    const isDown = deltaPct !== null && deltaPct < 0;
    const Trend  = isUp ? TrendingUp : TrendingDown;

    return (
        <>
            {/* 0.57.42 — número + pill de delta en la MISMA línea
              * (estilo Stripe); la comparación textual va debajo en una
              * línea compacta. Antes el número iba solo y el delta en
              * otra fila → el card necesitaba más alto para lo mismo. */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-0.5">
                <span className="imcrm-text-[26px] imcrm-font-bold imcrm-leading-none imcrm-tabular-nums imcrm-text-foreground">
                    {format(value)}
                </span>
                {deltaPct !== null && (
                    <span
                        className={cn(
                            'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-semibold',
                            isUp
                                ? 'imcrm-bg-success/10 imcrm-text-success'
                                : isDown
                                  ? 'imcrm-bg-destructive/10 imcrm-text-destructive'
                                  : 'imcrm-bg-muted imcrm-text-muted-foreground',
                        )}
                    >
                        <Trend className="imcrm-h-3 imcrm-w-3" />
                        {deltaPct > 0 && '+'}
                        {deltaPct.toFixed(1)}%
                    </span>
                )}
            </div>
            <span className="imcrm-text-[11px] imcrm-leading-tight imcrm-text-muted-foreground">
                {sprintf(
                    /* translators: 1: previous period value, 2: previous period days */
                    __('vs %1$s en los %2$d días previos'),
                    format(previous),
                    periodDays,
                )}
            </span>
        </>
    );
}

function format(v: number | string): string {
    if (typeof v === 'string') return v;
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
