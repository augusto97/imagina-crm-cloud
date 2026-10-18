import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RECOVERY_PASSPHRASE_MIN, type BackupDriveStatus, type DriveConnectPoll, type RemoteBackup } from '@imagina-base/shared';
import { Cloud, Copy, Download, ExternalLink, KeyRound, LogOut, Trash2 } from 'lucide-react';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { CloudApiError } from '@/lib/cloud/client';
import { formatDateTimeStr } from '@/lib/tenantFormat';

export const DRIVE_STATUS_KEY = ['backups-drive'] as const;
const DRIVE_FILES_KEY = ['backups-drive-files'] as const;

function formatBytes(n: number): string {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtWhen(iso: string | null | undefined): string {
    if (!iso) return '—';
    return formatDateTimeStr(iso.replace('T', ' ').replace(/(\.\d+)?Z$/, ''));
}

/** Estado de la copia externa, para la cabecera. */
function stateBadge(s: BackupDriveStatus): { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' } {
    if (s.broken) return { label: 'Hay que reconectar', variant: 'destructive' };
    if (!s.configured) return { label: 'Sin configurar', variant: 'secondary' };
    if (!s.connected) return { label: 'Sin conectar', variant: 'secondary' };
    if (!s.passphrase_set) return { label: 'Falta la contraseña', variant: 'warning' };
    if (!s.enabled) return { label: 'Subida apagada', variant: 'secondary' };
    if (s.last_upload && !s.last_upload.ok) return { label: 'La última subida falló', variant: 'destructive' };
    return { label: 'Activa', variant: 'success' };
}

/**
 * v0.1.282 (ADR-S43) — Copia del servidor FUERA del servidor: cada copia se
 * sube cifrada al Google Drive del operador. Es lo que permite levantar la
 * app en un VPS nuevo si éste se pierde (kit de recuperación).
 */
export function BackupsDrivePanel(): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const statusQ = useQuery({ queryKey: DRIVE_STATUS_KEY, queryFn: () => api.backupDriveStatus(), retry: false });
    const s = statusQ.data;
    const filesQ = useQuery({
        queryKey: DRIVE_FILES_KEY,
        queryFn: () => api.backupDriveFiles(),
        enabled: !!s?.connected && !s.broken,
        retry: false,
    });
    const refresh = () => {
        void qc.invalidateQueries({ queryKey: DRIVE_STATUS_KEY });
        void qc.invalidateQueries({ queryKey: DRIVE_FILES_KEY });
    };
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    const onError = (e: unknown) => setNotice({ kind: 'err', text: e instanceof CloudApiError ? e.message : 'No se pudo completar la operación.' });

    // Cliente de Google.
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [editClient, setEditClient] = useState(false);
    const saveClient = useMutation({
        mutationFn: () => api.backupDriveUpdate({ client_id: clientId.trim(), ...(clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}) }),
        onSuccess: () => {
            setClientSecret('');
            setEditClient(false);
            setNotice({ kind: 'ok', text: 'Cliente de Google guardado.' });
            refresh();
        },
        onError,
    });

    // Conexión por código.
    const [connect, setConnect] = useState<DriveConnectPoll | null>(null);
    const start = useMutation({
        mutationFn: () => api.backupDriveConnect(),
        onSuccess: (r) => {
            setNotice(null);
            setConnect(r);
        },
        onError,
    });
    const pending = connect?.state === 'pending' ? connect : s?.pending ? { state: 'pending' as const, message: null, user_code: s.pending.user_code, verification_url: s.pending.verification_url, account_email: null } : null;
    useEffect(() => {
        if (!pending) return;
        const t = window.setInterval(() => {
            api.backupDrivePoll()
                .then((r) => {
                    setConnect(r);
                    if (r.state === 'connected') {
                        setNotice({ kind: 'ok', text: `Google Drive conectado (${r.account_email ?? 'cuenta de Google'}).` });
                        refresh();
                    } else if (r.state !== 'pending') {
                        if (r.message) setNotice({ kind: 'err', text: r.message });
                        refresh();
                    }
                })
                .catch(onError);
        }, 3000);
        return () => window.clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pending?.user_code]);
    const cancel = useMutation({
        mutationFn: () => api.backupDriveCancel(),
        onSuccess: () => {
            setConnect(null);
            refresh();
        },
    });

    // Contraseña de recuperación.
    const [pass, setPass] = useState('');
    const [pass2, setPass2] = useState('');
    const [editPass, setEditPass] = useState(false);
    const passError = pass.length > 0 && pass.length < RECOVERY_PASSPHRASE_MIN ? `Usa al menos ${RECOVERY_PASSPHRASE_MIN} caracteres.` : pass2.length > 0 && pass !== pass2 ? 'Las dos contraseñas no coinciden.' : null;
    const savePass = useMutation({
        mutationFn: () => api.backupDriveUpdate({ passphrase: pass }),
        onSuccess: () => {
            setPass('');
            setPass2('');
            setEditPass(false);
            setNotice({ kind: 'ok', text: 'Contraseña de recuperación guardada. Guárdala también en tu gestor de contraseñas.' });
            refresh();
        },
        onError,
    });

    // Ajustes.
    const [enabled, setEnabled] = useState(true);
    const [keep, setKeep] = useState(14);
    const [instance, setInstance] = useState('');
    const [touched, setTouched] = useState(false);
    useEffect(() => {
        if (!s || touched) return;
        setEnabled(s.enabled);
        setKeep(s.keep);
        setInstance(s.instance);
        if (!editClient) setClientId(s.client_id ?? '');
    }, [s, touched, editClient]);
    const saveSettings = useMutation({
        mutationFn: () => api.backupDriveUpdate({ enabled, keep, instance: instance.trim() }),
        onSuccess: () => {
            setTouched(false);
            setNotice({ kind: 'ok', text: 'Ajustes guardados.' });
            refresh();
        },
        onError,
    });

    const disconnect = useMutation({
        mutationFn: () => api.backupDriveDisconnect(),
        onSuccess: () => {
            setConnect(null);
            setNotice({ kind: 'ok', text: 'Google Drive desconectado. Las copias que ya están en el Drive siguen ahí.' });
            refresh();
        },
        onError,
    });
    const removeRemote = useMutation({
        mutationFn: (id: string) => api.backupDriveDelete(id),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Copia borrada del Drive.' });
            refresh();
        },
        onError,
    });

    if (statusQ.isError || !s) return null;
    const badge = stateBadge(s);
    const showClientForm = !s.configured || editClient;

    return (
        <Card data-testid="backups-drive">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                            <Cloud className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </span>
                        <div>
                            <CardTitle>Copia fuera del servidor · Google Drive</CardTitle>
                            <CardDescription>
                                Cada copia se sube cifrada a tu Google Drive. Si el servidor se pierde, instalas uno nuevo, conectas el
                                mismo Drive y eliges la copia.
                            </CardDescription>
                        </div>
                    </div>
                    <Badge dot variant={badge.variant} className="imcrm-shrink-0" data-testid="drive-state">
                        {badge.label}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                {notice && (
                    <div className={['imcrm-rounded-md imcrm-p-2 imcrm-text-sm', notice.kind === 'ok' ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800' : 'imcrm-bg-rose-100 imcrm-text-rose-800'].join(' ')} data-testid="drive-notice">
                        {notice.text}
                    </div>
                )}
                {s.broken && (
                    <div className="imcrm-rounded-md imcrm-bg-rose-100 imcrm-p-2 imcrm-text-sm imcrm-text-rose-800" data-testid="drive-broken">
                        {s.broken}
                    </div>
                )}

                {/* 1. Cliente de Google */}
                <Step n={1} title="Cliente de Google" done={s.configured && !editClient}>
                    {showClientForm ? (
                        <div className="imcrm-space-y-3">
                            <ol className="imcrm-list-decimal imcrm-space-y-1 imcrm-pl-5 imcrm-text-xs imcrm-text-muted-foreground">
                                <li>
                                    En{' '}
                                    <a className="imcrm-underline" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">
                                        Google Cloud
                                    </a>{' '}
                                    (puede ser el mismo proyecto de Integraciones) habilita la <b>Google Drive API</b>.
                                </li>
                                <li>
                                    En <b>Google Auth Platform → Clientes → Crear cliente</b> elige el tipo{' '}
                                    <b>«TV y dispositivos de entrada limitada»</b>. Ese tipo permite conectar con un código, sin dominio:
                                    sirve igual en un servidor recién instalado.
                                </li>
                                <li>
                                    En <b>Público</b>, publica la app (con el permiso <code>drive.file</code> no hace falta verificarla). Si
                                    queda «En prueba», Google corta la conexión cada 7 días.
                                </li>
                                <li>Copia aquí el ID y el secreto del cliente.</li>
                            </ol>
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                                <label className="imcrm-block imcrm-space-y-1">
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">ID del cliente</span>
                                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" className="imcrm-h-8" data-testid="drive-client-id" />
                                </label>
                                <label className="imcrm-block imcrm-space-y-1">
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">Secreto del cliente</span>
                                    <Input
                                        type="password"
                                        value={clientSecret}
                                        onChange={(e) => setClientSecret(e.target.value)}
                                        placeholder={s.client_secret_hint ? 'Déjalo vacío para conservar el actual' : 'GOCSPX-…'}
                                        className="imcrm-h-8"
                                        data-testid="drive-client-secret"
                                    />
                                </label>
                            </div>
                            <div className="imcrm-flex imcrm-gap-2">
                                <Button
                                    size="sm"
                                    onClick={() => saveClient.mutate()}
                                    disabled={saveClient.isPending || clientId.trim().length < 10 || (!s.client_secret_hint && clientSecret.trim().length < 6)}
                                    data-testid="drive-client-save"
                                >
                                    {saveClient.isPending ? 'Guardando…' : 'Guardar'}
                                </Button>
                                {editClient && (
                                    <Button size="sm" variant="ghost" onClick={() => setEditClient(false)}>
                                        Cancelar
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <code className="imcrm-truncate imcrm-text-xs">{s.client_id}</code>
                            <Button size="sm" variant="ghost" className="imcrm-h-7" onClick={() => setEditClient(true)}>
                                Cambiar
                            </Button>
                        </div>
                    )}
                </Step>

                {/* 2. Conectar */}
                <Step n={2} title="Conectar tu Google Drive" done={s.connected && !s.broken} disabled={!s.configured}>
                    {pending ? (
                        <div className="imcrm-space-y-2 imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-sm" data-testid="drive-code">
                            <p>
                                Abre{' '}
                                <a className="imcrm-font-medium imcrm-underline" href={pending.verification_url ?? 'https://www.google.com/device'} target="_blank" rel="noreferrer">
                                    {(pending.verification_url ?? 'https://www.google.com/device').replace(/^https?:\/\//, '')}
                                </a>{' '}
                                e ingresa este código con la cuenta de Google donde quieres guardar las copias:
                            </p>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-font-mono imcrm-text-2xl imcrm-font-semibold imcrm-tracking-widest" data-testid="drive-user-code">
                                    {pending.user_code}
                                </span>
                                <Button size="sm" variant="ghost" className="imcrm-h-7 imcrm-px-2" title="Copiar el código" onClick={() => void navigator.clipboard?.writeText(pending.user_code ?? '')}>
                                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                </Button>
                            </div>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">Esperando la autorización… esta pantalla se actualiza sola.</p>
                            <Button size="sm" variant="ghost" onClick={() => cancel.mutate()}>
                                Cancelar
                            </Button>
                        </div>
                    ) : s.connected && !s.broken ? (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <span>
                                Conectado con <b data-testid="drive-account">{s.account_email ?? 'tu cuenta de Google'}</b>
                            </span>
                            {s.folder_url && (
                                <a className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-underline" href={s.folder_url} target="_blank" rel="noreferrer">
                                    Abrir la carpeta <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                                </a>
                            )}
                        </div>
                    ) : (
                        <Button size="sm" onClick={() => start.mutate()} disabled={!s.configured || start.isPending} data-testid="drive-connect">
                            {start.isPending ? 'Pidiendo el código…' : s.broken ? 'Volver a conectar' : 'Conectar Google Drive'}
                        </Button>
                    )}
                </Step>

                {/* 3. Contraseña de recuperación */}
                <Step n={3} title="Contraseña de recuperación" done={s.passphrase_set && !editPass}>
                    {s.passphrase_set && !editPass ? (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <KeyRound className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                            <span>Definida. Las copias se cifran con ella antes de salir del servidor.</span>
                            <Button size="sm" variant="ghost" className="imcrm-h-7" onClick={() => setEditPass(true)}>
                                Cambiar
                            </Button>
                        </div>
                    ) : (
                        <div className="imcrm-space-y-2">
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                Protege TODO lo que va en la copia (datos y secretos del servidor). <b>Sin ella las copias no se pueden
                                abrir</b> y no hay forma de recuperarla: guárdala en un gestor de contraseñas, fuera de este servidor.
                                {s.passphrase_set ? ' Las copias que ya están en el Drive siguen con la contraseña anterior.' : ''}
                            </p>
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                                <Input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={`Al menos ${RECOVERY_PASSPHRASE_MIN} caracteres`} className="imcrm-h-8" data-testid="drive-pass" />
                                <Input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Repítela" className="imcrm-h-8" data-testid="drive-pass2" />
                            </div>
                            {passError && <p className="imcrm-text-xs imcrm-text-destructive">{passError}</p>}
                            <div className="imcrm-flex imcrm-gap-2">
                                <Button size="sm" onClick={() => savePass.mutate()} disabled={savePass.isPending || !!passError || pass.length < RECOVERY_PASSPHRASE_MIN || pass !== pass2} data-testid="drive-pass-save">
                                    {savePass.isPending ? 'Guardando…' : 'Guardar contraseña'}
                                </Button>
                                {editPass && (
                                    <Button size="sm" variant="ghost" onClick={() => setEditPass(false)}>
                                        Cancelar
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </Step>

                {/* Ajustes + estado */}
                {s.connected && (
                    <div className="imcrm-space-y-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3">
                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={(e) => {
                                        setTouched(true);
                                        setEnabled(e.target.checked);
                                    }}
                                    data-testid="drive-enabled"
                                />
                                Subir cada copia al Drive
                            </label>
                            <label className="imcrm-block imcrm-space-y-1">
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">Conservar en el Drive (copias)</span>
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
                                    data-testid="drive-keep"
                                />
                            </label>
                            <label className="imcrm-block imcrm-space-y-1">
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">Nombre de este servidor</span>
                                <Input
                                    value={instance}
                                    onChange={(e) => {
                                        setTouched(true);
                                        setInstance(e.target.value);
                                    }}
                                    className="imcrm-h-8"
                                    data-testid="drive-instance"
                                />
                            </label>
                        </div>
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            Cada servidor guarda sus copias en su propia subcarpeta, con este nombre. Las copias automáticas se
                            programan arriba, en «Copias automáticas».
                        </p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <Button size="sm" variant="ghost" onClick={() => saveSettings.mutate()} disabled={!touched || saveSettings.isPending || instance.trim() === ''} data-testid="drive-save-settings">
                                {saveSettings.isPending ? 'Guardando…' : 'Guardar ajustes'}
                            </Button>
                        </div>
                        {s.last_upload && (
                            <div className={['imcrm-rounded-md imcrm-p-2 imcrm-text-sm', s.last_upload.ok ? 'imcrm-bg-emerald-100 imcrm-text-emerald-800' : 'imcrm-bg-rose-100 imcrm-text-rose-800'].join(' ')} data-testid="drive-last-upload">
                                <b>Última subida ({fmtWhen(s.last_upload.at)}):</b> {s.last_upload.message}
                            </div>
                        )}
                    </div>
                )}

                {/* Kit + desconectar */}
                {s.configured && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button asChild size="sm" variant="secondary">
                            <a href={api.backupDriveKitUrl()} download data-testid="drive-kit">
                                <Download className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                Descargar el kit de recuperación
                            </a>
                        </Button>
                        {s.connected && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    void confirm({
                                        title: 'Desconectar Google Drive',
                                        description: 'Las copias dejarán de subirse. Las que ya están en el Drive no se borran.',
                                        confirmLabel: 'Desconectar',
                                        destructive: true,
                                    }).then((ok) => ok && disconnect.mutate());
                                }}
                                data-testid="drive-disconnect"
                            >
                                <LogOut className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                                Desconectar
                            </Button>
                        )}
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            El kit trae los pasos y el cliente de Google para el servidor nuevo (no la contraseña).
                        </span>
                    </div>
                )}

                {/* Copias en el Drive */}
                {s.connected && !s.broken && (
                    <RemoteList
                        files={filesQ.data ?? []}
                        loading={filesQ.isLoading}
                        error={filesQ.error instanceof CloudApiError ? filesQ.error.message : filesQ.isError ? 'No se pudo leer el Drive.' : null}
                        onDelete={(b) => {
                            void confirm({
                                title: 'Borrar la copia del Drive',
                                description: `${b.name} se borra de Google Drive. No se puede deshacer.`,
                                confirmLabel: 'Borrar',
                                destructive: true,
                            }).then((ok) => ok && removeRemote.mutate(b.id));
                        }}
                    />
                )}
            </CardContent>
        </Card>
    );
}

function Step({ n, title, done, disabled, children }: { n: number; title: string; done: boolean; disabled?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <div className={['imcrm-flex imcrm-gap-3', disabled ? 'imcrm-opacity-50' : ''].join(' ')} data-testid={`drive-step-${n}`}>
            <span
                className={[
                    'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-xs imcrm-font-semibold',
                    done ? 'imcrm-bg-success/15 imcrm-text-success' : 'imcrm-bg-muted imcrm-text-muted-foreground',
                ].join(' ')}
            >
                {done ? '✓' : n}
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-space-y-1.5">
                <div className="imcrm-text-sm imcrm-font-medium">{title}</div>
                {children}
            </div>
        </div>
    );
}

function RemoteList({ files, loading, error, onDelete }: { files: RemoteBackup[]; loading: boolean; error: string | null; onDelete: (b: RemoteBackup) => void }): JSX.Element {
    return (
        <div className="imcrm-space-y-2">
            <div className="imcrm-text-sm imcrm-font-medium">Copias en el Drive</div>
            {error ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>
            ) : loading ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">Leyendo el Drive…</p>
            ) : files.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="drive-files-empty">
                    Todavía no hay copias en el Drive. La próxima copia se sube sola; también puedes subir una que ya está en el servidor con el botón de la nube, en «Copias guardadas».
                </p>
            ) : (
                <div className="imcrm-overflow-x-auto">
                    <table className="imcrm-w-full imcrm-text-sm" data-testid="drive-files">
                        <thead>
                            <tr className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                                <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Fecha</th>
                                <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Servidor</th>
                                <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Versión</th>
                                <th className="imcrm-py-1 imcrm-pr-3 imcrm-font-medium">Tamaño</th>
                                <th className="imcrm-py-1 imcrm-font-medium"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map((b) => (
                                <tr key={b.id} className="imcrm-border-t imcrm-border-border" data-testid="drive-file-row">
                                    <td className="imcrm-whitespace-nowrap imcrm-py-1.5 imcrm-pr-3">{fmtWhen(b.created_at)}</td>
                                    <td className="imcrm-py-1.5 imcrm-pr-3">
                                        <span className="imcrm-mr-1">{b.instance}</span>
                                        {b.this_server && <Badge variant="info">este</Badge>}
                                    </td>
                                    <td className="imcrm-py-1.5 imcrm-pr-3 imcrm-font-mono imcrm-text-xs">{b.app_version ?? '—'}</td>
                                    <td className="imcrm-whitespace-nowrap imcrm-py-1.5 imcrm-pr-3 imcrm-tabular-nums">{formatBytes(b.size_bytes)}</td>
                                    <td className="imcrm-py-1.5">
                                        <div className="imcrm-flex imcrm-justify-end">
                                            <Button size="sm" variant="ghost" className="imcrm-h-7 imcrm-px-2 imcrm-text-destructive" title="Borrar del Drive" onClick={() => onDelete(b)} data-testid="drive-file-delete">
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
        </div>
    );
}
