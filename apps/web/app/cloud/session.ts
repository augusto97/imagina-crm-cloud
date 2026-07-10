import type { AuthSession, MembershipSummary, SessionUser } from '@imagina-base/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CloudClient } from '@/lib/cloud/client';

/**
 * Estado de sesión del shell cloud: usuario, workspaces (memberships) y el
 * tenant activo. El `tenant_id` activo se persiste en localStorage para
 * reabrir el mismo workspace; la sesión en sí vive en la cookie httpOnly.
 */
interface SessionState {
    user: SessionUser | null;
    memberships: MembershipSummary[];
    activeTenantId: number | null;
    ready: boolean;
    /** Si la sesión es de impersonación (ADR-S15 F5): datos del operador. */
    impersonating: AuthSession['impersonating'];
    setSession: (session: AuthSession) => void;
    setActiveTenant: (tenantId: number) => void;
    clear: () => void;
    markReady: () => void;
}

export const useSession = create<SessionState>()(
    persist(
        (set, get) => ({
            user: null,
            memberships: [],
            activeTenantId: null,
            ready: false,
            impersonating: undefined,
            setSession: (session) =>
                set({
                    user: session.user,
                    memberships: session.memberships,
                    impersonating: session.impersonating,
                    activeTenantId:
                        get().activeTenantId &&
                        session.memberships.some((m) => m.tenant_id === get().activeTenantId)
                            ? get().activeTenantId
                            : (session.memberships[0]?.tenant_id ?? null),
                }),
            setActiveTenant: (tenantId) => set({ activeTenantId: tenantId }),
            clear: () => set({ user: null, memberships: [], activeTenantId: null, impersonating: undefined }),
            markReady: () => set({ ready: true }),
        }),
        {
            name: 'imagina-base-session',
            partialize: (s) => ({ activeTenantId: s.activeTenantId }),
        },
    ),
);

/** Cliente API que toma el tenant activo del store en cada request. */
export const api = new CloudClient({
    getTenantId: () => useSession.getState().activeTenantId,
});

export function activeMembership(): MembershipSummary | null {
    const { memberships, activeTenantId } = useSession.getState();
    return memberships.find((m) => m.tenant_id === activeTenantId) ?? null;
}
