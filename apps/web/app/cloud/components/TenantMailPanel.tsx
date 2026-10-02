import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    MAIL_ACCOUNT_LIMITS,
    integrationDef,
    mailAccountKind,
    type MailAccountCandidate,
    type MailAccountLimits,
    type TenantMailStatus,
} from '@imagina-base/shared';
import { AlertTriangle, Check, Gauge, Info, Mail, Server, Sparkles } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { TenantSmtpPanel } from '@/cloud/components/TenantSmtpPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

type Mode = TenantMailStatus['mode'];

export const MAIL_STATUS_KEY = (tenantId: number | null): readonly unknown[] => ['tenant-mail', tenantId];

/**
 * Ajustes → Correo (v0.1.249, ADR-S29). Cómo salen los correos que manda la
 * empresa (automatizaciones, enlaces del portal, avisos): por la plataforma,
 * por su cuenta de Google o Microsoft, o por su propio servidor SMTP. Una sola
 * activa a la vez; la tarjeta deja ver las tres y dice cuál está en uso.
 *
 * Con la cuenta de Google/Microsoft los LÍMITES del proveedor van a la vista
 * (cuántos por día, qué pasa si se pasan, cuánto se mandó hoy): son reales y
 * el cliente tiene que conocerlos antes de elegir, no después del bloqueo.
 */
export function TenantMailPanel(): JSX.Element | null {
    const tenantId = useSession((s) => s.activeTenantId);
    const q = useQuery({ queryKey: MAIL_STATUS_KEY(tenantId), queryFn: () => api.tenantMailGet(), retry: false });
    const [view, setView] = useState<Mode | null>(null);

    useEffect(() => {
        if (q.data && view === null) setView(q.data.mode);
    }, [q.data, view]);

    if (q.isError) return null;
    if (!q.data || view === null) {
        return <div className="imcrm-h-40 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />;
    }
    const status = q.data;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="tenant-mail">
            <Card>
                <CardHeader>
                    <CardTitle>Cómo salen los correos de tu empresa</CardTitle>
                    <CardDescription>
                        Avisos de automatizaciones, enlaces del portal del cliente y recordatorios. Elegí una forma de
                        envío: sólo una está activa a la vez.
                    </CardDescription>
                </CardHeader>
                <CardContent className="imcrm-pt-0">
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3" role="tablist" aria-label="Forma de envío">
                        <ModeTile
                            mode="platform"
                            active={status.mode}
                            view={view}
                            onSelect={setView}
                            icon={<Sparkles className="imcrm-h-4 imcrm-w-4" />}
                            title="Correo de la plataforma"
                            text="Listo sin configurar nada. Usa la cuota mensual de tu plan."
                        />
                        <ModeTile
                            mode="account"
                            active={status.mode}
                            view={view}
                            onSelect={setView}
                            icon={
                                <span className="imcrm-flex imcrm-gap-0.5">
                                    <IntegrationLogo integrationKey="gmail" size={16} />
                                    <IntegrationLogo integrationKey="outlook" size={16} />
                                </span>
                            }
                            title="Tu cuenta de Google o Microsoft"
                            text="Sale desde tu Gmail, Workspace u Outlook. Sin contraseñas ni servidores."
                            recommended
                        />
                        <ModeTile
                            mode="smtp"
                            active={status.mode}
                            view={view}
                            onSelect={setView}
                            icon={<Server className="imcrm-h-4 imcrm-w-4" />}
                            title="Tu servidor SMTP"
                            text="Para Brevo, Amazon SES, Mailgun o el servidor de tu hosting."
                        />
                    </div>
                </CardContent>
            </Card>

            {view === 'platform' && <PlatformSection status={status} />}
            {view === 'account' && <AccountSection status={status} />}
            {view === 'smtp' && <SmtpSection status={status} />}
        </div>
    );
}

function ModeTile({
    mode,
    active,
    view,
    onSelect,
    icon,
    title,
    text,
    recommended,
}: {
    mode: Mode;
    active: Mode;
    view: Mode;
    onSelect: (m: Mode) => void;
    icon: React.ReactNode;
    title: string;
    text: string;
    recommended?: boolean;
}): JSX.Element {
    const selected = view === mode;
    return (
        <button
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`mail-mode-${mode}`}
            data-active={active === mode || undefined}
            onClick={() => onSelect(mode)}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-left imcrm-transition-colors',
                selected
                    ? 'imcrm-border-primary imcrm-bg-primary/5 imcrm-ring-2 imcrm-ring-primary/15'
                    : 'imcrm-border-border hover:imcrm-border-foreground/25 hover:imcrm-bg-muted/40',
            )}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-7 imcrm-min-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-px-1 imcrm-text-foreground/70 imcrm-ring-1 imcrm-ring-border">
                    {icon}
                </span>
                {active === mode ? (
                    <Badge variant="success" dot>
                        En uso
                    </Badge>
                ) : recommended ? (
                    <Badge variant="outline">Recomendado</Badge>
                ) : null}
            </span>
            <span className="imcrm-text-sm imcrm-font-medium imcrm-leading-snug">{title}</span>
            <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{text}</span>
        </button>
    );
}

function useMailMutations(): {
    setAccount: ReturnType<typeof useMutation<TenantMailStatus, Error, number>>;
    clearAccount: ReturnType<typeof useMutation<TenantMailStatus, Error, void>>;
} {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const onSuccess = (data: TenantMailStatus): void => {
        qc.setQueryData(MAIL_STATUS_KEY(tenantId), data);
        void qc.invalidateQueries({ queryKey: ['tenant-smtp', tenantId] });
        void qc.invalidateQueries({ queryKey: ['billing'] });
    };
    const setAccount = useMutation<TenantMailStatus, Error, number>({
        mutationFn: (id) => api.tenantMailSetAccount(id),
        onSuccess,
    });
    const clearAccount = useMutation<TenantMailStatus, Error, void>({
        mutationFn: () => api.tenantMailClearAccount(),
        onSuccess,
    });
    return { setAccount, clearAccount };
}

// ── Plataforma ───────────────────────────────────────────────────────────

function PlatformSection({ status }: { status: TenantMailStatus }): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const confirm = useConfirm();
    const { clearAccount } = useMailMutations();
    const [error, setError] = useState<string | null>(null);
    const switchToPlatform = useMutation({
        mutationFn: async () => {
            if (status.mode === 'account') await api.tenantMailClearAccount();
            if (status.smtp_configured) await api.tenantSmtpClear();
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: MAIL_STATUS_KEY(tenantId) });
            void qc.invalidateQueries({ queryKey: ['tenant-smtp', tenantId] });
            void qc.invalidateQueries({ queryKey: ['billing'] });
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo cambiar.'),
    });

    return (
        <Card data-testid="mail-section-platform">
            <CardContent className="imcrm-space-y-3 imcrm-pt-5">
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    Los correos salen por el servidor de la plataforma, con su remitente. No hay que configurar nada,
                    pero consumen la <span className="imcrm-font-medium imcrm-text-foreground">cuota mensual de correos</span>{' '}
                    de tu plan (la ves en Ajustes → Plan y uso). Si una automatización pide otro remitente, esa dirección
                    queda como «responder a».
                </p>
                {status.mode !== 'platform' && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={switchToPlatform.isPending || clearAccount.isPending}
                            onClick={async () => {
                                setError(null);
                                const ok = await confirm({
                                    title: '¿Volver al correo de la plataforma?',
                                    description:
                                        status.mode === 'account'
                                            ? 'Los correos dejan de salir desde tu cuenta y pasan a consumir la cuota del plan.'
                                            : 'Se borra la configuración de tu servidor SMTP y los correos pasan a consumir la cuota del plan.',
                                    confirmLabel: 'Usar el correo de la plataforma',
                                });
                                if (ok) switchToPlatform.mutate();
                            }}
                            data-testid="mail-use-platform"
                        >
                            Usar el correo de la plataforma
                        </Button>
                        {error && <span className="imcrm-text-sm imcrm-text-destructive">{error}</span>}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Cuenta de Google / Microsoft ─────────────────────────────────────────

function AccountSection({ status }: { status: TenantMailStatus }): JSX.Element {
    const myEmail = useSession((s) => s.user?.email ?? '');
    const confirm = useConfirm();
    const { setAccount, clearAccount } = useMailMutations();
    const account = status.mode === 'account' ? status.account : null;
    const [changing, setChanging] = useState(false);
    const usable = status.candidates.filter((c) => c.ready && c.shared);
    const [picked, setPicked] = useState<number | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    useEffect(() => {
        if (picked === null && usable.length > 0) {
            const notCurrent = usable.find((c) => c.connection_id !== account?.connection_id) ?? usable[0]!;
            setPicked(notCurrent.connection_id);
        }
    }, [usable, picked, account?.connection_id]);

    const sendTest = useMutation({
        mutationFn: () => api.tenantSmtpTest(),
        onSuccess: (r) =>
            setNotice(
                r.ok
                    ? { kind: 'ok', text: `Correo de prueba enviado a ${myEmail || 'tu correo'}. Revisá también la carpeta de spam.` }
                    : { kind: 'err', text: r.error ?? 'No se pudo enviar.' },
            ),
        onError: (e) => setNotice({ kind: 'err', text: e instanceof Error ? e.message : 'No se pudo enviar.' }),
    });

    const showPicker = account === null || changing;
    const pickedCandidate = status.candidates.find((c) => c.connection_id === picked) ?? null;

    return (
        <Card data-testid="mail-section-account">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Mail className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    Tu cuenta de Google o Microsoft
                </CardTitle>
                <CardDescription>
                    Los correos se mandan por la API de Gmail o de Outlook con una conexión de Integraciones: sin host,
                    puerto ni contraseña, y sin consumir la cuota de correos del plan. En Microsoft 365 es la forma que
                    funciona (el SMTP con contraseña ya no está disponible).
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
                {account && !changing && (
                    <CurrentAccount
                        status={status}
                        onTest={() => {
                            setNotice(null);
                            sendTest.mutate();
                        }}
                        testing={sendTest.isPending}
                        onChange={() => {
                            setNotice(null);
                            setChanging(true);
                        }}
                        onStop={async () => {
                            setNotice(null);
                            const ok = await confirm({
                                title: '¿Dejar de usar esta cuenta?',
                                description: status.smtp_configured
                                    ? 'Los correos vuelven a salir por tu servidor SMTP guardado.'
                                    : 'Los correos vuelven a salir por el correo de la plataforma (con la cuota del plan).',
                                confirmLabel: 'Dejar de usarla',
                            });
                            if (ok) clearAccount.mutate();
                        }}
                        stopping={clearAccount.isPending}
                    />
                )}

                {showPicker && (
                    <div className="imcrm-space-y-3" data-testid="mail-account-picker">
                        {status.candidates.length === 0 ? (
                            <NoConnections />
                        ) : (
                            <>
                                <p className="imcrm-text-sm imcrm-font-medium">Elegí con qué cuenta salen los correos</p>
                                <div className="imcrm-space-y-2" role="radiogroup">
                                    {status.candidates.map((c) => (
                                        <CandidateRow
                                            key={c.connection_id}
                                            c={c}
                                            selected={picked === c.connection_id}
                                            current={account?.connection_id === c.connection_id}
                                            onSelect={() => setPicked(c.connection_id)}
                                        />
                                    ))}
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    ¿Falta una cuenta?{' '}
                                    <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                        Conectala en Integraciones
                                    </Link>{' '}
                                    (Gmail u Outlook, como conexión del equipo).
                                </p>
                            </>
                        )}
                        {pickedCandidate && (
                            <LimitsBox
                                limits={
                                    MAIL_ACCOUNT_LIMITS[mailAccountKind(pickedCandidate.integration, pickedCandidate.address)]
                                }
                                notes={status.notes}
                                heading="Antes de elegirla: estos son los límites de esa cuenta"
                            />
                        )}
                        {status.candidates.length > 0 && (
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <Button
                                    size="sm"
                                    disabled={
                                        !pickedCandidate ||
                                        !pickedCandidate.ready ||
                                        !pickedCandidate.shared ||
                                        setAccount.isPending ||
                                        pickedCandidate.connection_id === account?.connection_id
                                    }
                                    onClick={() => {
                                        if (!pickedCandidate) return;
                                        setNotice(null);
                                        setAccount.mutate(pickedCandidate.connection_id, {
                                            onSuccess: () => {
                                                setChanging(false);
                                                setNotice({
                                                    kind: 'ok',
                                                    text: `Listo: los correos de la empresa salen desde ${pickedCandidate.address ?? pickedCandidate.name}. Probá el envío para confirmarlo.`,
                                                });
                                            },
                                            onError: (e) => setNotice({ kind: 'err', text: e.message }),
                                        });
                                    }}
                                    data-testid="mail-account-use"
                                >
                                    {setAccount.isPending ? 'Guardando…' : 'Usar esta cuenta'}
                                </Button>
                                {changing && (
                                    <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
                                        Cancelar
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {notice && (
                    <div
                        data-testid="mail-account-notice"
                        className={cn(
                            'imcrm-rounded-md imcrm-p-2.5 imcrm-text-sm',
                            notice.kind === 'ok'
                                ? 'imcrm-bg-success/10 imcrm-text-success'
                                : 'imcrm-bg-destructive/10 imcrm-text-destructive',
                        )}
                    >
                        {notice.text}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function CurrentAccount({
    status,
    onTest,
    testing,
    onChange,
    onStop,
    stopping,
}: {
    status: TenantMailStatus;
    onTest: () => void;
    testing: boolean;
    onChange: () => void;
    onStop: () => void;
    stopping: boolean;
}): JSX.Element {
    const a = status.account!;
    return (
        <div className="imcrm-space-y-4" data-testid="mail-account-current">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                <IntegrationLogo integrationKey={a.integration} size={36} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{a.address ?? a.name ?? 'Cuenta borrada'}</p>
                    <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                        {a.limits?.label ?? 'Conexión no disponible'}
                        {a.name && a.address ? ` · ${a.name}` : ''}
                    </p>
                </div>
                {a.problem ? (
                    <Badge variant="destructive" dot>
                        No está enviando
                    </Badge>
                ) : (
                    <Badge variant="success" dot>
                        Enviando desde esta cuenta
                    </Badge>
                )}
            </div>

            {a.problem && (
                <div className="imcrm-flex imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive" data-testid="mail-account-problem">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <span>
                        <span className="imcrm-font-medium">Los correos de la empresa no están saliendo.</span> {a.problem}
                    </span>
                </div>
            )}

            {a.limits && <UsageToday limits={a.limits} sent={a.sent_today} />}
            {a.limits && <LimitsBox limits={a.limits} notes={status.notes} heading="Límites de esta cuenta" />}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button size="sm" onClick={onTest} disabled={testing || a.problem !== null} data-testid="mail-account-test">
                    {testing ? 'Enviando…' : 'Probar envío'}
                </Button>
                <Button size="sm" variant="outline" onClick={onChange}>
                    Cambiar de cuenta
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="imcrm-ml-auto imcrm-text-muted-foreground"
                    onClick={onStop}
                    disabled={stopping}
                    data-testid="mail-account-stop"
                >
                    Dejar de usarla
                </Button>
            </div>
        </div>
    );
}

/** "Hoy: 37 de ~500" — lo que contamos nosotros, aclarado como aproximado. */
function UsageToday({ limits, sent }: { limits: MailAccountLimits; sent: number }): JSX.Element {
    const pct = Math.min(100, Math.round((sent / limits.daily_recipients) * 100));
    const tone = pct >= 90 ? 'imcrm-bg-destructive' : pct >= 70 ? 'imcrm-bg-warning' : 'imcrm-bg-primary';
    return (
        <div className="imcrm-space-y-1.5" data-testid="mail-account-usage">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2 imcrm-text-sm">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                    <Gauge className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    Enviados hoy desde la app
                </span>
                <span className="imcrm-tabular-nums imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(sent)}</span> de ~
                    {formatNumber(limits.daily_recipients)} destinatarios
                </span>
            </div>
            <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                <div className={cn('imcrm-h-full imcrm-rounded-full imcrm-transition-all', tone)} style={{ width: `${pct}%` }} />
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                Cuenta lo que salió por la app hoy (día UTC). El proveedor suma también lo que esa persona manda a mano
                desde su bandeja.
            </p>
        </div>
    );
}

function LimitsBox({
    limits,
    notes,
    heading,
}: {
    limits: MailAccountLimits;
    notes: string[];
    heading: string;
}): JSX.Element {
    const rows: Array<[string, string]> = [
        ['Por día', limits.daily_label],
        ['Por correo', `Hasta ${formatNumber(limits.per_message)} destinatarios (para, copia y copia oculta)`],
        ...(limits.per_minute ? ([['Por minuto', `Hasta ${formatNumber(limits.per_minute)} correos`]] as Array<[string, string]>) : []),
        ['Si se pasa', limits.on_exceed],
    ];
    return (
        <div className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3" data-testid="mail-account-limits">
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                <Info className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {heading} <span className="imcrm-font-normal imcrm-text-muted-foreground">· {limits.label}</span>
            </p>
            <dl className="imcrm-grid imcrm-gap-x-4 imcrm-gap-y-1.5 imcrm-text-sm sm:imcrm-grid-cols-[8rem_1fr]">
                {rows.map(([k, v]) => (
                    <div key={k} className="imcrm-contents">
                        <dt className="imcrm-text-muted-foreground">{k}</dt>
                        <dd className="imcrm-mb-1 sm:imcrm-mb-0">{v}</dd>
                    </div>
                ))}
            </dl>
            <ul className="imcrm-space-y-1.5 imcrm-border-t imcrm-border-border imcrm-pt-3 imcrm-text-xs imcrm-text-muted-foreground">
                {notes.map((n) => (
                    <li key={n} className="imcrm-flex imcrm-gap-2">
                        <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-foreground/50" />
                        <span>{n}</span>
                    </li>
                ))}
            </ul>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                Son los límites que publican Google y Microsoft; pueden ser menores en cuentas nuevas.
            </p>
        </div>
    );
}

function CandidateRow({
    c,
    selected,
    current,
    onSelect,
}: {
    c: MailAccountCandidate;
    selected: boolean;
    current: boolean;
    onSelect: () => void;
}): JSX.Element {
    const disabled = !c.ready || !c.shared;
    const reason = !c.shared
        ? 'Es una conexión privada: para el correo de la empresa usá una del equipo.'
        : c.problem;
    const kind = MAIL_ACCOUNT_LIMITS[mailAccountKind(c.integration, c.address)];
    return (
        <button
            type="button"
            role="radio"
            aria-checked={selected}
            data-unusable={disabled || undefined}
            onClick={onSelect}
            data-testid="mail-account-candidate"
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-p-2.5 imcrm-text-left imcrm-transition-colors',
                selected ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-muted/40',
            )}
        >
            <span
                className={cn(
                    'imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border',
                    selected ? 'imcrm-border-primary' : 'imcrm-border-input',
                )}
            >
                {selected && <span className="imcrm-h-2 imcrm-w-2 imcrm-rounded-full imcrm-bg-primary" />}
            </span>
            <IntegrationLogo integrationKey={c.integration} size={28} />
            <span className="imcrm-min-w-0 imcrm-flex-1">
                <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium">{c.address ?? c.name}</span>
                <span className={cn('imcrm-block imcrm-truncate imcrm-text-xs', reason ? 'imcrm-text-destructive' : 'imcrm-text-muted-foreground')}>
                    {reason ?? `${integrationDef(c.integration)?.name ?? c.integration} · ${kind.label}`}
                </span>
            </span>
            {current && <Badge variant="secondary">Actual</Badge>}
        </button>
    );
}

function NoConnections(): JSX.Element {
    return (
        <div className="imcrm-space-y-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm" data-testid="mail-account-empty">
            <p>
                Todavía no hay una cuenta de Gmail ni de Outlook conectada. Conectala una vez en Integraciones (como
                conexión del <span className="imcrm-font-medium">equipo</span>) y volvé acá para elegirla.
            </p>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                <Button size="sm" variant="outline" asChild>
                    <Link to="/settings?s=conectores">
                        <IntegrationLogo integrationKey="gmail" size={16} className="imcrm-mr-1.5" />
                        Conectar Gmail
                    </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                    <Link to="/settings?s=conectores">
                        <IntegrationLogo integrationKey="outlook" size={16} className="imcrm-mr-1.5" />
                        Conectar Outlook
                    </Link>
                </Button>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                Consejo: conectá una casilla compartida (por ejemplo notificaciones@tuempresa.com), no la personal de
                alguien que mañana puede irse.
            </p>
        </div>
    );
}

// ── SMTP ─────────────────────────────────────────────────────────────────

function SmtpSection({ status }: { status: TenantMailStatus }): JSX.Element {
    const { clearAccount } = useMailMutations();
    return (
        <div className="imcrm-space-y-3" data-testid="mail-section-smtp">
            {status.mode === 'account' && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm">
                    <span className="imcrm-flex-1">
                        Ahora los correos salen por tu cuenta de Google o Microsoft.{' '}
                        {status.smtp_configured
                            ? 'Tenés un servidor SMTP guardado: podés volver a usarlo.'
                            : 'Si guardás un servidor SMTP, pasa a ser la forma de envío.'}
                    </span>
                    {status.smtp_configured && (
                        <Button size="sm" variant="outline" disabled={clearAccount.isPending} onClick={() => clearAccount.mutate()}>
                            Usar mi SMTP guardado
                        </Button>
                    )}
                </div>
            )}
            <TenantSmtpPanel mode={status.mode} />
        </div>
    );
}
