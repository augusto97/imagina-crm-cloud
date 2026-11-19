import { BadGatewayException, ForbiddenException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import {
    richDocToMarkdown,
    type Capability,
    type RecordAiReplyInput,
    type RecordAiSummary,
    type RecordAiTextResult,
    type RecordAiWriteInput,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from '../ai/assistant.service';
import { AiQuotaExceededError, AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService, AiUnavailableError, type ResolvedAiAccess } from '../ai/ai-settings.service';
import { fieldModelParams } from '../ai/model-params';
import { can } from '../authz/can';
import { friendlyAiReason, jsonFromText } from '../onboarding/onboarding-ai.service';
import { RecordsService, type Actor } from '../records/records.service';
import { REDIS } from '../redis/redis.module';
import {
    CTX_COMMENT_MAX,
    clip,
    cleanModelText,
    composeUserMessage,
    contextFingerprint,
    readSummary,
    replySystemPrompt,
    replyUserMessage,
    rewriteUserMessage,
    summarySystemPrompt,
    summaryUserMessage,
    writeSystemPrompt,
} from './record-ai-context';
import { RecordAiContextService } from './record-ai-context.service';

/** Quien pide: la persona con su rol, rol propio y equipos (`aclOf`). */
export type AiAssistActor = Actor & { capabilities?: readonly Capability[] };

/** Cuánto vive un resumen guardado (si el registro no cambió). */
export const SUMMARY_CACHE_TTL_S = 7 * 24 * 3600;
const SUMMARY_TOKENS = 1500;
const WRITE_TOKENS = 2500;
const REPLY_TOKENS = 900;
const REPLY_THREAD = 12;

interface StoredSummary {
    headline: string;
    points: string[];
    pending: string[];
    next: string[];
    generated_at: string;
    model_name: string | null;
}

/**
 * v0.1.456 (ADR-S109) — La IA dentro de la ficha de un registro: el resumen
 * («¿qué pasó con esto?»), redactar y reescribir texto de la descripción y
 * sugerir la respuesta a un comentario. Cada uno es UN pedido a la IA con las
 * MISMAS reglas que el asistente: la empresa la activó, el plan la incluye,
 * clave de la plataforma (contra la cuota del plan, reservando y cerrando el
 * pedido) o la propia de la empresa. Nada se guarda ni se envía solo: se
 * devuelve TEXTO que la persona revisa.
 */
@Injectable()
export class RecordAiService {
    private readonly logger = new Logger(RecordAiService.name);
    private readonly clientFactory: AiClientFactory;

    constructor(
        private readonly context: RecordAiContextService,
        private readonly records: RecordsService,
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    // ── Resumen ──────────────────────────────────────────────────────────

    async summary(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number, opts: { refresh: boolean }): Promise<RecordAiSummary> {
        assertMayUseAi(actor);
        const gathered = await this.context.gather(tenantId, actor, listKey, recordId);
        const access = await this.access(tenantId, false);
        const fp = contextFingerprint(gathered.context, access.model);
        const key = `airsum:${tenantId}:${gathered.record.id}:${fp}`;
        if (!opts.refresh) {
            const cached = await this.readCache(key);
            if (cached) return { ...cached, cached: true };
        }
        const { text, raw } = await this.ask(tenantId, access, {
            system: summarySystemPrompt(),
            user: summaryUserMessage(gathered.context),
            tokens: SUMMARY_TOKENS,
            json: true,
        });
        const parsed = readSummary(raw, text);
        const stored: StoredSummary = { ...parsed, generated_at: new Date().toISOString(), model_name: access.modelName };
        try {
            await this.redis.set(key, JSON.stringify(stored), 'EX', SUMMARY_CACHE_TTL_S);
        } catch {
            // Sin caché igual se responde (el próximo «Resumir» pide de nuevo).
        }
        return { ...stored, cached: false };
    }

    // ── Escribir con IA ──────────────────────────────────────────────────

    async write(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number, input: RecordAiWriteInput): Promise<RecordAiTextResult> {
        assertMayUseAi(actor);
        // Escribir es para la descripción: hace falta poder EDITAR el registro.
        await this.records.checkUpdate(tenantId, actor, listKey, recordId, {});
        const access = await this.access(tenantId, true);
        let user: string;
        if (input.mode === 'compose') {
            const base = await this.context.basic(tenantId, actor, listKey, recordId);
            const doc = await this.records.getDescription(tenantId, actor, listKey, recordId).catch(() => null);
            const desc = doc ? richDocToMarkdown(doc as never).trim() : '';
            user = composeUserMessage(input.prompt, {
                lista: base.list.name,
                titulo: base.title,
                campos: base.values,
                ...(desc ? { descripcion: clip(desc, 1500) } : {}),
            });
        } else {
            user = rewriteUserMessage(input.text);
        }
        const { text } = await this.ask(tenantId, access, {
            system: writeSystemPrompt(input.mode, input.mode === 'rewrite' ? input.action : undefined),
            user,
            tokens: WRITE_TOKENS,
            json: false,
        });
        const out = cleanModelText(text);
        if (!out) throw providerFailure('La IA no devolvió texto. Intenta de nuevo.');
        return { text: out, model_name: access.modelName };
    }

    // ── Sugerir respuesta ────────────────────────────────────────────────

    async reply(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number, input: RecordAiReplyInput): Promise<RecordAiTextResult> {
        assertMayUseAi(actor);
        const gathered = await this.context.gather(tenantId, actor, listKey, recordId);
        const comments = gathered.comments;
        let thread = comments;
        if (input.comment_id) {
            const target = comments.find((c) => c.id === input.comment_id);
            if (!target) throw new ForbiddenException({ code: 'comment_not_found', message: 'Ese comentario ya no está en este registro.', data: { status: 403 } });
            const rootId = target.parent_id ?? target.id;
            thread = comments.filter((c) => c.id === rootId || c.parent_id === rootId);
        }
        // Una respuesta para el cliente no ve las notas internas del equipo.
        if (input.for_client) thread = thread.filter((c) => c.visibility === 'client' || c.from_client);
        const access = await this.access(tenantId, true);
        const { text } = await this.ask(tenantId, access, {
            system: replySystemPrompt(input.for_client),
            user: replyUserMessage({
                record: { lista: gathered.list.name, titulo: gathered.title, campos: input.for_client ? {} : gathered.context.campos },
                thread: thread.slice(-REPLY_THREAD).map((c) => ({
                    autor: c.from_client ? `${c.author_name ?? 'Cliente'} (cliente)` : (c.user_name ?? 'Alguien del equipo'),
                    para_el_cliente: c.visibility === 'client',
                    texto: clip(c.body, CTX_COMMENT_MAX),
                    fecha: c.created_at,
                })),
                hint: input.hint,
            }),
            tokens: REPLY_TOKENS,
            json: false,
        });
        const out = cleanModelText(text);
        if (!out) throw providerFailure('La IA no devolvió texto. Intenta de nuevo.');
        return { text: out, model_name: access.modelName };
    }

    // ── Internos ─────────────────────────────────────────────────────────

    /**
     * Clave y modelo (la misma resolución que el asistente). `fast` = el
     * modelo rápido de la familia económica para textos cortos; el resumen va
     * con el modelo elegido por la empresa.
     */
    private async access(tenantId: number, fast: boolean): Promise<ResolvedAiAccess> {
        let access: ResolvedAiAccess;
        try {
            access = await this.settings.resolve(tenantId);
        } catch (err) {
            if (err instanceof AiUnavailableError) throw unavailable(err);
            throw err;
        }
        if (!fast) return access;
        try {
            const m = await this.settings.fastModel(access.apiKey);
            return { ...access, model: m.id, modelName: m.name, caps: m.caps };
        } catch {
            return access;
        }
    }

    /** UN pedido: reserva de la cuota (clave de la plataforma), la llamada y el cierre. */
    private async ask(
        tenantId: number,
        access: ResolvedAiAccess,
        p: { system: string; user: string; tokens: number; json: boolean },
    ): Promise<{ text: string; raw: unknown }> {
        const metered = access.source === 'platform';
        if (metered) {
            try {
                await this.quota.reserve(tenantId);
            } catch (err) {
                if (err instanceof AiQuotaExceededError) {
                    throw new ServiceUnavailableException({ code: 'ai_quota_exceeded', message: friendlyAiReason(err), data: { status: 503, reason: 'quota' } });
                }
                throw err;
            }
        }
        let tokens = { input: 0, output: 0 };
        try {
            const params = fieldModelParams(access.caps, p.tokens);
            const stream = this.clientFactory(access.apiKey).messages.stream({
                model: access.model,
                max_tokens: params.max_tokens,
                system: p.system,
                messages: [{ role: 'user', content: p.user }],
                ...params.extra,
            } as never);
            const final: Message = await stream.finalMessage();
            tokens = {
                input: final.usage.input_tokens + (final.usage.cache_creation_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0),
                output: final.usage.output_tokens,
            };
            const text = final.content
                .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
                .map((b) => b.text)
                .join('\n')
                .trim();
            if (final.stop_reason === 'refusal') throw providerFailure('El modelo declinó este pedido.');
            return { text, raw: p.json ? jsonFromText(final.content as never) : undefined };
        } catch (err) {
            if (err instanceof BadGatewayException) throw err;
            this.logger.warn(`Pedido de IA de la ficha falló: ${(err as Error).message}`);
            throw providerFailure(providerMessage(err));
        } finally {
            if (metered) await this.quota.settle(tenantId, tokens);
        }
    }

    private async readCache(key: string): Promise<StoredSummary | null> {
        try {
            const raw = await this.redis.get(key);
            return raw ? (JSON.parse(raw) as StoredSummary) : null;
        } catch {
            return null;
        }
    }
}

/** La persona tiene que poder usar la IA (capacidad «Usar el asistente»). */
export function assertMayUseAi(actor: AiAssistActor): void {
    if (!can(actor, 'use_ai_assistant')) {
        throw new ForbiddenException({ code: 'ai_not_allowed', message: 'Tu rol no puede usar la IA.', data: { status: 403 } });
    }
}

/** Sin IA: el motivo exacto, para que el botón diga qué falta. */
export function unavailable(err: AiUnavailableError): ServiceUnavailableException {
    const message = err.reason === 'plan_module_disabled' || err.reason === 'tenant_disabled' ? err.message : friendlyAiReason(err);
    return new ServiceUnavailableException({ code: 'ai_unavailable', message, data: { status: 503, reason: err.reason } });
}

function providerFailure(message: string): BadGatewayException {
    return new BadGatewayException({ code: 'ai_provider_error', message, data: { status: 502 } });
}

function providerMessage(err: unknown): string {
    const e = err as { status?: number };
    if (e.status === 401) return 'El proveedor de IA rechazó la clave. Revísala en Ajustes → Asistente IA.';
    if (e.status === 429) return 'El proveedor de IA está limitando los pedidos. Intenta de nuevo en un rato.';
    if (e.status === 529 || e.status === 503) return 'El proveedor de IA está saturado. Intenta de nuevo en un rato.';
    return 'La IA no respondió. Intenta de nuevo en un rato.';
}
