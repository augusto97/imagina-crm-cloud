import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, CalendarRange, Loader2, Pencil, Plus, Settings, Trash2 } from 'lucide-react';

import { BarChartWidget } from '@/admin/dashboards/widgets/BarChartWidget';
import { FunnelWidget } from '@/admin/dashboards/widgets/FunnelWidget';
import { KpiWidget } from '@/admin/dashboards/widgets/KpiWidget';
import { LineChartWidget } from '@/admin/dashboards/widgets/LineChartWidget';
import { PieChartWidget } from '@/admin/dashboards/widgets/PieChartWidget';
import { StatDeltaWidget } from '@/admin/dashboards/widgets/StatDeltaWidget';
import { TableWidget } from '@/admin/dashboards/widgets/TableWidget';
import { DATE_RANGE_PRESETS } from '@/admin/records/dateRangePresets';

// react-grid-layout es ~50KB gzipped — solo lo necesitamos en la
// vista de un dashboard concreto. Lazy-load para no inflar el main
// bundle de listas.
const DashboardGrid = lazy(() =>
    import('@/admin/dashboards/DashboardGrid').then((m) => ({ default: m.DashboardGrid })),
);
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
    useDashboard,
    useDeleteDashboard,
    useUpdateDashboard,
} from '@/hooks/useDashboards';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { WidgetSpec } from '@/types/dashboard';

import { DashboardSettingsDialog } from './DashboardSettingsDialog';
import { WidgetFormDialog } from './WidgetFormDialog';

/**
 * Página de un dashboard. Renderiza una grid responsive con todos los
 * widgets persistidos. Botón "Añadir widget" abre el WidgetFormDialog;
 * cada widget tiene editar/eliminar al hover.
 *
 * Layout: en este commit usamos un grid CSS simple con `w*h` en
 * unidades de "cell" (1 cell ≈ 1fr). Drag-and-drop / resize del
 * grid quedan para Fase 6 (polish).
 */
export function DashboardPage(): JSX.Element {
    const { dashboardId } = useParams<{ dashboardId: string }>();
    const id = Number(dashboardId);
    const navigate = useNavigate();

    const dashboard = useDashboard(id);
    const update = useUpdateDashboard(id);
    const remove = useDeleteDashboard();
    const toast = useToast();
    const confirm = useConfirm();

    const [widgetDialogOpen, setWidgetDialogOpen] = useState(false);
    const [editingWidget, setEditingWidget] = useState<WidgetSpec | null>(null);
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

    const handleAddWidget = (): void => {
        setEditingWidget(null);
        setWidgetDialogOpen(true);
    };

    const handleEditWidget = (widget: WidgetSpec): void => {
        setEditingWidget(widget);
        setWidgetDialogOpen(true);
    };

    const handleSaveWidget = async (widget: WidgetSpec): Promise<void> => {
        if (!dashboard.data) return;
        const existing = dashboard.data.widgets.find((w) => w.id === widget.id);
        const widgets = existing
            ? dashboard.data.widgets.map((w) => (w.id === widget.id ? widget : w))
            : [...dashboard.data.widgets, widget];

        try {
            await update.mutateAsync({ widgets });
        } catch (err) {
            if (err instanceof ApiError || err instanceof Error) {
                toast.error(__('No se pudo guardar el widget'), err.message);
            }
        }
    };

    /**
     * Persist el nuevo layout (x/y/w/h) cuando el usuario suelta de
     * arrastrar o resizear un widget. react-grid-layout dispara
     * `onLayoutChange` también en el mount inicial, por lo que
     * comparamos contra los layouts actuales y solo guardamos si hay
     * cambio real — evita un PATCH al abrir cada dashboard.
     */
    const handleLayoutChange = async (
        layouts: Array<{ id: string; x: number; y: number; w: number; h: number }>,
    ): Promise<void> => {
        if (!dashboard.data) return;
        const map = new Map(layouts.map((l) => [l.id, l]));
        let changed = false;
        const widgets = dashboard.data.widgets.map((w) => {
            const next = map.get(w.id);
            if (!next) return w;
            const cur = w.layout ?? { x: 0, y: 0, w: 4, h: 3 };
            if (cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h) {
                return w;
            }
            changed = true;
            return { ...w, layout: { x: next.x, y: next.y, w: next.w, h: next.h } };
        });
        if (!changed) return;
        try {
            await update.mutateAsync({ widgets });
        } catch (err) {
            if (err instanceof Error) {
                toast.error(__('No se pudo guardar el layout'), err.message);
            }
        }
    };

    const handleDeleteWidget = async (widgetId: string): Promise<void> => {
        if (!dashboard.data) return;
        const ok = await confirm({
            title: __('Eliminar widget'),
            description: __('Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        const widgets = dashboard.data.widgets.filter((w) => w.id !== widgetId);
        try {
            await update.mutateAsync({ widgets });
            toast.success(__('Widget eliminado'));
        } catch (err) {
            if (err instanceof Error) {
                toast.error(__('No se pudo eliminar el widget'), err.message);
            }
        }
    };

    const handleDeleteDashboard = async (): Promise<void> => {
        if (!dashboard.data) return;
        const ok = await confirm({
            title: __('Eliminar dashboard'),
            description: __('Sus widgets se perderán. Esta acción no se puede deshacer.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(dashboard.data.id);
            toast.success(__('Dashboard eliminado'));
            navigate('/dashboards');
        } catch (err) {
            if (err instanceof Error) {
                toast.error(__('No se pudo eliminar el dashboard'), err.message);
            }
        }
    };

    if (dashboard.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-12 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando dashboard…')}
            </div>
        );
    }

    if (!dashboard.data) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
                <Button asChild variant="ghost" size="sm" className="imcrm-gap-2">
                    <Link to="/dashboards">
                        <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                        {__('Volver a Dashboards')}
                    </Link>
                </Button>
                <p className="imcrm-text-sm imcrm-text-destructive">{__('Dashboard no encontrado.')}</p>
            </div>
        );
    }

    const d = dashboard.data;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-3 sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-justify-between sm:imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="imcrm-gap-2 imcrm-self-start imcrm-text-muted-foreground"
                    >
                        <Link to="/dashboards">
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                            {__('Dashboards')}
                        </Link>
                    </Button>
                    <h1 className="imcrm-group/title imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                        {d.name}
                        {d.user_id === null && (
                            <Badge variant="outline">{__('Compartido')}</Badge>
                        )}
                        <button
                            type="button"
                            onClick={() => setSettingsDialogOpen(true)}
                            className="imcrm-ml-1 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground imcrm-opacity-0 imcrm-transition-opacity hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover/title:imcrm-opacity-100 focus-visible:imcrm-opacity-100"
                            aria-label={__('Editar nombre y descripción')}
                            title={__('Editar nombre y descripción')}
                        >
                            <Pencil className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </h1>
                    {d.description && (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{d.description}</p>
                    )}
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Button
                        variant="outline"
                        className="imcrm-gap-2"
                        onClick={() => setSettingsDialogOpen(true)}
                    >
                        <Settings className="imcrm-h-4 imcrm-w-4" />
                        {__('Editar')}
                    </Button>
                    <Button variant="outline" className="imcrm-gap-2 imcrm-text-destructive" onClick={handleDeleteDashboard}>
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                        {__('Eliminar')}
                    </Button>
                    <Button onClick={handleAddWidget} className="imcrm-gap-2">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Añadir widget')}
                    </Button>
                </div>
            </header>

            <DashboardSettingsDialog
                dashboard={d}
                open={settingsDialogOpen}
                onOpenChange={setSettingsDialogOpen}
            />

            {d.widgets.length === 0 ? (
                <EmptyState onAdd={handleAddWidget} />
            ) : (
                <Suspense
                    fallback={
                        <div className="imcrm-flex imcrm-h-32 imcrm-items-center imcrm-justify-center imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando dashboard…')}
                        </div>
                    }
                >
                    <DashboardGrid
                        widgets={d.widgets}
                        onLayoutChange={(layouts) => void handleLayoutChange(layouts)}
                    >
                        {(widget) => (
                            <article
                                className={cn(
                                    'imcrm-group imcrm-relative imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-sm imcrm-transition-shadow imcrm-duration-200',
                                    'hover:imcrm-shadow-imcrm-md hover:imcrm-border-primary/25',
                                )}
                            >
                                <PeriodBadge widget={widget} />
                                <div className="imcrm-no-drag imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-flex imcrm-gap-1 imcrm-opacity-0 imcrm-transition-opacity group-hover:imcrm-opacity-100">
                                    <button
                                        type="button"
                                        onClick={() => handleEditWidget(widget)}
                                        className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                        aria-label={__('Editar widget')}
                                    >
                                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleDeleteWidget(widget.id)}
                                        className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                        aria-label={__('Eliminar widget')}
                                    >
                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </div>
                                <div className="imcrm-no-drag imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-flex-col">
                                    <WidgetRenderer dashboardId={id} widget={widget} />
                                </div>
                            </article>
                        )}
                    </DashboardGrid>
                </Suspense>
            )}

            <WidgetFormDialog
                initial={editingWidget}
                open={widgetDialogOpen}
                onOpenChange={setWidgetDialogOpen}
                onSave={(w) => void handleSaveWidget(w)}
            />
        </div>
    );
}

function WidgetRenderer({
    dashboardId,
    widget,
}: {
    dashboardId: number;
    widget: WidgetSpec;
}): JSX.Element {
    switch (widget.type) {
        case 'kpi':
            return <KpiWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_bar':
            return <BarChartWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_pie':
            return <PieChartWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_area':
            return <LineChartWidget dashboardId={dashboardId} widget={widget} area />;
        case 'stat_delta':
            return <StatDeltaWidget dashboardId={dashboardId} widget={widget} />;
        case 'table':
            return <TableWidget dashboardId={dashboardId} widget={widget} />;
        case 'funnel':
            return <FunnelWidget dashboardId={dashboardId} widget={widget} />;
        case 'chart_line':
        default:
            return <LineChartWidget dashboardId={dashboardId} widget={widget} />;
    }
}

/**
 * Badge con el período relativo del widget (si lo configuró). Visible
 * en reposo en la esquina del card; al hover se desvanece para dejar
 * lugar a los botones de editar/eliminar.
 */
function PeriodBadge({ widget }: { widget: WidgetSpec }): JSX.Element | null {
    const preset = widget.config.period?.preset;
    if (! preset) return null;
    const label = DATE_RANGE_PRESETS.find((p) => p.id === preset)?.label ?? preset;
    return (
        <span className="imcrm-pointer-events-none imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-muted/60 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-opacity group-hover:imcrm-opacity-0">
            <CalendarRange className="imcrm-h-3 imcrm-w-3" />
            {label}
        </span>
    );
}

function EmptyState({ onAdd }: { onAdd: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-12 imcrm-text-center">
            <span className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                <BarChart3 className="imcrm-h-6 imcrm-w-6" />
            </span>
            <h2 className="imcrm-text-base imcrm-font-medium">{__('Dashboard vacío')}</h2>
            <p className="imcrm-max-w-md imcrm-text-sm imcrm-text-muted-foreground">
                {__('Añade tu primer widget — KPI, gráfico de barras o de tendencia.')}
            </p>
            <Button onClick={onAdd} className="imcrm-mt-2 imcrm-gap-2">
                <Plus className="imcrm-h-4 imcrm-w-4" />
                {__('Añadir widget')}
            </Button>
        </div>
    );
}

// Small unused helper used by Tailwind to keep some imports referenced
// (defensive against tree-shaking false positives).
void sprintf;
