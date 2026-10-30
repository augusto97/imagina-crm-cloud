import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Check, Crown, Lock, SlidersHorizontal } from 'lucide-react';
import { PLAN_MODULE_CATALOG, readDisabledModules, type BillingSummary } from '@imagina-base/shared';
import { api, useSession } from '@/cloud/session';
import { CAP, useCan } from '@/lib/permissions';
import {
    resolveSettingsSection,
    settingsSectionGroups,
    type SettingsSectionId,
} from '@/cloud/settingsSections';
import { AppearanceCard } from '@/admin/settings/AppearanceCard';
import { NotificationPrefsCard } from '@/admin/settings/NotificationPrefsCard';
import { AuditLogPanel } from '@/cloud/components/AuditLogPanel';
import { IncidentsPanel } from '@/cloud/components/IncidentsPanel';
import { TrashPanel } from '@/cloud/components/TrashPanel';
import { SecurityCard } from '@/admin/settings/SecurityCard';
import { EmailSignatureCard } from '@/admin/settings/EmailSignatureCard';
import { PersonalDataCard } from '@/admin/settings/PersonalDataCard';
import { BrandingPanel } from '@/cloud/components/BrandingPanel';
import { DomainPanel } from '@/cloud/components/DomainPanel';
import { MembersPanel } from '@/cloud/components/MembersPanel';
import { GuestsPanel } from '@/cloud/components/GuestsPanel';
import { RolesPanel } from '@/cloud/components/RolesPanel';
import { useIsGuest } from '@/lib/guest';
import { TeamsPanel } from '@/cloud/components/TeamsPanel';
import { RegionalFormatPanel } from '@/cloud/components/RegionalFormatPanel';
import { SubscriptionPanel } from '@/cloud/components/SubscriptionPanel';
import { AiSettingsPanel } from '@/cloud/components/AiSettingsPanel';
import { IntegrationsPanel } from '@/cloud/components/IntegrationsPanel';
import { TenantMailPanel } from '@/cloud/components/TenantMailPanel';
import { CaptchaKeysCard } from '@/cloud/components/CaptchaKeysCard';
import { PortalAuthCard } from '@/cloud/components/PortalAuthCard';
import { DataConsentPanel } from '@/cloud/components/DataConsentPanel';
import { TenantStoragePanel } from '@/cloud/components/TenantStoragePanel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

import { formatDate, formatNumber } from '@/lib/tenantFormat';
import { PlanModuleGate } from '@/components/PlanModuleNotice';
import { cn } from '@/lib/utils';
const STATUS_LABEL: Record<BillingSummary['status'], string> = {
    trialing: 'En prueba',
    active: 'Activa',
    past_due: 'Impaga',
    canceled: 'Cancelada',
};

/**
 * Ajustes del workspace: renderiza UNA sección a la vez. La NAV de secciones
 * vive en el panel contextual del Sidebar (estilo ClickUp) — aquí sólo queda
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
    // `GET /billing` es sólo para admins (v0.1.286: antes se pedía igual y a
    // cualquier otro rol le devolvía 403 en cada visita a Ajustes).
    const billing = useQuery({
        queryKey: ['billing', tenantId],
        queryFn: () => api.billing(),
        enabled: isAdmin,
    });

    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS);
    const canManageTeams = useCan(CAP.MANAGE_TEAMS);
    const isGuest = useIsGuest();
    const groups = settingsSectionGroups({ isAdmin, canManageAutomations, canManageTeams, isGuest });
    const visible = groups.flatMap((g) => g.items);
    // Fallback a "plan" (admin) o "seguridad" si el param no existe o apunta a
    // una sección que este rol no ve.
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
                        {isAdmin
                            ? 'Plan y facturación, miembros de la empresa y configuración del sistema.'
                            : 'Tu cuenta: seguridad, avisos, firma y apariencia.'}
                    </p>
                </div>
            </header>

            {checkout === 'success' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
                    ¡Gracias! Estamos confirmando tu pago con el proveedor: el período se actualiza apenas lo confirme (con PSE o en efectivo puede tardar un rato).
                </div>
            )}
            {checkout === 'subscription' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-success/25 imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-success">
                    Listo. Cuando Mercado Pago confirme la autorización de la tarjeta, la renovación automática queda activa.
                </div>
            )}
            {checkout === 'cancel' && (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground">
                    Cancelaste el pago. Puedes intentarlo de nuevo cuando quieras.
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
                {active === 'plan' && isAdmin && (
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
                {active === 'miembros' && isAdmin && (
                    <>
                        <MembersPanel />
                        {/* C3 — personas de afuera con algo compartido. */}
                        <GuestsPanel />
                    </>
                )}
                {active === 'roles' && isAdmin && (
                    <PlanModuleGate module="custom_roles">
                        <RolesPanel />
                    </PlanModuleGate>
                )}
                {active === 'equipos' && (isAdmin || canManageTeams) && <TeamsPanel />}
                {/* Branding white-label del workspace (nombre, color, logo) +
                    dominio personalizado (ADR-S17) + dominio del portal de
                    clientes (v0.1.245). */}
                {active === 'marca' && isAdmin && (
                    <>
                        <BrandingPanel />
                        {/* v0.1.338 (ADR-S87) — el dominio propio, si el plan lo incluye. */}
                        <PlanModuleGate module="custom_domain" compact>
                            <DomainPanel />
                            <DomainPanel kind="portal" />
                        </PlanModuleGate>
                    </>
                )}
                {/* SMTP propio del workspace (white-label de correo). */}
                {active === 'formato' && isAdmin && <RegionalFormatPanel />}

                {active === 'correo' && isAdmin && <TenantMailPanel />}
                {active === 'portal' && isAdmin && (
                    <div className="imcrm-space-y-4">
                        <PlanModuleGate module="portal" compact>
                            <PortalAuthCard />
                        </PlanModuleGate>
                        <CaptchaKeysCard scope="tenant" />
                    </div>
                )}

                {/* Ley 1581 — autorización de tratamiento de datos personales. */}
                {active === 'privacidad' && isAdmin && <DataConsentPanel />}

                {/* v0.1.268 (ADR-S36) — dónde se guardan los archivos. */}
                {active === 'almacenamiento' && isAdmin && <TenantStoragePanel />}

                {active === 'asistente' && isAdmin && (
                    <PlanModuleGate module="ai">
                        <AiSettingsPanel />
                    </PlanModuleGate>
                )}

                {/* v0.1.196 (ADR-S22) — conectores: el panel se auto-oculta ante 403. */}
                {/* v0.1.338 — la galería pinta con candado lo que el plan no incluye
                    (la tienda, el sitio y SQL tienen su propio módulo). */}
                {active === 'conectores' && <IntegrationsPanel />}

                {active === 'problemas' && <IncidentsPanel />}
                {active === 'papelera' && <TrashPanel />}
                {/* Bitácora de acciones administrativas (v0.1.114). */}
                {active === 'auditoria' && isAdmin && <AuditLogPanel />}
                {/* Per-usuario: contraseña + sesiones abiertas (v0.1.116). */}
                {active === 'seguridad' && <SecurityCard />}

                {active === 'avisos' && <NotificationPrefsCard />}
                {/* Per-usuario: firma insertable en emails de automatizaciones. */}
                {active === 'firma' && <EmailSignatureCard />}
                {/* Per-usuario: descarga/borrado de datos personales (GDPR). */}
                {active === 'datos' && <PersonalDataCard />}
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
                {/* v0.1.338 (ADR-S87) — la prueba y su fin. */}
                {summary.trial_ends_at && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="billing-trial-ends">
                        Estás en la prueba: termina el{' '}
                        <span className="imcrm-font-medium imcrm-text-foreground">{formatDate(new Date(summary.trial_ends_at))}</span>
                        . Elige un plan en Suscripción para seguir sin interrupciones.
                    </p>
                )}
                {summary.lapsed_from && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        Pasó a la prueba porque el plan «{summary.lapsed_from.plan}» no se renovó. Al pagar, vuelve con todo lo que tenía.
                    </p>
                )}
                {summary.paid_until && (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="billing-paid-until">
                        Pagado hasta el{' '}
                        <span className="imcrm-font-medium imcrm-text-foreground">
                            {formatDate(new Date(summary.paid_until))}
                        </span>
                        . Los pagos y la renovación están en Suscripción.
                    </p>
                )}
                <UsageBar label="Registros" used={summary.usage.records} limit={summary.limits.max_records} />
                <UsageBar label="Usuarios" used={summary.usage.users} limit={summary.limits.max_users} />
                {/* C3 — personas de afuera con algo compartido (no ocupan usuario). */}
                <UsageBar label="Invitados" used={summary.usage.guests ?? 0} limit={summary.limits.max_guests ?? null} />
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
                    note={
                        summary.limits.max_storage_mb === null
                            ? undefined
                            : 'Sólo cuentan los archivos guardados en el servidor. Los que van a tu propio almacenamiento (Ajustes → Almacenamiento) no tienen límite.'
                    }
                />
                {/* Cuota de correo (ADR-S18): sólo cuentan los que salen por el
                    SMTP de la plataforma. Con SMTP propio no hay límite. */}
                <UsageBar
                    label="Correos este mes"
                    used={summary.usage.emails_month}
                    limit={summary.own_smtp ? null : summary.limits.max_emails_month}
                    note={
                        summary.own_smtp
                            ? 'Sin límite de la plataforma: tus correos salen por tu propio servidor o tu cuenta de Google/Microsoft (con los límites de ese proveedor).'
                            : summary.limits.max_emails_month === null
                              ? undefined
                              : 'Incluye automatizaciones y accesos al portal. ¿Necesitas más? En Ajustes → Correo puedes mandar con tu cuenta de Google o Microsoft, o con tu propio SMTP.'
                    }
                />
                {/* Cuota del asistente IA (ADR-S21): sólo cuentan los pedidos
                    hechos con la clave de la plataforma. Con clave propia no hay límite. */}
                <UsageBar
                    label="Pedidos al asistente este mes"
                    used={summary.usage.ai_requests_month}
                    limit={summary.own_ai_key ? null : summary.limits.max_ai_requests_month}
                    note={
                        summary.own_ai_key
                            ? 'Sin límite: el asistente usa la clave IA de tu empresa.'
                            : summary.limits.max_ai_requests_month === null
                              ? undefined
                              : 'Cada mensaje al asistente cuenta como un pedido. ¿Necesitas más? Carga tu propia clave en Ajustes → Asistente IA y no hay límite.'
                    }
                />
                <PlanModulesList disabled={summary.disabled_modules} />
            </CardContent>
        </Card>
    );
}

/** v0.1.338 (ADR-S87) — Qué incluye el plan: lo incluido con ✓ y lo que no, con candado. */
function PlanModulesList({ disabled }: { disabled: string[] }): JSX.Element {
    const off = new Set(readDisabledModules(disabled));
    return (
        <div className="imcrm-space-y-2 imcrm-border-t imcrm-border-border imcrm-pt-4" data-testid="billing-plan-modules">
            <p className="imcrm-text-sm imcrm-font-medium">Qué incluye tu plan</p>
            <ul className="imcrm-grid imcrm-gap-1.5 sm:imcrm-grid-cols-2">
                {PLAN_MODULE_CATALOG.map((m) => (
                    <li
                        key={m.key}
                        className={cn('imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm', off.has(m.key) && 'imcrm-text-muted-foreground')}
                        data-module={m.key}
                        data-included={off.has(m.key) ? 'no' : 'yes'}
                    >
                        {off.has(m.key) ? (
                            <Lock className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-label="No incluido" />
                        ) : (
                            <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" aria-label="Incluido" />
                        )}
                        {m.label}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function UsageBar({
    label,
    used,
    limit,
    suffix = '',
    note,
}: {
    label: string;
    used: number;
    limit: number | null;
    /** Unidad opcional pegada a los números (p.ej. " MB"). */
    suffix?: string;
    /** Aclaración bajo la barra (qué cuenta, cómo levantar el límite). */
    note?: string;
}): JSX.Element {
    const pct = limit === null ? 0 : Math.min(100, (used / limit) * 100);
    // Umbrales semánticos: normal → advertencia (≥75%) → crítico (≥90%).
    const fill = pct >= 90 ? 'imcrm-bg-destructive' : pct >= 75 ? 'imcrm-bg-warning' : 'imcrm-bg-primary';
    return (
        <div className="imcrm-space-y-1.5">
            <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-text-sm">
                <span className="imcrm-font-medium">{label}</span>
                <span className="imcrm-tabular-nums imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-semibold imcrm-text-foreground">{formatNumber(used)}{suffix}</span>
                    {' / '}
                    {limit === null ? '∞' : `${formatNumber(limit)}${suffix}`}
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
            {note && <p className="imcrm-text-xs imcrm-text-muted-foreground">{note}</p>}
        </div>
    );
}
