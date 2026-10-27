import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import type { ContentBlockParam, Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
    FALLBACK_TIME_ZONE,
    zonedToday,
    type OnboardingAiJob,
    type OnboardingAiRequest,
    type OnboardingAiStatus,
    type OnboardingJobStage,
    type OnboardingProposal,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AiQuotaExceededError, AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService, AiUnavailableError, type ResolvedAiAccess } from '../ai/ai-settings.service';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from '../ai/assistant.service';
import { assistantMaxTokens, assistantModelParams } from '../ai/model-params';
import { AiToolError, type AiToolContext } from '../ai/tools/registry';
import { StructureTools } from '../ai/tools/structure-tools';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { ListsService } from '../lists/lists.service';
import { REDIS } from '../redis/redis.module';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import {
    ONBOARDING_TOOL_DESCRIPTION,
    ONBOARDING_TOOL_NAME,
    attachSampleRecords,
    buildOnboardingDashboard,
    buildOnboardingSystemPrompt,
    buildOnboardingUserMessage,
    describeOutputIssues,
    finalizeBlueprint,
    onboardingAiOutputSchema,
    toListSpecs,
} from './onboarding-ai-spec';

/** Cuánto vive una propuesta para revisar y crear. */
const JOB_TTL_SECONDS = 2 * 60 * 60;
/** Un pedido que no terminó en este tiempo se da por caído (proceso reiniciado, red cortada). */
const RUNNING_STALE_MS = 6 * 60 * 1000;
/** Primer intento + un reintento con los errores (ADR-S72). */
export const ONBOARDING_MAX_ATTEMPTS = 2;
/** Tope de salida (el pensamiento cuenta dentro): acotado aunque el esfuerzo sea alto. */
export const ONBOARDING_MAX_TOKENS = 16_000;

interface StoredJob {
    id: string;
    state: OnboardingAiJob['state'];
    stage: OnboardingJobStage | null;
    proposal: OnboardingProposal | null;
    error: { code: string; message: string } | null;
    started_at: number;
}

/** Motivos de «no disponible» en una línea, sin jerga. */
export function friendlyAiReason(err: unknown): string {
    if (err instanceof AiQuotaExceededError) return 'Se agotaron los pedidos a la IA de tu plan este mes.';
    if (err instanceof AiUnavailableError) {
        switch (err.reason) {
            case 'platform_disabled':
                return 'La IA no está activada en este servidor.';
            case 'platform_key_missing':
                return 'La IA todavía no está configurada en este servidor.';
            case 'own_key_required':
                return 'Para usar la IA, carga una clave propia en Ajustes → Asistente IA.';
            case 'tenant_key_unreadable':
            case 'platform_key_unreadable':
                return 'La clave de la IA no se puede leer: revísala en Ajustes → Asistente IA.';
            case 'models_unavailable':
                return 'El proveedor de IA no responde en este momento. Intenta de nuevo en un rato.';
            default:
                return 'La IA no está disponible en este momento.';
        }
    }
    return 'La IA no está disponible en este momento.';
}

/**
 * «Cuéntanos de tu negocio» (F7, ADR-S72): un pedido a la IA que arma la
 * propuesta del espacio de una empresa. Corre en segundo plano (la respuesta
 * puede tardar un minuto o más y un proxy cortaría una petición así) y deja
 * el estado en Redis: el navegador pregunta cada poco.
 *
 * Datos y costo: misma resolución que el asistente (clave de la plataforma
 * contra la cuota del plan, o la propia de la empresa; modelo y esfuerzo como
 * siempre) pero SIN exigir el opt-in del asistente — este pedido único trae
 * su propio consentimiento en línea, que queda en la bitácora. Cuenta como UN
 * pedido de la cuota aunque haga falta el reintento.
 */
@Injectable()
export class OnboardingAiService {
    private readonly logger = new Logger(OnboardingAiService.name);
    private readonly clientFactory: AiClientFactory;
    private readonly inflight = new Map<string, Promise<void>>();

    constructor(
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        private readonly structure: StructureTools,
        private readonly lists: ListsService,
        private readonly audit: AuditService,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    /** Si la opción con IA se puede usar ahora, y por qué no. No gasta nada. */
    async status(ctx: AiToolContext): Promise<OnboardingAiStatus> {
        const hasLists = (await this.lists.list(ctx.tenantId)).length > 0;
        if (!can(ctx, 'use_ai_assistant')) {
            return { available: false, reason: 'Tu rol no puede usar la IA. Pídele a un administrador que lo active.', source: null, has_lists: hasLists };
        }
        try {
            const access = await this.settings.resolve(ctx.tenantId, { requireOptIn: false });
            if (access.source === 'platform') await this.quota.assertWithinQuota(ctx.tenantId);
            return { available: true, reason: null, source: access.source, has_lists: hasLists };
        } catch (err) {
            if (err instanceof AiUnavailableError || err instanceof AiQuotaExceededError) {
                return { available: false, reason: friendlyAiReason(err), source: null, has_lists: hasLists };
            }
            throw err;
        }
    }

    /**
     * Arranca un pedido. Si no se puede hablar con la IA, falla ANTES de
     * guardar nada (con el motivo). Un pedido en curso de la misma persona
     * se reusa: dos clics no gastan dos pedidos.
     */
    async start(ctx: AiToolContext, input: OnboardingAiRequest): Promise<{ id: string }> {
        if (!can(ctx, 'use_ai_assistant')) {
            throw new ForbiddenException({ code: 'ai_not_allowed', message: 'Tu rol no puede usar la IA.', data: { status: 403 } });
        }
        let access: ResolvedAiAccess;
        try {
            access = await this.settings.resolve(ctx.tenantId, { requireOptIn: false });
            if (access.source === 'platform') await this.quota.assertWithinQuota(ctx.tenantId);
        } catch (err) {
            if (err instanceof AiUnavailableError || err instanceof AiQuotaExceededError) {
                throw new ServiceUnavailableException({ code: 'onboarding_ai_unavailable', message: friendlyAiReason(err), data: { status: 503 } });
            }
            throw err;
        }

        const running = await this.redis.get(runningKey(ctx.tenantId, ctx.userId));
        if (running) {
            const job = await this.read(ctx.tenantId, ctx.userId, running);
            if (job && job.state === 'running' && Date.now() - job.started_at < RUNNING_STALE_MS) return { id: job.id };
        }

        const id = randomBytes(12).toString('base64url');
        const job: StoredJob = { id, state: 'running', stage: 'thinking', proposal: null, error: null, started_at: Date.now() };
        await this.write(ctx.tenantId, ctx.userId, job);
        await this.redis.set(runningKey(ctx.tenantId, ctx.userId), id, 'EX', Math.ceil(RUNNING_STALE_MS / 1000));
        // El consentimiento queda en la bitácora (el texto no: puede traer datos del negocio).
        void this.audit.log({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'onboarding.ai_request',
            targetType: 'workspace',
            targetId: ctx.tenantId,
            targetLabel: '',
            meta: {
                consent: true,
                chars: input.description.length,
                focus: input.focus,
                team_size: input.team_size ?? null,
                key: access.source,
            },
        });
        const p = this.run(ctx, input, access, job)
            .catch((err: unknown) => this.logger.warn(`Pedido de bienvenida con IA falló: ${err instanceof Error ? err.message : String(err)}`))
            .finally(() => this.inflight.delete(id));
        this.inflight.set(id, p);
        return { id };
    }

    /** Sólo para los tests: espera a que termine un pedido. */
    async settle(id: string): Promise<void> {
        await this.inflight.get(id);
    }

    async get(tenantId: number, userId: number, id: string): Promise<OnboardingAiJob | null> {
        const job = await this.read(tenantId, userId, id);
        if (!job) return null;
        if (job.state === 'running' && Date.now() - job.started_at > RUNNING_STALE_MS && !this.inflight.has(id)) {
            job.state = 'error';
            job.stage = null;
            job.error = { code: 'timeout', message: 'La IA tardó demasiado. Vuelve a intentarlo.' };
            await this.write(tenantId, userId, job);
        }
        return { id: job.id, state: job.state, stage: job.stage, proposal: job.proposal, error: job.error };
    }

    /**
     * Toma la propuesta para crearla. Un candado corto evita crear dos veces
     * con dos clics; si la creación falla, `release` la devuelve.
     */
    async claim(tenantId: number, userId: number, id: string): Promise<OnboardingProposal> {
        const job = await this.read(tenantId, userId, id);
        if (!job || job.state === 'error') {
            throw new NotFoundException({ code: 'onboarding_proposal_not_found', message: 'La propuesta venció. Vuelve a pedirla.', data: { status: 404 } });
        }
        if (job.state === 'applied') {
            throw new ConflictException({ code: 'onboarding_already_applied', message: 'Esta propuesta ya se creó.', data: { status: 409 } });
        }
        if (job.state !== 'done' || !job.proposal) {
            throw new ConflictException({ code: 'onboarding_not_ready', message: 'La propuesta todavía no está lista.', data: { status: 409 } });
        }
        const ok = await this.redis.set(lockKey(tenantId, userId, id), '1', 'EX', 120, 'NX');
        if (ok !== 'OK') {
            throw new ConflictException({ code: 'onboarding_already_applying', message: 'Ya se está creando esta propuesta.', data: { status: 409 } });
        }
        return job.proposal;
    }

    async release(tenantId: number, userId: number, id: string): Promise<void> {
        await this.redis.del(lockKey(tenantId, userId, id));
    }

    async markApplied(tenantId: number, userId: number, id: string): Promise<void> {
        const job = await this.read(tenantId, userId, id);
        if (job) {
            job.state = 'applied';
            await this.write(tenantId, userId, job);
        }
        await this.redis.del(lockKey(tenantId, userId, id));
    }

    // ── El pedido ───────────────────────────────────────────────────────────

    private async run(ctx: AiToolContext, input: OnboardingAiRequest, access: ResolvedAiAccess, job: StoredJob): Promise<void> {
        const timeZone = this.timeZones ? await this.timeZones.get(ctx.tenantId).catch(() => null) : null;
        const existing = (await this.lists.list(ctx.tenantId)).map((l) => l.name);
        const system = buildOnboardingSystemPrompt();
        const user = buildOnboardingUserMessage(input, { today: zonedToday(timeZone ?? FALLBACK_TIME_ZONE), existingLists: existing });
        const tool = { name: ONBOARDING_TOOL_NAME, description: ONBOARDING_TOOL_DESCRIPTION, input_schema: toInputSchema(onboardingAiOutputSchema) };
        const client = this.clientFactory(access.apiKey);
        const messages: MessageParam[] = [{ role: 'user', content: user }];
        let inputTokens = 0;
        let outputTokens = 0;

        try {
            for (let attempt = 0; attempt < ONBOARDING_MAX_ATTEMPTS; attempt++) {
                await this.stage(ctx, job, attempt === 0 ? 'thinking' : 'fixing');
                const stream = client.messages.stream({
                    model: access.model,
                    max_tokens: Math.min(assistantMaxTokens(access.effort), ONBOARDING_MAX_TOKENS),
                    system: [{ type: 'text', text: system }],
                    tools: [tool] as never,
                    messages,
                    ...assistantModelParams(access.caps, access.effort),
                });
                const final: Message = await stream.finalMessage();
                inputTokens += final.usage.input_tokens + (final.usage.cache_creation_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0);
                outputTokens += final.usage.output_tokens;

                const toolUse = final.content.find(
                    (b): b is Extract<(typeof final.content)[number], { type: 'tool_use' }> => b.type === 'tool_use' && b.name === ONBOARDING_TOOL_NAME,
                );
                const raw: unknown = toolUse ? toolUse.input : jsonFromText(final.content);
                let problem: string;
                if (raw === undefined) {
                    problem =
                        final.stop_reason === 'max_tokens'
                            ? 'La propuesta salió demasiado larga y se cortó: hazla más corta (menos campos y menos registros de ejemplo).'
                            : `No llamaste a ${ONBOARDING_TOOL_NAME}.`;
                } else {
                    await this.stage(ctx, job, 'checking');
                    try {
                        job.proposal = await this.validate(ctx, raw);
                        job.state = 'done';
                        job.stage = null;
                        await this.write(ctx.tenantId, ctx.userId, job);
                        return;
                    } catch (err) {
                        problem = problemOf(err);
                    }
                }
                if (attempt === ONBOARDING_MAX_ATTEMPTS - 1) {
                    this.logger.warn(`La propuesta de bienvenida no validó tras ${ONBOARDING_MAX_ATTEMPTS} intentos: ${problem.slice(0, 300)}`);
                    throw new OnboardingAiFailure(
                        'invalid_proposal',
                        'La IA no logró armar una propuesta que funcione. Prueba con otra descripción o elige por tipo de negocio.',
                    );
                }
                messages.push({ role: 'assistant', content: final.content as ContentBlockParam[] });
                if (toolUse) {
                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'tool_result',
                                tool_use_id: toolUse.id,
                                is_error: true,
                                content: `Problemas:\n${problem}\n\nCorrígelos y vuelve a llamar a ${ONBOARDING_TOOL_NAME} con la propuesta COMPLETA.`,
                            },
                        ],
                    });
                } else {
                    messages.push({ role: 'user', content: `${problem} Llama a ${ONBOARDING_TOOL_NAME} con la propuesta completa.` });
                }
            }
        } catch (err) {
            job.state = 'error';
            job.stage = null;
            job.error =
                err instanceof OnboardingAiFailure
                    ? { code: err.code, message: err.message }
                    : { code: 'provider_error', message: 'No se pudo hablar con la IA. Intenta de nuevo en un momento o elige por tipo de negocio.' };
            if (!(err instanceof OnboardingAiFailure)) this.logger.warn(`Error del proveedor en la bienvenida: ${err instanceof Error ? err.message : String(err)}`);
            await this.write(ctx.tenantId, ctx.userId, job);
        } finally {
            await this.redis.del(runningKey(ctx.tenantId, ctx.userId)).catch(() => undefined);
            // UN pedido de la cuota, con los tokens reales de los intentos.
            if (access.source === 'platform' && (inputTokens > 0 || outputTokens > 0)) {
                await this.quota
                    .record(ctx.tenantId, { input: inputTokens, output: outputTokens })
                    .catch((e: unknown) => this.logger.warn(`No se pudo registrar el uso IA: ${String(e)}`));
            }
        }
    }

    /** La salida del modelo → propuesta válida, o un error corregible. */
    async validate(ctx: AiToolContext, raw: unknown): Promise<OnboardingProposal> {
        const parsed = onboardingAiOutputSchema.safeParse(raw);
        if (!parsed.success) throw new AiToolError(describeOutputIssues(parsed.error));
        const out = parsed.data;
        let blueprint = await this.structure.buildCreateListBlueprint(ctx, toListSpecs(out));
        blueprint = attachSampleRecords(blueprint, out);
        if (out.dashboard) blueprint = { ...blueprint, dashboards: [buildOnboardingDashboard(out.dashboard, blueprint)] };
        return { business_name: out.business_name, summary: out.summary, blueprint: finalizeBlueprint(blueprint) };
    }

    private async stage(ctx: AiToolContext, job: StoredJob, stage: OnboardingJobStage): Promise<void> {
        job.stage = stage;
        await this.write(ctx.tenantId, ctx.userId, job);
    }

    private async read(tenantId: number, userId: number, id: string): Promise<StoredJob | null> {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
        const raw = await this.redis.get(jobKey(tenantId, userId, id));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as StoredJob;
        } catch {
            return null;
        }
    }

    private async write(tenantId: number, userId: number, job: StoredJob): Promise<void> {
        await this.redis.set(jobKey(tenantId, userId, job.id), JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
    }
}

class OnboardingAiFailure extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function jobKey(tenantId: number, userId: number, id: string): string {
    return `onboarding:ai:${tenantId}:${userId}:${id}`;
}
function runningKey(tenantId: number, userId: number): string {
    return `onboarding:ai:run:${tenantId}:${userId}`;
}
function lockKey(tenantId: number, userId: number, id: string): string {
    return `onboarding:ai:lock:${tenantId}:${userId}:${id}`;
}

/** El mensaje que vuelve al modelo para el reintento. */
function problemOf(err: unknown): string {
    if (err instanceof AiToolError) return err.message;
    if (err instanceof HttpException && err.getStatus() < 500) {
        const resp = err.getResponse() as { message?: unknown } | string;
        return typeof resp === 'string' ? resp : typeof resp.message === 'string' ? resp.message : err.message;
    }
    throw err;
}

/** Si el modelo respondió con texto en vez de la herramienta, el primer objeto JSON del texto. */
export function jsonFromText(content: ReadonlyArray<{ type: string; text?: string }>): unknown {
    const text = content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return undefined;
    }
}

function toInputSchema(schema: ZodTypeAny): Record<string, unknown> {
    const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, o: Record<string, unknown>) => Record<string, unknown>;
    const json = convert(schema, { $refStrategy: 'none', target: 'jsonSchema7' });
    delete json.$schema;
    return json;
}
