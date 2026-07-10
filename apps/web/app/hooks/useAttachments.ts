import { useQuery } from '@tanstack/react-query';

import { isCloud } from '@/lib/cloudFeatures';

/**
 * Resuelve un set de attachment IDs a sus URLs (full + thumbnail).
 * Hace un único request batch al endpoint nativo de WP
 * `/wp-json/wp/v2/media?include=...` — eficiente para listas de
 * tarjetas/galerías que muestran muchas imágenes simultáneamente.
 *
 * Fase 12.B+ — usado por `CardsView` para resolver el `coverField`.
 * También puede reemplazar el fetch por-ítem de `SimpleBlockViews`
 * en un refactor futuro.
 *
 * El resultado se cachea con TanStack Query: ids ya cargados en
 * otra vista no se vuelven a pedir.
 */

export interface ResolvedAttachment {
    id: number;
    url: string;
    thumbUrl?: string;
    title: string;
    mimeType: string;
}

export function useAttachments(ids: number[]) {
    // Dedupe + sort para que el queryKey sea estable.
    const dedupedIds = Array.from(new Set(ids.filter((id) => id > 0))).sort((a, b) => a - b);

    return useQuery({
        queryKey: ['imcrm', 'attachments', dedupedIds],
        queryFn: async (): Promise<Map<number, ResolvedAttachment>> => {
            // En la nube no existe la media library de WP — nunca fetchear.
            if (isCloud() || dedupedIds.length === 0) return new Map();
            const root = (window as { wpApiSettings?: { root: string; nonce: string } }).wpApiSettings;
            const headers: Record<string, string> = { Accept: 'application/json' };
            if (root?.nonce) headers['X-WP-Nonce'] = root.nonce;
            const base = root?.root ?? '/wp-json/';
            const url = `${base}wp/v2/media?include=${dedupedIds.join(',')}&per_page=${dedupedIds.length}&_fields=id,source_url,mime_type,title,media_details`;
            const res = await fetch(url, { headers, credentials: 'same-origin' });
            if (! res.ok) throw new Error(`wp-media-fetch-${res.status}`);
            const body = (await res.json()) as Array<{
                id: number;
                source_url: string;
                mime_type: string;
                title: { rendered: string };
                media_details?: { sizes?: { thumbnail?: { source_url?: string }; medium?: { source_url?: string } } };
            }>;
            const map = new Map<number, ResolvedAttachment>();
            for (const m of body) {
                map.set(m.id, {
                    id: m.id,
                    url: m.source_url,
                    thumbUrl:
                        m.media_details?.sizes?.medium?.source_url
                        ?? m.media_details?.sizes?.thumbnail?.source_url,
                    title: stripHtml(m.title.rendered) || `#${m.id}`,
                    mimeType: m.mime_type,
                });
            }
            return map;
        },
        enabled: dedupedIds.length > 0 && !isCloud(),
        staleTime: 5 * 60 * 1000, // 5 min — los media de WP rara vez cambian de URL.
    });
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, '').trim();
}
