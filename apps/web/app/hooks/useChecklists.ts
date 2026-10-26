import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    ChecklistItem,
    CreateChecklistInput,
    CreateChecklistItemsInput,
    RecordChecklists,
    UpdateChecklistInput,
    UpdateChecklistItemInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';

import { activityKeys } from './useActivity';
import { invalidateForList, markLocalRecordsChange, recordsKeys } from './useRecords';

/**
 * A9 — Checklists de un registro.
 *
 * Las keys cuelgan del namespace de los registros de la lista (índice 1 = la
 * lista, regla de oro nº 7): cualquier cambio de registros (edición,
 * realtime, otra pestaña) las refresca. La ficha las trae SEMBRADAS en su
 * bundle (`useRecordView`), así abrir un registro no sale a pedirlas.
 *
 * Todas las escrituras devuelven el estado completo de los checklists del
 * registro: se escribe en el cache tal cual (sin un segundo pedido), y se
 * refresca la tabla (el «☑ 3/8» de la fila y la columna de progreso) y la
 * actividad.
 */
export const checklistKeys = {
    forRecord: (listId: string | number, recordId: number) => ['records', String(listId), 'checklists', recordId] as const,
};

export const EMPTY_CHECKLISTS: RecordChecklists = { checklists: [], done: 0, total: 0 };

export function useRecordChecklists(listId: string | number | undefined, recordId: number | undefined) {
    // C3 — los checklists son del trabajo interno: un invitado no los pide.
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: checklistKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<RecordChecklists>(`/lists/${listId}/records/${recordId}/checklists`)).data,
        enabled: !isGuest && listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        staleTime: 15_000,
    });
}

/** Recalcula los totales (hechos / total) después de un cambio optimista. */
export function withTotals(checklists: RecordChecklists['checklists']): RecordChecklists {
    let done = 0;
    let total = 0;
    for (const c of checklists) {
        for (const i of c.items) {
            total++;
            if (i.done) done++;
        }
    }
    return { checklists, done, total };
}

/** Aplica un cambio a un ítem en el estado cacheado (optimista). */
export function patchItem(state: RecordChecklists, itemId: number, patch: Partial<ChecklistItem>): RecordChecklists {
    return withTotals(
        state.checklists.map((c) => ({
            ...c,
            items: c.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
        })),
    );
}

/** Reordena los ítems de un checklist según `ids` (optimista). */
export function reorderItemsIn(state: RecordChecklists, checklistId: number, ids: number[]): RecordChecklists {
    return withTotals(
        state.checklists.map((c) => {
            if (c.id !== checklistId) return c;
            const byId = new Map(c.items.map((i) => [i.id, i]));
            const ordered = ids.map((id) => byId.get(id)).filter((i): i is ChecklistItem => i !== undefined);
            const rest = c.items.filter((i) => !ids.includes(i.id));
            return { ...c, items: [...ordered, ...rest].map((i, n) => ({ ...i, position: n })) };
        }),
    );
}

function refreshAround(qc: QueryClient, listId: string | number): void {
    markLocalRecordsChange(qc, listId);
    // El «☑ 3/8» de la fila, la columna «Progreso del checklist» y el pie.
    invalidateForList(qc, recordsKeys.all, listId);
    invalidateForList(qc, activityKeys.all, listId);
}

type Op =
    | { kind: 'create'; input: CreateChecklistInput }
    | { kind: 'rename'; checklistId: number; patch: UpdateChecklistInput }
    | { kind: 'remove'; checklistId: number }
    | { kind: 'reorderChecklists'; ids: number[] }
    | { kind: 'addItems'; checklistId: number; input: CreateChecklistItemsInput }
    | { kind: 'reorderItems'; checklistId: number; ids: number[] }
    | { kind: 'updateItem'; itemId: number; patch: UpdateChecklistItemInput }
    | { kind: 'removeItem'; itemId: number };

async function run(listId: string | number, recordId: number, op: Op): Promise<RecordChecklists> {
    const base = `/lists/${listId}/records/${recordId}`;
    switch (op.kind) {
        case 'create':
            return (await api.post<RecordChecklists>(`${base}/checklists`, op.input)).data;
        case 'rename':
            return (await api.patch<RecordChecklists>(`${base}/checklists/${op.checklistId}`, op.patch)).data;
        case 'remove':
            return (await api.delete<RecordChecklists>(`${base}/checklists/${op.checklistId}`)).data;
        case 'reorderChecklists':
            return (await api.patch<RecordChecklists>(`${base}/checklists/reorder`, { ids: op.ids })).data;
        case 'addItems':
            return (await api.post<RecordChecklists>(`${base}/checklists/${op.checklistId}/items`, op.input)).data;
        case 'reorderItems':
            return (await api.patch<RecordChecklists>(`${base}/checklists/${op.checklistId}/items/reorder`, { ids: op.ids })).data;
        case 'updateItem':
            return (await api.patch<RecordChecklists>(`${base}/checklist-items/${op.itemId}`, op.patch)).data;
        case 'removeItem':
            return (await api.delete<RecordChecklists>(`${base}/checklist-items/${op.itemId}`)).data;
    }
}

/** El cambio optimista de cada operación (las que se pueden predecir). */
function optimistic(state: RecordChecklists, op: Op): RecordChecklists | null {
    switch (op.kind) {
        case 'updateItem': {
            const { checklist_id: _move, ...rest } = op.patch;
            if (_move !== undefined) return null;
            const patch: Partial<ChecklistItem> = { ...rest };
            if (rest.done !== undefined) patch.done_at = rest.done ? new Date().toISOString() : null;
            return patchItem(state, op.itemId, patch);
        }
        case 'removeItem':
            return withTotals(state.checklists.map((c) => ({ ...c, items: c.items.filter((i) => i.id !== op.itemId) })));
        case 'reorderItems':
            return reorderItemsIn(state, op.checklistId, op.ids);
        case 'rename':
            return op.patch.name === undefined
                ? null
                : withTotals(state.checklists.map((c) => (c.id === op.checklistId ? { ...c, name: op.patch.name! } : c)));
        case 'remove':
            return withTotals(state.checklists.filter((c) => c.id !== op.checklistId));
        case 'reorderChecklists': {
            const byId = new Map(state.checklists.map((c) => [c.id, c]));
            return withTotals(op.ids.map((id) => byId.get(id)).filter((c): c is RecordChecklists['checklists'][number] => c !== undefined));
        }
        default:
            return null;
    }
}

/**
 * Todas las operaciones sobre los checklists de UN registro. Marcar,
 * editar, reordenar y borrar son optimistas (se ven al instante; si el
 * servidor rechaza, vuelve el estado anterior).
 */
export function useChecklistOps(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    const key = checklistKeys.forRecord(listId, recordId);
    return useMutation<RecordChecklists, Error, Op, { prev: RecordChecklists | undefined }>({
        mutationFn: (op) => run(listId, recordId, op),
        onMutate: async (op) => {
            markLocalRecordsChange(qc, listId);
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData<RecordChecklists>(key);
            if (prev) {
                const next = optimistic(prev, op);
                if (next) qc.setQueryData(key, next);
            }
            return { prev };
        },
        onError: (_err, _op, ctx) => {
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
        },
        onSuccess: (data) => {
            qc.setQueryData(key, data);
            refreshAround(qc, listId);
        },
    });
}

/** «Convertir en subtarea»: crea el registro hijo y quita el ítem. */
export function useChecklistItemToSubtask(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (itemId: number) =>
            (await api.post<{ record: { id: number }; checklists: RecordChecklists }>(
                `/lists/${listId}/records/${recordId}/checklist-items/${itemId}/to-subtask`,
                {},
            )).data,
        onSuccess: (data) => {
            qc.setQueryData(checklistKeys.forRecord(listId, recordId), data.checklists);
            refreshAround(qc, listId);
        },
    });
}
