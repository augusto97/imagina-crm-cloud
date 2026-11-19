import { ForbiddenException, HttpException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { ContentBlockParam, Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
    AUTOMATION_SECRET_MARKER,
    FALLBACK_TIME_ZONE,
    automationConfigIssues,
    zonedToday,
    type AutomationAiDraftAutomation,
    type AutomationAiDraftJob,
    type AutomationAiDraftMode,
    type AutomationAiDraftRequest,
    type AutomationAiDraftResult,
    type AutomationAiDraftStage,
    type AutomationAiDraftStatus,
} from '@imagina-base/shared';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { hasRedactedSecrets, redactAutomationSecrets, restoreRedactedSecrets } from '../automations/automation-secrets';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { friendlyAiReason, jsonFromText } from '../onboarding/onboarding-ai.service';
import { REDIS } from '../redis/redis.module';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from './ai-client';
import { AiQuotaExceededError, AiQuotaService } from './ai-quota.service';
import { AiSettingsService, AiUnavailableError, type ResolvedAiAccess } from './ai-settings.service';
import {
    AUTOMATION_DRAFT_TOOL_NAME,
    automationDraftToolDescription,
    automationDraftToolSchema,
    buildDraftSystemPrompt,
    buildDraftUserContent,
    issueWarnings,
    mergeWarnings,
    slimSchemaForDraft,
} from './automation-draft';
import { assistantMaxTokens, assistantModelParams } from './model-params';
import { emailActionsForModel } from './tools/design-builders';
import { AiToolError, AiToolRegistry, type AiToolContext } from './tools/registry';
import { StructureTools, type AutomationSpec } from './tools/structure-tools';

/** Cuánto vive el resultado para cargarlo en el editor. */
const JOB_TTL_SECONDS = 60 * 60;
/** Un pedido que no terminó en este tiempo se da por caído (proceso reiniciado, red cortada). */
const RUNNING_STALE_MS = 5 * 60 * 1000;
/** Primer intento + UN reintento con los errores (como la bienvenida, ADR-S72). */
export const AUTOMATION_DRAFT_MAX_ATTEMPTS = 2;
/** Tope de salida (el pensamiento cuenta dentro). */
export const AUTOMATION_DRAFT_MAX_TOKENS = 16_000;

interface StoredJob {
    id: string;
    list_id: number;
    state: AutomationAiDraftJob['state'];
    stage: AutomationAiDraftStage | null;
    result: AutomationAiDraftResult | null;
    error: { code: string; message: string } | null;
    started_at: number;
}

/** El motivo de «no disponible» en una línea, para el botón. */
function reasonOf(err: AiUnavailableError | AiQuotaExceededError): string {
    if (err instanceof AiUnavailableError && (err.reason === 'plan_module_disabled' || err.reason === 'tenant_disabled')) return err.message;
    return friendlyAiReason(err);
}

/**
 * v0.1.463 — «Describe la automatización y la armo» dentro del editor de
 * automatizaciones (E7; addendum de ADR-S21 y ADR-S47).
 *
 * UN pedido a la IA por borrador, con la MISMA resolución que el resto de la
 * IA de la app: la empresa la activó, el plan incluye el módulo, clave de la
 * plataforma contra la cuota del plan (se reserva antes y se cierra al final;
 * si el modelo nunca contestó, se devuelve) o la clave propia de la empresa.
 * El modelo no escribe: entrega la automatización con `submit_automation` y
 * el servidor la pasa por el MISMO constructor que `propose_create_automation`
 * (slugs → ids y validación). Si no valida, UN reintento con los errores.
 *
 * Corre en segundo plano (un modelo con esfuerzo alto puede tardar más que lo
 * que aguanta un proxy) y el navegador pregunta cada poco. El resultado no se
 * guarda en ninguna automatización: vuelve al editor, que lo muestra sin
 * guardar.
 *
 * Secretos: la automatización actual («Pedir un cambio») viaja al modelo con
 * las credenciales tapadas y el resultado las recupera de la actual, paso por
 * paso (`restoreRedactedSecrets`, lo mismo que restaurar una versión).
 */
@Injectable()
export class AutomationDraftService {
    private readonly logger = new Logger(AutomationDraftService.name);
    private readonly clientFactory: AiClientFactory;
    private readonly inflight = new Map<string, Promise<void>>();

    constructor(
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        private readonly structure: StructureTools,
        private readonly registry: AiToolRegistry,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly audit: AuditService,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    /** Si el botón se puede usar ahora y, si no, por qué. No gasta nada. */
    async status(ctx: AiToolContext): Promise<AutomationAiDraftStatus> {
        if (!can(ctx, 'use_ai_assistant')) {
            return { available: false, reason: 'Tu rol no puede usar la IA. Pídele a un administrador que lo active.', source: null };
        }
        try {
            const access = await this.settings.resolve(ctx.tenantId);
            if (access.source === 'platform') await this.quota.assertWithinQuota(ctx.tenantId);
            return { available: true, reason: null, source: access.source };
        } catch (err) {
            if (err instanceof AiUnavailableError || err instanceof AiQuotaExceededError) return { available: false, reason: reasonOf(err), source: null };
            throw err;
        }
    }

    /**
     * Arranca un pedido. Sin IA, falla ANTES de reservar nada (con el motivo).
     * Un pedido en curso de la misma persona en la misma lista se reusa: dos
     * clics no gastan dos pedidos.
     */
    async start(ctx: AiToolContext, listKey: string, input: AutomationAiDraftRequest): Promise<{ id: string }> {
        if (!can(ctx, 'use_ai_assistant')) {
            throw new ForbiddenException({ code: 'ai_not_allowed', message: 'Tu rol no puede usar la IA.', data: { status: 403 } });
        }
        const list = await this.lists.get(ctx.tenantId, listKey);
        let access: ResolvedAiAccess;
        try {
            access = await this.settings.resolve(ctx.tenantId);
            if (access.source === 'platform') await this.quota.assertWithinQuota(ctx.tenantId);
        } catch (err) {
            if (err instanceof AiUnavailableError || err instanceof AiQuotaExceededError) {
                throw new ServiceUnavailableException({ code: 'ai_unavailable', message: reasonOf(err), data: { status: 503 } });
            }
            throw err;
        }

        const runKey = runningKey(ctx.tenantId, ctx.userId, list.id);
        const running = await this.redis.get(runKey);
        if (running) {
            const job = await this.read(ctx.tenantId, ctx.userId, running);
            if (job && job.state === 'running' && Date.now() - job.started_at < RUNNING_STALE_MS) return { id: job.id };
        }

        const metered = access.source === 'platform';
        if (metered) {
            try {
                await this.quota.reserve(ctx.tenantId);
            } catch (err) {
                if (err instanceof AiQuotaExceededError) {
                    throw new ServiceUnavailableException({ code: 'ai_unavailable', message: reasonOf(err), data: { status: 503 } });
                }
                throw err;
            }
        }
        const id = randomBytes(12).toString('base64url');
        const job: StoredJob = { id, list_id: list.id, state: 'running', stage: 'thinking', result: null, error: null, started_at: Date.now() };
        try {
            await this.write(ctx.tenantId, ctx.userId, job);
            await this.redis.set(runKey, id, 'EX', Math.ceil(RUNNING_STALE_MS / 1000));
        } catch (err) {
            if (metered) await this.quota.settle(ctx.tenantId, { input: 0, output: 0 });
            throw err;
        }
        const mode: AutomationAiDraftMode = input.current ? 'change' : 'create';
        // La bitácora: quién y en qué lista, nunca lo que escribió.
        void this.audit.log({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            action: 'automation.ai_draft',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { mode, chars: input.description.length, automation_id: input.current?.id ?? null, key: access.source },
        });
        const p = this.run({ ...ctx, listSlug: list.slug }, list, input, access, job)
            .catch((err: unknown) => this.logger.warn(`«Describir con IA» falló: ${err instanceof Error ? err.message : String(err)}`))
            .finally(() => this.inflight.delete(id));
        this.inflight.set(id, p);
        return { id };
    }

    /** Sólo para los tests: espera a que termine un pedido. */
    async settle(id: string): Promise<void> {
        await this.inflight.get(id);
    }

    async get(tenantId: number, userId: number, listId: number, id: string): Promise<AutomationAiDraftJob | null> {
        const job = await this.read(tenantId, userId, id);
        if (!job || job.list_id !== listId) return null;
        if (job.state === 'running' && Date.now() - job.started_at > RUNNING_STALE_MS && !this.inflight.has(id)) {
            job.state = 'error';
            job.stage = null;
            job.error = { code: 'timeout', message: 'La IA tardó demasiado. Vuelve a intentarlo.' };
            await this.write(tenantId, userId, job);
        }
        return { id: job.id, state: job.state, stage: job.stage, result: job.result, error: job.error };
    }

    // ── El pedido ───────────────────────────────────────────────────────────

    private async run(
        ctx: AiToolContext,
        list: { id: number; slug: string; name: string },
        input: AutomationAiDraftRequest,
        access: ResolvedAiAccess,
        job: StoredJob,
    ): Promise<void> {
        const mode: AutomationAiDraftMode = input.current ? 'change' : 'create';
        let inputTokens = 0;
        let outputTokens = 0;
        try {
            const timeZone = this.timeZones ? await this.timeZones.get(ctx.tenantId).catch(() => null) : null;
            const schema = await this.schemaFor(ctx, list, input.current?.id);
            // La automatización actual, con las credenciales tapadas y los
            // correos diseñados en formato sencillo (lo mismo que lee el MCP).
            const current = input.current
                ? {
                      name: input.current.name,
                      description: input.current.description ?? null,
                      trigger_type: input.current.trigger_type,
                      trigger_config: redactAutomationSecrets(input.current.trigger_config),
                      actions: emailActionsForModel(redactAutomationSecrets(input.current.actions)),
                      is_active: input.current.is_active ?? true,
                  }
                : undefined;
            const base = this.registry.get('propose_create_automation')?.description ?? '';
            const tool = {
                name: AUTOMATION_DRAFT_TOOL_NAME,
                description: automationDraftToolDescription(base),
                input_schema: toInputSchema(automationDraftToolSchema),
            };
            const system = buildDraftSystemPrompt({ today: zonedToday(timeZone ?? FALLBACK_TIME_ZONE), timeZone, mode });
            const client = this.clientFactory(access.apiKey);
            const messages: MessageParam[] = [{ role: 'user', content: buildDraftUserContent({ schema, current, description: input.description }) }];

            for (let attempt = 0; attempt < AUTOMATION_DRAFT_MAX_ATTEMPTS; attempt++) {
                await this.stage(ctx, job, attempt === 0 ? 'thinking' : 'fixing');
                const stream = client.messages.stream({
                    model: access.model,
                    max_tokens: Math.min(assistantMaxTokens(access.effort), AUTOMATION_DRAFT_MAX_TOKENS),
                    system: [{ type: 'text', text: system }],
                    tools: [tool] as never,
                    messages,
                    ...assistantModelParams(access.caps, access.effort),
                });
                const final: Message = await stream.finalMessage();
                inputTokens += final.usage.input_tokens + (final.usage.cache_creation_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0);
                outputTokens += final.usage.output_tokens;
                if (final.stop_reason === 'refusal') throw new DraftFailure('refused', 'La IA no quiso armar esta automatización. Prueba describiéndola de otra forma.');

                const toolUse = final.content.find(
                    (b): b is Extract<(typeof final.content)[number], { type: 'tool_use' }> => b.type === 'tool_use' && b.name === AUTOMATION_DRAFT_TOOL_NAME,
                );
                const raw: unknown = toolUse ? toolUse.input : jsonFromText(final.content);
                let problem: string;
                if (raw === undefined) {
                    problem =
                        final.stop_reason === 'max_tokens'
                            ? 'La automatización salió demasiado larga y se cortó: hazla más corta (menos pasos, correos más breves).'
                            : `No llamaste a ${AUTOMATION_DRAFT_TOOL_NAME}.`;
                } else {
                    await this.stage(ctx, job, 'checking');
                    try {
                        job.result = await this.validate(ctx, list, raw, input, mode, access);
                        job.state = 'done';
                        job.stage = null;
                        await this.write(ctx.tenantId, ctx.userId, job);
                        return;
                    } catch (err) {
                        problem = problemOf(err);
                    }
                }
                if (attempt === AUTOMATION_DRAFT_MAX_ATTEMPTS - 1) {
                    this.logger.warn(`«Describir con IA» no validó tras ${AUTOMATION_DRAFT_MAX_ATTEMPTS} intentos: ${problem.slice(0, 300)}`);
                    throw new DraftFailure(
                        'invalid_automation',
                        'La IA no logró armar una automatización que funcione con esta lista. Prueba contándolo con otras palabras o arma los pasos a mano.',
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
                                content: `Problemas:\n${problem}\n\nCorrígelos y vuelve a llamar a ${AUTOMATION_DRAFT_TOOL_NAME} con la automatización COMPLETA.`,
                            },
                        ],
                    });
                } else {
                    messages.push({ role: 'user', content: `${problem} Llama a ${AUTOMATION_DRAFT_TOOL_NAME} con la automatización completa.` });
                }
            }
        } catch (err) {
            job.state = 'error';
            job.stage = null;
            job.error =
                err instanceof DraftFailure
                    ? { code: err.code, message: err.message }
                    : { code: 'provider_error', message: providerMessage(err) };
            if (!(err instanceof DraftFailure)) this.logger.warn(`Error del proveedor en «Describir con IA»: ${err instanceof Error ? err.message : String(err)}`);
            await this.write(ctx.tenantId, ctx.userId, job);
        } finally {
            await this.redis.del(runningKey(ctx.tenantId, ctx.userId, list.id)).catch(() => undefined);
            // UN pedido de la cuota con los tokens reales de los intentos; si el
            // modelo nunca contestó (0 tokens), el pedido reservado se devuelve.
            if (access.source === 'platform') await this.quota.settle(ctx.tenantId, { input: inputTokens, output: outputTokens });
        }
    }

    /** Lo que entregó el modelo → la automatización del editor, o un error corregible. */
    async validate(
        ctx: AiToolContext,
        list: { id: number; slug: string },
        raw: unknown,
        input: AutomationAiDraftRequest,
        mode: AutomationAiDraftMode,
        access: Pick<ResolvedAiAccess, 'modelName'>,
    ): Promise<AutomationAiDraftResult> {
        const parsed = automationDraftToolSchema.safeParse(raw);
        if (!parsed.success) {
            throw new AiToolError(parsed.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join(' · '));
        }
        const { warnings: modelWarnings, ...spec } = parsed.data;
        const missing: string[] = [];
        // El MISMO constructor que `propose_create_automation` (slugs → ids y validación).
        const built = await this.structure.buildAutomationDraft(ctx, { ...(spec as AutomationSpec), list: list.slug }, { missing });
        let automation: AutomationAiDraftAutomation = {
            name: built.automation.name,
            description: built.automation.description ?? null,
            trigger_type: built.automation.trigger_type,
            trigger_config: (built.automation.trigger_config ?? {}) as Record<string, unknown>,
            actions: built.automation.actions as unknown as Array<Record<string, unknown>>,
            // En un cambio, el estado queda como estaba salvo que lo pidiera.
            is_active: spec.is_active ?? (mode === 'change' ? (input.current?.is_active ?? true) : true),
        };
        const warnings: string[] = [];
        // Las credenciales de la actual vuelven a su paso (las nuevas no se inventan).
        if (input.current) {
            const restored = restoreRedactedSecrets(
                { actions: automation.actions, trigger_config: automation.trigger_config },
                { actions: input.current.actions, triggerConfig: input.current.trigger_config },
            );
            automation = {
                ...automation,
                actions: restored.actions as Array<Record<string, unknown>>,
                trigger_config: restored.trigger_config as Record<string, unknown>,
            };
        }
        if (hasRedactedSecrets(automation)) {
            automation = stripMarkers(automation);
            warnings.push('Un paso quedó con una credencial oculta (una clave o un token): vuelve a escribirla antes de guardar.');
        }
        const issues = issueWarnings(automationConfigIssues(automation));
        const blocking = issues.length > 0 || missing.length > 0;
        if (blocking && automation.is_active) {
            automation = { ...automation, is_active: false };
            warnings.push('La dejé pausada: actívala cuando completes lo que falta.');
        }
        return {
            mode,
            automation,
            summary: built.summary,
            warnings: mergeWarnings(modelWarnings ?? [], missing, issues, warnings),
            model_name: access.modelName ?? null,
        };
    }

    /**
     * El esquema de la lista con las MISMAS reglas que lee el asistente
     * (`get_list_schema`: lo que la persona puede ver, sin credenciales), más
     * el mapa id → slug de los campos y el resto de las listas por nombre.
     */
    private async schemaFor(ctx: AiToolContext, list: { id: number; slug: string }, skipAutomationId?: number): Promise<Record<string, unknown>> {
        const res = await this.registry.execute(ctx, 'get_list_schema', { list: list.slug });
        if (res.isError) throw new DraftFailure('schema_error', 'No se pudo leer la lista. Vuelve a intentarlo.');
        const schema = (res.content ?? {}) as Record<string, unknown>;
        const fieldRows = await this.fields.listByListId(ctx.tenantId, list.id);
        const all = await this.lists.list(ctx.tenantId);
        return slimSchemaForDraft(schema, {
            fieldIds: Object.fromEntries(fieldRows.map((f) => [String(f.id), f.slug])),
            otherLists: all.filter((l) => l.id !== list.id).slice(0, 200).map((l) => ({ slug: l.slug, name: l.name })),
            skipAutomationId,
        });
    }

    private async stage(ctx: AiToolContext, job: StoredJob, stage: AutomationAiDraftStage): Promise<void> {
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

class DraftFailure extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

function jobKey(tenantId: number, userId: number, id: string): string {
    return `aidraft:${tenantId}:${userId}:${id}`;
}
function runningKey(tenantId: number, userId: number, listId: number): string {
    return `aidraft:run:${tenantId}:${userId}:${listId}`;
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

/** Una marca de credencial que no tiene de dónde volver: se vacía (nunca se guarda «[oculto]»). */
function stripMarkers<T>(value: T): T {
    if (typeof value === 'string') return (value === AUTOMATION_SECRET_MARKER ? '' : value.split(AUTOMATION_SECRET_MARKER).join('')) as T;
    if (Array.isArray(value)) return value.map((v) => stripMarkers(v)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripMarkers(v)])) as T;
    }
    return value;
}

function providerMessage(err: unknown): string {
    const e = err as { status?: number };
    if (e.status === 401) return 'El proveedor de IA rechazó la clave. Revísala en Ajustes → Asistente IA.';
    if (e.status === 429) return 'El proveedor de IA está limitando los pedidos. Intenta de nuevo en un rato.';
    if (e.status === 529 || e.status === 503) return 'El proveedor de IA está saturado. Intenta de nuevo en un rato.';
    return 'No se pudo hablar con la IA. Intenta de nuevo en un momento.';
}

function toInputSchema(schema: ZodTypeAny): Record<string, unknown> {
    const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, o: Record<string, unknown>) => Record<string, unknown>;
    const json = convert(schema, { $refStrategy: 'none', target: 'jsonSchema7' });
    delete json.$schema;
    return json;
}
