import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Auto-detect de la URL de la página del portal (Fase 12.F).
 *
 * El backend busca la primera página publicada que contiene el
 * shortcode `[imcrm-client-portal]` y devuelve su permalink. Usado
 * por `PortalAccessButton` para ofrecer "Enviar magic link" sin
 * que el admin configure la URL manualmente.
 *
 * Cachea 5 minutos. Si retorna `null` significa que no hay página
 * del portal publicada — el UI debería mostrar un mensaje
 * informativo en lugar del botón.
 */
export function usePortalPageUrl() {
    return useQuery({
        queryKey: ['imcrm', 'portal', 'page-url'],
        queryFn: async (): Promise<string | null> => {
            const res = await api.get<{ url: string | null }>('/portal/page-url');
            return res.data.url;
        },
        staleTime: 5 * 60 * 1000,
    });
}
