import { useQuery } from '@tanstack/react-query';

import { api as cloudApi } from '@/cloud/session';

import { recordsKeys } from './useRecords';

/**
 * v0.1.336 — En una lista de la tienda o del sitio: cuántas filas ya se
 * borraron allá (y se pueden quitar de la app). Cuelga de las claves de los
 * registros de la lista: cualquier cambio (un borrado, una vuelta de la
 * sincronización) la refresca.
 */
export function useSourceGoneCount(listId: number | undefined, enabled: boolean) {
    return useQuery({
        queryKey: [...recordsKeys.forList(listId ?? 0), 'source-gone'] as const,
        queryFn: () => cloudApi.recordsSourceGone(listId!),
        enabled: enabled && listId !== undefined && listId > 0,
        staleTime: 30_000,
    });
}
