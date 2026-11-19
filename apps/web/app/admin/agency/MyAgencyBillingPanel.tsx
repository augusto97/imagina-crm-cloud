import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
    AGENCY_PAYMENT_METHOD_LABELS,
    agencyChargeAmount,
    agencyDebitCharges,
    agencyMonthsText,
    resolveTimeZone,
    zonedInstant,
    type AgencyClientPlan,
    type MyAgencyBilling,
} from '@imagina-base/shared';
import { CheckCircle2, CreditCard, Loader2, Mail, MessageCircle, Receipt } from 'lucide-react';

import { formatMoney } from '@/cloud/components/payments/paymentUi';
import { useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { __ } from '@/lib/i18n';
import { browserTimeZone, formatDate, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { billingStateLabel, planPriceText } from './agencyUi';
import { DebitCurrent, StateBadge } from './ClientBillingDialog';
import {
    refreshSessionAfterPayment,
    useCancelMyAgencyDebit,
    useMyAgencyBilling,
    usePayMyAgencyPlan,
    useStartMyAgencyDebit,
} from './useAgency';

const ONLINE_METHODS = new Set(['mercadopago', 'wompi', 'paypal']);
const CONFIRM_FOR_MS = 120_000;
const PAID_KEY = 'imcrm:agency-paid';

/**
 * El «¡Pago recibido!» se recuerda unos minutos en la pestaña: al confirmarse
 * el pago se trae la sesión de nuevo (la empresa sale de solo lectura) y la
 * pantalla se vuelve a montar; sin esto, el aviso se perdería en el camino.
 */
function rememberPaid(periodTo: string): void {
    try {
        sessionStorage.setItem(PAID_KEY, JSON.stringify({ period_to: periodTo, at: Date.now() }));
    } catch {
        /* sin almacenamiento: sólo se pierde el aviso */
    }
}

function recentPaid(): string | null {
    try {
        const raw = sessionStorage.getItem(PAID_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw) as { period_to?: unknown; at?: unknown };
        if (typeof v.period_to !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > 5 * 60_000) return null;
        return v.period_to;
    } catch {
        return null;
    }
}

/**
 * v0.1.451 (I3, ADR-S108) — Lo que ve el administrador de una empresa
 * CLIENTE en Ajustes → Suscripción: su plan con la agencia, hasta cuándo está
 * pagado y sus pagos. El cobro lo maneja la agencia; desde v0.1.452, si la
 * agencia cobra en línea, se paga aquí mismo («Pagar ahora») con la cuenta de
 * la agencia. Al volver del pago (`?pago=1`) se le pregunta al proveedor
 * hasta que el pago aparece.
 */
export function MyAgencyBillingPanel({ agencyName }: { agencyName: string }): JSX.Element {
    const [params, setParams] = useSearchParams();
    const qc = useQueryClient();
    const [checking, setChecking] = useState(() => params.get('pago') === '1');
    const [startedAt] = useState(() => Date.now());
    const [confirmed, setConfirmed] = useState<string | null>(() => recentPaid());
    const [timedOut, setTimedOut] = useState(false);
    // v0.1.453 — volvió de autorizar el débito automático: se pregunta hasta que queda activo.
    const [checkingDebit, setCheckingDebit] = useState(() => params.get('debito') === '1');
    const [debitConfirmed, setDebitConfirmed] = useState(false);
    const [debitTimedOut, setDebitTimedOut] = useState(false);
    const asking = checking || checkingDebit;
    const q = useMyAgencyBilling(true, { refresh: asking, pollMs: asking ? 4000 : 0 });

    useEffect(() => {
        if (!checkingDebit || !q.data) return;
        const current = q.data.online.debit.current;
        if (current && current.status !== 'pending') {
            setCheckingDebit(false);
            setDebitConfirmed(true);
            void refreshSessionAfterPayment(qc).catch(() => undefined);
            setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('debito');
                return next;
            }, { replace: true });
        } else if (Date.now() - startedAt > CONFIRM_FOR_MS) {
            setCheckingDebit(false);
            setDebitTimedOut(true);
        }
    }, [checkingDebit, q.data, startedAt, setParams, qc]);

    useEffect(() => {
        if (!checking || !q.data) return;
        const recent = q.data.payments.find(
            (p) => ONLINE_METHODS.has(p.method) && !p.undone_at && new Date(p.created_at).getTime() > startedAt - 30 * 60_000,
        );
        if (!q.data.online.pending && recent) {
            setChecking(false);
            setConfirmed(recent.period_to);
            rememberPaid(recent.period_to);
            void refreshSessionAfterPayment(qc).catch(() => undefined);
            setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('pago');
                return next;
            }, { replace: true });
        } else if (Date.now() - startedAt > CONFIRM_FOR_MS) {
            setChecking(false);
            setTimedOut(true);
        }
    }, [checking, q.data, startedAt, setParams, qc]);

    if (q.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </p>
        );
    }
    const data = q.data ?? null;
    const name = data?.agency.name ?? agencyName;
    const plan = data?.billing.plan ?? null;
    const support = data?.support ?? null;
    const state = data ? billingStateLabel(data.billing) : null;
    const tz = resolveTimeZone(getTenantTimeZone(), browserTimeZone());
    const payments = (data?.payments ?? []).filter((p) => !p.undone_at);
    const debit = data?.online.debit ?? { available: false, current: null };
    const debitCharges = agencyDebitCharges(debit.current);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="settings-agency-managed">
            {checking && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="my-agency-pay-checking">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />
                    {__('Estamos confirmando tu pago…')}
                </p>
            )}
            {confirmed && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-success/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="my-agency-pay-confirmed">
                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-hidden />
                    {`${__('¡Pago recibido! La empresa quedó pagada hasta el')} ${formatDate(new Date(confirmed))}.`}
                </p>
            )}
            {checkingDebit && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="my-agency-debit-checking">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />
                    {__('Estamos confirmando tu débito automático…')}
                </p>
            )}
            {debitConfirmed && (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-success/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="my-agency-debit-confirmed">
                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-hidden />
                    {__('¡Listo! El débito automático quedó activo: tu plan se paga solo cada período.')}
                </p>
            )}
            {debitTimedOut && (
                <p className="imcrm-rounded-md imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="my-agency-debit-pending">
                    {__('Todavía no nos llega la confirmación de tu tarjeta. Si ya la autorizaste, aparece aquí en unos minutos; si no, puedes terminar de autorizarla con el botón de abajo.')}
                </p>
            )}
            {timedOut && (
                <p className="imcrm-rounded-md imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm" role="status" data-testid="my-agency-pay-pending">
                    {`${__('Todavía no nos llega la confirmación del pago. Si ya pagaste, aparece aquí en unos minutos; si no, puedes volver a intentarlo o escribirle a')} ${name}.`}
                </p>
            )}
            <Card data-testid="my-agency-billing">
                <CardHeader>
                    <CardTitle className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-base">
                        <Receipt className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        {plan ? plan.name : __('Tu plan')}
                        {state && plan && <StateBadge tone={state.tone} label={state.label} />}
                    </CardTitle>
                    <CardDescription>
                        {data?.online.enabled
                            ? `${__('El plan de esta empresa lo maneja')} ${name}. ${__('Puedes pagarlo aquí; para cambiarlo, habla con tu agencia. En «Plan y uso» ves qué incluye y cuánto llevas usado.')}`
                            : `${__('El plan de esta empresa lo maneja')} ${name}. ${__('Para cambiarlo o pagarlo, habla con tu agencia. En «Plan y uso» ves qué incluye y cuánto llevas usado.')}`}
                    </CardDescription>
                </CardHeader>
                {plan && state && (
                    <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <dl className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-3">
                            <Item label={__('Valor')} value={planPriceText(plan)} testId="my-agency-billing-price" />
                            <Item label={__('Pagado hasta')} value={data!.billing.due_at ? formatDate(new Date(data!.billing.due_at)) : '—'} testId="my-agency-billing-paid-until" />
                            <Item label={__('Estado')} value={state.detail} tone={state.tone} />
                        </dl>
                        {(state.tone === 'warn' || state.tone === 'bad') && (
                            <p
                                className={cn(
                                    'imcrm-rounded-md imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                                    state.tone === 'bad' ? 'imcrm-bg-destructive/10' : 'imcrm-bg-warning/10',
                                )}
                                data-testid="my-agency-billing-warning"
                            >
                                {state.tone === 'bad'
                                    ? data!.online.enabled
                                        ? __('La empresa está en solo lectura: tus datos están intactos y se pueden ver y descargar. Apenas pagues, vuelve a funcionar al instante.')
                                        : `${__('La empresa está en solo lectura: tus datos están intactos y se pueden ver y descargar. Cuando')} ${name} ${__('registre el pago, vuelve a funcionar al instante.')}`
                                    : debitCharges
                                      ? __('Tu débito automático lo cobra solo antes de que venza: no tienes que hacer nada.')
                                      : data!.online.enabled
                                      ? __('Puedes pagar aquí abajo con «Pagar ahora». Si ya pagaste por otro medio, tu agencia lo registra.')
                                      : `${__('Si ya pagaste,')} ${name} ${__('lo registra y no tienes que hacer nada más. Si no, escríbele para ponerte al día.')}`}
                            </p>
                        )}
                        {(debit.available || debit.current) && <DebitBox data={data!} plan={plan} busy={asking} />}
                        {data!.online.enabled && !(debitCharges && state.tone === 'ok') && <PayNow data={data!} plan={plan} busy={asking} />}
                    </CardContent>
                )}
            </Card>

            {payments.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="imcrm-text-base">{__('Tus pagos')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="imcrm-divide-y imcrm-divide-border" data-testid="my-agency-payments">
                            {payments.map((p) => (
                                <li key={p.id} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-py-2 imcrm-text-sm">
                                    <span className="imcrm-font-medium">{formatMoney(p.amount, p.currency)}</span>
                                    <span className="imcrm-text-muted-foreground">
                                        {__(AGENCY_PAYMENT_METHOD_LABELS[p.method])} · {formatDate(zonedInstant(p.paid_on, tz, { h: 12 }))}
                                    </span>
                                    <span className="imcrm-ml-auto imcrm-text-[12px] imcrm-text-muted-foreground">
                                        {`${__('Cubre hasta el')} ${formatDate(new Date(p.period_to))}`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}

            {support && (support.email || support.whatsapp) && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-text-sm" data-testid="my-agency-support">
                    <span className="imcrm-text-muted-foreground">{`${__('Para escribirle a')} ${name}:`}</span>
                    {support.email && (
                        <a href={`mailto:${support.email}`} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-primary hover:imcrm-underline">
                            <Mail className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            {support.email}
                        </a>
                    )}
                    {support.whatsapp && (
                        <a
                            href={`https://wa.me/${support.whatsapp.replace(/[^\d]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-primary hover:imcrm-underline"
                        >
                            <MessageCircle className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            {support.whatsapp}
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * «Pagar ahora»: elegir cuántos períodos (el valor lo pone el plan) y salir a
 * pagar con la cuenta de la agencia. Si ya hay un link esperando, se ofrece
 * ése primero.
 */
function PayNow({ data, plan, busy }: { data: MyAgencyBilling; plan: AgencyClientPlan; busy: boolean }): JSX.Element {
    const pay = usePayMyAgencyPlan();
    const online = data.online;
    const [periods, setPeriods] = useState<number>(online.periods[0] ?? 1);
    const [error, setError] = useState<string | null>(null);
    const pending = online.pending && online.pending.url ? online.pending : null;
    const months = periods * plan.period_months;
    const total = agencyChargeAmount(plan, months);
    const provider = online.provider ?? __('el medio de pago de tu agencia');

    const go = (): void => {
        setError(null);
        pay.mutate(periods, {
            onSuccess: (charge) => {
                if (charge.url) window.location.assign(charge.url);
                else setError(__('No se pudo armar el link de pago. Intenta de nuevo en un momento.'));
            },
            onError: (err) => setError(err instanceof Error ? err.message : String(err)),
        });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="my-agency-pay" data-tour="settings-agency-pay">
            <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <CreditCard className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                {__('Pagar ahora')}
            </span>
            {pending && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-2 imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-px-3 imcrm-py-2 imcrm-text-sm" data-testid="my-agency-pay-link">
                    <span>
                        {`${__('Tienes un pago pendiente de')} `}
                        <span className="imcrm-font-medium">{formatMoney(pending.amount, pending.currency)}</span>
                        {` (${__(agencyMonthsText(pending.months))}).`}
                    </span>
                    <Button size="sm" asChild>
                        <a href={pending.url!} data-testid="my-agency-pay-link-open">{__('Pagar este')}</a>
                    </Button>
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 sm:imcrm-flex-row sm:imcrm-items-end">
                {online.periods.length > 1 && (
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm sm:imcrm-w-64">
                        <span>{__('Cuánto quieres pagar')}</span>
                        <Select value={periods} onChange={(e) => setPeriods(Number(e.target.value))} data-testid="my-agency-pay-periods">
                            {online.periods.map((n) => (
                                <option key={n} value={n}>
                                    {`${__(agencyMonthsText(n * plan.period_months))} · ${formatMoney(agencyChargeAmount(plan, n * plan.period_months), plan.currency)}`}
                                </option>
                            ))}
                        </Select>
                    </label>
                )}
                <Button onClick={go} disabled={pay.isPending || busy} data-testid="my-agency-pay-go">
                    {pay.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                    {`${__('Pagar')} ${formatMoney(total, plan.currency)}`}
                </Button>
            </div>
            <p className="imcrm-text-[12px] imcrm-text-muted-foreground">
                {`${__('Pagas con')} ${provider} ${__('a la cuenta de tu agencia. Cuando el pago entra, la empresa queda pagada al instante; no tienes que avisar.')}`}
            </p>
            {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
        </div>
    );
}

/**
 * v0.1.453 — Débito automático: autorizar la tarjeta una vez (en la cuenta de
 * Mercado Pago o PayPal de la agencia) y el plan se paga solo cada período.
 */
function DebitBox({ data, plan, busy }: { data: MyAgencyBilling; plan: AgencyClientPlan; busy: boolean }): JSX.Element {
    const myEmail = useSession((s) => s.user?.email ?? '');
    const start = useStartMyAgencyDebit();
    const cancel = useCancelMyAgencyDebit();
    const confirm = useConfirm();
    const toast = useToast();
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const current = data.online.debit.current;
    const provider = data.online.provider ?? __('el medio de pago de tu agencia');

    const go = (): void => {
        setError(null);
        const to = email.trim() || myEmail;
        if (!to) {
            setError(__('Escribe el correo de tu cuenta de pago.'));
            return;
        }
        start.mutate(to, {
            onSuccess: (d) => {
                if (d.url) window.location.assign(d.url);
                else setError(__('No se pudo armar el débito automático. Intenta de nuevo en un momento.'));
            },
            onError: (err) => setError(err instanceof Error ? err.message : String(err)),
        });
    };

    const doCancel = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Cancelar el débito automático?'),
            description: __('Tu plan deja de pagarse solo. Lo que ya pagaste se conserva; los próximos pagos los haces con «Pagar ahora» o con tu agencia.'),
            confirmLabel: __('Cancelar el débito'),
            destructive: true,
        });
        if (!ok) return;
        cancel.mutate(undefined, {
            onSuccess: () => toast.success(__('Débito automático cancelado')),
            onError: (err) => toast.error(__('No se pudo cancelar'), err instanceof Error ? err.message : String(err)),
        });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="my-agency-debit" data-tour="settings-agency-debit">
            <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                <CreditCard className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                {__('Débito automático')}
            </span>
            {current ? (
                <DebitCurrent
                    current={current}
                    onCancel={() => void doCancel()}
                    cancelling={cancel.isPending}
                    cancelLabel={__('Cancelar el débito automático')}
                />
            ) : (
                <>
                    <p className="imcrm-text-sm">
                        {`${__('Autoriza tu tarjeta una sola vez con')} ${provider} ${__('y el plan se paga solo:')} ${planPriceText(plan)}, ${__('dos días antes de que venza. Lo puedes cancelar cuando quieras.')}`}
                    </p>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 sm:imcrm-flex-row sm:imcrm-items-end">
                        <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm sm:imcrm-w-72">
                            <span>{__('Correo de tu cuenta de pago')}</span>
                            <Input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={myEmail || __('correo@empresa.com')}
                                data-testid="my-agency-debit-email"
                            />
                        </label>
                        <Button onClick={go} disabled={start.isPending || busy} data-testid="my-agency-debit-start">
                            {start.isPending && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                            {__('Activar el débito automático')}
                        </Button>
                    </div>
                </>
            )}
            {error && <p className="imcrm-text-sm imcrm-text-destructive" role="alert">{error}</p>}
        </div>
    );
}

function Item({ label, value, tone, testId }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' | 'muted'; testId?: string }): JSX.Element {
    return (
        <div>
            <dt className="imcrm-text-[12px] imcrm-text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    'imcrm-text-sm imcrm-font-medium',
                    tone === 'warn' && 'imcrm-text-warning',
                    tone === 'bad' && 'imcrm-text-destructive',
                )}
                data-testid={testId}
            >
                {value}
            </dd>
        </div>
    );
}
