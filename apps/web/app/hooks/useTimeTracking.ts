import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ActiveTimerDto, RecordTimeDto, TimeEntryDto } from '@imagina-base/shared';

import { invalidateForList, markLocalRecordsChange, recordsKeys } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';
import { getBootData } from '@/lib/boot';

/**
 * v0.1.291 — Registro de tiempo por registro (cronómetro + cargas a mano).
 *
 * Claves: el tiempo de un registro va por lista con el id en el índice 1
 * (regla de oro nº 7: `invalidateForList` lo encuentra por id o por slug); el
 * cronómetro en curso es de la PERSONA, en toda la empresa (la barra superior).
 */
export const timeKeys = {
    all: ['record-time'] as const,
    forRecord: (listId: string | number, recordId: number) => ['record-time', String(listId), recordId] as const,
    active: ['active-timer'] as const,
};

export function useRecordTime(listId: string | number | undefined, recordId: number | undefined) {
    // C3 — un invitado no registra tiempo en la empresa (403 en el servidor).
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: timeKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<RecordTimeDto>(`/lists/${listId}/records/${recordId}/time`)).data,
        enabled: listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0 && !isGuest,
        staleTime: 30_000,
    });
}

/** El cronómetro en curso de quien mira (o null). Lo refresca el realtime. */
export function useActiveTimer(enabled = true) {
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: timeKeys.active,
        queryFn: async () => (await api.get<ActiveTimerDto | null>('/me/timer')).data ?? null,
        enabled: enabled && getBootData().tenantId !== null && !isGuest,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
    });
}

/** Lo que cambia cuando se toca el tiempo de un registro. */
export function invalidateTime(qc: QueryClient, listId: string | number): void {
    invalidateForList(qc, timeKeys.all, listId);
    void qc.invalidateQueries({ queryKey: timeKeys.active });
    // La columna «Tiempo registrado» y los totales del pie.
    invalidateForList(qc, recordsKeys.all, listId);
    markLocalRecordsChange(qc, listId);
}

export function useStartTimer(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (note?: string) =>
            (
                await api.post<{ entry: TimeEntryDto; stopped: TimeEntryDto | null }>(
                    `/lists/${listId}/records/${recordId}/time/start`,
                    note ? { note } : {},
                )
            ).data,
        onSuccess: (res) => {
            invalidateTime(qc, listId);
            // El que se detuvo puede ser de OTRA lista.
            if (res.stopped && String(res.stopped.list_id) !== String(listId)) invalidateTime(qc, res.stopped.list_id);
        },
    });
}

export function useStopTimer() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.post<TimeEntryDto | null>('/me/timer/stop', {})).data ?? null,
        onSuccess: (stopped) => {
            void qc.invalidateQueries({ queryKey: timeKeys.active });
            if (stopped) invalidateTime(qc, stopped.list_id);
        },
    });
}

export function useCreateTimeEntry(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: { work_date: string; duration: string | number; note?: string }) =>
            (await api.post<TimeEntryDto>(`/lists/${listId}/records/${recordId}/time`, input)).data,
        onSuccess: () => invalidateTime(qc, listId),
    });
}

export function useUpdateTimeEntry(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...patch }: { id: number; work_date?: string; duration?: string | number; note?: string }) =>
            (await api.patch<TimeEntryDto>(`/lists/${listId}/records/${recordId}/time/${id}`, patch)).data,
        onSuccess: () => invalidateTime(qc, listId),
    });
}

export function useDeleteTimeEntry(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/records/${recordId}/time/${id}`);
        },
        onSuccess: () => invalidateTime(qc, listId),
    });
}

/** Baja el CSV de las entradas de la lista (con el ACL de quien exporta). */
export async function downloadTimeCsv(listKey: string | number): Promise<void> {
    const boot = getBootData();
    const headers: Record<string, string> = {};
    if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
    const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/lists/${listKey}/time/export`, {
        headers,
        credentials: 'include',
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const name = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `tiempo-${listKey}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Segundos que lleva un cronómetro en curso (desde `started_at`). */
export function runningSeconds(entry: Pick<TimeEntryDto, 'started_at' | 'running'> | null | undefined, now = Date.now()): number {
    if (!entry || !entry.running || !entry.started_at) return 0;
    const iso = entry.started_at.includes('Z') || entry.started_at.includes('+') ? entry.started_at : `${entry.started_at.replace(' ', 'T')}Z`;
    const started = Date.parse(iso);
    return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : 0;
}
