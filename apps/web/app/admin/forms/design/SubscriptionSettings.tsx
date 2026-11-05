import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { FORM_SUBSCRIPTION_MAX_PLANS, type FormConfig } from '@imagina-base/shared';

import { formatMoney } from '@/cloud/components/payments/paymentUi';
import { frequencyText } from '@/cloud/components/subscriptions/subscriptionText';
import { api } from '@/cloud/session';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';

import { Check, Field, Section } from '../../automations/email/EmailBlockInspector';
import { updateSettings } from '../formDesignOps';

/**
 * v0.1.368 (ADR-S96) — Suscribir al enviar: el formulario crea una suscripción
 * de débito automático de Mercado Pago con uno de los planes de la empresa
 * (la persona elige si hay varios). El correo sale de la pregunta «correo de
 * quien responde». Excluyente con «Cobrar al enviar».
 */
export function SubscriptionSettings({ config, fields, onChange }: { config: FormConfig; fields: FieldEntity[]; onChange: (next: FormConfig) => void }): JSX.Element {
    const s = config.settings.subscription;
    const set = (patch: Partial<FormConfig['settings']['subscription']>): void => onChange(updateSettings(config, { subscription: { ...s, ...patch } }));
    const conns = useQuery({ queryKey: ['collections-connections'], queryFn: () => api.collectionConnections(), retry: false, staleTime: 60_000 });
    const plansQ = useQuery({ queryKey: ['subscription-plans', 'all'], queryFn: () => api.subscriptionPlans(), retry: false, staleTime: 30_000 });
    // Sólo planes de una conexión de Mercado Pago DEL EQUIPO: una privada es de una persona.
    const teamMp = new Set((conns.data ?? []).filter((c) => c.shared !== false && (c.provider === 'mercadopago' || c.provider === 'paypal')).map((c) => c.id));
    const plans = (plansQ.data ?? []).filter((p) => p.active && p.connection_id !== null && teamMp.has(p.connection_id));
    const loading = conns.isLoading || plansQ.isLoading;

    const emailId = config.settings.respondent_email_field_id;
    const emailAsked = emailId !== null && config.items.some((i) => i.type === 'field' && i.field_id === emailId);
    const emailField = emailId !== null ? fields.find((f) => f.id === emailId) : undefined;
    const chosen = s.plan_ids.filter((id) => plans.some((p) => p.id === id));
    const lost = s.plan_ids.length - chosen.length;
    const payOn = config.settings.payment.enabled;

    const toggle = (id: number, on: boolean): void => {
        const next = on ? [...s.plan_ids.filter((x) => x !== id), id] : s.plan_ids.filter((x) => x !== id);
        set({ plan_ids: next.slice(0, FORM_SUBSCRIPTION_MAX_PLANS) });
    };
    const missing =
        s.enabled &&
        (!loading && plans.length === 0
            ? null
            : chosen.length === 0
              ? __('Elige al menos un plan.')
              : !emailAsked
                ? __('Pregunta el correo y elígelo en «Correo de quien responde» → «Pregunta con el correo»: Mercado Pago y PayPal lo piden para la suscripción.')
                : null);

    return (
        <Section title={__('Suscribir al enviar')}>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="form-subscription" data-tour="form-subscription">
                <Check
                    label={__('Suscribir con débito automático al enviar')}
                    checked={s.enabled}
                    onChange={(v) => set({ enabled: v })}
                    testId="form-subscription-enabled"
                />
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Al enviar, la persona autoriza el pago en Mercado Pago o PayPal (según el plan) y desde ahí se le cobra sola cada período (una mensualidad, una membresía). El dinero llega a la cuenta de la empresa y la suscripción aparece en la ficha del registro.')}
                </p>
                {s.enabled && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                        {payOn && (
                            <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="form-subscription-vs-payment">
                                {__('Este formulario también tiene «Cobrar al enviar»: mientras suscriba, no cobra una vez además.')}
                            </p>
                        )}
                        <Field
                            label={__('Planes que se ofrecen')}
                            hint={__('Con varios, la persona elige uno. El orden es el de la lista. Los planes se arman en Ajustes → Integraciones → Mercado Pago o PayPal → Cobros.')}
                        >
                            {loading ? (
                                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Cargando planes…')}</p>
                            ) : plans.length === 0 ? (
                                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="form-subscription-no-plans">
                                    {__('No hay planes activos de una conexión de Mercado Pago o PayPal del equipo.')}{' '}
                                    <Link to="/settings?s=conectores" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                        {__('Créalos en Ajustes → Integraciones')}
                                    </Link>
                                </p>
                            ) : (
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" role="group" aria-label={__('Planes que se ofrecen')}>
                                    {plans.map((p) => {
                                        const on = s.plan_ids.includes(p.id);
                                        const full = !on && chosen.length >= FORM_SUBSCRIPTION_MAX_PLANS;
                                        return (
                                            <label
                                                key={p.id}
                                                className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2 imcrm-text-xs"
                                                data-testid={`form-subscription-plan-${p.id}`}
                                            >
                                                <input type="checkbox" className="imcrm-mt-0.5" checked={on} disabled={full} onChange={(e) => toggle(p.id, e.target.checked)} />
                                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                                    <span className="imcrm-font-medium">{p.name}</span>
                                                    <span className="imcrm-text-muted-foreground">
                                                        {formatMoney(p.amount, p.currency)} {frequencyText(p.frequency, p.frequency_type)}
                                                        {p.trial_days > 0 ? ` · ${p.trial_days} ${__('días gratis')}` : ''}
                                                        {p.connection_name ? ` · ${p.connection_name}` : ''}
                                                    </span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                            {lost > 0 && !loading && (
                                <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="form-subscription-lost">
                                    {lost === 1
                                        ? __('Un plan elegido ya no está disponible (se pausó o su conexión dejó de ser del equipo): no se ofrece.')
                                        : `${lost} ${__('planes elegidos ya no están disponibles: no se ofrecen.')}`}
                                </p>
                            )}
                        </Field>

                        <Field label={__('Título de la elección')} hint={__('Vacío = «Elige tu plan».')}>
                            <Input value={s.plan_label} maxLength={120} placeholder={__('Elige tu plan')} onChange={(e) => set({ plan_label: e.target.value })} data-testid="form-subscription-label" />
                        </Field>

                        <Field label={__('Correo de la suscripción')}>
                            <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="form-subscription-email">
                                {emailAsked && emailField
                                    ? `${__('Sale de la pregunta')} «${emailField.label}».`
                                    : __('Falta: pregunta el correo y elígelo en «Correo de quien responde» → «Pregunta con el correo».')}
                            </p>
                        </Field>

                        <Field label={__('Después de enviar')}>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-label={__('Después de enviar')}>
                                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                    <input type="radio" checked={s.after === 'redirect'} onChange={() => set({ after: 'redirect' })} data-testid="form-subscription-after-redirect" />
                                    <span>{__('Llevar directo a autorizar el pago (Mercado Pago o PayPal)')}</span>
                                </label>
                                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                    <input type="radio" checked={s.after === 'button'} onChange={() => set({ after: 'button' })} data-testid="form-subscription-after-button" />
                                    <span>{__('Mostrar el botón en la pantalla de gracias')}</span>
                                </label>
                            </div>
                        </Field>
                        <Field label={__('Texto del botón')}>
                            <Input
                                value={s.button_label}
                                maxLength={60}
                                placeholder={__('Autorizar el débito automático')}
                                onChange={(e) => set({ button_label: e.target.value })}
                                data-testid="form-subscription-button"
                            />
                        </Field>

                        {missing && (
                            <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-700 dark:imcrm-text-amber-300" data-testid="form-subscription-missing">
                                {missing} {__('Mientras tanto, el formulario recibe respuestas sin suscribir.')}
                            </p>
                        )}
                        <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Para ver el estado en la lista (al día, reintentando, en mora…), en la ficha de un registro → «Suscripción» → «Columnas». Para avisar cuando se activa o falla un cobro, usa una automatización «Cuando cambia una suscripción».')}
                        </p>
                    </div>
                )}
            </div>
        </Section>
    );
}
