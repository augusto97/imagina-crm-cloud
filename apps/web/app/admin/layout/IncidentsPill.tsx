import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { useIncidents } from '@/hooks/useNotifications';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';

/**
 * v0.1.285 (ADR-S44) — «N problemas» en la barra superior mientras algo que
 * corre solo esté fallando. Es lo que faltaba: la campana avisa una vez, esto
 * queda a la vista hasta que se arregla. Sólo para quien puede arreglarlo
 * (admins y quien arma automatizaciones); sin problemas, no ocupa lugar.
 */
export function IncidentsPill(): JSX.Element | null {
    const isAdmin = useSession((s) => s.memberships.find((m) => m.tenant_id === s.activeTenantId)?.role === 'admin');
    const canManageAutomations = useCan(CAP.MANAGE_AUTOMATIONS);
    const q = useIncidents('open', isAdmin || canManageAutomations);
    const open = q.data?.open ?? 0;
    if (open === 0) return null;
    const label = open === 1 ? __('1 problema') : sprintf(__('%d problemas'), open);
    return (
        <Link
            to="/settings?s=problemas"
            data-testid="incidents-pill"
            title={__('Algo dejó de funcionar: abre los problemas para ver qué y cómo arreglarlo')}
            aria-label={label}
            // v0.1.286 — en el teléfono, compacta (icono + número): la barra
            // no alcanzaba y se comía el nombre de la empresa. El texto usa la
            // tinta del rojo (≥4.5:1 sobre el tinte, en claro y en oscuro).
            className="imcrm-inline-flex imcrm-h-7 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-1.5 imcrm-text-xs imcrm-font-semibold imcrm-text-destructive hover:imcrm-bg-destructive/15 sm:imcrm-h-8 sm:imcrm-gap-1.5 sm:imcrm-px-2.5"
        >
            <TriangleAlert className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            <span className="imcrm-hidden sm:imcrm-inline" aria-hidden>{label}</span>
            <span className="imcrm-tabular-nums sm:imcrm-hidden" aria-hidden>{open}</span>
        </Link>
    );
}
