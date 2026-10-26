import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    ApprovalActionResult,
    ApprovalFlow,
    ApprovalRequestDto,
    CreateApprovalFlowInput,
    DecideApprovalInput,
    MyApprovalsDto,
    RecordApprovalsDto,
    RequestApprovalInput,
    UpdateApprovalFlowInput,
} from '@imagina-base/shared';

import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { useIsGuest } from '@/lib/guest';

import { activityKeys } from './useActivity';

/**
 * C5 — Aprobaciones.
 *
 * Claves:
 * - Las solicitudes de UN registro viven bajo `records` con el id de la lista
 *   en el índice 1 (regla de oro nº 7): el aviso realtime de la lista
 *   (`records`) las refresca solo, con `invalidateForList` por id o por slug.
 * - «Mi trabajo» → Aprobaciones y la pantalla de confirmación del correo
 *   viven bajo `notifications`: el aviso realtime de la sala de la persona las
 *   refresca (te tocó aprobar, se resolvió lo que pediste).
 * - Los flujos son configuración de la lista.
 */
export const approvalKeys = {
    forRecord: (listId: string | number, recordId: number) => ['records', String(listId), 'approvals', recordId] as const,
    flows: (listId: string | number) => ['approval-flows', String(listId)] as const,
    flowsAll: ['approval-flows'] as const,
    mine: ['notifications', 'approvals'] as const,
    request: (id: number) => ['notifications', 'approval-request', id] as const,
};

export function useRecordApprovals(listId: string | number | undefined, recordId: number | undefined, enabled = true) {
    // C3 — las aprobaciones son de la empresa: un invitado no las pide.
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: approvalKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<RecordApprovalsDto>(`/lists/${listId}/records/${recordId}/approvals`)).data,
        enabled: enabled && !isGuest && listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        staleTime: 30_000,
    });
}

export function useApprovalFlows(listId: string | number | undefined, enabled = true) {
    return useQuery({
        queryKey: approvalKeys.flows(listId ?? ''),
        queryFn: async () => (await api.get<ApprovalFlow[]>(`/lists/${listId}/approval-flows`)).data,
        enabled: enabled && listId !== undefined && listId !== '',
        staleTime: 30_000,
    });
}

/** Lo que cambia cuando se crea, decide o cancela una solicitud. */
export function invalidateApprovals(qc: QueryClient, listId: string | number): void {
    // Las solicitudes del registro, la fila (columna «Aprobación», indicador),
    // los campos que puso el flujo y el pie de la tabla.
    invalidateForList(qc, recordsKeys.all, listId);
    invalidateForList(qc, activityKeys.all, listId);
    invalidateForList(qc, approvalKeys.flowsAll, listId);
    void qc.invalidateQueries({ queryKey: approvalKeys.mine });
    void qc.invalidateQueries({ queryKey: ['notifications', 'approval-request'] });
}

export function useCreateApprovalFlow(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateApprovalFlowInput) => (await api.post<ApprovalFlow>(`/lists/${listId}/approval-flows`, input)).data,
        onSuccess: () => {
            invalidateForList(qc, approvalKeys.flowsAll, listId);
            // `add_status_field` crea la columna «Aprobación».
            void qc.invalidateQueries({ queryKey: ['fields'] });
        },
    });
}

export function useUpdateApprovalFlow(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...patch }: UpdateApprovalFlowInput & { id: number }) =>
            (await api.patch<ApprovalFlow>(`/lists/${listId}/approval-flows/${id}`, patch)).data,
        onSuccess: () => invalidateForList(qc, approvalKeys.flowsAll, listId),
    });
}

export function useDeleteApprovalFlow(listId: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/approval-flows/${id}`);
        },
        onSuccess: () => invalidateApprovals(qc, listId),
    });
}

export function useRequestApproval(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: RequestApprovalInput) =>
            (await api.post<ApprovalRequestDto>(`/lists/${listId}/records/${recordId}/approvals`, input)).data,
        onSuccess: () => invalidateApprovals(qc, listId),
    });
}

/** Aprobar / rechazar / devolver. Siempre un POST con la sesión de quien decide. */
export function useDecideApproval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...input }: DecideApprovalInput & { id: number }) =>
            (await api.post<ApprovalActionResult>(`/approvals/${id}/decide`, input)).data,
        onSuccess: (res) => invalidateApprovals(qc, res.request.list_id),
    });
}

export function useCancelApproval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, reason }: { id: number; reason?: string }) =>
            (await api.post<ApprovalActionResult>(`/approvals/${id}/cancel`, { reason: reason ?? '' })).data,
        onSuccess: (res) => invalidateApprovals(qc, res.request.list_id),
    });
}

/** «Mi trabajo» → Aprobaciones (y el contador de la pestaña). */
export function useMyApprovals(enabled = true) {
    return useQuery({
        queryKey: approvalKeys.mine,
        queryFn: async () => (await api.get<MyApprovalsDto>('/me/approvals')).data,
        enabled: enabled && getBootData().tenantId !== null,
        staleTime: 30_000,
        refetchInterval: 5 * 60 * 1000,
    });
}

export interface ApprovalRequestView {
    request: ApprovalRequestDto;
    list: { id: number; slug: string; name: string };
    record_title: string;
}

/** Una solicitud (la pantalla de confirmación a la que lleva el correo). */
export function useApprovalRequest(id: number | undefined) {
    return useQuery({
        queryKey: approvalKeys.request(id ?? 0),
        queryFn: async () => (await api.get<ApprovalRequestView>(`/approvals/${id}`)).data,
        enabled: id !== undefined && id > 0,
        staleTime: 10_000,
        retry: false,
    });
}
