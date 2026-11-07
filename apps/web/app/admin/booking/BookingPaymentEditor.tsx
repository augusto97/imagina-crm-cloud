import { CalendarCheck, CreditCard, HandCoins, Wallet } from 'lucide-react';
import { Link } from 'react-router';

import {
    BOOKING_PAYMENT_HOLD_MAX,
    BOOKING_PAYMENT_HOLD_MIN,
    COLLECTION_CURRENCY_OPTIONS,
    COLLECTION_PROVIDER_LABEL,
    bookingPayLabel,
    bookingPaymentAmount,
    collectionCurrencyError,
    collectionCurrencyFor,
    type BookingConfig,
    type BookingPayment,
} from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __, sprintf } from '@/lib/i18n';
import { getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { Check, Field, Section } from '../automations/email/EmailBlockInspector';
import type { BookingEditorOptions } from './useBookingPages';

/** Cuánto queda apartado el horario mientras el cliente paga. */
const HOLD_OPTIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

function holdLabel(m: number): string {
    if (m < 60) return sprintf(__('%d minutos'), m);
    const h = m / 60;
    return h === 1 ? __('1 hora') : Number.isInteger(h) ? sprintf(__('%d horas'), h) : sprintf(__('%d minutos'), m);
}

/** «PayPal · Prueba (sandbox)» ya dice el proveedor: no se repite. */
function connectionLabel(name: string, provider: string, test: boolean): string {
    const lower = name.toLowerCase();
    let label = lower.includes(provider.toLowerCase()) ? name : `${name} · ${provider}`;
    if (test && !lower.includes('prueba')) label += ` (${__('prueba')})`;
    return label;
}

/**
 * v0.1.387 — «Cobrar al agendar»: con la cuenta de cobro DEL EQUIPO
 * (Mercado Pago, Wompi o PayPal), todo el precio del servicio o un anticipo,
 * y si el cliente tiene que pagar para confirmar (el horario queda apartado
 * unos minutos) o la cita se confirma y paga después. El monto lo vuelve a
 * calcular el servidor al reservar.
 */
export function BookingPaymentEditor({
    config,
    onChange,
    options,
}: {
    config: BookingConfig;
    onChange: (next: BookingConfig) => void;
    options: BookingEditorOptions;
}): JSX.Element {
    const p = config.payment;
    const set = (patch: Partial<BookingPayment>): void => onChange({ ...config, payment: { ...p, ...patch } });
    const team = options.payment_connections ?? [];
    const conn = team.find((c) => c.id === p.connection_id) ?? null;
    const wompi = conn?.provider === 'wompi';
    const paypal = conn?.provider === 'paypal';
    const currencyProblem = conn ? collectionCurrencyError(conn.provider, p.currency) : null;
    const fmt = getTenantFormat().number_format;
    const active = config.services.filter((s) => s.active);
    const holds = HOLD_OPTIONS.includes(p.hold_minutes) ? HOLD_OPTIONS : [...HOLD_OPTIONS, p.hold_minutes].sort((a, b) => a - b);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="booking-payment" data-testid="booking-payment">
            <Section title={__('Cobrar al agendar')}>
                <Check
                    label={__('El cliente paga al agendar')}
                    checked={p.enabled}
                    onChange={(v) => set({ enabled: v, ...(v && p.connection_id === null && team.length === 1 ? { connection_id: team[0]!.id, currency: collectionCurrencyFor(team[0]!.provider, p.currency) } : {}) })}
                    testId="booking-payment-enabled"
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Paga con la cuenta de Mercado Pago, Wompi o PayPal de la empresa: el dinero llega a esa cuenta. El pago queda en la ficha de la cita, con su estado.')}
                </p>
            </Section>
            {p.enabled && (
                <>
                    <Section title={__('Con qué cuenta se cobra')}>
                        {team.length === 0 ? (
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="booking-payment-no-connection">
                                {__('No hay una cuenta de cobro del equipo (Mercado Pago, Wompi o PayPal).')}{' '}
                                <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                    {__('Conéctala en Ajustes → Integraciones')}
                                </Link>
                            </p>
                        ) : (
                            <Select
                                value={p.connection_id ?? ''}
                                onChange={(e) => {
                                    const id = e.target.value ? Number(e.target.value) : null;
                                    const next = team.find((c) => c.id === id);
                                    set({ connection_id: id, ...(next ? { currency: collectionCurrencyFor(next.provider, p.currency) } : {}) });
                                }}
                                data-testid="booking-payment-connection"
                            >
                                <option value="">{__('Elige una cuenta…')}</option>
                                {team.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {connectionLabel(c.name, COLLECTION_PROVIDER_LABEL[c.provider], c.test_mode)}
                                    </option>
                                ))}
                            </Select>
                        )}
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Sólo las cuentas del equipo: la cita no es de nadie en particular. Una cuenta privada de alguien no aparece aquí.')}
                        </p>
                    </Section>

                    <Section title={__('Cuándo paga')}>
                        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-1.5" role="radiogroup" aria-label={__('Cuándo paga')} data-testid="booking-payment-mode">
                            {(
                                [
                                    { value: 'required', icon: CalendarCheck, title: __('Paga para confirmar la cita'), hint: __('La cita queda «Esperando el pago» con el horario apartado. Se confirma sola cuando entra el pago; si no paga a tiempo, el horario queda libre.') },
                                    { value: 'optional', icon: Wallet, title: __('La cita se confirma y paga después'), hint: __('La cita queda confirmada al agendar y el cliente puede pagar desde la confirmación, el correo o la página de su cita.') },
                                ] as const
                            ).map((o) => {
                                const on = p.mode === o.value;
                                const Icon = o.icon;
                                return (
                                    <button
                                        key={o.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={on}
                                        onClick={() => set({ mode: o.value })}
                                        data-mode={o.value}
                                        className={cn(
                                            'imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left',
                                            on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                                        )}
                                    >
                                        <Icon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                        <span className="imcrm-flex imcrm-flex-col">
                                            <span className="imcrm-text-sm imcrm-font-medium">{o.title}</span>
                                            <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{o.hint}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {p.mode === 'required' && (
                            <Field label={__('Tiempo para pagar')} hint={__('Mientras tanto nadie más puede tomar ese horario. Nunca pasa del inicio de la cita.')}>
                                <Select value={p.hold_minutes} onChange={(e) => set({ hold_minutes: Math.min(BOOKING_PAYMENT_HOLD_MAX, Math.max(BOOKING_PAYMENT_HOLD_MIN, Number(e.target.value))) })} data-testid="booking-payment-hold">
                                    {holds.map((m) => (
                                        <option key={m} value={m}>
                                            {holdLabel(m)}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )}
                        {p.mode === 'required' && config.approval.mode !== 'none' && (
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="booking-payment-approval-note">
                                {__('Esta agenda también aprueba citas: primero se paga y después alguien del equipo la aprueba.')}
                            </p>
                        )}
                    </Section>

                    <Section title={__('Cuánto se cobra')}>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5" role="radiogroup" aria-label={__('Cuánto se cobra')} data-testid="booking-payment-amount">
                            {(
                                [
                                    { value: 'full', icon: CreditCard, title: __('El precio del servicio'), hint: __('Lo que dice cada servicio.') },
                                    { value: 'deposit', icon: HandCoins, title: __('Un anticipo'), hint: __('Una parte: fija o un %.') },
                                ] as const
                            ).map((o) => {
                                const on = p.amount === o.value;
                                const Icon = o.icon;
                                return (
                                    <button
                                        key={o.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={on}
                                        onClick={() => set({ amount: o.value, ...(o.value === 'deposit' && p.deposit_value === null ? { deposit_kind: 'percent', deposit_value: 50 } : {}) })}
                                        data-amount={o.value}
                                        className={cn(
                                            'imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-px-2.5 imcrm-py-2 imcrm-text-left',
                                            on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                                        )}
                                    >
                                        <Icon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                                        <span className="imcrm-flex imcrm-flex-col">
                                            <span className="imcrm-text-sm imcrm-font-medium">{o.title}</span>
                                            <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{o.hint}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        {p.amount === 'deposit' && (
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                <Field label={__('Anticipo')}>
                                    <Select value={p.deposit_kind} onChange={(e) => set({ deposit_kind: e.target.value as 'fixed' | 'percent' })} data-testid="booking-payment-deposit-kind">
                                        <option value="percent">{__('Un % del precio')}</option>
                                        <option value="fixed">{__('Un monto fijo')}</option>
                                    </Select>
                                </Field>
                                <Field label={p.deposit_kind === 'percent' ? __('Porcentaje') : sprintf(__('Monto (%s)'), p.currency)}>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={p.deposit_kind === 'percent' ? 100 : undefined}
                                        step="any"
                                        value={p.deposit_value ?? ''}
                                        onChange={(e) => set({ deposit_value: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                                        data-testid="booking-payment-deposit-value"
                                    />
                                </Field>
                            </div>
                        )}
                        <Field
                            label={__('Moneda')}
                            hint={wompi ? __('Wompi cobra en pesos colombianos.') : paypal ? __('PayPal no cobra en pesos colombianos: el precio de cada servicio se cobra en esta moneda.') : __('El precio de cada servicio se cobra en esta moneda.')}
                        >
                            {paypal ? (
                                <Select value={p.currency} onChange={(e) => set({ currency: e.target.value })} data-testid="booking-payment-currency">
                                    {!COLLECTION_CURRENCY_OPTIONS.paypal.some((o) => o.value === p.currency) && <option value={p.currency}>{p.currency}</option>}
                                    {COLLECTION_CURRENCY_OPTIONS.paypal.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </Select>
                            ) : (
                                <Input
                                    value={p.currency}
                                    maxLength={3}
                                    disabled={wompi}
                                    onChange={(e) => {
                                        const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
                                        if (v.length === 3) set({ currency: v });
                                    }}
                                    data-testid="booking-payment-currency"
                                />
                            )}
                            {currencyProblem && <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-amber-700 dark:imcrm-text-amber-300">{currencyProblem}</p>}
                        </Field>
                        {active.length > 0 && (
                            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-xs" data-testid="booking-payment-services">
                                {active.map((s) => {
                                    const plan = bookingPaymentAmount(p, s);
                                    return (
                                        <li key={s.id} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                            <span className="imcrm-truncate">{s.name}</span>
                                            <span className={cn('imcrm-shrink-0', plan ? 'imcrm-font-medium' : 'imcrm-text-muted-foreground')}>
                                                {s.payment === 'none' ? __('Sin cobro') : plan ? bookingPayLabel(plan.amount, p.currency, fmt) : __('Sin precio')}
                                            </span>
                                        </li>
                                    );
                                })}
                                <li className="imcrm-pt-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                                    {__('El precio y «sin cobro» se cambian en cada servicio (Servicios).')}
                                </li>
                            </ul>
                        )}
                    </Section>

                    <Section title={__('Lo que ve el cliente')}>
                        <Field label={__('Concepto del cobro')} hint={__('Lo que ve en la página de pago. Vacío = «servicio · fecha».')}>
                            <Input value={p.title} maxLength={200} placeholder={__('Consulta con la doctora')} onChange={(e) => set({ title: e.target.value })} data-testid="booking-payment-title" />
                        </Field>
                        <Field label={__('Al agendar')}>
                            <Select value={p.after} onChange={(e) => set({ after: e.target.value as 'redirect' | 'button' })} data-testid="booking-payment-after">
                                <option value="redirect">{__('Llevarlo directo a pagar')}</option>
                                <option value="button">{__('Mostrar el botón para pagar en la confirmación')}</option>
                            </Select>
                        </Field>
                        <Field label={__('Texto del botón')} hint={__('Vacío = «Pagar ahora».')}>
                            <Input value={p.button_label} maxLength={60} placeholder={__('Pagar ahora')} onChange={(e) => set({ button_label: e.target.value })} data-testid="booking-payment-button" />
                        </Field>
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Insertada en un sitio, el pago se abre en otra pestaña. El correo de la cita también lleva el botón para pagar.')}
                        </p>
                    </Section>
                </>
            )}
        </div>
    );
}
