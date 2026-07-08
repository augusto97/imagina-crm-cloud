import { z } from 'zod';
import { idSchema } from './common';

/**
 * Realtime = "invalidación push" (STANDALONE §7, ADR-S06): toda mutación
 * exitosa emite este evento al workspace; el frontend invalida la query de
 * TanStack correspondiente y re-fetchea. NO es co-edición (CRDT fuera de
 * alcance).
 */
export const RT_TOPICS = ['lists', 'fields', 'records', 'views'] as const;
export const rtTopicSchema = z.enum(RT_TOPICS);
export type RtTopic = z.infer<typeof rtTopicSchema>;

/** Evento de invalidación. `listId` acota el scope (records/fields/views de esa lista). */
export const rtInvalidateSchema = z.object({
    topic: rtTopicSchema,
    listId: idSchema.optional(),
    /** Id de quien originó la mutación — el cliente puede ignorar sus propios ecos. */
    origin: z.string().optional(),
});
export type RtInvalidate = z.infer<typeof rtInvalidateSchema>;

/** Nombres de eventos/canales del socket. */
export const RT_EVENT_INVALIDATE = 'invalidate';
export const RT_EVENT_JOIN = 'join';
export const rtJoinSchema = z.object({ tenantId: idSchema });
export type RtJoin = z.infer<typeof rtJoinSchema>;
