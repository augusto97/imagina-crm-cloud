import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Crown, SlidersHorizontal } from 'lucide-react';
import type { BillingSummary } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import {
    resolveSettingsSection,
    settingsSectionGroups,
    type SettingsSectionId,
} from '@/cloud/settingsSections';
import { AppearanceCard } from '@/admin/settings/AppearanceCard';
import { EmailSignatureCard } from '@/admin/settings/EmailSignatureCard';
import { BrandingPanel } from '@/cloud/components/BrandingPanel';
import { DomainPanel } from '@/cloud/components/DomainPanel';
import { MembersPanel } from '@/cloud/components/MembersPanel';
import { RegionalFormatPanel } from '@/cloud/components/RegionalFormatPanel';
import { SubscriptionPanel } from '@/cloud/components/SubscriptionPanel';
import { TenantSmtpPanel } from '@/cloud/components/TenantSmtpPanel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

const STATUS_LABEL: Record<BillingSummary['status'], string> = {
    trialing: 'En prueba',
    active: 'Activa',
    past_due: 'Impaga',
    canceled: 'Cancelada',
};

/**
 * Ajustes del workspace: renderiza UNA sección a la vez. La NAV de secciones
 * vive en el panel contextual del Sidebar (estilo ClickUp) — acá sólo queda
 * el select mobile (<lg) como fallback cuando el panel no está visible. La
 * sección activa se persiste en el query param `?s=` (sobrevive refresh y es
 * linkeable). Los gates de visibilidad (compartidos con el Sidebar vía
 * `settingsSectionGroups`) son los mismos de siempre: rol admin del workspace
 * para Suscripción/Miembros/Marca/Correo (los paneles además se auto-ocultan
 * ante 403). Los ajustes globales de la app viven en la consola de Plataforma.
 */
export function SettingsPage(): JSX.Element {
    const tenantId = useSession((s) => s.activeTenantId);
    const isAdmin = useSession(
        (s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin',
    );
    const [params, setParams] = useSearchParams();
    const checkout = params.get('checkout');
    const billing = useQuery({
        queryKey: ['billing', tenantId],
        queryFn: () => api.billing(),
    });

    const groups = settingsSectionGroups({ isAdmin });
    const visible = groups.flatMap((g) => g.items);
    // Fallback a "plan" si el param no existe o apunta a una sección gateada.
    const active: SettingsSectionId = resolveSettingsSection(groups, params.get('s'));
    const activeItem = visible.find((i) => i.id === active) ?? visible[0];

    const select = (id: SettingsSectionId): void => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('s', id);
                return next;
            },
            { replace: true },
        );
    };

    const billingSkeleton = billing.isLoading && (
        <div className="imcrm-h-56 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" />
    );

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-5xl imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-items-center imcrm-gap-4">
                <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                    <SlidersHorizontal className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <div>
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">Ajustes</h1>
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

            {/* Nav mobile (<lg): select compacto — fallback cuando el panel
                contextual del Sidebar (LA nav de Ajustes) no está visible. */}
            <div className="lg:imcrm-hidden">
                <select
                    aria-label="Sección de ajustes"
                    className="imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-py-2 imcrm-text-sm"
                    value={active}
                    onChange={(e) => select(e.target.value as SettingsSectionId)}
                >
                    {groups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                            {g.items.map((i) => (
                                <option key={i.id} value={i.id}>
                                    {i.label}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>

            {/* Sección activa, una a la vez (la nav vive en el Sidebar). */}
            <section className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-4">
                {activeItem && (
                    <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">
                        {activeItem.label}
                    </h2>
                )}
                {active === 'plan' && (
                    <>
                        {billingSkeleton}
                        {billing.data && <BillingCard summary={billing.data} />}
                    </>
                )}
                {active === 'suscripcion' && isAdmin && (
                    <>
                        {billingSkeleton}
                        {billing.data && <SubscriptionPanel currentPlan={billing.data.plan} />}
                    </>
                )}
                {active === 'miembros' && isAdmin && <MembersPanel />}
                {/* Branding white-label del workspace (nombre, color, logo) +
                    dominio personalizado (ADR-S17). */}
                {active === 'marca' && isAdmin && (
                    <>
                        <BrandingPanel />
                        <DomainPanel />
                    </>
                )}
                {/* SMTP propio del workspace (white-label de correo). */}
                {active === 'formato' && isAdmin && <RegionalFormatPanel />}

                {active === 'correo' && isAdmin && <TenantSmtpPanel />}
                {/* Per-usuario: firma insertable en emails de automatizaciones. */}
                {active === 'firma' && <EmailSignatureCard />}
                {/* Per-usuario y por dispositivo: tema claro/oscuro/sistema. */}
                {active === 'apariencia' && <AppearanceCard />}
            </section>
        </div>
    );
}

function BillingCard({ summary }: { summary: BillingSummary }): JSX.Element {
    return (
        <Card>
            <CardHeader>
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
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
