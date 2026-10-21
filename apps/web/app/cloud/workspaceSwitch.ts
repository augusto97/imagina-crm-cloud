import type { QueryClient } from '@tanstack/react-query';
import type { MembershipSummary } from '@imagina-base/shared';

import { hydrateAdminBoot } from '@/cloud/adminBoot';
import { useSession } from '@/cloud/session';

/**
 * Cambio de empresa (workspace) — v0.1.286.
 *
 * Hasta ahora `setActiveTenant` existía pero nadie lo llamaba: quien era
 * miembro de dos empresas no tenía forma de abrir la segunda.
 *
 * Orden importa:
 *  1. el store cambia el tenant activo (el cliente API lo lee en cada
 *     request) — con dominio white-label el cambio se rechaza;
 *  2. el boot del admin se re-hidrata con el ROL de la nueva empresa ANTES de
 *     que React vuelva a pintar (las capabilities no son reactivas);
 *  3. se tira el cache de datos (es de la empresa anterior) salvo la sesión;
 *  4. a `/lists`: la ruta actual (una lista, un tablero) no existe en la otra.
 * `AdminCloudApp` además remonta el árbol de la app por tenant (key), así nada
 * queda con estado de la empresa anterior.
 */
export function switchWorkspace(tenantId: number, qc: QueryClient): boolean {
    const before = useSession.getState();
    if (before.activeTenantId === tenantId || before.user === null) return false;
    const membership = before.memberships.find((m) => m.tenant_id === tenantId);
    if (!membership) return false;
    before.setActiveTenant(tenantId);
    if (useSession.getState().activeTenantId !== tenantId) return false; // dominio bloqueado
    hydrateAdminBoot(before.user, membership);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    window.location.hash = '#/lists';
    return true;
}

/** Empresas entre las que la persona puede moverse y la actual. */
export function useWorkspaces(): {
    memberships: MembershipSummary[];
    active: MembershipSummary | null;
    /** Entró por el dominio propio de una empresa: queda fijado a ella. */
    locked: boolean;
} {
    const memberships = useSession((s) => s.memberships);
    const activeTenantId = useSession((s) => s.activeTenantId);
    const domainTenant = useSession((s) => s.domainTenant);
    const active = memberships.find((m) => m.tenant_id === activeTenantId) ?? null;
    const locked = domainTenant !== null && memberships.some((m) => m.tenant_id === domainTenant.id);
    return { memberships, active, locked };
}

/** Rol con las mismas etiquetas del panel de Miembros (`ROLE_LABELS`). */
export function roleLabel(role: MembershipSummary['role']): string {
    switch (role) {
        case 'admin':
            return 'Admin';
        case 'manager':
            return 'Manager';
        case 'agent':
            return 'Agente';
        case 'viewer':
            return 'Lector';
        default:
            return 'Cliente (portal)';
    }
}
