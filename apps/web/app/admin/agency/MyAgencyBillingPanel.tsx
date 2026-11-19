import { AGENCY_PAYMENT_METHOD_LABELS, resolveTimeZone, zonedInstant } from '@imagina-base/shared';
import { Loader2, Mail, MessageCircle, Receipt } from 'lucide-react';

import { formatMoney } from '@/cloud/components/payments/paymentUi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { __ } from '@/lib/i18n';
import { browserTimeZone, formatDate, getTenantTimeZone } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { billingStateLabel, planPriceText } from './agencyUi';
import { StateBadge } from './ClientBillingDialog';
import { useMyAgencyBilling } from './useAgency';

/**
 * v0.1.451 (I3, ADR-S108) — Lo que ve el administrador de una empresa
 * CLIENTE en Ajustes → Suscripción: su plan con la agencia, hasta cuándo está
 * pagado y sus pagos. El cobro lo maneja la agencia: aquí no se paga nada,
 * se ve y se sabe a quién escribirle.
 */
export function MyAgencyBillingPanel({ agencyName }: { agencyName: string }): JSX.Element {
    const q = useMyAgencyBilling();
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

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="settings-agency-managed">
            <Card data-testid="my-agency-billing">
                <CardHeader>
                    <CardTitle className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-base">
                        <Receipt className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        {plan ? plan.name : __('Tu plan')}
                        {state && plan && <StateBadge tone={state.tone} label={state.label} />}
                    </CardTitle>
                    <CardDescription>
                        {`${__('El plan de esta empresa lo maneja')} ${name}. ${__('Para cambiarlo o pagarlo, habla con tu agencia. En «Plan y uso» ves qué incluye y cuánto llevas usado.')}`}
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
                                    ? `${__('La empresa está en solo lectura: tus datos están intactos y se pueden ver y descargar. Cuando')} ${name} ${__('registre el pago, vuelve a funcionar al instante.')}`
                                    : `${__('Si ya pagaste,')} ${name} ${__('lo registra y no tienes que hacer nada más. Si no, escríbele para ponerte al día.')}`}
                            </p>
                        )}
                    </CardContent>
                )}
            </Card>

            {data && data.payments.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="imcrm-text-base">{__('Tus pagos')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="imcrm-divide-y imcrm-divide-border" data-testid="my-agency-payments">
                            {data.payments
                                .filter((p) => !p.undone_at)
                                .map((p) => (
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
