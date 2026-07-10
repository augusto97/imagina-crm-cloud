import { useMemo } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { usePlatformStats } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';

import { PlatformPlansCard } from './PlatformPlansCard';
import { PlatformTenantsCard } from './PlatformTenantsCard';
import { PlatformUsersCard } from './PlatformUsersCard';

/**
 * Consola de PLATAFORMA (operador SaaS). Sólo la ve el superadmin (la ruta se
 * muestra en el sidebar tras probar el endpoint). Da la foto del negocio +
 * gestión de cada empresa (plan / suspender-reactivar).
 */
export function PlatformPage(): JSX.Element {
    const stats = usePlatformStats();

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
                    {__('Consola del operador: todas las empresas, su plan, estado y uso. Cambiá el plan o suspendé/reactivá cuentas.')}
                </p>
            </header>

            {/* Dashboard del operador */}
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

            {/* Empresas (grilla + alta + detalle) */}
            <PlatformTenantsCard />

            {/* Planes */}
            <PlatformPlansCard />

            {/* Usuarios de la plataforma */}
            <PlatformUsersCard />
        </div>
    );
}
