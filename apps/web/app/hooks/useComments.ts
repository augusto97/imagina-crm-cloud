import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentReactionEmoji, CommentReactionSummary, FollowStateDto } from '@imagina-base/shared';

import { toggleReactionLocally } from '@/admin/comments/commentThreads';

import { notificationKeys } from '@/hooks/useNotifications';
import { markLocalRecordsChange } from '@/hooks/useRecords';
import { useMemberNames } from '@/hooks/useWpUsers';
import { api } from '@/lib/api';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import type { CommentEntity, CommentMetadata, CreateCommentInput } from '@/types/comment';

/**
 * v0.1.234 — El API de la nube habla `body` + `kind` (schema compartido
 * `commentSchema`); la UI heredada del plugin habla `content` + `metadata.kind`.
 * Antes no había traducción: publicar desde la ficha devolvía 400 ("body
 * Required") y los comentarios existentes se veían SIN texto. La traducción
 * vive aquí, el único lugar por donde pasan todas las pantallas.
 */
type ApiComment = Omit<CommentEntity, 'content'> & { body?: string; content?: string; kind?: CommentMetadata['kind'] };

export function fromApiComment(c: ApiComment): CommentEntity {
    const metadata = { ...(c.metadata ?? {}) } as CommentMetadata;
    if (c.kind && c.kind !== 'note' && !metadata.kind) metadata.kind = c.kind;
    return { ...c, content: c.content ?? c.body ?? '', metadata };
}

export function toApiComment(input: {
    content: string;
    metadata?: CommentMetadata;
    parent_id?: number | null;
    visibility?: 'internal' | 'client';
}): Record<string, unknown> {
    return {
        body: input.content,
        ...(input.visibility === 'client' ? { visibility: 'client' } : {}),
        ...(input.metadata?.kind ? { kind: input.metadata.kind } : {}),
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    };
}

/**
 * Estado de «Seguir» después de comentar: quien comenta queda siguiendo. Sin
 * estado previo en cache no se inventa uno (la invalidación lo trae).
 */
export function followAfterComment(prev: FollowStateDto | undefined): FollowStateDto | undefined {
    if (!prev || prev.following) return prev;
    return { following: true, followers: prev.followers + 1 };
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
            // El aviso de realtime de este cambio es nuestro (no refrescar dos veces).
            markLocalRecordsChange(qc, listId);
            // Comentar te suscribe al registro (ADR-S40): «Seguir» tiene que
            // reflejarlo sin recargar. v0.1.286 — se marca al toque (el estado
            // también vive sembrado por el bundle de la ficha, que no se
            // vuelve a pedir) y después se confirma contra el servidor.
            qc.setQueryData<FollowStateDto>(notificationKeys.follow(recordId), (prev) => followAfterComment(prev));
            void qc.invalidateQueries({ queryKey: notificationKeys.follow(recordId) });
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
            // El aviso de realtime de este cambio es nuestro (no refrescar dos veces).
            markLocalRecordsChange(qc, listId);
        },
    });
}

/**
 * Nombre del autor de cada comentario. El DTO ya trae `user_name`; para los
 * que no (comentarios viejos en cache, el portal) se resuelve en LOTE con
 * `GET /me/users?ids=` — nunca una request por autor.
 */
export function useCommentAuthors(comments: readonly CommentEntity[] | undefined): (c: CommentEntity) => string {
    // El cliente del portal no está en el directorio de miembros: su nombre
    // viene en `author_name`.
    const missing = (comments ?? []).filter((c) => !c.user_name && !c.from_client).map((c) => c.user_id);
    const names = useMemberNames(missing);
    const map = names.data;
    return useCallback(
        (c: CommentEntity): string =>
            (c.user_name !== undefined && c.user_name !== null && c.user_name !== '' ? c.user_name : null)
            ?? (c.from_client ? c.author_name || __('Cliente') : null)
            ?? map?.get(c.user_id)
            ?? sprintf(/* translators: %d: user id */ __('Usuario #%d'), c.user_id),
        [map],
    );
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
            // El aviso de realtime de este cambio es nuestro (no refrescar dos veces).
            markLocalRecordsChange(qc, listId);
        },
    });
}

/**
 * v0.1.291 — Pone o quita una reacción. Optimista: el contador cambia al
 * instante y la respuesta del servidor (el resumen real) lo confirma.
 */
export function useToggleCommentReaction(listId: string | number, recordId: number) {
    const qc = useQueryClient();
    const key = commentsKeys.forRecord(listId, recordId);
    return useMutation({
        mutationFn: async ({ commentId, emoji }: { commentId: number; emoji: CommentReactionEmoji }) => {
            const res = await api.post<{ reactions: CommentReactionSummary[] }>(
                `/lists/${listId}/records/${recordId}/comments/${commentId}/reactions`,
                { emoji },
            );
            return res.data.reactions;
        },
        onMutate: async ({ commentId, emoji }) => {
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData<CommentEntity[]>(key);
            const me = getBootData().user;
            qc.setQueryData<CommentEntity[]>(key, (list) =>
                list?.map((c) =>
                    c.id === commentId
                        ? { ...c, reactions: toggleReactionLocally(c.reactions, emoji, me.id, me.displayName || __('Tú')) }
                        : c,
                ),
            );
            return { prev };
        },
        onError: (_err, _vars, ctx) => {
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
        },
        onSuccess: (reactions, { commentId }) => {
            qc.setQueryData<CommentEntity[]>(key, (list) => list?.map((c) => (c.id === commentId ? { ...c, reactions } : c)));
            // El aviso de realtime de este cambio es nuestro (no refrescar dos veces).
            markLocalRecordsChange(qc, listId);
        },
    });
}
