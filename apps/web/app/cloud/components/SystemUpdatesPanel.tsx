import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdateRunStatus, UpdateStatus } from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { RefreshCw } from 'lucide-react';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const IN_PROGRESS: UpdateRunStatus[] = ['queued', 'running', 'restarting'];
const STATUS_LABEL: Record<UpdateRunStatus, string> = {
    idle: 'Sin actividad',
    queued: 'En cola…',
    running: 'Instalando…',
    restarting: 'Reiniciando y verificando…',
    success: 'Actualizado ✓',
    failed: 'Falló',
    rolled_back: 'Revertido',
};

/**
 * Panel de auto-actualización del servidor (ADR-S13). Sólo lo ve el superadmin
 * de plataforma: si `GET /system/update/status` responde 403, el componente no
 * renderiza nada. Hace polling mientras hay un run en curso.
 */
export function SystemUpdatesPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const statusQ = useQuery({
        queryKey: ['update-status'],
        queryFn: () => api.updateStatus(),
        retry: false,
        refetchInterval: (q) => (q.state.data && IN_PROGRESS.includes(q.state.data.run.status) ? 3000 : false),
    });

    const check = useMutation({
        mutationFn: () => api.updateCheck(),
        onSuccess: (s) => qc.setQueryData(['update-status'], s),
    });
    const runUpdate = useMutation({
        mutationFn: () => api.updateRun(),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['update-status'] }),
    });
    const rollback = useMutation({
        mutationFn: () => api.updateRollback(),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['update-status'] }),
    });

    // 403 (no superadmin) o cualquier error → no mostrar el panel.
    if (statusQ.isError) {
        const e = statusQ.error;
        if (e instanceof CloudApiError && e.status !== 403) {
            // errores no-403 tampoco bloquean la página; sólo ocultamos.
        }
        return null;
    }
    if (!statusQ.data) return null;

    const s: UpdateStatus = statusQ.data;
    const busy = IN_PROGRESS.includes(s.run.status);

    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <RefreshCw className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>Sistema · Actualizaciones</CardTitle>
                            <CardDescription>
                                Actualización del servidor desde GitHub Releases (superadmin).
                            </CardDescription>
                        </div>
                    </div>
                    {s.update_available && (
                        <Badge dot variant="warning" className="imcrm-shrink-0">
                            Hay actualización
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
            <dl className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 imcrm-text-sm">
                <div>
                    <dt className="imcrm-text-xs imcrm-text-muted-foreground">Versión actual</dt>
                    <dd className="imcrm-font-mono">{s.current_version}</dd>
                </div>
                <div>
                    <dt className="imcrm-text-xs imcrm-text-muted-foreground">Disponible</dt>
                    <dd className="imcrm-font-mono">{s.available?.version ?? '—'}</dd>
                </div>
            </dl>

            {s.run.status !== 'idle' && (
                <div
                    className={[
                        'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                        s.run.status === 'failed' || s.run.status === 'rolled_back'
                            ? 'imcrm-bg-rose-100 imcrm-text-rose-800'
                            : s.run.status === 'success'
                              ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                              : 'imcrm-bg-muted/50 imcrm-text-muted-foreground',
                    ].join(' ')}
                >
                    <b>{STATUS_LABEL[s.run.status]}</b>
                    {s.run.message ? ` — ${s.run.message}` : ''}
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button variant="ghost" size="sm" onClick={() => check.mutate()} disabled={check.isPending || busy}>
                    {check.isPending ? 'Buscando…' : 'Buscar actualizaciones'}
                </Button>
                <Button size="sm" onClick={() => runUpdate.mutate()} disabled={!s.update_available || busy}>
                    {busy ? 'En curso…' : 'Actualizar'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => rollback.mutate()} disabled={busy}>
                    Rollback
                </Button>
            </div>
            </CardContent>
        </Card>
    );
}
