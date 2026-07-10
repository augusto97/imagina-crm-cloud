import { useMemo, useState } from 'react';
import { Building2, CreditCard, History, Loader2, ShieldAlert, Users } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { usePlatformStats } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { PlatformImpersonationsCard } from './PlatformImpersonationsCard';
import { PlatformPlansCard } from './PlatformPlansCard';
import { PlatformTenantsCard } from './PlatformTenantsCard';
import { PlatformUsersCard } from './PlatformUsersCard';

type Tab = 'tenants' | 'users' | 'plans' | 'audit';

const TABS: Array<{ id: Tab; label: string; icon: typeof Building2 }> = [
    { id: 'tenants', label: __('Empresas'), icon: Building2 },
    { id: 'users', label: __('Usuarios'), icon: Users },
    { id: 'plans', label: __('Planes'), icon: CreditCard },
    { id: 'audit', label: __('Auditoría'), icon: History },
];

/**
 * Consola de PLATAFORMA (operador SaaS). Sólo la ve el superadmin. Da la foto
 * del negocio (KPIs) + gestión por secciones en pestañas (Empresas / Usuarios /
 * Planes / Auditoría) para no apilar todo en una sola página larga.
 */
export function PlatformPage(): JSX.Element {
    const stats = usePlatformStats();
    const [tab, setTab] = useState<Tab>('tenants');

    const cards = useMemo(() => {
        const s = stats.data;
        if (!s) return [];
        return [
            { label: __('Empresas'), value: s.tenants_total, hint: `${s.signups_last_30d} ${__('nuevas (30d)')}` },
            { label: __('Activas'), value: s.by_status.active, hint: `${s.by_status.trialing} ${__('en prueba')}` },
            { label: __('Impagas'), value: s.read_only_tenants, hint: __('solo-lectura') },
            { label: __('Usuarios'), value: s.users_total, hint: '' },
            { label: __('Registros'), value: s.records_total, hint: __('en toda la plataforma') },
        ];
    }, [stats.data]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <ShieldAlert className="imcrm-h-5 imcrm-w-5 imcrm-text-primary" />
                    <h1 className="imcrm-text-2xl imcrm-font-semibold imcrm-tracking-tight">{__('Plataforma')}</h1>
                </div>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Consola del operador: gestioná empresas, usuarios, planes y auditoría de soporte.')}
                </p>
            </header>

            {/* Dashboard del operador (KPIs) */}
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 sm:imcrm-grid-cols-3 lg:imcrm-grid-cols-5">
                {stats.isLoading &&
                    Array.from({ length: 5 }).map((_, i) => (
                        <Card key={i}>
                            <CardContent className="imcrm-py-6 imcrm-text-center imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-mx-auto imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            </CardContent>
                        </Card>
                    ))}
                {cards.map((c) => (
                    <Card key={c.label}>
                        <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-py-4">
                            <span className="imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                {c.label}
                            </span>
                            <span className="imcrm-text-2xl imcrm-font-semibold imcrm-tabular-nums">
                                {c.value.toLocaleString()}
                            </span>
                            {c.hint && <span className="imcrm-text-xs imcrm-text-muted-foreground">{c.hint}</span>}
                        </CardContent>
                    </Card>
                ))}
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
                                    ? 'imcrm-border-primary imcrm-text-primary'
                                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            <Icon className="imcrm-h-4 imcrm-w-4" />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'tenants' && <PlatformTenantsCard />}
            {tab === 'users' && <PlatformUsersCard />}
            {tab === 'plans' && <PlatformPlansCard />}
            {tab === 'audit' && <PlatformImpersonationsCard />}
        </div>
    );
}
