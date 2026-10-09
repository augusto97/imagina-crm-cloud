import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Loader2, Sparkles } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

function size(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}

/**
 * v0.1.278 — Plataforma → Diagnóstico → Disco. Un servidor se llenó sin que
 * nadie lo viera hasta que falló una actualización: aquí se ve cuánto queda,
 * qué ocupa la app y se libera lo que sobra (versiones viejas, copias previas
 * a cada actualización, lo que dejó una actualización cortada) sin consola.
 */
export function DiskUsageCard(): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const toast = useToast();
    const q = useQuery({ queryKey: ['platform-disk'], queryFn: () => api.diskUsage(), refetchInterval: 60_000 });
    const clean = useMutation({
        mutationFn: () => api.diskCleanup(),
        onSuccess: (r) => {
            void qc.invalidateQueries({ queryKey: ['platform-disk'] });
            toast.success(
                r.removed.length === 0 ? __('No había nada para liberar') : sprintf(__('Se liberaron %s'), size(r.freed_bytes)),
                sprintf(__('Quedan %s libres.'), size(r.free_bytes)),
            );
        },
        onError: (err) => toast.error(__('No se pudo liberar'), err instanceof Error ? err.message : String(err)),
    });
    if (q.isLoading || !q.data) return null;
    const d = q.data;
    const used = Math.max(0, d.total_bytes - d.free_bytes);
    const pct = d.total_bytes > 0 ? Math.round((used / d.total_bytes) * 100) : 0;
    const known = d.parts.reduce((a, p) => a + (p.bytes ?? 0), 0);
    const inodePct =
        d.total_inodes && d.free_inodes !== null ? Math.round(((d.total_inodes - d.free_inodes) / d.total_inodes) * 100) : null;
    const bad = d.low || d.low_inodes;
    const warn = pct > 85 || (inodePct !== null && inodePct > 85);
    return (
        <Card data-testid="disk-usage">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <HardDrive className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>{__('Disco')}</CardTitle>
                            <CardDescription>
                                {sprintf(__('%1$s libres de %2$s. Una actualización necesita al menos %3$s.'), size(d.free_bytes), size(d.total_bytes), size(d.min_free_bytes))}
                            </CardDescription>
                        </div>
                    </div>
                    <Badge dot variant={bad ? 'destructive' : warn ? 'warning' : 'success'} className="imcrm-shrink-0" data-testid="disk-status">
                        {d.low ? __('Sin espacio') : d.low_inodes ? __('Sin lugar para archivos') : warn ? __('Queda poco') : __('Bien')}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" aria-label={sprintf(__('%d%% usado'), pct)}>
                    <div className={cn('imcrm-h-full', d.low ? 'imcrm-bg-destructive' : pct > 85 ? 'imcrm-bg-warning' : 'imcrm-bg-primary')} style={{ width: `${pct}%` }} />
                </div>
                {d.total_inodes !== null && d.free_inodes !== null && (
                    <p className={cn('imcrm-text-xs', d.low_inodes ? 'imcrm-font-medium imcrm-text-destructive' : 'imcrm-text-muted-foreground')} data-testid="disk-inodes">
                        {d.low_inodes
                            ? sprintf(
                                  __('Se acabó el lugar para más ARCHIVOS: quedan %1$s de %2$s (inodos), aunque haya GB libres. Una actualización necesita unos %3$s. Ver docs/runbook-disk.md, «Sin inodos».'),
                                  formatNumber(d.free_inodes),
                                  formatNumber(d.total_inodes),
                                  formatNumber(d.min_free_inodes),
                              )
                            : sprintf(__('Archivos: %1$s%% usado (%2$s libres de %3$s).'), String(inodePct ?? 0), formatNumber(d.free_inodes), formatNumber(d.total_inodes))}
                    </p>
                )}
                {d.available ? (
                    <>
                        <ul className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1 imcrm-text-sm sm:imcrm-grid-cols-2">
                            {d.parts.map((p) => (
                                <li key={p.key} className="imcrm-flex imcrm-justify-between imcrm-gap-3 imcrm-rounded imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-1.5">
                                    <span className="imcrm-text-muted-foreground">{__(p.label)}</span>
                                    <span className="imcrm-tabular-nums">{size(p.bytes)}</span>
                                </li>
                            ))}
                            <li className="imcrm-flex imcrm-justify-between imcrm-gap-3 imcrm-rounded imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-1.5">
                                <span className="imcrm-text-muted-foreground">{__('Base de datos, sistema y otros')}</span>
                                <span className="imcrm-tabular-nums">{size(Math.max(0, used - known))}</span>
                            </li>
                        </ul>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            <p className="imcrm-max-w-xl imcrm-text-xs imcrm-text-muted-foreground">
                                {d.reclaimable_bytes > 0
                                    ? sprintf(__('Se pueden liberar %s: versiones viejas de la app, copias previas a cada actualización y lo que dejó una actualización cortada. No toca los datos ni los archivos de tus clientes, ni las copias de seguridad diarias.'), size(d.reclaimable_bytes))
                                    : __('No hay nada que sobre: las versiones y copias guardadas son las que se conservan.')}
                            </p>
                            <Button
                                size="sm"
                                variant="outline"
                                className="imcrm-gap-1.5"
                                disabled={clean.isPending || d.reclaimable_bytes === 0}
                                onClick={() =>
                                    void confirm({
                                        title: __('¿Liberar espacio?'),
                                        description: sprintf(__('Se borran las versiones viejas de la app (quedan la actual y las anteriores que se conservan para volver atrás) y las copias de la base previas a cada actualización salvo las 5 más nuevas. Unos %s.'), size(d.reclaimable_bytes)),
                                        confirmLabel: __('Liberar'),
                                    }).then((ok) => ok && clean.mutate())
                                }
                                data-testid="disk-cleanup"
                            >
                                {clean.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />}
                                {__('Liberar espacio')}
                            </Button>
                        </div>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Si la base de datos ocupa mucho, revisa el archivo de WAL de Postgres (ver docs/runbook-disk.md).')}
                        </p>
                    </>
                ) : (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Este servidor no usa el layout de versiones (desarrollo): sólo se muestra el espacio libre.')}</p>
                )}
            </CardContent>
        </Card>
    );
}
