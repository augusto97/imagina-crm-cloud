import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupRunStatus, BackupSnapshot, BackupsStatus } from '@imagina-base/shared';
import { DatabaseBackup, Download, HardDriveDownload, RotateCcw, Trash2 } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CloudApiError } from '@/lib/cloud/client';
import { formatDateTimeStr } from '@/lib/tenantFormat';

const IN_PROGRESS: BackupRunStatus[] = ['queued', 'running', 'restoring'];
const STATUS_LABEL: Record<BackupRunStatus, string> = {
    idle: 'Sin actividad',
    queued: 'En cola…',
    running: 'Creando la copia…',
    restoring: 'Restaurando…',
    success: 'Listo ✓',
    failed: 'Falló',
};
const KIND_LABEL: Record<BackupSnapshot['kind'], string> = {
    snapshot: 'Copia completa',
    db_dump: 'Sólo base de datos',
    pre_restore: 'Copia previa a un restore',
};

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** ISO (UTC) → naive-UTC `YYYY-MM-DD HH:MM:SS` que entiende formatDateTimeStr. */
function fmtWhen(iso: string | null): string {
    if (!iso) return '—';
    return formatDateTimeStr(iso.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
}

/**
 * v0.1.179 — Copias de seguridad completas (ADR-S20). Sólo superadmin de
 * plataforma (403 → no renderiza). Crea, programa, descarga, restaura y
 * borra snapshots; explica cómo migrar a otro servidor con ellos.
 */
export function BackupsPanel(): JSX.Element | null {
    const qc = useQueryClient();
    const statusQ = useQuery({
        queryKey: ['backups-status'],
        queryFn: () => api.backupsStatus(),
        retry: false,
        refetchInterval: (q) => (q.state.data && IN_PROGRESS.includes(q.state.data.run.status) ? 3000 : false),
    });
    const invalidate = () => void qc.invalidateQueries({ queryKey: ['backups-status'] });
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const onError = (e: unknown) => setNotice({ kind: 'err', text: e instanceof CloudApiError ? e.message : 'No se pudo completar la operación.' });

    const create = useMutation({
        mutationFn: () => api.backupsCreate(),
        onSuccess: (r) => {
            setNotice({ kind: r.queued ? 'ok' : 'err', text: r.message });
            invalidate();
        },
        onError,
    });
    const remove = useMutation({
        mutationFn: (name: string) => api.backupsRemove(name),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Copia eliminada.' });
            invalidate();
        },
        onError,
    });
    const restore = useMutation({
        mutationFn: (name: string) => api.backupsRestore(name),
        onSuccess: (r) => {
            setNotice({ kind: r.ok ? 'ok' : 'err', text: r.message });
            setRestoreTarget(null);
            invalidate();
        },
        onError,
    });

    // Ajustes de copias automáticas (form con borrador local).
    const [enabled, setEnabled] = useState(false);
    const [hour, setHour] = useState(3);
    const [keep, setKeep] = useState(14);
    const [includeEnv, setIncludeEnv] = useState(true);
    const [touched, setTouched] = useState(false);
    useEffect(() => {
        const s = statusQ.data?.settings;
        if (!s || touched) return;
        setEnabled(s.enabled);
        setHour(s.hour_utc);
        setKeep(s.keep);
        setIncludeEnv(s.include_env);
    }, [statusQ.data?.settings, touched]);
    const saveSettings = useMutation({
        mutationFn: () => api.backupsSetSettings({ enabled, hour_utc: hour, keep, include_env: includeEnv }),
        onSuccess: () => {
            setTouched(false);
            setNotice({ kind: 'ok', text: 'Ajustes guardados.' });
            invalidate();
        },
        onError,
    });

    const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
    const [confirmText, setConfirmText] = useState('');

    if (statusQ.isError || !statusQ.data) return null;
    const s: BackupsStatus = statusQ.data;
    const busy = IN_PROGRESS.includes(s.run.status);

    return (
        <div className="imcrm-space-y-4" data-testid="backups-panel">
            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                                <DatabaseBackup className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            </span>
                            <div>
                                <CardTitle>Sistema · Copias de seguridad</CardTitle>
                                <CardDescription>
                                    Una copia completa = base de datos + archivos subidos + ajustes de plataforma + secretos del
                                    servidor. Con ella se vuelve a un estado anterior o se levanta la app en otro servidor.
                                </CardDescription>
                            </div>
                        </div>
                        {s.available ? (
                            <Badge dot variant={s.settings.enabled ? 'success' : 'secondary'} className="imcrm-shrink-0">
                                {s.settings.enabled ? 'Automáticas activas' : 'Automáticas apagadas'}
                            </Badge>
                        ) : null}
                    </div>
                </CardHeader>
                <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                    {!s.available && (
                        <div className="imcrm-rounded-md imcrm-bg-amber-100 imcrm-p-2 imcrm-text-sm imcrm-text-amber-900" data-testid="backups-unavailable">
                            {s.reason}
                        </div>
                    )}
                    <dl className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 imcrm-text-sm sm:imcrm-grid-cols-4">
                        <div>
                            <dt className="imcrm-text-xs imcrm-text-muted-foreground">Versión actual</dt>
                            <dd className="imcrm-font-mono">{s.current_version}</dd>
                        </div>
                        <div>
                            <dt className="imcrm-text-xs imcrm-text-muted-foreground">Última copia</dt>
                            <dd data-testid="backups-last">{fmtWhen(s.last_snapshot_at)}</dd>
                        </div>
                        <div>
                            <dt className="imcrm-text-xs imcrm-text-muted-foreground">Próxima automática</dt>
                            <dd>{s.settings.enabled ? fmtWhen(s.next_run_at) : 'Apagadas'}</dd>
                        </div>
                        <div>
                            <dt className="imcrm-text-xs imcrm-text-muted-foreground">Carpeta</dt>
                            <dd className="imcrm-truncate imcrm-font-mono imcrm-text-xs" title={s.backups_dir ?? ''}>
                                {s.backups_dir ?? '—'}
                            </dd>
                        </div>
                    </dl>

                    {s.run.status !== 'idle' && (
                        <div
                            data-testid="backups-run"
                            className={[
                                'imcrm-rounded-md imcrm-p-2 imcrm-text-sm',
                                s.run.status === 'failed'
                                    ? 'imcrm-bg-rose-100 imcrm-text-rose-800'
                                    : s.run.status === 'success'
                                      ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800'
                                      : 'imcrm-bg-muted/50 imcrm-text-muted-foreground',
                            ].join(' ')}
                        >
                            <b>{STATUS_LABEL[s.run.status]}</b>
                            {s.run.message ? ` — ${s.run.message}` : ''}
                            {s.run.file ? ` (${s.run.file})` : ''}
                        </div>
                    )}
                    {notice && (
                        <div className={['imcrm-rounded-md imcrm-p-2 imcrm-text-sm', notice.kind === 'ok' ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800' : 'imcrm-bg-rose-100 imcrm-text-rose-800'].join(' ')}>
                            {notice.text}
                        </div>
                    )}

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button size="sm" onClick={() => create.mutate()} disabled={!s.available || busy || create.isPending} data-testid="backups-create">
                            <HardDriveDownload className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                            {busy ? 'En curso…' : 'Crear copia ahora'}
                        </Button>
                    </div>

                    {/* Copias automáticas */}
                    <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                        <div className="imcrm-mb-2 imcrm-text-sm imcrm-font-medium">Copias automáticas</div>
                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-4">
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={(e) => {
                                        setTouched(true);
                                        setEnabled(e.target.checked);
                                    }}
                                    data-testid="backups-enabled"
                                />
                                Todos los días
                            </label>
                            <label className="imcrm-block imcrm-space-y-1">
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">Hora (UTC)</span>
                                <select
                                    value={hour}
                                    onChange={(e) => {
                                        setTouched(true);
                                        setHour(Number(e.target.value));
                                    }}
                                    className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                    data-testid="backups-hour"
                                >
                                    {Array.from({ length: 24 }, (_, h) => (
                                        <option key={h} value={h}>
                                            {String(h).padStart(2, '0')}:05
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="imcrm-block imcrm-space-y-1">
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">Conservar (copias)</span>
                                <Input
                                    type="number"
                                    min={1}
                                    max={90}
                                    value={keep}
                                    onChange={(e) => {
                                        setTouched(true);
                                        setKeep(Math.max(1, Math.min(90, Number(e.target.value) || 1)));
                                    }}
                                    className="imcrm-h-8"
                                    data-testid="backups-keep"
                                />
                            </label>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={includeEnv}
                                    onChange={(e) => {
                                        setTouched(true);
                                        setIncludeEnv(e.target.checked);
                                    }}
                                />
                                Incluir secretos (.env)
                            </label>
                        </div>
                        <p className="imcrm-mt-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                            Sin los secretos del .env, las contraseñas SMTP y los códigos 2FA de la copia no se pueden leer en
                            otro servidor. Guardá las copias en un lugar seguro (o cifralas con BACKUP_GPG_RECIPIENT).
                        </p>
                        <div className="imcrm-mt-2">
                            <Button size="sm" variant="ghost" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending || !touched} data-testid="backups-save-settings">
                                {saveSettings.isPending ? 'Guardando…' : 'Guardar ajustes'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Listado */}
            <Card>
                <CardHeader>
                    <CardTitle>Copias guardadas</CardTitle>
                    <CardDescription>
                        {s.snapshots.length === 0 ? 'Todavía no hay copias.' : `${s.snapshots.length} archivo(s) en el servidor.`}
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-pt-0">
                    {s.snapshots.length > 0 && (
                        <div className="imcrm-overflow-x-auto">
                            <table className="imcrm-w-full imcrm-text-sm" data-testid="backups-table">
                                <thead>
                                    <tr className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                                        <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Fecha</th>
                                        <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Tipo</th>
                                        <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Versión</th>
                                        <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Tamaño</th>
                                        <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Contenido</th>
                                        <th className="imcrm-py-1 imcrm-font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {s.snapshots.map((b) => (
                                        <tr key={b.name} className="imcrm-border-t imcrm-border-border" data-testid="backup-row">
                                            <td className="imcrm-whitespace-nowrap imcrm-py-1.5 imcrm-pr-3">{fmtWhen(b.created_at)}</td>
                                            <td className="imcrm-whitespace-nowrap imcrm-py-1.5 imcrm-pr-3">{KIND_LABEL[b.kind]}</td>
                                            <td className="imcrm-py-1.5 imcrm-pr-3 imcrm-font-mono imcrm-text-xs">{b.app_version ?? '—'}</td>
                                            <td className="imcrm-whitespace-nowrap imcrm-py-1.5 imcrm-pr-3 imcrm-tabular-nums">{formatBytes(b.size_bytes)}</td>
                                            <td className="imcrm-py-1.5 imcrm-pr-3">
                                                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                                    {b.kind === 'snapshot' ? <Badge variant="secondary">base</Badge> : <Badge variant="secondary">base</Badge>}
                                                    {b.includes?.uploads && <Badge variant="secondary">archivos</Badge>}
                                                    {b.includes?.redis && <Badge variant="secondary">plataforma</Badge>}
                                                    {b.includes?.env && <Badge variant="secondary">secretos</Badge>}
                                                    {b.encrypted && <Badge variant="warning">cifrada</Badge>}
                                                    {b.migrations_applied !== null && (
                                                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">· {b.migrations_applied} migraciones</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="imcrm-py-1.5">
                                                <div className="imcrm-flex imcrm-justify-end imcrm-gap-1">
                                                    <Button asChild size="sm" variant="ghost" className="imcrm-h-7 imcrm-px-2" title="Descargar">
                                                        <a href={api.backupDownloadUrl(b.name)} download={b.name} data-testid="backup-download">
                                                            <Download className="imcrm-h-3.5 imcrm-w-3.5" />
                                                        </a>
                                                    </Button>
                                                    {b.kind === 'snapshot' && !b.encrypted && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="imcrm-h-7 imcrm-px-2"
                                                            title={s.restore_available ? 'Restaurar esta copia' : 'Restaurar desde el panel requiere el servidor desplegado (por CLI: snapshot-restore.sh)'}
                                                            disabled={!s.restore_available || busy}
                                                            onClick={() => {
                                                                setConfirmText('');
                                                                setRestoreTarget(b.name);
                                                            }}
                                                            data-testid="backup-restore"
                                                        >
                                                            <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="imcrm-h-7 imcrm-px-2 imcrm-text-destructive"
                                                        title="Eliminar"
                                                        disabled={busy}
                                                        onClick={() => {
                                                            if (window.confirm(`¿Eliminar la copia ${b.name}? No se puede deshacer.`)) remove.mutate(b.name);
                                                        }}
                                                        data-testid="backup-delete"
                                                    >
                                                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {restoreTarget && (
                        <div className="imcrm-mt-3 imcrm-space-y-2 imcrm-rounded-md imcrm-border imcrm-border-rose-300 imcrm-bg-rose-50 imcrm-p-3 imcrm-text-sm" data-testid="restore-confirm">
                            <p className="imcrm-font-medium imcrm-text-rose-900">Restaurar {restoreTarget}</p>
                            <p className="imcrm-text-rose-900/80">
                                La app se detiene, la base de datos y los archivos ACTUALES se reemplazan por los de la copia
                                (se guarda antes una copia de la base actual como pre-restore) y el API vuelve a arrancar. Tarda
                                alrededor de un minuto; nadie puede usar la app mientras tanto.
                            </p>
                            <label className="imcrm-block imcrm-space-y-1">
                                <span className="imcrm-text-xs imcrm-text-rose-900/80">Escribí RESTAURAR para confirmar</span>
                                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="imcrm-h-8 imcrm-max-w-xs" data-testid="restore-confirm-input" />
                            </label>
                            <div className="imcrm-flex imcrm-gap-2">
                                <Button size="sm" variant="destructive" disabled={confirmText !== 'RESTAURAR' || restore.isPending} onClick={() => restore.mutate(restoreTarget)} data-testid="restore-go">
                                    Restaurar ahora
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setRestoreTarget(null)}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Migrar de servidor */}
            <Card>
                <CardHeader>
                    <CardTitle>Migrar a otro servidor</CardTitle>
                    <CardDescription>
                        Con una copia completa la app se levanta en un servidor nuevo con la misma versión, los mismos datos y los
                        mismos secretos. Detalle en <code>docs/runbook-migration.md</code>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-pt-0">
                    <ol className="imcrm-list-decimal imcrm-space-y-1 imcrm-pl-5 imcrm-text-sm">
                        <li>
                            Creá una copia (arriba) o en el servidor viejo:{' '}
                            <code className="imcrm-text-xs">BASE_PATH=/opt/imagina-base ./deploy/snapshot.sh</code>
                        </li>
                        <li>
                            Copiala al servidor nuevo (ya con Docker, Postgres y Redis levantados con el mismo .env):{' '}
                            <code className="imcrm-text-xs">scp shared/backups/imagina-snapshot-….tar nuevo:/tmp/</code>
                        </li>
                        <li>
                            En el nuevo:{' '}
                            <code className="imcrm-text-xs">
                                BASE_PATH=/opt/imagina-base ./bootstrap-server.sh --snapshot /tmp/imagina-snapshot-….tar --install-service
                            </code>{' '}
                            — descarga el release de la misma versión, restaura todo y arranca el API.
                        </li>
                        <li>Configurá Caddy/nginx (una vez) y apuntá el DNS al servidor nuevo.</li>
                    </ol>
                </CardContent>
            </Card>
        </div>
    );
}
