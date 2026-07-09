import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { Automation, AutomationRun } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';

/** Historial de ejecuciones (runs) de una automatización. */
export function AutomationRunsSheet({
    open,
    onOpenChange,
    listSlug,
    automation,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    listSlug: string;
    automation: Automation | null;
}): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const runs = useQuery({
        queryKey: ['automation-runs', tenantId, automation?.id],
        queryFn: () => api.automationRuns(listSlug, automation!.id),
        enabled: open && automation !== null,
    });

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="imcrm-flex imcrm-w-full imcrm-max-w-md imcrm-flex-col">
                <SheetHeader>
                    <SheetTitle>Ejecuciones</SheetTitle>
                    <SheetDescription>{automation?.name}</SheetDescription>
                </SheetHeader>
                <SheetBody className="imcrm-flex-1 imcrm-space-y-2 imcrm-overflow-y-auto">
                    {runs.isLoading && <p className="imcrm-text-sm imcrm-text-muted-foreground">Cargando…</p>}
                    {runs.data?.length === 0 && (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">Todavía no se ejecutó.</p>
                    )}
                    {runs.data?.map((r) => <RunItem key={r.id} run={r} />)}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function RunItem({ run }: { run: AutomationRun }): JSX.Element {
    const { icon: Icon, cls, variant } = STATUS[run.status] ?? STATUS.skipped;
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className={`imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium ${cls}`}>
                    <Icon className="imcrm-h-4 imcrm-w-4" />
                    <Badge variant={variant}>{run.status}</Badge>
                </span>
                <span className="imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">{run.duration_ms}ms</span>
            </div>
            {run.logs.length > 0 && (
                <ul className="imcrm-mt-2 imcrm-space-y-0.5 imcrm-border-t imcrm-border-border imcrm-pt-2">
                    {run.logs.map((l, i) => (
                        <li key={i} className="imcrm-text-xs imcrm-text-muted-foreground">{l}</li>
                    ))}
                </ul>
            )}
            <div className="imcrm-mt-1.5 imcrm-text-[11px] imcrm-text-muted-foreground/70">
                {new Date(run.created_at).toLocaleString()}
                {run.record_id !== null ? ` · registro #${run.record_id}` : ''}
            </div>
        </div>
    );
}

const STATUS = {
    success: { icon: CheckCircle2, cls: 'imcrm-text-success', variant: 'success' as const },
    failed: { icon: XCircle, cls: 'imcrm-text-destructive', variant: 'destructive' as const },
    skipped: { icon: MinusCircle, cls: 'imcrm-text-muted-foreground', variant: 'outline' as const },
};
