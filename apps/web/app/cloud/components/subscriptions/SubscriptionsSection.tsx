import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    SUBSCRIPTION_CHARGE_STATUS_LABELS,
    type CreateSubscriptionPlanInput,
    type SubscriptionPlan,
    type SubscriptionsOverview,
} from '@imagina-base/shared';
import { Loader2, Pencil, Plus, Repeat, Trash2, X, Zap } from 'lucide-react';
import { Link } from 'react-router';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';
import { parseLocalAmount } from '@/lib/money';
import { formatDate, formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { CopyButton, formatMoney } from '../payments/paymentUi';
import { SubscriptionStatusChip } from './RecordSubscriptionPanel';
import { cyclesText, frequencyText } from './subscriptionText';

/**
 * v0.1.367 (ADR-S96) — Suscripciones de una conexión de Mercado Pago: los
 * planes, cuánto entra por mes, quién está al día, en mora o vencido, y los
 * últimos cobros. La URL de avisos se pega en la aplicación de Mercado Pago
 * (sin ella igual funciona: la app revisa cada suscripción sola).
 */
export function SubscriptionsSection({ connectionId, hookUrl, testMode }: { connectionId: number; hookUrl: string; testMode: boolean }): JSX.Element {
    const q = useQuery({
        queryKey: ['subscriptions-overview', connectionId],
        queryFn: () => api.subscriptionsOverview(connectionId),
        retry: false,
        refetchInterval: 60_000,
    });
    const [editing, setEditing] = useState<SubscriptionPlan | 'new' | null>(null);

    if (q.isLoading) return <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando las suscripciones…')}</p>;
    if (q.isError || !q.data) {
        return <p className="imcrm-text-sm imcrm-text-destructive">{q.error instanceof CloudApiError ? q.error.message : __('No se pudieron cargar las suscripciones.')}</p>;
    }
    const d = q.data;
    return (
        <div className="imcrm-space-y-4" data-testid="imcrm-subscriptions-section">
            <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-pt-2 imcrm-text-lg imcrm-font-semibold">
                <Repeat className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                {__('Suscripciones (débito automático)')}
            </h2>

            <section className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-4" data-testid="imcrm-subscriptions-totals">
                <Stat label={__('Ingreso mensual')} value={formatMoney(d.totals.monthly, d.totals.currency)} hint={sprintf(__('%d vivas'), d.totals.live)} />
                <Stat label={__('Al día')} value={String(d.totals.active)} />
                <Stat label={__('Reintentando / en mora')} value={`${d.totals.retrying} / ${d.totals.past_due}`} tone={d.totals.past_due > 0 ? 'warn' : undefined} />
                <Stat label={__('Vencidas')} value={String(d.totals.expired)} tone={d.totals.expired > 0 ? 'bad' : undefined} hint={__('Pasaron los días de gracia')} />
            </section>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(__('Últimos 30 días: cobrado %1$s · %2$d cobros rechazados · %3$d canceladas · %4$d por autorizar.'), formatMoney(d.totals.charged_30d, d.totals.currency), d.totals.failed_30d, d.totals.cancelled_30d, d.totals.pending)}
            </p>

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4" data-testid="imcrm-subscriptions-hook">
                <h3 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Zap className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Avisos de las suscripciones')}
                </h3>
                <p className="imcrm-mt-2 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Para enterarte al instante de cada cobro, pega esta URL en tu aplicación de Mercado Pago → Webhooks (en')}{' '}
                    {testMode ? __('modo de prueba') : __('modo productivo')}
                    {__(') y marca los eventos «Pagos» y «Planes y suscripciones». Sin ella igual funciona: la app revisa cada suscripción sola, sólo que se entera unos minutos después.')}
                </p>
                <div className="imcrm-mt-2 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2">
                    <code className="imcrm-min-w-0 imcrm-flex-1 imcrm-break-all imcrm-text-xs">{hookUrl}</code>
                    <CopyButton value={hookUrl} label={__('Copiar')} testId="imcrm-subscriptions-hook-copy" />
                </div>
            </section>

            <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" data-testid="imcrm-subscription-plans">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                    <h3 className="imcrm-flex-1 imcrm-text-sm imcrm-font-semibold">{__('Planes')}</h3>
                    <Button size="sm" onClick={() => setEditing('new')} data-testid="imcrm-plan-new">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nuevo plan')}
                    </Button>
                </div>
                {d.plans.length === 0 ? (
                    <p className="imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Todavía no hay planes. Un plan dice cuánto se cobra y cada cuánto (por ejemplo, «Mantenimiento mensual» por $150.000 cada mes).')}
                    </p>
                ) : (
                    <ul className="imcrm-divide-y imcrm-divide-border">
                        {d.plans.map((p) => (
                            <PlanRow key={p.id} plan={p} onEdit={() => setEditing(p)} />
                        ))}
                    </ul>
                )}
            </section>

            <SubscribersTable overview={d} />

            {d.charges.length > 0 && (
                <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    <h3 className="imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-font-semibold">{__('Últimos cobros')}</h3>
                    <ul className="imcrm-divide-y imcrm-divide-border" data-testid="imcrm-subscriptions-charges">
                        {d.charges.slice(0, 30).map((c) => (
                            <li key={c.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-px-4 imcrm-py-2 imcrm-text-sm">
                                <span className={cn('imcrm-w-24 imcrm-font-medium', c.status === 'approved' && 'imcrm-text-emerald-700 dark:imcrm-text-emerald-400', c.status === 'rejected' && 'imcrm-text-destructive')}>
                                    {__(SUBSCRIPTION_CHARGE_STATUS_LABELS[c.status])}
                                </span>
                                <span className="imcrm-tabular-nums">{formatMoney(c.amount, c.currency)}</span>
                                {c.record_id !== null && c.list_slug ? (
                                    <Link to={`/lists/${c.list_slug}/records/${c.record_id}`} className="imcrm-font-medium hover:imcrm-underline">
                                        {c.record_title}
                                    </Link>
                                ) : (
                                    <span className="imcrm-text-muted-foreground">{__('(registro borrado)')}</span>
                                )}
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {c.plan_name ? `${c.plan_name} · ` : ''}
                                    {formatDateTimeStr(c.paid_at ?? c.created_at)}
                                </span>
                                {c.failure_reason && <span className="imcrm-basis-full imcrm-text-xs imcrm-text-muted-foreground">{c.failure_reason}</span>}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {editing !== null && (
                <PlanDialog connectionId={connectionId} plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
            )}
        </div>
    );
}

function PlanRow({ plan, onEdit }: { plan: SubscriptionPlan; onEdit: () => void }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const confirm = useConfirm();
    const del = useMutation({
        mutationFn: () => api.deleteSubscriptionPlan(plan.id),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['subscriptions-overview'] });
            void qc.invalidateQueries({ queryKey: ['subscription-plans'] });
        },
        onError: (err) => toast.error(__('No se pudo borrar'), err instanceof Error ? err.message : String(err)),
    });
    return (
        <li className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-px-4 imcrm-py-3" data-testid="imcrm-plan-row">
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <span className="imcrm-font-medium">{plan.name}</span>
                    {!plan.active && <Badge variant="secondary">{__('Pausado: no se ofrece')}</Badge>}
                </p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {formatMoney(plan.amount, plan.currency)} {frequencyText(plan.frequency, plan.frequency_type)} · {cyclesText(plan.cycles)}
                    {plan.trial_days > 0 ? ` · ${sprintf(__('%d días gratis'), plan.trial_days)}` : ''} · {sprintf(__('%d días de gracia'), plan.grace_days)}
                    {plan.on_expire === 'cancel' ? ` · ${__('al vencer se cancela')}` : ''}
                </p>
            </div>
            <span className="imcrm-text-xs imcrm-text-muted-foreground">{sprintf(__('%1$d vivas de %2$d'), plan.subscribers.live, plan.subscribers.total)}</span>
            <button type="button" onClick={onEdit} className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground" title={__('Editar')} data-testid="imcrm-plan-edit">
                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
            <button
                type="button"
                disabled={del.isPending}
                onClick={async () => {
                    if (plan.subscribers.total > 0) {
                        toast.info(__('Este plan tiene suscripciones'), __('Pausa el plan para que no se ofrezca más: las suscripciones que ya tiene siguen cobrando.'));
                        return;
                    }
                    const ok = await confirm({ title: __('¿Borrar este plan?'), description: __('No tiene suscripciones, así que no afecta a ningún cliente.'), confirmLabel: __('Borrar'), destructive: true });
                    if (ok) del.mutate();
                }}
                className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                title={__('Borrar')}
            >
                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
        </li>
    );
}

function SubscribersTable({ overview }: { overview: SubscriptionsOverview }): JSX.Element {
    const [filter, setFilter] = useState<'all' | 'attention' | 'live'>('all');
    const rows = overview.subscriptions.filter((s) =>
        filter === 'all' ? true : filter === 'live' ? s.status !== 'cancelled' && s.status !== 'finished' : ['retrying', 'past_due', 'expired', 'pending'].includes(s.status),
    );
    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <h3 className="imcrm-flex-1 imcrm-text-sm imcrm-font-semibold">{__('Suscriptores')}</h3>
                <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="imcrm-w-auto" data-testid="imcrm-subscribers-filter">
                    <option value="all">{__('Todas')}</option>
                    <option value="live">{__('Vivas')}</option>
                    <option value="attention">{__('Para revisar (rechazos, mora, vencidas, por autorizar)')}</option>
                </Select>
            </div>
            {rows.length === 0 ? (
                <p className="imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {overview.subscriptions.length === 0
                        ? __('Todavía no hay suscripciones. Se crean con «Suscribir» en la ficha de un registro o con la acción «Crear suscripción» de una automatización.')
                        : __('Ninguna en este filtro.')}
                </p>
            ) : (
                <div className="imcrm-overflow-x-auto">
                    <table className="imcrm-w-full imcrm-text-sm" data-testid="imcrm-subscribers-table">
                        <thead className="imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground">
                            <tr>
                                <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Registro')}</th>
                                <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Plan')}</th>
                                <th className="imcrm-px-4 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Valor')}</th>
                                <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Estado')}</th>
                                <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Próximo cobro')}</th>
                                <th className="imcrm-px-4 imcrm-py-2 imcrm-font-medium">{__('Pagado hasta')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((s) => (
                                <tr key={s.id} className="imcrm-border-t imcrm-border-border" data-status={s.status}>
                                    <td className="imcrm-px-4 imcrm-py-2">
                                        {s.record_id !== null && s.list_slug ? (
                                            <Link to={`/lists/${s.list_slug}/records/${s.record_id}`} className="imcrm-whitespace-nowrap imcrm-font-medium hover:imcrm-underline">
                                                {s.record_title}
                                            </Link>
                                        ) : (
                                            <span className="imcrm-text-muted-foreground">{__('(registro borrado)')}</span>
                                        )}
                                        <div className="imcrm-whitespace-nowrap imcrm-text-xs imcrm-text-muted-foreground">{s.payer_email ?? s.list_name}</div>
                                    </td>
                                    <td className="imcrm-max-w-[14rem] imcrm-truncate imcrm-px-4 imcrm-py-2">{s.plan_name ?? s.title}</td>
                                    <td className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-text-right imcrm-tabular-nums">
                                        {formatMoney(s.amount, s.currency)}
                                        <div className="imcrm-text-xs imcrm-text-muted-foreground">{frequencyText(s.frequency, s.frequency_type)}</div>
                                    </td>
                                    <td className="imcrm-px-4 imcrm-py-2">
                                        <SubscriptionStatusChip status={s.status} />
                                        {s.last_failure_reason && ['retrying', 'past_due', 'expired'].includes(s.status) && (
                                            <div className="imcrm-mt-0.5 imcrm-max-w-[14rem] imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground" title={s.last_failure_reason}>
                                                {s.last_failure_reason}
                                            </div>
                                        )}
                                    </td>
                                    <td className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-text-muted-foreground">{s.next_charge_at && s.status !== 'cancelled' ? formatDate(new Date(s.next_charge_at)) : '—'}</td>
                                    <td className="imcrm-whitespace-nowrap imcrm-px-4 imcrm-py-2 imcrm-text-muted-foreground">{s.paid_until ? formatDate(new Date(s.paid_until)) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

const CURRENCIES = ['COP', 'MXN', 'ARS', 'CLP', 'PEN', 'UYU', 'BRL'];

function PlanDialog({ connectionId, plan, onClose }: { connectionId: number; plan: SubscriptionPlan | null; onClose: () => void }): JSX.Element {
    const qc = useQueryClient();
    const toast = useToast();
    const [name, setName] = useState(plan?.name ?? '');
    const [description, setDescription] = useState(plan?.description ?? '');
    const [amount, setAmount] = useState(plan ? String(plan.amount) : '');
    const [currency, setCurrency] = useState(plan?.currency ?? 'COP');
    const [frequency, setFrequency] = useState(String(plan?.frequency ?? 1));
    const [frequencyType, setFrequencyType] = useState<'months' | 'days'>(plan?.frequency_type ?? 'months');
    const [cycles, setCycles] = useState(plan?.cycles ? String(plan.cycles) : '');
    const [trialDays, setTrialDays] = useState(String(plan?.trial_days ?? 0));
    const [graceDays, setGraceDays] = useState(String(plan?.grace_days ?? 10));
    const [onExpire, setOnExpire] = useState<'mark' | 'cancel'>(plan?.on_expire ?? 'mark');
    const [active, setActive] = useState(plan?.active ?? true);
    const [error, setError] = useState<string | null>(null);
    // El plan se puede cambiar, pero sólo vale para las suscripciones NUEVAS.
    const hasSubscribers = plan !== null && plan.subscribers.total > 0;

    const save = useMutation({
        mutationFn: async () => {
            const base = {
                name: name.trim(),
                description: description.trim() || null,
                grace_days: Math.max(1, Number(graceDays) || 10),
                on_expire: onExpire,
            };
            if (plan) {
                return api.updateSubscriptionPlan(plan.id, {
                    ...base,
                    active,
                    amount: parseLocalAmount(amount),
                    currency,
                    frequency: Number(frequency) || 1,
                    frequency_type: frequencyType,
                    cycles: cycles.trim() === '' ? null : Number(cycles),
                    trial_days: Number(trialDays) || 0,
                });
            }
            const input: CreateSubscriptionPlanInput = {
                connection_id: connectionId,
                ...base,
                amount: parseLocalAmount(amount),
                currency,
                frequency: Number(frequency) || 1,
                frequency_type: frequencyType,
                cycles: cycles.trim() === '' ? null : Number(cycles),
                trial_days: Number(trialDays) || 0,
            };
            return api.createSubscriptionPlan(input);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['subscriptions-overview'] });
            void qc.invalidateQueries({ queryKey: ['subscription-plans'] });
            void qc.invalidateQueries({ queryKey: ['record-subscriptions'] });
            toast.success(plan ? __('Plan guardado') : __('Plan creado'), plan ? '' : __('Ya puedes suscribir clientes con «Suscribir» en la ficha o desde una automatización.'));
            onClose();
        },
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
    const amountValue = parseLocalAmount(amount);
    const valid = name.trim() !== '' && amountValue > 0;
    return (
        <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-plan-dialog"
                >
                    <div className="imcrm-mb-3 imcrm-flex imcrm-items-start imcrm-gap-3">
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{plan ? __('Editar plan') : __('Nuevo plan')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cuánto se cobra y cada cuánto. Mercado Pago cobra recurrente sólo con tarjeta de crédito o débito.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>
                    <form
                        className="imcrm-flex imcrm-flex-col imcrm-gap-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setError(null);
                            if (valid) save.mutate();
                        }}
                    >
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="plan-name">{__('Nombre')}</Label>
                            <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={__('Mantenimiento mensual')} data-testid="imcrm-plan-name" />
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Lo ve el cliente al autorizar su tarjeta.')}</p>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="plan-desc">{__('Descripción (opcional)')}</Label>
                            <Textarea id="plan-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
                        </div>
                        {hasSubscribers && (
                            <p className="imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('El plan ya tiene suscripciones: el valor y la frecuencia nuevos valen para las suscripciones que se creen desde ahora (cada cliente conserva lo que autorizó). Para cambiarle el valor a un cliente, usa «Cambiar el valor» en su ficha. Los días de gracia sí valen para todas.')}
                            </p>
                        )}
                        <div className="imcrm-grid imcrm-grid-cols-[1fr_7rem] imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-amount">{__('Valor de cada cobro')}</Label>
                                <Input id="plan-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="imcrm-plan-amount" />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-currency">{__('Moneda')}</Label>
                                <Select id="plan-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                                    {CURRENCIES.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </div>
                        <div className="imcrm-grid imcrm-grid-cols-[6rem_1fr_1fr] imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-freq">{__('Cada')}</Label>
                                <Input id="plan-freq" inputMode="numeric" value={frequency} onChange={(e) => setFrequency(e.target.value.replace(/\D/g, ''))} />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-freq-type">&nbsp;</Label>
                                <Select id="plan-freq-type" value={frequencyType} onChange={(e) => setFrequencyType(e.target.value as 'months' | 'days')}>
                                    <option value="months">{__('meses')}</option>
                                    <option value="days">{__('días')}</option>
                                </Select>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-cycles">{__('Cuántas cuotas')}</Label>
                                <Input id="plan-cycles" inputMode="numeric" placeholder={__('Sin fin')} value={cycles} onChange={(e) => setCycles(e.target.value.replace(/\D/g, ''))} />
                            </div>
                        </div>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-trial">{__('Días gratis al empezar')}</Label>
                                <Input id="plan-trial" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ''))} />
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="plan-grace">{__('Días de gracia')}</Label>
                                <Input id="plan-grace" inputMode="numeric" value={graceDays} onChange={(e) => setGraceDays(e.target.value.replace(/\D/g, ''))} data-testid="imcrm-plan-grace" />
                            </div>
                        </div>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Si un cobro falla, Mercado Pago lo reintenta unos días. Pasados los días de gracia sin pago, la suscripción queda «Vencida»: es el momento de suspender el servicio.')}
                        </p>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <Label htmlFor="plan-expire">{__('Cuando vence sin pago')}</Label>
                            <Select id="plan-expire" value={onExpire} onChange={(e) => setOnExpire(e.target.value as 'mark' | 'cancel')} data-testid="imcrm-plan-expire">
                                <option value="mark">{__('Marcarla «Vencida» y avisar (recomendado)')}</option>
                                <option value="cancel">{__('Marcarla y cancelarla en Mercado Pago')}</option>
                            </Select>
                        </div>
                        {plan && (
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                                {__('Se ofrece para nuevas suscripciones')}
                            </label>
                        )}
                        {amountValue > 0 && (
                            <p className="imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                                {__('Se cobra')} <strong>{formatMoney(amountValue, currency)}</strong> {frequencyText(Number(frequency) || 1, frequencyType)} · {cyclesText(cycles.trim() === '' ? null : Number(cycles))}.
                            </p>
                        )}
                        {error && <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-plan-error">{error}</p>}
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="ghost" onClick={onClose}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" disabled={!valid || save.isPending} data-testid="imcrm-plan-save">
                                {save.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                {plan ? __('Guardar') : __('Crear plan')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'bad' }): JSX.Element {
    return (
        <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-py-3">
            <div className="imcrm-text-xs imcrm-text-muted-foreground">{label}</div>
            <div
                className={cn(
                    'imcrm-mt-0.5 imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums',
                    tone === 'warn' && 'imcrm-text-amber-700 dark:imcrm-text-amber-400',
                    tone === 'bad' && 'imcrm-text-destructive',
                )}
            >
                {value}
            </div>
            {hint && <div className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</div>}
        </div>
    );
}
