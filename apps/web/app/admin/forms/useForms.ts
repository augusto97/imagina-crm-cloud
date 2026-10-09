import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateFormInput, FormDto, UpdateFormInput } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.275 — Formularios públicos de una lista (ADR-S39). La clave usa el
 * ID numérico de la lista (regla de oro nº 7).
 */
export const formKeys = {
    all: ['forms'] as const,
    forList: (listId: number) => ['forms', listId] as const,
};

export function useForms(listId: number | undefined) {
    return useQuery({
        queryKey: formKeys.forList(listId ?? 0),
        queryFn: async () => (await api.get<FormDto[]>(`/lists/${listId}/forms`)).data,
        enabled: listId !== undefined && listId > 0,
        staleTime: 15_000,
    });
}

export function useCreateForm(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateFormInput) => (await api.post<FormDto>(`/lists/${listId}/forms`, input)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: formKeys.forList(listId) }),
    });
}

export function useUpdateForm(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number; body: UpdateFormInput }) =>
            (await api.patch<FormDto>(`/lists/${listId}/forms/${input.id}`, input.body)).data,
        onSuccess: (doc) => {
            qc.setQueryData<FormDto[]>(formKeys.forList(listId), (prev) => prev?.map((f) => (f.id === doc.id ? doc : f)));
            void qc.invalidateQueries({ queryKey: formKeys.forList(listId) });
        },
    });
}

export function useDeleteForm(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/forms/${id}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: formKeys.forList(listId) }),
    });
}

/** Dirección absoluta del formulario (la que se comparte o se inserta). */
export function formPublicUrl(form: Pick<FormDto, 'public_path'>): string {
    return `${window.location.origin}${form.public_path}`;
}

/** Código para insertarlo en un sitio. */
export function formEmbedCode(form: Pick<FormDto, 'public_path' | 'name'>): string {
    const title = form.name.replace(/"/g, '&quot;');
    return `<iframe src="${formPublicUrl(form)}" title="${title}" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>`;
}
