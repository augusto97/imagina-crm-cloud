import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
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
    ExternalLink,
    Inbox,
    ListChecks,
    MessageCircle,
    RefreshCw,
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
 * WhatsApp Business oficial (D3): cómo le llegan los mensajes a la app, en
 * qué lista caen, qué columnas se escriben y las plantillas aprobadas en Meta.
 * La app NO es un chat: en cada registro queda el último mensaje y el estado
 * del último envío.
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
                    <li>{__('Reaccionar a lo que escriben: disparador «Cuando llega un mensaje de WhatsApp», con {{whatsapp.texto}} y {{whatsapp.nombre}}.')}</li>
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
                        <option value="">{__('Ninguna (sólo se abre la ventana de 24 h)')}</option>
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
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="imcrm-whatsapp-inbound-save">
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
