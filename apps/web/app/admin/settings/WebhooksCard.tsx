import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    WEBHOOK_EVENT_LABELS,
    WEBHOOK_EVENTS,
    type CreatedWebhookSubscriptionDto,
    type WebhookDeliveryDto,
    type WebhookEvent,
    type WebhookSubscriptionDto,
} from '@imagina-base/shared';
import { Check, Copy, History, Loader2, PauseCircle, PlayCircle, RefreshCw, Send, Trash2, Webhook } from 'lucide-react';

import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLists } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

import { webhookVerifyExample } from './apiExamples';

const DELIVERY_STATUS: Record<WebhookDeliveryDto['status'], { label: string; tone: 'success' | 'destructive' | 'secondary' | 'outline' }> = {
    success: { label: 'Entregado', tone: 'success' },
    failed: { label: 'Falló', tone: 'destructive' },
    pending: { label: 'Se reintenta', tone: 'outline' },
    skipped: { label: 'No se mandó', tone: 'secondary' },
};

/**
 * v0.1.442 — Ajustes → API → Webhooks: avisarle a otro programa (n8n, Make,
 * Zapier, un ERP) en el momento en que se crea, cambia o borra un registro, se
 * envía un formulario o entra un pago. Cada aviso va firmado; el secreto se ve
 * una sola vez. El historial muestra cada entrega con lo que respondió el
 * otro lado y permite volver a mandarla.
 */
export function WebhooksCard(): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const tenantId = useSession((s) => s.activeTenantId);
    const lists = useLists();
    const subs = useQuery({ queryKey: ['webhooks', tenantId], queryFn: () => api.webhooks() });
    const [creating, setCreating] = useState(false);
    const [url, setUrl] = useState('');
    const [name, setName] = useState('');
    const [events, setEvents] = useState<WebhookEvent[]>(['record.created', 'record.updated']);
    const [allLists, setAllLists] = useState(true);
    const [listIds, setListIds] = useState<number[]>([]);
    const [secret, setSecret] = useState<CreatedWebhookSubscriptionDto | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const [openLog, setOpenLog] = useState<number | null>(null);
    const [testResult, setTestResult] = useState<Record<number, string>>({});

    const invalidate = (): Promise<void> => qc.invalidateQueries({ queryKey: ['webhooks', tenantId] });
    const copy = async (text: string, key: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
        } catch {
            // sin portapapeles: el texto queda seleccionable
        }
    };

    const create = useMutation({
        mutationFn: () =>
            api.createWebhook({
                url: url.trim(),
                events,
                ...(name.trim() ? { name: name.trim() } : {}),
                list_ids: allLists ? null : listIds,
            }),
        onSuccess: (res) => {
            setSecret(res);
            setCreating(false);
            setUrl('');
            setName('');
            void invalidate();
        },
    });
    const toggle = useMutation({
        mutationFn: (s: WebhookSubscriptionDto) => api.updateWebhook(s.id, { active: !s.active }),
        onSuccess: () => void invalidate(),
    });
    const remove = useMutation({ mutationFn: (id: number) => api.deleteWebhook(id), onSuccess: () => void invalidate() });
    const rotate = useMutation({
        mutationFn: (id: number) => api.rotateWebhookSecret(id),
        onSuccess: (res) => {
            setSecret(res);
            void invalidate();
        },
    });
    const test = useMutation({
        mutationFn: (id: number) => api.testWebhook(id),
        onSuccess: (res, id) => {
            setTestResult((m) => ({
                ...m,
                [id]: res.ok ? sprintf(__('Llegó: respondió %d en %d ms.'), res.status ?? 0, res.duration_ms) : (res.error ?? __('No llegó.')),
            }));
            void invalidate();
            void qc.invalidateQueries({ queryKey: ['webhook-deliveries', tenantId, id] });
        },
    });

    const listName = (id: number): string => lists.data?.find((l) => l.id === id)?.name ?? `#${id}`;
    const toggleEvent = (e: WebhookEvent): void => setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
    const canCreate = url.trim() !== '' && events.length > 0 && (allLists || listIds.length > 0);

    return (
        <section className="imcrm-flex imcrm-max-w-3xl imcrm-flex-col imcrm-gap-4" data-testid="imcrm-webhooks-card" data-tour="settings-webhooks">
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <div>
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                        <Webhook className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                        {__('Webhooks: avisos a otros programas')}
                    </h2>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Le avisamos a la dirección que pongas en el momento en que pasa algo: un registro nuevo, un cambio, un formulario enviado o un pago recibido. Así n8n, Make o tu sistema no tienen que estar preguntando.')}
                    </p>
                </div>
                {!creating && (
                    <Button size="sm" className="imcrm-shrink-0" onClick={() => setCreating(true)} data-testid="imcrm-webhook-new" data-tour="settings-webhooks-new">
                        <Webhook className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5" /> {__('Nuevo webhook')}
                    </Button>
                )}
            </div>

            {creating && (
                <form
                    className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (canCreate) create.mutate();
                    }}
                    data-testid="imcrm-webhook-form"
                >
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 sm:imcrm-col-span-2">
                            <Label htmlFor="wh-url" className="imcrm-text-xs">{__('Dirección que recibe los avisos')}</Label>
                            <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.tuempresa.com/webhook/…" autoFocus data-testid="imcrm-webhook-url" />
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="wh-name" className="imcrm-text-xs">{__('Nombre (opcional)')}</Label>
                            <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={__('Flujo de ventas')} maxLength={80} />
                        </div>
                    </div>
                    <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium">{__('Cuándo avisar')}</legend>
                        {WEBHOOK_EVENTS.map((e) => (
                            <label key={e} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" className="imcrm-mt-0.5" checked={events.includes(e)} onChange={() => toggleEvent(e)} data-testid={`imcrm-webhook-event-${e}`} />
                                <span>
                                    {__(WEBHOOK_EVENT_LABELS[e].label)}
                                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(WEBHOOK_EVENT_LABELS[e].description)}</span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                    <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <legend className="imcrm-mb-1 imcrm-text-xs imcrm-font-medium">{__('De qué listas')}</legend>
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <input type="radio" checked={allLists} onChange={() => setAllLists(true)} /> {__('De todas las listas que tú ves')}
                        </label>
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <input type="radio" checked={!allLists} onChange={() => setAllLists(false)} data-testid="imcrm-webhook-some-lists" /> {__('Sólo de estas')}
                        </label>
                        {!allLists && (
                            <div className="imcrm-ml-6 imcrm-flex imcrm-max-h-40 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto">
                                {(lists.data ?? []).map((l) => (
                                    <label key={l.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                        <input
                                            type="checkbox"
                                            checked={listIds.includes(l.id)}
                                            onChange={() => setListIds((cur) => (cur.includes(l.id) ? cur.filter((x) => x !== l.id) : [...cur, l.id]))}
                                        />
                                        {l.name}
                                    </label>
                                ))}
                            </div>
                        )}
                    </fieldset>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button type="submit" size="sm" disabled={!canCreate || create.isPending} data-testid="imcrm-webhook-create">
                            {create.isPending && <Loader2 className="imcrm-mr-2 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Crear webhook')}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                            {__('Cancelar')}
                        </Button>
                        {create.isError && <span className="imcrm-text-xs imcrm-text-destructive">{create.error instanceof Error ? create.error.message : __('Error')}</span>}
                    </div>
                </form>
            )}

            {secret && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-success/40 imcrm-bg-success/5 imcrm-p-4" data-testid="imcrm-webhook-secret-box">
                    <p className="imcrm-text-sm imcrm-font-medium">{sprintf(__('Secreto de firma de «%s». Cópialo ahora: no se vuelve a mostrar.'), secret.name)}</p>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-select-all imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-px-2 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs imcrm-ring-1 imcrm-ring-border" data-testid="imcrm-webhook-secret">
                            {secret.secret}
                        </code>
                        <Button size="sm" variant="outline" onClick={() => void copy(secret.secret, 'secret')} aria-label={__('Copiar el secreto')}>
                            {copied === 'secret' ? <Check className="imcrm-h-3.5 imcrm-w-3.5" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
                        </Button>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Cada aviso trae la cabecera «X-Webhook-Signature» con la hora y la firma. Con este secreto puedes comprobar que el aviso lo mandamos nosotros y no otro. Responde con un 2xx rápido: si no, lo volvemos a intentar.')}
                    </p>
                    <pre className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-bg-background imcrm-p-2 imcrm-font-mono imcrm-text-[11px] imcrm-ring-1 imcrm-ring-border">{webhookVerifyExample()}</pre>
                    <Button size="sm" variant="ghost" className="imcrm-self-start" onClick={() => setSecret(null)}>
                        {__('Listo, ya lo guardé')}
                    </Button>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                {subs.isLoading && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />}
                {subs.data?.length === 0 && !creating && (
                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground" data-testid="imcrm-webhooks-empty">
                        {__('Todavía no hay webhooks. Crea uno con la dirección que te da n8n («Webhook» como disparador), Make («Custom webhook») o Zapier («Catch Hook»).')}
                    </p>
                )}
                {(subs.data ?? []).map((s) => (
                    <div key={s.id} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3" data-testid="imcrm-webhook-row">
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                    {s.name}
                                    {s.active ? <Badge variant="success">{__('Activo')}</Badge> : <Badge variant="secondary">{__('Pausado')}</Badge>}
                                    {s.source === 'api' && <Badge variant="outline">{__('Lo registró un programa')}</Badge>}
                                </p>
                                <p className="imcrm-truncate imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground" title={s.url}>{s.url}</p>
                                <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    {s.events.map((e) => __(WEBHOOK_EVENT_LABELS[e].label)).join(' · ')}
                                    {' — '}
                                    {s.list_ids ? s.list_ids.map(listName).join(', ') : __('todas las listas')}
                                </p>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {s.last_delivery_at
                                        ? sprintf(__('Último aviso: %s (%s)'), formatDateTimeStr(s.last_delivery_at), s.last_status === 'success' ? __('entregado') : __('falló'))
                                        : __('Todavía no mandó avisos')}
                                    {s.created_by_name ? ` · ${sprintf(__('Lo creó %s'), s.created_by_name)}` : ''}
                                    {` · ${__('Secreto')} …${s.secret_hint}`}
                                </p>
                                {s.disabled_reason && <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-webhook-disabled-reason">{s.disabled_reason}</p>}
                                {testResult[s.id] && <p className="imcrm-mt-1 imcrm-text-xs" data-testid="imcrm-webhook-test-result">{testResult[s.id]}</p>}
                            </div>
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                                <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(s.id)} data-testid="imcrm-webhook-test">
                                    <Send className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" /> {__('Probar')}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setOpenLog(openLog === s.id ? null : s.id)} aria-expanded={openLog === s.id} data-testid="imcrm-webhook-log-toggle">
                                    <History className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" /> {__('Entregas')}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)} aria-label={s.active ? __('Pausar') : __('Encender')} title={s.active ? __('Pausar') : __('Encender')} data-testid="imcrm-webhook-toggle">
                                    {s.active ? <PauseCircle className="imcrm-h-4 imcrm-w-4" /> : <PlayCircle className="imcrm-h-4 imcrm-w-4" />}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={__('Secreto nuevo')}
                                    title={__('Secreto nuevo')}
                                    onClick={async () => {
                                        const ok = await confirm({
                                            title: __('¿Crear un secreto nuevo?'),
                                            description: __('El secreto actual deja de valer al instante: el programa que recibe los avisos tiene que usar el nuevo para comprobar la firma.'),
                                            confirmLabel: __('Crear secreto nuevo'),
                                        });
                                        if (ok) rotate.mutate(s.id);
                                    }}
                                >
                                    <RefreshCw className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={__('Borrar')}
                                    title={__('Borrar')}
                                    onClick={async () => {
                                        const ok = await confirm({
                                            title: __('¿Borrar este webhook?'),
                                            description: __('Deja de avisar al instante. Lo que estaba esperando un reintento no se manda.'),
                                            confirmLabel: __('Borrar'),
                                            destructive: true,
                                        });
                                        if (ok) remove.mutate(s.id);
                                    }}
                                    data-testid="imcrm-webhook-delete"
                                >
                                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </div>
                        </div>
                        {openLog === s.id && <DeliveryLog subscription={s} />}
                    </div>
                ))}
            </div>
        </section>
    );
}

function DeliveryLog({ subscription }: { subscription: WebhookSubscriptionDto }): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const key = ['webhook-deliveries', tenantId, subscription.id];
    const log = useQuery({ queryKey: key, queryFn: () => api.webhookDeliveries(subscription.id), refetchInterval: 15_000 });
    const redeliver = useMutation({
        mutationFn: (deliveryId: number) => api.redeliverWebhook(subscription.id, deliveryId),
        onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    });
    if (log.isLoading) return <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />;
    const rows = log.data ?? [];
    if (rows.length === 0) return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Todavía no hay entregas. Prueba con «Probar».')}</p>;
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="imcrm-webhook-log">
            {rows.map((d) => {
                const st = DELIVERY_STATUS[d.status];
                const label = d.event === 'ping' ? __('Aviso de prueba') : __(WEBHOOK_EVENT_LABELS[d.event].label);
                return (
                    <li key={d.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-p-2 imcrm-text-xs" data-testid="imcrm-webhook-delivery">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                <Badge variant={st.tone}>{__(st.label)}</Badge>
                                <span className="imcrm-font-medium">{label}</span>
                                {d.record_id ? <span className="imcrm-text-muted-foreground">{sprintf(__('registro #%d'), d.record_id)}</span> : null}
                            </p>
                            <p className="imcrm-mt-0.5 imcrm-text-muted-foreground">
                                {formatDateTimeStr(d.created_at)}
                                {d.attempts > 0 ? ` · ${sprintf(d.attempts === 1 ? __('%d intento') : __('%d intentos'), d.attempts)}` : ''}
                                {d.response_status ? ` · ${sprintf(__('respondió %d'), d.response_status)}` : ''}
                                {d.next_attempt_at ? ` · ${sprintf(__('próximo intento: %s'), formatDateTimeStr(d.next_attempt_at))}` : ''}
                            </p>
                            {d.error && d.status !== 'success' && <p className="imcrm-mt-0.5 imcrm-text-muted-foreground">{d.error}</p>}
                        </div>
                        {d.event !== 'ping' && (d.status === 'failed' || d.status === 'skipped') && subscription.active && (
                            <Button size="sm" variant="outline" disabled={redeliver.isPending} onClick={() => redeliver.mutate(d.id)} data-testid="imcrm-webhook-redeliver">
                                {__('Volver a enviar')}
                            </Button>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
