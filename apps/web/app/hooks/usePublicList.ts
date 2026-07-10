import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicListAdmin, UpdatePublicListInput } from '@imagina-base/shared';

import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';

/**
 * Config de publicación de una lista (lista pública embebible). Endpoints cloud:
 *  GET   /lists/:idOrSlug/public  → config admin + public_path
 *  PATCH /lists/:idOrSlug/public  → merge parcial (habilitar, campos, dominios…)
 */
export const publicListKeys = {
    all: ['public-list'] as const,
    forList: (idOrSlug: string | number) => [...publicListKeys.all, String(idOrSlug)] as const,
};

export function usePublicList(idOrSlug: string | number | undefined) {
    return useQuery({
        queryKey: publicListKeys.forList(idOrSlug ?? ''),
        queryFn: async () => {
            const res = await api.get<PublicListAdmin>(`/lists/${idOrSlug}/public`);
            return res.data;
        },
        enabled: idOrSlug !== undefined && idOrSlug !== '',
    });
}

export function useUpdatePublicList(idOrSlug: string | number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: UpdatePublicListInput): Promise<PublicListAdmin> => {
            const res = await api.patch<PublicListAdmin>(`/lists/${idOrSlug}/public`, input);
            return res.data;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: publicListKeys.forList(idOrSlug) });
        },
    });
}

/**
 * URL absoluta de la página pública (para link + snippet de iframe). El backend
 * devuelve `public_path` relativo a la raíz del API (`/public/l/:token`); acá
 * lo prefijamos con el origen + el `restRoot` de la nube.
 */
export function publicListUrl(publicPath: string | null): string | null {
    if (!publicPath) return null;
    const restRoot = getBootData().restRoot.replace(/\/$/, '');
    try {
        return new URL(`${restRoot}${publicPath}`, window.location.origin).href;
    } catch {
        return `${restRoot}${publicPath}`;
    }
}
