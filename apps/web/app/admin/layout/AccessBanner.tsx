import { Link } from 'react-router';
import { Clock, Lock } from 'lucide-react';
import { daysLeft } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { __ } from '@/lib/i18n';
import { formatDate } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * v0.1.338 (ADR-S87) — El acceso de la empresa, a la vista:
 * - en PRUEBA con fecha de fin: cuántos días quedan (a los admins, con
 *   «Elegir plan»; en los últimos 3 días se marca en ámbar);
 * - en SOLO LECTURA (prueba o plan vencidos con esa política, o suspendida):
 *   por qué y qué hacer.
 * La pausada no llega aquí: se muestra otra pantalla en vez de la app.
 * Sale de `/auth/me` (la membresía trae el acceso): no pide nada.
 */
export function AccessBanner(): JSX.Element | null {
    const membership = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId) ?? null);
    const impersonating = useSession((s) => s.impersonating);
    const access = membership?.access;
    if (!membership || !access || impersonating) return null;
    const admin = membership.role === 'admin';

    if (access.state === 'read_only') {
        const why =
            access.reason === 'trial_ended'
                ? __('Terminó la prueba: la empresa está en solo lectura.')
                : access.reason === 'plan_expired'
                  ? __('Venció el plan: la empresa está en solo lectura.')
                  : access.reason === 'archived'
                    ? __('La empresa está archivada: sólo se puede ver.')
                    : __('La empresa está en solo lectura por su estado de pago.');
        return (
            <Bar tone="bad" testId="access-banner-read-only">
                <Lock className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" aria-hidden />
                <p className="imcrm-min-w-0 imcrm-flex-1">
                    <span className="imcrm-font-medium">{why}</span>{' '}
                    <span className="imcrm-text-muted-foreground">
                        {admin ? __('Puedes ver y descargar todo; para volver a editar, elige un plan.') : __('Pídele a un administrador que elija un plan.')}
                    </span>
                </p>
                {admin && access.reason !== 'archived' && <PlanLink />}
            </Bar>
        );
    }

    if (access.trial && access.ends_at && admin) {
        const left = daysLeft(access.ends_at) ?? 0;
        const soon = left <= 3;
        return (
            <Bar tone={soon ? 'warn' : 'info'} testId="access-banner-trial">
                <Clock className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', soon ? 'imcrm-text-warning' : 'imcrm-text-muted-foreground')} aria-hidden />
                <p className="imcrm-min-w-0 imcrm-flex-1">
                    <span className="imcrm-font-medium" data-testid="access-banner-days">
                        {left === 0 ? __('Tu prueba termina hoy.') : left === 1 ? __('Te queda 1 día de prueba.') : `${__('Te quedan')} ${left} ${__('días de prueba.')}`}
                    </span>{' '}
                    <span className="imcrm-text-muted-foreground">
                        {`${__('Termina el')} ${formatDate(new Date(access.ends_at))}. ${__('Elige un plan para seguir sin interrupciones.')}`}
                    </span>
                </p>
                <PlanLink />
            </Bar>
        );
    }
    return null;
}

function Bar({ tone, testId, children }: { tone: 'info' | 'warn' | 'bad'; testId: string; children: React.ReactNode }): JSX.Element {
    return (
        <div
            role="status"
            data-testid={testId}
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-border-b imcrm-px-3 imcrm-py-2 imcrm-text-sm sm:imcrm-px-4',
                tone === 'bad' && 'imcrm-border-destructive/30 imcrm-bg-destructive/10',
                tone === 'warn' && 'imcrm-border-warning/30 imcrm-bg-warning/10',
                tone === 'info' && 'imcrm-border-border imcrm-bg-muted/40',
            )}
        >
            {children}
        </div>
    );
}

function PlanLink(): JSX.Element {
    return (
        <Link
            to="/settings?s=suscripcion"
            data-testid="access-banner-plan"
            className="imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-rounded-md imcrm-bg-primary imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90"
        >
            {__('Elegir plan')}
        </Link>
    );
}
