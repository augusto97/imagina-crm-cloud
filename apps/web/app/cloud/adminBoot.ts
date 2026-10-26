import type { MembershipSummary, SessionUser } from '@imagina-base/shared';
import { setBootData } from '@/lib/boot';
import { CAP } from '@/lib/permissions';

/**
 * Puente sesión-nube → boot del admin. La UI real (`app/admin`) gatea
 * afordancias por `boot.user.capabilities` (mapa `imcrm_*`). En la nube el
 * backend NestJS enforcea los permisos reales por rol en cada request
 * (guards); aquí sintetizamos el mapa desde el rol del membership SOLO para
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
            grant(ALL_CAPS);
            caps.workspace_admin = true;
            break;
        case 'manager':
            // C1 — los equipos los arma el admin (o quien tiene el permiso).
            grant(ALL_CAPS.filter((c) => c !== CAP.MANAGE_TEAMS));
            caps.workspace_admin = true;
            break;
        case 'agent':
            grant([
                CAP.ACCESS_ADMIN,
                // C2 — ver tableros y usar el asistente: lo tenía todo el equipo.
                CAP.VIEW_DASHBOARDS,
                CAP.USE_AI_ASSISTANT,
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
            grant([CAP.ACCESS_ADMIN, CAP.VIEW_RECORDS, CAP.EXPORT_RECORDS, CAP.VIEW_DASHBOARDS, CAP.USE_AI_ASSISTANT]);
            break;
        case 'guest':
            // C3 — invitado de afuera: sólo lo que le compartieron (el
            // servidor decide fila por fila; aquí sólo se ocultan controles).
            grant([CAP.ACCESS_ADMIN, CAP.VIEW_OWN_RECORDS, CAP.CREATE_RECORDS, CAP.EDIT_OWN_RECORDS]);
            caps.guest = true;
            break;
        case 'client':
            grant([CAP.ACCESS_PORTAL]);
            break;
    }
    return caps;
}

/**
 * C2 — Con un rol PROPIO, el mapa sale de las capacidades efectivas que
 * resolvió el servidor (las mismas que aplica en cada request). Sin rol
 * propio, el mapa de siempre del rol base (sin cambios).
 */
export function capsForMembership(membership: MembershipSummary): Record<string, boolean> {
    if (!membership.custom_role_id || !membership.capabilities) return capsForRole(membership.role);
    const caps: Record<string, boolean> = {};
    for (const c of membership.capabilities) caps[`imcrm_${c}`] = true;
    // El base manager mira «como admin» las vistas y el tiempo del equipo.
    if (membership.role === 'manager') caps.workspace_admin = true;
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
            capabilities: membership ? capsForMembership(membership) : {},
        },
    });
}
