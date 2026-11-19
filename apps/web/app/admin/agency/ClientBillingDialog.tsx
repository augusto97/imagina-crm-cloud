import { useMemo, useState } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import {
    AGENCY_MANUAL_PAYMENT_METHODS,
    AGENCY_PAYMENT_METHOD_LABELS,
    extendPaidUntil,
    resolveTimeZone,
    zonedDayAndMinute,
    zonedInstant,
    zonedToday,
    type AgencyClient,
    type AgencyOverview,
    type AgencyPayment,
    type SetAgencyClientBillingInput,
    parseLooseAmount,
} from '@imagina-base/shared';
import { Loader2, Undo2, X } from 'lucide-react';

import { formatMoney } from '@/cloud/components/payments/paymentUi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { browserTimeZone, formatDate, formatNumber, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { billingStateLabel, planPriceText } from './agencyUi';
import { useClientPayments, useRegisterClientPayment, useSetClientBilling, useUndoClientPayment } from './useAgency';

const NO_PLAN = '__none__';

function tz(): string {
    return resolveTimeZone(getTenantTimeZone(), browserTimeZone());
}

function ymdOf(iso: string | null): string {
    return iso ? zonedDayAndMinute(new Date(iso), tz()).ymd : '';
}

/**
 * v0.1.451 (I3, ADR-S108) — El cobro de UNA empresa cliente: su plan (con
 * su valor), hasta cuándo está pagada, registrar un pago que llegó por fuera
 * (transferencia, efectivo…) y el historial, con «Deshacer» del último.
 */
export function ClientBillingDialog({ client, overview, onClose }: { client: AgencyClient; overview: AgencyOverview; onClose: () => void }): JSX.Element {
    const b = client.billing;
    const state = billingStateLabel(b);
    return (
        <RDialog.Root open onOpenChange={(o) => !o && onClose()}>
            <RDialog.Portal>
                <RDialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <RDialog.Content
                    data-testid="agency-billing-dialog"
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-overflow-y-auto imcrm-bg-card imcrm-p-5 sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:imcrm-max-h-[92vh] sm:imcrm-w-[calc(100%-1.5rem)] sm:imcrm-max-w-2xl sm:imcrm--translate-x-1/2 sm:imcrm--translate-y-1/2 sm:imcrm-rounded-lg sm:imcrm-border sm:imcrm-border-border sm:imcrm-shadow-imcrm-lg"
                >
                    <RDialog.Close asChild>
                        <button type="button" aria-label={__('Cerrar')} className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </RDialog.Close>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-pr-8">
                        <RDialog.Title className="imcrm-text-base imcrm-font-semibold">{`${__('Cobro de')} ${client.name}`}</RDialog.Title>
                        <RDialog.Description asChild>
                            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                <StateBadge tone={state.tone} label={state.label} />
                                <span data-testid="agency-billing-detail">{state.detail}</span>
                            </div>
                        </RDialog.Description>
                    </div>
                    <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-5">
                        <PlanSection client={client} overview={overview} />
                        {b.plan && <PaymentSection client={client} />}
                        <HistorySection client={client} />
                    </div>
                </RDialog.Content>
            </RDialog.Portal>
        </RDialog.Root>
    );
}

export function StateBadge({ tone, label }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; label: string }): JSX.Element {
    return (
        <Badge
            variant="outline"
            data-testid="agency-billing-state"
            className={cn(
                'imcrm-font-normal',
                tone === 'ok' && 'imcrm-border-success/40 imcrm-text-success',
                tone === 'warn' && 'imcrm-border-warning/40 imcrm-text-warning',
                tone === 'bad' && 'imcrm-border-destructive/40 imcrm-text-destructive',
            )}
        >
            {label}
        </Badge>
    );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-4">
            <div>
                <h3 className="imcrm-text-sm imcrm-font-semibold">{title}</h3>
                {hint && <p className="imcrm-text-[12px] imcrm-text-muted-foreground">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

function PlanSection({ client, overview }: { client: AgencyClient; overview: AgencyOverview }): JSX.Element {
    const set = useSetClientBilling();
    const toast = useToast();
    const b = client.billing;
    const current = b.plan?.plan_id ?? NO_PLAN;
    const [planId, setPlanId] = useState(current);
    const [price, setPrice] = useState(b.plan ? formatNumber(b.plan.price, { maxFrac: 2 }) : '');
    const [paidUntil, setPaidUntil] = useState(ymdOf(b.paid_until));
    const [error, setError] = useState<string | null>(null);

    const options = overview.billing.plans.filter((p) => p.active || p.id === current);
    const chosen = overview.billing.plans.find((p) => p.id === planId) ?? null;
    const planChanged = planId !== current;
    const priceN = parseLooseAmount(price);
    const priceChanged = planId !== NO_PLAN && priceN !== null && (planChanged ? priceN !== chosen?.price : priceN !== b.plan?.price);
    const paidChanged = planId !== NO_PLAN && !planChanged && paidUntil !== ymdOf(b.paid_until) && paidUntil !== '';
    const dirty = planChanged || priceChanged || paidChanged;

    const pickPlan = (id: string): void => {
        setPlanId(id);
        setError(null);
        const p = overview.billing.plans.find((x) => x.id === id);
        if (id === current && b.plan) setPrice(formatNumber(b.plan.price, { maxFrac: 2 }));
        else if (p) setPrice(formatNumber(p.price, { maxFrac: 2 }));
    };

    const save = (): void => {
        setError(null);
        if (planId !== NO_PLAN && (priceN === null || priceN < 0)) {
            setError(__('Escribe el valor del plan (sólo números).'));
            return;
        }
        const input: SetAgencyClientBillingInput = {};
        if (planChanged) input.plan_id = planId === NO_PLAN ? null : planId;
        if (priceChanged && priceN !== null) input.price = priceN;
        if (paidChanged) input.paid_until = paidUntil;
        set.mutate(
            { id: client.id, input },
            {
                onSuccess: (c) => {
                    toast.success(planId === NO_PLAN ? __('Ya no le cobras a esta empresa') : __('Cobro actualizado'));
                    setPaidUntil(ymdOf(c.billing.paid_until));
                },
                onError: (err) => setError(err instanceof Error ? err.message : String(err)),
            },
        );
    };

    if (overview.billing.plans.length === 0 && !b.plan) {
        return (
            <Section title={__('Plan')}>
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="agency-billing-no-plans">
                    {__('Primero crea tus planes en «Tus planes y el cobro», abajo en esta página.')}
                </p>
            </Section>
        );
    }

    return (
        <Section
            title={__('Plan')}
            hint={__('Lo que le cobras. Al asignarlo queda pagado por un período desde hoy; después registras cada pago.')}
        >
            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2">
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm sm:imcrm-col-span-2">
                    <span className="imcrm-font-medium">{__('Plan')}</span>
                    <Select value={planId} onChange={(e) => pickPlan(e.target.value)} data-testid="agency-billing-plan">
                        <option value={NO_PLAN}>{__('Sin plan (no le cobro)')}</option>
                        {options.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name} · {planPriceText(p)}
                            </option>
                        ))}
                    </Select>
                </label>
                {planId !== NO_PLAN && (
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <span className="imcrm-font-medium">{`${__('Valor para esta empresa')} (${(chosen ?? b.plan)?.currency ?? 'COP'})`}</span>
                        <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="agency-billing-price" />
                    </label>
                )}
                {planId !== NO_PLAN && !planChanged && (
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <span className="imcrm-font-medium">{__('Pagado hasta')}</span>
                        <Input type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} data-testid="agency-billing-paid-until" />
                    </label>
                )}
            </div>
            {planId !== NO_PLAN && !planChanged && (
                <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                    {__('Cambiar «Pagado hasta» a mano sirve para corregir; para un pago que llegó, usa «Registrar un pago»: queda en el historial.')}
                </p>
            )}
            {planChanged && planId !== NO_PLAN && chosen?.limits_plan && (
                <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                    {`${__('Al guardar, la empresa toma los límites del plan')} «${overview.limit_plans.find((l) => l.slug === chosen.limits_plan)?.name ?? chosen.limits_plan}».`}
                </p>
            )}
            {planChanged && planId === NO_PLAN && b.plan && (
                <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                    {__('Sin plan no vence: la empresa sigue activa mientras tu agencia lo esté.')}
                </p>
            )}
            {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
            <div>
                <Button size="sm" onClick={save} disabled={!dirty || set.isPending} data-testid="agency-billing-save">
                    {set.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                    {__('Guardar')}
                </Button>
            </div>
        </Section>
    );
}

function PaymentSection({ client }: { client: AgencyClient }): JSX.Element {
    const register = useRegisterClientPayment();
    const toast = useToast();
    const plan = client.billing.plan!;
    const today = zonedToday(tz());
    const [months, setMonths] = useState<number>(plan.period_months);
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState<(typeof AGENCY_MANUAL_PAYMENT_METHODS)[number]>('transfer');
    const [paidOn, setPaidOn] = useState(today);
    const [note, setNote] = useState('');
    const [error, setError] = useState<string | null>(null);

    const suggested = Math.round(((plan.price * months) / plan.period_months) * 100) / 100;
    const until = useMemo(() => {
        const now = zonedInstant(today, tz(), { h: 23, m: 59, s: 59 });
        const cur = client.billing.paid_until ? new Date(client.billing.paid_until) : null;
        return extendPaidUntil(cur, now, months);
    }, [client.billing.paid_until, months, today]);
    const monthOptions = useMemo(() => {
        const base = [1, 2, 3, 6, 12, 24];
        const set = new Set<number>([plan.period_months, ...base.filter((m) => m % plan.period_months === 0 || plan.period_months === 1)]);
        return [...set].filter((m) => m <= 36).sort((a, b) => a - b);
    }, [plan.period_months]);

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        setError(null);
        const amountN = amount.trim() === '' ? suggested : parseLooseAmount(amount);
        if (amountN === null || amountN < 0) {
            setError(__('Escribe el valor pagado (sólo números).'));
            return;
        }
        register.mutate(
            { id: client.id, input: { months, amount: amountN, method, paid_on: paidOn, ...(note.trim() ? { note: note.trim() } : {}) } },
            {
                onSuccess: (res) => {
                    toast.success(__('Pago registrado'), `${__('Pagado hasta el')} ${formatDate(new Date(res.payment.period_to))}`);
                    setAmount('');
                    setNote('');
                },
                onError: (err) => setError(err instanceof Error ? err.message : String(err)),
            },
        );
    };

    return (
        <Section title={__('Registrar un pago')} hint={__('Un pago que te llegó por fuera: transferencia, efectivo, tarjeta… Extiende el «pagado hasta» y reactiva la empresa al instante si estaba en solo lectura.')}>
            <form className="imcrm-flex imcrm-flex-col imcrm-gap-3" onSubmit={submit} noValidate data-testid="agency-payment-form">
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <span className="imcrm-font-medium">{__('Cubre')}</span>
                        <Select value={months} onChange={(e) => setMonths(Number(e.target.value))} data-testid="agency-payment-months">
                            {monthOptions.map((m) => (
                                <option key={m} value={m}>{m === 1 ? __('1 mes') : `${m} ${__('meses')}`}</option>
                            ))}
                        </Select>
                    </label>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <span className="imcrm-font-medium">{`${__('Valor pagado')} (${plan.currency})`}</span>
                        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={formatNumber(suggested, { maxFrac: 2 })} data-testid="agency-payment-amount" />
                    </label>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <span className="imcrm-font-medium">{__('Cómo pagó')}</span>
                        <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} data-testid="agency-payment-method">
                            {AGENCY_MANUAL_PAYMENT_METHODS.map((m) => (
                                <option key={m} value={m}>{__(AGENCY_PAYMENT_METHOD_LABELS[m])}</option>
                            ))}
                        </Select>
                    </label>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm">
                        <span className="imcrm-font-medium">{__('Fecha del pago')}</span>
                        <Input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
                    </label>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm sm:imcrm-col-span-2">
                        <span className="imcrm-font-medium">{__('Nota (opcional)')}</span>
                        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={240} placeholder={__('Comprobante, banco…')} />
                    </label>
                </div>
                <p className="imcrm-text-sm" data-testid="agency-payment-preview">
                    {`${__('Queda pagado hasta el')} `}
                    <span className="imcrm-font-medium">{formatDate(until)}</span>
                    {amount.trim() === '' && <span className="imcrm-text-muted-foreground">{` · ${formatMoney(suggested, plan.currency)}`}</span>}
                </p>
                {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
                <div>
                    <Button type="submit" size="sm" disabled={register.isPending} data-testid="agency-payment-submit">
                        {register.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                        {__('Registrar el pago')}
                    </Button>
                </div>
            </form>
        </Section>
    );
}

function HistorySection({ client }: { client: AgencyClient }): JSX.Element {
    const payments = useClientPayments(client.id);
    const undo = useUndoClientPayment();
    const confirm = useConfirm();
    const toast = useToast();
    const list = payments.data ?? [];

    const doUndo = async (p: AgencyPayment): Promise<void> => {
        const ok = await confirm({
            title: __('¿Deshacer este pago?'),
            description: __('Vuelve el «pagado hasta» de antes. Si ya venció, la empresa puede quedar en solo lectura.'),
            confirmLabel: __('Deshacer'),
            destructive: true,
        });
        if (!ok) return;
        undo.mutate(
            { id: client.id, paymentId: p.id },
            {
                onSuccess: () => toast.success(__('Pago deshecho')),
                onError: (err) => toast.error(__('No se pudo deshacer'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    return (
        <Section title={__('Pagos')}>
            {payments.isLoading ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
            ) : list.length === 0 ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="agency-payments-empty">{__('Todavía no hay pagos registrados.')}</p>
            ) : (
                <ul className="imcrm-divide-y imcrm-divide-border" data-testid="agency-payments">
                    {list.map((p) => (
                        <li key={p.id} className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-py-2 imcrm-text-sm', p.undone_at && 'imcrm-opacity-60')} data-testid="agency-payment">
                            <span className="imcrm-font-medium">{formatMoney(p.amount, p.currency)}</span>
                            <span className="imcrm-text-muted-foreground">
                                {__(AGENCY_PAYMENT_METHOD_LABELS[p.method])} · {formatDate(zonedInstant(p.paid_on, tz(), { h: 12 }))}
                            </span>
                            <span className="imcrm-text-muted-foreground">
                                {p.months === 1 ? __('1 mes') : `${p.months} ${__('meses')}`} → {formatDate(new Date(p.period_to))}
                            </span>
                            {p.undone_at && <Badge variant="outline" className="imcrm-font-normal">{__('Deshecho')}</Badge>}
                            <span className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[12px] imcrm-text-muted-foreground">
                                {p.created_by_name && <span>{p.created_by_name}</span>}
                                {p.can_undo && (
                                    <Button size="sm" variant="ghost" onClick={() => void doUndo(p)} disabled={undo.isPending} data-testid="agency-payment-undo">
                                        <Undo2 className="imcrm-h-4 imcrm-w-4" />
                                        {__('Deshacer')}
                                    </Button>
                                )}
                            </span>
                            {p.note && <span className="imcrm-basis-full imcrm-text-[12px] imcrm-text-muted-foreground">{p.note}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}
