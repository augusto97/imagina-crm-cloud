import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, CalendarDays, Loader2, Lock, PenLine, ShieldCheck } from 'lucide-react';
import { BOOKING_MAX_BUSY_CALENDARS, isGoogleWorkspaceBlockError, isMsConsentError, type AgendaCalendarItem, type MyAgendaCalendarDto, type UpdateMyAgendaCalendarInput } from '@imagina-base/shared';

import { GoogleWorkspaceAdminDialog } from '@/cloud/components/GoogleWorkspaceAdminDialog';
import { MsAdminConsentDialog } from '@/cloud/components/MsAdminConsentDialog';
import { useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.350 — Ajustes → Cuenta → Mi calendario. Cada persona que atiende
 * citas conecta SU Google Calendar u Outlook (una conexión privada: nadie
 * más la ve ni la usa en automatizaciones) y elige en cuáles de sus
 * calendarios se mira lo ocupado y en cuál se crean las citas. Lo que la app
 * lee de esos calendarios es sólo el inicio y el fin de cada evento.
 */

const KEY = (tenantId: number | null) => ['me', 'agenda-calendar', tenantId] as const;

function errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function MyAgendaCalendarCard(): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const impersonating = useSession((s) => Boolean(s.impersonating));
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
    const [params, setParams] = useSearchParams();
    // v0.1.363 — `consent`: Microsoft pidió la aprobación del administrador.
    // v0.1.384 — `google`: Google Workspace bloqueó la app.
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string; consent?: boolean; google?: boolean } | null>(null);
    const [adminConsent, setAdminConsent] = useState(false);
    const [googleAdmin, setGoogleAdmin] = useState(false);

    const q = useQuery({
        queryKey: KEY(tenantId),
        queryFn: async () => (await api.get<MyAgendaCalendarDto>('/me/agenda-calendar')).data,
        retry: false,
    });

    // La vuelta de Google o Microsoft (`?oauth=ok|error&msg=`).
    const oauthResult = params.get('oauth');
    useEffect(() => {
        if (!oauthResult) return;
        const msg = params.get('msg') ?? '';
        const consent = params.get('app') === 'outlook' && isMsConsentError(msg);
        const googleBlock = params.get('app') === 'google_calendar' && isGoogleWorkspaceBlockError(msg);
        setNotice(
            oauthResult === 'ok'
                ? { kind: 'ok', text: __('¡Listo! Tu calendario quedó conectado. Elige abajo en cuáles se mira lo ocupado.') }
                : googleBlock
                  ? {
                        kind: 'err',
                        google: true,
                        text: __('Google no dejó terminar la conexión: el administrador de Google Workspace de tu empresa bloquea las apps de terceros que no revisó. Mándale el mensaje para que la marque como de confianza; después vuelve a tocar «Conectar Google Calendar».'),
                    }
                : consent
                  ? {
                        kind: 'err',
                        consent: true,
                        text: __('Microsoft no dejó terminar la conexión: tu empresa pide que un administrador de Microsoft 365 apruebe la app antes de que cada persona conecte su calendario. Crea el enlace para tu administrador; cuando lo apruebe, vuelve a tocar «Conectar Outlook».'),
                    }
                  : { kind: 'err', text: msg || __('No se pudo conectar el calendario.') },
        );
        const next = new URLSearchParams(params);
        next.delete('oauth');
        next.delete('msg');
        next.delete('app');
        setParams(next, { replace: true });
        void qc.invalidateQueries({ queryKey: KEY(tenantId) });
        // Sólo importa el resultado: las demás dependencias son estables.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oauthResult]);

    const connect = useMutation({
        mutationFn: async (provider: 'google_calendar' | 'outlook') => (await api.post<{ authorize_url: string }>('/me/agenda-calendar/connect', { provider })).data,
        // Google o Microsoft piden permiso y vuelven solos a esta pantalla.
        onSuccess: (res) => window.location.assign(res.authorize_url),
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });
    const update = useMutation({
        mutationFn: async (input: UpdateMyAgendaCalendarInput) => (await api.patch<MyAgendaCalendarDto>('/me/agenda-calendar', input)).data,
        onMutate: async (input) => {
            // Optimista: los controles se mueven al tocarlos (lección de v0.1.207).
            await qc.cancelQueries({ queryKey: KEY(tenantId) });
            const prev = qc.getQueryData<MyAgendaCalendarDto>(KEY(tenantId));
            if (prev) qc.setQueryData<MyAgendaCalendarDto>(KEY(tenantId), { ...prev, ...input } as MyAgendaCalendarDto);
            return { prev };
        },
        onSuccess: (doc) => {
            qc.setQueryData(KEY(tenantId), doc);
            toast.success(__('Guardado'));
        },
        onError: (err, _input, ctx) => {
            if (ctx?.prev) qc.setQueryData(KEY(tenantId), ctx.prev);
            toast.error(__('No se pudo guardar'), errText(err));
        },
    });
    const disconnect = useMutation({
        mutationFn: async () => (await api.delete<MyAgendaCalendarDto>('/me/agenda-calendar')).data,
        onSuccess: (doc) => {
            qc.setQueryData(KEY(tenantId), doc);
            setNotice({ kind: 'ok', text: __('Tu calendario se desconectó. Las citas que ya están en él no se borran.') });
        },
        onError: (err) => setNotice({ kind: 'err', text: errText(err) }),
    });

    const d = q.data;
    const askDisconnect = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Desconectar tu calendario?'),
            description:
                d && d.pages.length > 0
                    ? sprintf(__('Atiendes en %d agendas: dejarán de mirar lo ocupado en tu calendario y las citas nuevas no se agregarán a él. Las que ya están no se borran.'), d.pages.length)
                    : __('Las citas que ya están en tu calendario no se borran.'),
            confirmLabel: __('Desconectar'),
            destructive: true,
        });
        if (ok) disconnect.mutate();
    };

    return (
        <section className="imcrm-flex imcrm-max-w-2xl imcrm-flex-col imcrm-gap-4" data-testid="my-agenda-calendar" data-tour="my-calendar">
            <div>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Si atiendes citas, conecta tu Google Calendar u Outlook: la agenda no ofrece los horarios en que ya estás ocupado, tus citas se agregan solas a tu calendario (con su videollamada de Meet o Teams) y si mueves o borras una ahí, la cita se mueve o se cancela.')}
                </p>
            </div>

            {notice && (
                <div
                    className={cn(
                        'imcrm-rounded-lg imcrm-border imcrm-p-3 imcrm-text-sm',
                        notice.kind === 'ok' ? 'imcrm-border-success/25 imcrm-bg-success/10 imcrm-text-success' : 'imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-text-destructive',
                    )}
                    data-testid="my-calendar-notice"
                >
                    {notice.text}
                    {notice.consent && (
                        <div className="imcrm-mt-2">
                            <Button size="sm" variant="outline" className="imcrm-gap-1.5" onClick={() => setAdminConsent(true)} data-testid="my-calendar-consent-open">
                                <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Crear el enlace para mi administrador')}
                            </Button>
                        </div>
                    )}
                    {notice.google && (
                        <div className="imcrm-mt-2">
                            <Button size="sm" variant="outline" className="imcrm-gap-1.5" onClick={() => setGoogleAdmin(true)} data-testid="my-calendar-google-admin-open">
                                <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Ver el mensaje para mi administrador')}
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {googleAdmin && (
                <GoogleWorkspaceAdminDialog
                    target={{ kind: 'agenda' }}
                    open
                    onClose={() => setGoogleAdmin(false)}
                    onConnect={
                        impersonating
                            ? undefined
                            : () => {
                                  setGoogleAdmin(false);
                                  connect.mutate('google_calendar');
                              }
                    }
                />
            )}

            {adminConsent && (
                <MsAdminConsentDialog
                    target={{ kind: 'agenda' }}
                    open
                    onClose={() => setAdminConsent(false)}
                    onConnect={
                        impersonating
                            ? undefined
                            : () => {
                                  setAdminConsent(false);
                                  connect.mutate('outlook');
                              }
                    }
                />
            )}

            {impersonating && (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Mientras ves la app como otra persona no se puede conectar ni cambiar su calendario.')}</p>
            )}

            {q.isLoading && <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>}
            {q.isError && <p className="imcrm-text-sm imcrm-text-destructive">{errText(q.error)}</p>}

            {d && !d.connection && (
                <Card>
                    <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-4">
                        <p className="imcrm-text-sm">{__('Conecta el calendario de tu cuenta. Es sólo tuyo: nadie más de la empresa lo ve ni lo usa en automatizaciones.')}</p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            {d.providers.map((p) => (
                                <Button
                                    key={p.key}
                                    variant="outline"
                                    disabled={!p.available || connect.isPending || impersonating}
                                    onClick={() => connect.mutate(p.key)}
                                    data-testid={`my-calendar-connect-${p.key}`}
                                    className="imcrm-gap-2"
                                >
                                    {connect.isPending && connect.variables === p.key ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <CalendarDays className="imcrm-h-4 imcrm-w-4" />}
                                    {sprintf(__('Conectar %s'), p.name)}
                                </Button>
                            ))}
                        </div>
                        {d.providers.some((p) => p.key === 'outlook' && p.available) && !impersonating && (
                            <button
                                type="button"
                                onClick={() => setAdminConsent(true)}
                                className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-rounded imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                data-testid="my-calendar-admin-consent"
                            >
                                <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                {__('¿Tu empresa usa Microsoft 365 y pide aprobación del administrador?')}
                            </button>
                        )}
                        {d.providers.some((p) => p.key === 'google_calendar' && p.available) && !impersonating && (
                            <button
                                type="button"
                                onClick={() => setGoogleAdmin(true)}
                                className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-self-start imcrm-rounded imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                data-testid="my-calendar-google-admin"
                            >
                                <ShieldCheck className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                {__('¿Tu empresa usa Google Workspace y bloquea la app?')}
                            </button>
                        )}
                        {d.providers.some((p) => !p.available) && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Lo que aparece apagado todavía no está habilitado en este servidor: lo habilita quien administra la plataforma.')}
                            </p>
                        )}
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            <Lock className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                            {__('De tus eventos sólo se lee la hora de inicio y de fin: nunca el título, la descripción ni los invitados. Sólo se modifican los eventos que creó la propia app.')}
                        </p>
                    </CardContent>
                </Card>
            )}

            {d?.connection && (
                <Card>
                    <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-4">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted">
                                <CalendarCheck className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-hidden />
                            </span>
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                    {d.connection.provider === 'google_calendar' ? 'Google Calendar' : 'Outlook'}
                                    {d.connection.problem ? (
                                        <Badge variant="destructive" className="imcrm-text-[10px]">
                                            {__('Hay que volver a conectarlo')}
                                        </Badge>
                                    ) : (
                                        <Badge variant="success" className="imcrm-text-[10px]">
                                            {__('Conectado')}
                                        </Badge>
                                    )}
                                </p>
                                {d.connection.account && <p className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{d.connection.account}</p>}
                            </div>
                            <div className="imcrm-flex imcrm-gap-2">
                                {d.connection.problem && (
                                    <Button size="sm" onClick={() => connect.mutate(d.connection!.provider)} disabled={connect.isPending || impersonating} data-testid="my-calendar-reconnect">
                                        {__('Volver a conectar')}
                                    </Button>
                                )}
                                <Button size="sm" variant="outline" onClick={() => void askDisconnect()} disabled={disconnect.isPending || impersonating} data-testid="my-calendar-disconnect">
                                    {__('Desconectar')}
                                </Button>
                            </div>
                        </div>
                        {d.connection.problem && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive">
                                <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                {d.connection.problem}
                            </p>
                        )}
                        <CalendarChoices doc={d} disabled={impersonating} onChange={(input) => update.mutate(input)} />
                    </CardContent>
                </Card>
            )}

            {d && d.pages.length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="my-calendar-pages">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Agendas donde atiendes')}</p>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                        {d.pages.map((p) => (
                            <li key={p.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm">
                                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">
                                    {p.name} <span className="imcrm-text-muted-foreground">· {p.list_name}</span>
                                </span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {[p.read_busy ? __('mira lo ocupado') : null, p.create_events ? __('agrega las citas') : null].filter(Boolean).join(' · ') || __('no usa el calendario')}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Qué hace el calendario en cada agenda lo decide quien la arma (Ajustes de la lista → Agenda → Quién atiende).')}
                    </p>
                </div>
            )}
            {d && d.pages.length === 0 && d.connection && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Todavía no atiendes en ninguna agenda. Cuando te sumen a una, se usa este calendario.')}{' '}
                    <Link to="/lists" className="imcrm-text-primary hover:imcrm-underline">
                        {__('Ir a las listas')}
                    </Link>
                </p>
            )}
        </section>
    );
}

/** En cuáles calendarios se mira lo ocupado y en cuál se crean las citas. */
function CalendarChoices({ doc, disabled, onChange }: { doc: MyAgendaCalendarDto; disabled: boolean; onChange: (input: UpdateMyAgendaCalendarInput) => void }): JSX.Element {
    // El valor se fija EN EL EVENTO (la respuesta llega después): si no, el
    // control vuelve a su valor anterior hasta que contesta el servidor.
    const [localBusy, setLocalBusy] = useState<string[] | null>(null);
    const [localWrite, setLocalWrite] = useState<string | null | undefined>(undefined);
    const busyKey = doc.busy_calendars.join('|');
    useEffect(() => setLocalBusy(null), [busyKey]);
    useEffect(() => setLocalWrite(undefined), [doc.write_calendar]);
    if (doc.calendars === null) {
        return <p className="imcrm-text-xs imcrm-text-muted-foreground">{doc.calendars_error ?? __('No se pudo leer la lista de tus calendarios: se usa el principal.')}</p>;
    }
    const items: AgendaCalendarItem[] = doc.calendars;
    const primary = items.find((c) => c.primary) ?? null;
    const busySource = localBusy ?? doc.busy_calendars;
    const busy = busySource.length === 0 ? new Set(primary ? [primary.id] : []) : new Set(busySource);
    const toggle = (id: string, on: boolean): void => {
        const next = new Set(busy);
        if (on) next.add(id);
        else next.delete(id);
        const list = items.map((c) => c.id).filter((x) => next.has(x));
        // Sólo el principal (o nada) = lo de siempre.
        const plain = list.length === 0 || (list.length === 1 && list[0] === primary?.id);
        const value = plain ? [] : list.slice(0, BOOKING_MAX_BUSY_CALENDARS);
        setLocalBusy(value);
        onChange({ busy_calendars: value });
    };
    const writable = items.filter((c) => c.can_write);
    const writeId = (localWrite !== undefined ? localWrite : doc.write_calendar) ?? primary?.id ?? '';
    return (
        <div className="imcrm-grid imcrm-gap-4 md:imcrm-grid-cols-2" data-testid="my-calendar-choices">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <p className="imcrm-text-xs imcrm-font-semibold">{__('Mirar lo ocupado en')}</p>
                {items.map((c) => (
                    <label key={c.id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input type="checkbox" checked={busy.has(c.id)} disabled={disabled} onChange={(e) => toggle(c.id, e.target.checked)} data-calendar-busy={c.id} />
                        <span className="imcrm-h-2.5 imcrm-w-2.5 imcrm-shrink-0 imcrm-rounded-full" style={{ background: c.color ?? 'hsl(var(--imcrm-muted-foreground))' }} aria-hidden />
                        <span className="imcrm-min-w-0 imcrm-truncate">{c.name}</span>
                        {c.primary && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('principal')}</span>}
                    </label>
                ))}
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Los horarios ocupados en cualquiera de estos no se ofrecen. Marca también el de tu equipo o el familiar si los usas.')}</p>
            </div>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-semibold">
                    <PenLine className="imcrm-h-3 imcrm-w-3" aria-hidden />
                    {__('Crear las citas en')}
                </p>
                {writable.map((c) => (
                    <label key={c.id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="radio"
                            name="agenda-write-calendar"
                            checked={writeId === c.id}
                            disabled={disabled}
                            onChange={() => {
                                const value = c.primary ? null : c.id;
                                setLocalWrite(value);
                                onChange({ write_calendar: value });
                            }}
                            data-calendar-write={c.id}
                        />
                        <span className="imcrm-min-w-0 imcrm-truncate">{c.name}</span>
                        {c.primary && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('principal')}</span>}
                    </label>
                ))}
                {writable.length === 0 && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Tu cuenta no tiene calendarios donde se pueda escribir.')}</p>}
            </div>
        </div>
    );
}
