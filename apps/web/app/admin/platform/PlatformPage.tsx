import { useMemo } from 'react';
import { Building2, Loader2, ShieldAlert } from 'lucide-react';
import {
    BILLING_STATUSES,
    PLANS,
    type BillingStatus,
    type Plan,
    type PlatformTenant,
} from '@imagina-base/shared';

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { usePlatformStats, usePlatformTenants, useUpdateTenant } from '@/hooks/usePlatform';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const PLAN_LABEL: Record<Plan, string> = {
    trial: __('Trial'),
    starter: __('Starter'),
    pro: __('Pro'),
    enterprise: __('Enterprise'),
};

const STATUS_LABEL: Record<BillingStatus, string> = {
    trialing: __('En prueba'),
    active: __('Activa'),
    past_due: __('Impaga'),
    canceled: __('Cancelada'),
};

const STATUS_TONE: Record<BillingStatus, string> = {
    trialing: 'imcrm-bg-blue-500/10 imcrm-text-blue-600 dark:imcrm-text-blue-400',
    active: 'imcrm-bg-emerald-500/10 imcrm-text-emerald-600 dark:imcrm-text-emerald-400',
    past_due: 'imcrm-bg-amber-500/10 imcrm-text-amber-600 dark:imcrm-text-amber-400',
    canceled: 'imcrm-bg-red-500/10 imcrm-text-red-600 dark:imcrm-text-red-400',
};

/**
 * Consola de PLATAFORMA (operador SaaS). Sólo la ve el superadmin (la ruta se
 * muestra en el sidebar tras probar el endpoint). Da la foto del negocio +
 * gestión de cada empresa (plan / suspender-reactivar).
 */
export function PlatformPage(): JSX.Element {
    const stats = usePlatformStats();
    const tenants = usePlatformTenants();
    const update = useUpdateTenant();

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

    const setPlan = (t: PlatformTenant, plan: Plan): void => {
        if (plan !== t.plan) update.mutate({ id: t.id, input: { plan } });
    };
    const setStatus = (t: PlatformTenant, status: BillingStatus): void => {
        if (status !== t.status) update.mutate({ id: t.id, input: { status } });
    };

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

            {/* Empresas */}
            <Card>
                <CardHeader>
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <Building2 className="imcrm-mt-0.5 imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                        <div>
                            <CardTitle>{__('Empresas (clientes)')}</CardTitle>
                            <CardDescription>
                                {__('Cada fila es un workspace. Cambiar el estado a "Impaga/Cancelada" deja la cuenta en solo-lectura (los datos nunca se secuestran).')}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {tenants.isLoading ? (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                            {__('Cargando empresas…')}
                        </div>
                    ) : tenants.isError ? (
                        <p className="imcrm-py-6 imcrm-text-sm imcrm-text-destructive">
                            {__('No se pudieron cargar las empresas.')}
                        </p>
                    ) : (
                        <div className="imcrm-overflow-x-auto">
                            <table className="imcrm-w-full imcrm-border-collapse imcrm-text-sm">
                                <thead>
                                    <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-xs imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                                        <th className="imcrm-py-2 imcrm-pr-3 imcrm-font-medium">{__('Empresa')}</th>
                                        <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Owner')}</th>
                                        <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Plan')}</th>
                                        <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Estado')}</th>
                                        <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-right">{__('Uso')}</th>
                                        <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Alta')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(tenants.data ?? []).map((t) => (
                                        <tr
                                            key={t.id}
                                            className="imcrm-border-b imcrm-border-border/60 last:imcrm-border-b-0"
                                        >
                                            <td className="imcrm-py-3 imcrm-pr-3">
                                                <div className="imcrm-font-medium imcrm-text-foreground">{t.name}</div>
                                                <div className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">{t.slug}</div>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-muted-foreground">
                                                {t.owner ? t.owner.email : <span className="imcrm-italic">{__('— sin admin —')}</span>}
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3">
                                                <select
                                                    className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                                    value={t.plan}
                                                    disabled={update.isPending}
                                                    onChange={(e) => setPlan(t, e.target.value as Plan)}
                                                    aria-label={`${__('Plan de')} ${t.name}`}
                                                >
                                                    {PLANS.map((p) => (
                                                        <option key={p} value={p}>{PLAN_LABEL[p]}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3">
                                                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                                                    <span
                                                        className={cn(
                                                            'imcrm-inline-flex imcrm-shrink-0 imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium',
                                                            STATUS_TONE[t.status],
                                                        )}
                                                    >
                                                        {STATUS_LABEL[t.status]}
                                                    </span>
                                                    <select
                                                        className="imcrm-h-8 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                                        value={t.status}
                                                        disabled={update.isPending}
                                                        onChange={(e) => setStatus(t, e.target.value as BillingStatus)}
                                                        aria-label={`${__('Estado de')} ${t.name}`}
                                                    >
                                                        {BILLING_STATUSES.map((s) => (
                                                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-right imcrm-tabular-nums imcrm-text-muted-foreground">
                                                <span title={__('Registros / Usuarios / Automatizaciones')}>
                                                    {t.usage.records.toLocaleString()} · {t.usage.users} · {t.usage.automations}
                                                </span>
                                            </td>
                                            <td className="imcrm-px-2 imcrm-py-3 imcrm-text-muted-foreground imcrm-whitespace-nowrap">
                                                {new Date(t.created_at).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {update.isError && (
                        <p className="imcrm-mt-3 imcrm-text-sm imcrm-text-destructive">
                            {__('No se pudo aplicar el cambio.')}
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
