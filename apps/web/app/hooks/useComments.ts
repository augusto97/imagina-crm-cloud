import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CommentEntity, CommentMetadata, CreateCommentInput } from '@/types/comment';

/**
 * v0.1.234 — El API de la nube habla `body` + `kind` (schema compartido
 * `commentSchema`); la UI heredada del plugin habla `content` + `metadata.kind`.
 * Antes no había traducción: publicar desde la ficha devolvía 400 ("body
 * Required") y los comentarios existentes se veían SIN texto. La traducción
 * vive acá, el único lugar por donde pasan todas las pantallas.
 */
type ApiComment = Omit<CommentEntity, 'content'> & { body?: string; content?: string; kind?: CommentMetadata['kind'] };

export function fromApiComment(c: ApiComment): CommentEntity {
    const metadata = { ...(c.metadata ?? {}) } as CommentMetadata;
    if (c.kind && c.kind !== 'note' && !metadata.kind) metadata.kind = c.kind;
    return { ...c, content: c.content ?? c.body ?? '', metadata };
}

export function toApiComment(input: { content: string; metadata?: CommentMetadata; parent_id?: number | null }): Record<string, unknown> {
    return {
        body: input.content,
        ...(input.metadata?.kind ? { kind: input.metadata.kind } : {}),
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };
}

export const commentsKeys = {
    all: ['comments'] as const,
    forRecord: (listId: string | number, recordId: string | number) =>
        [...commentsKeys.all, 'list', String(listId), 'record', String(recordId)] as const,
};

export function useComments(
    listId: string | number | undefined,
    recordId: number | undefined,
) {
    return useQuery({
        queryKey: commentsKeys.forRecord(listId ?? '', recordId ?? 0),
        queryFn: async () => {
            const res = await api.get<ApiComment[]>(
                `/lists/${listId}/records/${recordId}/comments`,
            );
            return (Array.isArray(res.data) ? res.data : []).map(fromApiComment);
        },
        enabled: listId !== undefined && listId !== '' && recordId !== undefined && recordId > 0,
        // Comments cambian al postear pero los mutations invalidan la
        // query — entre mutations el data es estable. (Fase 16.D)
        staleTime: 30_000,
    });
}

export function useCreateComment(
    listId: string | number,
    recordId: number,
) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (input: CreateCommentInput) => {
            const res = await api.post<ApiComment>(
                `/lists/${listId}/records/${recordId}/comments`,
                toApiComment(input),
            );
            return fromApiComment(res.data);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: commentsKeys.forRecord(listId, recordId) });
        },
    });
}

export function useUpdateComment(
    listId: string | number,
    recordId: number,
) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            content,
            metadata,
        }: {
            id: number;
            content: string;
            metadata?: CommentMetadata;
        }) => {
            const body = toApiComment({ content, metadata });
            const res = await api.patch<ApiComment>(
                `/lists/${listId}/records/${recordId}/comments/${id}`,
                // El PATCH no acepta `kind` (el tipo de entrada no cambia al editar).
                { body: body.body, ...(metadata !== undefined ? { metadata } : {}) },
            );
            return fromApiComment(res.data);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: commentsKeys.forRecord(listId, recordId) });
        },
    });
}

export function useDeleteComment(
    listId: string | number,
    recordId: number,
) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/lists/${listId}/records/${recordId}/comments/${id}`);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: commentsKeys.forRecord(listId, recordId) });
        },
    });
}
