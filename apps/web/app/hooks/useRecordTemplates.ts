import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ChecklistTemplateFromChecklistInput,
    CreateRecordTemplateInput,
    FromTemplateResult,
    RecordTemplate,
    RecordTemplateFromRecordInput,
    RecordTemplateKind,
    UpdateRecordTemplateInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';
import type { RecordEntity } from '@/types/record';

import { activityKeys } from './useActivity';
import { invalidateForList, markLocalRecordsChange, recordsKeys } from './useRecords';

/**
 * C6 — Plantillas de registro (y A9 — plantillas de checklist) de una lista.
 * La key lleva la lista en el índice 1 (regla de oro nº 7) y su propio
 * namespace: cambiar registros no las invalida.
 */
export const recordTemplateKeys = {
    all: ['record-templates'] as const,
    forList: (listId: string | number) => ['record-templates', String(listId)] as const,
};

export function useRecordTemplates(listId: string | number | undefined, kind?: RecordTemplateKind) {
    // C3 — las plantillas son de la empresa: un invitado no las usa.
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: [...recordTemplateKeys.forList(listId ?? ''), kind ?? 'all'] as const,
        queryFn: async () =>
            (await api.get<RecordTemplate[]>(`/lists/${listId}/record-templates`, kind ? { query: { kind } } : undefined)).data,
        enabled: !isGuest && listId !== undefined && listId !== '',
        staleTime: 30_000,
    });
}

function useInvalidateTemplates(listId: string | number) {
    const qc = useQueryClient();
    return () => invalidateForList(qc, recordTemplateKeys.all, listId);
}

export function useCreateRecordTemplate(listId: string | number) {
    const refresh = useInvalidateTemplates(listId);
    return useMutation({
        mutationFn: async (input: CreateRecordTemplateInput) =>
            (await api.post<RecordTemplate>(`/lists/${listId}/record-templates`, input)).data,
        onSuccess: refresh,
    });
}

export function useUpdateRecordTemplate(listId: string | number) {
    const refresh = useInvalidateTemplates(listId);
    return useMutation({
        mutationFn: async ({ id, patch }: { id: number; patch: UpdateRecordTemplateInput }) =>
            (await api.patch<RecordTemplate>(`/lists/${listId}/record-templates/${id}`, patch)).data,
        onSuccess: refresh,
    });
}

export function useDeleteRecordTemplate(listId: string | number) {
    const refresh = useInvalidateTemplates(listId);
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/record-templates/${id}`);
        },
        onSuccess: refresh,
    });
}

/** «Guardar como plantilla» desde la ficha. */
export function useTemplateFromRecord(listId: string | number) {
    const refresh = useInvalidateTemplates(listId);
    return useMutation({
        mutationFn: async (input: RecordTemplateFromRecordInput) =>
            (await api.post<RecordTemplate>(`/lists/${listId}/record-templates/from-record`, input)).data,
        onSuccess: refresh,
    });
}

/** Guardar UN checklist como plantilla de checklist. */
export function useTemplateFromChecklist(listId: string | number) {
    const refresh = useInvalidateTemplates(listId);
    return useMutation({
        mutationFn: async (input: ChecklistTemplateFromChecklistInput) =>
            (await api.post<RecordTemplate>(`/lists/${listId}/record-templates/from-checklist`, input)).data,
        onSuccess: refresh,
    });
}

/**
 * Alta desde una plantilla: el registro con sus valores, subtareas y
 * checklists en UNA transacción. `fields` (por slug) pisa los valores de la
 * plantilla (lo que la persona completó en el alta).
 */
export function useCreateFromTemplate(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { template_id: number; fields?: Record<string, unknown>; parent_id?: number | null }) => {
            const res = await api.post<RecordEntity>(`/lists/${listId}/records/from-template`, input);
            return { record: res.data, result: (res.meta ?? {}) as unknown as FromTemplateResult };
        },
        onMutate: () => markLocalRecordsChange(qc, listId),
        onSuccess: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
        },
    });
}
