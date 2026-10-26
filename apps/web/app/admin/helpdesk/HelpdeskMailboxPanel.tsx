import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Inbox, Loader2, PlugZap, RefreshCw, Stethoscope, Unplug, XCircle } from 'lucide-react';
import {
    defaultImapPort,
    IMAP_PRESET_KEYS,
    IMAP_PRESETS,
    type HelpdeskMailboxDto,
    type HelpdeskMailboxInput,
    type ImapDiagnostic,
    type ImapPresetKey,
    type ImapSecurity,
} from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
    useCheckHelpdeskMailbox,
    useHelpdeskMailbox,
    useRemoveHelpdeskMailbox,
    useSaveHelpdeskMailbox,
    useTestHelpdeskMailbox,
} from '@/hooks/useHelpdesk';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { DIAGNOSTIC_STEP_LABELS, MESSAGE_STATUS_LABELS, MESSAGE_STATUS_VARIANT } from './helpdeskUi';

interface Form {
    preset: ImapPresetKey;
    host: string;
    port: string;
    security: ImapSecurity;
    username: string;
    password: string;
    folder: string;
    support_address: string;
    mark_seen: boolean;
    allow_invalid_cert: boolean;
    enabled: boolean;
}

const EMPTY: Form = {
    preset: 'gmail',
    host: IMAP_PRESETS.gmail.host,
    port: '993',
    security: 'tls',
    username: '',
    password: '',
    folder: 'INBOX',
    support_address: '',
    mark_seen: false,
    allow_invalid_cert: false,
    enabled: true,
};

function formFrom(m: HelpdeskMailboxDto): Form {
    return {
        preset: m.preset,
        host: m.host,
        port: String(m.port),
        security: m.security,
        username: m.username,
        password: '',
        folder: m.folder,
        support_address: m.support_address,
        mark_seen: m.mark_seen,
        allow_invalid_cert: m.allow_invalid_cert,
        enabled: m.enabled,
    };
}

function errorMessage(err: unknown): string {
    if (err instanceof ApiError) {
        const first = Object.values(err.errors)[0];
        return first ? `${err.message} (${first})` : err.message;
    }
    return err instanceof Error ? err.message : __('Algo salió mal.');
}

/**
 * D2 — Ajustes de la lista → «Correo entrante»: el buzón de soporte.
 *
 * El equipo elige su proveedor (Gmail, Microsoft, Zoho u otro) y ve los pasos
 * para crear la CONTRASEÑA DE APLICACIÓN; «Probar conexión» dice en lenguaje
 * claro en qué paso se cortó (servidor, conexión, TLS, usuario y contraseña,
 * carpeta). Conectado, el panel muestra el estado de la lectura (cada minuto),
 * los errores y los últimos correos con qué se hizo con cada uno.
 */
export function HelpdeskMailboxPanel({ listId }: { listId: number }): JSX.Element {
    const mailbox = useHelpdeskMailbox(listId);
    const save = useSaveHelpdeskMailbox(listId);
    const remove = useRemoveHelpdeskMailbox(listId);
    const test = useTestHelpdeskMailbox(listId);
    const check = useCheckHelpdeskMailbox(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const [form, setForm] = useState<Form>(EMPTY);
    const [editing, setEditing] = useState(false);
    const [diag, setDiag] = useState<ImapDiagnostic | null>(null);
    const [formError, setFormError] = useState<string | null>(null);

    const current = mailbox.data ?? null;
    useEffect(() => {
        if (current && !editing) setForm(formFrom(current));
    }, [current, editing]);

    const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((f) => ({ ...f, [key]: value }));
    const choosePreset = (key: ImapPresetKey): void => {
        const p = IMAP_PRESETS[key];
        setForm((f) => ({ ...f, preset: key, host: p.host || (f.preset === 'generic' ? f.host : ''), port: String(p.port), security: p.security }));
        setDiag(null);
    };
    const chooseSecurity = (security: ImapSecurity): void => {
        // El puerto y el cifrado van juntos (993 ↔ SSL/TLS, 143 ↔ STARTTLS), como en el SMTP.
        setForm((f) => ({ ...f, security, port: String(defaultImapPort(security)) }));
    };

    const payload = (): HelpdeskMailboxInput => ({
        preset: form.preset,
        host: form.host.trim(),
        port: Number(form.port) || defaultImapPort(form.security),
        security: form.security,
        username: form.username.trim(),
        ...(form.password.trim() !== '' ? { password: form.password.trim() } : {}),
        folder: form.folder.trim() || 'INBOX',
        support_address: form.support_address.trim(),
        mark_seen: form.mark_seen,
        allow_invalid_cert: form.allow_invalid_cert,
        enabled: form.enabled,
    });

    const runTest = (): void => {
        setDiag(null);
        const { support_address: _s, ...rest } = payload();
        test.mutate(rest, {
            onSuccess: (d) => setDiag(d),
            onError: (err) => setDiag({ ok: false, step: 'connect', message: errorMessage(err), hints: [] }),
        });
    };

    const submit = (): void => {
        setFormError(null);
        save.mutate(payload(), {
            onSuccess: () => {
                setEditing(false);
                setDiag(null);
                toast.success(current ? __('Buzón actualizado') : __('Buzón conectado'), __('Los correos que lleguen desde ahora entran como tickets.'));
            },
            onError: (err) => setFormError(errorMessage(err)),
        });
    };

    const disconnect = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Desconectar el buzón de soporte?'),
            description: __('Los correos dejan de entrar como tickets. Los tickets y los correos ya recibidos se conservan, y en el buzón no se borra nada.'),
            confirmLabel: __('Desconectar'),
            destructive: true,
        });
        if (!ok) return;
        remove.mutate(undefined, {
            onSuccess: () => {
                setForm(EMPTY);
                toast.success(__('Buzón desconectado'));
            },
            onError: (err) => toast.error(__('No se pudo desconectar'), errorMessage(err)),
        });
    };

    if (mailbox.isLoading) {
        return <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />;
    }

    const showForm = current === null || editing;
    const preset = IMAP_PRESETS[form.preset];

    return (
        <Card data-testid="imcrm-helpdesk-mailbox">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                    <Inbox className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {__('Buzón de soporte')}
                </CardTitle>
                <CardDescription>
                    {__('Conecta la casilla a la que te escriben los clientes (soporte@tuempresa.com). Cada correo nuevo crea un ticket en esta lista y las respuestas del cliente se suman a su ticket. No se borra ni se mueve nada del buzón.')}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {current && !editing && <MailboxStatus mailbox={current} />}

                {current && !editing && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button size="sm" variant="secondary" onClick={() => check.mutate(undefined, { onSuccess: () => toast.success(__('Revisando el buzón…')) })} disabled={check.isPending}>
                            <RefreshCw className={cn('imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5', check.isPending && 'imcrm-animate-spin')} />
                            {__('Revisar ahora')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(true)} data-testid="imcrm-helpdesk-mailbox-edit">
                            {__('Cambiar la conexión')}
                        </Button>
                        <Button size="sm" variant="ghost" className="imcrm-text-destructive" onClick={() => void disconnect()}>
                            <Unplug className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Desconectar')}
                        </Button>
                    </div>
                )}

                {showForm && (
                    <form
                        className="imcrm-flex imcrm-flex-col imcrm-gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            submit();
                        }}
                    >
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <Label>{__('¿Dónde está el buzón?')}</Label>
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 sm:imcrm-grid-cols-4" role="radiogroup">
                                {IMAP_PRESET_KEYS.map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        role="radio"
                                        aria-checked={form.preset === key}
                                        onClick={() => choosePreset(key)}
                                        className={cn(
                                            'imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                                            form.preset === key
                                                ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-font-medium'
                                                : 'imcrm-border-border hover:imcrm-bg-muted/50',
                                        )}
                                        data-testid={`imcrm-helpdesk-preset-${key}`}
                                    >
                                        {__(IMAP_PRESETS[key].label)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3 imcrm-text-sm">
                            <p className="imcrm-mb-1.5 imcrm-font-medium">{__('Cómo conectarlo')}</p>
                            <ol className="imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-1 imcrm-pl-5 imcrm-text-muted-foreground">
                                {preset.steps.map((step) => (
                                    <li key={step}>{__(step)}</li>
                                ))}
                            </ol>
                            {preset.app_password_url && (
                                <a
                                    href={preset.app_password_url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="imcrm-mt-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-primary hover:imcrm-underline"
                                >
                                    {__('Crear la contraseña de aplicación')}
                                    <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                </a>
                            )}
                            {preset.warning && (
                                <p className="imcrm-mt-2 imcrm-flex imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-warning/10 imcrm-p-2 imcrm-text-[13px] imcrm-text-[hsl(var(--imcrm-warning-ink))]">
                                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                                    {__(preset.warning)}
                                </p>
                            )}
                        </div>

                        <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                            <Field label={__('Dirección de soporte (la que ven tus clientes)')} htmlFor="hd-support">
                                <Input
                                    id="hd-support"
                                    type="email"
                                    placeholder="soporte@tuempresa.com"
                                    value={form.support_address}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        setForm((f) => ({ ...f, support_address: v, username: f.username === '' || f.username === f.support_address ? v : f.username }));
                                    }}
                                    required
                                />
                            </Field>
                            <Field label={__('Usuario del buzón')} htmlFor="hd-user">
                                <Input id="hd-user" autoComplete="off" value={form.username} onChange={(e) => set('username', e.target.value)} required />
                            </Field>
                            <Field
                                label={__('Contraseña de aplicación')}
                                htmlFor="hd-pass"
                                hint={
                                    current?.password_state === 'unreadable'
                                        ? __('No se puede leer la contraseña guardada: escríbela de nuevo.')
                                        : current
                                          ? __('Déjala vacía para conservar la que está guardada.')
                                          : null
                                }
                                warn={current?.password_state === 'unreadable'}
                            >
                                <Input id="hd-pass" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} />
                            </Field>
                            <Field label={__('Carpeta')} htmlFor="hd-folder" hint={__('INBOX es la bandeja de entrada.')}>
                                <Input id="hd-folder" value={form.folder} onChange={(e) => set('folder', e.target.value)} />
                            </Field>
                            <Field label={__('Servidor IMAP')} htmlFor="hd-host">
                                <Input id="hd-host" placeholder="imap.tuempresa.com" value={form.host} onChange={(e) => set('host', e.target.value)} required />
                            </Field>
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                                <Field label={__('Seguridad')} htmlFor="hd-sec">
                                    <Select id="hd-sec" value={form.security} onChange={(e) => chooseSecurity(e.target.value as ImapSecurity)}>
                                        <option value="tls">{__('SSL/TLS')}</option>
                                        <option value="starttls">{__('STARTTLS')}</option>
                                        <option value="none">{__('Sin cifrar')}</option>
                                    </Select>
                                </Field>
                                <Field label={__('Puerto')} htmlFor="hd-port">
                                    <Input id="hd-port" inputMode="numeric" value={form.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
                                </Field>
                            </div>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-sm">
                            <Check checked={form.mark_seen} onChange={(v) => set('mark_seen', v)}>
                                {__('Marcar como leídos los correos que se procesan (por defecto no se toca nada del buzón).')}
                            </Check>
                            <Check checked={form.allow_invalid_cert} onChange={(v) => set('allow_invalid_cert', v)}>
                                {__('Aceptar un certificado que no se puede verificar (sólo para un servidor propio).')}
                            </Check>
                            {current && (
                                <Check checked={form.enabled} onChange={(v) => set('enabled', v)}>
                                    {__('Leer el buzón (desmárcalo para pausar la entrada de correos).')}
                                </Check>
                            )}
                        </div>

                        {diag && <DiagnosticBox diag={diag} />}
                        {formError && (
                            <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                                {formError}
                            </p>
                        )}

                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            <Button type="button" variant="secondary" onClick={runTest} disabled={test.isPending || form.host.trim() === '' || form.username.trim() === ''} data-testid="imcrm-helpdesk-test">
                                {test.isPending ? <Loader2 className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Stethoscope className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />}
                                {test.isPending ? __('Probando…') : __('Probar conexión')}
                            </Button>
                            <Button type="submit" disabled={save.isPending} data-testid="imcrm-helpdesk-save">
                                <PlugZap className="imcrm-mr-1.5 imcrm-h-4 imcrm-w-4" />
                                {save.isPending ? __('Guardando…') : current ? __('Guardar') : __('Conectar el buzón')}
                            </Button>
                            {current && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setEditing(false);
                                        setDiag(null);
                                        setFormError(null);
                                    }}
                                >
                                    {__('Cancelar')}
                                </Button>
                            )}
                        </div>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}

function Field({
    label,
    htmlFor,
    hint,
    warn = false,
    children,
}: {
    label: string;
    htmlFor: string;
    hint?: string | null;
    warn?: boolean;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {hint && <p className={cn('imcrm-text-xs', warn ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>{hint}</p>}
        </div>
    );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2">
            <input type="checkbox" className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span className="imcrm-text-muted-foreground">{children}</span>
        </label>
    );
}

/** El resultado de «Probar conexión»: en qué paso se cortó y qué hacer. */
function DiagnosticBox({ diag }: { diag: ImapDiagnostic }): JSX.Element {
    return (
        <div
            role="status"
            data-testid="imcrm-helpdesk-diagnostic"
            className={cn(
                'imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-sm',
                diag.ok ? 'imcrm-border-success/30 imcrm-bg-success/5' : 'imcrm-border-destructive/30 imcrm-bg-destructive/5',
            )}
        >
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                {diag.ok ? <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-hidden /> : <XCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-destructive" aria-hidden />}
                {diag.ok ? diag.message : `${DIAGNOSTIC_STEP_LABELS[diag.step]}: ${diag.message}`}
            </p>
            {diag.hints.length > 0 && (
                <ul className="imcrm-mt-1.5 imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-1 imcrm-pl-5 imcrm-text-muted-foreground">
                    {diag.hints.map((h) => (
                        <li key={h}>{h}</li>
                    ))}
                </ul>
            )}
            {diag.folders && diag.folders.length > 0 && (
                <p className="imcrm-mt-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Carpetas del buzón:')} {diag.folders.slice(0, 20).join(', ')}
                </p>
            )}
        </div>
    );
}

/** El estado de la lectura y los últimos correos procesados. */
function MailboxStatus({ mailbox }: { mailbox: HelpdeskMailboxDto }): JSX.Element {
    const st = mailbox.state;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-helpdesk-status">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                {!mailbox.enabled ? (
                    <Badge variant="secondary">{__('En pausa')}</Badge>
                ) : st.last_error ? (
                    <Badge variant="destructive">{__('Con problemas')}</Badge>
                ) : st.pending_reason ? (
                    <Badge variant="warning">{__('Correos en espera')}</Badge>
                ) : (
                    <Badge variant="success">{__('Conectado')}</Badge>
                )}
                <span className="imcrm-font-medium">{mailbox.support_address}</span>
                <span className="imcrm-text-muted-foreground">
                    · {mailbox.username} @ {mailbox.host}
                    {mailbox.folder !== 'INBOX' ? ` · ${mailbox.folder}` : ''}
                </span>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {st.last_check_at
                    ? sprintf(__('Última revisión: %s. Se revisa cada minuto.'), relativeTime(st.last_check_at))
                    : __('Todavía no se revisó: la primera lectura toma los correos que lleguen DESDE AHORA.')}
                {' '}
                {[
                    sprintf(_n('%d ticket nuevo', '%d tickets nuevos', st.counts.tickets), st.counts.tickets),
                    sprintf(_n('%d respuesta', '%d respuestas', st.counts.replies), st.counts.replies),
                    sprintf(_n('%d ignorado', '%d ignorados', st.counts.ignored), st.counts.ignored),
                ].join(', ')}
                .
            </p>
            {mailbox.password_state === 'unreadable' && (
                <p className="imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" role="alert">
                    {__('No se puede leer la contraseña guardada (cambió la clave de cifrado del servidor). Toca «Cambiar la conexión» y escríbela de nuevo.')}
                </p>
            )}
            {st.last_error && (
                <p className="imcrm-flex imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-destructive/10 imcrm-p-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-destructive-ink))]" role="alert" data-testid="imcrm-helpdesk-last-error">
                    <XCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {st.last_error}
                </p>
            )}
            {st.pending_reason && (
                <p className="imcrm-flex imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-warning/10 imcrm-p-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-warning-ink))]" role="status">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    {st.pending_reason}
                </p>
            )}
            {mailbox.recent.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <p className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Últimos correos')}</p>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {mailbox.recent.map((m) => (
                            <li key={m.id} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-px-3 imcrm-py-2 imcrm-text-sm sm:imcrm-flex-row sm:imcrm-items-center sm:imcrm-gap-3">
                                <Badge variant={MESSAGE_STATUS_VARIANT[m.status]} className="imcrm-w-fit">
                                    {MESSAGE_STATUS_LABELS[m.status]}
                                </Badge>
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                                    <span className="imcrm-font-medium">{m.subject || __('(sin asunto)')}</span>
                                    <span className="imcrm-text-muted-foreground">
                                        {' · '}
                                        {m.direction === 'out' ? `→ ${m.to ?? ''}` : (m.from_name || m.from_email || '')}
                                    </span>
                                    {m.reason && <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{m.reason}</span>}
                                </span>
                                <time className="imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground" title={formatDateTime(parseUtcDate(m.at))}>
                                    {relativeTime(m.at)}
                                </time>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
