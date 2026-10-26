import { BadRequestException, Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { ContentBlockParam, Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
    AI_AGENT_TOOL_META,
    agentClip,
    agentDayStart,
    agentMonthStart,
    agentToolsOffered,
    readAiAgentSettings,
    zonedToday,
    FALLBACK_TIME_ZONE,
    type AiAgentMode,
    type AiAgentRunStatus,
    type AiAgentRunStep,
    type AiAgentTool,
    type TestAiAgentInput,
} from '@imagina-base/shared';
import { Queue, Worker } from 'bullmq';
import { and, eq, gte, ne, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { ActivityService } from '../activity/activity.service';
import { AI_CLIENT_FACTORY, defaultClientFactory, type AiClientFactory } from '../ai/assistant.service';
import { AiQuotaExceededError, AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService, AiUnavailableError } from '../ai/ai-settings.service';
import { assistantMaxTokens, assistantModelParams } from '../ai/model-params';
import { ApprovalsService } from '../approvals/approvals.service';
import { AUTOMATION_TRIGGERS } from '../automations/automations-catalog.controller';
import { CommentsService } from '../comments/comments.service';
import { ENV, type Env } from '../config/env';
import { aiAgentRuns, type AiAgentRunRow } from '../db/schema';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { effectivePermissions } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService } from '../records/records.service';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { tenantIsReadOnly } from '../tenancy/read-only';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AgentHub, type AgentHandler, type AgentPreview, type AskAgentRequest, type AskAgentResult } from './agent-hub';
import { AgentProposalsService } from './agent-proposals.service';
import { buildAgentSystemPrompt, buildAgentUserMessage, fieldsForModel, summarizeToolInput } from './agent-prompt';
import { AgentToolbox, agentToolDefinitions, describeError, type AgentRunScope } from './agent-toolbox';
import { AiAgentsService, type OwnerActor } from './ai-agents.service';

export const AGENTS_QUEUE = 'ai-agents';

/**
 * Etiqueta del disparador para el historial («Cuando se crea un registro»),
 * leída del MISMO catálogo que el editor de automatizaciones: un disparador
 * nuevo se nombra solo, sin tocar este módulo.
 */
function triggerTypeLabel(triggerType: string): string {
    return AUTOMATION_TRIGGERS.find((t) => t.slug === triggerType)?.label ?? (triggerType || 'un disparador');
}

interface RunOutcome {
    status: AiAgentRunStatus;
    steps: AiAgentRunStep[];
    summary: string;
    error: string | null;
    inputTokens: number;
    outputTokens: number;
    /** Escribió o propuso algo (la ficha se refresca). */
    touched: boolean;
}

/**
 * E6 — El motor de los agentes de IA (ADR-S67). Atiende la acción «Pedirle a
 * un agente» de las automatizaciones (por el `AgentHub`) y el «Probar» del
 * editor: cada pedido es una CORRIDA en `ai_agent_runs` que corre en su
 * propia cola (BullMQ), así un modelo lento no frena a las automatizaciones.
 *
 * Una corrida, en orden: el agente sigue activo y trabaja en esa lista; su
 * dueño sigue en la empresa y ve la lista (si no, el agente se PAUSA y se abre
 * un problema); la empresa no está en solo-lectura; no se pasó del tope de
 * corridas del día ni del presupuesto de tokens del mes (si sí, no arranca y
 * se avisa una vez); hay IA disponible (si no, falla con el motivo y abre un
 * problema). Después, el bucle modelo ↔ herramientas con tope de pasos.
 */
@Injectable()
export class AgentRunnerService implements AgentHandler, OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(AgentRunnerService.name);
    private readonly clientFactory: AiClientFactory;
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly agents: AiAgentsService,
        private readonly proposals: AgentProposalsService,
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly comments: CommentsService,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        @Inject(ENV) private readonly env: Env,
        @Optional() private readonly hub?: AgentHub,
        @Optional() @Inject(AI_CLIENT_FACTORY) clientFactory?: AiClientFactory,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly approvals?: ApprovalsService,
        @Optional() private readonly mail?: MailService,
    ) {
        this.clientFactory = clientFactory ?? defaultClientFactory;
    }

    async onModuleInit(): Promise<void> {
        this.hub?.setHandler(this);
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = (): IORedis => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, AGENTS_QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(AGENTS_QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de agentes con error: ${err.message}`));
            this.worker = new Worker(
                AGENTS_QUEUE,
                async (job) => {
                    const d = job.data as { tenantId: number; runId: number };
                    await this.execute(d.tenantId, d.runId);
                },
                { connection: conn(), concurrency: 3 },
            );
            this.worker.on('error', (err) => this.logger.warn(`Worker de agentes con error: ${err.message}`));
        } catch (err) {
            this.logger.warn(`Agentes de IA en segundo plano deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }

    // ── Pedidos ──────────────────────────────────────────────────────────

    /** La acción «Pedirle a un agente» de una automatización. */
    async ask(req: AskAgentRequest): Promise<AskAgentResult> {
        const loaded = await this.agents.load(req.tenantId, req.agentId);
        if (!loaded) return { status: 'failed', message: 'El agente de IA ya no existe.', agentName: null, runId: null };
        const name = loaded.row.name;
        if (!loaded.row.isActive) {
            return { status: 'skipped', message: `El agente «${name}» está en pausa: no se le pidió nada.`, agentName: name, runId: null };
        }
        if (!loaded.lists.some((l) => l.id === req.listId)) {
            return { status: 'failed', message: `El agente «${name}» no trabaja en esta lista: agrégala a sus listas.`, agentName: name, runId: null };
        }
        const label = triggerLabel(req.automation?.name ?? null, req.triggerType);
        const runId = await this.createRun({
            tenantId: req.tenantId,
            agentId: req.agentId,
            listId: req.listId,
            recordId: req.recordId,
            automation: req.automation,
            triggerLabel: label,
            instruction: req.instruction,
            mode: loaded.row.mode as AiAgentMode,
            simulated: false,
            createdBy: null,
            chain: req.chain,
        });
        await this.dispatch(req.tenantId, runId);
        return { status: 'queued', message: `Le pidió al agente «${name}» que trabaje (corrida #${runId}).`, agentName: name, runId };
    }

    async preview(tenantId: number, agentId: number, listId: number): Promise<AgentPreview | null> {
        const loaded = await this.agents.load(tenantId, agentId);
        if (!loaded) return null;
        return { name: loaded.row.name, active: loaded.row.isActive, inScope: loaded.lists.some((l) => l.id === listId), mode: loaded.row.mode as AiAgentMode };
    }

    /**
     * «Probar»: corre el agente sobre un registro real en modo SIMULACIÓN (no
     * escribe ni deja propuesta). Quien prueba tiene que poder ver ese registro:
     * los pasos muestran sus datos.
     */
    async test(tenantId: number, viewer: OwnerActor | { userId: number; role: string }, agentId: number, input: TestAiAgentInput): Promise<{ run_id: number }> {
        const loaded = await this.agents.load(tenantId, agentId);
        if (!loaded) throw new BadRequestException({ code: 'agent_not_found', message: 'El agente no existe.', data: { status: 400 } });
        if (!loaded.lists.some((l) => l.id === input.list_id)) {
            throw new BadRequestException({ code: 'agent_list_out_of_scope', message: 'El agente no trabaja en esa lista.', data: { status: 400 } });
        }
        let recordId = input.record_id ?? null;
        if (recordId === null) {
            const page = await this.records.list(tenantId, viewer as never, String(input.list_id), { limit: 1, sort_dir: 'desc' } as never);
            recordId = page.data[0]?.id ?? null;
            if (recordId === null) throw new BadRequestException({ code: 'agent_test_no_record', message: 'La lista no tiene registros para probar.', data: { status: 400 } });
        } else {
            await this.records.get(tenantId, viewer as never, String(input.list_id), recordId);
        }
        const runId = await this.createRun({
            tenantId,
            agentId,
            listId: input.list_id,
            recordId,
            automation: null,
            triggerLabel: 'Probar',
            instruction: input.instruction,
            mode: loaded.row.mode as AiAgentMode,
            simulated: true,
            createdBy: viewer.userId,
        });
        await this.dispatch(tenantId, runId);
        return { run_id: runId };
    }

    private async createRun(p: {
        tenantId: number;
        agentId: number;
        listId: number;
        recordId: number | null;
        automation: { id: number; name: string } | null;
        triggerLabel: string;
        instruction: string;
        mode: AiAgentMode;
        simulated: boolean;
        createdBy: number | null;
        chain?: AskAgentRequest['chain'];
    }): Promise<number> {
        const [row] = await this.tenantDb.withTenant(p.tenantId, (tx) =>
            tx
                .insert(aiAgentRuns)
                .values({
                    tenantId: p.tenantId,
                    agentId: p.agentId,
                    listId: p.listId,
                    recordId: p.recordId,
                    automationId: p.automation?.id ?? null,
                    automationName: p.automation?.name ?? null,
                    triggerLabel: p.triggerLabel.slice(0, 240),
                    status: 'queued',
                    simulated: p.simulated,
                    mode: p.mode,
                    instruction: p.instruction,
                    context: p.chain ? { chain: p.chain } : {},
                    createdBy: p.createdBy,
                })
                .returning({ id: aiAgentRuns.id }),
        );
        return row!.id;
    }

    /** A la cola; sin cola (tests, sin Redis) corre en el acto. */
    private async dispatch(tenantId: number, runId: number): Promise<void> {
        if (this.queue) {
            try {
                await this.queue.add('run', { tenantId, runId }, { jobId: `agent-run-${tenantId}-${runId}` });
                return;
            } catch (err) {
                this.logger.warn(`No se pudo encolar la corrida ${runId}: ${String(err)}; corre en el acto.`);
            }
        }
        await this.execute(tenantId, runId);
    }

    // ── Ejecutar ─────────────────────────────────────────────────────────

    /** Corre una corrida en cola. Nunca lanza: todo termina en el historial. */
    async execute(tenantId: number, runId: number): Promise<void> {
        const [run] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(aiAgentRuns)
                .set({ status: 'running', startedAt: new Date() })
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.id, runId), eq(aiAgentRuns.status, 'queued')))
                .returning(),
        );
        if (!run) return;
        let out: RunOutcome;
        try {
            out = await this.work(tenantId, run);
        } catch (err) {
            this.logger.error(`Corrida ${runId} del agente ${run.agentId}: ${String(err)}`);
            out = { status: 'failed', steps: [], summary: '', error: errorText(err, 1000), inputTokens: 0, outputTokens: 0, touched: false };
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(aiAgentRuns)
                .set({
                    status: out.status,
                    steps: out.steps,
                    summary: agentClip(out.summary, 4000),
                    error: out.error,
                    inputTokens: out.inputTokens,
                    outputTokens: out.outputTokens,
                    finishedAt: new Date(),
                })
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.id, runId))),
        );
        if (out.touched && run.listId !== null) this.realtime.records(tenantId, run.listId);
    }

    private async work(tenantId: number, run: AiAgentRunRow): Promise<RunOutcome> {
        const done = (status: AiAgentRunStatus, error: string | null, extra: Partial<RunOutcome> = {}): RunOutcome => ({
            status,
            steps: [],
            summary: '',
            error,
            inputTokens: 0,
            outputTokens: 0,
            touched: false,
            ...extra,
        });
        const loaded = await this.agents.load(tenantId, run.agentId);
        if (!loaded) return done('failed', 'El agente ya no existe.');
        const agent = loaded.row;
        const incidentKey = `ai_agent:${agent.id}`;
        if (!run.simulated && !agent.isActive) return done('skipped', 'El agente está en pausa.');
        if (run.listId === null || !loaded.lists.some((l) => l.id === run.listId)) return done('failed', 'El agente no trabaja en esta lista.');
        if (!run.simulated && (await this.tenantDb.withTenant(tenantId, (tx) => tenantIsReadOnly(tx, tenantId)))) {
            return done('skipped', 'La empresa está en solo-lectura (pago pendiente): el agente no trabajó.');
        }

        // El dueño: su acceso VIGENTE.
        const owner = await this.agents.ownerActor(tenantId, agent.ownerId);
        if (!owner) {
            const reason = 'La persona con cuyo acceso trabaja el agente ya no es del equipo (se fue, su cuenta está desactivada o ahora es invitada o cliente).';
            if (!run.simulated) await this.agents.pauseForOwner(tenantId, agent.id, agent.name, reason, run.listId);
            return done('failed', `${reason} El agente se pausó.`);
        }
        const visible: number[] = [];
        let runList: Awaited<ReturnType<ListsService['get']>> | null = null;
        for (const l of loaded.lists) {
            try {
                const list = await this.lists.get(tenantId, String(l.id));
                if (effectivePermissions(list.settings, owner).view !== 'none') visible.push(l.id);
                if (l.id === run.listId) runList = list;
            } catch {
                // lista borrada: fuera
            }
        }
        if (visible.length === 0) {
            const reason = `${owner.name} (con cuyo acceso trabaja el agente) ya no puede ver ninguna de sus listas.`;
            if (!run.simulated) await this.agents.pauseForOwner(tenantId, agent.id, agent.name, reason, run.listId);
            return done('failed', `${reason} El agente se pausó.`);
        }
        if (!visible.includes(run.listId)) {
            const reason = `${owner.name} (con cuyo acceso trabaja el agente) ya no puede ver la lista «${runList?.name ?? run.listId}».`;
            this.reportIncident(tenantId, incidentKey, agent.id, agent.name, run.listId, reason);
            return done('failed', reason);
        }

        // Topes: corridas del día y presupuesto de tokens del mes.
        const tz = this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
        const now = new Date();
        const usage = await this.usage(tenantId, agent.id, run.id, agentDayStart(now, tz), agentMonthStart(now));
        if (!run.simulated && usage.runsToday >= agent.maxRunsPerDay) {
            const msg = `Se alcanzó el tope de ${agent.maxRunsPerDay} corridas por día del agente: no trabajó. Sube el tope en el agente si hace falta.`;
            this.reportIncident(tenantId, `${incidentKey}:limit`, agent.id, agent.name, run.listId, msg, `El agente «${agent.name}» llegó a su tope`);
            return done('skipped', msg);
        }
        const budget = agent.monthlyTokenBudget === null ? null : Number(agent.monthlyTokenBudget);
        if (budget !== null && usage.tokensMonth >= budget) {
            const msg = `Se alcanzó el presupuesto de ${budget.toLocaleString('es')} tokens del mes del agente: no trabajó.`;
            this.reportIncident(tenantId, `${incidentKey}:limit`, agent.id, agent.name, run.listId, msg, `El agente «${agent.name}» llegó a su tope`);
            return done('skipped', msg);
        }

        // IA disponible (clave, cuota del plan, modelo).
        let access;
        try {
            access = await this.settings.resolve(tenantId);
            if (access.source === 'platform') await this.quota.assertWithinQuota(tenantId);
        } catch (err) {
            const msg = err instanceof AiUnavailableError || err instanceof AiQuotaExceededError ? err.message : errorText(err);
            this.reportIncident(tenantId, incidentKey, agent.id, agent.name, run.listId, `Sin IA disponible: ${msg}`);
            return done('failed', `Sin IA disponible: ${msg}`);
        }

        // Herramientas: las del agente que su dueño puede usar.
        const tools = agentToolsOffered((agent.tools ?? []) as string[], (t) => AiAgentsService.ownerCanUse(owner, t));
        const settings = readAiAgentSettings(agent.settings);
        const chain = (run.context as { chain?: AgentRunScope['chain'] } | null)?.chain;
        const scope: AgentRunScope = {
            tenantId,
            agent: { id: agent.id, name: agent.name, tools, clientComments: settings.client_comments },
            owner: { ...owner, agentId: agent.id },
            listIds: new Set(visible),
            listId: run.listId,
            recordId: run.recordId,
            mode: agent.mode as AiAgentMode,
            simulate: run.simulated,
            ...(chain ? { chain } : {}),
        };
        const toolbox = new AgentToolbox(
            { tenantDb: this.tenantDb, lists: this.lists, records: this.records, comments: this.comments, activity: this.activity, approvals: this.approvals ?? null, mail: this.mail ?? null },
            scope,
        );
        let initial;
        try {
            initial = await toolbox.initialRecord();
        } catch (err) {
            return done('failed', `El registro ya no existe o ${owner.name} no lo puede ver: ${describeError(err)}`);
        }
        const assign = tools.includes('assign') ? await toolbox.peopleAndTeams() : null;
        const system = buildAgentSystemPrompt({
            agentName: agent.name,
            instructions: agent.instructions,
            mode: agent.mode as AiAgentMode,
            simulate: run.simulated,
            tools,
            maxSteps: agent.maxSteps,
            listNames: loaded.lists.filter((l) => visible.includes(l.id)).map((l) => l.name),
            clientComments: settings.client_comments,
            today: zonedToday(tz, now),
            timeZone: tz,
        });
        const userMessage = buildAgentUserMessage({
            triggerLabel: run.triggerLabel || 'un pedido',
            instruction: run.instruction,
            list: { name: initial.ctx.list.name, slug: initial.ctx.list.slug },
            fields: fieldsForModel(initial.ctx.visible.filter((f) => f.type !== 'button')),
            record: initial.record,
            ...(assign ? { people: assign.people, teams: assign.teams } : {}),
        });

        // El bucle.
        const client = this.clientFactory(access.apiKey);
        const definitions = agentToolDefinitions(tools);
        const messages: MessageParam[] = [{ role: 'user', content: userMessage }];
        const steps: AiAgentRunStep[] = [];
        let inputTokens = 0;
        let outputTokens = 0;
        let summary = '';
        let status: AiAgentRunStatus = 'success';
        let error: string | null = null;
        let n = 0;
        const budgetLeft = budget === null ? Number.POSITIVE_INFINITY : budget - usage.tokensMonth;
        try {
            // Un PASO es una vuelta con herramientas; la vuelta de más es para
            // que el modelo cierre con su resumen.
            for (let i = 0; i <= agent.maxSteps; i++) {
                const stream = client.messages.stream({
                    model: access.model,
                    max_tokens: assistantMaxTokens(access.effort),
                    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
                    ...(definitions.length > 0
                        ? { tools: definitions.map((t, k) => (k === definitions.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t)) as never }
                        : {}),
                    messages,
                    ...assistantModelParams(access.caps, access.effort),
                } as never);
                const final: Message = await stream.finalMessage();
                inputTokens += final.usage.input_tokens + (final.usage.cache_creation_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0);
                outputTokens += final.usage.output_tokens;
                messages.push({ role: 'assistant', content: final.content as ContentBlockParam[] });
                const text = final.content
                    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n')
                    .trim();
                if (text) summary = text;
                const toolUses = final.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
                if (final.stop_reason !== 'tool_use' || toolUses.length === 0) {
                    if (final.stop_reason === 'max_tokens') {
                        status = 'stopped';
                        error = 'La respuesta del modelo salió demasiado larga y se cortó.';
                    } else if (final.stop_reason === 'refusal') {
                        status = 'failed';
                        error = 'El modelo declinó hacer esta tarea.';
                    }
                    break;
                }
                if (inputTokens + outputTokens >= budgetLeft) {
                    status = 'stopped';
                    error = 'Se alcanzó el presupuesto mensual de tokens del agente: la corrida se cortó.';
                    for (const tu of toolUses) steps.push(notRun(++n, tu.name, tu.input, 'No se hizo: se alcanzó el presupuesto de tokens.'));
                    this.reportIncident(tenantId, `${incidentKey}:limit`, agent.id, agent.name, run.listId, error, `El agente «${agent.name}» llegó a su tope`);
                    break;
                }
                if (i === agent.maxSteps) {
                    status = 'stopped';
                    error = `Se alcanzó el tope de ${agent.maxSteps} pasos: el agente no terminó.`;
                    for (const tu of toolUses) steps.push(notRun(++n, tu.name, tu.input, 'No se hizo: se alcanzó el tope de pasos.'));
                    break;
                }
                const results: ContentBlockParam[] = [];
                for (const tu of toolUses) {
                    const res = await toolbox.run(tu.name, tu.input);
                    n += 1;
                    steps.push({
                        n,
                        tool: tu.name,
                        label: (AI_AGENT_TOOL_META as Record<string, { label: string } | undefined>)[tu.name]?.label ?? tu.name,
                        input: summarizeToolInput(tu.input),
                        ok: !res.isError,
                        kind: res.kind,
                        result: agentClip(res.summary, 400),
                    });
                    results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(res.content), ...(res.isError ? { is_error: true } : {}) });
                }
                messages.push({ role: 'user', content: results });
            }
        } catch (err) {
            status = 'failed';
            error = providerError(err);
            this.reportIncident(tenantId, incidentKey, agent.id, agent.name, run.listId, error);
        } finally {
            if (access.source === 'platform' && (inputTokens > 0 || outputTokens > 0)) {
                await this.quota.record(tenantId, { input: inputTokens, output: outputTokens }).catch((e) => this.logger.warn(`No se pudo registrar el uso IA: ${String(e)}`));
            }
        }

        // La propuesta (modo «propone»), si juntó cambios.
        let touched = toolbox.applied.length > 0;
        if (!run.simulated && toolbox.changes.length > 0 && run.recordId !== null) {
            await this.proposals.create({
                tenantId,
                agent: { id: agent.id, name: agent.name, ownerId: agent.ownerId, settings: agent.settings },
                runId: run.id,
                listId: run.listId,
                recordId: run.recordId,
                summary,
                changes: toolbox.changes,
            });
            touched = true;
        }
        if (status === 'success' && !run.simulated) {
            this.incidents?.resolve(tenantId, incidentKey);
            this.incidents?.resolve(tenantId, `${incidentKey}:limit`);
        }
        return { status, steps, summary, error, inputTokens, outputTokens, touched };
    }

    /** Corridas de hoy (sin contar las pruebas ni las que no arrancaron) y tokens del mes. */
    private async usage(tenantId: number, agentId: number, runId: number, dayStart: Date, monthStart: Date): Promise<{ runsToday: number; tokensMonth: number }> {
        const from = monthStart < dayStart ? monthStart : dayStart;
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    runsToday: sql<number>`count(*) filter (where ${aiAgentRuns.createdAt} >= ${dayStart.toISOString()}::timestamptz and not ${aiAgentRuns.simulated} and ${aiAgentRuns.status} not in ('skipped', 'queued'))`,
                    tokensMonth: sql<string>`coalesce(sum(${aiAgentRuns.inputTokens} + ${aiAgentRuns.outputTokens}) filter (where ${aiAgentRuns.createdAt} >= ${monthStart.toISOString()}::timestamptz), 0)`,
                })
                .from(aiAgentRuns)
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.agentId, agentId), ne(aiAgentRuns.id, runId), gte(aiAgentRuns.createdAt, from))),
        );
        return { runsToday: Number(row?.runsToday ?? 0), tokensMonth: Number(row?.tokensMonth ?? 0) };
    }

    private reportIncident(tenantId: number, key: string, agentId: number, name: string, listId: number | null, message: string, title?: string): void {
        this.incidents?.report({
            tenantId,
            key,
            source: 'ai_agent',
            sourceId: agentId,
            listId,
            title: title ?? `El agente «${name}» no pudo trabajar`,
            message,
        });
    }
}

function triggerLabel(automationName: string | null, triggerType: string): string {
    const what = triggerTypeLabel(triggerType);
    // Las que arma el propio agente («Cuándo trabaja») ya dicen su disparador.
    return automationName && !automationName.startsWith('Agente «') ? `Automatización «${automationName}» · ${what}` : what;
}

function notRun(n: number, tool: string, input: unknown, why: string): AiAgentRunStep {
    return {
        n,
        tool,
        label: (AI_AGENT_TOOL_META as Record<string, { label: string } | undefined>)[tool]?.label ?? tool,
        input: summarizeToolInput(input),
        ok: false,
        kind: 'blocked',
        result: why,
    };
}

/** El error del proveedor, en lenguaje claro. */
function providerError(err: unknown): string {
    const e = err as { status?: number; message?: string };
    if (e.status === 401) return 'El proveedor de IA rechazó la clave. Revísala en Ajustes → Asistente IA.';
    if (e.status === 429) return 'El proveedor de IA está limitando los pedidos. Se puede reintentar en un rato.';
    if (e.status === 529 || e.status === 503) return 'El proveedor de IA está saturado. Se puede reintentar en un rato.';
    if (typeof e.status === 'number' && e.status >= 400) return `La IA no respondió (${e.status}): ${agentClip(e.message ?? '', 300)}`;
    return `La IA no respondió: ${errorText(err, 400)}`;
}

export type { AiAgentTool };
