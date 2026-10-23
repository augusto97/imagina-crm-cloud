import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dayToYmd, type GanttBaseline, type GanttBundle, type GanttPdfRequest } from '@imagina-base/shared';

import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import type { RecordEntity } from '@/types/record';

import { invalidateForList, keepPreviousForList, recordsKeys } from './useRecords';

/**
 * B1 — Vista Gantt: TODO lo que dibuja la vista en UNA request
 * (`GET /lists/:l/records/gantt-bundle`, regla de oro nº 8): los registros con
 * alguna fecha en la ventana que se ve (más un margen), los padres de las
 * subtareas que entraron, una tanda de «Sin programar», las dependencias entre
 * lo que se muestra y la línea base de la vista.
 *
 * La key cuelga de `recordsKeys.forList(listId)`: una edición (optimista con
 * `patchRecordInCache`, rama `records/unscheduled`), el realtime o un alta la
 * refrescan sin código propio.
 */
export interface GanttBundleData extends Omit<GanttBundle, 'records' | 'unscheduled'> {
    records: RecordEntity[];
    unscheduled: RecordEntity[];
}

export interface UseGanttBundleArgs {
    listId: number | string | undefined;
    viewId?: number;
    startFieldId: number | null;
    endFieldId: number | null;
    /** Ventana pedida (días desde 1970-01-01, inclusive). */
    from: number;
    to: number;
    filterTree?: unknown;
    search?: string;
    sort?: string;
    subtasks: boolean;
}

/** Parámetros con orden estable (key estable → sin refetch inútil). */
export function ganttBundleParams(args: UseGanttBundleArgs): Record<string, unknown> {
    const params: Record<string, unknown> = {
        start_field_id: args.startFieldId,
        from: dayToYmd(args.from),
        to: dayToYmd(args.to),
    };
    if (args.endFieldId) params.end_field_id = args.endFieldId;
    if (args.viewId) params.view_id = args.viewId;
    if (args.filterTree) params.filter_tree = JSON.stringify(args.filterTree);
    if (args.search && args.search.trim() !== '') params.search = args.search.trim();
    if (args.sort) params.sort = args.sort;
    if (!args.subtasks) params.subtasks = 0;
    return params;
}

export const ganttKeys = {
    bundle: (listId: string | number, params: Record<string, unknown>) =>
        [...recordsKeys.forList(listId), 'gantt-bundle', params] as const,
};

export function useGanttBundle(args: UseGanttBundleArgs) {
    const qc = useQueryClient();
    const listId = args.listId ?? '';
    const params = ganttBundleParams(args);
    return useQuery({
        queryKey: ganttKeys.bundle(listId, params),
        queryFn: async () => (await api.get<GanttBundleData>(`/lists/${listId}/records/gantt-bundle`, { query: params })).data,
        enabled: listId !== '' && args.startFieldId !== null,
        // Crecer la ventana (scrollear) o cambiar el zoom deja la anterior a la
        // vista mientras llega la nueva: las barras no parpadean.
        placeholderData: keepPreviousForList<GanttBundleData>(qc, listId),
    });
}

/** «Guardar línea base» / «Quitar línea base» de una vista Gantt. */
export function useSaveGanttBaseline(listId: string | number, viewId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { name?: string }) =>
            (await api.post<GanttBaseline>(`/lists/${listId}/views/${viewId}/gantt-baseline`, input)).data,
        onSuccess: () => invalidateForList(qc, recordsKeys.all, listId),
    });
}

export function useDeleteGanttBaseline(listId: string | number, viewId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            await api.delete(`/lists/${listId}/views/${viewId}/gantt-baseline`);
        },
        onSuccess: () => invalidateForList(qc, recordsKeys.all, listId),
    });
}

/**
 * Exportar a PDF lo que se ve (el servidor lo arma con el mismo ACL, las
 * mismas filas y las mismas barras) y bajarlo.
 */
export async function downloadGanttPdf(listId: string | number, input: GanttPdfRequest): Promise<void> {
    const boot = getBootData();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
    const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/lists/${listId}/records/gantt-pdf`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1];
    const plain = /filename="?([^";]+)"?/i.exec(cd)?.[1];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = star ? decodeURIComponent(star) : plain ?? 'gantt.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
