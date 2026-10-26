import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuestInviteResult, GuestLevel, GuestSummary, RecordShareDto, ShareRecordInput, SharedWithMeDto } from '@imagina-base/shared';

import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';

import { listsKeys } from './useLists';

/**
 * C3 — Invitados externos: personas de afuera con una lista entera o algunos
 * registros compartidos. El servidor decide todo (quién comparte, qué nivel,
 * el tope del plan); estos hooks sólo hablan con la API.
 */
export const guestsKeys = {
    all: ['guests'] as const,
    workspace: () => [...guestsKeys.all, 'workspace'] as const,
    list: (list: string | number) => [...guestsKeys.all, 'list', String(list)] as const,
    record: (list: string | number, recordId: number) => [...guestsKeys.all, 'record', String(list), recordId] as const,
    sharedWithMe: () => [...guestsKeys.all, 'shared-with-me'] as const,
};

export interface ListGuest {
    user_id: number;
    name: string;
    email: string;
    pending: boolean;
    level: GuestLevel;
}

/** Ajustes → Miembros → «Invitados» (admin). */
export function useWorkspaceGuests(enabled = true) {
    return useQuery({
        queryKey: guestsKeys.workspace(),
        queryFn: async () => (await api.get<GuestSummary[]>('/workspaces/current/guests')).data ?? [],
        enabled,
    });
}

/** Invitados con acceso a una lista entera (Compartir → Con tu equipo). */
export function useListGuests(list: string | number | undefined, enabled = true) {
    return useQuery({
        queryKey: guestsKeys.list(list ?? ''),
        queryFn: async () => (await api.get<ListGuest[]>(`/lists/${list}/guests`)).data ?? [],
        enabled: enabled && list !== undefined && list !== '',
    });
}

/** Personas de afuera con acceso a UN registro (ficha → Compartir). */
export function useRecordShares(list: string | number | undefined, recordId: number | undefined, enabled = true) {
    return useQuery({
        queryKey: guestsKeys.record(list ?? '', recordId ?? 0),
        queryFn: async () => (await api.get<RecordShareDto[]>(`/lists/${list}/records/${recordId}/shares`)).data ?? [],
        enabled: enabled && list !== undefined && list !== '' && recordId !== undefined && recordId > 0,
    });
}

/** Lo que ve un invitado: «Compartido conmigo». */
export function useSharedWithMe(enabled = true) {
    return useQuery({
        queryKey: guestsKeys.sharedWithMe(),
        queryFn: async () => (await api.get<SharedWithMeDto>('/me/shared')).data,
        enabled,
        staleTime: 30_000,
    });
}

const LEVEL_RANK: Record<GuestLevel, number> = { view: 1, comment: 2, edit: 3 };

/** El mayor de dos niveles de invitado (null = sin acceso). */
export function maxGuestLevel(a: GuestLevel | null | undefined, b: GuestLevel | null | undefined): GuestLevel | null {
    if (!a) return b ?? null;
    if (!b) return a;
    return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/** Qué le compartieron a un invitado en una lista (pura, para tests). */
export function guestAccessIn(
    shared: SharedWithMeDto | undefined,
    listId: number | undefined,
    recordId?: number,
): { list: GuestLevel | null; record: GuestLevel | null } {
    if (!shared || listId === undefined) return { list: null, record: null };
    const list = shared.lists.find((l) => l.id === listId)?.level ?? null;
    const own = recordId !== undefined
        ? shared.records.find((r) => r.id === recordId && r.list_id === listId)?.level ?? null
        : null;
    return { list, record: maxGuestLevel(list, own) };
}

/**
 * C3 — Lo que puede hacer un INVITADO en una lista (y en un registro). Para
 * quien no es invitado devuelve `isGuest: false` y no pide nada. Sólo oculta
 * controles: el servidor decide igual fila por fila.
 */
export function useGuestAccess(
    listId: number | undefined,
    recordId?: number,
): { isGuest: boolean; list: GuestLevel | null; record: GuestLevel | null } {
    const isGuest = useIsGuest();
    const shared = useSharedWithMe(isGuest);
    if (!isGuest) return { isGuest: false, list: null, record: null };
    return { isGuest: true, ...guestAccessIn(shared.data, listId, recordId) };
}

/**
 * Para un invitado: qué registros de la lista puede EDITAR. `null` = sin
 * restricción por fila (tiene la lista entera en «Puede editar»). Pura.
 */
export function guestEditableRowsIn(shared: SharedWithMeDto | undefined, listId: number): Set<number> | null {
    if (!shared) return new Set();
    if (shared.lists.find((l) => l.id === listId)?.level === 'edit') return null;
    return new Set(shared.records.filter((r) => r.list_id === listId && r.level === 'edit').map((r) => r.id));
}

/**
 * C3 — En la tabla, un invitado edita sólo las filas que le compartieron en
 * «Puede editar». Para el equipo devuelve `null` (sin cambios).
 */
export function useGuestEditableRows(listId: number): Set<number> | null {
    const isGuest = useIsGuest();
    const shared = useSharedWithMe(isGuest);
    return useMemo(() => (isGuest ? guestEditableRowsIn(shared.data, listId) : null), [isGuest, shared.data, listId]);
}

/**
 * C3 — ¿Puede comentar (y reaccionar) en este registro? El equipo, siempre
 * (como antes); un invitado, sólo con «Puede comentar» o «Puede editar».
 */
export function useGuestCanComment(listId: number, recordId: number): boolean {
    const g = useGuestAccess(listId, recordId);
    return !g.isGuest || g.record === 'comment' || g.record === 'edit';
}

function useGuestMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: guestsKeys.all });
            // El acceso por persona vive en los permisos de la lista.
            void qc.invalidateQueries({ queryKey: listsKeys.all });
            void qc.invalidateQueries({ queryKey: ['billing'] });
        },
    });
}

export function useShareListWithGuest(list: string | number) {
    return useGuestMutation(async (input: ShareRecordInput) => (await api.post<GuestInviteResult>(`/lists/${list}/guests`, input)).data);
}

export function useSetListGuestLevel(list: string | number) {
    return useGuestMutation(async ({ userId, level }: { userId: number; level: GuestLevel | null }) => {
        if (level === null) await api.delete(`/lists/${list}/guests/${userId}`);
        else await api.patch(`/lists/${list}/guests/${userId}`, { level });
    });
}

export function useShareRecord(list: string | number, recordId: number) {
    return useGuestMutation(
        async (input: ShareRecordInput) => (await api.post<RecordShareDto>(`/lists/${list}/records/${recordId}/shares`, input)).data,
    );
}

export function useSetRecordShareLevel() {
    return useGuestMutation(
        async ({ list, recordId, shareId, level }: { list: string | number; recordId: number; shareId: number; level: GuestLevel | null }) => {
            if (level === null) await api.delete(`/lists/${list}/records/${recordId}/shares/${shareId}`);
            else await api.patch(`/lists/${list}/records/${recordId}/shares/${shareId}`, { level });
        },
    );
}

export function useRemoveGuest() {
    return useGuestMutation(async (userId: number) => {
        await api.delete(`/workspaces/current/guests/${userId}`);
    });
}

export function useResendGuestInvite() {
    return useMutation({
        mutationFn: async (userId: number) => {
            await api.post(`/workspaces/current/guests/${userId}/resend-invite`, {});
        },
    });
}
