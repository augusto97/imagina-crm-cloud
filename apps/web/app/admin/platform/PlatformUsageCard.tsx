import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, BarChart3, Loader2, Plug, RefreshCw } from 'lucide-react';
import { USAGE_DAYS, usageModuleInfo, type UsageModuleKey } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ViewSwitch } from '@/components/ui/view-switch';
import { useToast } from '@/components/ui/toast';
import { usePlatformUsage, usePlatformUsageModule, useRefreshPlatformUsage } from '@/hooks/usePlatformUsage';
import { __ } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { agoText } from './serverWatch';
import { countText, modulesInUse, sortedApps, usageAppName, usageGroups, usageShare, type UsageFilter, type UsageRowView } from './usageView';

/**
 * v0.1.437 — Plataforma → Uso: qué módulos usa cada empresa y cuánto, para
 * decidir con datos qué cobrar, qué marcar como beta y qué apagar. El servidor
 * lo calcula de una vez y lo guarda unos minutos; «Actualizar» lo recalcula.
 */
export function PlatformUsageCard(): JSX.Element {
    const usage = usePlatformUsage();
    const refresh = useRefreshPlatformUsage();
    const toast = useToast();
    const [filter, setFilter] = useState<UsageFilter>('all');
    const [detail, setDetail] = useState<UsageModuleKey | null>(null);

    const data = usage.data;
    const groups = useMemo(() => (data ? usageGroups(data, filter) : []), [data, filter]);
    const apps = useMemo(() => (data ? sortedApps(data.apps) : []), [data]);

    return (
        <Card data-tour="platform-usage">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <BarChart3 className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Uso por módulo')}</CardTitle>
                            <CardDescription>
                                {__('Qué usa cada empresa y cuánto en los últimos')} {USAGE_DAYS} {__('días. Sirve para decidir qué cobrar, qué marcar como beta y qué apagar.')}
                            </CardDescription>
                        </div>
                    </div>
                    {data && (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <span data-testid="usage-generated">
                                {__('Calculado')} {agoText(data.generated_at)}
                            </span>
                            <Button
                                size="sm"
                                variant="outline"
                                className="imcrm-h-7 imcrm-gap-1.5 imcrm-text-xs"
                                disabled={refresh.isPending}
                                onClick={() =>
                                    refresh.mutate(undefined, {
                                        onError: (e) => toast.error(__('No se pudo actualizar'), e instanceof Error ? e.message : undefined),
                                    })
                                }
                                data-testid="usage-refresh"
                            >
                                <RefreshCw className={cn('imcrm-h-3.5 imcrm-w-3.5', refresh.isPending && 'imcrm-animate-spin')} aria-hidden />
                                {__('Actualizar')}
                            </Button>
                        </div>
                    )}
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                {usage.isLoading ? (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Calculando el uso de cada módulo…')}
                    </div>
                ) : usage.isError || !data ? (
                    <p className="imcrm-py-4 imcrm-text-sm imcrm-text-destructive">{__('No se pudo calcular el uso. Vuelve a intentar en un momento.')}</p>
                ) : (
                    <>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                            <p className="imcrm-text-sm" data-testid="usage-summary">
                                <span className="imcrm-font-semibold">{modulesInUse(data)}</span> {__('de')} {data.modules.length} {__('módulos los usa al menos una empresa')}
                                <span className="imcrm-text-muted-foreground">
                                    {' '}
                                    · {formatNumber(data.tenants_live)} {data.tenants_live === 1 ? __('empresa activa') : __('empresas activas')}
                                </span>
                            </p>
                            <ViewSwitch
                                label={__('Qué módulos mostrar')}
                                value={filter}
                                onChange={setFilter}
                                testId="usage-filter"
                                options={[
                                    { value: 'all', label: __('Todos') },
                                    { value: 'used', label: __('En uso') },
                                    { value: 'unused', label: __('Sin uso') },
                                ]}
                            />
                        </div>

                        {data.unmeasured.length > 0 && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]" data-testid="usage-unmeasured">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                <span>
                                    {__('No se pudo medir esta vez')}: {data.unmeasured.map((k) => usageModuleInfo(k).label).join(', ')}.{' '}
                                    {__('Salen en cero; toca «Actualizar» en unos minutos.')}
                                </span>
                            </p>
                        )}

                        {groups.length === 0 ? (
                            <p className="imcrm-py-2 imcrm-text-sm imcrm-text-muted-foreground">
                                {filter === 'used' ? __('Ninguna empresa usa todavía ningún módulo.') : __('Todos los módulos los usa al menos una empresa.')}
                            </p>
                        ) : (
                            groups.map((g) => (
                                <section key={g.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-usage-group={g.key}>
                                    <h3 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__(g.label)}</h3>
                                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                                        {g.rows.map((row) => (
                                            <li key={row.info.key}>
                                                <UsageRow row={row} live={data.tenants_live} onOpen={() => setDetail(row.info.key)} />
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))
                        )}

                        {apps.length > 0 && filter !== 'unused' && (
                            <section className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" data-testid="usage-apps">
                                <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    <Plug className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> {__('Apps conectadas')}
                                </h3>
                                <ul className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1.5 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                                    {apps.map((a) => (
                                        <li key={a.key} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-usage-app={a.key}>
                                            <span className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium">{usageAppName(a.key)}</span>
                                            <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground">
                                                {formatNumber(a.tenants)} {a.tenants === 1 ? __('empresa') : __('empresas')} · {formatNumber(a.connections)}{' '}
                                                {a.connections === 1 ? __('conexión') : __('conexiones')}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </>
                )}
            </CardContent>
            <UsageModuleSheet moduleKey={detail} onClose={() => setDetail(null)} />
        </Card>
    );
}

function UsageRow({ row, live, onOpen }: { row: UsageRowView; live: number; onOpen: () => void }): JSX.Element {
    const { info, data } = row;
    const share = usageShare(data.tenants_using, live);
    const unused = data.tenants_using === 0;
    return (
        <button
            type="button"
            onClick={onOpen}
            className="imcrm-grid imcrm-w-full imcrm-grid-cols-1 imcrm-gap-x-4 imcrm-gap-y-1.5 imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-transition-colors hover:imcrm-bg-accent/50 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring md:imcrm-grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_6.5rem] md:imcrm-items-center"
            data-usage-module={info.key}
            aria-label={`${info.label}: ${data.tenants_using} ${__('de')} ${live} ${__('empresas')}`}
        >
            <div className="imcrm-min-w-0">
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                    <span>{__(info.label)}</span>
                    {unused && (
                        <Badge variant="secondary" className="imcrm-text-[10px]">
                            {__('Nadie lo usa')}
                        </Badge>
                    )}
                </p>
                {data.disabled_in_plans.length > 0 && (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Apagado en')}: {data.disabled_in_plans.join(', ')}
                    </p>
                )}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-xs">
                    <span className="imcrm-font-semibold">{formatNumber(data.tenants_using)}</span>{' '}
                    <span className="imcrm-text-muted-foreground">
                        {__('de')} {formatNumber(live)} {live === 1 ? __('empresa') : __('empresas')}
                        {info.activity_label !== null && info.total_label !== null && data.tenants_active > 0 && (
                            <>
                                {' '}
                                · {formatNumber(data.tenants_active)} {__('con actividad')}
                            </>
                        )}
                    </span>
                </span>
                <span className="imcrm-h-1.5 imcrm-w-full imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" aria-hidden>
                    <span className="imcrm-block imcrm-h-full imcrm-rounded-full imcrm-bg-primary" style={{ width: `${share}%` }} />
                </span>
            </div>

            {unused && !data.activity ? (
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Ninguna empresa lo tiene configurado.')}</span>
            ) : (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                    {info.total_label !== null && (
                        <span>
                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(data.total)}</span> {__(info.total_label)}
                        </span>
                    )}
                    {info.activity_label !== null && data.activity !== null && (
                        <span>
                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(data.activity)}</span> {__(info.activity_label)}
                            {!info.activity_month && <> {__('en')} {USAGE_DAYS} {__('días')}</>}
                        </span>
                    )}
                </div>
            )}

            <span className="imcrm-flex imcrm-items-baseline imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground md:imcrm-flex-col md:imcrm-items-end md:imcrm-gap-0" title={data.last_at ?? undefined}>
                {data.last_at ? (
                    <>
                        <span>{__('Último uso')}</span>
                        <span className="imcrm-whitespace-nowrap imcrm-text-foreground/80">{agoText(data.last_at)}</span>
                    </>
                ) : (
                    <span className="md:imcrm-self-end">—</span>
                )}
            </span>
        </button>
    );
}

function UsageModuleSheet({ moduleKey, onClose }: { moduleKey: UsageModuleKey | null; onClose: () => void }): JSX.Element {
    const detail = usePlatformUsageModule(moduleKey);
    const info = moduleKey ? usageModuleInfo(moduleKey) : null;
    const rows = detail.data?.rows ?? [];
    return (
        <Sheet open={moduleKey !== null} onOpenChange={(o) => !o && onClose()}>
            <SheetContent data-testid="usage-module-sheet">
                <SheetHeader>
                    <div>
                        <SheetTitle>{info ? __(info.label) : ''}</SheetTitle>
                        <SheetDescription>{__('Las empresas que lo usan, de la que más a la que menos.')}</SheetDescription>
                    </div>
                </SheetHeader>
                <SheetBody>
                    {detail.isLoading ? (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Cargando…')}
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Ninguna empresa lo usa todavía.')}</p>
                    ) : (
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            {rows.map((r) => (
                                <li key={r.tenant_id}>
                                    <Link
                                        to={`/platform?tab=tenants&tenant=${r.tenant_id}`}
                                        onClick={onClose}
                                        className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-transition-colors hover:imcrm-bg-accent/50"
                                        data-usage-tenant={r.tenant_id}
                                    >
                                        <span className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                            <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{r.name}</span>
                                            <Badge variant="outline" className="imcrm-shrink-0 imcrm-text-[10px]">
                                                {r.plan}
                                            </Badge>
                                        </span>
                                        <span className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-text-xs imcrm-text-muted-foreground">
                                            {info?.total_label != null && <span>{countText(r.total, __(info.total_label))}</span>}
                                            {info?.activity_label != null && r.activity !== null && <span>{countText(r.activity, __(info.activity_label))}</span>}
                                            {r.last_at && (
                                                <span>
                                                    {__('Último uso')} {agoText(r.last_at)}
                                                </span>
                                            )}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                    {detail.data?.truncated && (
                        <p className="imcrm-mt-3 imcrm-text-xs imcrm-text-muted-foreground">{__('Se muestran las primeras 300 empresas.')}</p>
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}
