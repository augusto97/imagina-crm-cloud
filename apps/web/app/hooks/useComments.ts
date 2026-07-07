import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { CommentEntity, CommentMetadata, CreateCommentInput } from '@/types/comment';

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
            const res = await api.get<CommentEntity[]>(
                `/lists/${listId}/records/${recordId}/comments`,
            );
            return res.data;
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
            const res = await api.post<CommentEntity>(
                `/lists/${listId}/records/${recordId}/comments`,
                input,
            );
            return res.data;
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
            const res = await api.patch<CommentEntity>(
                `/lists/${listId}/records/${recordId}/comments/${id}`,
                { content, ...(metadata !== undefined ? { metadata } : {}) },
            );
            return res.data;
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
