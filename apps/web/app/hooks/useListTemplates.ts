import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ApplyListTemplateInput,
    CreateListTemplateInput,
    DuplicateListInput,
    ListTemplateSummary,
} from '@imagina-base/shared';

import { listsKeys } from '@/hooks/useLists';
import { api } from '@/lib/api';
import type { ListSummary } from '@/types/list';

/**
 * Duplicar listas y plantillas (v0.1.166). Un solo motor en el backend
 * (`BlueprintService`); acá sólo las mutaciones y la galería.
 */
export const templatesKeys = {
    all: ['list-templates'] as const,
    list: () => [...templatesKeys.all, 'list'] as const,
};

export interface MaterializeResult {
    lists: ListSummary[];
    warnings: string[];
}

export function useListTemplates(enabled = true) {
    return useQuery({
        queryKey: templatesKeys.list(),
        queryFn: async () => {
            const res = await api.get<ListTemplateSummary[]>('/list-templates');
            return res.data;
        },
        enabled,
        staleTime: 60_000,
    });
}

export function useDuplicateList() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ listId, input }: { listId: number | string; input: DuplicateListInput }) => {
            const res = await api.post<MaterializeResult>(`/lists/${listId}/duplicate`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
        },
    });
}

export function useCreateListTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateListTemplateInput) => {
            const res = await api.post<ListTemplateSummary>('/list-templates', input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: templatesKeys.all });
        },
    });
}

export function useDeleteListTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/list-templates/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: templatesKeys.all });
        },
    });
}

export function useApplyListTemplate() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: string; input: ApplyListTemplateInput }) => {
            const res = await api.post<MaterializeResult>(`/list-templates/${id}/apply`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: listsKeys.all });
        },
    });
}
