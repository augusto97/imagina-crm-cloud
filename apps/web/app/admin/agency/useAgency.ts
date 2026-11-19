import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    AgencyClient,
    AgencyEnterResult,
    AgencyOverview,
    CreateAgencyClientInput,
    HelpSupport,
    UpdateAgencyClientInput,
} from '@imagina-base/shared';

import { api as cloudApi, useSession } from '@/cloud/session';
import { switchWorkspace } from '@/cloud/workspaceSwitch';
import { api } from '@/lib/api';

/**
 * v0.1.449 (I3, ADR-S108) — La consola de la agencia: el resumen y sus
 * empresas cliente. Sólo la ve un admin directo de una empresa marcada como
 * agencia (`useIsAgencyAdmin`); el servidor lo vuelve a revisar.
 */
export const agencyKeys = {
    all: ['agency'] as const,
    overview: ['agency', 'overview'] as const,
    clients: ['agency', 'clients'] as const,
    support: ['agency', 'support'] as const,
};

/** La empresa activa es una agencia y la persona es su admin directo. */
export function useIsAgencyAdmin(): boolean {
    return useSession((s) => {
        const m = s.memberships.find((x) => x.tenant_id === s.activeTenantId);
        return Boolean(m?.is_agency && m.role === 'admin' && !m.via_agency);
    });
}

export function useAgencyOverview(enabled = true) {
    return useQuery({
        queryKey: agencyKeys.overview,
        queryFn: async () => (await api.get<AgencyOverview>('/agency')).data,
        enabled,
        staleTime: 30_000,
    });
}

export function useAgencyClients(enabled = true) {
    return useQuery({
        queryKey: agencyKeys.clients,
        queryFn: async () => (await api.get<AgencyClient[]>('/agency/clients')).data,
        enabled,
        staleTime: 30_000,
    });
}

function refresh(qc: QueryClient): void {
    void qc.invalidateQueries({ queryKey: agencyKeys.all });
}

export function useCreateAgencyClient() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateAgencyClientInput) => (await api.post<AgencyClient>('/agency/clients', input)).data,
        onSuccess: () => refresh(qc),
    });
}

export function useUpdateAgencyClient() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: UpdateAgencyClientInput }) =>
            (await api.patch<AgencyClient>(`/agency/clients/${id}`, input)).data,
        onSuccess: () => refresh(qc),
    });
}

/**
 * «Entrar» a una empresa cliente: el servidor deja a la persona como admin
 * «por la agencia» (queda en la bitácora del cliente) y acá se trae la
 * sesión de nuevo —para que la empresa aparezca entre las suyas— y se cambia
 * a ella.
 */
export function useEnterAgencyClient() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.post<AgencyEnterResult>(`/agency/clients/${id}/enter`, {})).data,
        onSuccess: async (res) => {
            const session = await cloudApi.me();
            useSession.getState().setSession(session);
            qc.setQueryData(['me'], session);
            switchWorkspace(res.tenant_id, qc);
        },
    });
}


/**
 * v0.1.450 (ADR-S108) — El contacto de soporte que ven las empresas cliente
 * en su Ayuda («¿Necesitas más ayuda?»): el de la agencia, nunca el de la
 * plataforma.
 */
export function useAgencySupport(enabled = true) {
    return useQuery({
        queryKey: agencyKeys.support,
        queryFn: async () => (await api.get<HelpSupport>('/agency/support')).data,
        enabled,
        staleTime: 60_000,
    });
}

export function useUpdateAgencySupport() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: HelpSupport) => (await api.put<HelpSupport>('/agency/support', input)).data,
        onSuccess: (data) => qc.setQueryData(agencyKeys.support, data),
    });
}
