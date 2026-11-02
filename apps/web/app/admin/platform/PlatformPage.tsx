import { PlatformBrandCard } from './PlatformBrandCard';
import { useSearchParams } from 'react-router';
import {
    AlertTriangle,
    BadgeCheck,
    Building2,
    Database,
    ShieldCheck,
    Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { BackToIndex, SectionIndex } from '@/components/nav/SectionIndex';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { StatTile } from '@/components/ui/stat-tile';
import { usePlatformStats } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { isPlatformTab, platformTabGroups, PLATFORM_TABS, type PlatformTabId } from './platformTabs';
import { PlatformAiCard } from './PlatformAiCard';
import { PlatformDiagnosticsCard } from './PlatformDiagnosticsCard';
import { PlatformDomainsCard } from './PlatformDomainsCard';
import { PlatformHelpCard } from './PlatformHelpCard';
import { PlatformPaymentsCard } from './PlatformPaymentsCard';
import { PlatformIntegrationsCard } from './PlatformIntegrationsCard';
import { PlatformImpersonationsCard } from './PlatformImpersonationsCard';
import { PlatformBillingPolicyCard } from './PlatformBillingPolicyCard';
import { PlatformPlansCard } from './PlatformPlansCard';
import { PlatformTenantsCard } from './PlatformTenantsCard';
import { PlatformTransfersCard } from './PlatformTransfersCard';
import { PlatformUsersCard } from './PlatformUsersCard';
import { PlatformWhatsNewCard } from './PlatformWhatsNewCard';
import { CaptchaKeysCard } from '@/cloud/components/CaptchaKeysCard';
import { SmtpSettingsPanel } from '@/cloud/components/SmtpSettingsPanel';
import { SystemUpdatesPanel } from '@/cloud/components/SystemUpdatesPanel';
import { BackupsPanel } from '@/cloud/components/BackupsPanel';

import { formatNumber } from '@/lib/tenantFormat';
/**
 * Consola de PLATAFORMA (operador SaaS). Sólo la ve el superadmin. Header de
 * operador (icon chip + badge Superadmin), KPIs con StatTile (la primitiva
 * premium del resto de la app) y gestión por pestañas con contadores.
 *
 * La pestaña activa se lee de `?tab=` (así el panel contextual del Sidebar
 * puede linkear `/platform?tab=users`), con fallback al estado interno para
 * no romper los clicks dentro de la página; el click además persiste el
 * param (replace, sin ensuciar el historial).
 */
export function PlatformPage(): JSX.Element {
    const stats = usePlatformStats();
    const [params] = useSearchParams();
    const requested = params.get('tab');
    const tab: PlatformTabId = isPlatformTab(requested) ? requested : 'tenants';
    // v0.1.342 — en el celular `/platform` es un índice (antes, una tira de 16
    // pestañas que se deslizaba de costado) y cada sección lleva «‹ Plataforma».
    const isNarrow = useMediaQuery('(max-width: 1023px)');
    const showIndex = isNarrow && !isPlatformTab(requested);
    const current = PLATFORM_TABS.find((t) => t.id === tab);
    /** La sección que se dibuja (ninguna mientras se ve el índice del celular). */
    const shown: PlatformTabId | null = showIndex ? null : tab;
    const s = stats.data;

    const counts: Partial<Record<PlatformTabId, number | undefined>> = {
        tenants: s?.tenants_total,
        users: s?.users_total,
    };

    const statsBlock = (
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 md:imcrm-grid-cols-3 xl:imcrm-grid-cols-5">
                {stats.isLoading &&
                    Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className="imcrm-h-[104px] imcrm-animate-pulse imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-muted/40"
                        />
                    ))}
                {s && (
                    <>
                        <StatTile
                            icon={Building2}
                            label={__('Empresas')}
                            value={formatNumber(s.tenants_total)}
                            tone="blue"
                            hint={signupsHint(s.signups_last_30d, s.signups_by_source)}
                        />
                        <StatTile
                            icon={BadgeCheck}
                            label={__('Activas')}
                            value={formatNumber(s.by_status.active)}
                            tone="mint"
                            hint={
                                // v0.1.338 — pruebas vigentes y cuántas terminan pronto.
                                s.trials_active !== undefined
                                    ? `${formatNumber(s.trials_active)} ${__('en prueba')}${
                                          s.trials_ending_7d ? ` · ${formatNumber(s.trials_ending_7d)} ${__('terminan esta semana')}` : ''
                                      }`
                                    : `${s.by_status.trialing} ${__('en prueba')}`
                            }
                        />
                        <StatTile
                            icon={AlertTriangle}
                            label={__('Pausadas')}
                            value={formatNumber(s.locked_tenants ?? 0)}
                            tone="amber"
                            hint={`${formatNumber(s.read_only_tenants)} ${__('suspendidas (solo lectura)')}`}
                        />
                        <StatTile
                            icon={Users}
                            label={__('Usuarios')}
                            value={formatNumber(s.users_total)}
                            tone="violet"
                            hint={__('cuentas en total')}
                        />
                        <StatTile
                            icon={Database}
                            label={__('Registros')}
                            value={formatNumber(s.records_total)}
                            tone="cyan"
                            hint={__('en toda la plataforma')}
                        />
                    </>
                )}
            </div>
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            {isNarrow && !showIndex && <BackToIndex to="/platform" label={__('Plataforma')} className="-imcrm-mb-4" />}
            {/* Header de operador */}
            <header className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-4', isNarrow && !showIndex && 'imcrm-hidden')}>
                <span className="imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                    <ShieldCheck className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2.5">
                        <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            {__('Plataforma')}
                        </h1>
                        <Badge dot>{__('Superadmin')}</Badge>
                    </div>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Consola del operador — empresas, usuarios, planes y auditoría de soporte.')}
                    </p>
                </div>
            </header>

            {/* KPIs del negocio — v0.1.252: sólo en Empresas (antes se repetían
                arriba de CADA sección). v0.1.342: en el celular van DEBAJO del
                índice, que es lo que se viene a buscar. */}
            {!isNarrow && tab === 'tenants' && statsBlock}

            {showIndex && (
                <SectionIndex
                    testId="platform-index"
                    groups={platformTabGroups().map((g) => ({
                        label: g.label,
                        items: g.items.map((t) => ({
                            ...t,
                            to: `/platform?tab=${t.id}`,
                            count: counts[t.id] !== undefined ? formatNumber(counts[t.id]!) : null,
                        })),
                    }))}
                />
            )}
            {showIndex && statsBlock}

            {/* Celular: la sección elegida con su título y para qué sirve (en
                escritorio lo marca el panel lateral y cada tarjeta trae su título). */}
            {isNarrow && !showIndex && current && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="platform-section" data-section={tab}>
                    <h2 className="imcrm-text-lg imcrm-font-semibold imcrm-tracking-tight">{__(current.label)}</h2>
                    <p className="imcrm-text-[13px] imcrm-text-muted-foreground">{__(current.hint)}</p>
                </div>
            )}

            {shown === 'tenants' && <PlatformTenantsCard />}
            {shown === 'users' && <PlatformUsersCard />}
            {shown === 'plans' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <PlatformBillingPolicyCard />
                    <PlatformPlansCard />
                </div>
            )}
            {shown === 'audit' && <PlatformImpersonationsCard />}
            {shown === 'novedades' && <PlatformWhatsNewCard />}
            {shown === 'marca' && <PlatformBrandCard />}
            {/* Ajustes GLOBALES de la app (antes vivían en Ajustes del workspace). */}
            {shown === 'correo' && <SmtpSettingsPanel />}
            {shown === 'diagnostico' && <PlatformDiagnosticsCard />}
            {shown === 'dominios' && <PlatformDomainsCard />}
            {shown === 'cobros' && <PlatformPaymentsCard />}
            {shown === 'ai' && <PlatformAiCard />}
            {shown === 'integraciones' && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
                    <PlatformIntegrationsCard />
                    {/* v0.1.289 — llaves de captcha para los formularios de todas las empresas. */}
                    <CaptchaKeysCard scope="platform" />
                </div>
            )}
            {shown === 'ayuda' && <PlatformHelpCard />}
            {shown === 'updates' && <SystemUpdatesPanel />}
            {shown === 'backups' && <BackupsPanel />}
            {shown === 'transfers' && <PlatformTransfersCard />}
        </div>
    );
}

/**
 * v0.1.331 — «12 nuevas en 30 días · sitio 7, google 3, directo 2»: de dónde
 * vinieron las altas (las etiquetas que trae el enlace del sitio del producto).
 */
function signupsHint(total: number, bySource: ReadonlyArray<{ source: string; count: number }> | undefined): string {
    const head = `${total} ${__('nuevas en 30 días')}`;
    if (!bySource || bySource.length === 0 || total === 0) return head;
    const top = bySource.slice(0, 3).map((b) => `${b.source} ${b.count}`);
    return `${head} · ${top.join(', ')}${bySource.length > 3 ? '…' : ''}`;
}
