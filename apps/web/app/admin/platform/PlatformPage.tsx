import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    BadgeCheck,
    Building2,
    Database,
    ShieldCheck,
    Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { StatTile } from '@/components/ui/stat-tile';
import { usePlatformStats } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { isPlatformTab, PLATFORM_TABS, type PlatformTabId } from './platformTabs';
import { PlatformImpersonationsCard } from './PlatformImpersonationsCard';
import { PlatformPlansCard } from './PlatformPlansCard';
import { PlatformTenantsCard } from './PlatformTenantsCard';
import { PlatformUsersCard } from './PlatformUsersCard';
import { SmtpSettingsPanel } from '@/cloud/components/SmtpSettingsPanel';
import { SystemUpdatesPanel } from '@/cloud/components/SystemUpdatesPanel';

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
    const [params, setParams] = useSearchParams();
    const [fallbackTab, setFallbackTab] = useState<PlatformTabId>('tenants');
    const requested = params.get('tab');
    const tab: PlatformTabId = isPlatformTab(requested) ? requested : fallbackTab;
    const setTab = (id: PlatformTabId): void => {
        setFallbackTab(id);
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.set('tab', id);
                return next;
            },
            { replace: true },
        );
    };
    const s = stats.data;

    const counts: Partial<Record<PlatformTabId, number | undefined>> = {
        tenants: s?.tenants_total,
        users: s?.users_total,
    };
    const TABS = PLATFORM_TABS.map((t) => ({ ...t, label: __(t.label), count: counts[t.id] }));

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            {/* Header de operador */}
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-4">
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

            {/* KPIs del negocio */}
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
                            value={s.tenants_total.toLocaleString()}
                            tone="blue"
                            hint={`${s.signups_last_30d} ${__('nuevas en 30 días')}`}
                        />
                        <StatTile
                            icon={BadgeCheck}
                            label={__('Activas')}
                            value={s.by_status.active.toLocaleString()}
                            tone="mint"
                            hint={`${s.by_status.trialing} ${__('en prueba')}`}
                        />
                        <StatTile
                            icon={AlertTriangle}
                            label={__('Impagas')}
                            value={s.read_only_tenants.toLocaleString()}
                            tone="amber"
                            hint={__('en solo-lectura')}
                        />
                        <StatTile
                            icon={Users}
                            label={__('Usuarios')}
                            value={s.users_total.toLocaleString()}
                            tone="violet"
                            hint={__('cuentas en total')}
                        />
                        <StatTile
                            icon={Database}
                            label={__('Registros')}
                            value={s.records_total.toLocaleString()}
                            tone="cyan"
                            hint={__('en toda la plataforma')}
                        />
                    </>
                )}
            </div>

            {/* Pestañas de gestión */}
            <div
                role="tablist"
                aria-label={__('Secciones de la consola')}
                className="imcrm-flex imcrm-flex-wrap imcrm-gap-1 imcrm-border-b imcrm-border-border"
            >
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(t.id)}
                            className={cn(
                                'imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-font-medium imcrm-transition-colors',
                                active
                                    ? 'imcrm-border-primary imcrm-text-foreground'
                                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            <Icon className={cn('imcrm-h-4 imcrm-w-4', active && 'imcrm-text-primary')} aria-hidden />
                            {t.label}
                            {t.count !== undefined && (
                                <span
                                    className={cn(
                                        'imcrm-rounded-full imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-tabular-nums imcrm-leading-none',
                                        active
                                            ? 'imcrm-bg-primary/10 imcrm-text-primary'
                                            : 'imcrm-bg-muted imcrm-text-muted-foreground',
                                    )}
                                >
                                    {t.count.toLocaleString()}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {tab === 'tenants' && <PlatformTenantsCard />}
            {tab === 'users' && <PlatformUsersCard />}
            {tab === 'plans' && <PlatformPlansCard />}
            {tab === 'audit' && <PlatformImpersonationsCard />}
            {/* Ajustes GLOBALES de la app (antes vivían en Ajustes del workspace). */}
            {tab === 'correo' && <SmtpSettingsPanel />}
            {tab === 'updates' && <SystemUpdatesPanel />}
        </div>
    );
}
