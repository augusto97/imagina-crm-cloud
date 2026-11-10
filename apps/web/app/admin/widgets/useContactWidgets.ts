import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactWidgetDto, ContactWidgetOptions, CreateContactWidgetInput, UpdateContactWidgetInput, WidgetStatsDto } from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.394 (ADR-S99) — Los widgets de contacto de la empresa. Los arma quien
 * arma formularios (`manage_forms`).
 */
export const widgetKeys = {
    all: ['contact-widgets'] as const,
    one: (id: number) => ['contact-widgets', id] as const,
    options: ['contact-widgets', 'options'] as const,
};

export function useContactWidgets(enabled = true) {
    return useQuery({
        queryKey: widgetKeys.all,
        queryFn: async () => (await api.get<ContactWidgetDto[]>('/contact-widgets')).data,
        enabled,
        staleTime: 15_000,
    });
}

export function useContactWidget(id: number) {
    return useQuery({
        queryKey: widgetKeys.one(id),
        queryFn: async () => (await api.get<ContactWidgetDto>(`/contact-widgets/${id}`)).data,
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
    });
}

/** v0.1.396 — Estadísticas del widget (apariciones, aperturas, toques y contactos por botón). */
export function useWidgetStats(id: number, days: number, enabled = true) {
    return useQuery({
        queryKey: [...widgetKeys.one(id), 'stats', days] as const,
        queryFn: async () => (await api.get<WidgetStatsDto>(`/contact-widgets/${id}/stats?days=${days}`)).data,
        enabled: enabled && Number.isInteger(id) && id > 0,
        // Se piden al abrir la pestaña (y cada minuto mientras está abierta): son números que cambian solos.
        staleTime: 0,
        refetchInterval: 60_000,
    });
}

/** Los formularios y agendas que puede abrir un botón (un pedido). */
export function useWidgetOptions(enabled = true) {
    return useQuery({
        queryKey: widgetKeys.options,
        queryFn: async () => (await api.get<ContactWidgetOptions>('/contact-widgets/options')).data,
        enabled,
        staleTime: 30_000,
    });
}

function store(qc: ReturnType<typeof useQueryClient>, doc: ContactWidgetDto): void {
    qc.setQueryData(widgetKeys.one(doc.id), doc);
    qc.setQueryData<ContactWidgetDto[]>(widgetKeys.all, (prev) =>
        prev ? (prev.some((w) => w.id === doc.id) ? prev.map((w) => (w.id === doc.id ? doc : w)) : [...prev, doc]) : prev,
    );
}

export function useCreateContactWidget() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateContactWidgetInput) => (await api.post<ContactWidgetDto>('/contact-widgets', input)).data,
        onSuccess: (doc) => {
            store(qc, doc);
            void qc.invalidateQueries({ queryKey: widgetKeys.all });
        },
    });
}

export function useUpdateContactWidget(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: UpdateContactWidgetInput) => (await api.patch<ContactWidgetDto>(`/contact-widgets/${id}`, body)).data,
        onSuccess: (doc) => store(qc, doc),
    });
}

export function useRegenerateContactWidget(id: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<ContactWidgetDto>(`/contact-widgets/${id}/regenerate`)).data,
        onSuccess: (doc) => store(qc, doc),
    });
}

export function useDeleteContactWidget() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/contact-widgets/${id}`);
            return id;
        },
        onSuccess: (id) => {
            qc.setQueryData<ContactWidgetDto[]>(widgetKeys.all, (prev) => prev?.filter((w) => w.id !== id));
            qc.removeQueries({ queryKey: widgetKeys.one(id) });
        },
    });
}
