import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Bell,
    Check,
    CircleAlert,
    CircleCheck,
    CircleDashed,
    Copy,
    HeartPulse,
    History,
    Loader2,
    RefreshCw,
    ShieldCheck,
    Wrench,
} from 'lucide-react';
import type { GuardianEvent, PlatformAlert } from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { diskSize } from './diskSize';
import { agoText, checkText, checkTone, guardianChecks, heartbeatProvider, severityLabel, severityVariant, type CheckTone } from './serverWatch';

/**
 * v0.1.431 (ADR-S104) — Plataforma → Diagnóstico: los avisos del servidor
 * (lo que llega por correo al operador), la reparación automática (el
 * guardián que corre como root) y el monitoreo externo (Better Stack).
 */

function CopyText({ text, testId }: { text: string; testId?: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2">
            <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-font-mono imcrm-text-xs" data-testid={testId}>
                {text}
            </code>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                title={__('Copiar')}
                onClick={() => {
                    void navigator.clipboard
                        ?.writeText(text)
                        .then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1500);
                        })
                        .catch(() => undefined);
                }}
            >
                {copied ? <Check className="imcrm-h-4 imcrm-w-4 imcrm-text-success" /> : <Copy className="imcrm-h-4 imcrm-w-4" />}
                <span className="imcrm-sr-only sm:imcrm-not-sr-only">{copied ? __('Copiado') : __('Copiar')}</span>
            </Button>
        </div>
    );
}

function HeaderIcon({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
            {children}
        </span>
    );
}

const TONE_CLASS: Record<CheckTone, string> = {
    ok: 'imcrm-text-[hsl(var(--imcrm-success-ink))]',
    bad: 'imcrm-text-[hsl(var(--imcrm-destructive-ink))]',
    wait: 'imcrm-text-[hsl(var(--imcrm-warning-ink))]',
    none: 'imcrm-text-muted-foreground',
};

function ToneIcon({ tone }: { tone: CheckTone }): JSX.Element {
    if (tone === 'ok') return <CircleCheck className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', TONE_CLASS.ok)} aria-hidden />;
    if (tone === 'bad') return <CircleAlert className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', TONE_CLASS.bad)} aria-hidden />;
    if (tone === 'wait') return <Loader2 className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-animate-spin', TONE_CLASS.wait)} aria-hidden />;
    return <CircleDashed className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', TONE_CLASS.none)} aria-hidden />;
}

// ── Avisos ──────────────────────────────────────────────────────────────

function AlertRow({ alert, onDismiss, busy }: { alert: PlatformAlert; onDismiss?: () => void; busy?: boolean }): JSX.Element {
    const open = alert.resolved_at === null;
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-border-b imcrm-border-border imcrm-py-3 last:imcrm-border-b-0" data-testid="platform-alert" data-key={alert.key}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-2">
                    {open ? (
                        <Badge variant={severityVariant(alert.severity)} className="imcrm-mt-0.5 imcrm-shrink-0">
                            {severityLabel(alert.severity)}
                        </Badge>
                    ) : (
                        <Badge variant="secondary" className="imcrm-mt-0.5 imcrm-shrink-0">
                            {alert.opened_at === alert.resolved_at ? __('Aviso') : __('Se arregló')}
                        </Badge>
                    )}
                    <div className="imcrm-min-w-0">
                        <p className="imcrm-text-sm imcrm-font-medium">{alert.title}</p>
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{alert.detail}</p>
                    </div>
                </div>
                {open && (
                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1">
                        {alert.action_path && (
                            <Button asChild variant="outline" size="sm">
                                <Link to={alert.action_path}>{alert.action_label ?? __('Ir a arreglarlo')}</Link>
                            </Button>
                        )}
                        {onDismiss && (
                            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDismiss} data-testid="platform-alert-dismiss">
                                {__('Ya lo vi')}
                            </Button>
                        )}
                    </div>
                )}
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {open
                    ? sprintf(__('Desde %s'), formatDateTimeStr(alert.opened_at)) +
                      (alert.count > 1 ? ` · ${sprintf(__('visto %d veces'), alert.count)}` : '') +
                      (alert.notified_at ? ` · ${__('avisado por correo')}` : ` · ${__('sólo en este panel')}`)
                    : `${formatDateTimeStr(alert.resolved_at!)}${alert.notified_at ? ` · ${__('avisado por correo')}` : ''}`}
            </p>
        </li>
    );
}

export function PlatformAlertsCard(): JSX.Element | null {
    const qc = useQueryClient();
    const toast = useToast();
    const q = useQuery({ queryKey: ['platform-alerts'], queryFn: () => api.platformAlerts(), refetchInterval: 60_000 });
    const [history, setHistory] = useState(false);
    const check = useMutation({
        mutationFn: () => api.platformAlertsCheck(),
        onSuccess: (data) => {
            qc.setQueryData(['platform-alerts'], data);
            void qc.invalidateQueries({ queryKey: ['platform-guardian'] });
            toast.success(
                data.open.length === 0 ? __('Todo está bien') : data.open.length === 1 ? __('Hay 1 aviso abierto') : sprintf(__('Hay %d avisos abiertos'), data.open.length),
            );
        },
        onError: (err) => toast.error(__('No se pudo revisar'), err instanceof Error ? err.message : String(err)),
    });
    const dismiss = useMutation({
        mutationFn: (key: string) => api.platformAlertDismiss(key),
        onSuccess: (data) => qc.setQueryData(['platform-alerts'], data),
    });
    if (!q.data) return null;
    const d = q.data;
    const critical = d.open.some((a) => a.severity === 'critical');
    return (
        <Card data-tour="platform-alerts" data-testid="platform-alerts">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <HeaderIcon>
                            <Bell className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </HeaderIcon>
                        <div>
                            <CardTitle>{__('Avisos del servidor')}</CardTitle>
                            <CardDescription>
                                {__('Copias que fallan o se atrasan, Google Drive que hay que reconectar, actualizaciones que no se instalaron, el certificado por vencer y lo que hizo la reparación automática. Te llegan por correo.')}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Badge dot variant={d.open.length === 0 ? 'success' : critical ? 'destructive' : 'warning'} data-testid="platform-alerts-status">
                            {d.open.length === 0 ? __('Todo bien') : d.open.length === 1 ? __('1 abierto') : sprintf(__('%d abiertos'), d.open.length)}
                        </Badge>
                        <Button type="button" variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending} data-testid="platform-alerts-check">
                            {check.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-4 imcrm-w-4" />}
                            {__('Revisar ahora')}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-0">
                {d.mail_available ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="platform-alerts-recipients">
                        {sprintf(__('Los avisos llegan por correo a %s.'), d.recipients.join(', '))}
                        {d.checked_at ? ` ${sprintf(__('Última revisión: %s.'), agoText(d.checked_at))}` : ''}
                    </p>
                ) : (
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm">
                        <CircleAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                        <span>
                            {d.mail_reason ?? __('Los avisos no pueden salir por correo.')}{' '}
                            <Link to="/platform?tab=correo" className="imcrm-font-medium imcrm-underline">
                                {__('Configurar el correo')}
                            </Link>
                        </span>
                    </div>
                )}
                {d.open.length === 0 ? (
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <CircleCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-[hsl(var(--imcrm-success-ink))]" aria-hidden />
                        {__('No hay nada pendiente.')}
                    </p>
                ) : (
                    <ul>
                        {d.open.map((a) => (
                            <AlertRow key={a.key} alert={a} busy={dismiss.isPending} onDismiss={() => dismiss.mutate(a.key)} />
                        ))}
                    </ul>
                )}
                {d.recent.length > 0 && (
                    <div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setHistory((v) => !v)} aria-expanded={history} data-testid="platform-alerts-history-toggle">
                            <History className="imcrm-h-4 imcrm-w-4" />
                            {history ? __('Ocultar el historial') : sprintf(__('Historial (%d)'), d.recent.length)}
                        </Button>
                        {history && (
                            <ul className="imcrm-mt-1">
                                {d.recent.slice(0, 30).map((a, i) => (
                                    <AlertRow key={`${a.key}-${i}`} alert={a} />
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Reparación automática (el guardián) ─────────────────────────────────

function EventRow({ e }: { e: GuardianEvent }): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-py-1.5 imcrm-text-sm">
            <ToneIcon tone={e.ok ? 'ok' : 'bad'} />
            <span className="imcrm-min-w-0 imcrm-flex-1">{e.message}</span>
            <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground" title={formatDateTimeStr(e.at)}>
                {agoText(e.at)}
            </span>
        </li>
    );
}

export function GuardianCard(): JSX.Element | null {
    const qc = useQueryClient();
    const toast = useToast();
    const [waiting, setWaiting] = useState(false);
    const q = useQuery({ queryKey: ['platform-guardian'], queryFn: () => api.guardianStatus(), refetchInterval: waiting ? 3_000 : 30_000 });
    const pending = q.data?.request_pending ?? false;
    useEffect(() => {
        if (waiting && !pending) {
            const t = window.setTimeout(() => setWaiting(false), 4_000);
            return () => window.clearTimeout(t);
        }
        return undefined;
    }, [waiting, pending]);
    const repair = useMutation({
        mutationFn: () => api.guardianRequest(),
        onSuccess: (r) => {
            if (!r.ok) {
                toast.error(__('No se pudo pedir la revisión'), r.reason ?? '');
                return;
            }
            setWaiting(true);
            toast.success(__('Revisando el servidor…'), __('La reparación automática lo revisa ahora mismo; en unos segundos ves el resultado.'));
            void qc.invalidateQueries({ queryKey: ['platform-guardian'] });
        },
        onError: (err) => toast.error(__('No se pudo pedir la revisión'), err instanceof Error ? err.message : String(err)),
    });
    if (!q.data) return null;
    const g = q.data;
    const r = g.report;
    const status = !g.installed ? 'missing' : !g.fresh ? 'stale' : 'ok';
    return (
        <Card data-tour="platform-guardian" data-testid="platform-guardian">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <HeaderIcon>
                            <ShieldCheck className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </HeaderIcon>
                        <div>
                            <CardTitle>{__('Reparación automática del servidor')}</CardTitle>
                            <CardDescription>
                                {__('Revisa cada minuto la app, la base de datos, Redis, el servidor web, la entrada por el dominio y el disco. Si algo se cae, lo vuelve a levantar solo: reinicia, vuelve a la versión anterior tras una actualización que no arranca, repone la configuración de Nginx que reescribe el panel y libera espacio.')}
                            </CardDescription>
                        </div>
                    </div>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <Badge dot variant={status === 'ok' ? 'success' : status === 'stale' ? 'warning' : 'secondary'} data-testid="guardian-status">
                            {status === 'ok' ? __('Activa') : status === 'stale' ? __('Dejó de revisar') : __('Sin instalar')}
                        </Badge>
                        {g.installed && (
                            <Button type="button" variant="outline" size="sm" onClick={() => repair.mutate()} disabled={repair.isPending || waiting} data-testid="guardian-repair">
                                {repair.isPending || waiting ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Wrench className="imcrm-h-4 imcrm-w-4" />}
                                {waiting ? __('Revisando…') : __('Reparar ahora')}
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-0">
                {!g.installed ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-sm" data-testid="guardian-install">
                        {g.applicable ? (
                            <>
                                <p>
                                    {__('Todavía no está instalada en este servidor. Se instala UNA vez, por consola, como root (después se actualiza sola con cada versión que lo necesite):')}
                                </p>
                                <CopyText text={g.install_command} testId="guardian-install-command" />
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Entra por SSH al servidor, pasa a root (sudo -i) y pega el comando. Detecta solo tu dominio, el servidor web (ServerAvatar, Nginx o Caddy) y la base de datos.')}
                                </p>
                            </>
                        ) : (
                            <p className="imcrm-text-muted-foreground">{__('Sólo se usa en el servidor de producción (con la app instalada por versiones).')}</p>
                        )}
                    </div>
                ) : (
                    <>
                        {r && (
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3" data-testid="guardian-checks">
                                {guardianChecks(r, diskSize).map((c) => {
                                    const tone = checkTone(c.state);
                                    return (
                                        <div key={c.key} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2" data-check={c.key} data-state={c.state}>
                                            <ToneIcon tone={tone} />
                                            <div className="imcrm-min-w-0">
                                                <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{c.label}</p>
                                                <p className={cn('imcrm-truncate imcrm-text-xs', TONE_CLASS[tone])}>
                                                    {checkText(c.state)}
                                                    {c.detail ? ` · ${c.detail}` : ''}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {r && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {sprintf(__('Última revisión: %s.'), agoText(r.updated_at))}
                                {r.current_release ? ` ${sprintf(__('Versión instalada: %s.'), r.current_release)}` : ''}
                            </p>
                        )}
                        {status === 'stale' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm">
                                <span>{__('Hace más de 5 minutos que no revisa. Para volver a ponerla en marcha, como root:')}</span>
                                <CopyText text="systemctl enable --now imagina-guardian.timer imagina-guardian.path" />
                            </div>
                        )}
                        {g.outdated && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-info/30 imcrm-bg-info/10 imcrm-p-3 imcrm-text-sm">
                                <span>{__('Esta versión de la app trae una versión nueva de la reparación automática. Para instalarla, como root:')}</span>
                                <CopyText text={g.install_command} />
                            </div>
                        )}
                        <div>
                            <p className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Lo último que hizo')}</p>
                            {g.events.length === 0 ? (
                                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Nada por ahora: todo funcionaba.')}</p>
                            ) : (
                                <ul data-testid="guardian-events">
                                    {g.events.slice(0, 10).map((e) => (
                                        <EventRow key={e.id} e={e} />
                                    ))}
                                </ul>
                            )}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// ── Monitoreo externo ───────────────────────────────────────────────────

export function MonitoringCard(): JSX.Element | null {
    const qc = useQueryClient();
    const toast = useToast();
    const q = useQuery({ queryKey: ['platform-monitoring'], queryFn: () => api.monitoringGet(), refetchInterval: 60_000 });
    const [url, setUrl] = useState<string | null>(null);
    const save = useMutation({
        mutationFn: (input: { heartbeat_url?: string | null; enabled?: boolean }) => api.monitoringUpdate(input),
        onSuccess: (data) => {
            qc.setQueryData(['platform-monitoring'], data);
            setUrl(null);
            toast.success(__('Guardado'));
        },
        onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err)),
    });
    const test = useMutation({
        mutationFn: () => api.monitoringTest(),
        onSuccess: (data) => {
            qc.setQueryData(['platform-monitoring'], data);
            const p = data.last_ping;
            if (p?.ok) toast.success(__('El latido llegó'), __('Tu servicio de monitoreo ya lo recibió.'));
            else toast.error(__('El latido no llegó'), p?.message ?? '');
        },
        onError: (err) => toast.error(__('No se pudo probar'), err instanceof Error ? err.message : String(err)),
    });
    if (!q.data) return null;
    const m = q.data;
    const value = url ?? m.settings.heartbeat_url ?? '';
    const dirty = url !== null && url.trim() !== (m.settings.heartbeat_url ?? '');
    const invalid = dirty && value.trim() !== '' && !/^https:\/\/[^\s/]+\.[^\s]+$/i.test(value.trim());
    const provider = m.settings.heartbeat_url ? heartbeatProvider(m.settings.heartbeat_url) : null;
    const ping = m.last_ping;
    return (
        <Card data-tour="platform-monitoring" data-testid="platform-monitoring">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <HeaderIcon>
                            <HeartPulse className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </HeaderIcon>
                        <div>
                            <CardTitle>{__('Monitoreo externo')}</CardTitle>
                            <CardDescription>
                                {__('Si el servidor entero se apaga, nada dentro de él puede avisarte. Un servicio de afuera (Better Stack, Healthchecks.io…) sí: la app le manda un latido cada minuto mientras todo está bien, y si deja de llegar, te avisa.')}
                            </CardDescription>
                        </div>
                    </div>
                    <Badge
                        dot
                        variant={!m.settings.heartbeat_url ? 'secondary' : !m.settings.enabled ? 'secondary' : ping?.ok ? 'success' : ping ? 'destructive' : 'warning'}
                        data-testid="monitoring-status"
                    >
                        {!m.settings.heartbeat_url
                            ? __('Sin configurar')
                            : !m.settings.enabled
                              ? __('En pausa')
                              : ping?.ok
                                ? __('Latiendo')
                                : ping
                                  ? __('No llega')
                                  : __('Esperando')}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-0 imcrm-text-sm">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <label htmlFor="imcrm-heartbeat-url" className="imcrm-font-medium">
                        {__('Dirección del latido (heartbeat)')}
                    </label>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 sm:imcrm-flex-row">
                        <Input
                            id="imcrm-heartbeat-url"
                            value={value}
                            placeholder="https://uptime.betterstack.com/api/v1/heartbeat/…"
                            onChange={(e) => setUrl(e.target.value)}
                            data-testid="monitoring-url"
                        />
                        <div className="imcrm-flex imcrm-gap-2">
                            <Button
                                type="button"
                                onClick={() => save.mutate({ heartbeat_url: value.trim() ? value.trim() : null })}
                                disabled={!dirty || invalid || save.isPending}
                                data-testid="monitoring-save"
                            >
                                {__('Guardar')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => test.mutate()}
                                disabled={!m.settings.heartbeat_url || dirty || test.isPending}
                                data-testid="monitoring-test"
                            >
                                {test.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {__('Probar')}
                            </Button>
                        </div>
                    </div>
                    {invalid && (
                        <p className="imcrm-text-xs imcrm-text-[hsl(var(--imcrm-destructive-ink))]" data-testid="monitoring-url-error">
                            {__('Pega la dirección completa que te da el servicio; tiene que empezar con https://')}
                        </p>
                    )}
                    {provider && <p className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('Servicio: %s. Si algo falla, la app le avisa la falla al momento.'), provider)}</p>}
                </div>
                {m.settings.heartbeat_url && (
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <input
                            type="checkbox"
                            checked={m.settings.enabled}
                            onChange={(e) => save.mutate({ enabled: e.target.checked })}
                            data-testid="monitoring-enabled"
                        />
                        {__('Mandar el latido cada minuto')}
                    </label>
                )}
                {ping && (
                    <p className={cn('imcrm-flex imcrm-items-center imcrm-gap-2', ping.ok ? 'imcrm-text-muted-foreground' : TONE_CLASS.bad)} data-testid="monitoring-last">
                        <ToneIcon tone={ping.ok ? 'ok' : 'bad'} />
                        {ping.ok ? sprintf(__('Último latido: %s.'), agoText(ping.at)) : `${agoText(ping.at)}: ${ping.message ?? ''}`}
                    </p>
                )}
                {m.holding_reason && m.settings.heartbeat_url && (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/25 imcrm-bg-destructive/10 imcrm-p-3">
                        <CircleAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                        {sprintf(__('Ahora no está latiendo: %s'), m.holding_reason)}
                    </p>
                )}
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <p className="imcrm-font-medium">{__('Además, un monitor que entre por tu dominio')}</p>
                    <p className="imcrm-text-muted-foreground">
                        {__('En el mismo servicio crea un monitor de tipo «palabra clave» con esta dirección y la palabra "status":"ready". Así sabes también si la app deja de abrir desde afuera aunque el servidor siga prendido.')}
                    </p>
                    <CopyText text={m.health_url} testId="monitoring-health-url" />
                </div>
            </CardContent>
        </Card>
    );
}
