import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDaysYmd, type CalendarSource } from '@imagina-base/shared';

import { api } from '@/lib/api';
import type { RecordEntity } from '@/types/record';

import { keepPreviousForList, recordsKeys } from './useRecords';

/**
 * B4 — Calendario completo: el RANGO visible en UNA request
 * (`GET /lists/:l/records/calendar-bundle`). El servidor devuelve los eventos
 * de las fuentes pedidas que se solapan con el rango (también los que
 * empiezan antes y los de varios días), con un tope por día y el conteo
 * exacto de cada día — el «+N más» que no viajó.
 *
 * La key cuelga de `recordsKeys.forList(listId)`: cualquier cambio de
 * registros de la lista (mutaciones, realtime) la refresca, y el optimista de
 * `useUpdateRecord` / `useBatchUpdateRecords` la parcha (`patchRecordInCache`,
 * rama `records` — también las páginas de la agenda).
 */
export interface CalendarBundleResponse {
    meta: {
        from: string;
        to: string;
        time_zone: string;
        total: number;
        truncated: boolean;
        per_day: number;
        sources: Array<{
            key: string;
            start_field_id: number;
            end_field_id: number | null;
            duration_field_id: number | null;
            ok: boolean;
            reason?: string;
            count: number;
        }>;
    };
    days: Record<string, { n: number; more: number }>;
    /** Los registros de los eventos que viajaron (`fields` por slug). */
    records: RecordEntity[];
}

export interface CalendarBundleArgs {
    listId: number | string | undefined;
    sources: readonly CalendarSource[];
    from: string;
    to: string;
    filterTree?: unknown;
    search?: string;
    perDay: number;
    /** Día → cuántos traer (un día desplegado). */
    limits?: Record<string, number>;
}

/** La zona del navegador: la usa el servidor sólo si la empresa no eligió una. */
function browserZone(): string | undefined {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return typeof tz === 'string' && tz !== '' ? tz : undefined;
    } catch {
        return undefined;
    }
}

/** Parámetros con orden estable (key estable → sin refetch inútil). */
export function calendarBundleParams(args: Omit<CalendarBundleArgs, 'listId'>): Record<string, unknown> {
    const params: Record<string, unknown> = {
        from: args.from,
        to: args.to,
        sources: JSON.stringify(
            args.sources.map((s) => ({
                key: s.id,
                start: s.startFieldId,
                ...(s.endFieldId !== null ? { end: s.endFieldId } : {}),
                ...(s.endFieldId === null && s.durationFieldId !== null ? { dur: s.durationFieldId } : {}),
            })),
        ),
        per_day: args.perDay,
    };
    if (args.filterTree) params.filter_tree = JSON.stringify(args.filterTree);
    if (args.search && args.search.trim() !== '') params.search = args.search.trim();
    const limits = Object.entries(args.limits ?? {})
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (limits.length > 0) params.limits = JSON.stringify(Object.fromEntries(limits));
    const tz = browserZone();
    if (tz) params.tz = tz;
    return params;
}

async function fetchBundle(listId: number | string, params: Record<string, unknown>): Promise<CalendarBundleResponse> {
    const res = await api.get<CalendarBundleResponse>(`/lists/${listId}/records/calendar-bundle`, { query: params });
    return res.data;
}

export function useCalendarBundle(args: CalendarBundleArgs & { enabled?: boolean }) {
    const qc = useQueryClient();
    const listId = args.listId ?? '';
    const params = calendarBundleParams(args);
    return useQuery({
        queryKey: [...recordsKeys.forList(listId), 'calendar-bundle', params] as const,
        queryFn: () => fetchBundle(listId, params),
        enabled: listId !== '' && args.sources.length > 0 && args.enabled !== false,
        placeholderData: keepPreviousForList<CalendarBundleResponse>(qc, listId),
    });
}

/**
 * La agenda: páginas de `pageDays` días desde `from`, que se piden a medida
 * que se baja (scroll infinito por rango).
 */
export function useCalendarAgenda(args: Omit<CalendarBundleArgs, 'to'> & { pageDays: number; enabled?: boolean }) {
    const listId = args.listId ?? '';
    const base = calendarBundleParams({ ...args, to: args.from });
    return useInfiniteQuery({
        queryKey: [...recordsKeys.forList(listId), 'calendar-agenda', base, args.pageDays] as const,
        initialPageParam: 0,
        queryFn: ({ pageParam }) => {
            const from = addDaysYmd(args.from, pageParam * args.pageDays);
            const to = addDaysYmd(from, args.pageDays - 1);
            return fetchBundle(listId, { ...base, from, to });
        },
        getNextPageParam: (_last, pages) => (pages.length < 24 ? pages.length : undefined),
        enabled: listId !== '' && args.sources.length > 0 && args.enabled !== false,
    });
}
