import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Crown, SlidersHorizontal } from 'lucide-react';
import type { BillingSummary } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { EmailSignatureCard } from '@/admin/settings/EmailSignatureCard';
import { MembersPanel } from '@/cloud/components/MembersPanel';
import { SubscriptionPanel } from '@/cloud/components/SubscriptionPanel';
import { SystemUpdatesPanel } from '@/cloud/components/SystemUpdatesPanel';
import { SmtpSettingsPanel } from '@/cloud/components/SmtpSettingsPanel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

const STATUS_LABEL: Record<BillingSummary['status'], string> = {
    trialing: 'En prueba',
    active: 'Activa',
    past_due: 'Impaga',
    canceled: 'Cancelada',
};

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
            <header className="imcrm-flex imcrm-items-center imcrm-gap-4">
                <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-bg-tone-cyan/15 imcrm-text-tone-cyan">
                    <SlidersHorizontal className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <div>
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">Ajustes</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        Plan y facturación, miembros del workspace y configuración del sistema.
                    </p>
                </div>
            </header>

            {checkout === 'success' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
                    ¡Gracias! Estamos confirmando tu pago; el plan se actualiza en cuanto el proveedor lo notifique.
                </div>
            )}
            {checkout === 'cancel' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    Cancelaste el pago. Podés intentarlo de nuevo cuando quieras.
                </div>
            )}

            {billing.isLoading && (
                <div className="imcrm-h-56 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />
            )}
            {billing.data && <BillingCard summary={billing.data} />}
            {isAdmin && billing.data && <SubscriptionPanel currentPlan={billing.data.plan} />}
            {isAdmin && <MembersPanel />}
            {/* Per-usuario: firma insertable en emails de automatizaciones. */}
            <EmailSignatureCard />
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
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-tone-violet/10 imcrm-text-tone-violet">
                            <Crown className="imcrm-h-5 imcrm-w-5" aria-hidden />
                        </span>
                        <div>
                            <div className="imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">
                                Plan actual
                            </div>
                            <div className="imcrm-text-xl imcrm-font-semibold imcrm-capitalize imcrm-leading-tight imcrm-tracking-tight">
                                {summary.plan}
                            </div>
                        </div>
                    </div>
                    <Badge dot variant={summary.read_only ? 'destructive' : 'success'}>
                        {STATUS_LABEL[summary.status]}
                        {summary.read_only ? ' · solo lectura' : ''}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="imcrm-space-y-4 imcrm-pt-1">
                <UsageBar label="Registros" used={summary.usage.records} limit={summary.limits.max_records} />
                <UsageBar label="Usuarios" used={summary.usage.users} limit={summary.limits.max_users} />
                <UsageBar
                    label="Automatizaciones"
                    used={summary.usage.automations}
                    limit={summary.limits.max_automations}
                />
                <UsageBar
                    label="Almacenamiento"
                    used={Math.round(summary.usage.storage_bytes / (1024 * 1024))}
                    limit={summary.limits.max_storage_mb}
                    suffix=" MB"
                />
            </CardContent>
        </Card>
    );
}

function UsageBar({
    label,
    used,
    limit,
    suffix = '',
}: {
    label: string;
    used: number;
    limit: number | null;
    /** Unidad opcional pegada a los números (p.ej. " MB"). */
    suffix?: string;
}): JSX.Element {
    const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
    // Umbrales semánticos: normal → advertencia (≥75%) → crítico (≥90%).
    const fill = pct >= 90 ? 'imcrm-bg-destructive' : pct >= 75 ? 'imcrm-bg-warning' : 'imcrm-bg-primary';
    return (
        <div className="imcrm-space-y-1.5">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-text-sm">
                <span className="imcrm-font-medium">{label}</span>
                <span className="imcrm-tabular-nums imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-semibold imcrm-text-foreground">{used.toLocaleString()}{suffix}</span>
                    {' / '}
                    {limit === null ? '∞' : `${limit.toLocaleString()}${suffix}`}
                </span>
            </div>
            <div className="imcrm-h-1.5 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                {limit !== null && (
                    <div
                        className={['imcrm-h-full imcrm-rounded-full imcrm-transition-all', fill].join(' ')}
                        style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }}
                    />
                )}
            </div>
        </div>
    );
}
