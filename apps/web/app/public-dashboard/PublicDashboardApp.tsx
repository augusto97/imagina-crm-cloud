import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { PublicDashboardBundle } from '@imagina-base/shared';

import { DashboardGrid } from '@/admin/dashboards/DashboardGrid';
import { WidgetCard } from '@/admin/dashboards/WidgetCard';
import { WidgetExportMenu } from '@/admin/dashboards/widgets/WidgetExportMenu';
import { WidgetRenderer } from '@/admin/dashboards/widgets/WidgetRenderer';
import { DATE_RANGE_PRESETS } from '@/admin/records/dateRangePresets';
import { brandVars, hexToHslTriplet } from '@/hooks/useBranding';
import { DashboardBundleContext, WidgetDataOverrideContext, widgetErrorOf, type WidgetDataOverride } from '@/hooks/useDashboards';
import { MemberDirectoryContext } from '@/hooks/useWpUsers';
import { hexLuminance, pageStyleCss, readPageSettings } from '@/lib/blockStyle';
import { applyFavicon } from '@/lib/favicon';
import { formatDateTimeStr, setTenantFormat } from '@/lib/tenantFormat';
import { isContentWidget, type WidgetData, type WidgetSpec } from '@/types/dashboard';

import { periodFromQuery, seedPublicCaches } from './publicDashboard';

/** El tablero de la página pública es de sólo lectura: id 0 (nada se pide por id). */
const PUBLIC_DASHBOARD_ID = 0;

class UnavailableError extends Error {}

async function fetchBundle(token: string, period: string): Promise<PublicDashboardBundle> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : '';
    const res = await fetch(`/api/v1/public/dashboards/${encodeURIComponent(token)}${qs}`, {
        credentials: 'omit',
        headers: { Accept: 'application/json' },
    });
    if (res.status === 404) throw new UnavailableError();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as PublicDashboardBundle;
}

/**
 * v0.1.292 (ADR-S50) — El tablero publicado: los MISMOS widgets de la app
 * (`WidgetRenderer` + `WidgetCard`), con los datos inyectados del paquete del
 * enlace. Sin sesión, sin edición, sin clics que lleven a la app; cada widget
 * se puede descargar como imagen o CSV.
 */
export function PublicDashboardApp({ token, dark }: { token: string | null; dark: boolean }): JSX.Element {
    const qc = useQueryClient();
    const [period, setPeriod] = useState(() => periodFromQuery(window.location.search));
    const query = useQuery({
        queryKey: ['public-dashboard', token, period],
        // Definiciones y formato ANTES de que los widgets se dibujen (los leen
        // al montar): se siembran al llegar el paquete, no durante el render.
        queryFn: async () => {
            const b = await fetchBundle(token!, period);
            setTenantFormat(b.format as never);
            seedPublicCaches(qc, b);
            return b;
        },
        enabled: token !== null,
        placeholderData: keepPreviousData,
        refetchInterval: 5 * 60_000,
    });
    const bundle = query.data;

    useEffect(() => {
        if (!bundle) return;
        const root = document.documentElement;
        const triplet = bundle.branding.primary_color ? hexToHslTriplet(bundle.branding.primary_color) : null;
        for (const [k, v] of Object.entries(brandVars(triplet, dark ? 'dark' : 'light'))) {
            if (k === '--imcrm-primary' || k === '--imcrm-ring') root.style.setProperty(k, v);
        }
        if (bundle.branding.logo_url) applyFavicon(bundle.branding.logo_url);
        document.title = bundle.branding.app_name ? `${bundle.name} — ${bundle.branding.app_name}` : bundle.name;
    }, [bundle, dark]);

    const directory = useMemo(
        () => new Map(Object.entries(bundle?.users ?? {}).map(([id, name]) => [Number(id), name])),
        [bundle],
    );
    const override = useMemo<WidgetDataOverride>(
        () => ({
            get(widgetId) {
                const raw = bundle?.data[widgetId];
                const failed = widgetErrorOf(raw);
                return {
                    data: failed === null ? (raw as WidgetData | undefined) : undefined,
                    isLoading: bundle === undefined,
                    error: failed !== null ? new Error(failed) : null,
                };
            },
        }),
        [bundle],
    );

    if (token === null || (query.isError && query.error instanceof UnavailableError)) return <Unavailable />;
    if (query.isError && !bundle) {
        return (
            <Centered>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">No se pudo cargar el tablero. Prueba de nuevo en un momento.</p>
            </Centered>
        );
    }
    if (!bundle) {
        return (
            <Centered>
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label="Cargando" />
            </Centered>
        );
    }

    const page = readPageSettings((bundle.settings as { page?: unknown }).page);
    const surfaceDark = page.bg !== undefined ? hexLuminance(page.bg) <= 0.5 : dark;
    const layout = pageStyleCss(page);
    const widgets = bundle.widgets as WidgetSpec[];

    return (
        <DashboardBundleContext.Provider value={{ period, filters: [] }}>
            <WidgetDataOverrideContext.Provider value={override}>
                <MemberDirectoryContext.Provider value={directory}>
                    <div className="imcrm-min-h-screen imcrm-bg-background imcrm-text-foreground" data-testid="imcrm-public-dashboard">
                        <div
                            className="imcrm-mx-auto imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-4 sm:imcrm-p-6"
                            style={{ maxWidth: layout.maxWidth, fontFamily: layout.fontFamily }}
                        >
                            <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-end sm:imcrm-justify-between">
                                <div className="imcrm-min-w-0">
                                    {(bundle.branding.logo_url || bundle.branding.app_name) && (
                                        <div className="imcrm-mb-1 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                                            {bundle.branding.logo_url && <img src={bundle.branding.logo_url} alt="" className="imcrm-h-5 imcrm-w-auto" />}
                                            {bundle.branding.app_name && <span>{bundle.branding.app_name}</span>}
                                        </div>
                                    )}
                                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{bundle.name}</h1>
                                    {bundle.description && <p className="imcrm-text-sm imcrm-text-muted-foreground">{bundle.description}</p>}
                                    <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="imcrm-public-updated">
                                        {`Actualizado: ${formatDateTimeStr(bundle.generated_at)}`}
                                        {query.isFetching && <Loader2 className="imcrm-ml-1.5 imcrm-inline imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                                    </p>
                                </div>
                                {bundle.allow_period && (
                                    <select
                                        value={period}
                                        onChange={(e) => setPeriod(e.target.value)}
                                        className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-[13px] sm:imcrm-w-auto"
                                        aria-label="Período"
                                        data-testid="imcrm-public-period"
                                    >
                                        <option value="">Cada gráfico con su período</option>
                                        {DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.label}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </header>
                            <div
                                className="[&_.imcrm-drag-handle]:imcrm-cursor-auto"
                                style={page.bg !== undefined ? { backgroundColor: page.bg, borderRadius: 12, padding: 16 } : undefined}
                            >
                                {widgets.length === 0 ? (
                                    <p className="imcrm-py-12 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">Este tablero todavía no tiene gráficos.</p>
                                ) : (
                                    <DashboardGrid widgets={widgets} editable={false} onLayoutChange={() => undefined}>
                                        {(widget) => (
                                            <WidgetCard
                                                widget={widget}
                                                dark={surfaceDark}
                                                overlay={
                                                    !isContentWidget(widget.type) ? (
                                                        <div className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-flex imcrm-gap-1 imcrm-rounded imcrm-bg-card/90 imcrm-opacity-0 imcrm-transition-opacity group-hover:imcrm-opacity-100 focus-within:imcrm-opacity-100 [@media(hover:none)]:imcrm-opacity-100">
                                                            <WidgetExportMenu dashboardId={PUBLIC_DASHBOARD_ID} widget={widget} />
                                                        </div>
                                                    ) : undefined
                                                }
                                            >
                                                <WidgetRenderer dashboardId={PUBLIC_DASHBOARD_ID} widget={widget} />
                                            </WidgetCard>
                                        )}
                                    </DashboardGrid>
                                )}
                            </div>
                        </div>
                    </div>
                </MemberDirectoryContext.Provider>
            </WidgetDataOverrideContext.Provider>
        </DashboardBundleContext.Provider>
    );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
    return <div className="imcrm-flex imcrm-min-h-screen imcrm-items-center imcrm-justify-center imcrm-bg-background imcrm-p-4">{children}</div>;
}

function Unavailable(): JSX.Element {
    return (
        <Centered>
            <div className="imcrm-max-w-sm imcrm-text-center" data-testid="imcrm-public-unavailable">
                <h1 className="imcrm-text-lg imcrm-font-semibold imcrm-text-foreground">Este tablero no está disponible</h1>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    Puede que la dirección esté mal escrita, que ya no se publique o que el enlace haya vencido.
                </p>
            </div>
        </Centered>
    );
}
