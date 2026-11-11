import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    INTEGRATIONS,
    WA_WEB_ABILITY_LABEL,
    WA_WEB_DEFAULT_SERVER,
    WHATSAPP_FIELD_ROLES,
    WHATSAPP_FIELD_ROLE_META,
    type WhatsappConnectionDetail,
    type WhatsappListFields,
    type WhatsappTemplate,
} from '@imagina-base/shared';
import {
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    CircleSlash,
    ExternalLink,
    Inbox,
    KeyRound,
    ListChecks,
    MessageCircle,
    RefreshCw,
    Smartphone,
    Sparkles,
    Webhook,
} from 'lucide-react';
import { Link, useParams } from 'react-router';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { CopyButton } from '@/cloud/components/payments/paymentUi';
import { TemplateStatusBadge, WhatsappBubble, rejectedReasonText, templateCategoryLabel } from '@/cloud/components/whatsapp/whatsappUi';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * WhatsApp Business oficial (D3) y, desde v0.1.389, Imagina WAS: cómo le
 * llegan los mensajes a la app, en qué lista caen, qué columnas se escriben y
 * (sólo en la oficial) las plantillas aprobadas en Meta. La app NO es un
 * chat: en cada registro queda el último mensaje y el estado del último envío.
 */
export function WhatsappPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const qc = useQueryClient();
    const key = ['whatsapp-connection', id];
    const q = useQuery({
        queryKey: key,
        queryFn: () => api.whatsappConnection(id),
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
        refetchInterval: 30_000,
    });
    const setData = (d: WhatsappConnectionDetail): void => {
        qc.setQueryData(key, d);
    };

    const back = (
        <Link to="/settings?s=conectores" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground">
            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
            {__('Integraciones')}
        </Link>
    );

    if (q.isLoading) return <div className="imcrm-p-6 imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</div>;
    if (q.isError || !q.data) {
        const msg = q.error instanceof CloudApiError ? q.error.message : __('No se pudo cargar la conexión.');
        return (
            <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-4 imcrm-p-6">
                {back}
                <p className="imcrm-text-sm imcrm-text-destructive">{msg}</p>
            </div>
        );
    }
    const d = q.data;
    if (d.provider === 'whatsapp_web' && d.web) return <WebWhatsappPage d={d} web={d.web} back={back} onData={setData} />;
    const approved = d.templates.filter((t) => t.status === 'APPROVED').length;

    return (
        <div className="imcrm-mx-auto imcrm-max-w-5xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-whatsapp-page">
            {back}
            <header className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey="whatsapp_cloud" size={48} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        {__('WhatsApp')} · {d.connection.display_phone ?? d.connection.name}
                        {d.connection.quality_rating && <QualityBadge rating={d.connection.quality_rating} />}
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {d.connection.verified_name ? `${d.connection.verified_name} — ` : ''}
                        {__('cuenta oficial de WhatsApp Business de tu empresa. Los mensajes se cobran a tu cuenta de Meta.')}
                    </p>
                </div>
            </header>

            {d.last_error && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-whatsapp-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" />
                    <div>
                        <p className="imcrm-font-medium">{__('La conexión está fallando')}</p>
                        <p className="imcrm-text-muted-foreground">{d.last_error}</p>
                    </div>
                </div>
            )}

            <section className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                <Stat label={__('Contactos que escribieron')} value={String(d.totals.contacts)} />
                <Stat label={__('Con la ventana de 24 h abierta')} value={String(d.totals.open_windows)} />
                <Stat label={__('Plantillas aprobadas')} value={String(approved)} />
            </section>

            <WebhookSection d={d} onData={setData} />
            <InboundSection d={d} onData={setData} />
            <TemplatesSection d={d} onTemplates={(templates) => setData({ ...d, templates, templates_synced_at: new Date().toISOString() })} />

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-whatsapp-recipes">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Ideas para usarlo')}
                </h2>
                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1.5 imcrm-pl-5 imcrm-text-sm imcrm-text-muted-foreground">
                    <li>{__('Avisos automáticos: en una automatización, acción «Enviar plantilla de WhatsApp» (recordatorio de pago, cita confirmada, pedido enviado). Las plantillas se pueden mandar siempre.')}</li>
                    <li>{__('Responder: acción «Enviar mensaje de texto de WhatsApp». Sólo sale si el contacto escribió en las últimas 24 h; fuera de esa ventana, usa una plantilla.')}</li>
                    <li>{__('Reaccionar a lo que escriben: disparador «Cuando llega un mensaje de WhatsApp», con {{whatsapp.texto}} y {{whatsapp.nombre}} (en la lista elegida en «Dónde caen los mensajes»).')}</li>
                    <li>
                        {__('Resumir o clasificar con IA: agrega a la lista un «Campo con IA» que lea la columna «Último mensaje de WhatsApp» (resumir, o clasificar en tus opciones: consulta, reclamo, pedido…). Se recalcula solo cada vez que llega un mensaje.')}
                    </li>
                    <li>{__('A mano: abre un registro y toca «Enviar WhatsApp» para mandarle una plantilla o, si la ventana está abierta, un mensaje.')}</li>
                </ul>
            </section>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-3">
            <div className="imcrm-text-xs imcrm-text-muted-foreground">{label}</div>
            <div className="imcrm-mt-0.5 imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums">{value}</div>
        </div>
    );
}

function QualityBadge({ rating }: { rating: string }): JSX.Element {
    const r = rating.toUpperCase();
    const label = r === 'GREEN' ? __('Calidad alta') : r === 'YELLOW' ? __('Calidad media') : r === 'RED' ? __('Calidad baja') : rating;
    return <Badge variant={r === 'GREEN' ? 'success' : r === 'YELLOW' ? 'warning' : r === 'RED' ? 'destructive' : 'secondary'}>{label}</Badge>;
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

// ── Imagina WAS (v0.1.389) ──────────────────────────────────────────────

/**
 * La versión de la página para una conexión de Imagina WAS: el número
 * vinculado y su estado, los permisos de la clave, los avisos que la app
 * registró sola en Imagina WAS y la lista donde caen los mensajes. No hay
 * plantillas ni ventana de 24 h: el texto sale siempre.
 */
function WebWhatsappPage({
    d,
    web,
    back,
    onData,
}: {
    d: WhatsappConnectionDetail;
    web: NonNullable<WhatsappConnectionDetail['web']>;
    back: JSX.Element;
    onData: (d: WhatsappConnectionDetail) => void;
}): JSX.Element {
    const phone = web.account?.phone ?? d.connection.display_phone;
    const name = web.account?.name ?? d.connection.verified_name;
    const ownServer = web.server !== '' && web.server !== WA_WEB_DEFAULT_SERVER;
    return (
        <div className="imcrm-mx-auto imcrm-max-w-5xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-whatsapp-page" data-provider="whatsapp_web">
            {back}
            <header className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey="whatsapp_web" size={48} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        {__('WhatsApp')} · {phone ?? d.connection.name}
                        {web.account && <AccountStatusBadge account={web.account} />}
                    </h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {name ? `${name} — ` : ''}
                        {__('número vinculado a tu cuenta de Whats')}
                        {web.workspace ? ` (${web.workspace})` : ''}
                        {ownServer ? ` · ${web.server}` : ''}
                    </p>
                </div>
            </header>

            {d.last_error && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-whatsapp-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" />
                    <div>
                        <p className="imcrm-font-medium">{__('La conexión está fallando')}</p>
                        <p className="imcrm-text-muted-foreground">{d.last_error}</p>
                    </div>
                </div>
            )}

            <section className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                <Stat label={__('Contactos que escribieron')} value={String(d.totals.contacts)} />
                <Stat label={__('Número')} value={web.account ? web.account.status_label : __('Sin leer')} />
                <Stat label={__('Avisos')} value={web.hook.registered ? __('Activos') : __('Sin registrar')} />
            </section>

            <WebAccountSection d={d} web={web} />
            <WebHookSection d={d} web={web} onData={onData} />
            <InboundSection d={d} onData={onData} />

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-whatsapp-recipes">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Ideas para usarlo')}
                </h2>
                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1.5 imcrm-pl-5 imcrm-text-sm imcrm-text-muted-foreground">
                    <li>{__('Avisos automáticos: en una automatización, acción «Enviar mensaje de WhatsApp» o «Enviar archivo por WhatsApp» (recordatorio de pago, cita confirmada, la factura en PDF). Con Whats no hay plantillas que aprobar: el mensaje sale tal cual.')}</li>
                    <li>{__('Reaccionar a lo que escriben: disparador «Cuando llega un mensaje de WhatsApp», con {{whatsapp.texto}} y {{whatsapp.nombre}} (en la lista elegida en «Dónde caen los mensajes»).')}</li>
                    <li>
                        {__('Resumir o clasificar con IA: agrega a la lista un «Campo con IA» que lea la columna «Último mensaje de WhatsApp». Se recalcula solo cada vez que llega un mensaje.')}
                    </li>
                    <li>{__('A mano: abre un registro y toca «Enviar WhatsApp» para mandarle un mensaje o un archivo.')}</li>
                    <li>{__('Cuida el número: no mandes mensajes masivos a quien no te escribió. WhatsApp bloquea los números que reciben muchas denuncias.')}</li>
                </ul>
            </section>
        </div>
    );
}

function AccountStatusBadge({ account }: { account: NonNullable<NonNullable<WhatsappConnectionDetail['web']>['account']> }): JSX.Element {
    const ok = account.enabled && account.status === 'connected';
    const bad = account.status === 'banned' || account.status === 'logged_out';
    return (
        <Badge variant={ok ? 'success' : bad ? 'destructive' : 'warning'} data-testid="imcrm-whatsapp-account-status">
            {account.status_label}
        </Badge>
    );
}

function abilityText(a: string): string {
    switch (a) {
        case 'account.view':
            return __('ver la cuenta');
        case 'wa.accounts.view':
            return __('ver los números');
        case 'wa.send':
            return __('enviar');
        case 'wa.read':
            return __('leer los mensajes');
        case 'webhooks.manage':
            return __('manejar los avisos (webhooks)');
        default:
            return WA_WEB_ABILITY_LABEL[a] ? __(WA_WEB_ABILITY_LABEL[a]) : a;
    }
}

function WebAccountSection({ d, web }: { d: WhatsappConnectionDetail; web: NonNullable<WhatsappConnectionDetail['web']> }): JSX.Element {
    const a = web.account;
    const down = a !== null && (!a.enabled || a.status !== 'connected');
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-whatsapp-web-account" data-tour="whatsapp-web-account">
            <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Smartphone className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {__('El número')}
            </h2>
            {a ? (
                <dl className="imcrm-mt-2 imcrm-grid imcrm-gap-x-6 imcrm-gap-y-1 imcrm-text-sm sm:imcrm-grid-cols-[auto_1fr]">
                    <dt className="imcrm-text-muted-foreground">{__('Teléfono')}</dt>
                    <dd className="imcrm-font-medium">{a.phone ?? '—'}</dd>
                    <dt className="imcrm-text-muted-foreground">{__('Nombre')}</dt>
                    <dd>{a.name ?? '—'}</dd>
                    <dt className="imcrm-text-muted-foreground">{__('Estado')}</dt>
                    <dd>
                        {a.status_label}
                        {a.status_reason ? ` · ${a.status_reason}` : ''}
                        {a.banned_until ? ` · ${__('bloqueado hasta')} ${formatDateTimeStr(a.banned_until)}` : ''}
                    </dd>
                    <dt className="imcrm-text-muted-foreground">{__('Cuenta en Whats')}</dt>
                    <dd>#{a.id}</dd>
                </dl>
            ) : (
                <p className="imcrm-mt-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-whatsapp-account-error">
                    {web.account_error ?? __('No se pudo leer el número en Whats.')}
                </p>
            )}
            {down && (
                <p className="imcrm-mt-3 imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="imcrm-whatsapp-account-down">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {__('Mientras el número no esté conectado, los mensajes no salen. Vuelve a vincularlo en tu panel de Whats escaneando el código QR con el teléfono.')}
                </p>
            )}
            {web.missing_abilities.length > 0 && (
                <div className="imcrm-mt-3 imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm" data-testid="imcrm-whatsapp-missing-abilities">
                    <KeyRound className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-amber-600" />
                    <div>
                        <p>
                            {__('A la clave le faltan permisos:')} <span className="imcrm-font-medium">{web.missing_abilities.map(abilityText).join(', ')}</span>.
                        </p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Edítala en tu panel de Whats (API Keys), marca los permisos y toca «Actualizar clave» en Integraciones.')}
                        </p>
                    </div>
                </div>
            )}
            {d.connection.secret_state === 'unreadable' && (
                <p className="imcrm-mt-3 imcrm-text-sm imcrm-text-destructive">{__('La clave guardada no se puede leer: vuelve a escribirla en «Actualizar clave».')}</p>
            )}
            <WhatsActionsAvailability connectionId={d.connection.id} />
        </section>
    );
}

/**
 * v0.1.401 — Qué acciones de las automatizaciones se pueden usar con esta clave
 * (las de contactos, etiquetas, flujos o la bandeja piden permisos aparte).
 */
function WhatsActionsAvailability({ connectionId }: { connectionId: number }): JSX.Element | null {
    const q = useQuery({
        queryKey: ['whats-abilities', connectionId],
        queryFn: () => api.whatsAbilities(connectionId),
        retry: false,
        staleTime: 60_000,
    });
    if (!q.data || q.data.error) return null;
    const actions = INTEGRATIONS.find((i) => i.key === 'whatsapp_web')?.actions ?? [];
    const blocked = actions.filter((a) => (q.data.missing[a.key] ?? []).length > 0);
    const abilities = [...new Set(blocked.flatMap((a) => q.data.missing[a.key] ?? []))];
    return (
        <div className="imcrm-mt-3 imcrm-border-t imcrm-border-border imcrm-pt-3 imcrm-text-sm" data-testid="imcrm-whats-actions-availability" data-blocked={blocked.length}>
            {blocked.length === 0 ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-emerald-700 dark:imcrm-text-emerald-400">
                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4" />
                    {__('Con esta clave puedes usar todas las acciones de Whats en tus automatizaciones.')}
                </p>
            ) : (
                <>
                    <p>
                        {__('En tus automatizaciones puedes usar')} <span className="imcrm-font-medium">{actions.length - blocked.length}</span> {__('de')} {actions.length}{' '}
                        {__('acciones de Whats. Para usar también')} «{blocked.slice(0, 4).map((a) => __(a.label)).join('», «')}»
                        {blocked.length > 4 ? ` ${__('y otras')} ${blocked.length - 4}` : ''}, {__('a la clave le faltan:')}{' '}
                        <span className="imcrm-font-medium">{abilities.map(abilityText).join(', ')}</span>.
                    </p>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Si no las vas a usar, no hace falta. Si sí: edita la clave en tu panel de Whats (API Keys), marca esos permisos y toca «Actualizar clave» en Integraciones.')}
                    </p>
                </>
            )}
        </div>
    );
}

function WebHookSection({
    d,
    web,
    onData,
}: {
    d: WhatsappConnectionDetail;
    web: NonNullable<WhatsappConnectionDetail['web']>;
    onData: (d: WhatsappConnectionDetail) => void;
}): JSX.Element {
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const register = useMutation({
        mutationFn: () => api.whatsappSubscribe(d.connection.id, false),
        onSuccess: (res) => {
            onData(res);
            setMsg({ ok: true, text: __('Listo: los avisos quedaron registrados en Whats.') });
        },
        onError: (err) => setMsg({ ok: false, text: errText(err) }),
    });
    const w = d.webhook;
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-whatsapp-webhook" data-tour="whatsapp-web-hook">
            <h2 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Webhook className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {__('Recibir mensajes y estados')}
                {web.hook.registered ? (
                    <Badge variant="success" data-testid="imcrm-whatsapp-hook-registered">
                        {__('Activos')}
                    </Badge>
                ) : (
                    <Badge variant="warning" data-testid="imcrm-whatsapp-hook-missing">
                        {__('Sin registrar')}
                    </Badge>
                )}
                {w.last_hook_at ? (
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-normal imcrm-text-emerald-700 dark:imcrm-text-emerald-400" data-testid="imcrm-whatsapp-last-hook">
                        <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Último aviso')} {formatDateTimeStr(w.last_hook_at)}
                    </span>
                ) : (
                    <span className="imcrm-text-xs imcrm-font-normal imcrm-text-muted-foreground">{__('Todavía no llegó ningún aviso.')}</span>
                )}
            </h2>
            <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                {__('No tienes que configurar nada: la app registró sola los avisos en tu cuenta de Whats, y sólo pide los que usas.')}
            </p>
            <ListeningInfo d={d} />
            {web.hook.error && (
                <p className="imcrm-mt-2 imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-whatsapp-hook-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {web.hook.error}
                </p>
            )}
            <details className="imcrm-mt-2 imcrm-text-sm">
                <summary className="imcrm-cursor-pointer imcrm-text-muted-foreground">{__('Ver la dirección de los avisos')}</summary>
                <CopyRow value={w.url} testId="imcrm-whatsapp-hook-url" />
                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('En tu panel de Whats aparece en «Webhooks» con la dirección de esta app en el nombre. No la borres: sin ella dejan de llegar los mensajes.')}
                </p>
            </details>
            <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button size="sm" variant={web.hook.registered ? 'outline' : 'default'} onClick={() => register.mutate()} disabled={register.isPending} data-testid="imcrm-whatsapp-subscribe">
                    <RefreshCw className={register.isPending ? 'imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin' : 'imcrm-h-3.5 imcrm-w-3.5'} />
                    {web.hook.registered ? __('Registrar los avisos de nuevo') : __('Registrar los avisos')}
                </Button>
                {msg && (
                    <span className={msg.ok ? 'imcrm-text-sm imcrm-text-emerald-700 dark:imcrm-text-emerald-400' : 'imcrm-text-sm imcrm-text-destructive'} data-testid="imcrm-whatsapp-subscribe-msg">
                        {msg.text}
                    </span>
                )}
            </div>
        </section>
    );
}

/**
 * v0.1.391 — Qué avisos usa la app y por qué. Cada aviso cuesta (una petición,
 * la cola, la base): se reciben sólo los que algo usa, y aquí se dice cuáles.
 */
function ListeningInfo({ d }: { d: WhatsappConnectionDetail }): JSX.Element {
    const l = d.listening;
    const web = d.provider === 'whatsapp_web';
    const row = (on: boolean, title: string, text: string, testId: string): JSX.Element => (
        <li className="imcrm-flex imcrm-items-start imcrm-gap-2" data-testid={testId} data-on={on ? '1' : '0'}>
            {on ? (
                <CheckCircle2 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" />
            ) : (
                <CircleSlash className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
            )}
            <span>
                <span className="imcrm-font-medium">{title}</span> <span className="imcrm-text-muted-foreground">{text}</span>
            </span>
        </li>
    );
    const lists = l.status_lists.map((n) => `«${n}»`).join(', ');
    return (
        <div className="imcrm-mt-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3" data-testid="imcrm-whatsapp-listening">
            <p className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Qué recibe la app')}</p>
            <ul className="imcrm-mt-2 imcrm-space-y-1.5 imcrm-text-sm">
                {row(
                    l.inbound,
                    __('Mensajes que te escriben:'),
                    l.inbound
                        ? __('sí, porque caen en la lista de abajo.')
                        : web
                          ? __('no. Nada los usa: elige abajo la lista donde caen y se activan solos.')
                          : __('sólo se anota que el contacto escribió (abre la ventana de 24 h). Para guardarlos, elige abajo la lista donde caen.'),
                    'imcrm-whatsapp-listen-inbound',
                )}
                {row(
                    l.statuses,
                    __('Entregado y leído:'),
                    l.statuses
                        ? `${__('sí, porque se muestran en')} ${lists}.`
                        : __('no, sólo las fallas. Ninguna lista muestra el estado del último envío (toca «Preparar columnas» en una lista para verlo).'),
                    'imcrm-whatsapp-listen-statuses',
                )}
                {row(true, __('Fallas:'), __('siempre: un mensaje que no salió se marca y, si es de la conexión, aparece en Problemas.'), 'imcrm-whatsapp-listen-failures')}
            </ul>
            <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                {web
                    ? __('Whats manda sólo estos avisos: así la app no procesa lo que no usas. Se ajusta solo cuando eliges una lista o preparas columnas.')
                    : __('Meta manda todos los avisos; la app descarta al instante los que nada usa.')}
            </p>
        </div>
    );
}

// ── Recibir mensajes ────────────────────────────────────────────────────

function WebhookSection({ d, onData }: { d: WhatsappConnectionDetail; onData: (d: WhatsappConnectionDetail) => void }): JSX.Element {
    const [msg, setMsg] = useState<string | null>(null);
    const subscribe = useMutation({
        mutationFn: (override: boolean) => api.whatsappSubscribe(d.connection.id, override),
        onSuccess: (res, override) => {
            onData(res);
            setMsg(override ? __('Listo: Meta mandará los avisos de esta cuenta a la URL de abajo.') : __('Listo: la cuenta quedó suscrita a la app de Meta.'));
        },
        onError: (err) => setMsg(errText(err)),
    });
    const w = d.webhook;
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-whatsapp-webhook">
            <h2 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Webhook className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {__('Recibir mensajes y estados')}
                {w.last_hook_at ? (
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-normal imcrm-text-emerald-700 dark:imcrm-text-emerald-400" data-testid="imcrm-whatsapp-last-hook">
                        <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Último aviso')} {formatDateTimeStr(w.last_hook_at)}
                    </span>
                ) : (
                    <span className="imcrm-text-xs imcrm-font-normal imcrm-text-muted-foreground">{__('Todavía no llegó ningún aviso de Meta.')}</span>
                )}
            </h2>
            <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                {__('Meta avisa a la app cada vez que un contacto escribe y cuando un mensaje se entrega, se lee o falla. Configúralo una sola vez en tu app de Meta:')}
            </p>
            <ListeningInfo d={d} />
            <ol className="imcrm-mt-3 imcrm-list-decimal imcrm-space-y-2 imcrm-pl-5 imcrm-text-sm">
                <li>
                    {__('En developers.facebook.com abre tu app → WhatsApp → Configuración → Webhook → «Editar».')}
                </li>
                <li>
                    <span>{__('Pega la URL de devolución de llamada:')}</span>
                    <CopyRow value={w.url} testId="imcrm-whatsapp-hook-url" />
                </li>
                <li>
                    <span>{__('Pega el token de verificación y toca «Verificar y guardar»:')}</span>
                    <CopyRow value={w.verify_token} testId="imcrm-whatsapp-verify-token" />
                </li>
                <li>{__('En «Campos del webhook», suscríbete a «messages» (ahí llegan los mensajes y los estados).')}</li>
                <li>
                    {__('Suscribe la cuenta de WhatsApp Business a tu app con el botón de abajo (es lo mismo que hacerlo con la API).')}
                </li>
            </ol>
            <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <Button size="sm" onClick={() => subscribe.mutate(false)} disabled={subscribe.isPending} data-testid="imcrm-whatsapp-subscribe">
                    <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Suscribir la cuenta')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => subscribe.mutate(true)} disabled={subscribe.isPending} data-testid="imcrm-whatsapp-subscribe-override">
                    {__('Usar esta URL sólo para esta cuenta')}
                </Button>
                {w.subscribed === true && (
                    <Badge variant="success" data-testid="imcrm-whatsapp-subscribed">
                        {__('Cuenta suscrita')}
                    </Badge>
                )}
                {w.subscribed === false && <Badge variant="warning">{__('La cuenta no está suscrita')}</Badge>}
            </div>
            <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground">
                {__('«Usar esta URL sólo para esta cuenta» sirve si tu app de Meta ya manda sus avisos a otro sistema: Meta usará esta URL para esta cuenta sin cambiar la de la app. Igual hace falta el paso 4.')}
            </p>
            {w.subscribe_error && w.subscribed === null && (
                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">{w.subscribe_error}</p>
            )}
            {msg && <p className="imcrm-mt-2 imcrm-text-sm" data-testid="imcrm-whatsapp-subscribe-msg">{msg}</p>}
            {!d.connection.has_app_secret && (
                <p className="imcrm-mt-2 imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-destructive">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                    {__('Falta la clave secreta de la app: sin ella no se puede comprobar que los avisos vienen de Meta y se rechazan. Cárgala en «Actualizar clave».')}
                </p>
            )}
        </section>
    );
}

function CopyRow({ value, testId }: { value: string; testId: string }): JSX.Element {
    return (
        <div className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2">
            <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-text-xs" data-testid={testId}>
                {value}
            </code>
            <CopyButton value={value} label={__('Copiar')} testId={`${testId}-copy`} />
        </div>
    );
}

// ── Dónde caen los mensajes ─────────────────────────────────────────────

function emptyFields(): WhatsappListFields {
    return Object.fromEntries(WHATSAPP_FIELD_ROLES.map((r) => [r, null])) as WhatsappListFields;
}

function InboundSection({ d, onData }: { d: WhatsappConnectionDetail; onData: (d: WhatsappConnectionDetail) => void }): JSX.Element {
    const qc = useQueryClient();
    const [listId, setListId] = useState<number | null>(d.config.inbound_list_id);
    const [create, setCreate] = useState(d.config.create_contacts);
    const [fields, setFields] = useState<WhatsappListFields>(d.inbound_columns?.fields ?? emptyFields());
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    // Al cambiar de lista, se leen SUS columnas (con la sugerencia del servidor).
    const columns = useQuery({
        queryKey: ['whatsapp-columns', listId],
        queryFn: () => api.whatsappListColumns(listId!),
        enabled: listId !== null && listId !== d.inbound_columns?.list_id,
        retry: false,
    });
    const current = listId !== null && listId === d.inbound_columns?.list_id ? d.inbound_columns : (columns.data ?? null);
    useEffect(() => {
        if (current) setFields(current.fields);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.list_id]);

    const save = useMutation({
        mutationFn: () => api.whatsappUpdateConfig(d.connection.id, { inbound_list_id: listId, create_contacts: create, ...(listId !== null ? { fields } : {}) }),
        onSuccess: (res) => {
            onData(res);
            setMsg({ ok: true, text: __('Guardado.') });
        },
        onError: (err) => setMsg({ ok: false, text: errText(err) }),
    });
    const setup = useMutation({
        mutationFn: () => api.whatsappSetupListColumns(listId!),
        onSuccess: (res) => {
            setFields(res.fields);
            // Los campos recién creados tienen que aparecer como opciones.
            qc.setQueryData(['whatsapp-columns', listId], res);
            if (listId === d.inbound_columns?.list_id) onData({ ...d, inbound_columns: res });
            setMsg({ ok: true, text: __('Columnas listas en la lista. Revisa y guarda.') });
        },
        onError: (err) => setMsg({ ok: false, text: errText(err) }),
    });
    const missing = WHATSAPP_FIELD_ROLES.filter((r) => fields[r] === null).length;

    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-whatsapp-inbound">
            <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Inbox className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {__('Dónde caen los mensajes')}
            </h2>
            <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                {__('Cuando alguien escribe, la app lo busca por su teléfono en esta lista y deja en su registro el último mensaje. No se guarda el historial de la conversación: eso queda en WhatsApp.')}
            </p>
            <div className="imcrm-mt-3 imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <label className="imcrm-space-y-1 imcrm-text-sm">
                    <span className="imcrm-font-medium">{__('Lista de contactos')}</span>
                    <Select
                        value={listId ?? ''}
                        onChange={(e) => {
                            setMsg(null);
                            setListId(e.target.value === '' ? null : Number(e.target.value));
                        }}
                        data-testid="imcrm-whatsapp-inbound-list"
                    >
                        <option value="">
                            {d.provider === 'whatsapp_web' ? __('Ninguna (no se reciben los mensajes que te escriben)') : __('Ninguna (sólo se abre la ventana de 24 h)')}
                        </option>
                        {d.lists.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </Select>
                </label>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-pt-6 imcrm-text-sm">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={create}
                        disabled={listId === null}
                        onChange={(e) => setCreate(e.target.checked)}
                        data-testid="imcrm-whatsapp-create-contacts"
                    />
                    <span>
                        {__('Si el número no está en la lista, crear el registro')}
                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('Con el nombre que el contacto tiene en WhatsApp.')}</span>
                    </span>
                </label>
            </div>

            {listId !== null && (
                <div className="imcrm-mt-4 imcrm-space-y-2" data-testid="imcrm-whatsapp-columns">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                            <ListChecks className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                            {__('Columnas que se escriben')}
                        </h3>
                        {missing > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setup.mutate()} disabled={setup.isPending} data-testid="imcrm-whatsapp-setup">
                                {__('Preparar columnas')}
                            </Button>
                        )}
                    </div>
                    {columns.isLoading ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
                    ) : current ? (
                        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                            {WHATSAPP_FIELD_ROLES.map((role) => {
                                const meta = WHATSAPP_FIELD_ROLE_META[role];
                                const cands = current.candidates[role] ?? [];
                                return (
                                    <label key={role} className="imcrm-space-y-1 imcrm-text-sm">
                                        <span className="imcrm-font-medium">{__(meta.label)}</span>
                                        <Select
                                            value={fields[role] ?? ''}
                                            onChange={(e) => setFields({ ...fields, [role]: e.target.value === '' ? null : Number(e.target.value) })}
                                            data-testid={`imcrm-whatsapp-col-${role}`}
                                        >
                                            <option value="">{__('— No escribir —')}</option>
                                            {cands.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.label}
                                                </option>
                                            ))}
                                        </Select>
                                        <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(meta.help)}</span>
                                    </label>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="imcrm-text-sm imcrm-text-destructive">{errText(columns.error)}</p>
                    )}
                    {fields.phone === null && (
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                            <AlertTriangle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            {__('Sin la columna «Teléfono» la app no puede encontrar al contacto: elige el campo con el número.')}
                        </p>
                    )}
                </div>
            )}

            <div className="imcrm-mt-4 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || setup.isPending} data-testid="imcrm-whatsapp-inbound-save">
                    {__('Guardar')}
                </Button>
                {msg && (
                    <span className={msg.ok ? 'imcrm-text-sm imcrm-text-emerald-700 dark:imcrm-text-emerald-400' : 'imcrm-text-sm imcrm-text-destructive'} data-testid="imcrm-whatsapp-inbound-msg">
                        {msg.text}
                    </span>
                )}
            </div>
        </section>
    );
}

// ── Plantillas ──────────────────────────────────────────────────────────

function TemplatesSection({ d, onTemplates }: { d: WhatsappConnectionDetail; onTemplates: (t: WhatsappTemplate[]) => void }): JSX.Element {
    const [err, setErr] = useState<string | null>(null);
    const [open, setOpen] = useState<number | null>(null);
    const refresh = useMutation({
        mutationFn: () => api.whatsappRefreshTemplates(d.connection.id),
        onSuccess: (t) => {
            setErr(null);
            onTemplates(t);
        },
        onError: (e) => setErr(errText(e)),
    });
    const sorted = useMemo(
        () => [...d.templates].sort((a, b) => Number(b.status === 'APPROVED') - Number(a.status === 'APPROVED') || a.name.localeCompare(b.name)),
        [d.templates],
    );
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" data-testid="imcrm-whatsapp-templates">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                        <MessageCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Plantillas')}
                    </h2>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {d.templates_synced_at ? `${__('Actualizadas')} ${formatDateTimeStr(d.templates_synced_at)}` : __('Todavía no se trajeron.')}{' '}
                        {__('Se actualizan solas cada 6 horas.')}
                    </p>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Button size="sm" variant="outline" asChild>
                        <a href={d.template_manager_url} target="_blank" rel="noopener noreferrer" data-testid="imcrm-whatsapp-manager">
                            <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Crear o editar en Meta')}
                        </a>
                    </Button>
                    <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="imcrm-whatsapp-refresh">
                        <RefreshCw className={refresh.isPending ? 'imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin' : 'imcrm-h-3.5 imcrm-w-3.5'} />
                        {__('Actualizar plantillas')}
                    </Button>
                </div>
            </div>
            {err && <p className="imcrm-px-4 imcrm-pt-3 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-whatsapp-templates-error">{err}</p>}
            {sorted.length === 0 ? (
                <p className="imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('No hay plantillas. Créalas en el administrador de WhatsApp de Meta; cuando Meta las apruebe, toca «Actualizar plantillas».')}
                </p>
            ) : (
                <ul className="imcrm-divide-y imcrm-divide-border">
                    {sorted.map((t) => (
                        <li key={t.id} className="imcrm-px-4 imcrm-py-3" data-testid="imcrm-whatsapp-template" data-name={t.name}>
                            <button
                                type="button"
                                className="imcrm-flex imcrm-w-full imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-left"
                                onClick={() => setOpen(open === t.id ? null : t.id)}
                                aria-expanded={open === t.id}
                            >
                                <span className="imcrm-font-mono imcrm-text-sm imcrm-font-medium">{t.name}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{t.language}</span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">· {templateCategoryLabel(t.category)}</span>
                                <span className="imcrm-ml-auto">
                                    <TemplateStatusBadge status={t.status} />
                                </span>
                            </button>
                            {t.rejected_reason && t.status === 'REJECTED' && (
                                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive">
                                    {__('Motivo:')} {rejectedReasonText(t.rejected_reason)}
                                </p>
                            )}
                            {open === t.id && <WhatsappBubble className="imcrm-mt-2" template={t} variables={{}} />}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
