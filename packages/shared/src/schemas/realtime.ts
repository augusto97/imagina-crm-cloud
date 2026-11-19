import { z } from 'zod';
import { idSchema } from './common';

/**
 * Realtime = "invalidación push" (STANDALONE §7, ADR-S06): toda mutación
 * exitosa emite este evento al workspace; el frontend invalida la query de
 * TanStack correspondiente y re-fetchea. NO es co-edición (CRDT fuera de
 * alcance).
 */
// v0.1.276 — `notifications` va a la sala de UNA persona (su bandeja).
// v0.1.291 — `timer` también: su cronómetro cambió (en otra pestaña o equipo).
// C1 — `teams`: se creó, cambió o borró un equipo (chips, selectores, ACL).
// C2 — `roles`: se creó, cambió o borró un rol propio (Ajustes → Roles, Miembros).
export const RT_TOPICS = ['lists', 'fields', 'records', 'views', 'notifications', 'timer', 'teams', 'roles'] as const;
export const rtTopicSchema = z.enum(RT_TOPICS);
export type RtTopic = z.infer<typeof rtTopicSchema>;

/**
 * v0.1.461 — Quién originó el cambio que avisa el evento (`origin`). Lo pone el
 * SERVIDOR según desde dónde se escribió, nunca el cliente:
 *
 *  - `tab:<id>` — un pedido de una pestaña de la app (la persona, en SU pedido).
 *    El id lo inventa la pestaña al cargar y lo manda en `X-Rt-Origin`.
 *  - `request` — un pedido sin pestaña: la API con token, el MCP, n8n, un
 *    formulario o la agenda públicos.
 *  - `job:<cola>` — un trabajo en segundo plano (`job:automations` = una
 *    automatización; también sincronizaciones, campos con IA, agentes…).
 *  - `system` — lo demás: tareas periódicas, o lo que siguió corriendo DESPUÉS
 *    de responder un pedido (la mutación de la pestaña ya no lo cubre).
 *
 * Una pestaña ignora SÓLO el eco de su propia edición (`tab:<su id>` sobre una
 * lista que esa misma edición ya refrescó). Antes se ignoraba todo aviso de esa
 * lista durante 2,5 s, y eso se comía lo que una automatización disparada por
 * la misma edición cambiaba un instante después (v0.1.253).
 */
export const RT_ORIGIN_HEADER = 'x-rt-origin';
export const RT_ORIGIN_REQUEST = 'request';
export const RT_ORIGIN_SYSTEM = 'system';
/** El id de pestaña: lo que acepta el servidor en `X-Rt-Origin` (cualquier otra cosa cuenta como `request`). */
export const RT_TAB_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function rtTabOrigin(tabId: string): string {
    return `tab:${tabId}`;
}

export function rtJobOrigin(queue: string): string {
    return `job:${queue}`;
}

/** Evento de invalidación. `listId` acota el scope (records/fields/views de esa lista). */
export const rtInvalidateSchema = z.object({
    topic: rtTopicSchema,
    listId: idSchema.optional(),
    /**
     * Quién originó la mutación (ver `RT_ORIGIN_*`). Sin valor = varios
     * orígenes juntados en un mismo aviso: nadie lo toma como su eco.
     */
    origin: z.string().optional(),
});
export type RtInvalidate = z.infer<typeof rtInvalidateSchema>;

/** Nombres de eventos/canales del socket. */
export const RT_EVENT_INVALIDATE = 'invalidate';
export const RT_EVENT_JOIN = 'join';
export const rtJoinSchema = z.object({ tenantId: idSchema });
export type RtJoin = z.infer<typeof rtJoinSchema>;
