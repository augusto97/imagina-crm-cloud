import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    CreateDocumentTemplateInput,
    DocumentPreviewInput,
    DocumentPreviewResult,
    DocumentTemplate,
    DocumentLinkResult,
    DocumentTemplateSummary,
    GenerateDocumentResult,
    UpdateDocumentTemplateInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';

/**
 * v0.1.266 — Plantillas de documentos PDF de una lista (ADR-S35). La clave
 * usa el ID numérico de la lista (regla de oro nº 7).
 */
export const documentKeys = {
    all: ['documents'] as const,
    forList: (listId: number) => ['documents', listId] as const,
    detail: (listId: number, id: number) => ['documents', listId, 'detail', id] as const,
};

export function useDocumentTemplates(listId: number | undefined) {
    return useQuery({
        queryKey: documentKeys.forList(listId ?? 0),
        queryFn: async () => (await api.get<DocumentTemplateSummary[]>(`/lists/${listId}/documents`)).data,
        enabled: listId !== undefined && listId > 0,
        staleTime: 30_000,
    });
}

export async function fetchDocumentTemplate(listId: number, id: number): Promise<DocumentTemplate> {
    return (await api.get<DocumentTemplate>(`/lists/${listId}/documents/${id}`)).data;
}

export function useSaveDocumentTemplate(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { id: number | null; body: CreateDocumentTemplateInput | UpdateDocumentTemplateInput }) =>
            input.id === null
                ? (await api.post<DocumentTemplate>(`/lists/${listId}/documents`, input.body)).data
                : (await api.patch<DocumentTemplate>(`/lists/${listId}/documents/${input.id}`, input.body)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: documentKeys.forList(listId) }),
    });
}

export function useDeleteDocumentTemplate(listId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/documents/${id}`);
        },
        onSuccess: () => void qc.invalidateQueries({ queryKey: documentKeys.forList(listId) }),
    });
}

export async function previewDocument(listId: number, input: DocumentPreviewInput, signal?: AbortSignal): Promise<DocumentPreviewResult> {
    return (await api.post<DocumentPreviewResult>(`/lists/${listId}/documents/preview`, input, { signal })).data;
}

export async function generateDocument(
    listId: number,
    templateId: number,
    input: { record_id: number; save_field?: string | null; save_mode?: 'append' | 'replace' },
): Promise<GenerateDocumentResult & { pdf: string }> {
    return (await api.post<GenerateDocumentResult & { pdf: string }>(`/lists/${listId}/documents/${templateId}/generate`, input)).data;
}

/**
 * v0.1.268 — enlace de 30 días que arma el PDF al abrirlo (no guarda ningún
 * archivo): para pegarlo en un WhatsApp o un correo.
 */
export async function documentLink(listId: number, templateId: number, recordId: number): Promise<DocumentLinkResult> {
    return (await api.post<DocumentLinkResult>(`/lists/${listId}/documents/${templateId}/link`, { record_id: recordId })).data;
}

/** base64 → Blob de PDF. */
export function pdfBlob(base64: string): Blob {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'application/pdf' });
}

/** Descarga un PDF (base64) con su nombre. */
export function downloadPdf(base64: string, filename: string): void {
    const url = URL.createObjectURL(pdfBlob(base64));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
