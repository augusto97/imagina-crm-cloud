import type { MembershipSummary, SessionUser } from '@imagina-base/shared';
import { setBootData } from '@/lib/boot';
import { CAP } from '@/lib/permissions';

/**
 * Puente sesión-nube → boot del admin. La UI real (`app/admin`) gatea
 * afordancias por `boot.user.capabilities` (mapa `imcrm_*`). En la nube el
 * backend NestJS enforcea los permisos reales por rol en cada request
 * (guards); acá sintetizamos el mapa desde el rol del membership SOLO para
 * mostrar/ocultar controles. Un rol admin ve todo; el resto, un subconjunto.
 */
const ALL_CAPS = Object.values(CAP);

function capsForRole(role: MembershipSummary['role']): Record<string, boolean> {
    const caps: Record<string, boolean> = {};
    const grant = (list: readonly string[]): void => {
        for (const c of list) caps[c] = true;
    };
    switch (role) {
        case 'admin':
        case 'manager':
            grant(ALL_CAPS);
            caps.workspace_admin = true;
            break;
        case 'agent':
            grant([
                CAP.ACCESS_ADMIN,
                CAP.VIEW_RECORDS,
                CAP.VIEW_OWN_RECORDS,
                CAP.CREATE_RECORDS,
                CAP.EDIT_RECORDS,
                CAP.EDIT_OWN_RECORDS,
                CAP.DELETE_OWN_RECORDS,
                CAP.IMPORT_RECORDS,
                CAP.EXPORT_RECORDS,
                CAP.BULK_ACTIONS,
                CAP.ACCESS_PORTAL,
            ]);
            break;
        case 'viewer':
            grant([CAP.ACCESS_ADMIN, CAP.VIEW_RECORDS, CAP.EXPORT_RECORDS]);
            break;
        case 'client':
            grant([CAP.ACCESS_PORTAL]);
            break;
    }
    return caps;
}

export function hydrateAdminBoot(user: SessionUser, membership: MembershipSummary | null): void {
    setBootData({
        restRoot: '/api/v1',
        tenantId: membership?.tenant_id ?? null,
        user: {
            id: user.id,
            displayName: user.name || user.email,
            avatar: '',
            capabilities: membership ? capsForRole(membership.role) : {},
        },
    });
}
