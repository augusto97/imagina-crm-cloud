import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ButtonPressStatus, PressButtonBulkResult, PressButtonResult } from '@imagina-base/shared';

import { api } from '@/lib/api';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { activityKeys } from '@/hooks/useActivity';
import { invalidateIssued } from '@/admin/documents/useDocuments';

/**
 * Campo «Botón» — presionar un botón del equipo (uno o en lote) y preguntar
 * cómo terminaron las automatizaciones que inició. Las acciones las ejecuta
 * el servidor (re-chequea permisos, condición y tienda); aquí sólo se pide y
 * se refrescan los caches de la lista.
 */
export async function pressButton(listId: number | string, recordId: number, fieldId: number): Promise<PressButtonResult> {
    return (await api.post<PressButtonResult>(`/lists/${listId}/records/${recordId}/buttons/${fieldId}`, {})).data;
}

export async function pressButtonBulk(listId: number | string, fieldId: number, ids: number[]): Promise<PressButtonBulkResult> {
    return (await api.post<PressButtonBulkResult>(`/lists/${listId}/records/buttons/${fieldId}/bulk`, { ids })).data;
}

export async function buttonPressStatus(listId: number | string, pressId: string): Promise<ButtonPressStatus> {
    return (await api.get<ButtonPressStatus>(`/lists/${listId}/records/buttons/presses/${encodeURIComponent(pressId)}`)).data;
}

/** Lo que cambió un presionado: registros, actividad y (si hubo PDF guardado) los documentos. */
export function refreshAfterPress(qc: QueryClient, listId: number | string, recordId: number | null): void {
    invalidateForList(qc, recordsKeys.all, listId);
    invalidateForList(qc, activityKeys.all, listId);
    if (recordId !== null && typeof listId === 'number') invalidateIssued(qc, listId, recordId);
}

export function useButtonQueryClient(): QueryClient {
    return useQueryClient();
}
