import { Inject, Injectable } from '@nestjs/common';
import type { AiProposal, AiTranscriptMessage } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/** Una conversación vive 24 h desde el último mensaje. */
export const CONVERSATION_TTL_SECONDS = 24 * 60 * 60;
/** Tope de mensajes de la API que se conservan (los más viejos se recortan). */
export const MAX_HISTORY_MESSAGES = 40;

/**
 * Mensaje en el formato de la API del proveedor. Se tipa laxo a propósito:
 * el store no interpreta el contenido (bloques de texto, thinking,
 * tool_use, tool_result), sólo lo persiste para continuar la conversación.
 */
export interface ApiMessage {
    role: 'user' | 'assistant';
    content: unknown;
}

export interface StoredConversation {
    id: string;
    tenantId: number;
    userId: number;
    /** Historial para el modelo. */
    messages: ApiMessage[];
    /** Historial para la persona (texto + tarjetas de propuesta). */
    transcript: AiTranscriptMessage[];
    updated_at: string;
}

/**
 * Conversaciones del asistente en Redis, POR usuario y empresa: nadie lee
 * la conversación de otro. No van a Postgres a propósito — son efímeras y
 * pueden contener texto libre de la persona; lo que perdura es lo que se
 * APLICÓ (en las tablas reales + la bitácora).
 */
@Injectable()
export class ConversationsStore {
    constructor(@Inject(REDIS) private readonly redis: Redis) {}

    private key(tenantId: number, userId: number, id: string): string {
        return `aiconv:${tenantId}:${userId}:${id}`;
    }

    async load(tenantId: number, userId: number, id: string): Promise<StoredConversation | null> {
        if (!/^[a-z0-9_-]{6,64}$/i.test(id)) return null;
        const raw = await this.redis.get(this.key(tenantId, userId, id));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StoredConversation;
        } catch {
            return null;
        }
    }

    async save(conv: StoredConversation): Promise<void> {
        conv.messages = trimHistory(conv.messages, MAX_HISTORY_MESSAGES);
        conv.updated_at = new Date().toISOString();
        await this.redis.set(this.key(conv.tenantId, conv.userId, conv.id), JSON.stringify(conv), 'EX', CONVERSATION_TTL_SECONDS);
        // F7 — «Primeros pasos»: la persona ya le preguntó algo al asistente.
        // Una marca sin vencimiento (las conversaciones duran 24 h).
        await this.redis.set(usedKey(conv.tenantId, conv.userId), '1');
    }

    /** F7 — ¿Esta persona ya habló con el asistente en esta empresa? */
    async hasUsed(tenantId: number, userId: number): Promise<boolean> {
        return (await this.redis.exists(usedKey(tenantId, userId))) === 1;
    }

    /** Refleja en el transcript que una propuesta se aplicó (la tarjeta cambia de estado al recargar). */
    async markProposal(tenantId: number, userId: number, conversationId: string, proposal: AiProposal): Promise<void> {
        const conv = await this.load(tenantId, userId, conversationId);
        if (!conv) return;
        for (const m of conv.transcript) {
            m.proposals = m.proposals.map((p) => (p.id === proposal.id ? proposal : p));
        }
        await this.save(conv);
    }
}

function usedKey(tenantId: number, userId: number): string {
    return `aiconv:used:${tenantId}:${userId}`;
}

/**
 * Recorta el historial sin partir un par tool_use/tool_result: el mensaje
 * inicial siempre tiene que ser de la persona y no puede ser un
 * `tool_result` huérfano (la API lo rechaza).
 */
export function trimHistory(messages: ApiMessage[], max: number): ApiMessage[] {
    if (messages.length <= max) return messages;
    let out = messages.slice(messages.length - max);
    while (out.length > 0 && !startsClean(out[0]!)) out = out.slice(1);
    return out;
}

function startsClean(m: ApiMessage): boolean {
    if (m.role !== 'user') return false;
    if (typeof m.content === 'string') return true;
    if (Array.isArray(m.content)) {
        return !m.content.some((b) => (b as { type?: string }).type === 'tool_result');
    }
    return false;
}

/** Lo que se le dice al modelo cuando el turno anterior quedó a medias. */
export const INTERRUPTED_TURN_NOTE = '(Este pedido quedó a medias: se cortó antes de terminar.)';

const THINKING_TYPES = new Set(['thinking', 'redacted_thinking']);

function blocks(m: ApiMessage | undefined): { type?: string }[] {
    return m && Array.isArray(m.content) ? (m.content as { type?: string }[]) : [];
}

/**
 * Deja el historial listo para un turno NUEVO (ADR-S60). Puro.
 *
 * 1. Un turno anterior cortado a mitad del bucle de herramientas (tope de
 *    pasos, la persona cerró el panel) puede terminar en un `tool_use` sin su
 *    resultado — se quita, la API lo rechazaría — o en un `tool_result` sin
 *    respuesta del asistente — se cierra con una nota.
 * 2. Los turnos terminados viajan SIN sus bloques de pensamiento. Los
 *    modelos actuales atan cada bloque al modelo, a la cuenta y al prefijo
 *    EXACTO de la conversación (sistema, herramientas y mensajes anteriores),
 *    y en las cuentas nuevas del proveedor reenviar un bloque cuyo prefijo
 *    cambió es un 400. Entre turnos cambian el sistema (la lista abierta),
 *    el recorte del historial, el modelo («el más reciente») y la clave, así
 *    que reenviarlos rompería la conversación. Dentro de un turno — el bucle
 *    de herramientas — se reenvían intactos, como pide la API.
 */
export function prepareHistoryForNewTurn(messages: ApiMessage[]): ApiMessage[] {
    const out = [...messages];
    while (out.length > 0 && out[out.length - 1]!.role === 'assistant' && blocks(out[out.length - 1]).some((b) => b.type === 'tool_use')) {
        out.pop();
    }
    const last = out[out.length - 1];
    if (last?.role === 'user' && blocks(last).some((b) => b.type === 'tool_result')) {
        out.push({ role: 'assistant', content: [{ type: 'text', text: INTERRUPTED_TURN_NOTE }] });
    }
    const cleaned: ApiMessage[] = [];
    for (const m of out) {
        if (m.role !== 'assistant' || !Array.isArray(m.content)) {
            cleaned.push(m);
            continue;
        }
        const content = (m.content as { type?: string }[]).filter((b) => !THINKING_TYPES.has(b.type ?? ''));
        if (content.length > 0) cleaned.push({ role: 'assistant', content });
    }
    return cleaned;
}
