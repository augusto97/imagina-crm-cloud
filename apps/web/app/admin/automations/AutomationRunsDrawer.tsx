import { CheckCircle2, MinusCircle, RotateCw, XCircle } from 'lucide-react';

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
import { useAutomationRuns } from '@/hooks/useAutomations';
import { __, sprintf } from '@/lib/i18n';
import type {
    ActionLogEntry,
    ActionLogStatus,
    AutomationEntity,
    AutomationRunEntity,
    AutomationRunStatus,
} from '@/types/automation';

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

                    {runs.isLoading ? (
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
                        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                            {runs.data.map((run) => (
                                <RunCard key={run.id} run={run} />
                            ))}
                        </ul>
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

function RunCard({ run }: { run: AutomationRunEntity }): JSX.Element {
    const started = run.started_at ?? run.created_at;
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <RunStatusBadge status={run.status} />
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {started ? new Date(started + 'Z').toLocaleString() : '—'}
                </span>
            </div>
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
    return <Badge variant="outline">{__('Pendiente')}</Badge>;
}

function ActionLogRow({ entry }: { entry: ActionLogEntry }): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
            <ActionStatusIcon status={entry.status} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-font-mono imcrm-text-foreground">{entry.action}</span>
                {entry.message && (
                    <span className="imcrm-text-muted-foreground">{entry.message}</span>
                )}
            </div>
        </li>
    );
}

function ActionStatusIcon({ status }: { status: ActionLogStatus }): JSX.Element {
    if (status === 'success') {
        return <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-success" />;
    }
    if (status === 'failed') {
        return <XCircle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-destructive" />;
    }
    return <MinusCircle className="imcrm-h-3.5 imcrm-w-3.5 imcrm-mt-0.5 imcrm-text-muted-foreground" />;
}
