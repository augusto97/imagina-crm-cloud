import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AirtableApplyInput, AirtableImportStatus } from '@imagina-base/shared';

import { api } from '@/lib/api';

import { listGroupsKeys } from './useListGroups';
import { listsKeys } from './useLists';
import { onboardingKeys } from './useOnboarding';

/**
 * v0.1.458 — «Importar de Airtable». La lectura de la base y la importación
 * corren en el servidor: la pantalla pregunta el estado cada poco mientras
 * algo corre. El token se manda una sola vez (al conectar) y nunca vuelve.
 */
export const airtableImportKeys = {
    all: ['airtable-import'] as const,
    status: (id: string) => ['airtable-import', id] as const,
};

export function useConnectAirtable() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (token: string) => (await api.post<AirtableImportStatus>('/airtable-import/connect', { token })).data,
        onSuccess: (st) => qc.setQueryData(airtableImportKeys.status(st.id), st),
    });
}

export function useChooseAirtableBase() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, baseId }: { id: string; baseId: string }) => (await api.post<AirtableImportStatus>(`/airtable-import/${id}/base`, { base_id: baseId })).data,
        onSuccess: (st) => qc.setQueryData(airtableImportKeys.status(st.id), st),
    });
}

/** El estado de la importación: se pregunta cada 1,2 s mientras se lee o se importa. */
export function useAirtableImportStatus(id: string | null) {
    return useQuery({
        queryKey: airtableImportKeys.status(id ?? ''),
        queryFn: async () => (await api.get<AirtableImportStatus>(`/airtable-import/${id}`)).data,
        enabled: id !== null,
        refetchInterval: (q) => (q.state.data?.stage === 'scanning' || q.state.data?.stage === 'importing' ? 1200 : false),
        staleTime: 0,
    });
}

export function useApplyAirtableImport() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: string; input: AirtableApplyInput }) => (await api.post<AirtableImportStatus>(`/airtable-import/${id}/apply`, input)).data,
        onSuccess: (st) => qc.setQueryData(airtableImportKeys.status(st.id), st),
    });
}

export function useCancelAirtableImport() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => (await api.post<AirtableImportStatus>(`/airtable-import/${id}/cancel`, {})).data,
        onSuccess: (st) => qc.setQueryData(airtableImportKeys.status(st.id), st),
    });
}

/** Al terminar: las listas, las carpetas y los «Primeros pasos» cambiaron. */
export function useAirtableImportFinished() {
    const qc = useQueryClient();
    return () => {
        void qc.invalidateQueries({ queryKey: listsKeys.all });
        void qc.invalidateQueries({ queryKey: listGroupsKeys.all });
        void qc.invalidateQueries({ queryKey: onboardingKeys.all });
    };
}
