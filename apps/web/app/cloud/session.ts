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
                // Dominio white-label: el workspace queda dentro de lo que ese
                // dominio permite — la empresa del dominio y, si es una AGENCIA,
                // sus empresas cliente (v0.1.450). Sin membership → flujo normal.
                const domain = get().domainTenant;
                const scoped = session.memberships.filter((m) => inDomainScope(m, domain));
                const prevId = get().activeTenantId;
                const scopedActive =
                    domain !== null && scoped.length > 0
                        ? scoped.some((m) => m.tenant_id === prevId)
                            ? prevId
                            : scoped.some((m) => m.tenant_id === domain.id)
                              ? domain.id
                              : scoped[0]!.tenant_id
                        : null;
                set({
                    user: session.user,
                    memberships: session.memberships,
                    impersonating: session.impersonating,
                    isSuperadmin: session.is_superadmin === true,
                    platformReauth: session.platform_reauth === true,
                    activeTenantId:
                        scopedActive ??
                        (isMember(prevId) ? prevId : (session.memberships[0]?.tenant_id ?? null)),
                });
            },
            setActiveTenant: (tenantId) => {
                // Con dominio white-label, sólo empresas de ese dominio (la suya
                // y, si es una agencia, sus clientes).
                const { domainTenant, memberships } = get();
                if (domainTenant !== null && memberships.some((m) => inDomainScope(m, domainTenant))) {
                    const target = memberships.find((m) => m.tenant_id === tenantId);
                    if (!target || !inDomainScope(target, domainTenant)) return;
                }
                set({ activeTenantId: tenantId });
            },
            setDomainTenant: (tenant) => {
                // Puede llegar ANTES o DESPUÉS de `setSession` (corren en
                // paralelo en el boot): si la sesión ya está hidratada y hay
                // membership del tenant del dominio, fijamos el workspace aquí.
                const { user, memberships, activeTenantId } = get();
                const scoped = tenant !== null && user !== null ? memberships.filter((m) => inDomainScope(m, tenant)) : [];
                const keep = scoped.some((m) => m.tenant_id === activeTenantId);
                const next =
                    tenant === null || scoped.length === 0 || keep
                        ? null
                        : scoped.some((m) => m.tenant_id === tenant.id)
                          ? tenant.id
                          : scoped[0]!.tenant_id;
                set(next !== null ? { domainTenant: tenant, activeTenantId: next } : { domainTenant: tenant });
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

/**
 * v0.1.450 (ADR-S108) — ¿la empresa entra en lo que permite el dominio por el
 * que se abrió la app? La del dominio y, si el dominio es de una AGENCIA,
 * también sus empresas cliente. Sin dominio propio, todas.
 */
export function inDomainScope(
    m: Pick<MembershipSummary, 'tenant_id' | 'agency'>,
    domain: Pick<DomainTenant, 'id'> | null,
): boolean {
    return domain === null || m.tenant_id === domain.id || m.agency?.id === domain.id;
}
