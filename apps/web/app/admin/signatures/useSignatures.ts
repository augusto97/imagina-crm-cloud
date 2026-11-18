import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { CreateSignatureRequestInput, SignatureCodeChannel, SignatureRequestDto } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { api } from '@/lib/api';

/**
 * D6 (v0.1.446, ADR-S107) — Firmas de un registro. La clave lleva el ID
 * numérico de la lista en el índice 1 (regla de oro nº 7).
 */
export const signatureKeys = {
    all: ['signatures'] as const,
    forRecord: (listId: number, recordId: number) => ['signatures', listId, recordId] as const,
    sources: (listId: number, recordId: number) => ['signatures', listId, recordId, 'sources'] as const,
    /** v0.1.448 — Conexiones de la empresa que pueden mandar el código (no dependen de la lista). */
    codeChannels: () => ['signatures', 'code-channels'] as const,
};

export interface SignatureSources {
    templates: Array<{ id: number; name: string }>;
    files: Array<{ id: number; filename: string; field: string; size: number }>;
}

export function useRecordSignatures(listId: number, recordId: number, enabled = true) {
    return useQuery({
        queryKey: signatureKeys.forRecord(listId, recordId),
        queryFn: async () => (await api.get<SignatureRequestDto[]>(`/lists/${listId}/records/${recordId}/signatures`)).data,
        enabled: enabled && listId > 0 && recordId > 0,
        retry: false,
        staleTime: 15_000,
        // Mientras alguien tenga que firmar, mirar seguido: la firma llega en cualquier momento.
        refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'pending') ? 20_000 : false),
    });
}

export function useSignatureSources(listId: number, recordId: number, enabled: boolean) {
    return useQuery({
        queryKey: signatureKeys.sources(listId, recordId),
        queryFn: async () => (await api.get<SignatureSources>(`/lists/${listId}/records/${recordId}/signatures/sources`)).data,
        enabled: enabled && listId > 0 && recordId > 0,
        retry: false,
    });
}

/**
 * v0.1.448 — Las conexiones de SMS o WhatsApp del equipo que pueden mandar el
 * código de firma (con las plantillas aprobadas de WhatsApp de Meta).
 */
export function useSignatureCodeChannels(enabled: boolean) {
    return useQuery({
        queryKey: signatureKeys.codeChannels(),
        queryFn: async () => (await api.get<SignatureCodeChannel[]>('/signatures/code-channels')).data,
        enabled,
        retry: false,
        staleTime: 60_000,
    });
}

function refresh(qc: QueryClient, listId: number, recordId: number): void {
    void qc.invalidateQueries({ queryKey: signatureKeys.forRecord(listId, recordId) });
    // Al terminar puede cambiar el registro (el PDF en un campo, el estado, la fecha).
    invalidateForList(qc, recordsKeys.all, listId);
}

export function useCreateSignature(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateSignatureRequestInput) =>
            (await api.post<SignatureRequestDto>(`/lists/${listId}/records/${recordId}/signatures`, input)).data,
        onSuccess: () => refresh(qc, listId, recordId),
    });
}

export function useVoidSignature(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number; reason: string }) =>
            (await api.post<SignatureRequestDto>(`/lists/${listId}/records/${recordId}/signatures/${input.id}/void`, { reason: input.reason })).data,
        onSuccess: () => refresh(qc, listId, recordId),
    });
}

export function useResendSignature(listId: number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number; signerId: number }) =>
            (await api.post<{ sent: boolean }>(`/lists/${listId}/records/${recordId}/signatures/${input.id}/signers/${input.signerId}/resend`)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: signatureKeys.forRecord(listId, recordId) }),
    });
}

function apiBase(): string {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_API_URL?.replace(/\/$/, '') ?? '/api/v1';
}

/**
 * Dirección del PDF de una solicitud (el original o el firmado). La empresa va
 * en `?t=`: la abre un enlace o el visor de la app, que no mandan cabeceras.
 */
export function signatureFileUrl(listId: number, recordId: number, requestId: number, which: 'original' | 'signed', download = false): string {
    const tenant = useSession.getState().activeTenantId;
    const q = new URLSearchParams();
    if (tenant !== null && tenant !== undefined) q.set('t', String(tenant));
    if (download) q.set('download', '1');
    return `${apiBase()}/lists/${listId}/records/${recordId}/signatures/${requestId}/file/${which}?${q.toString()}`;
}
