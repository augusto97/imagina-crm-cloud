import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Resolución batch de attachment IDs → metadata + URL de descarga, contra el
 * módulo de archivos propio (ADR-S16): `GET /files?ids=1,2,3`. Un solo fetch
 * por conjunto de IDs (dedupe + sort para queryKey estable); los consumidores
 * (`CardsView` cover, galerías, file fields) leen del Map resultante.
 */

/** Shape que devuelve el backend por archivo (ADR-S16). */
export interface AttachmentDto {
    id: number;
    /** Ruta de descarga inline, ej. `/api/v1/files/7/download`. */
    url: string;
    title: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
}

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
            const res = await api.get<AttachmentDto[]>('/files', {
                query: { ids: dedupedIds.join(',') },
            });
            const map = new Map<number, ResolvedAttachment>();
            for (const dto of res.data) {
                map.set(dto.id, {
                    id: dto.id,
                    url: dto.url,
                    // Sin thumbnails dedicados aún: para imágenes el propio
                    // download inline sirve de thumb; para el resto, undefined
                    // → los consumidores caen a su placeholder/icono.
                    thumbUrl: dto.mime_type.startsWith('image/') ? dto.url : undefined,
                    title: dto.title,
                    mimeType: dto.mime_type,
                });
            }
            return map;
        },
        enabled: dedupedIds.length > 0,
        staleTime: 5 * 60_000,
    });
}
