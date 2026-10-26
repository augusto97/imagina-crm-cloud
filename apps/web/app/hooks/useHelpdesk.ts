import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    HelpdeskMailboxDto,
    HelpdeskMailboxInput,
    HelpdeskMailboxMarker,
    HelpdeskMailboxTestInput,
    HelpdeskReplyInput,
    HelpdeskReplyResult,
    HelpdeskSettings,
    HelpdeskTicketDto,
    ImapDiagnostic,
    UpdateHelpdeskSettingsInput,
} from '@imagina-base/shared';

import { fieldsKeys } from '@/hooks/useFields';
import { listsKeys } from '@/hooks/useLists';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { api } from '@/lib/api';

import { activityKeys } from './useActivity';
import { commentsKeys } from './useComments';

/**
 * D2 + E5 — Mesa de ayuda: el buzón de soporte de la lista, sus ajustes
 * (mapeo, estados, protecciones, respuestas guardadas) y la política de SLA,
 * y en la ficha el hilo de correo con «Responder por correo».
 *
 * Claves (regla de oro nº 7, el id de la lista en el índice 1):
 * - El ticket de UN registro vive bajo `records`: el aviso realtime de la
 *   lista (un correo que llegó, el SLA que se recalculó) lo refresca solo.
 * - El buzón y los ajustes son configuración de la lista (`helpdesk`).
 */
export const helpdeskKeys = {
    all: ['helpdesk'] as const,
    settings: (listId: string | number) => ['helpdesk', String(listId), 'settings'] as const,
    mailbox: (listId: string | number) => ['helpdesk', String(listId), 'mailbox'] as const,
    ticket: (listId: string | number, recordId: number) => ['records', String(listId), 'helpdesk', recordId] as const,
};

export interface HelpdeskSettingsResponse {
    settings: HelpdeskSettings;
    mailbox: HelpdeskMailboxMarker | null;
}

export function useHelpdeskSettings(listId: string | number | undefined, enabled = true) {
    return useQuery({
        queryKey: helpdeskKeys.settings(listId ?? ''),
        queryFn: async () => (await api.get<HelpdeskSettingsResponse>(`/lists/${listId}/helpdesk/settings`)).data,
        enabled: enabled && listId !== undefined && listId !== '',
        staleTime: 30_000,
    });
}

/** Lo que cambia al tocar la mesa de ayuda: sus ajustes, la lista (marca del buzón) y los campos. */
function invalidateConfig(qc: QueryClient, listId: string | number): void {
    invalidateForList(qc, helpdeskKeys.all, listId);
    void qc.invalidateQueries({ queryKey: listsKeys.all });
}

export function useUpdateHelpdeskSettings(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateHelpdeskSettingsInput) =>
            (await api.patch<{ settings: HelpdeskSettings }>(`/lists/${listId}/helpdesk/settings`, input)).data.settings,
        onSuccess: () => {
            invalidateConfig(qc, listId);
            // El SLA se recalcula en segundo plano: las columnas cambian solas.
            invalidateForList(qc, recordsKeys.all, listId);
        },
    });
}

/** «Crear columnas del SLA»: vencimientos y estado, guardados en la lista. */
export function useCreateSlaColumns(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<{ settings: HelpdeskSettings }>(`/lists/${listId}/helpdesk/settings/sla-columns`)).data.settings,
        onSuccess: () => {
            invalidateConfig(qc, listId);
            invalidateForList(qc, fieldsKeys.all, listId);
            invalidateForList(qc, recordsKeys.all, listId);
        },
    });
}

export function useHelpdeskMailbox(listId: string | number | undefined, enabled = true) {
    return useQuery({
        queryKey: helpdeskKeys.mailbox(listId ?? ''),
        queryFn: async () => (await api.get<HelpdeskMailboxDto | null>(`/lists/${listId}/helpdesk/mailbox`)).data,
        enabled: enabled && listId !== undefined && listId !== '',
        // El estado de la lectura (última revisión, errores, correos procesados).
        refetchInterval: 30_000,
        staleTime: 10_000,
    });
}

export function useSaveHelpdeskMailbox(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: HelpdeskMailboxInput) => (await api.post<HelpdeskMailboxDto>(`/lists/${listId}/helpdesk/mailbox`, input)).data,
        onSuccess: (data) => {
            qc.setQueryData(helpdeskKeys.mailbox(listId), data);
            invalidateConfig(qc, listId);
        },
    });
}

export function useRemoveHelpdeskMailbox(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            await api.delete(`/lists/${listId}/helpdesk/mailbox`);
        },
        onSuccess: () => {
            qc.setQueryData(helpdeskKeys.mailbox(listId), null);
            invalidateConfig(qc, listId);
        },
    });
}

/** «Probar conexión» con lo que hay en el formulario (sin guardar). */
export function useTestHelpdeskMailbox(listId: string | number) {
    return useMutation({
        mutationFn: async (input: HelpdeskMailboxTestInput) => (await api.post<ImapDiagnostic>(`/lists/${listId}/helpdesk/mailbox/test`, input)).data,
    });
}

/** «Revisar ahora». */
export function useCheckHelpdeskMailbox(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<{ queued: boolean }>(`/lists/${listId}/helpdesk/mailbox/check`)).data,
        onSuccess: () => {
            // La lectura corre en segundo plano: se vuelve a mirar en unos segundos.
            setTimeout(() => void qc.invalidateQueries({ queryKey: helpdeskKeys.mailbox(listId) }), 4000);
        },
    });
}

// ── La ficha ─────────────────────────────────────────────────────────────

export function useHelpdeskTicket(listId: string | number | undefined, recordId: number | undefined, enabled = true) {
    return useQuery({
        queryKey: helpdeskKeys.ticket(listId ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<HelpdeskTicketDto>(`/lists/${listId}/records/${recordId}/helpdesk`)).data,
        enabled: enabled && listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        staleTime: 15_000,
        retry: false,
    });
}

export function useRenderReplyTemplate(listId: string | number, recordId: number) {
    return useMutation({
        mutationFn: async (templateId: string) =>
            (await api.post<{ body: string }>(`/lists/${listId}/records/${recordId}/helpdesk/template`, { template_id: templateId })).data.body,
    });
}

export function useReplyByEmail(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: HelpdeskReplyInput) => (await api.post<HelpdeskReplyResult>(`/lists/${listId}/records/${recordId}/helpdesk/reply`, input)).data,
        onSuccess: () => {
            // El comentario saliente, el estado (si se cambió), el SLA y la actividad.
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
            void qc.invalidateQueries({ queryKey: commentsKeys.forRecord(listId, recordId) });
        },
    });
}
