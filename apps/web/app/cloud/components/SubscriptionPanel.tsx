import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Plan, PaymentProvider, PlanPrice } from '@imagina-base/shared';
import { CreditCard } from 'lucide-react';
import { CloudApiError } from '@/lib/cloud/client';
import { api, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
    paypal: 'PayPal',
    mercadopago: 'Mercado Pago',
};
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Precio legible: muestra las monedas que el plan tenga configuradas. */
function priceLabel(p: PlanPrice): string {
    const parts: string[] = [];
    if (p.cop !== null) parts.push(`${COP.format(p.cop)} / mes`);
    if (p.usd !== null) parts.push(USD.format(p.usd));
    return parts.join(' · ');
}

/** Un proveedor sólo aplica si el plan tiene precio en su moneda. */
function providerApplies(p: PlanPrice, provider: PaymentProvider): boolean {
    return provider === 'paypal' ? p.usd !== null : p.cop !== null;
}

/**
 * Suscripción (ADR-S12). Sólo para admin. Muestra los planes con checkout
 * self-serve (dinámicos: los que el operador marcó con precio, incluidos los
 * custom) y, por cada proveedor habilitado, un botón que abre el pago y
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
    const { providers, plans } = cfg.data;

    const checkout = async (plan: Plan, provider: PaymentProvider): Promise<void> => {
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
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <CreditCard className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>Suscripción</CardTitle>
                        <CardDescription>Elegí un plan y pagá con el medio que prefieras.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-0">
            {providers.length === 0 ? (
                <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    Los pagos todavía no están configurados en este entorno.
                </p>
            ) : plans.length === 0 ? (
                <p className="imcrm-rounded-md imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    No hay planes con precio configurado para vender.
                </p>
            ) : (
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {plans.map((plan) => {
                        const isCurrent = currentPlan === plan.slug;
                        const applicable = providers.filter((provider) => providerApplies(plan, provider));
                        return (
                            <div
                                key={plan.slug}
                                className={[
                                    'imcrm-space-y-2 imcrm-rounded-xl imcrm-border imcrm-p-4 imcrm-transition-colors',
                                    isCurrent
                                        ? 'imcrm-border-primary imcrm-shadow-[0_0_0_3px_hsl(var(--imcrm-primary)/0.12)]'
                                        : 'imcrm-border-border hover:imcrm-border-input',
                                ].join(' ')}
                            >
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                    <span className="imcrm-font-semibold">{plan.name}</span>
                                    {isCurrent && <Badge dot>Actual</Badge>}
                                </div>
                                <p className="imcrm-text-sm imcrm-text-muted-foreground">{priceLabel(plan)}</p>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-pt-1">
                                    {applicable.map((provider) => (
                                        <Button
                                            key={provider}
                                            variant="secondary"
                                            size="sm"
                                            disabled={busy !== null}
                                            onClick={() => void checkout(plan.slug, provider)}
                                        >
                                            {busy === `${plan.slug}:${provider}`
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
            </CardContent>
        </Card>
    );
}
