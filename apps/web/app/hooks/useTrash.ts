import { useCallback } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TrashItem, TrashItemType, TrashPageMeta, TrashPurgeResult, TrashRestoreResult } from '@imagina-base/shared';

import { useToastOptional } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';

import { activityKeys } from './useActivity';
import { automationsKeys } from './useAutomations';
import { dashboardsKeys } from './useDashboards';
import { favoritesKeys } from './useFavorites';
import { fieldsKeys } from './useFields';
import { listsKeys } from './useLists';
import { recordsKeys } from './useRecords';
import { viewsKeys } from './useSavedViews';

/**
 * Papelera — listado, restaurar, borrar para siempre y el aviso «Se movió a
 * la papelera · Deshacer» que muestran los borrados de la app.
 */

export interface TrashQuery {
    type?: TrashItemType;
    q?: string;
    list_id?: number;
    page?: number;
    limit?: number;
}

export const trashKeys = {
    all: ['trash'] as const,
    page: (q: TrashQuery) => [...trashKeys.all, 'page', q] as const,
};

export function useTrashPage(q: TrashQuery, enabled = true) {
    return useQuery({
        queryKey: trashKeys.page(q),
        queryFn: async () => {
            const res = await api.get<TrashItem[]>('/trash', {
                query: {
                    ...(q.type ? { type: q.type } : {}),
                    ...(q.q ? { q: q.q } : {}),
                    ...(q.list_id ? { list_id: q.list_id } : {}),
                    page: q.page ?? 1,
                    limit: q.limit ?? 50,
                },
            });
            return { items: res.data, meta: res.meta as unknown as TrashPageMeta };
        },
        enabled,
        placeholderData: keepPreviousData,
        staleTime: 10_000,
    });
}

/**
 * Lo que puede haber cambiado al restaurar o purgar: casi todo (una lista
 * vuelve con sus registros, campos, vistas y automatizaciones). Es raro, así
 * que se refresca amplio en vez de adivinar.
 */
export function invalidateAfterTrash(qc: QueryClient): void {
    for (const key of [
        trashKeys.all,
        listsKeys.all,
        recordsKeys.all,
        fieldsKeys.all,
        viewsKeys.all,
        automationsKeys.all,
        dashboardsKeys.all,
        activityKeys.all,
        favoritesKeys.all,
        ['aggregates'],
    ]) {
        void qc.invalidateQueries({ queryKey: key });
    }
}

export function useRestoreFromTrash() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ type, id }: { type: TrashItemType; id: number }) =>
            (await api.post<TrashRestoreResult>(`/trash/${type}/${id}/restore`, {})).data,
        onSuccess: () => invalidateAfterTrash(qc),
    });
}

export function usePurgeFromTrash() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ type, id }: { type: TrashItemType; id: number }) =>
            (await api.delete<TrashPurgeResult>(`/trash/${type}/${id}`)).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: trashKeys.all }),
    });
}

export function useEmptyTrash() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.delete<TrashPurgeResult>('/trash')).data,
        onSuccess: () => void qc.invalidateQueries({ queryKey: trashKeys.all }),
    });
}

const MOVED: Record<TrashItemType, string> = {
    record: 'El registro se movió a la papelera',
    list: 'La lista se movió a la papelera',
    field: 'El campo se movió a la papelera',
    view: 'La vista se movió a la papelera',
    automation: 'La automatización se movió a la papelera',
    dashboard: 'El tablero se movió a la papelera',
};

/** El título del aviso: con el nombre si lo hay («Acme» se movió a la papelera). */
export function trashedTitle(type: TrashItemType, name?: string | null): string {
    const n = (name ?? '').trim();
    return n ? `«${n.length > 60 ? `${n.slice(0, 57)}…` : n}» ${__('se movió a la papelera')}` : __(MOVED[type]);
}

/**
 * El aviso que sigue a un borrado: «Se movió a la papelera» con «Deshacer».
 * Deshacer = restaurar desde la papelera (mismas reglas que la sección
 * Papelera: quien lo borró puede). Funciona fuera del proveedor de avisos
 * (tests): ahí no muestra nada.
 */
export function useTrashedToast(): (t: { type: TrashItemType; id: number; name?: string | null; onRestored?: (r: TrashRestoreResult) => void }) => void {
    const toast = useToastOptional();
    const qc = useQueryClient();
    return useCallback(
        ({ type, id, name, onRestored }) => {
            if (!toast) return;
            void qc.invalidateQueries({ queryKey: trashKeys.all });
            toast.show({
                title: trashedTitle(type, name),
                description: __('Puedes recuperarlo desde Ajustes → Papelera.'),
                variant: 'success',
                duration: 8000,
                action: {
                    label: __('Deshacer'),
                    onClick: () => {
                        void api
                            .post<TrashRestoreResult>(`/trash/${type}/${id}/restore`, {})
                            .then((res) => {
                                invalidateAfterTrash(qc);
                                toast.success(res.data.message);
                                onRestored?.(res.data);
                            })
                            .catch((err: unknown) => {
                                toast.error(__('No se pudo deshacer'), err instanceof Error ? err.message : String(err));
                            });
                    },
                },
            });
        },
        [toast, qc],
    );
}

/** El título de un registro para el aviso (el campo de título de la lista). */
export function recordTitleFor(
    fields: ReadonlyArray<{ slug: string; type: string; is_primary?: boolean }>,
    values: Record<string, unknown> | undefined,
): string | null {
    if (!values) return null;
    const title = fields.find((f) => f.is_primary) ?? fields.find((f) => f.type === 'text');
    const v = title ? values[title.slug] : null;
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
