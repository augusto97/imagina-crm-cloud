import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ListPermissionsDoc,
    RolePermissions,
    UpdateListPermissionsInput,
} from '@imagina-base/shared';

import { api } from '@/lib/api';
import { fieldsKeys } from '@/hooks/useFields';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';

/**
 * ACL por lista (permisos por rol). Endpoints cloud:
 *  GET  /lists/:idOrSlug/permissions  → doc + roles configurables
 *  PATCH /lists/:idOrSlug/permissions → merge parcial
 */
export const permissionsKeys = {
    all: ['permissions'] as const,
    forList: (idOrSlug: string | number) => [...permissionsKeys.all, String(idOrSlug)] as const,
};

export function useListPermissions(idOrSlug: string | number | undefined) {
    return useQuery({
        queryKey: permissionsKeys.forList(idOrSlug ?? ''),
        queryFn: async () => {
            const res = await api.get<ListPermissionsDoc>(`/lists/${idOrSlug}/permissions`);
            return res.data;
        },
        enabled: idOrSlug !== undefined && idOrSlug !== '',
    });
}

export function useUpdateListPermissions(idOrSlug: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdateListPermissionsInput): Promise<ListPermissionsDoc> => {
            const res = await api.patch<ListPermissionsDoc>(`/lists/${idOrSlug}/permissions`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: permissionsKeys.forList(idOrSlug) });
            // v0.1.105 — el ACL cambia qué devuelven records y fields (scope
            // + campos ocultos): refrescarlos para ver el efecto sin recargar.
            invalidateForList(qc, recordsKeys.all, idOrSlug);
            invalidateForList(qc, fieldsKeys.all, idOrSlug);
        },
    });
}

export type { RolePermissions };
