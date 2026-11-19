import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import {
    AlertCircle,
    ArrowLeft,
    Copy,
    Download,
    FileSpreadsheet,
    FileText,
    Loader2,
    Lock,
    Mail,
    Pencil,
    Trash2,
    X,
} from 'lucide-react';
import { reportPeriodText, type Report } from '@imagina-base/shared';

import { EmailSubscriptionsPanel } from '@/admin/dashboards/EmailSubscriptionsPanel';
import { MoreMenu } from '@/admin/builder/BuilderShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { useCanEditDashboard } from '@/hooks/useDashboards';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { ReportDocument } from './ReportDocument';
import { ReportScopeControls, sendablePeriod } from './ReportScopeControls';
import { downloadReport, useDeleteReport, useDuplicateReport, useReport, useReportBundle } from './useReports';

/**
 * v0.1.464 (J1) — La página de un informe: se lee de arriba abajo, se cambia
 * el período y la comparación para mirarlo (sin tocar lo guardado), se
 * descarga en PDF o Excel y se programa por correo.
 */
export function ReportPage(): JSX.Element {
    const { reportId } = useParams();
    const id = Number(reportId);
    const q = useReport(id);
    if (q.isLoading) {
        return (
            <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-py-20 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando el informe…')}
            </div>
        );
    }
    if (q.isError || !q.data) {
        return (
            <EmptyState
                icon={FileText}
                title={__('No encontramos este informe')}
                description={__('Puede que lo hayan borrado o que no tengas acceso.')}
                action={
                    <Button asChild variant="outline">
                        <Link to="/dashboards?tab=informes">{__('Ver los informes')}</Link>
                    </Button>
                }
            />
        );
    }
    return <ReportView key={q.data.id} report={q.data} />;
}

function ReportView({ report }: { report: Report }): JSX.Element {
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const [params, setParams] = useSearchParams();
    const canManage = useCan(CAP.MANAGE_DASHBOARDS);
    const canEdit = useCanEditDashboard(report);
    const duplicate = useDuplicateReport();
    const remove = useDeleteReport();

    // Lo que elige quien MIRA: no cambia lo guardado (eso se hace en el editor).
    const [period, setPeriod] = useState(report.settings.period);
    const [compare, setCompare] = useState(report.settings.compare);
    const scope = { period: sendablePeriod(period), compare };
    const bundle = useReportBundle(report.id, scope);
    const [downloading, setDownloading] = useState<'pdf' | 'xlsx' | null>(null);

    const scheduleOpen = params.get('share') === 'email';
    const setScheduleOpen = (open: boolean): void => {
        const p = new URLSearchParams(params);
        if (open) p.set('share', 'email');
        else p.delete('share');
        setParams(p, { replace: true });
    };

    const download = async (format: 'pdf' | 'xlsx'): Promise<void> => {
        setDownloading(format);
        try {
            await downloadReport(report.id, format, scope);
        } catch (e) {
            toast.error(__('No se pudo descargar'), e instanceof Error ? e.message : undefined);
        } finally {
            setDownloading(null);
        }
    };

    const doDuplicate = async (): Promise<void> => {
        try {
            const copy = await duplicate.mutateAsync(report.id);
            toast.success(__('Informe duplicado'));
            nav(`/reports/${copy.id}`);
        } catch (e) {
            toast.error(__('No se pudo duplicar'), e instanceof Error ? e.message : undefined);
        }
    };
    const doDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('Eliminar «%s»'), report.name),
            description: __('Se borra el informe y sus envíos programados. Los datos de tus listas no se tocan.'),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (!ok) return;
        try {
            await remove.mutateAsync(report.id);
            toast.success(__('Informe eliminado'));
            nav('/dashboards?tab=informes');
        } catch (e) {
            toast.error(__('No se pudo eliminar'), e instanceof Error ? e.message : undefined);
        }
    };

    const periodNote = sendablePeriod(period) === '' ? null : reportPeriodText(sendablePeriod(period));

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-5xl imcrm-flex-col imcrm-gap-5" data-testid="report-page">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <Link
                    to="/dashboards?tab=informes"
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Informes')}
                </Link>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 lg:imcrm-flex-row lg:imcrm-items-start lg:imcrm-justify-between">
                    <div className="imcrm-min-w-0">
                        <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            <FileText className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                            <span className="imcrm-min-w-0 imcrm-break-words" data-testid="report-title">{report.name}</span>
                            {report.visibility !== 'workspace' && (
                                <Badge variant="outline" className="imcrm-gap-1 imcrm-font-normal">
                                    <Lock className="imcrm-h-3 imcrm-w-3" />
                                    {report.visibility === 'private' ? __('Sólo yo') : __('Roles')}
                                </Badge>
                            )}
                        </h1>
                        {report.description && <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">{report.description}</p>}
                        {periodNote && <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Período: %s'), periodNote)}</p>}
                    </div>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <ReportScopeControls
                            idPrefix="report-view"
                            compact
                            period={period}
                            compare={compare}
                            onPeriod={setPeriod}
                            onCompare={setCompare}
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="imcrm-h-8 imcrm-gap-1.5" disabled={downloading !== null} data-tour="report-export" data-testid="report-export">
                                    {downloading ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Download className="imcrm-h-3.5 imcrm-w-3.5" />}
                                    {__('Descargar')}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => void download('pdf')} className="imcrm-gap-2" data-testid="report-export-pdf">
                                    <FileText className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                    {__('PDF (para leer o imprimir)')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void download('xlsx')} className="imcrm-gap-2" data-testid="report-export-xlsx">
                                    <FileSpreadsheet className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                    {__('Excel (una hoja por bloque)')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {canManage && (
                            <Button variant="outline" size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => setScheduleOpen(true)} data-tour="report-schedule" data-testid="report-schedule">
                                <Mail className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Envío por correo')}
                            </Button>
                        )}
                        {canEdit && (
                            <Button size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => nav(`/reports/${report.id}/edit`)} data-tour="report-edit" data-testid="report-edit">
                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Editar')}
                            </Button>
                        )}
                        {canManage && (
                            <MoreMenu
                                testId="report-more"
                                actions={[
                                    { label: __('Duplicar'), icon: Copy, onSelect: () => void doDuplicate(), testId: 'report-duplicate' },
                                    ...(canEdit ? [{ label: __('Eliminar'), icon: Trash2, onSelect: () => void doDelete(), separated: true, testId: 'report-delete' }] : []),
                                ]}
                            />
                        )}
                    </div>
                </div>
            </div>

            {report.dropped_blocks > 0 && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-amber-500/30 imcrm-bg-amber-500/10 imcrm-p-3 imcrm-text-sm imcrm-text-amber-900 dark:imcrm-text-amber-200">
                    <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <span>
                        {sprintf(
                            report.dropped_blocks === 1
                                ? __('%d bloque guardado no se pudo leer y no se muestra. Ábrelo en el editor y guárdalo para limpiarlo.')
                                : __('%d bloques guardados no se pudieron leer y no se muestran. Ábrelo en el editor y guárdalo para limpiarlo.'),
                            report.dropped_blocks,
                        )}
                    </span>
                </div>
            )}

            {report.blocks.length === 0 ? (
                <EmptyState
                    icon={FileText}
                    title={__('Este informe todavía no tiene bloques')}
                    description={__('Agrega títulos, textos, indicadores, gráficos y tablas de cualquiera de tus listas.')}
                    action={
                        canEdit ? (
                            <Button onClick={() => nav(`/reports/${report.id}/edit`)} className="imcrm-gap-2">
                                <Pencil className="imcrm-h-4 imcrm-w-4" />
                                {__('Armar el informe')}
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className={cn('imcrm-transition-opacity', bundle.isFetching && !bundle.isLoading && 'imcrm-opacity-70')}>
                    <ReportDocument
                        blocks={report.blocks}
                        data={bundle.data?.data}
                        loading={bundle.isLoading}
                        error={bundle.error instanceof Error ? bundle.error : null}
                        period={scope.period}
                        compare={scope.compare}
                    />
                </div>
            )}

            <Dialog.Root open={scheduleOpen} onOpenChange={setScheduleOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                    <Dialog.Content
                        className={cn(
                            'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[calc(100dvh-1.5rem)] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-2xl imcrm-flex-col',
                            'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                            'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                        )}
                        data-testid="report-schedule-dialog"
                    >
                        <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-p-4 sm:imcrm-px-6">
                            <div className="imcrm-min-w-0">
                                <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">
                                    {sprintf(__('Envío por correo de «%s»'), report.name)}
                                </Dialog.Title>
                                <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                    {__('Se calcula a la hora elegida, con lo guardado en el informe.')}
                                </Dialog.Description>
                            </div>
                            <Dialog.Close asChild>
                                <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </Dialog.Close>
                        </div>
                        <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-4 sm:imcrm-px-6">
                            <EmailSubscriptionsPanel dashboardId={report.id} dashboardName={report.name} kind="report" />
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}
