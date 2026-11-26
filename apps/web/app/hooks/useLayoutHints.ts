import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { readLayoutHints, type LayoutHints } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { api } from '@/lib/api';

/**
 * v0.1.470 — Las listas en las que la persona ya cerró la tarjeta «Esta
 * lista se puede ver como ficha» (`GET /me/layout-hints`, por empresa).
 */
export function layoutHintsKey(tenantId: number | null): readonly unknown[] {
    return ['layout-hints', tenantId] as const;
}

export function useLayoutHints(enabled: boolean) {
    const tenantId = useSession((s) => s.activeTenantId);
    return useQuery({
        queryKey: layoutHintsKey(tenantId),
        queryFn: async (): Promise<LayoutHints> => readLayoutHints((await api.get<LayoutHints>('/me/layout-hints')).data),
        enabled: enabled && tenantId !== null,
        staleTime: 5 * 60_000,
    });
}

/** «Ahora no» / cerrar la tarjeta: se oculta al instante y se guarda en el servidor. */
export function useDismissLayoutHint() {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    return useMutation({
        mutationFn: async (listId: number): Promise<LayoutHints> =>
            readLayoutHints((await api.post<LayoutHints>('/me/layout-hints/dismiss', { list_id: listId })).data),
        onMutate: (listId) => {
            const key = layoutHintsKey(tenantId);
            const prev = qc.getQueryData<LayoutHints>(key);
            const list = prev?.dismissed_lists ?? [];
            if (!list.includes(listId)) qc.setQueryData<LayoutHints>(key, { dismissed_lists: [...list, listId] });
        },
        onSuccess: (data) => qc.setQueryData(layoutHintsKey(tenantId), data),
    });
}
