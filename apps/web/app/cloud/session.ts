import { parsePlatformBrand, type AuthSession, type MembershipSummary, type PlatformBrand, type PublicBoot, type SessionUser } from '@imagina-base/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CloudClient } from '@/lib/cloud/client';

/**
 * Estado de sesión del shell cloud: usuario, workspaces (memberships) y el
 * tenant activo. El `tenant_id` activo se persiste en localStorage para
 * reabrir el mismo workspace; la sesión en sí vive en la cookie httpOnly.
 */

/** Marca del tenant dueño del dominio white-label (ADR-S17, `GET /public/boot`). */
export type DomainTenant = NonNullable<PublicBoot['tenant']>;

interface SessionState {
    user: SessionUser | null;
    memberships: MembershipSummary[];
    activeTenantId: number | null;
    ready: boolean;
    /** Si la sesión es de impersonación (ADR-S15 F5): datos del operador. */
    impersonating: AuthSession['impersonating'];
    /**
     * Tenant dueño del dominio por el que se entró (ADR-S17). NO se persiste:
     * se recalcula en cada boot vía `GET /public/boot` (el Host manda). Con
     * membership de esa empresa, el workspace activo queda FIJADO a ella
     * (dominio = una empresa; el switcher no ofrece otras).
     */
    domainTenant: DomainTenant | null;
    /**
     * v0.1.327 — la marca de la plataforma (Plataforma → Marca), del mismo
     * `GET /public/boot`. Arranca con la de fábrica (sólo el nombre).
     */
    platformBrand: PlatformBrand;
    /**
     * Superadmin de plataforma con la consola utilizable (`/auth/me` →
     * `is_superadmin`). Antes se averiguaba sondeando `/platform/stats`.
     */
    isSuperadmin: boolean;
    /** Superadmin con una sesión vieja (sin contraseña): hay que reingresar. */
    platformReauth: boolean;
    setSession: (session: AuthSession) => void;
    setActiveTenant: (tenantId: number) => void;
    setDomainTenant: (tenant: DomainTenant | null) => void;
    setPlatformBrand: (brand: PlatformBrand) => void;
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
            domainTenant: null,
            platformBrand: parsePlatformBrand({}),
            isSuperadmin: false,
            platformReauth: false,
            setSession: (session) => {
                const isMember = (id: number | null): boolean =>
                    id !== null && session.memberships.some((m) => m.tenant_id === id);
                // Dominio white-label: si el usuario es miembro de ESA empresa,
                // el workspace queda fijado a ella. Sin membership → flujo normal.
                const domainId = get().domainTenant?.id ?? null;
                const lockedId = isMember(domainId) ? domainId : null;
                const prevId = get().activeTenantId;
                set({
                    user: session.user,
                    memberships: session.memberships,
                    impersonating: session.impersonating,
                    isSuperadmin: session.is_superadmin === true,
                    platformReauth: session.platform_reauth === true,
                    activeTenantId:
                        lockedId ??
                        (isMember(prevId) ? prevId : (session.memberships[0]?.tenant_id ?? null)),
                });
            },
            setActiveTenant: (tenantId) => {
                // Con dominio white-label + membership de esa empresa, el tenant
                // activo está bloqueado: no se puede cambiar a otro workspace.
                const { domainTenant, memberships } = get();
                if (
                    domainTenant !== null &&
                    tenantId !== domainTenant.id &&
                    memberships.some((m) => m.tenant_id === domainTenant.id)
                ) {
                    return;
                }
                set({ activeTenantId: tenantId });
            },
            setDomainTenant: (tenant) => {
                // Puede llegar ANTES o DESPUÉS de `setSession` (corren en
                // paralelo en el boot): si la sesión ya está hidratada y hay
                // membership del tenant del dominio, fijamos el workspace aquí.
                const { user, memberships } = get();
                const member =
                    tenant !== null &&
                    user !== null &&
                    memberships.some((m) => m.tenant_id === tenant.id);
                set(
                    member
                        ? { domainTenant: tenant, activeTenantId: tenant.id }
                        : { domainTenant: tenant },
                );
            },
            setPlatformBrand: (brand) => set({ platformBrand: brand }),
            clear: () =>
                // `domainTenant` se conserva: depende del Host, no de la sesión.
                set({
                    user: null,
                    memberships: [],
                    activeTenantId: null,
                    impersonating: undefined,
                    isSuperadmin: false,
                    platformReauth: false,
                }),
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
