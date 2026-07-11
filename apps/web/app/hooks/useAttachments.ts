import { useQuery } from '@tanstack/react-query';

/**
 * Resolución de attachment IDs a URLs — herencia del plugin, donde los IDs
 * apuntaban a la media library de WordPress. Imagina Base todavía NO tiene
 * módulo de archivos propio (STANDALONE: candidato a fase futura con storage
 * S3-compatible), así que este hook devuelve siempre un mapa vacío y los
 * consumidores (`CardsView` cover, galerías) degradan a su placeholder.
 *
 * Se conserva la interfaz para que el día que exista el módulo de media el
 * cableado sea solo reimplementar el queryFn.
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
        queryFn: async (): Promise<Map<number, ResolvedAttachment>> => new Map(),
        // Sin backend de media no hay nada que pedir: la query queda inerte.
        enabled: false,
        staleTime: Infinity,
    });
}
