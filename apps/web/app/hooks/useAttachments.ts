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

function toResolved(dto: AttachmentDto): ResolvedAttachment {
    return {
        id: dto.id,
        url: dto.url,
        thumbUrl: dto.mime_type.startsWith('image/') ? dto.url : undefined,
        title: dto.title,
        mimeType: dto.mime_type,
    };
}

// ── v0.1.252 — carga por id AGRUPADA (estilo DataLoader) ──────────────────
// Una celda de archivo por fila pidiendo su id por separado serían 50
// requests por página (regla de oro nº 8). Las celdas piden de a una y este
// cargador junta todas las del mismo tick en UN `GET /files?ids=`.
type Waiter = { resolve: (v: ResolvedAttachment | null) => void; reject: (e: unknown) => void };
let pendingBatch: Map<number, Waiter[]> | null = null;

function loadAttachment(id: number): Promise<ResolvedAttachment | null> {
    return new Promise((resolve, reject) => {
        if (pendingBatch === null) {
            pendingBatch = new Map();
            setTimeout(() => void flushAttachments(), 0);
        }
        const list = pendingBatch.get(id) ?? [];
        list.push({ resolve, reject });
        pendingBatch.set(id, list);
    });
}

async function flushAttachments(): Promise<void> {
    const batch = pendingBatch;
    pendingBatch = null;
    if (batch === null) return;
    const ids = [...batch.keys()];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        try {
            const res = await api.get<AttachmentDto[]>('/files', { query: { ids: chunk.join(',') } });
            const byId = new Map(res.data.map((d) => [d.id, toResolved(d)]));
            for (const id of chunk) for (const w of batch.get(id) ?? []) w.resolve(byId.get(id) ?? null);
        } catch (err) {
            for (const id of chunk) for (const w of batch.get(id) ?? []) w.reject(err);
        }
    }
}

/** Un archivo por id; las llamadas del mismo tick viajan juntas. */
export function useAttachment(id: number | null) {
    return useQuery({
        queryKey: ['imcrm', 'attachment', id],
        queryFn: () => loadAttachment(id as number),
        enabled: id !== null && id > 0,
        staleTime: 5 * 60_000,
    });
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
