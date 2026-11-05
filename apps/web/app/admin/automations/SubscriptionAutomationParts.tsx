import { useQuery } from '@tanstack/react-query';
import { SUBSCRIPTION_EVENT_LABELS, SUBSCRIPTION_EVENTS, type SubscriptionEvent } from '@imagina-base/shared';
import { Link } from 'react-router';

import { formatMoney } from '@/cloud/components/payments/paymentUi';
import { frequencyText } from '@/cloud/components/subscriptions/subscriptionText';
import { api } from '@/cloud/session';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import type { TriggerConfig } from '@/types/automation';

/**
 * v0.1.367 (ADR-S96) — Piezas del editor de automatizaciones para las
 * suscripciones de Mercado Pago: el plan de «Crear suscripción» (de los de la
 * conexión) y qué eventos/planes disparan «Cuando cambia una suscripción».
 */

function usePlans(connectionId?: number) {
    return useQuery({
        queryKey: ['subscription-plans', connectionId ?? 'all'],
        queryFn: () => api.subscriptionPlans(connectionId),
        retry: false,
        staleTime: 30_000,
    });
}

export function SubscriptionPlanPicker({ connectionId, value, onChange }: { connectionId: number; value: string; onChange: (next: string) => void }): JSX.Element {
    const q = usePlans(connectionId);
    const plans = q.data ?? [];
    const current = Number(value);
    const known = plans.some((p) => p.id === current);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-subscription-plan-picker">
            <Select value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">{__('(elige un plan)')}</option>
                {plans.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                        {p.name} · {formatMoney(p.amount, p.currency)} {frequencyText(p.frequency, p.frequency_type)}
                        {p.active ? '' : ` (${__('pausado')})`}
                    </option>
                ))}
                {value !== '' && !known && !q.isLoading && <option value={value}>{__('Plan eliminado o de otra conexión')}</option>}
            </Select>
            {!q.isLoading && plans.length === 0 && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Esta conexión todavía no tiene planes: créalos en')}{' '}
                    <Link to={`/settings/collections/${connectionId}`} className="imcrm-text-primary hover:imcrm-underline" target="_blank" rel="noopener noreferrer">
                        {__('Cobros → Suscripciones')}
                    </Link>
                    .
                </p>
            )}
        </div>
    );
}

export function SubscriptionTriggerConfig({ config, onChange }: { config: TriggerConfig; onChange: (next: TriggerConfig) => void }): JSX.Element {
    const plans = usePlans();
    const events = Array.isArray(config.subscription_events) ? (config.subscription_events as SubscriptionEvent[]) : [];
    const planIds = Array.isArray(config.plan_ids) ? (config.plan_ids as number[]) : [];
    const setEvents = (next: SubscriptionEvent[]): void => {
        const out = { ...config };
        // Todos marcados = sin filtro (así un evento nuevo de una versión futura también dispara).
        if (next.length === 0 || next.length === SUBSCRIPTION_EVENTS.length) delete out.subscription_events;
        else out.subscription_events = SUBSCRIPTION_EVENTS.filter((e) => next.includes(e));
        onChange(out);
    };
    const chosen: readonly SubscriptionEvent[] = events.length === 0 ? SUBSCRIPTION_EVENTS : events;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3" data-testid="trigger-subscription-config">
            <fieldset className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <legend className="imcrm-mb-1 imcrm-text-sm imcrm-font-medium">{__('Qué la dispara')}</legend>
                {SUBSCRIPTION_EVENTS.map((ev) => (
                    <label key={ev} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="checkbox"
                            checked={chosen.includes(ev)}
                            onChange={(e) => {
                                const next = e.target.checked ? [...new Set([...chosen, ev])] : chosen.filter((x) => x !== ev);
                                if (next.length > 0) setEvents(next);
                            }}
                            data-subscription-event={ev}
                        />
                        {__(SUBSCRIPTION_EVENT_LABELS[ev])}
                    </label>
                ))}
            </fieldset>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Planes')}</Label>
                {(plans.data ?? []).length === 0 ? (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cualquier plan. (Los planes se crean en Integraciones → Mercado Pago → Cobros.)')}</p>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        {(plans.data ?? []).map((p) => {
                            const on = planIds.includes(p.id);
                            return (
                                <label key={p.id} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs">
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={(e) => {
                                            const next = e.target.checked ? [...planIds, p.id] : planIds.filter((x) => x !== p.id);
                                            const out = { ...config };
                                            if (next.length === 0) delete out.plan_ids;
                                            else out.plan_ids = next;
                                            onChange(out);
                                        }}
                                    />
                                    {p.name}
                                </label>
                            );
                        })}
                    </div>
                )}
                {planIds.length === 0 && (plans.data ?? []).length > 0 && <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Sin marcar ninguno: cualquier plan.')}</p>}
            </div>
        </div>
    );
}
