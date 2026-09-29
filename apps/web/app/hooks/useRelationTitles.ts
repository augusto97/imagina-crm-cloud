import { useMemo } from 'react';
import { useQueries, useQuery, type QueryClient, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { titleFieldOf } from '@/lib/recordTitle';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { fieldsKeys } from './useFields';

/** id del registro vinculado → su título (vacío si no tiene nombre). */
export type RelationTitles = Record<number, string>;

const CHUNK = 200;

/** Lista destino de un campo relation (null si todavía no se configuró). */
export function relationTarget(field: FieldEntity): number | null {
    const t = (field.config as { target_list_id?: unknown }).target_list_id;
    return typeof t === 'number' && t > 0 ? t : null;
}

/** Ids vinculados de un valor relation (acepta el array o un id suelto). */
export function relationIds(value: unknown): number[] {
    const raw = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
    const out: number[] = [];
    for (const v of raw) {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/**
 * Títulos de registros de UNA lista por id, en lotes de 200 con `?ids=` (un
 * request por lote, nunca uno por registro — regla de oro nº 8). Los campos de
 * la lista destino salen del mismo cache que `useFields`.
 */
export async function fetchRelationTitles(qc: QueryClient, targetListId: number, ids: number[]): Promise<RelationTitles> {
    const out: RelationTitles = {};
    if (ids.length === 0) return out;
    const fields = await qc.ensureQueryData({
        queryKey: fieldsKeys.forList(targetListId),
        queryFn: async () => (await api.get<FieldEntity[]>(`/lists/${targetListId}/fields`)).data,
    });
    const title = titleFieldOf(fields);
    for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const res = await api.get<RecordEntity[]>(`/lists/${targetListId}/records`, {
            query: { ids: chunk.join(','), per_page: CHUNK },
        });
        for (const r of res.data) {
            const v = title ? r.fields[title.slug] : null;
            out[r.id] = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
        }
    }
    return out;
}

const key = (target: number, ids: number[]) => ['relation-titles', String(target), [...ids].sort((a, b) => a - b).join(',')] as const;

/** Títulos de un conjunto de ids (el selector de relación y la ficha). */
export function useRelationTitles(targetListId: number | null, ids: number[]) {
    const qc = useQueryClient();
    return useQuery({
        queryKey: key(targetListId ?? 0, ids),
        queryFn: () => fetchRelationTitles(qc, targetListId as number, ids),
        enabled: targetListId !== null && ids.length > 0,
        staleTime: 30_000,
    });
}

/**
 * Títulos para TODAS las columnas relation de una página de la tabla: una
 * query por columna con la unión de ids de las filas visibles.
 */
export function useRelationTitlesForRows(fields: FieldEntity[], rows: RecordEntity[]): Map<number, RelationTitles> {
    const qc = useQueryClient();
    const specs = useMemo(() => {
        const rel = fields.filter((f) => f.type === 'relation' && relationTarget(f) !== null);
        return rel.map((f) => {
            const ids = new Set<number>();
            const walk = (list: RecordEntity[]): void => {
                for (const r of list) {
                    for (const id of relationIds(r.relations?.[f.slug])) ids.add(id);
                }
            };
            walk(rows);
            return { fieldId: f.id, target: relationTarget(f) as number, ids: [...ids] };
        });
    }, [fields, rows]);
    const results = useQueries({
        queries: specs.map((s) => ({
            queryKey: key(s.target, s.ids),
            queryFn: () => fetchRelationTitles(qc, s.target, s.ids),
            enabled: s.ids.length > 0,
            staleTime: 30_000,
        })),
    });
    // `results` cambia de identidad en cada render: la firma de actualización
    // es lo que dice si los datos cambiaron.
    const sig = results.map((r) => r.dataUpdatedAt).join(',');
    return useMemo(() => {
        const m = new Map<number, RelationTitles>();
        specs.forEach((s, i) => m.set(s.fieldId, results[i]?.data ?? {}));
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [specs, sig]);
}
