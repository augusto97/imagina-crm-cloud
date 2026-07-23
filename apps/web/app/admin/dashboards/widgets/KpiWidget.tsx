import {
    AlertCircle,
    Briefcase,
    Calendar,
    CheckCircle2,
    DollarSign,
    Heart,
    Loader2,
    ShoppingCart,
    Star,
    Target,
    TrendingUp,
    TriangleAlert,
    Users,
    Zap,
    type LucideIcon,
} from 'lucide-react';

import { useWidgetData } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';

import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

interface KpiWidgetProps {
    dashboardId: number;
    widget: WidgetSpec;
}

/**
 * Set curado de iconos elegibles para el KPI (v0.1.99). El config
 * guarda el NOMBRE (`config.icon`) — un nombre desconocido simplemente
 * no renderiza icono (tolerante a versiones).
 */
export const KPI_ICONS: Record<string, LucideIcon> = {
    trending: TrendingUp,
    users: Users,
    dollar: DollarSign,
    cart: ShoppingCart,
    target: Target,
    star: Star,
    zap: Zap,
    calendar: Calendar,
    check: CheckCircle2,
    alert: AlertCircle,
    briefcase: Briefcase,
    heart: Heart,
};

export const KPI_ICON_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '', label: __('Sin icono') },
    { value: 'trending', label: __('Tendencia') },
    { value: 'users', label: __('Personas') },
    { value: 'dollar', label: __('Dinero') },
    { value: 'cart', label: __('Ventas') },
    { value: 'target', label: __('Meta') },
    { value: 'star', label: __('Estrella') },
    { value: 'zap', label: __('Rayo') },
    { value: 'calendar', label: __('Calendario') },
    { value: 'check', label: __('Check') },
    { value: 'alert', label: __('Alerta') },
    { value: 'briefcase', label: __('Negocio') },
    { value: 'heart', label: __('Corazón') },
];

/**
 * KPI premium (v0.1.99): icono opcional, prefijo/sufijo alrededor del
 * número, META con barra de progreso + color condicional (verde al
 * alcanzarla, ámbar si va por debajo) y mini-tendencia (sparkline de
 * los últimos 30 días si el widget configuró `spark_field_id` — la
 * serie la calcula el backend con la misma métrica).
 */
export function KpiWidget({ dashboardId, widget }: KpiWidgetProps): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const subtitle = useWidgetSubtitle(widget);

    const iconName = typeof widget.config.icon === 'string' ? widget.config.icon : '';
    const Icon = KPI_ICONS[iconName];
    const prefix = typeof widget.config.prefix === 'string' ? widget.config.prefix : '';
    const suffix = typeof widget.config.suffix === 'string' ? widget.config.suffix : '';
    const goal = typeof widget.config.goal === 'number' && widget.config.goal > 0
        ? widget.config.goal
        : undefined;

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-1.5">
            <WidgetHeader
                title={widget.title || __('KPI')}
                subtitle={subtitle}
                right={Icon !== undefined ? (
                    <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground">
                        <Icon className="imcrm-h-4 imcrm-w-4" />
                    </span>
                ) : undefined}
            />

            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-justify-center imcrm-gap-1.5 imcrm-min-h-0">
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
                    <Body
                        value={data.data.value}
                        metric={data.data.metric}
                        spark={'spark' in data.data ? data.data.spark : undefined}
                        prefix={prefix}
                        suffix={suffix}
                        goal={goal}
                    />
                ) : null}
            </div>
        </div>
    );
}

function Body({
    value,
    metric,
    spark,
    prefix,
    suffix,
    goal,
}: {
    value: number | string;
    metric: string;
    spark: number[] | undefined;
    prefix: string;
    suffix: string;
    goal: number | undefined;
}): JSX.Element {
    const numeric = typeof value === 'number' ? value : null;
    const reached = goal !== undefined && numeric !== null && numeric >= goal;
    const pct = goal !== undefined && numeric !== null
        ? Math.max(0, Math.min(100, (numeric / goal) * 100))
        : null;

    return (
        <>
            <span
                className={cn(
                    'imcrm-text-[26px] imcrm-font-bold imcrm-leading-none imcrm-tabular-nums',
                    // Color condicional SOLO cuando hay meta: verde al
                    // alcanzarla, ámbar por debajo. Sin meta, el color del
                    // texto lo decide el tema / la capa de estilo del card.
                    goal === undefined
                        ? 'imcrm-text-foreground'
                        : reached
                            ? 'imcrm-text-emerald-600 dark:imcrm-text-emerald-400'
                            : 'imcrm-text-amber-600 dark:imcrm-text-amber-400',
                )}
            >
                {prefix}{formatValue(value, metric)}{suffix}
            </span>

            {goal !== undefined && pct !== null && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <div className="imcrm-h-1.5 imcrm-w-full imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                        <div
                            className={cn(
                                'imcrm-h-full imcrm-rounded-full imcrm-transition-all',
                                reached ? 'imcrm-bg-emerald-500' : 'imcrm-bg-amber-500',
                            )}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <span className="imcrm-text-[10px] imcrm-tabular-nums imcrm-text-muted-foreground">
                        {pct.toFixed(0)}% {__('de la meta')} ({prefix}{formatNumber(goal)}{suffix})
                    </span>
                </div>
            )}

            {spark !== undefined && spark.length > 1 && <Sparkline values={spark} />}
        </>
    );
}

/** Mini-tendencia de 30 días — línea simple, sin ejes ni labels. */
function Sparkline({ values }: { values: number[] }): JSX.Element {
    const w = 120;
    const h = 26;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const step = w / (values.length - 1);
    const points = values
        .map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 4)).toFixed(1)}`)
        .join(' ');
    return (
        <svg
            viewBox={`0 0 ${w} ${h}`}
            className="imcrm-h-[26px] imcrm-w-full imcrm-max-w-[160px]"
            preserveAspectRatio="none"
            aria-hidden
        >
            <polyline
                points={points}
                fill="none"
                stroke="hsl(var(--imcrm-primary))"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

function formatValue(value: number | string, metric: string): string {
    // 0.36.9: min/max sobre fechas devuelve string ISO; el resto numérico.
    if (typeof value === 'string') return value;
    if (metric === 'avg') {
        return formatNumber(value, { minFrac: 2, maxFrac: 2 });
    }
    if (Number.isInteger(value)) {
        return formatNumber(value, { maxFrac: 0 });
    }
    return formatNumber(value, { maxFrac: 2 });
}
