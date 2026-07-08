import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    CHECKOUT_PLANS,
    type CheckoutPlan,
    type Plan,
    type PaymentProvider,
} from '@imagina-base/shared';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
    paypal: 'PayPal',
    mercadopago: 'Mercado Pago',
};
const PLAN_LABELS: Record<CheckoutPlan, string> = { starter: 'Starter', pro: 'Pro' };
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Suscripción (ADR-S12). Sólo para admin. Muestra los planes con checkout
 * self-serve y, por cada proveedor habilitado, un botón que abre el pago y
 * redirige. Stripe no opera en Colombia → PayPal (USD) y Mercado Pago (COP).
 */
export function SubscriptionPanel({ currentPlan }: { currentPlan: Plan }): JSX.Element | null {
    const tenantId = useSession((s) => s.activeTenantId);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const cfg = useQuery({
        queryKey: ['payments-config', tenantId],
        queryFn: () => api.paymentsConfig(),
    });

    if (!cfg.data) return null;
    const { providers, prices } = cfg.data;

    const checkout = async (plan: CheckoutPlan, provider: PaymentProvider): Promise<void> => {
        setBusy(`${plan}:${provider}`);
        setError(null);
        try {
            const res = await api.createCheckout({ plan, provider });
            window.location.href = res.url; // redirige al proveedor
        } catch (e) {
            setError(e instanceof CloudApiError ? e.message : 'No se pudo iniciar el pago');
            setBusy(null);
        }
    };

    return (
        <section className="imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
            <div>
                <h2 className="imcrm-text-sm imcrm-font-semibold">Suscripción</h2>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    Elegí un plan y pagá con el medio que prefieras.
                </p>
            </div>

            {providers.length === 0 ? (
                <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    Los pagos todavía no están configurados en este entorno.
                </p>
            ) : (
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {CHECKOUT_PLANS.map((plan) => {
                        const price = prices[plan];
                        const isCurrent = currentPlan === plan;
                        return (
                            <div
                                key={plan}
                                className={[
                                    'imcrm-space-y-2 imcrm-rounded-lg imcrm-border imcrm-p-4',
                                    isCurrent ? 'imcrm-border-primary' : 'imcrm-border-border',
                                ].join(' ')}
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                    <span className="imcrm-font-semibold">{PLAN_LABELS[plan]}</span>
                                    {isCurrent && (
                                        <span className="imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-text-primary">
                                            Actual
                                        </span>
                                    )}
                                </div>
                                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                    {price ? `${COP.format(price.cop)} / mes · ${USD.format(price.usd)}` : ''}
                                </p>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-pt-1">
                                    {providers.map((provider) => (
                                        <Button
                                            key={provider}
                                            variant="secondary"
                                            size="sm"
                                            disabled={busy !== null}
                                            onClick={() => void checkout(plan, provider)}
                                        >
                                            {busy === `${plan}:${provider}`
                                                ? 'Redirigiendo…'
                                                : `Pagar con ${PROVIDER_LABELS[provider]}`}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {error && <p className="imcrm-text-sm imcrm-text-destructive">{error}</p>}
        </section>
    );
}
