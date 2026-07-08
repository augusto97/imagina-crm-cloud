import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import type { BillingSummary } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { MembersPanel } from '@/cloud/components/MembersPanel';
import { SubscriptionPanel } from '@/cloud/components/SubscriptionPanel';

/** Ajustes del workspace: plan, estado de facturación, uso vs. límites. */
export function SettingsPage(): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const isAdmin = useSession(
        (s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin',
    );
    const [params] = useSearchParams();
    const checkout = params.get('checkout');
    const billing = useQuery({
        queryKey: ['billing', tenantId],
        queryFn: () => api.billing(),
    });

    return (
        <div className="imcrm-mx-auto imcrm-max-w-2xl imcrm-space-y-6 imcrm-p-6">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">Ajustes</h1>
                <Link to="/lists" className="imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground">
                    ← Volver
                </Link>
            </div>

            {checkout === 'success' && (
                <p className="imcrm-rounded-md imcrm-bg-emerald-100 imcrm-p-3 imcrm-text-sm imcrm-text-emerald-800">
                    ¡Gracias! Estamos confirmando tu pago; el plan se actualiza en cuanto el proveedor lo notifique.
                </p>
            )}
            {checkout === 'cancel' && (
                <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    Cancelaste el pago. Podés intentarlo de nuevo cuando quieras.
                </p>
            )}

            {billing.data && <BillingCard summary={billing.data} />}
            {isAdmin && billing.data && <SubscriptionPanel currentPlan={billing.data.plan} />}
            {isAdmin && <MembersPanel />}
        </div>
    );
}

function BillingCard({ summary }: { summary: BillingSummary }): JSX.Element {
    return (
        <section className="imcrm-space-y-4 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                <div>
                    <div className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        Plan
                    </div>
                    <div className="imcrm-text-lg imcrm-font-semibold imcrm-capitalize">{summary.plan}</div>
                </div>
                <span
                    className={[
                        'imcrm-rounded-full imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                        summary.read_only
                            ? 'imcrm-bg-rose-100 imcrm-text-rose-700'
                            : 'imcrm-bg-emerald-100 imcrm-text-emerald-700',
                    ].join(' ')}
                >
                    {summary.status}
                    {summary.read_only ? ' · solo lectura' : ''}
                </span>
            </div>

            <div className="imcrm-space-y-3">
                <UsageBar label="Registros" used={summary.usage.records} limit={summary.limits.max_records} />
                <UsageBar label="Usuarios" used={summary.usage.users} limit={summary.limits.max_users} />
                <UsageBar
                    label="Automatizaciones"
                    used={summary.usage.automations}
                    limit={summary.limits.max_automations}
                />
            </div>
        </section>
    );
}

function UsageBar({
    label,
    used,
    limit,
}: {
    label: string;
    used: number;
    limit: number | null;
}): JSX.Element {
    const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
    return (
        <div className="imcrm-space-y-1">
            <div className="imcrm-flex imcrm-justify-between imcrm-text-sm">
                <span>{label}</span>
                <span className="imcrm-tabular-nums imcrm-text-muted-foreground">
                    {used} / {limit ?? '∞'}
                </span>
            </div>
            <div className="imcrm-h-2 imcrm-rounded imcrm-bg-muted">
                {limit !== null && (
                    <div
                        className={[
                            'imcrm-h-2 imcrm-rounded',
                            pct >= 90 ? 'imcrm-bg-rose-500' : 'imcrm-bg-primary',
                        ].join(' ')}
                        style={{ width: `${pct}%` }}
                    />
                )}
            </div>
        </div>
    );
}
