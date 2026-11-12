import { useQueries, useQuery } from '@tanstack/react-query';

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
    /**
     * v0.1.426 — sólo imágenes: la misma URL firmada con `&w=320`; el servidor
     * la entrega achicada en WebP (ver `lib/fileThumbs`).
     */
    thumb_url?: string;
    title: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
}

export interface ResolvedAttachment {
    id: number;
    url: string;
    /** v0.1.426 — miniatura (sólo imágenes; nunca SVG). Cambiar el ancho con `withThumbWidth`. */
    thumbUrl?: string;
    title: string;
    mimeType: string;
    /** v0.1.291 — tamaño (lo muestra el visor de adjuntos). */
    sizeBytes?: number;
}

function toResolved(dto: AttachmentDto): ResolvedAttachment {
    return {
        id: dto.id,
        url: dto.url,
        thumbUrl: dto.thumb_url,
        title: dto.title,
        mimeType: dto.mime_type,
        sizeBytes: dto.size_bytes,
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

/**
 * v0.1.291 — Varios archivos por id (para abrir el visor con todos los de un
 * campo); viajan en UN pedido con lo que se pida en el mismo tick.
 */
export async function resolveAttachments(ids: readonly number[]): Promise<ResolvedAttachment[]> {
    const found = await Promise.all(ids.filter((id) => id > 0).map((id) => loadAttachment(id)));
    return found.filter((a): a is ResolvedAttachment => a !== null);
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

/**
 * v0.1.426 — Varios archivos por id, cada uno con la MISMA caché que
 * `useAttachment`: las celdas de una tabla (una por fila) siguen viajando
 * juntas en un solo `GET /files?ids=` (regla de oro nº 8), cosa que
 * `useAttachments` (una consulta por conjunto de ids) no hace.
 */
export function useAttachmentList(ids: readonly number[]): Array<{ id: number; data: ResolvedAttachment | null | undefined; isLoading: boolean }> {
    const results = useQueries({
        queries: ids.map((id) => ({
            queryKey: ['imcrm', 'attachment', id],
            queryFn: () => loadAttachment(id),
            enabled: id > 0,
            staleTime: 5 * 60_000,
        })),
    });
    return ids.map((id, i) => ({ id, data: results[i]?.data, isLoading: results[i]?.isLoading ?? false }));
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
            for (const dto of res.data) map.set(dto.id, toResolved(dto));
            return map;
        },
        enabled: dedupedIds.length > 0,
        staleTime: 5 * 60_000,
    });
}
