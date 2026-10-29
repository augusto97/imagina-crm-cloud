import type { PostgresWalStatus } from '@imagina-base/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Wrench } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { formatDate, formatNumber } from '@/lib/tenantFormat';

import { diskSize } from './diskSize';

/**
 * v0.1.337 — El registro de cambios de la base de datos (WAL) en la tarjeta
 * Disco. Un servidor juntó 45 GB porque el archivado fallaba desde el primer
 * día (la carpeta del archivo nacía de root) y nada lo decía: Postgres no
 * borra un segmento hasta archivarlo. Aquí se ve si archiva, cuánto espera, y
 * se destraba sin consola con «Liberar y reparar».
 */
export function WalStatusPanel({ wal }: { wal: PostgresWalStatus }): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const toast = useToast();
    const release = useMutation({
        mutationFn: () => api.walRelease(),
        onSuccess: (r) => {
            void qc.invalidateQueries({ queryKey: ['platform-disk'] });
            if (r.permission === 'failed') {
                toast.warning(sprintf(__('Se liberaron %s, pero el permiso no se pudo reparar'), diskSize(r.freed_bytes)), r.message ?? undefined);
                return;
            }
            // Postgres conserva una parte del registro (hasta max_wal_size, 1 GB por
            // defecto) para reusarla: con poco atraso no se libera casi nada.
            const title =
                r.marked === 0
                    ? __('No había nada trabado')
                    : r.freed_bytes >= 1024 ** 2
                      ? sprintf(__('Se liberaron %s'), diskSize(r.freed_bytes))
                      : __('El registro de cambios quedó al día');
            const parts = [
                r.permission === 'fixed' ? __('El permiso de la carpeta quedó reparado: la base de datos vuelve a archivar su registro de cambios.') : r.message,
                r.marked > 0 && r.freed_bytes < 1024 ** 2 ? __('Postgres conserva una parte (hasta 1 GB) para reusarla.') : null,
            ].filter(Boolean);
            toast.success(title, parts.length ? parts.join(' ') : undefined);
        },
        onError: (err) => toast.error(__('No se pudo liberar'), err instanceof Error ? err.message : String(err)),
    });

    if (!wal.available) {
        return wal.reason ? (
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="wal-unavailable">
                {wal.reason}
            </p>
        ) : null;
    }
    if (wal.archive_mode === 'off') return null;

    if (wal.health === 'failing') {
        const since = wal.last_archived_at
            ? sprintf(__('desde el %s'), formatDate(new Date(wal.last_archived_at)))
            : __('desde que se creó la base (nunca archivó nada)');
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/5 imcrm-p-3" data-testid="wal-failing">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" aria-hidden />
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <p className="imcrm-font-medium">{__('La base de datos no está archivando su registro de cambios')}</p>
                        <p className="imcrm-text-muted-foreground">
                            {sprintf(
                                __('Falla %1$s. Hay %2$s archivos pendientes (%3$s) que Postgres no puede borrar hasta archivarlos: el disco se va llenando y, si se llena, la base se detiene y la app deja de funcionar.'),
                                since,
                                formatNumber(wal.pending ?? 0),
                                diskSize(wal.pending_bytes),
                            )}
                        </p>
                        <p className="imcrm-text-muted-foreground" data-testid="wal-problem">
                            {wal.problem === 'not_writable'
                                ? sprintf(__('Motivo: Postgres no tiene permiso para escribir en la carpeta del archivo (%s).'), wal.archive_dir ?? '/wal_archive')
                                : sprintf(__('El último intento fallido fue con el segmento %s; el detalle está en el registro del contenedor de Postgres.'), wal.last_failed_wal ?? '—')}
                        </p>
                    </div>
                </div>
                <div className="imcrm-flex imcrm-justify-end">
                    <Button
                        size="sm"
                        variant="destructive"
                        className="imcrm-gap-1.5"
                        disabled={release.isPending}
                        onClick={() =>
                            void confirm({
                                title: __('¿Liberar y reparar?'),
                                description: sprintf(
                                    __('Los %1$s archivos pendientes se dan por archivados sin copiarlos (con el disco casi lleno, copiarlos al mismo disco lo llenaría) y Postgres los borra: se liberan unos %2$s. Lo único que se pierde es poder restaurar la base a un minuto exacto de ese período; las copias de seguridad no se tocan. Después se repara el permiso de la carpeta para que vuelva a archivar.'),
                                    formatNumber(wal.pending ?? 0),
                                    diskSize(wal.pending_bytes),
                                ),
                                confirmLabel: __('Liberar y reparar'),
                            }).then((ok) => ok && release.mutate())
                        }
                        data-testid="wal-release"
                    >
                        {release.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Wrench className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Liberar y reparar')}
                    </Button>
                </div>
            </div>
        );
    }

    const kept =
        wal.archive_files !== null && wal.archive_bytes !== null
            ? sprintf(wal.archive_files === 1 ? __('1 archivo, %2$s') : __('%1$s archivos, %2$s'), formatNumber(wal.archive_files), diskSize(wal.archive_bytes))
            : null;
    return (
        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="wal-ok">
            <CheckCircle2 className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" aria-hidden />
            <span>
                {wal.health === 'ok'
                    ? wal.archive_compressed
                        ? __('Registro de cambios de la base: se archiva bien, comprimido, y se guarda 3 días.')
                        : __('Registro de cambios de la base: se archiva bien y se guarda 3 días; la app lo comprime cada 15 minutos.')
                    : __('Registro de cambios de la base: todavía no se pudo comprobar el archivado.')}
                {kept ? ` ${sprintf(__('Ahora: %s.'), kept)}` : ''}
            </span>
        </p>
    );
}
