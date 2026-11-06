import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { mostUsedKey, type MostUsedState, type UpdateMostUsedInput } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { api } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';
import { clearMostUsedQueue, flushMostUsed, resetShown, setMostUsedFlushListener, stableShown } from '@/lib/mostUsed';

/**
 * v0.1.385 — «Más usadas» del menú de Listas: las listas y tableros que la
 * persona usa, por empresa (`GET /me/most-used`). La key lleva la empresa:
 * al cambiar de empresa cada una tiene lo suyo.
 */
export function mostUsedQueryKey(tenantId: number | null): readonly unknown[] {
    return ['most-used', tenantId] as const;
}

export interface MostUsedItem {
    key: string;
    kind: 'list' | 'dashboard';
    id: number;
    label: string;
    href: string;
    icon: string | null;
    color: string | null;
}

export function useMostUsedState() {
    const tenantId = useSession((s) => s.activeTenantId);
    const isGuest = useIsGuest();
    return useQuery({
        queryKey: mostUsedQueryKey(tenantId),
        queryFn: async (): Promise<MostUsedState> => {
            const res = await api.get<MostUsedState>('/me/most-used');
            return { enabled: res.data?.enabled !== false, items: Array.isArray(res.data?.items) ? res.data.items : [] };
        },
        enabled: !isGuest && tenantId !== null,
        // El orden se fija al abrir la app: no se vuelve a pedir solo. Lo que
        // se anota después llega con la respuesta de cada envío.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    });
}

/**
 * Conecta la cola del navegador con el caché: lo que responde cada envío
 * actualiza la sección (con el orden estable), y al abrir la app se manda lo
 * que quedó pendiente de la vez anterior. También manda la cola al ocultar
 * la pestaña. Se monta una vez, en el shell.
 */
export function useMostUsedSync(): void {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const impersonating = useSession((s) => s.impersonating !== undefined);
    const isGuest = useIsGuest();

    useEffect(() => {
        setMostUsedFlushListener((tid, state) => qc.setQueryData(mostUsedQueryKey(tid), state));
        return () => setMostUsedFlushListener(null);
    }, [qc]);

    useEffect(() => {
        if (tenantId === null || isGuest || impersonating) return;
        void flushMostUsed(tenantId);
        const onHide = (): void => {
            if (document.visibilityState === 'hidden') void flushMostUsed(tenantId, { keepalive: true });
        };
        document.addEventListener('visibilitychange', onHide);
        return () => document.removeEventListener('visibilitychange', onHide);
    }, [tenantId, isGuest, impersonating]);
}

/**
 * Lo que se MUESTRA: las que califican, resueltas contra las listas y
 * tableros que la persona ve (las borradas o sin acceso no salen), en un
 * orden que no se mueve mientras trabaja. Vacío si está apagada.
 */
export function useMostUsedItems(): { enabled: boolean; items: MostUsedItem[]; ready: boolean } {
    const tenantId = useSession((s) => s.activeTenantId);
    const state = useMostUsedState();
    const lists = useLists();
    const dashboards = useDashboards();
    const dashboardsReady = dashboards.data !== undefined || dashboards.fetchStatus === 'idle';
    const ready = state.data !== undefined && lists.data !== undefined && dashboardsReady;

    const items = useMemo((): MostUsedItem[] => {
        if (!ready || tenantId === null || !state.data?.enabled) return [];
        const byList = new Map((lists.data ?? []).map((l) => [l.id, l]));
        const byDash = new Map((dashboards.data ?? []).map((d) => [d.id, d]));
        const resolved = new Map<string, MostUsedItem>();
        for (const ref of state.data.items) {
            const key = mostUsedKey(ref);
            if (ref.kind === 'list') {
                const l = byList.get(ref.id);
                if (l) resolved.set(key, { key, kind: 'list', id: l.id, label: l.name, href: `/lists/${l.slug}/records`, icon: l.icon ?? null, color: l.color ?? null });
            } else {
                const d = byDash.get(ref.id);
                if (!d) continue;
                const s = (d.settings ?? {}) as Record<string, unknown>;
                resolved.set(key, {
                    key,
                    kind: 'dashboard',
                    id: d.id,
                    label: d.name,
                    href: `/dashboards/${d.id}`,
                    icon: typeof s.icon === 'string' ? s.icon : null,
                    color: typeof s.color === 'string' ? s.color : null,
                });
            }
        }
        return stableShown(tenantId, [...resolved.keys()]).flatMap((k) => {
            const it = resolved.get(k);
            return it ? [it] : [];
        });
    }, [ready, tenantId, state.data, lists.data, dashboards.data]);

    return { enabled: state.data?.enabled !== false, items, ready };
}

/** Mostrar u ocultar la sección, o empezar de cero. Se ve al instante. */
export function useUpdateMostUsed() {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    return useMutation({
        mutationFn: async (patch: UpdateMostUsedInput): Promise<MostUsedState> => {
            const res = await api.patch<MostUsedState>('/me/most-used', patch);
            return res.data;
        },
        onMutate: async (patch) => {
            const key = mostUsedQueryKey(tenantId);
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData<MostUsedState>(key);
            if (tenantId !== null && (patch.reset === true || patch.enabled === false)) {
                clearMostUsedQueue(tenantId);
                resetShown(tenantId);
            }
            qc.setQueryData<MostUsedState>(key, {
                enabled: patch.enabled ?? prev?.enabled ?? true,
                items: patch.reset === true || patch.enabled === false ? [] : (prev?.items ?? []),
            });
            return { prev };
        },
        onError: (_e, _patch, ctx) => {
            if (ctx?.prev) qc.setQueryData(mostUsedQueryKey(tenantId), ctx.prev);
        },
        onSuccess: (state) => {
            qc.setQueryData(mostUsedQueryKey(tenantId), state);
        },
    });
}

/**
 * Encender o apagar fuera de un componente: el «Deshacer» del aviso que sale
 * al ocultar la sección corre cuando el menú que la ocultó ya no existe (la
 * sección desapareció con él), así que no puede depender de su mutación.
 */
export async function setMostUsedEnabled(qc: QueryClient, tenantId: number | null, enabled: boolean): Promise<void> {
    const key = mostUsedQueryKey(tenantId);
    const prev = qc.getQueryData<MostUsedState>(key);
    qc.setQueryData<MostUsedState>(key, { enabled, items: enabled ? (prev?.items ?? []) : [] });
    try {
        const res = await api.patch<MostUsedState>('/me/most-used', { enabled });
        qc.setQueryData(key, res.data);
    } catch {
        if (prev) qc.setQueryData(key, prev);
    }
}
