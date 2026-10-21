import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaptchaAvailability, CreateFormInput, FormDto, UpdateFormInput } from '@imagina-base/shared';

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

/**
 * v0.1.290 — ¿Se puede pedir captcha en los formularios de esta lista, y con
 * qué llaves (las de la empresa o las de la plataforma)?
 */
export function useCaptchaAvailability(listId: number | undefined) {
    return useQuery({
        queryKey: ['forms-captcha', listId ?? 0],
        queryFn: async () => (await api.get<CaptchaAvailability>(`/lists/${listId}/forms/captcha`)).data,
        enabled: listId !== undefined && listId > 0,
        staleTime: 60_000,
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

/**
 * Dirección absoluta del formulario (la que se comparte o se inserta). La
 * arma el servidor con el dominio propio de la empresa cuando lo tiene y
 * responde; si no, el origen desde donde se mira.
 */
export function formPublicUrl(form: Pick<FormDto, 'public_path' | 'public_url'>): string {
    return form.public_url ?? `${window.location.origin}${form.public_path}`;
}

/** El origen de esa dirección (de ahí se carga el script de inserción). */
export function formPublicOrigin(form: Pick<FormDto, 'public_path' | 'public_url' | 'public_origin'>): string {
    if (form.public_origin) return form.public_origin;
    try {
        return new URL(formPublicUrl(form)).origin;
    } catch {
        return window.location.origin;
    }
}

/**
 * Código para insertarlo en un sitio: el marco y un script chico que ajusta
 * su alto al del formulario (sin barras ni hueco) y, si al enviar redirige,
 * lleva a toda la página y no sólo al marco.
 */
export function formEmbedCode(form: Pick<FormDto, 'public_path' | 'public_url' | 'public_origin' | 'name'>): string {
    const title = form.name.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
    return (
        `<iframe src="${formPublicUrl(form)}" title="${title}" data-imagina-form style="width:100%;height:640px;border:0" loading="lazy"></iframe>\n` +
        `<script src="${formPublicOrigin(form)}/api/v1/public/f/embed.js" async></script>`
    );
}
