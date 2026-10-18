import { useEffect, useMemo, useState } from 'react';
import { type DriveConnectPoll, type RecoveryStatus, type RemoteBackup } from '@imagina-base/shared';
import { CheckCircle2, Cloud, Copy, LifeBuoy, Loader2, Sparkles } from 'lucide-react';

import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloudApiError } from '@/lib/cloud/client';

/** `/recuperar` (v0.1.283, ADR-S43): fuera del router, como /verify y /reset. */
export function isRecoveryPath(): boolean {
    try {
        return /\/recuperar\/?$/.test(window.location.pathname);
    } catch {
        return false;
    }
}

const STEP_LABEL: Record<string, string> = {
    download: 'Bajando la copia',
    decrypt: 'Descifrando',
    env: 'Instalando los secretos del servidor',
    data: 'Recreando la base de datos',
    version: 'Instalando la versión de la copia',
    restore: 'Restaurando los datos',
    restart: 'Reiniciando',
    done: 'Listo',
    failed: 'Falló',
};
const ORDER = ['download', 'decrypt', 'env', 'data', 'version', 'restore', 'done'];

function msg(e: unknown): string {
    return e instanceof CloudApiError || e instanceof Error ? e.message : 'No se pudo completar la operación.';
}
function fmtWhen(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}
function formatBytes(n: number): string {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-min-h-screen imcrm-items-start imcrm-justify-center imcrm-bg-canvas imcrm-px-4 imcrm-py-10 sm:imcrm-items-center">
            <div className="imcrm-w-full imcrm-max-w-xl imcrm-space-y-5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-md sm:imcrm-p-8" data-testid="recovery">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                        <LifeBuoy className="imcrm-h-5 imcrm-w-5" />
                    </span>
                    <div>
                        <h1 className="imcrm-text-lg imcrm-font-semibold">Servidor nuevo</h1>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">Imagina Base · modo recuperación</p>
                    </div>
                </div>
                {children}
            </div>
        </div>
    );
}

function ErrorLine({ text }: { text: string | null }): JSX.Element | null {
    if (!text) return null;
    return (
        <div className="imcrm-rounded-md imcrm-bg-rose-100 imcrm-p-2 imcrm-text-sm imcrm-text-rose-800" data-testid="recovery-error">
            {text}
        </div>
    );
}

/**
 * v0.1.283 (ADR-S43) — Asistente del servidor recién instalado: con el código
 * que mostró install.sh se elige restaurar una copia del Google Drive (cliente
 * de Google → conectar → copia → contraseña → progreso) o empezar de cero.
 */
export function RecoveryPage(): JSX.Element {
    const [status, setStatus] = useState<RecoveryStatus | null>(null);
    const [gone, setGone] = useState(false);
    const [load, setLoad] = useState<'loading' | 'ready' | 'off'>('loading');
    const [mode, setMode] = useState<'choose' | 'drive' | 'fresh'>('choose');
    const [freshDone, setFreshDone] = useState(false);

    const refresh = async (): Promise<void> => {
        try {
            const s = await api.recoveryStatus();
            setStatus(s);
            setLoad('ready');
        } catch (e) {
            // 404: el modo se apagó (ya hay empresas) → si había una restauración, terminó.
            if (e instanceof CloudApiError && e.status === 404) {
                setGone(true);
                setLoad('off');
                return;
            }
            if (load === 'loading') setLoad('off');
        }
    };
    useEffect(() => {
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const run = status?.run ?? null;
    const restoring = !!run && !['done', 'failed'].includes(run.step);
    // Mientras se restaura (y mientras el API se reinicia) se pregunta cada 2 s.
    useEffect(() => {
        if (!restoring && run?.step !== 'done') return;
        const t = window.setInterval(() => {
            api.recoveryStatus()
                .then(setStatus)
                .catch((e: unknown) => {
                    if (e instanceof CloudApiError && e.status === 404) setGone(true);
                });
        }, 2000);
        return () => window.clearInterval(t);
    }, [restoring, run?.step]);

    if (gone || freshDone) {
        return (
            <Shell>
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-py-4 imcrm-text-center" data-testid="recovery-finished">
                    <CheckCircle2 className="imcrm-h-10 imcrm-w-10 imcrm-text-success" />
                    <h2 className="imcrm-text-base imcrm-font-semibold">{freshDone ? 'Tu cuenta está lista' : 'El servidor ya está funcionando'}</h2>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {freshDone ? 'Entra con el correo y la contraseña que acabas de crear.' : 'Entra con tu cuenta de siempre.'}
                    </p>
                    <Button onClick={() => window.location.assign('/')} data-testid="recovery-go-app">
                        Ir a la app
                    </Button>
                </div>
            </Shell>
        );
    }
    if (load === 'loading') {
        return (
            <Shell>
                <Loader2 className="imcrm-mx-auto imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-muted-foreground" />
            </Shell>
        );
    }
    if (load === 'off' || !status) {
        return (
            <Shell>
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="recovery-off">
                    Este servidor no está en modo recuperación: ya está en uso.
                </p>
                <Button variant="outline" onClick={() => window.location.assign('/')}>
                    Ir a la app
                </Button>
            </Shell>
        );
    }
    if (!status.unlocked) return <UnlockStep onDone={refresh} />;
    if (run && (restoring || run.step === 'done')) return <ProgressStep status={status} />;
    return (
        <Shell>
            {run?.step === 'failed' && <ErrorLine text={run.message} />}
            {mode === 'choose' && (
                <div className="imcrm-space-y-3">
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">Imagina Base {status.app_version} está instalada. ¿Qué quieres hacer?</p>
                    <button
                        type="button"
                        onClick={() => setMode('drive')}
                        className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-4 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5"
                        data-testid="recovery-mode-drive"
                    >
                        <Cloud className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-primary" />
                        <span>
                            <span className="imcrm-block imcrm-text-sm imcrm-font-medium">Restaurar una copia de Google Drive</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                Trae todo lo del servidor anterior: datos, archivos, ajustes y secretos. Necesitas el kit de recuperación y la contraseña.
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode('fresh')}
                        className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-4 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5"
                        data-testid="recovery-mode-fresh"
                    >
                        <Sparkles className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-primary" />
                        <span>
                            <span className="imcrm-block imcrm-text-sm imcrm-font-medium">Empezar de cero</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">Crea tu cuenta de operador y tu primera empresa.</span>
                        </span>
                    </button>
                </div>
            )}
            {mode === 'drive' && <DriveFlow status={status} onBack={() => setMode('choose')} onStarted={refresh} />}
            {mode === 'fresh' && <FreshFlow status={status} onBack={() => setMode('choose')} onDone={() => setFreshDone(true)} />}
        </Shell>
    );
}

function UnlockStep({ onDone }: { onDone: () => Promise<void> }): JSX.Element {
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    return (
        <Shell>
            <form
                className="imcrm-space-y-3"
                onSubmit={(e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError(null);
                    api.recoveryUnlock(code)
                        .then(onDone)
                        .catch((err: unknown) => setError(msg(err)))
                        .finally(() => setBusy(false));
                }}
            >
                <p className="imcrm-text-sm">Escribe el código que mostró el instalador en la terminal del servidor.</p>
                <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX-XXXX"
                    autoFocus
                    autoComplete="off"
                    className="imcrm-font-mono imcrm-text-lg imcrm-tracking-widest"
                    data-testid="recovery-code"
                />
                <ErrorLine text={error} />
                <Button type="submit" disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 6} data-testid="recovery-unlock">
                    {busy ? 'Comprobando…' : 'Continuar'}
                </Button>
            </form>
        </Shell>
    );
}

function DriveFlow({ status, onBack, onStarted }: { status: RecoveryStatus; onBack: () => void; onStarted: () => Promise<void> }): JSX.Element {
    const drive = status.drive;
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [configured, setConfigured] = useState(!!drive?.configured);
    const [connected, setConnected] = useState(!!drive?.connected && !drive.broken);
    const [account, setAccount] = useState<string | null>(drive?.account_email ?? null);
    const [pending, setPending] = useState<DriveConnectPoll | null>(null);
    const [files, setFiles] = useState<RemoteBackup[] | null>(null);
    const [picked, setPicked] = useState<string | null>(null);
    const [pass, setPass] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!pending) return;
        const t = window.setInterval(() => {
            api.recoveryDrivePoll()
                .then((r) => {
                    if (r.state === 'connected') {
                        setPending(null);
                        setConnected(true);
                        setAccount(r.account_email);
                    } else if (r.state !== 'pending') {
                        setPending(null);
                        setError(r.message);
                    }
                })
                .catch((e: unknown) => setError(msg(e)));
        }, 3000);
        return () => window.clearInterval(t);
    }, [pending]);

    useEffect(() => {
        if (!connected) return;
        api.recoveryDriveFiles()
            .then((list) => {
                setFiles(list);
                setPicked((p) => p ?? list[0]?.id ?? null);
            })
            .catch((e: unknown) => setError(msg(e)));
    }, [connected]);

    const chosen = useMemo(() => files?.find((f) => f.id === picked) ?? null, [files, picked]);

    return (
        <div className="imcrm-space-y-4">
            <ErrorLine text={error} />
            {!configured ? (
                <div className="imcrm-space-y-2">
                    <div className="imcrm-text-sm imcrm-font-medium">1. Cliente de Google</div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Copia el ID y el secreto del <b>kit de recuperación</b> (el archivo que descargaste en el servidor anterior). Tiene que ser el mismo
                        cliente: Google sólo deja ver las copias a la app que las subió.
                    </p>
                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ID del cliente (…apps.googleusercontent.com)" data-testid="recovery-client-id" />
                    <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Secreto del cliente" data-testid="recovery-client-secret" />
                    <Button
                        disabled={busy || clientId.trim().length < 10 || clientSecret.trim().length < 6}
                        onClick={() => {
                            setBusy(true);
                            setError(null);
                            api.recoveryDriveClient(clientId.trim(), clientSecret.trim())
                                .then(() => setConfigured(true))
                                .catch((e: unknown) => setError(msg(e)))
                                .finally(() => setBusy(false));
                        }}
                        data-testid="recovery-client-save"
                    >
                        Continuar
                    </Button>
                </div>
            ) : !connected ? (
                <div className="imcrm-space-y-2">
                    <div className="imcrm-text-sm imcrm-font-medium">2. Conectar tu Google Drive</div>
                    {pending ? (
                        <div className="imcrm-space-y-2 imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-sm" data-testid="recovery-drive-code">
                            <p>
                                Abre{' '}
                                <a className="imcrm-font-medium imcrm-underline" href={pending.verification_url ?? 'https://www.google.com/device'} target="_blank" rel="noreferrer">
                                    {(pending.verification_url ?? 'https://www.google.com/device').replace(/^https?:\/\//, '')}
                                </a>{' '}
                                con la cuenta donde están las copias y escribe:
                            </p>
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                <span className="imcrm-font-mono imcrm-text-2xl imcrm-font-semibold imcrm-tracking-widest" data-testid="recovery-user-code">
                                    {pending.user_code}
                                </span>
                                <Button size="sm" variant="ghost" className="imcrm-h-7 imcrm-px-2" title="Copiar" onClick={() => void navigator.clipboard?.writeText(pending.user_code ?? '')}>
                                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                </Button>
                            </div>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">Esperando la autorización…</p>
                        </div>
                    ) : (
                        <Button
                            disabled={busy}
                            onClick={() => {
                                setBusy(true);
                                setError(null);
                                api.recoveryDriveConnect()
                                    .then(setPending)
                                    .catch((e: unknown) => setError(msg(e)))
                                    .finally(() => setBusy(false));
                            }}
                            data-testid="recovery-drive-connect"
                        >
                            Conectar Google Drive
                        </Button>
                    )}
                </div>
            ) : (
                <div className="imcrm-space-y-3">
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Conectado con <b>{account ?? 'tu cuenta de Google'}</b>.
                    </p>
                    <div className="imcrm-text-sm imcrm-font-medium">3. Elige la copia</div>
                    {files === null ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">Leyendo el Drive…</p>
                    ) : files.length === 0 ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="recovery-no-files">
                            No hay copias en ese Drive. ¿Es la misma cuenta de Google y el mismo cliente del kit?
                        </p>
                    ) : (
                        <div className="imcrm-max-h-72 imcrm-space-y-1.5 imcrm-overflow-y-auto" data-testid="recovery-files">
                            {files.map((f) => (
                                <label
                                    key={f.id}
                                    className={[
                                        'imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-p-2.5 imcrm-text-sm',
                                        picked === f.id ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border',
                                    ].join(' ')}
                                    data-testid="recovery-file"
                                >
                                    <input type="radio" name="copia" checked={picked === f.id} onChange={() => setPicked(f.id)} />
                                    <span className="imcrm-min-w-0 imcrm-flex-1">
                                        <span className="imcrm-block imcrm-font-medium">{fmtWhen(f.created_at)}</span>
                                        <span className="imcrm-block imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                                            {f.instance} · versión {f.app_version ?? '?'} · {formatBytes(f.size_bytes)}
                                            {f.includes && !f.includes.env ? ' · sin secretos (no sirve aquí)' : ''}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    )}
                    {chosen && (
                        <div className="imcrm-space-y-2">
                            <div className="imcrm-text-sm imcrm-font-medium">4. Contraseña de recuperación</div>
                            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="La que definiste al activar las copias" data-testid="recovery-pass" />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                Se restauran los datos, los archivos, los ajustes y los secretos del servidor de la copia
                                {chosen.app_version && chosen.app_version !== status.app_version ? ` (y se instala su versión, ${chosen.app_version})` : ''}. Tarda unos minutos.
                            </p>
                            <Button
                                disabled={busy || pass.length < 1}
                                onClick={() => {
                                    setBusy(true);
                                    setError(null);
                                    api.recoveryRestore({ file_id: chosen.id, passphrase: pass })
                                        .then(onStarted)
                                        .catch((e: unknown) => setError(msg(e)))
                                        .finally(() => setBusy(false));
                                }}
                                data-testid="recovery-restore"
                            >
                                {busy ? 'Comprobando…' : 'Restaurar esta copia'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
            <Button variant="ghost" size="sm" onClick={onBack} disabled={busy}>
                Volver
            </Button>
        </div>
    );
}

function ProgressStep({ status }: { status: RecoveryStatus }): JSX.Element {
    const run = status.run!;
    const at = ORDER.indexOf(run.step === 'restore' || run.step === 'version' ? 'restore' : run.step);
    return (
        <Shell>
            <div className="imcrm-space-y-3" data-testid="recovery-progress">
                <p className="imcrm-text-sm">{run.message}</p>
                {run.step === 'download' && run.pct !== null && (
                    <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                        <div className="imcrm-h-full imcrm-bg-primary imcrm-transition-all" style={{ width: `${run.pct}%` }} />
                    </div>
                )}
                <ol className="imcrm-space-y-1.5 imcrm-text-sm">
                    {['download', 'decrypt', 'env', 'data', 'restore', 'done'].map((step, i) => {
                        const idx = ORDER.indexOf(step);
                        const state = run.step === 'done' || idx < at ? 'done' : idx === at ? 'now' : 'next';
                        return (
                            <li key={step} className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                {state === 'done' ? (
                                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-success" />
                                ) : state === 'now' ? (
                                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" />
                                ) : (
                                    <span className="imcrm-inline-block imcrm-h-4 imcrm-w-4 imcrm-rounded-full imcrm-border imcrm-border-border" />
                                )}
                                <span className={state === 'next' ? 'imcrm-text-muted-foreground' : ''}>
                                    {i + 1}. {STEP_LABEL[step === 'restore' && run.step === 'version' ? 'version' : step]}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                {run.step === 'done' && (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> El servidor se está reiniciando con tus datos…
                    </p>
                )}
                <p className="imcrm-text-xs imcrm-text-muted-foreground">No cierres esta pestaña; se actualiza sola.</p>
            </div>
        </Shell>
    );
}

function FreshFlow({ status, onBack, onDone }: { status: RecoveryStatus; onBack: () => void; onDone: () => void }): JSX.Element {
    const [email, setEmail] = useState(status.superadmins[0] ?? '');
    const [name, setName] = useState('');
    const [workspace, setWorkspace] = useState('');
    const [password, setPassword] = useState('');
    const [password2, setPassword2] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const mismatch = password2.length > 0 && password !== password2;
    return (
        <form
            className="imcrm-space-y-3"
            onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                api.recoveryFresh({ email, name, password, workspace_name: workspace })
                    .then(onDone)
                    .catch((err: unknown) => setError(msg(err)))
                    .finally(() => setBusy(false));
            }}
        >
            <p className="imcrm-text-sm">Tu cuenta de operador (con acceso a la consola de la plataforma) y tu primera empresa.</p>
            <ErrorLine text={error} />
            <label className="imcrm-block imcrm-space-y-1">
                <span className="imcrm-text-xs imcrm-text-muted-foreground">Correo (el que diste al instalar)</span>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="fresh-email" />
            </label>
            <label className="imcrm-block imcrm-space-y-1">
                <span className="imcrm-text-xs imcrm-text-muted-foreground">Tu nombre</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="fresh-name" />
            </label>
            <label className="imcrm-block imcrm-space-y-1">
                <span className="imcrm-text-xs imcrm-text-muted-foreground">Nombre de tu empresa</span>
                <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} data-testid="fresh-workspace" />
            </label>
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2">
                <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (8+)" data-testid="fresh-pass" />
                <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} placeholder="Repítela" data-testid="fresh-pass2" />
            </div>
            {mismatch && <p className="imcrm-text-xs imcrm-text-destructive">Las dos contraseñas no coinciden.</p>}
            <div className="imcrm-flex imcrm-gap-2">
                <Button type="submit" disabled={busy || mismatch || password.length < 8 || !name.trim() || !workspace.trim() || !email.trim()} data-testid="fresh-create">
                    {busy ? 'Creando…' : 'Crear la cuenta'}
                </Button>
                <Button type="button" variant="ghost" onClick={onBack}>
                    Volver
                </Button>
            </div>
        </form>
    );
}

