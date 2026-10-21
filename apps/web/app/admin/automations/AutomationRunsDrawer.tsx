import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Hourglass, MinusCircle, RotateCw, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { useAutomationRuns, useCancelWaitingRun } from '@/hooks/useAutomations';
import { useToast } from '@/components/ui/toast';
import { __, _n, sprintf } from '@/lib/i18n';
import type {
    ActionLogEntry,
    ActionLogStatus,
    AutomationEntity,
    AutomationRunEntity,
    AutomationRunStatus,
} from '@/types/automation';
import { parseUtcDate } from '@/lib/utcDate';

import { formatDateTime } from '@/lib/tenantFormat';
/**
 * Drawer lateral que muestra el historial reciente de ejecuciones de una
 * automatización. Cada run lista su status final, timestamps y el log
 * por acción para diagnóstico.
 */
interface AutomationRunsDrawerProps {
    automation: AutomationEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AutomationRunsDrawer({
    automation,
    open,
    onOpenChange,
}: AutomationRunsDrawerProps): JSX.Element {
    const runs = useAutomationRuns(automation.id);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <SheetTitle>{__('Historial de ejecuciones')}</SheetTitle>
                            <SheetDescription>{automation.name}</SheetDescription>
                        </div>
                        <SheetCloseButton aria-label={__('Cerrar')} />
                    </div>
                </SheetHeader>
                <SheetBody>
                    <div className="imcrm-mb-3 imcrm-flex imcrm-items-center imcrm-justify-end">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => runs.refetch()}
                            disabled={runs.isFetching}
                            className="imcrm-gap-2"
                        >
                            <RotateCw
                                className={
                                    'imcrm-h-3.5 imcrm-w-3.5 ' +
                                    (runs.isFetching ? 'imcrm-animate-spin' : '')
                                }
                            />
                            {__('Refrescar')}
                        </Button>
                    </div>

                    {runs.isPending ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            {[0, 1, 2].map((i) => (
                                <div
                                    key={i}
                                    className="imcrm-h-20 imcrm-animate-pulse imcrm-rounded-md imcrm-bg-muted/40"
                                />
                            ))}
                        </div>
                    ) : runs.isError ? (
                        <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                            {(runs.error as Error).message}
                        </div>
                    ) : runs.data && runs.data.length > 0 ? (
                        <>
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                {runs.data.map((run) => (
                                    <RunCard key={run.id} run={run} automationId={automation.id} />
                                ))}
                            </ul>
                            {runs.hasNextPage && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-mt-3 imcrm-w-full imcrm-gap-2"
                                    onClick={() => void runs.fetchNextPage()}
                                    disabled={runs.isFetchingNextPage}
                                    data-testid="imcrm-runs-load-more"
                                >
                                    {runs.isFetchingNextPage && <RotateCw className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                                    {__('Cargar más')}
                                </Button>
                            )}
                        </>
                    ) : (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Aún no hay ejecuciones registradas para esta automatización.')}
                        </p>
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function RunCard({ run, automationId }: { run: AutomationRunEntity; automationId: number }): JSX.Element {
    const started = run.started_at ?? run.created_at;
    const cancel = useCancelWaitingRun(automationId);
    const toast = useToast();
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid="imcrm-run-card" data-status={run.status}>
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <RunStatusBadge status={run.status} />
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {started ? formatDateTime(parseUtcDate(started)) : '—'}
                </span>
            </div>
            {run.status === 'waiting' && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-bg-info/10 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs" data-testid="imcrm-run-waiting">
                    <Hourglass className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-[hsl(var(--imcrm-info-ink))]" />
                    <span className="imcrm-flex-1">
                        {run.resume_at
                            ? sprintf(__('En espera hasta el %s; después sigue con los pasos de abajo.'), formatDateTime(parseUtcDate(run.resume_at)))
                            : __('En espera.')}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="imcrm-h-7"
                        disabled={cancel.isPending}
                        onClick={() =>
                            cancel.mutate(run.id, {
                                onSuccess: (r) => {
                                    if (r.cancelled) toast.success(__('Espera cancelada: la automatización no sigue para este registro.'));
                                    else toast.error(__('Ya no estaba en espera (quizá acaba de seguir).'));
                                },
                                onError: (err) => toast.error(err instanceof Error ? err.message : __('No se pudo cancelar.')),
                            })
                        }
                        data-testid="imcrm-run-cancel-wait"
                    >
                        {__('Cancelar espera')}
                    </Button>
                </div>
            )}
            {run.record_id !== null && (
                <div className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(
                        /* translators: %d: record id */
                        __('Registro #%d'),
                        run.record_id,
                    )}
                </div>
            )}
            {run.actions_log.length > 0 && (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-pt-1">
                    {run.actions_log.map((entry, i) => (
                        <ActionLogRow key={i} entry={entry} />
                    ))}
                </ol>
            )}
            {run.error && (
                <div className="imcrm-rounded imcrm-bg-destructive/10 imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-destructive">
                    {run.error}
                </div>
            )}
        </li>
    );
}

function RunStatusBadge({ status }: { status: AutomationRunStatus }): JSX.Element {
    if (status === 'success') return <Badge variant="success">{__('Éxito')}</Badge>;
    if (status === 'failed') return <Badge variant="destructive">{__('Fallida')}</Badge>;
    if (status === 'running') return <Badge variant="warning">{__('Ejecutando')}</Badge>;
    if (status === 'waiting') return <Badge variant="info">{__('En espera')}</Badge>;
    if (status === 'cancelled') return <Badge variant="secondary">{__('Cancelada')}</Badge>;
    return <Badge variant="outline">{__('Pendiente')}</Badge>;
}

/** Nombre legible de cada paso del log (antes se veía `update_field`). */
const ACTION_LABELS: Record<string, string> = {
    send_email: __('Enviar email'),
    call_webhook: __('Llamar webhook'),
    connector_action: __('Acción de una app conectada'),
    update_field: __('Actualizar campo'),
    create_record: __('Crear registro'),
    generate_pdf: __('Generar PDF'),
    bulk_edit: __('Editar en lote'),
    if_else: __('Condición'),
    wait: __('Esperar'),
    for_each_linked: __('Repetir por cada registro vinculado'),
    engine: __('Motor de automatizaciones'),
};

/** Profundidad de un paso por su ruta (`2.then.0` → 1): sangría en el log. */
function depthOf(entry: ActionLogEntry): number {
    const path = (entry.details as { path?: unknown } | undefined)?.path;
    if (typeof path !== 'string' || path === '') return 0;
    return path.split('.').filter((p) => p === 'then' || p === 'else' || p === 'each').length;
}

interface LoopSummary {
    items?: Array<{ id: number; status: string; message: string }>;
    samples?: Record<string, ActionLogEntry[]>;
}

function ActionLogRow({ entry }: { entry: ActionLogEntry }): JSX.Element {
    // Valores que no se pudieron escribir (la acción corrió igual): se ven.
    const warnings = Array.isArray((entry.details as { warnings?: unknown } | undefined)?.warnings)
        ? ((entry.details as { warnings: unknown[] }).warnings.map(String))
        : [];
    const loop = entry.action === 'for_each_linked' ? (entry.details as LoopSummary) : null;
    return (
        <li className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs" style={{ marginLeft: Math.min(depthOf(entry), 4) * 12 }}>
            <ActionStatusIcon status={entry.status} warned={warnings.length > 0} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-font-medium imcrm-text-foreground">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                {entry.message && (
                    <span className="imcrm-text-muted-foreground">{entry.message}</span>
                )}
                {warnings.length > 0 && (
                    <span className="imcrm-mt-0.5 imcrm-rounded imcrm-bg-warning/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-text-warning" data-testid="imcrm-run-warnings">
                        {sprintf(_n('%d valor no se escribió', '%d valores no se escribieron', warnings.length), warnings.length)}
                    </span>
                )}
                {loop && Array.isArray(loop.items) && loop.items.length > 0 && <LoopItems summary={loop} />}
            </div>
        </li>
    );
}

/**
 * v0.1.289 — Detalle de una repetición: el estado de cada vinculado y el
 * log completo del primero (y de los que fallaron).
 */
function LoopItems({ summary }: { summary: LoopSummary }): JSX.Element {
    const [open, setOpen] = useState(false);
    const items = summary.items ?? [];
    return (
        <div className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-run-loop">
            <button type="button" className="imcrm-flex imcrm-w-fit imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary" onClick={() => setOpen((v) => !v)}>
                <ChevronRight className={'imcrm-h-3 imcrm-w-3 imcrm-transition-transform ' + (open ? 'imcrm-rotate-90' : '')} />
                {open ? __('Ocultar el detalle por vinculado') : sprintf(_n('Ver el detalle (%d vinculado)', 'Ver el detalle (%d vinculados)', items.length), items.length)}
            </button>
            {open && (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-border imcrm-p-2">
                    {items.map((it) => (
                        <li key={it.id} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <ActionStatusIcon status={it.status === 'failed' ? 'failed' : it.status === 'skipped' ? 'skipped' : 'success'} />
                                <span className="imcrm-font-medium">#{it.id}</span>
                                <span className="imcrm-text-muted-foreground">{it.message}</span>
                            </span>
                            {summary.samples?.[String(it.id)] && (
                                <ol className="imcrm-ml-5 imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                                    {summary.samples[String(it.id)]!.map((l, j) => (
                                        <li key={j} className="imcrm-text-muted-foreground">
                                            {ACTION_LABELS[l.action] ?? l.action}: {l.message}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

function ActionStatusIcon({ status, warned = false }: { status: ActionLogStatus; warned?: boolean }): JSX.Element {
    if (status === 'success' && warned) {
        return <AlertTriangle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-warning" />;
    }
    if (status === 'success') {
        return <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-success" />;
    }
    if (status === 'failed') {
        return <XCircle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-destructive" />;
    }
    return <MinusCircle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-muted-foreground" />;
}
