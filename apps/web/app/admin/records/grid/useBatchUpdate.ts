import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BatchCreateRecordsResult, BatchDeleteRecordsResult, BatchUpdateRecordsResult } from '@imagina-base/shared';

import { activityKeys } from '@/hooks/useActivity';
import {
    invalidateForList,
    listIdentifiersFor,
    markLocalRecordsChange,
    patchRecordInCache,
    recordsKeys,
} from '@/hooks/useRecords';
import { api } from '@/lib/api';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * v0.1.287 — Escribe VARIAS celdas de varias filas en UNA llamada
 * (`PATCH /lists/:l/records/batch`): pegar un bloque, rellenar hacia abajo,
 * borrar un rango y deshacer/rehacer. Optimista como la edición de una celda
 * (la tabla plana y la agrupada ven el cambio al instante) y, al terminar,
 * refresca la lista y la actividad.
 */
export interface BatchCell {
    recordId: number;
    field: FieldEntity;
    value: unknown;
}

export interface BatchUpdateArgs {
    cells: BatchCell[];
    /**
     * Deshacer/rehacer: el valor que se cree vigente en cada celda (misma
     * clave que `cells`). Si alguien lo cambió después, el servidor no toca
     * esa fila y la devuelve como conflicto.
     */
    expect?: BatchCell[];
}

/** Lo que devuelve el servidor, con el valor que QUEDÓ en cada celda escrita. */
export interface BatchUpdateOutcome extends BatchUpdateRecordsResult {
    /** `${recordId}:${fieldId}` → valor guardado (lo que sirve de base para deshacer). */
    written: Map<string, unknown>;
}

const MAX_ITEMS = 500;

export function cellKey(recordId: number, fieldId: number): string {
    return `${recordId}:${fieldId}`;
}

export function useBatchUpdateRecords(listId: number) {
    const qc = useQueryClient();
    return useMutation<BatchUpdateOutcome, Error, BatchUpdateArgs, { snapshots: Array<[readonly unknown[], unknown]> }>({
        mutationFn: async ({ cells, expect }) => {
            const byRecord = new Map<number, { data: Record<string, unknown>; expect?: Record<string, unknown> }>();
            for (const c of cells) {
                const item = byRecord.get(c.recordId) ?? { data: {} };
                // `undefined` (la celda nunca tuvo valor) viaja como null: si
                // no, JSON lo descarta y deshacer no vaciaba la celda.
                item.data[`f${c.field.id}`] = c.value === undefined ? null : c.value;
                byRecord.set(c.recordId, item);
            }
            for (const c of expect ?? []) {
                const item = byRecord.get(c.recordId);
                if (!item) continue;
                item.expect = { ...(item.expect ?? {}), [`f${c.field.id}`]: c.value === undefined ? null : c.value };
            }
            const items = [...byRecord].map(([id, it]) => ({ id, data: it.data, ...(it.expect ? { expect: it.expect } : {}) }));
            const outcome: BatchUpdateOutcome = { updated: [], failed: [], cell_errors: [], written: new Map() };
            // Tandas de 500 (el tope del servidor).
            for (let i = 0; i < items.length; i += MAX_ITEMS) {
                const res = await api.patch<BatchUpdateRecordsResult>(`/lists/${listId}/records/batch`, { items: items.slice(i, i + MAX_ITEMS) });
                outcome.updated.push(...res.data.updated);
                outcome.failed.push(...res.data.failed);
                outcome.cell_errors.push(...res.data.cell_errors);
            }
            const failedCells = new Set(outcome.cell_errors.map((e) => `${e.id}:${e.key}`));
            const relKeys = new Set(cells.filter((c) => c.field.type === 'relation').map((c) => `f${c.field.id}`));
            for (const rec of outcome.updated) {
                for (const c of cells) {
                    if (c.recordId !== rec.id) continue;
                    const key = `f${c.field.id}`;
                    if (failedCells.has(`${rec.id}:${key}`)) continue;
                    const stored = relKeys.has(key) ? rec.relations?.[key] ?? [] : rec.data[key];
                    outcome.written.set(cellKey(rec.id, c.field.id), stored ?? null);
                }
            }
            return outcome;
        },
        onMutate: async ({ cells }) => {
            markLocalRecordsChange(qc, listId);
            const ids = listIdentifiersFor(qc, listId);
            const matchesList = (k: readonly unknown[]): boolean =>
                Array.isArray(k) && k.length >= 2 && k[0] === 'records' && typeof k[1] === 'string' && ids.has(k[1]);
            await qc.cancelQueries({ predicate: (q) => matchesList(q.queryKey) });
            const byRecord = new Map<number, BatchCell[]>();
            for (const c of cells) byRecord.set(c.recordId, [...(byRecord.get(c.recordId) ?? []), c]);
            const snapshots: Array<[readonly unknown[], unknown]> = [];
            for (const [key, data] of qc.getQueriesData<unknown>({ predicate: (q) => matchesList(q.queryKey) })) {
                let next: unknown = data;
                let touched = false;
                for (const [id, list] of byRecord) {
                    const patched = patchRecordInCache(next, id, (rec: RecordEntity) => applyCells(rec, list));
                    if (patched !== undefined) {
                        next = patched;
                        touched = true;
                    }
                }
                if (!touched) continue;
                snapshots.push([key, data]);
                qc.setQueryData(key, next);
            }
            return { snapshots };
        },
        onError: (_err, _vars, ctx) => {
            for (const [key, snap] of ctx?.snapshots ?? []) qc.setQueryData(key, snap);
        },
        onSettled: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
        },
    });
}

function applyCells(rec: RecordEntity, cells: BatchCell[]): RecordEntity {
    const fields = { ...rec.fields };
    let relations = rec.relations;
    for (const c of cells) {
        if (c.field.type === 'relation') {
            relations = { ...(relations ?? {}), [c.field.slug]: Array.isArray(c.value) ? (c.value as number[]) : [] };
        } else {
            fields[c.field.slug] = c.value;
        }
    }
    return { ...rec, fields, relations };
}

/**
 * v0.1.294 — Crea varias filas en UNA llamada (`POST …/records/batch`): pegar
 * desde Excel más filas de las que hay debajo, y rehacer ese pegado. `data`
 * va por `f{id}`.
 */
export function useBatchCreateRecords(listId: number) {
    const qc = useQueryClient();
    return useMutation<BatchCreateRecordsResult, Error, Array<Record<string, unknown>>>({
        mutationFn: async (rows) => {
            const out: BatchCreateRecordsResult = { created: [], failed: [] };
            for (let i = 0; i < rows.length; i += MAX_ITEMS) {
                const slice = rows.slice(i, i + MAX_ITEMS);
                const res = await api.post<BatchCreateRecordsResult>(`/lists/${listId}/records/batch`, { items: slice.map((data) => ({ data })) });
                out.created.push(...res.data.created.map((c) => ({ ...c, index: c.index + i })));
                out.failed.push(...res.data.failed.map((f) => ({ ...f, index: f.index + i })));
            }
            return out;
        },
        onMutate: () => markLocalRecordsChange(qc, listId),
        onSettled: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
        },
    });
}

/**
 * v0.1.294 — Borra varias filas (`POST …/records/batch-delete`) con el valor
 * que se cree vigente en cada una: deshacer un pegado que creó registros nunca
 * borra uno que alguien cambió después.
 */
export function useBatchDeleteRecords(listId: number) {
    const qc = useQueryClient();
    return useMutation<BatchDeleteRecordsResult, Error, Array<{ id: number; expect?: Record<string, unknown> }>>({
        mutationFn: async (items) => {
            const out: BatchDeleteRecordsResult = { deleted: [], failed: [] };
            for (let i = 0; i < items.length; i += MAX_ITEMS) {
                const res = await api.post<BatchDeleteRecordsResult>(`/lists/${listId}/records/batch-delete`, { items: items.slice(i, i + MAX_ITEMS) });
                out.deleted.push(...res.data.deleted);
                out.failed.push(...res.data.failed);
            }
            return out;
        },
        onMutate: () => markLocalRecordsChange(qc, listId),
        onSettled: () => {
            markLocalRecordsChange(qc, listId);
            invalidateForList(qc, recordsKeys.all, listId);
            invalidateForList(qc, activityKeys.all, listId);
        },
    });
}
