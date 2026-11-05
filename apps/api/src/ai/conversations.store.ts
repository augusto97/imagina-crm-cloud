import { Inject, Injectable } from '@nestjs/common';
import { aiConversationTitle, type AiConversationSummary, type AiProposal, type AiTranscriptMessage } from '@imagina-base/shared';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * Una conversación vive 30 días desde el último mensaje (v0.1.370: antes,
 * 24 h — con el historial a la vista, un día era muy poco).
 */
export const CONVERSATION_KEEP_DAYS = 30;
export const CONVERSATION_TTL_SECONDS = CONVERSATION_KEEP_DAYS * 24 * 60 * 60;
/** Tope de conversaciones guardadas por persona y empresa (las más viejas se borran). */
export const MAX_CONVERSATIONS = 50;
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
    /** v0.1.370 — título (el primer pedido o el que le puso la persona). */
    title?: string;
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

    /** v0.1.370 — índice de las conversaciones de la persona (score = último mensaje). */
    private indexKey(tenantId: number, userId: number): string {
        return `aiconv:idx:${tenantId}:${userId}`;
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

    async save(conv: StoredConversation, opts: { touch?: boolean } = {}): Promise<void> {
        conv.messages = trimHistory(conv.messages, MAX_HISTORY_MESSAGES);
        const now = Date.now();
        // Marcar una propuesta como aplicada o renombrar no la sube en el historial.
        if (opts.touch !== false || !conv.updated_at) conv.updated_at = new Date(now).toISOString();
        if (!conv.title) {
            const first = conv.transcript.find((m) => m.role === 'user')?.text ?? '';
            if (first) conv.title = aiConversationTitle(first);
        }
        const idx = this.indexKey(conv.tenantId, conv.userId);
        const score = Date.parse(conv.updated_at) || now;
        await this.redis
            .multi()
            .set(this.key(conv.tenantId, conv.userId, conv.id), JSON.stringify(conv), 'EX', CONVERSATION_TTL_SECONDS)
            .zadd(idx, score, conv.id)
            .expire(idx, CONVERSATION_TTL_SECONDS)
            // F7 — «Primeros pasos»: la persona ya le preguntó algo al asistente.
            // Una marca sin vencimiento.
            .set(usedKey(conv.tenantId, conv.userId), '1')
            .exec();
        await this.prune(conv.tenantId, conv.userId);
    }

    /** Deja sólo las MAX_CONVERSATIONS más recientes (y saca del índice las vencidas). */
    private async prune(tenantId: number, userId: number): Promise<void> {
        const idx = this.indexKey(tenantId, userId);
        await this.redis.zremrangebyscore(idx, '-inf', Date.now() - CONVERSATION_TTL_SECONDS * 1000);
        const extra = (await this.redis.zcard(idx)) - MAX_CONVERSATIONS;
        if (extra <= 0) return;
        const old = await this.redis.zrange(idx, 0, extra - 1);
        if (old.length === 0) return;
        await this.redis
            .multi()
            .zrem(idx, ...old)
            .del(...old.map((id) => this.key(tenantId, userId, id)))
            .exec();
    }

    /** v0.1.370 — El historial de la persona en esta empresa, lo más nuevo primero. */
    async list(tenantId: number, userId: number): Promise<AiConversationSummary[]> {
        const idx = this.indexKey(tenantId, userId);
        await this.redis.zremrangebyscore(idx, '-inf', Date.now() - CONVERSATION_TTL_SECONDS * 1000);
        const ids = await this.redis.zrevrange(idx, 0, MAX_CONVERSATIONS - 1);
        if (ids.length === 0) return [];
        const raws = await this.redis.mget(...ids.map((id) => this.key(tenantId, userId, id)));
        const out: AiConversationSummary[] = [];
        const gone: string[] = [];
        ids.forEach((id, i) => {
            const raw = raws[i];
            if (!raw) {
                gone.push(id);
                return;
            }
            try {
                const conv = JSON.parse(raw) as StoredConversation;
                const userTurns = conv.transcript.filter((m) => m.role === 'user');
                if (userTurns.length === 0) return;
                const last = [...conv.transcript].reverse().find((m) => m.text.trim()) ?? userTurns[userTurns.length - 1]!;
                out.push({
                    id: conv.id,
                    title: conv.title || aiConversationTitle(userTurns[0]!.text),
                    preview: previewOf(last.text),
                    messages: conv.transcript.length,
                    updated_at: conv.updated_at,
                });
            } catch {
                gone.push(id);
            }
        });
        if (gone.length > 0) await this.redis.zrem(idx, ...gone);
        return out;
    }

    async rename(tenantId: number, userId: number, id: string, title: string): Promise<StoredConversation | null> {
        const conv = await this.load(tenantId, userId, id);
        if (!conv) return null;
        conv.title = title.trim();
        await this.save(conv, { touch: false });
        return conv;
    }

    async remove(tenantId: number, userId: number, id: string): Promise<boolean> {
        if (!/^[a-z0-9_-]{6,64}$/i.test(id)) return false;
        const [, [, removed]] = (await this.redis
            .multi()
            .zrem(this.indexKey(tenantId, userId), id)
            .del(this.key(tenantId, userId, id))
            .exec()) as [[unknown, number], [unknown, number]];
        return removed > 0;
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
        await this.save(conv, { touch: false });
    }
}

function usedKey(tenantId: number, userId: number): string {
    return `aiconv:used:${tenantId}:${userId}`;
}

/** Una línea de texto plano para el historial (sin la sintaxis del formato). */
export function previewOf(text: string): string {
    const plain = text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`|~]+/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return plain.length > 120 ? `${plain.slice(0, 117)}…` : plain;
}

/**
 * v0.1.370 — «Reintentar»: quita el último turno (el último pedido de la
 * persona y todo lo que vino después) del historial del modelo y del
 * transcript. Devuelve el texto de ese pedido, o null si no hay. Puro.
 */
export function dropLastTurn(conv: Pick<StoredConversation, 'messages' | 'transcript'>): string | null {
    let ui = -1;
    for (let i = conv.transcript.length - 1; i >= 0; i--) {
        if (conv.transcript[i]!.role === 'user') {
            ui = i;
            break;
        }
    }
    if (ui < 0) return null;
    const text = conv.transcript[ui]!.text;
    conv.transcript.splice(ui);
    // En el historial del modelo, el turno empieza en el último mensaje de la
    // persona que NO es un resultado de herramienta.
    for (let i = conv.messages.length - 1; i >= 0; i--) {
        const m = conv.messages[i]!;
        if (m.role === 'user' && startsClean(m)) {
            conv.messages.splice(i);
            break;
        }
    }
    return text;
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
