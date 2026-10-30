import { Link } from 'react-router';
import { Lock } from 'lucide-react';
import { PLAN_MODULE_CATALOG, readDisabledModules, type PlanModule } from '@imagina-base/shared';

import { activeMembership, useSession } from '@/cloud/session';
import { __ } from '@/lib/i18n';

/**
 * v0.1.338 (ADR-S87) — ¿El plan de la empresa activa NO incluye este módulo?
 * Sale de la membresía de `/auth/me`: no pide nada. El servidor igual lo
 * rechaza (403 `plan_module_disabled`); esto sólo evita mostrar algo que no va
 * a funcionar.
 */
export function usePlanModuleOff(module: PlanModule): boolean {
    return useSession((s) => {
        const m = s.memberships.find((x) => x.tenant_id === s.activeTenantId);
        return readDisabledModules(m?.disabled_modules ?? []).includes(module);
    });
}

/** Lo mismo, fuera de React (callbacks, helpers). */
export function planModuleOff(module: PlanModule): boolean {
    return readDisabledModules(activeMembership()?.disabled_modules ?? []).includes(module);
}

/**
 * El aviso que reemplaza a una sección que el plan no incluye: qué es, que
 * lo configurado no se perdió y cómo conseguirlo (admin → elegir plan).
 */
export function PlanModuleNotice({ module, compact = false }: { module: PlanModule; compact?: boolean }): JSX.Element {
    const info = PLAN_MODULE_CATALOG.find((m) => m.key === module);
    const admin = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin');
    return (
        <div
            className={
                compact
                    ? 'imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm'
                    : 'imcrm-mx-auto imcrm-flex imcrm-max-w-xl imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-8 imcrm-text-center imcrm-shadow-sm'
            }
            data-testid="plan-module-notice"
            data-module={module}
        >
            <span
                className={
                    compact
                        ? 'imcrm-mt-0.5 imcrm-text-muted-foreground'
                        : 'imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground'
                }
            >
                <Lock className={compact ? 'imcrm-h-4 imcrm-w-4' : 'imcrm-h-5 imcrm-w-5'} aria-hidden />
            </span>
            <div className={compact ? 'imcrm-min-w-0 imcrm-flex-1' : 'imcrm-flex imcrm-flex-col imcrm-gap-1'}>
                <p className="imcrm-font-semibold">
                    {__('Tu plan no incluye')} «{info?.label ?? module}»
                </p>
                <p className="imcrm-text-muted-foreground">
                    {info?.description}{' '}
                    {__('Si ya lo tenías configurado, no se borró: vuelve tal cual al pasar a un plan que lo incluya.')}
                </p>
                {!admin && compact && (
                    <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">{__('Pídele a un administrador que elija un plan que lo incluya.')}</p>
                )}
            </div>
            {admin ? (
                <Link
                    to="/settings?s=suscripcion"
                    className="imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-rounded-md imcrm-bg-primary imcrm-px-3 imcrm-py-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90"
                    data-testid="plan-module-notice-plans"
                >
                    {__('Ver planes')}
                </Link>
            ) : (
                !compact && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Pídele a un administrador que elija un plan que lo incluya.')}</p>
            )}
        </div>
    );
}

/** Envuelve una sección: si el plan no la incluye, muestra el aviso en su lugar. */
export function PlanModuleGate({
    module,
    compact = false,
    children,
}: {
    module: PlanModule;
    compact?: boolean;
    children: React.ReactNode;
}): JSX.Element {
    const off = usePlanModuleOff(module);
    return off ? <PlanModuleNotice module={module} compact={compact} /> : <>{children}</>;
}
