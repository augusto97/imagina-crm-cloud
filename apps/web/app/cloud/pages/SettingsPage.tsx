import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import type { BillingSummary } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { MembersPanel } from '@/cloud/components/MembersPanel';
import { SubscriptionPanel } from '@/cloud/components/SubscriptionPanel';
import { SystemUpdatesPanel } from '@/cloud/components/SystemUpdatesPanel';
import { SmtpSettingsPanel } from '@/cloud/components/SmtpSettingsPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Ajustes del workspace: plan, estado de facturación, uso vs. límites, miembros. */
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
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-4xl imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <SlidersHorizontal className="imcrm-h-5 imcrm-w-5 imcrm-text-primary" />
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">Ajustes</h1>
                </div>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    Plan y facturación, miembros del workspace y configuración del sistema.
                </p>
            </header>

            {checkout === 'success' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-emerald-200 imcrm-bg-emerald-50 imcrm-p-3 imcrm-text-sm imcrm-text-emerald-800 dark:imcrm-border-emerald-900 dark:imcrm-bg-emerald-950/40 dark:imcrm-text-emerald-300">
                    ¡Gracias! Estamos confirmando tu pago; el plan se actualiza en cuanto el proveedor lo notifique.
                </div>
            )}
            {checkout === 'cancel' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    Cancelaste el pago. Podés intentarlo de nuevo cuando quieras.
                </div>
            )}

            {billing.data && <BillingCard summary={billing.data} />}
            {isAdmin && billing.data && <SubscriptionPanel currentPlan={billing.data.plan} />}
            {isAdmin && <MembersPanel />}
            {/* Se auto-ocultan si el usuario no es superadmin de plataforma (403). */}
            <SmtpSettingsPanel />
            <SystemUpdatesPanel />
        </div>
    );
}

function BillingCard({ summary }: { summary: BillingSummary }): JSX.Element {
    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <div>
                        <div className="imcrm-text-xs imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            Plan
                        </div>
                        <CardTitle className="imcrm-text-lg imcrm-capitalize">{summary.plan}</CardTitle>
                    </div>
                    <span
                        className={[
                            'imcrm-rounded-full imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium',
                            summary.read_only
                                ? 'imcrm-bg-rose-100 imcrm-text-rose-700 dark:imcrm-bg-rose-950/50 dark:imcrm-text-rose-300'
                                : 'imcrm-bg-emerald-100 imcrm-text-emerald-700 dark:imcrm-bg-emerald-950/50 dark:imcrm-text-emerald-300',
                        ].join(' ')}
                    >
                        {summary.status}
                        {summary.read_only ? ' · solo lectura' : ''}
                    </span>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-3 imcrm-pt-0">
                <UsageBar label="Registros" used={summary.usage.records} limit={summary.limits.max_records} />
                <UsageBar label="Usuarios" used={summary.usage.users} limit={summary.limits.max_users} />
                <UsageBar
                    label="Automatizaciones"
                    used={summary.usage.automations}
                    limit={summary.limits.max_automations}
                />
            </CardContent>
        </Card>
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
                            'imcrm-h-2 imcrm-rounded imcrm-transition-all',
                            pct >= 90 ? 'imcrm-bg-rose-500' : 'imcrm-bg-primary',
                        ].join(' ')}
                        style={{ width: `${pct}%` }}
                    />
                )}
            </div>
        </div>
    );
}
