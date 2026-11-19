import { useContext, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router';

import { DashboardBundleContext, useWidgetData, WidgetDataOverrideContext } from '@/hooks/useDashboards';
import { useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ForecastData, ForecastTotalsData, WidgetSpec } from '@/types/dashboard';

import { CompareBadge, CompareDeltaLine } from './CompareParts';
import { isReadyCompare, widgetCompareOf } from './compareView';
import { forecastFilterTree, forecastOf, forecastPreviousTotals, forecastStageKeys, goalPct, type ForecastPart } from './forecastView';
import { useElementSize } from './useElementSize';
import { WidgetError } from './WidgetError';
import { formatBucketLabel, formatMetricValue } from './widgetFormat';
import { useWidgetSubtitle, WidgetHeader } from './WidgetHeader';

/**
 * v0.1.462 — Pronóstico de ventas con embudo ponderado (J3).
 *
 * Arriba, los totales del período: Pronóstico (= Ganado + Ponderado),
 * Ganado, Ponderado (el monto de cada negocio abierto × la probabilidad de
 * su etapa) y Abierto (el embudo sin ponderar); la meta con su barra y, con
 * «Comparar con…», la variación del pronóstico. Abajo, una columna por
 * período de la fecha de cierre: lo ganado (verde), lo ponderado (color de
 * la marca) y lo que falta para el total abierto (contorno). Tocar un tramo
 * abre la lista con esos negocios.
 */
export function ForecastWidget({ dashboardId, widget }: { dashboardId: number; widget: WidgetSpec }): JSX.Element {
    const data = useWidgetData(dashboardId, widget.id);
    const subtitle = useWidgetSubtitle(widget);
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const amountField = fields.data?.find((f) => f.id === widget.config.metric_field_id);
    const fmt = (n: number): string => formatMetricValue(n, 'sum', amountField);
    const forecast = forecastOf(data.data);
    const compare = widgetCompareOf(data.data);
    const ready = isReadyCompare(compare) ? compare : null;
    const before = ready ? forecastPreviousTotals(ready.totals) : null;
    const goal = typeof widget.config.goal === 'number' && widget.config.goal > 0 ? widget.config.goal : null;
    const nav = useForecastNav(widget, forecast);
    const { ref, width } = useElementSize();

    return (
        <div ref={ref} className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col imcrm-gap-2" data-tour="dashboard-forecast" data-testid="imcrm-forecast">
            <WidgetHeader
                title={widget.title || __('Pronóstico de ventas')}
                subtitle={subtitle}
                right={
                    <CompareBadge
                        compare={compare}
                        total={forecast && before ? { current: forecast.totals.forecast, previous: before.forecast } : null}
                        format={fmt}
                    />
                }
            />
            {data.isLoading ? (
                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center">
                    <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                </div>
            ) : data.isError ? (
                <WidgetError error={data.error} />
            ) : forecast === null ? (
                <p className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-text-xs imcrm-text-muted-foreground">{__('Sin datos.')}</p>
            ) : (
                <>
                    <ForecastTotals
                        totals={forecast.totals}
                        format={fmt}
                        narrow={width > 0 && width < 460}
                        goal={goal}
                        compareNode={ready ? <CompareDeltaLine compare={before ? { ...ready, value: before.forecast } : ready} current={forecast.totals.forecast} format={fmt} /> : null}
                        before={before}
                        onOpen={nav}
                    />
                    {forecast.bucket !== null && forecast.buckets.length > 0 ? (
                        <ForecastColumns forecast={forecast} format={fmt} onOpen={nav} />
                    ) : (
                        <ForecastStages forecast={forecast} format={fmt} onOpen={nav} />
                    )}
                    {forecast.totals.unassigned > 0 && (
                        <p className="imcrm-shrink-0 imcrm-text-[10px] imcrm-text-muted-foreground">
                            {sprintf(__('%s en negocios sin etapa no cuentan.'), fmt(forecast.totals.unassigned))}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

type OpenFn = ((bucketKey: string | null, part: ForecastPart) => void) | null;

/** Click en un tramo → la lista filtrada por ese período y esas etapas. */
function useForecastNav(widget: WidgetSpec, forecast: ForecastData | null): OpenFn {
    const injected = useContext(WidgetDataOverrideContext) !== null;
    const scope = useContext(DashboardBundleContext);
    const navigate = useNavigate();
    const lists = useLists();
    const fields = useFields(widget.list_id > 0 ? widget.list_id : undefined);
    const stageFieldId = typeof widget.config.stage_field_id === 'number' ? widget.config.stage_field_id : undefined;
    const slug = lists.data?.find((l) => l.id === widget.list_id)?.slug;
    if (injected || forecast === null || stageFieldId === undefined || slug === undefined || !fields.data) return null;
    return (bucketKey, part) => {
        const tree = forecastFilterTree({
            widget,
            listFields: fields.data ?? [],
            period: scope.period,
            filters: scope.filters,
            userId: getBootData().user.id,
            stageFieldId,
            stageKeys: forecastStageKeys(forecast.stages, part),
            bucketKey,
        });
        if (tree === null) return;
        navigate(`/lists/${slug}/records?ft=${encodeURIComponent(JSON.stringify(tree))}`);
    };
}

function Tile({
    label,
    value,
    tone,
    big,
    onClick,
    hint,
    testId,
    children,
}: {
    label: string;
    value: string;
    tone?: string;
    big?: boolean;
    onClick?: () => void;
    hint?: string;
    testId: string;
    children?: React.ReactNode;
}): JSX.Element {
    const Comp = onClick ? 'button' : 'div';
    return (
        <Comp
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            title={hint}
            data-testid={testId}
            className={cn(
                'imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-items-start imcrm-gap-0.5 imcrm-rounded-lg imcrm-px-2 imcrm-py-1.5 imcrm-text-left',
                big ? 'imcrm-bg-primary/10' : 'imcrm-bg-muted/50',
                onClick && 'hover:imcrm-ring-1 hover:imcrm-ring-border focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
            )}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {tone && <span className={cn('imcrm-inline-block imcrm-h-2 imcrm-w-2 imcrm-rounded-sm', tone)} aria-hidden />}
                {label}
            </span>
            <span className={cn('imcrm-max-w-full imcrm-truncate imcrm-font-semibold imcrm-tabular-nums imcrm-text-foreground', big ? 'imcrm-text-lg' : 'imcrm-text-sm')}>
                {value}
            </span>
            {children}
        </Comp>
    );
}

function ForecastTotals({
    totals,
    format,
    narrow,
    goal,
    compareNode,
    before,
    onOpen,
}: {
    totals: ForecastTotalsData;
    format: (n: number) => string;
    narrow: boolean;
    goal: number | null;
    compareNode: React.ReactNode;
    before: ForecastTotalsData | null;
    onOpen: OpenFn;
}): JSX.Element {
    const pct = goalPct(totals.forecast, goal);
    const beforeHint = (k: keyof ForecastTotalsData): string | undefined => (before ? sprintf(__('Antes: %s'), format(before[k])) : undefined);
    return (
        <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-1.5">
            <div className={cn('imcrm-grid imcrm-gap-1.5', narrow ? 'imcrm-grid-cols-2' : 'imcrm-grid-cols-4')}>
                <Tile
                    label={__('Pronóstico')}
                    value={format(totals.forecast)}
                    big
                    testId="imcrm-forecast-total"
                    hint={[__('Ganado + ponderado.'), beforeHint('forecast')].filter(Boolean).join('\n')}
                    onClick={onOpen ? () => onOpen(null, 'all') : undefined}
                >
                    {compareNode}
                </Tile>
                <Tile
                    label={__('Ganado')}
                    value={format(totals.won)}
                    tone="imcrm-bg-emerald-500"
                    testId="imcrm-forecast-won"
                    hint={[__('Negocios en etapas de 100 %.'), beforeHint('won')].filter(Boolean).join('\n')}
                    onClick={onOpen ? () => onOpen(null, 'won') : undefined}
                />
                <Tile
                    label={__('Ponderado')}
                    value={format(totals.weighted)}
                    tone="imcrm-bg-primary"
                    testId="imcrm-forecast-weighted"
                    hint={[__('Cada negocio abierto × la probabilidad de su etapa.'), beforeHint('weighted')].filter(Boolean).join('\n')}
                    onClick={onOpen ? () => onOpen(null, 'open') : undefined}
                />
                <Tile
                    label={__('Abierto')}
                    value={format(totals.open)}
                    tone="imcrm-border imcrm-border-dashed imcrm-border-primary"
                    testId="imcrm-forecast-open"
                    hint={[__('El monto de los negocios abiertos, sin ponderar.'), beforeHint('open')].filter(Boolean).join('\n')}
                    onClick={onOpen ? () => onOpen(null, 'open') : undefined}
                />
            </div>
            {goal !== null && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="imcrm-forecast-goal">
                    <div className="imcrm-h-1.5 imcrm-w-full imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                        <div
                            className={cn('imcrm-h-full imcrm-rounded-full', pct >= 100 ? 'imcrm-bg-emerald-500' : 'imcrm-bg-primary')}
                            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                        />
                    </div>
                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">
                        {sprintf(__('%1$s de la meta (%2$s)'), `${Math.round(pct)} %`, format(goal))}
                    </span>
                </div>
            )}
        </div>
    );
}

function ForecastColumns({ forecast, format, onOpen }: { forecast: ForecastData; format: (n: number) => string; onOpen: OpenFn }): JSX.Element {
    const [hover, setHover] = useState<string | null>(null);
    const buckets = forecast.buckets;
    const max = Math.max(...buckets.map((b) => b.won + b.open), 1);
    const every = buckets.length > 14 ? Math.ceil(buckets.length / 8) : 1;
    const label = (k: string): string => (k === '' ? __('Sin fecha') : formatBucketLabel(k));
    const shown = hover !== null ? buckets.find((b) => b.key === hover) : undefined;
    return (
        <div className="imcrm-relative imcrm-flex imcrm-min-h-[90px] imcrm-flex-1 imcrm-flex-col imcrm-gap-1" onMouseLeave={() => setHover(null)}>
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-items-end imcrm-gap-1" data-testid="imcrm-forecast-columns">
                {buckets.map((b) => {
                    const total = b.won + b.open;
                    const h = (total / max) * 100;
                    const wonPct = total > 0 ? (b.won / total) * 100 : 0;
                    const weightedPct = total > 0 ? (b.weighted / total) * 100 : 0;
                    const title = [
                        label(b.key),
                        sprintf(__('Pronóstico: %s'), format(b.forecast)),
                        sprintf(__('Ganado: %s'), format(b.won)),
                        sprintf(__('Ponderado: %s'), format(b.weighted)),
                        sprintf(__('Abierto: %s'), format(b.open)),
                    ].join('\n');
                    return (
                        <button
                            key={b.key || 'none'}
                            type="button"
                            className="imcrm-group imcrm-relative imcrm-flex imcrm-h-full imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-justify-end focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                            onMouseEnter={() => setHover(b.key)}
                            onFocus={() => setHover(b.key)}
                            onClick={onOpen ? () => onOpen(b.key, 'all') : () => setHover((x) => (x === b.key ? null : b.key))}
                            title={title}
                            aria-label={title}
                            data-testid="imcrm-forecast-bucket"
                            data-key={b.key}
                        >
                            {total > 0 ? (
                                <div
                                    className={cn(
                                        'imcrm-relative imcrm-flex imcrm-w-full imcrm-flex-col-reverse imcrm-overflow-hidden imcrm-rounded-t imcrm-border imcrm-border-dashed imcrm-border-primary/50',
                                        hover === b.key && 'imcrm-border-primary',
                                    )}
                                    style={{ height: `${Math.max(h, 2)}%` }}
                                >
                                    <div className="imcrm-w-full imcrm-bg-emerald-500" style={{ height: `${wonPct}%` }} />
                                    <div className="imcrm-w-full imcrm-bg-primary" style={{ height: `${weightedPct}%` }} />
                                </div>
                            ) : (
                                <div className="imcrm-h-px imcrm-w-full imcrm-bg-border" />
                            )}
                        </button>
                    );
                })}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-gap-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                {buckets.map((b, i) => (
                    <span key={b.key || 'none'} className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-center">
                        {i % every === 0 ? label(b.key) : ''}
                    </span>
                ))}
            </div>
            {shown && (
                <div
                    className="imcrm-pointer-events-none imcrm-absolute imcrm-left-1/2 imcrm-top-0 imcrm-z-10 imcrm--translate-x-1/2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-px-2 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-popover-foreground imcrm-shadow-md"
                    data-testid="imcrm-forecast-tooltip"
                >
                    <div className="imcrm-font-semibold">{label(shown.key)}</div>
                    <Row k={__('Pronóstico')} v={format(shown.forecast)} strong />
                    <Row k={__('Ganado')} v={format(shown.won)} />
                    <Row k={__('Ponderado')} v={format(shown.weighted)} />
                    <Row k={__('Abierto')} v={format(shown.open)} />
                </div>
            )}
            <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-wrap imcrm-gap-x-3 imcrm-text-[10px] imcrm-text-muted-foreground">
                <Legend tone="imcrm-bg-emerald-500" text={__('Ganado')} />
                <Legend tone="imcrm-bg-primary" text={__('Ponderado')} />
                <Legend tone="imcrm-border imcrm-border-dashed imcrm-border-primary" text={__('Resto del abierto')} />
            </div>
        </div>
    );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-justify-between imcrm-gap-3">
            <span className="imcrm-text-muted-foreground">{k}</span>
            <span className={cn('imcrm-tabular-nums', strong && 'imcrm-font-semibold')}>{v}</span>
        </div>
    );
}

function Legend({ tone, text }: { tone: string; text: string }): JSX.Element {
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
            <span className={cn('imcrm-inline-block imcrm-h-2 imcrm-w-2 imcrm-rounded-sm', tone)} aria-hidden />
            {text}
        </span>
    );
}

/** Sin fecha de cierre: un renglón por etapa con su probabilidad. */
function ForecastStages({ forecast, format, onOpen }: { forecast: ForecastData; format: (n: number) => string; onOpen: OpenFn }): JSX.Element {
    const max = Math.max(...forecast.stages.map((s) => s.amount), 1);
    return (
        <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1 imcrm-overflow-auto" data-testid="imcrm-forecast-stages">
            {forecast.stages.map((s) => {
                const tone = s.probability >= 100 ? 'imcrm-bg-emerald-500' : s.probability <= 0 ? 'imcrm-bg-muted-foreground/40' : 'imcrm-bg-primary';
                return (
                    <button
                        key={s.key}
                        type="button"
                        onClick={onOpen && s.probability > 0 ? () => onOpen(null, s.probability >= 100 ? 'won' : 'open') : undefined}
                        className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-left imcrm-text-[11px]"
                        title={`${s.label} · ${s.probability} % · ${format(s.amount)}`}
                    >
                        <span className="imcrm-w-24 imcrm-shrink-0 imcrm-truncate imcrm-text-foreground">{s.label}</span>
                        <span className="imcrm-relative imcrm-h-2 imcrm-flex-1 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                            <span className={cn('imcrm-absolute imcrm-inset-y-0 imcrm-left-0 imcrm-rounded-full', tone)} style={{ width: `${(s.amount / max) * 100}%` }} />
                        </span>
                        <span className="imcrm-w-9 imcrm-shrink-0 imcrm-text-right imcrm-tabular-nums imcrm-text-muted-foreground">{s.probability} %</span>
                        <span className="imcrm-w-20 imcrm-shrink-0 imcrm-text-right imcrm-tabular-nums imcrm-font-medium">{format(s.amount)}</span>
                    </button>
                );
            })}
        </div>
    );
}
