import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    CreateWhatsNewInput,
    MarkWhatsNewSeenInput,
    PlatformWhatsNewEntry,
    PlatformWhatsNewList,
    UpdateWhatsNewInput,
    WhatsNewEvent,
    WhatsNewFeed,
    WhatsNewItem,
    WhatsNewKind,
} from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';

/**
 * Fase 7 — Novedades. Un solo pedido alimenta el botón de la barra, el panel,
 * la franja de avisos y el diálogo de destacadas (`feed`). La página de
 * historial pagina por su cuenta. Las novedades no viajan por realtime: cambian
 * con una actualización o cuando el operador publica, así que alcanza con
 * volver a mirar cada 10 minutos y al volver a la pestaña.
 */
export const whatsNewKeys = {
    all: ['whats-new'] as const,
    feed: (tenantId: number | null) => ['whats-new', 'feed', tenantId] as const,
    history: (tenantId: number | null, kind: WhatsNewKind | 'all') => ['whats-new', 'history', tenantId, kind] as const,
    platform: ['whats-new', 'platform'] as const,
};

const FEED_LIMIT = 30;

export function useWhatsNewFeed(enabled = true) {
    const tenantId = useSession((s) => s.activeTenantId);
    const hasUser = useSession((s) => s.user !== null);
    return useQuery({
        queryKey: whatsNewKeys.feed(tenantId),
        queryFn: async () => (await api.get<WhatsNewFeed>('/me/whats-new', { query: { limit: FEED_LIMIT } })).data,
        enabled: enabled && hasUser && tenantId !== null,
        staleTime: 60_000,
        refetchInterval: 10 * 60 * 1000,
        refetchOnWindowFocus: true,
        retry: false,
    });
}

export function useWhatsNewHistory(kind: WhatsNewKind | 'all') {
    const tenantId = useSession((s) => s.activeTenantId);
    return useInfiniteQuery({
        queryKey: whatsNewKeys.history(tenantId, kind),
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) =>
            (
                await api.get<WhatsNewFeed>('/me/whats-new', {
                    query: { limit: 20, kind: kind === 'all' ? undefined : kind, before: pageParam ?? undefined },
                })
            ).data,
        getNextPageParam: (last) => (last.has_more ? last.next_before : null),
        enabled: tenantId !== null,
        staleTime: 60_000,
    });
}

/** Ajusta el cache de todas las listas de novedades (feed e historial). */
function patchItems(qc: QueryClient, fn: (item: WhatsNewItem) => WhatsNewItem): void {
    qc.setQueriesData<WhatsNewFeed>({ queryKey: ['whats-new', 'feed'] }, (old) =>
        old ? { ...old, items: old.items.map(fn), notices: old.notices.map(fn), featured: old.featured ? fn(old.featured) : null } : old,
    );
    qc.setQueriesData<{ pages: WhatsNewFeed[]; pageParams: unknown[] }>({ queryKey: ['whats-new', 'history'] }, (old) =>
        old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map(fn) })) } : old,
    );
}

export function useMarkWhatsNewSeen() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: MarkWhatsNewSeenInput) =>
            (await api.post<{ unseen_count: number }>('/me/whats-new/seen', input)).data,
        onSuccess: (res, input) => {
            const ids = new Set(input.ids ?? []);
            patchItems(qc, (i) => (input.all || ids.has(i.id) ? { ...i, is_new: false } : i));
            qc.setQueriesData<WhatsNewFeed>({ queryKey: ['whats-new', 'feed'] }, (old) =>
                old ? { ...old, unseen_count: res.unseen_count } : old,
            );
        },
    });
}

export function useWhatsNewEvent() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, event }: { id: number; event: WhatsNewEvent }) =>
            (await api.post<{ ok: true }>(`/me/whats-new/${id}/events`, { event })).data,
        onMutate: ({ id, event }) => {
            // Optimista: la franja y el diálogo no esperan al servidor para irse.
            qc.setQueriesData<WhatsNewFeed>({ queryKey: ['whats-new', 'feed'] }, (old) => {
                if (!old) return old;
                const wasNew = old.items.some((i) => i.id === id && i.is_new);
                return {
                    ...old,
                    unseen_count: wasNew ? Math.max(0, old.unseen_count - 1) : old.unseen_count,
                    notices: event === 'dismissed' ? old.notices.filter((n) => n.id !== id) : old.notices,
                    featured: old.featured?.id === id ? null : old.featured,
                };
            });
            patchItems(qc, (i) => (i.id === id ? { ...i, is_new: false } : i));
        },
    });
}

// ─────────────────────────── Plataforma → Novedades ───────────────────────────

export function usePlatformWhatsNew() {
    return useQuery({
        queryKey: whatsNewKeys.platform,
        queryFn: async () => (await api.get<PlatformWhatsNewList>('/platform/whats-new')).data,
        staleTime: 15_000,
    });
}

function invalidateAll(qc: QueryClient): void {
    void qc.invalidateQueries({ queryKey: whatsNewKeys.all });
}

export function useCreateWhatsNew() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateWhatsNewInput) => (await api.post<PlatformWhatsNewEntry>('/platform/whats-new', input)).data,
        onSuccess: () => invalidateAll(qc),
    });
}

export function useUpdateWhatsNew() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, input }: { id: number; input: UpdateWhatsNewInput }) =>
            (await api.patch<PlatformWhatsNewEntry>(`/platform/whats-new/${id}`, input)).data,
        onSuccess: () => invalidateAll(qc),
    });
}

export function useRestoreWhatsNew() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.post<PlatformWhatsNewEntry>(`/platform/whats-new/${id}/restore`, {})).data,
        onSuccess: () => invalidateAll(qc),
    });
}

export function useDeleteWhatsNew() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => (await api.delete<null>(`/platform/whats-new/${id}`)).data,
        onSuccess: () => invalidateAll(qc),
    });
}

/** Tope de una imagen (espejo del servidor, para cortar antes de subir). */
export const MAX_WHATS_NEW_IMAGE_BYTES = 5 * 1024 * 1024;

/** Sube una imagen de novedad (PNG, JPG, WebP o GIF). Devuelve su URL. */
export async function uploadWhatsNewImage(file: File): Promise<string> {
    if (file.size > MAX_WHATS_NEW_IMAGE_BYTES) throw new Error('La imagen supera los 5 MB');
    const boot = getBootData();
    const form = new FormData();
    form.append('file', file);
    // Sin Content-Type manual: el navegador arma el multipart.
    const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/platform/whats-new/images`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        body: form,
    });
    const payload = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
    if (!res.ok || typeof payload?.url !== 'string') throw new Error(payload?.message ?? `HTTP ${res.status}`);
    return payload.url;
}
