import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SMS_FIELD_ROLES, SMS_FIELD_ROLE_META, SMS_PROVIDER_META, type SmsConnectionDetail, type SmsListFields, type SmsMessageDto } from '@imagina-base/shared';
import { AlertTriangle, ArrowLeft, CheckCircle2, ListChecks, Sparkles, Webhook } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { CopyButton } from '@/cloud/components/payments/paymentUi';
import { SmsStatusChip } from '@/cloud/components/sms/smsUi';
import { api } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * SMS (ADR-S82) — la página de una conexión de SMS: cómo llegan los avisos de
 * entrega (solos, pegando la URL en el proveedor o consultando), qué columnas
 * de una lista guardan el último envío y los SMS recientes con su estado.
 */
export function SmsPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const q = useQuery({
        queryKey: ['sms-connection', id],
        queryFn: () => api.smsConnection(id),
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
        refetchInterval: 15_000,
    });

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
    const provider = SMS_PROVIDER_META[d.connection.provider];

    return (
        <div className="imcrm-mx-auto imcrm-max-w-5xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-sms-page">
            {back}
            <header className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey={d.connection.provider} size={48} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h1 className="imcrm-text-xl imcrm-font-semibold">{d.connection.name}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {sprintf(/* translators: %s: proveedor */ __('SMS con tu cuenta de %s. Cada SMS se cobra a esa cuenta.'), provider.label)}
                        {d.connection.account_label ? ` ${d.connection.account_label}.` : ''}
                    </p>
                </div>
            </header>

            {d.last_error && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-sms-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" />
                    <div>
                        <p className="imcrm-font-medium">{__('La conexión está fallando')}</p>
                        <p className="imcrm-text-muted-foreground">{d.last_error}</p>
                    </div>
                </div>
            )}

            <section className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 sm:imcrm-grid-cols-5" data-testid="imcrm-sms-totals">
                <Stat label={__('Enviados (30 días)')} value={d.totals.sent_30d} />
                <Stat label={__('Entregados')} value={d.totals.delivered_30d} />
                <Stat label={__('Fallidos')} value={d.totals.failed_30d} />
                <Stat label={__('Programados o en cola')} value={d.totals.pending} />
                <Stat label={__('SMS cobrados')} value={d.totals.segments_30d} />
            </section>

            <DeliverySection d={d} />
            <ColumnsSection d={d} />
            <RecentSection items={d.recent} />

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-sms-ideas">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Ideas para usarlo')}
                </h2>
                <ul className="imcrm-mt-2 imcrm-list-disc imcrm-space-y-1.5 imcrm-pl-5 imcrm-text-sm imcrm-text-muted-foreground">
                    <li>{__('Avisos automáticos: en una automatización, acción «Enviar SMS» (pedido listo, pago recibido, cita confirmada).')}</li>
                    <li>{__('Cobranza: con «Respetar el horario» los recordatorios de pago salen sólo en la franja que permite la Ley 2300.')}</li>
                    <li>{__('Recordatorios de cita: en la agenda, sección «Correos y recordatorios», manda el recordatorio también por SMS.')}</li>
                    <li>{__('A varios a la vez: marca registros en la tabla y elige «SMS» en la barra de selección.')}</li>
                </ul>
            </section>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-3">
            <div className="imcrm-text-xs imcrm-text-muted-foreground">{label}</div>
            <div className="imcrm-mt-0.5 imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums">{value}</div>
        </div>
    );
}

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

function DeliverySection({ d }: { d: SmsConnectionDetail }): JSX.Element {
    const mode = d.delivery.mode;
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-sms-delivery" data-mode={mode}>
            <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <Webhook className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {__('Estado de entrega')}
            </h2>
            {mode === 'auto' && (
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('No tienes que configurar nada: cada SMS lleva la dirección a la que el proveedor avisa cuando se entrega o falla, y el estado se actualiza solo en el registro.')}
                </p>
            )}
            {mode === 'poll' && (
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Este proveedor no avisa: la app pregunta el estado de cada SMS durante los tres días siguientes al envío (más seguido al principio) y lo deja en el registro.')}
                </p>
            )}
            {mode === 'manual' && (
                <div className="imcrm-mt-1 imcrm-space-y-2 imcrm-text-sm">
                    <p className="imcrm-text-muted-foreground">
                        {__('Pega esta dirección en tu proveedor para que avise cuando un SMS se entrega o falla. En BulkGate está en el portal, en la configuración de tu API (Módulos y APIs), en el campo de la dirección para los reportes de entrega. Hasta que la pegues, los SMS quedan como «enviado».')}
                    </p>
                </div>
            )}
            {mode !== 'poll' && (
                <div className="imcrm-mt-3 imcrm-space-y-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-rounded imcrm-bg-muted imcrm-px-2 imcrm-py-1 imcrm-text-xs" data-testid="imcrm-sms-delivery-url">
                            {d.delivery.url}
                        </code>
                        <CopyButton value={d.delivery.url} testId="imcrm-sms-delivery-copy" />
                    </div>
                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-sms-delivery-last">
                        {d.delivery.last_hook_at ? (
                            <>
                                <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-emerald-600" />
                                {sprintf(/* translators: %s: fecha */ __('Último aviso recibido: %s'), formatDateTimeStr(d.delivery.last_hook_at))}
                            </>
                        ) : (
                            __('Todavía no llegó ningún aviso.')
                        )}
                    </p>
                </div>
            )}
        </section>
    );
}

function emptyFields(): SmsListFields {
    return { phone: null, last_at: null, last_status: null };
}

function ColumnsSection({ d }: { d: SmsConnectionDetail }): JSX.Element {
    const qc = useQueryClient();
    const [listId, setListId] = useState<number | null>(d.lists[0]?.id ?? null);
    const [fields, setFields] = useState<SmsListFields>(emptyFields());
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const columns = useQuery({
        queryKey: ['sms-columns', listId],
        queryFn: () => api.smsListColumns(listId!),
        enabled: listId !== null,
        retry: false,
    });
    const current = columns.data ?? null;
    useEffect(() => {
        if (current) setFields(current.fields);
    }, [current]);
    const save = useMutation({
        mutationFn: () => api.smsSaveListColumns(listId!, fields),
        onSuccess: (res) => {
            qc.setQueryData(['sms-columns', listId], res);
            setMsg({ ok: true, text: __('Guardado.') });
        },
        onError: (err) => setMsg({ ok: false, text: errText(err) }),
    });
    const setup = useMutation({
        mutationFn: () => api.smsSetupListColumns(listId!),
        onSuccess: (res) => {
            qc.setQueryData(['sms-columns', listId], res);
            setMsg({ ok: true, text: __('Columnas listas en la lista.') });
        },
        onError: (err) => setMsg({ ok: false, text: errText(err) }),
    });
    const missing = SMS_FIELD_ROLES.filter((r) => fields[r] === null).length;

    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-sms-columns">
            <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                <ListChecks className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                {__('Columnas de la lista')}
            </h2>
            <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                {__('En cada registro queda cuándo salió el último SMS y su estado (programado, en cola, enviado, entregado o fallido). El texto del mensaje no se guarda.')}
            </p>
            <div className="imcrm-mt-3 imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <label className="imcrm-space-y-1 imcrm-text-sm">
                    <span className="imcrm-font-medium">{__('Lista')}</span>
                    <Select
                        value={listId ?? ''}
                        onChange={(e) => {
                            setMsg(null);
                            setListId(e.target.value === '' ? null : Number(e.target.value));
                        }}
                        data-testid="imcrm-sms-columns-list"
                    >
                        {d.lists.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </Select>
                </label>
            </div>
            {listId !== null && current && (
                <div className="imcrm-mt-4 imcrm-space-y-3">
                    <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3">
                        {SMS_FIELD_ROLES.map((role) => {
                            const meta = SMS_FIELD_ROLE_META[role];
                            const cands = current.candidates[role] ?? [];
                            return (
                                <label key={role} className="imcrm-space-y-1 imcrm-text-sm">
                                    <span className="imcrm-font-medium">{__(meta.label)}</span>
                                    <Select
                                        value={fields[role] ?? ''}
                                        onChange={(e) => setFields({ ...fields, [role]: e.target.value === '' ? null : Number(e.target.value) })}
                                        data-testid={`imcrm-sms-col-${role}`}
                                    >
                                        <option value="">{__('(no guardar)')}</option>
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
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        {missing > 0 && (
                            <Button size="sm" variant="outline" onClick={() => setup.mutate()} disabled={setup.isPending} data-testid="imcrm-sms-setup" data-tour="integrations-sms-setup">
                                {__('Preparar columnas')}
                            </Button>
                        )}
                        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending} data-testid="imcrm-sms-columns-save">
                            {__('Guardar')}
                        </Button>
                        {msg && <span className={msg.ok ? 'imcrm-text-xs imcrm-text-emerald-700 dark:imcrm-text-emerald-400' : 'imcrm-text-xs imcrm-text-destructive'}>{msg.text}</span>}
                    </div>
                </div>
            )}
        </section>
    );
}

const SOURCE_LABEL: Record<string, string> = {
    manual: 'Desde el registro',
    automation: 'Automatización',
    bulk: 'A varios',
    booking: 'Recordatorio de cita',
    test: 'Prueba',
};

function RecentSection({ items }: { items: SmsMessageDto[] }): JSX.Element {
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-sms-recent">
            <h2 className="imcrm-text-sm imcrm-font-semibold">{__('SMS recientes')}</h2>
            {items.length === 0 ? (
                <p className="imcrm-mt-2 imcrm-text-sm imcrm-text-muted-foreground">{__('Todavía no se mandó ningún SMS con esta conexión.')}</p>
            ) : (
                <ul className="imcrm-mt-2 imcrm-divide-y imcrm-divide-border">
                    {items.map((m) => (
                        <li key={m.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-py-2 imcrm-text-sm" data-testid="imcrm-sms-recent-row">
                            <SmsStatusChip status={m.status} />
                            <span className="imcrm-tabular-nums">{m.to}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{m.segments === 1 ? __('1 SMS') : sprintf(__('%d SMS'), m.segments)}</span>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{__(SOURCE_LABEL[m.source] ?? m.source)}</span>
                            <span className="imcrm-ml-auto imcrm-text-xs imcrm-text-muted-foreground">
                                {m.status === 'programado' && m.send_after
                                    ? sprintf(/* translators: %s: fecha */ __('Sale %s'), formatDateTimeStr(m.send_after))
                                    : formatDateTimeStr(m.sent_at ?? m.created_at)}
                            </span>
                            {m.error && <span className="imcrm-w-full imcrm-text-xs imcrm-text-destructive">{m.error}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
