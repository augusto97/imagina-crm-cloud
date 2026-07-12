import { Loader2, TriangleAlert } from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import type { WidgetSpec } from '@/types/dashboard';

import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface KpiWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * Render simple para widgets `kpi` (estilo ClickUp): label chico
 * arriba (título + métrica·lista como subtítulo muted) y el número
 * grande debajo.
 */
export function KpiWidget({ dashboardId, widget }: KpiWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const subtitle = useWidgetSubtitle(widget);

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-1.5">
            <WidgetHeader title={widget.title || __('KPI')} subtitle={subtitle} />

            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-justify-center imcrm-min-h-0">
                {data.isLoading ? (
                    <Loader2 className="imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-muted-foreground" />
                ) : data.isError ? (
                    <span
                        className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive"
                        title={(data.error as Error).message}
                    >
                        <TriangleAlert className="imcrm-h-4 imcrm-w-4" />
                        {__('Error al cargar')}
                    </span>
                ) : data.data && 'value' in data.data ? (
                    <span className="imcrm-text-[26px] imcrm-font-bold imcrm-leading-none imcrm-tabular-nums imcrm-text-foreground">
                        {formatValue(data.data.value, data.data.metric)}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function formatValue(value: number | string, metric: string): string {
    // 0.36.9: min/max sobre fechas devuelve string ISO; el resto numérico.
    if (typeof value === 'string') return value;
    if (metric === 'avg') {
        return value.toFixed(2);
    }
    if (Number.isInteger(value)) {
        return value.toLocaleString();
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
