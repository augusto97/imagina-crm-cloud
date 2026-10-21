import { useState } from 'react';
import { useStatusTransition } from '@/hooks/useStatusTransition';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RemoteTransfer } from '@imagina-base/shared';
import { Cloud, CloudDownload, Trash2 } from 'lucide-react';
import { Link } from 'react-router';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { CloudApiError } from '@/lib/cloud/client';
import { formatDateTimeStr } from '@/lib/tenantFormat';

export const TRANSFERS_DRIVE_KEY = ['tenant-transfers-drive'] as const;

function formatBytes(n: number): string {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function fmtWhen(iso: string): string {
    return formatDateTimeStr(iso.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
}

/** Estado de la conexión para los botones "Subir a Drive" de cada archivo. */
export function useTransfersDrive() {
    return useQuery({
        queryKey: TRANSFERS_DRIVE_KEY,
        queryFn: () => api.transfersDrive(),
        retry: false,
        refetchInterval: (q) => (q.state.data?.run?.status === 'running' ? 2000 : false),
    });
}

/**
 * v0.1.284 (ADR-S43) — Empresas en Google Drive: un servidor sube el archivo
 * de una empresa (cifrado con su contraseña de recuperación) y otro, conectado
 * al mismo Drive, lo trae con un clic para importarlo. Sin bajar ni subir
 * archivos a mano.
 */
export function PlatformTransfersDrive({ onFetched }: { onFetched: () => void }): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const q = useTransfersDrive();
    const s = q.data;
    const [target, setTarget] = useState<RemoteTransfer | null>(null);
    const [pass, setPass] = useState('');
    const [error, setError] = useState<string | null>(null);
    const refresh = () => void qc.invalidateQueries({ queryKey: TRANSFERS_DRIVE_KEY });

    const runStatus = s?.run?.status;
    // Al terminar una descarga, el archivo aparece en la lista de arriba.
    // v0.1.286 — sólo en la TRANSICIÓN: al abrir la pestaña con la última
    // descarga ya terminada se volvían a pedir transferencias y estadísticas.
    useStatusTransition(runStatus, (st) => {
        if (st === 'success' || st === 'failed') onFetched();
    });

    const fetchM = useMutation({
        mutationFn: () => api.transferFromDrive(target!.id, pass),
        onSuccess: () => {
            setTarget(null);
            setPass('');
            setError(null);
            refresh();
        },
        onError: (e: unknown) => setError(e instanceof CloudApiError ? e.message : 'No se pudo traer la empresa.'),
    });
    const removeM = useMutation({
        mutationFn: (id: string) => api.transferDriveRemove(id),
        onSuccess: refresh,
        onError: (e: unknown) => setError(e instanceof CloudApiError ? e.message : 'No se pudo borrar.'),
    });

    if (q.isError || !s) return null;
    const running = s.run?.status === 'running';

    return (
        <div className="imcrm-space-y-2" data-testid="transfers-drive">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <Cloud className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                En Google Drive ({s.files.length})
            </div>
            {!s.ready && (
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="transfers-drive-reason">
                    {s.reason ?? 'Google Drive no está disponible.'}{' '}
                    <Link className="imcrm-underline" to="/platform?tab=backups">
                        Ir a Copias de seguridad
                    </Link>
                </p>
            )}
            {s.run && (
                <div
                    className={[
                        'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                        s.run.status === 'failed'
                            ? 'imcrm-bg-rose-100 imcrm-text-rose-800'
                            : s.run.status === 'success'
                              ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                              : 'imcrm-bg-muted/50 imcrm-text-muted-foreground',
                    ].join(' ')}
                    data-testid="transfers-drive-run"
                >
                    {s.run.message}
                </div>
            )}
            {error && <div className="imcrm-rounded-md imcrm-bg-rose-100 imcrm-p-2 imcrm-text-sm imcrm-text-rose-800">{error}</div>}
            {s.ready && s.files.length === 0 && (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    No hay empresas en el Drive. Usa «Subir a Drive» en un archivo de arriba; desde otro servidor conectado al mismo Drive
                    aparece aquí para traerla.
                </p>
            )}
            <ul className="imcrm-space-y-2" data-testid="transfers-drive-files">
                {s.files.map((f) => (
                    <li key={f.id} className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-testid="transfers-drive-row">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-sm imcrm-font-medium">{f.tenant_name}</span>
                            {f.app_version && <Badge variant="secondary">v{f.app_version}</Badge>}
                            {f.this_server ? <Badge variant="info">de este servidor</Badge> : <Badge variant="outline">de {f.instance}</Badge>}
                        </div>
                        <div className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                            {fmtWhen(f.exported_at)} · {formatBytes(f.size_bytes)}
                            {f.records !== null ? ` · ${f.records} registros` : ''}
                        </div>
                        <div className="imcrm-mt-2 imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            <Button
                                size="sm"
                                disabled={running}
                                onClick={() => {
                                    setTarget(f);
                                    setPass('');
                                    setError(null);
                                }}
                                data-testid="transfers-drive-fetch"
                            >
                                <CloudDownload className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                Traer a este servidor
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                disabled={running || removeM.isPending}
                                onClick={() => {
                                    void confirm({
                                        title: 'Borrar la empresa del Drive',
                                        description: `El archivo de «${f.tenant_name}» se borra de Google Drive. No se puede deshacer.`,
                                        confirmLabel: 'Borrar',
                                        destructive: true,
                                    }).then((ok) => ok && removeM.mutate(f.id));
                                }}
                                data-testid="transfers-drive-delete"
                            >
                                <Trash2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                Borrar del Drive
                            </Button>
                        </div>
                        {target?.id === f.id && (
                            <form
                                className="imcrm-mt-3 imcrm-space-y-2 imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    fetchM.mutate();
                                }}
                            >
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {f.this_server
                                        ? 'Escribe la contraseña de recuperación de este servidor.'
                                        : `Escribe la contraseña de recuperación de ${f.instance} (el servidor que la subió).`}{' '}
                                    Queda como un archivo más en la lista de arriba, listo para «Importar aquí».
                                </p>
                                <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Contraseña de recuperación" data-testid="transfers-drive-pass" />
                                <div className="imcrm-flex imcrm-gap-2">
                                    <Button size="sm" type="submit" disabled={!pass || fetchM.isPending} data-testid="transfers-drive-fetch-go">
                                        {fetchM.isPending ? 'Comprobando…' : 'Traer'}
                                    </Button>
                                    <Button size="sm" type="button" variant="ghost" onClick={() => setTarget(null)}>
                                        Cancelar
                                    </Button>
                                </div>
                            </form>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
