import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    AgencyBillingSettings,
    AgencyClient,
    AgencyEnterResult,
    AgencyOverview,
    AgencyPayment,
    CreateAgencyClientInput,
    HelpSupport,
    MyAgencyBilling,
    RegisterAgencyPaymentInput,
    SetAgencyClientBillingInput,
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
    payments: (clientId: number) => ['agency', 'payments', clientId] as const,
    /** Lo que ve la empresa CLIENTE de su cobro (otra clave: no es de la agencia). */
    mine: ['agency-billing', 'mine'] as const,
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

// ── v0.1.451 — el cobro de la agencia a sus clientes ────────────────────

/** Guardar los planes de la agencia y sus reglas (gracia, avisos). */
export function useUpdateAgencyBilling() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: AgencyBillingSettings) => (await api.put<AgencyOverview>('/agency/billing', input)).data,
        onSuccess: (data) => {
            qc.setQueryData(agencyKeys.overview, data);
            void qc.invalidateQueries({ queryKey: agencyKeys.clients });
        },
    });
}

/** Asignar o quitar el plan de un cliente, su valor o su «pagado hasta». */
export function useSetClientBilling() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: SetAgencyClientBillingInput }) =>
            (await api.patch<AgencyClient>(`/agency/clients/${id}/billing`, input)).data,
        onSuccess: () => refresh(qc),
    });
}

export function useClientPayments(clientId: number, enabled = true) {
    return useQuery({
        queryKey: agencyKeys.payments(clientId),
        queryFn: async () => (await api.get<AgencyPayment[]>(`/agency/clients/${clientId}/payments`)).data,
        enabled,
        staleTime: 10_000,
    });
}

export function useRegisterClientPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: RegisterAgencyPaymentInput }) =>
            (await api.post<{ payment: AgencyPayment; client: AgencyClient }>(`/agency/clients/${id}/payments`, input)).data,
        onSuccess: () => refresh(qc),
    });
}

export function useUndoClientPayment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, paymentId }: { id: number; paymentId: number }) =>
            (await api.delete<AgencyClient>(`/agency/clients/${id}/payments/${paymentId}`)).data,
        onSuccess: () => refresh(qc),
    });
}

/** La empresa cliente: su plan con la agencia, hasta cuándo está pagado y sus pagos. */
export function useMyAgencyBilling(enabled = true) {
    return useQuery({
        queryKey: agencyKeys.mine,
        queryFn: async () => (await api.get<MyAgencyBilling | null>('/workspaces/current/agency-billing')).data,
        enabled,
        staleTime: 60_000,
    });
}
