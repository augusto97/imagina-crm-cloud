import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { ContentBlockParam, Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { resolveFileImportPlan, type FileImportAiInfo, type FileImportAiJob, type FileImportAiStage, type FileImportPlan } from '@imagina-base/shared';
import type Redis from 'ioredis';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AiSettingsService, AiUnavailableError, type ResolvedAiAccess } from '../ai/ai-settings.service';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from '../ai/assistant.service';
import { assistantModelParams } from '../ai/model-params';
import type { AiToolContext } from '../ai/tools/registry';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { friendlyAiReason, jsonFromText } from '../onboarding/onboarding-ai.service';
import { REDIS } from '../redis/redis.module';
import {
    FILE_IMPORT_AI_TOOL,
    FILE_IMPORT_AI_TOOL_DESCRIPTION,
    buildFileImportSystemPrompt,
    buildFileImportUserMessage,
    fileImportAiOutputSchema,
    mergeAiIntoPlan,
} from './file-import-ai-spec';
import { analysisKey, type StoredAnalysis } from './file-import-store';

const JOB_TTL_SECONDS = 2 * 60 * 60;
const RUNNING_STALE_MS = 5 * 60 * 1000;
export const FILE_IMPORT_AI_ATTEMPTS = 2;
export const FILE_IMPORT_AI_MAX_TOKENS = 12_000;

interface StoredJob {
    state: FileImportAiJob['state'];
    stage: FileImportAiStage | null;
    plan: FileImportPlan | null;
    error: { code: string; message: string } | null;
    started_at: number;
    /** El análisis gastó un lugar del cupo del mes (se devuelve si falla). */
    reserved: string | null;
}

/**
 * v0.1.339 (ADR-S88) — El análisis con IA de «Crear desde un archivo».
 *
 * Costo y acceso (decidido con el usuario):
 *  - con la clave de la PLATAFORMA, un CUPO PROPIO por empresa y por mes
 *    (`import_ai_monthly`, 3 por defecto, editable en Plataforma → Asistente
 *    IA): no gasta la cuota de IA del plan ni exige su módulo — es para
 *    empezar a usar la app;
 *  - con la clave PROPIA de la empresa, sin tope;
 *  - consentimiento en línea (queda en la bitácora), no el opt-in del asistente;
 *  - si falla (el proveedor o una respuesta que no sirve), el lugar del cupo
 *    se devuelve.
 *
 * Corre en segundo plano y deja el estado en Redis: el navegador pregunta.
 */
@Injectable()
export class FileImportAiService {
    private readonly logger = new Logger(FileImportAiService.name);
    private readonly clientFactory: AiClientFactory;
    private readonly inflight = new Map<string, Promise<void>>();

    constructor(
        private readonly settings: AiSettingsService,
        private readonly audit: AuditService,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    /** Si el análisis con IA se puede usar ahora, cuántos quedan y por qué no. No gasta nada. */
    async availability(ctx: AiToolContext): Promise<FileImportAiInfo> {
        if (!can(ctx, 'use_ai_assistant')) return { available: false, reason: 'Tu rol no puede usar la IA.', remaining: null };
        let access: ResolvedAiAccess;
        try {
            access = await this.settings.resolve(ctx.tenantId, { requireOptIn: false, skipPlanModule: true });
        } catch (err) {
            if (err instanceof AiUnavailableError) return { available: false, reason: friendlyAiReason(err), remaining: null };
            throw err;
        }
        if (access.source === 'tenant') return { available: true, reason: null, remaining: null };
        const limit = await this.settings.importAiMonthly();
        if (limit === 0) return { available: false, reason: 'El análisis con IA para importar no está activado en este servidor.', remaining: 0 };
        const used = Number((await this.redis.get(quotaKey(ctx.tenantId))) ?? 0);
        const remaining = Math.max(0, limit - used);
        if (remaining === 0) {
            return {
                available: false,
                reason: `Ya usaste los ${limit} análisis con IA de este mes. Puedes crear la lista con el borrador o cargar una clave propia en Ajustes → Asistente IA.`,
                remaining: 0,
            };
        }
        return { available: true, reason: null, remaining };
    }

    /**
     * Arranca el análisis. Falla ANTES de gastar nada si no se puede. Un
     * análisis en curso o ya terminado del mismo archivo se reusa: dos clics
     * no gastan dos lugares del cupo.
     */
    async start(ctx: AiToolContext, analysisId: string): Promise<FileImportAiJob> {
        if (!can(ctx, 'use_ai_assistant')) {
            throw new ForbiddenException({ code: 'ai_not_allowed', message: 'Tu rol no puede usar la IA.', data: { status: 403 } });
        }
        const analysis = await this.readAnalysis(ctx.tenantId, ctx.userId, analysisId);
        if (!analysis) throw notFound();
        const current = await this.readJob(ctx.tenantId, ctx.userId, analysisId);
        if (current && (current.state === 'done' || (current.state === 'running' && Date.now() - current.started_at < RUNNING_STALE_MS))) {
            return toJob(current);
        }

        let access: ResolvedAiAccess;
        try {
            access = await this.settings.resolve(ctx.tenantId, { requireOptIn: false, skipPlanModule: true });
        } catch (err) {
            if (err instanceof AiUnavailableError) {
                throw new ServiceUnavailableException({ code: 'file_import_ai_unavailable', message: friendlyAiReason(err), data: { status: 503 } });
            }
            throw err;
        }
        let reserved: string | null = null;
        if (access.source === 'platform') {
            const limit = await this.settings.importAiMonthly();
            const key = quotaKey(ctx.tenantId);
            const n = await this.redis.incr(key);
            await this.redis.expire(key, 40 * 24 * 3600);
            if (n > limit) {
                await this.redis.decr(key);
                const info = await this.availability(ctx);
                throw new ServiceUnavailableException({
                    code: 'file_import_ai_quota',
                    message: info.reason ?? 'Ya usaste los análisis con IA de este mes.',
                    data: { status: 503 },
                });
            }
            reserved = key;
        }

        const job: StoredJob = { state: 'running', stage: 'thinking', plan: null, error: null, started_at: Date.now(), reserved };
        await this.writeJob(ctx.tenantId, ctx.userId, analysisId, job);
        // El consentimiento queda en la bitácora (el archivo no: sólo cuánto se mandó).
        void this.audit.log({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'file_import.ai_request',
            targetType: 'workspace',
            targetId: ctx.tenantId,
            targetLabel: analysis.file_name.slice(0, 190),
            meta: {
                consent: true,
                sheets: analysis.sheets.length,
                columns: analysis.sheets.reduce((n, s) => n + s.columns.length, 0),
                key: access.source,
            },
        });
        const p = this.run(ctx, analysisId, analysis, access, job)
            .catch((err: unknown) => this.logger.warn(`Análisis con IA de un archivo falló: ${err instanceof Error ? err.message : String(err)}`))
            .finally(() => this.inflight.delete(analysisId));
        this.inflight.set(analysisId, p);
        return toJob(job);
    }

    /** Sólo para los tests: espera a que termine un análisis. */
    async settle(analysisId: string): Promise<void> {
        await this.inflight.get(analysisId);
    }

    async get(tenantId: number, userId: number, analysisId: string): Promise<FileImportAiJob> {
        const job = await this.readJob(tenantId, userId, analysisId);
        if (!job) throw new NotFoundException({ code: 'file_import_ai_not_found', message: 'Todavía no se pidió el análisis con IA.', data: { status: 404 } });
        if (job.state === 'running' && Date.now() - job.started_at > RUNNING_STALE_MS && !this.inflight.has(analysisId)) {
            job.state = 'error';
            job.stage = null;
            job.error = { code: 'timeout', message: 'La IA tardó demasiado. Puedes seguir con el borrador o volver a intentarlo.' };
            await this.refund(job);
            await this.writeJob(tenantId, userId, analysisId, job);
        }
        return toJob(job);
    }

    private async run(ctx: AiToolContext, analysisId: string, analysis: StoredAnalysis, access: ResolvedAiAccess, job: StoredJob): Promise<void> {
        const client = this.clientFactory(access.apiKey);
        const tool = { name: FILE_IMPORT_AI_TOOL, description: FILE_IMPORT_AI_TOOL_DESCRIPTION, input_schema: toInputSchema(fileImportAiOutputSchema) };
        const messages: MessageParam[] = [{ role: 'user', content: buildFileImportUserMessage(analysis.file_name, analysis.sheets, analysis.plan) }];
        let tokens = 0;
        try {
            const model = await this.settings.fastModel(access.apiKey);
            for (let attempt = 0; attempt < FILE_IMPORT_AI_ATTEMPTS; attempt++) {
                await this.stage(ctx, analysisId, job, attempt === 0 ? 'thinking' : 'fixing');
                const stream = client.messages.stream({
                    model: model.id,
                    max_tokens: FILE_IMPORT_AI_MAX_TOKENS,
                    system: [{ type: 'text', text: buildFileImportSystemPrompt() }],
                    tools: [tool] as never,
                    messages,
                    ...assistantModelParams(model.caps, 'low'),
                });
                const final: Message = await stream.finalMessage();
                tokens += final.usage.input_tokens + final.usage.output_tokens;
                const toolUse = final.content.find(
                    (b): b is Extract<(typeof final.content)[number], { type: 'tool_use' }> => b.type === 'tool_use' && b.name === FILE_IMPORT_AI_TOOL,
                );
                const raw: unknown = toolUse ? toolUse.input : jsonFromText(final.content);
                let problem: string;
                if (raw === undefined) {
                    problem = final.stop_reason === 'max_tokens' ? 'La respuesta salió demasiado larga: manda sólo las columnas que cambias.' : `No llamaste a ${FILE_IMPORT_AI_TOOL}.`;
                } else {
                    await this.stage(ctx, analysisId, job, 'checking');
                    const parsed = fileImportAiOutputSchema.safeParse(raw);
                    if (!parsed.success) {
                        problem = parsed.error.issues
                            .slice(0, 8)
                            .map((i) => `${i.path.join('.')}: ${i.message}`)
                            .join('\n');
                    } else {
                        const plan = mergeAiIntoPlan(analysis.plan, parsed.data, analysis.sheets, analysis.defaults);
                        const errors = resolveFileImportPlan(plan, analysis.sheets).errors;
                        if (errors.length === 0) {
                            job.plan = plan;
                            job.state = 'done';
                            job.stage = null;
                            await this.writeJob(ctx.tenantId, ctx.userId, analysisId, job);
                            return;
                        }
                        problem = errors.slice(0, 8).join('\n');
                    }
                }
                if (attempt === FILE_IMPORT_AI_ATTEMPTS - 1) {
                    this.logger.warn(`El análisis con IA no validó tras ${FILE_IMPORT_AI_ATTEMPTS} intentos: ${problem.slice(0, 300)}`);
                    throw new FileImportAiFailure('invalid_plan', 'La IA no logró mejorar el borrador. Puedes revisarlo y crear la lista tal cual.');
                }
                messages.push({ role: 'assistant', content: final.content as ContentBlockParam[] });
                if (toolUse) {
                    messages.push({
                        role: 'user',
                        content: [{ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `Problemas:\n${problem}\n\nCorrígelos y vuelve a llamar a ${FILE_IMPORT_AI_TOOL}.` }],
                    });
                } else {
                    messages.push({ role: 'user', content: `${problem} Llama a ${FILE_IMPORT_AI_TOOL}.` });
                }
            }
        } catch (err) {
            job.state = 'error';
            job.stage = null;
            job.error =
                err instanceof FileImportAiFailure
                    ? { code: err.code, message: err.message }
                    : err instanceof AiUnavailableError
                      ? { code: 'ai_unavailable', message: friendlyAiReason(err) }
                      : { code: 'provider_error', message: 'No se pudo hablar con la IA. Puedes seguir con el borrador o intentarlo en un momento.' };
            if (!(err instanceof FileImportAiFailure)) this.logger.warn(`Error del proveedor al analizar un archivo: ${err instanceof Error ? err.message : String(err)}`);
            await this.refund(job);
            await this.writeJob(ctx.tenantId, ctx.userId, analysisId, job);
        } finally {
            if (tokens > 0) this.logger.log(`Análisis con IA de un archivo (empresa ${ctx.tenantId}, clave ${access.source}): ${tokens} tokens`);
        }
    }

    /** Un análisis que no sirvió no gasta el cupo del mes. */
    private async refund(job: StoredJob): Promise<void> {
        if (!job.reserved) return;
        const key = job.reserved;
        job.reserved = null;
        await this.redis.decr(key).catch(() => undefined);
    }

    private async stage(ctx: AiToolContext, analysisId: string, job: StoredJob, stage: FileImportAiStage): Promise<void> {
        job.stage = stage;
        await this.writeJob(ctx.tenantId, ctx.userId, analysisId, job);
    }

    private async readAnalysis(tenantId: number, userId: number, id: string): Promise<StoredAnalysis | null> {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
        const raw = await this.redis.get(analysisKey(tenantId, userId, id));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StoredAnalysis;
        } catch {
            return null;
        }
    }

    private async readJob(tenantId: number, userId: number, id: string): Promise<StoredJob | null> {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
        const raw = await this.redis.get(jobKey(tenantId, userId, id));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StoredJob;
        } catch {
            return null;
        }
    }

    private async writeJob(tenantId: number, userId: number, id: string, job: StoredJob): Promise<void> {
        await this.redis.set(jobKey(tenantId, userId, id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
    }
}

class FileImportAiFailure extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function toJob(job: StoredJob): FileImportAiJob {
    return { state: job.state, stage: job.stage, plan: job.plan, error: job.error };
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'file_import_expired', message: 'El análisis venció: vuelve a subir el archivo.', data: { status: 404 } });
}

function jobKey(tenantId: number, userId: number, id: string): string {
    return `fileimport:ai:${tenantId}:${userId}:${id}`;
}

/** Cupo del mes (UTC) de la empresa. */
export function quotaKey(tenantId: number, now: Date = new Date()): string {
    return `fileimport:aiq:${tenantId}:${now.toISOString().slice(0, 7)}`;
}

function toInputSchema(schema: ZodTypeAny): Record<string, unknown> {
    const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, o: Record<string, unknown>) => Record<string, unknown>;
    const json = convert(schema, { $refStrategy: 'none', target: 'jsonSchema7' });
    delete json.$schema;
    return json;
}
