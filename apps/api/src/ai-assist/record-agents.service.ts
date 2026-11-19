import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
    AI_AGENT_BATCH_MAX,
    AI_AGENT_BATCH_PARALLEL,
    agentDayStart,
    agentMonthStart,
    type AgentBatchDto,
    type AgentBatchPreview,
    type AgentBatchPreviewInput,
    type AgentBatchStartInput,
    type AgentBatchStatus,
    type AiAgentMode,
    type AiAgentRunStatus,
    type AiAgentRunStep,
    type AskRecordAgentInput,
    type RecordAgentOption,
    type RecordAgentRunDto,
} from '@imagina-base/shared';
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService, AiUnavailableError } from '../ai/ai-settings.service';
import { AgentRunnerService } from '../ai-agents/agent-runner.service';
import { AiAgentsService } from '../ai-agents/ai-agents.service';
import { AuditService } from '../audit/audit.service';
import { can } from '../authz/can';
import { type Tx } from '../db/client';
import { aiAgentBatches, aiAgentLists, aiAgentProposals, aiAgentRuns, aiAgents, type AiAgentBatchRow } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { RecordsService } from '../records/records.service';
import { memberNames } from '../tenancy/member-names';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { assertMayUseAi, type AiAssistActor } from './record-ai.service';

/** Etiqueta de las corridas en el historial del agente. */
const FROM_RECORD_LABEL = 'Pedido desde la ficha';
const BATCH_LABEL = 'En lote';
/** Corridas recientes del registro que se muestran en la ficha. */
const RECENT_RUNS = 3;
const RECENT_HOURS = 24;
const BATCH_ERRORS = 20;

export interface AgentLimits {
    agent: { id: number; name: string; mode: AiAgentMode; isActive: boolean; maxRunsPerDay: number; monthlyTokenBudget: number | null; listIds: number[] };
    runsToday: number;
    tokensMonth: number;
    /** Corridas de este agente que esperan o corren ahora. */
    inflight: number;
    /** `null` = sin tope (clave propia o plan ilimitado). */
    quotaLeft: number | null;
    /** Tokens promedio de sus últimas corridas (null si todavía no corrió). */
    tokensPerRun: number | null;
    /** Por qué no hay IA (null = hay). */
    aiUnavailable: string | null;
}

/**
 * v0.1.456 (ADR-S109) — Pedirle a un agente de IA que trabaje sobre un
 * registro desde la ficha, y correrlo en LOTE sobre registros que ya existen.
 *
 * Quién puede: la persona tiene que poder usar la IA (`use_ai_assistant`) y
 * EDITAR los registros (el agente cambia cosas: la persona no puede pedir
 * sobre lo que ella misma no podría cambiar); en lote, además, acciones
 * masivas (`bulk_actions`). El agente sigue trabajando con el acceso VIGENTE
 * de su dueño, sus listas y sus herramientas (ADR-S71): pedirlo no le da más
 * acceso a nadie — es lo mismo que una automatización que lo llama cuando
 * alguien edita un registro.
 *
 * El lote crea las corridas por TANDAS (`AI_AGENT_BATCH_PARALLEL` a la vez):
 * cuando una termina se crea la siguiente, mientras queden corridas del día
 * del agente, presupuesto de tokens y cuota del plan. Si algo se acaba, el
 * lote se detiene con el motivo; lo que ya hizo queda hecho.
 */
@Injectable()
export class RecordAgentsService implements OnModuleInit {
    private readonly logger = new Logger(RecordAgentsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly agents: AiAgentsService,
        private readonly runner: AgentRunnerService,
        private readonly settings: AiSettingsService,
        private readonly quota: AiQuotaService,
        private readonly timeZones: TenantTimeZones,
        private readonly audit: AuditService,
    ) {}

    onModuleInit(): void {
        this.runner.onRunFinished(async (tenantId, run) => {
            if (run.batchId !== null) await this.pump(tenantId, run.batchId);
        });
    }

    // ── Desde la ficha ───────────────────────────────────────────────────

    /** Los agentes activos que trabajan en la lista, y las últimas corridas del registro. */
    async forRecord(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number): Promise<{ agents: RecordAgentOption[]; runs: RecordAgentRunDto[]; can_ask: boolean }> {
        assertMayUseAi(actor);
        const record = await this.records.get(tenantId, actor, listKey, recordId);
        const agents = await this.activeAgentsFor(tenantId, record.list_id);
        const canAsk = await this.canEdit(tenantId, actor, String(record.list_id), recordId);
        const since = new Date(Date.now() - RECENT_HOURS * 3600_000);
        const runs = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select()
                .from(aiAgentRuns)
                .where(
                    and(
                        eq(aiAgentRuns.tenantId, tenantId),
                        eq(aiAgentRuns.recordId, recordId),
                        eq(aiAgentRuns.simulated, false),
                        isNotNull(aiAgentRuns.createdBy),
                        gte(aiAgentRuns.createdAt, since),
                    ),
                )
                .orderBy(desc(aiAgentRuns.id))
                .limit(RECENT_RUNS);
            return this.runDtos(tx, tenantId, rows);
        });
        return { agents, runs, can_ask: canAsk && agents.length > 0 };
    }

    async ask(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number, input: AskRecordAgentInput): Promise<RecordAgentRunDto> {
        assertMayUseAi(actor);
        const record = await this.records.get(tenantId, actor, listKey, recordId);
        if (!(await this.canEdit(tenantId, actor, String(record.list_id), recordId))) {
            throw new ForbiddenException({ code: 'agent_ask_forbidden', message: 'Para pedirle algo a un agente tienes que poder editar este registro.', data: { status: 403 } });
        }
        const agent = (await this.activeAgentsFor(tenantId, record.list_id)).find((a) => a.id === input.agent_id);
        if (!agent) {
            throw new BadRequestException({ code: 'agent_not_available', message: 'Ese agente no está activo o no trabaja en esta lista.', data: { status: 400 } });
        }
        // Un mismo pedido dos veces seguidas (doble clic) no crea dos corridas.
        const pending = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(aiAgentRuns)
                .where(
                    and(
                        eq(aiAgentRuns.tenantId, tenantId),
                        eq(aiAgentRuns.agentId, agent.id),
                        eq(aiAgentRuns.recordId, recordId),
                        eq(aiAgentRuns.createdBy, actor.userId),
                        inArray(aiAgentRuns.status, ['queued', 'running']),
                    ),
                )
                .limit(1),
        );
        if (pending[0]) return this.runFor(tenantId, recordId, pending[0].id);
        const who = await this.tenantDb.withTenant(tenantId, (tx) => memberNames(tx, tenantId, [actor.userId]));
        const name = who.get(actor.userId)?.name;
        const runId = await this.runner.enqueueForRecord({
            tenantId,
            agentId: agent.id,
            listId: record.list_id,
            recordId,
            instruction: input.instruction,
            mode: agent.mode,
            createdBy: actor.userId,
            triggerLabel: name ? `${FROM_RECORD_LABEL} por ${name}` : FROM_RECORD_LABEL,
        });
        return this.runFor(tenantId, recordId, runId);
    }

    /** El estado de una corrida del registro (para la ficha, sin recargar). */
    async run(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number, runId: number): Promise<RecordAgentRunDto> {
        assertMayUseAi(actor);
        await this.records.get(tenantId, actor, listKey, recordId);
        return this.runFor(tenantId, recordId, runId);
    }

    private async runFor(tenantId: number, recordId: number, runId: number): Promise<RecordAgentRunDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select()
                .from(aiAgentRuns)
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.id, runId), eq(aiAgentRuns.recordId, recordId)))
                .limit(1);
            if (!rows[0]) throw new NotFoundException({ code: 'agent_run_not_found', message: 'Esa corrida no existe.', data: { status: 404 } });
            return (await this.runDtos(tx, tenantId, rows))[0]!;
        });
    }

    // ── En lote ──────────────────────────────────────────────────────────

    /** Los agentes activos que trabajan en la lista (para correrlos en lote). */
    async listAgents(tenantId: number, actor: AiAssistActor, listKey: string): Promise<RecordAgentOption[]> {
        assertBatchActor(actor);
        const list = await this.lists.get(tenantId, listKey);
        return this.activeAgentsFor(tenantId, list.id);
    }

    async preview(tenantId: number, actor: AiAssistActor, listKey: string, input: AgentBatchPreviewInput): Promise<AgentBatchPreview> {
        const { list, ids, total } = await this.batchTarget(tenantId, actor, listKey, input.target);
        const limits = await this.limits(tenantId, input.agent_id);
        assertAgentInList(limits, list.id);
        return previewOf(limits, total, ids.length);
    }

    async start(tenantId: number, actor: AiAssistActor, listKey: string, input: AgentBatchStartInput): Promise<AgentBatchDto> {
        const { list, ids, total } = await this.batchTarget(tenantId, actor, listKey, input.target);
        const limits = await this.limits(tenantId, input.agent_id);
        assertAgentInList(limits, list.id);
        const preview = previewOf(limits, total, ids.length);
        if (ids.length === 0) throw new BadRequestException({ code: 'agent_batch_empty', message: 'No hay registros que puedas editar en lo elegido.', data: { status: 400 } });
        if (preview.will_run === 0) {
            throw new BadRequestException({ code: 'agent_batch_no_capacity', message: preview.notes[0] ?? 'El agente no puede trabajar ahora.', data: { status: 400 } });
        }
        // Se guardan sólo los que entran hoy (el resto se puede correr otro día).
        const chosen = ids.slice(0, preview.will_run);
        const [batch] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(aiAgentBatches)
                .values({
                    tenantId,
                    agentId: limits.agent.id,
                    listId: list.id,
                    createdBy: actor.userId,
                    instruction: input.instruction,
                    recordIds: chosen,
                    total: chosen.length,
                })
                .returning(),
        );
        void this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'ai_agent.batch',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { agent_id: limits.agent.id, agent_name: limits.agent.name, batch_id: batch!.id, records: chosen.length },
        });
        await this.pump(tenantId, batch!.id);
        return this.batchFor(tenantId, list.id, batch!.id);
    }

    async batch(tenantId: number, actor: AiAssistActor, listKey: string, batchId: number): Promise<AgentBatchDto> {
        assertBatchActor(actor);
        const list = await this.lists.get(tenantId, listKey);
        const dto = await this.batchFor(tenantId, list.id, batchId);
        // Se cura solo: un lote «corriendo» sin nada en cola (un reinicio a
        // mitad) crea la siguiente tanda o se cierra.
        if (dto.status === 'running' && dto.queued + dto.running === 0) {
            await this.pump(tenantId, batchId);
            return this.batchFor(tenantId, list.id, batchId);
        }
        return dto;
    }

    async cancel(tenantId: number, actor: AiAssistActor, listKey: string, batchId: number): Promise<AgentBatchDto> {
        assertBatchActor(actor);
        const list = await this.lists.get(tenantId, listKey);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select()
                .from(aiAgentBatches)
                .where(and(eq(aiAgentBatches.tenantId, tenantId), eq(aiAgentBatches.id, batchId), eq(aiAgentBatches.listId, list.id)))
                .for('update')
                .limit(1);
            if (!row) throw new NotFoundException({ code: 'agent_batch_not_found', message: 'Ese lote no existe.', data: { status: 404 } });
            if (row.status !== 'running') return;
            await tx
                .update(aiAgentBatches)
                .set({ status: 'cancelled', stoppedReason: 'Lo detuvo una persona.', finishedAt: new Date() })
                .where(eq(aiAgentBatches.id, batchId));
            // Lo que todavía no arrancó no corre; lo que ya está corriendo termina.
            await tx
                .update(aiAgentRuns)
                .set({ status: 'skipped', error: 'Se detuvo el lote antes de que arrancara.', finishedAt: new Date() })
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.batchId, batchId), eq(aiAgentRuns.status, 'queued')));
        });
        return this.batchFor(tenantId, list.id, batchId);
    }

    /**
     * Crea la siguiente tanda de corridas del lote (o lo cierra). Con la fila
     * del lote bloqueada: dos corridas que terminan a la vez no crean de más.
     */
    async pump(tenantId: number, batchId: number): Promise<void> {
        const toDispatch: number[] = [];
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [batch] = await tx
                .select()
                .from(aiAgentBatches)
                .where(and(eq(aiAgentBatches.tenantId, tenantId), eq(aiAgentBatches.id, batchId)))
                .for('update')
                .limit(1);
            if (!batch || batch.status !== 'running') return;
            const [inflightRow] = await tx
                .select({ n: sql<number>`count(*)::int` })
                .from(aiAgentRuns)
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.batchId, batchId), inArray(aiAgentRuns.status, ['queued', 'running'])));
            const inflight = Number(inflightRow?.n ?? 0);
            const left = batch.total - batch.dispatched;
            if (left <= 0) {
                if (inflight === 0) await finish(tx, batch.id, 'done', null);
                return;
            }
            // Una corrida que se quedó sin IA detiene al lote (las demás fallarían igual).
            const [noAi] = await tx
                .select({ error: aiAgentRuns.error })
                .from(aiAgentRuns)
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.batchId, batchId), eq(aiAgentRuns.status, 'failed'), sql`${aiAgentRuns.error} LIKE 'Sin IA disponible%'`))
                .limit(1);
            let stop: string | null = noAi?.error ?? null;
            let room = 0;
            if (!stop) {
                const limits = await this.limits(tenantId, batch.agentId, tx);
                stop = stopReason(limits);
                if (!stop) {
                    room = Math.min(
                        AI_AGENT_BATCH_PARALLEL - inflight,
                        left,
                        limits.agent.maxRunsPerDay - limits.runsToday - limits.inflight,
                        limits.quotaLeft === null ? Number.POSITIVE_INFINITY : limits.quotaLeft - limits.inflight,
                    );
                    if (room <= 0 && inflight === 0) {
                        stop =
                            limits.agent.maxRunsPerDay - limits.runsToday <= 0
                                ? `El agente llegó a su tope de ${limits.agent.maxRunsPerDay} corridas por día.`
                                : 'Se agotaron los pedidos a la IA de tu plan este mes.';
                    }
                }
            }
            if (stop) {
                if (inflight === 0) await finish(tx, batch.id, 'stopped', stop);
                else await tx.update(aiAgentBatches).set({ stoppedReason: stop }).where(eq(aiAgentBatches.id, batch.id));
                return;
            }
            if (room <= 0) return;
            const ids = (batch.recordIds as number[]).slice(batch.dispatched, batch.dispatched + room);
            const agent = await this.agents.load(tenantId, batch.agentId, tx);
            if (!agent) {
                await finish(tx, batch.id, 'stopped', 'El agente ya no existe.');
                return;
            }
            for (const recordId of ids) {
                const [run] = await tx
                    .insert(aiAgentRuns)
                    .values({
                        tenantId,
                        agentId: batch.agentId,
                        listId: batch.listId,
                        recordId,
                        triggerLabel: BATCH_LABEL,
                        status: 'queued',
                        mode: agent.row.mode,
                        instruction: batch.instruction,
                        createdBy: batch.createdBy,
                        batchId: batch.id,
                    })
                    .returning({ id: aiAgentRuns.id });
                toDispatch.push(run!.id);
            }
            await tx
                .update(aiAgentBatches)
                .set({ dispatched: batch.dispatched + ids.length })
                .where(eq(aiAgentBatches.id, batch.id));
        });
        for (const runId of toDispatch) {
            try {
                await this.runner.dispatchRun(tenantId, runId);
            } catch (err) {
                this.logger.warn(`No se pudo mandar la corrida ${runId} del lote ${batchId}: ${String(err)}`);
            }
        }
    }

    // ── Internos ─────────────────────────────────────────────────────────

    private async batchTarget(tenantId: number, actor: AiAssistActor, listKey: string, target: AgentBatchPreviewInput['target']) {
        assertBatchActor(actor);
        // Sólo los registros que la persona puede EDITAR (el alcance de su rol).
        const rows = await this.records.bulkRows(tenantId, actor, listKey, target, AI_AGENT_BATCH_MAX, 'edit');
        return { list: rows.list, ids: rows.rows.map((r) => r.id).slice(0, AI_AGENT_BATCH_MAX), total: rows.total };
    }

    private async canEdit(tenantId: number, actor: AiAssistActor, listKey: string, recordId: number): Promise<boolean> {
        try {
            await this.records.checkUpdate(tenantId, actor, listKey, recordId, {});
            return true;
        } catch {
            return false;
        }
    }

    private async activeAgentsFor(tenantId: number, listId: number): Promise<Array<RecordAgentOption & { mode: AiAgentMode }>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: aiAgents.id, name: aiAgents.name, description: aiAgents.description, color: aiAgents.color, icon: aiAgents.icon, mode: aiAgents.mode })
                .from(aiAgents)
                .innerJoin(aiAgentLists, and(eq(aiAgentLists.agentId, aiAgents.id), eq(aiAgentLists.listId, listId)))
                .where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.isActive, true)))
                .orderBy(asc(aiAgents.name)),
        );
        return rows.map((r) => ({ ...r, description: r.description ?? '', mode: r.mode as AiAgentMode }));
    }

    /** Topes del agente y de la cuota, en este momento. */
    private async limits(tenantId: number, agentId: number, outer?: Tx): Promise<AgentLimits> {
        const tz = await this.timeZones.orUtc(tenantId);
        const now = new Date();
        const dayStart = agentDayStart(now, tz);
        const monthStart = agentMonthStart(now);
        const read = async (tx: Tx) => {
            const loaded = await this.agents.load(tenantId, agentId, tx);
            if (!loaded) throw new NotFoundException({ code: 'agent_not_found', message: 'El agente no existe.', data: { status: 404 } });
            const from = monthStart < dayStart ? monthStart : dayStart;
            const [u] = await tx
                .select({
                    runsToday: sql<number>`count(*) filter (where ${aiAgentRuns.createdAt} >= ${dayStart.toISOString()}::timestamptz and not ${aiAgentRuns.simulated} and ${aiAgentRuns.status} not in ('skipped', 'queued', 'running'))`,
                    inflight: sql<number>`count(*) filter (where ${aiAgentRuns.status} in ('queued', 'running') and not ${aiAgentRuns.simulated})`,
                    tokensMonth: sql<string>`coalesce(sum(${aiAgentRuns.inputTokens} + ${aiAgentRuns.outputTokens}) filter (where ${aiAgentRuns.createdAt} >= ${monthStart.toISOString()}::timestamptz), 0)`,
                    avgTokens: sql<string | null>`avg(${aiAgentRuns.inputTokens} + ${aiAgentRuns.outputTokens}) filter (where ${aiAgentRuns.status} in ('success', 'stopped') and ${aiAgentRuns.inputTokens} > 0)`,
                })
                .from(aiAgentRuns)
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.agentId, agentId), gte(aiAgentRuns.createdAt, from)));
            return { loaded, u };
        };
        const { loaded, u } = outer ? await read(outer) : await this.tenantDb.withTenant(tenantId, read);
        let quotaLeft: number | null = null;
        let aiUnavailable: string | null = null;
        try {
            const access = await this.settings.resolve(tenantId);
            if (access.source === 'platform') {
                const { used, limit } = await this.quota.summary(tenantId);
                quotaLeft = limit === null ? null : Math.max(0, limit - used);
            }
        } catch (err) {
            aiUnavailable = err instanceof AiUnavailableError ? err.message : 'La IA no está disponible en este momento.';
        }
        const avg = u?.avgTokens === null || u?.avgTokens === undefined ? null : Math.round(Number(u.avgTokens));
        return {
            agent: {
                id: loaded.row.id,
                name: loaded.row.name,
                mode: loaded.row.mode as AiAgentMode,
                isActive: loaded.row.isActive,
                maxRunsPerDay: loaded.row.maxRunsPerDay,
                monthlyTokenBudget: loaded.row.monthlyTokenBudget === null ? null : Number(loaded.row.monthlyTokenBudget),
                listIds: loaded.lists.map((l) => l.id),
            },
            runsToday: Number(u?.runsToday ?? 0),
            tokensMonth: Number(u?.tokensMonth ?? 0),
            inflight: Number(u?.inflight ?? 0),
            quotaLeft,
            tokensPerRun: avg && avg > 0 ? avg : null,
            aiUnavailable,
        };
    }

    private async batchFor(tenantId: number, listId: number, batchId: number): Promise<AgentBatchDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ b: aiAgentBatches, agentName: aiAgents.name })
                .from(aiAgentBatches)
                .leftJoin(aiAgents, eq(aiAgents.id, aiAgentBatches.agentId))
                .where(and(eq(aiAgentBatches.tenantId, tenantId), eq(aiAgentBatches.id, batchId), eq(aiAgentBatches.listId, listId)))
                .limit(1);
            if (!row) throw new NotFoundException({ code: 'agent_batch_not_found', message: 'Ese lote no existe.', data: { status: 404 } });
            const runs = await tx
                .select({ id: aiAgentRuns.id, recordId: aiAgentRuns.recordId, status: aiAgentRuns.status, steps: aiAgentRuns.steps, error: aiAgentRuns.error })
                .from(aiAgentRuns)
                .where(and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.batchId, batchId)))
                .orderBy(asc(aiAgentRuns.id));
            const runIds = runs.map((r) => r.id);
            const [pending] = runIds.length
                ? await tx
                      .select({ n: sql<number>`count(*)::int` })
                      .from(aiAgentProposals)
                      .where(and(eq(aiAgentProposals.tenantId, tenantId), inArray(aiAgentProposals.runId, runIds), eq(aiAgentProposals.status, 'pending')))
                : [{ n: 0 }];
            const bad = runs.filter((r) => r.status === 'failed' || r.status === 'skipped' || r.status === 'stopped').slice(0, BATCH_ERRORS);
            const titles = await this.agents.recordTitles(
                tx,
                bad.map((r) => r.recordId).filter((x): x is number => x !== null),
            );
            const count = (s: AiAgentRunStatus) => runs.filter((r) => r.status === s).length;
            return {
                id: row.b.id,
                agent_id: row.b.agentId,
                agent_name: row.agentName ?? '',
                list_id: row.b.listId,
                status: row.b.status as AgentBatchStatus,
                stopped_reason: row.b.stoppedReason,
                total: row.b.total,
                dispatched: row.b.dispatched,
                queued: count('queued'),
                running: count('running'),
                succeeded: count('success'),
                failed: count('failed') + count('stopped'),
                skipped: count('skipped'),
                changed: runs.filter((r) => writesOf(r.steps) > 0).length,
                proposals_pending: Number(pending?.n ?? 0),
                errors: bad.map((r) => ({
                    record_id: r.recordId,
                    title: r.recordId !== null ? (titles.get(r.recordId) ?? `#${r.recordId}`) : '',
                    message: r.error ?? '',
                })),
                created_at: row.b.createdAt.toISOString(),
                finished_at: row.b.finishedAt?.toISOString() ?? null,
            };
        });
    }

    private async runDtos(tx: Tx, tenantId: number, rows: Array<typeof aiAgentRuns.$inferSelect>): Promise<RecordAgentRunDto[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((r) => r.id);
        const [agentRows, proposals, names] = await Promise.all([
            tx
                .select({ id: aiAgents.id, name: aiAgents.name })
                .from(aiAgents)
                .where(and(eq(aiAgents.tenantId, tenantId), inArray(aiAgents.id, [...new Set(rows.map((r) => r.agentId))]))),
            tx
                .select({ id: aiAgentProposals.id, runId: aiAgentProposals.runId, status: aiAgentProposals.status, changes: aiAgentProposals.changes })
                .from(aiAgentProposals)
                .where(and(eq(aiAgentProposals.tenantId, tenantId), inArray(aiAgentProposals.runId, ids))),
            memberNames(tx, tenantId, rows.map((r) => r.createdBy ?? 0)),
        ]);
        const agentName = new Map(agentRows.map((a) => [a.id, a.name]));
        return rows.map((r) => {
            const p = proposals.find((x) => x.runId === r.id);
            return {
                id: r.id,
                agent_id: r.agentId,
                agent_name: agentName.get(r.agentId) ?? '',
                status: r.status as AiAgentRunStatus,
                summary: r.summary,
                error: r.error,
                writes: writesOf(r.steps),
                proposal: p ? { id: p.id, status: p.status, items: Array.isArray(p.changes) ? p.changes.length : 0 } : null,
                created_by_name: r.createdBy ? (names.get(r.createdBy)?.name ?? null) : null,
                created_at: r.createdAt.toISOString(),
                finished_at: r.finishedAt?.toISOString() ?? null,
            };
        });
    }
}

/** Cambios que el agente hizo de verdad (pasos de escritura que salieron bien). */
export function writesOf(steps: unknown): number {
    return Array.isArray(steps) ? (steps as AiAgentRunStep[]).filter((s) => s && s.kind === 'write' && s.ok).length : 0;
}

function assertBatchActor(actor: AiAssistActor): void {
    assertMayUseAi(actor);
    if (!can(actor, 'bulk_actions')) {
        throw new ForbiddenException({ code: 'agent_batch_forbidden', message: 'Correr un agente en lote es una acción masiva: tu rol no la tiene.', data: { status: 403 } });
    }
}

function assertAgentInList(limits: AgentLimits, listId: number): void {
    if (!limits.agent.isActive) throw new BadRequestException({ code: 'agent_not_available', message: 'Ese agente está en pausa.', data: { status: 400 } });
    if (!limits.agent.listIds.includes(listId)) {
        throw new BadRequestException({ code: 'agent_not_available', message: 'Ese agente no trabaja en esta lista.', data: { status: 400 } });
    }
}

/** Por qué el lote no puede seguir (null = puede). */
function stopReason(l: AgentLimits): string | null {
    if (!l.agent.isActive) return 'El agente se pausó.';
    if (l.aiUnavailable) return `Sin IA disponible: ${l.aiUnavailable}`;
    if (l.agent.monthlyTokenBudget !== null && l.tokensMonth >= l.agent.monthlyTokenBudget) {
        return `El agente llegó a su presupuesto de ${l.agent.monthlyTokenBudget.toLocaleString('es')} tokens del mes.`;
    }
    if (l.quotaLeft !== null && l.quotaLeft <= 0) return 'Se agotaron los pedidos a la IA de tu plan este mes.';
    return null;
}

/** Cuántos van a correr de verdad y por qué no todos (puro: se prueba solo). */
export function previewOf(l: AgentLimits, matched: number, eligible: number): AgentBatchPreview {
    const notes: string[] = [];
    const runsLeft = Math.max(0, l.agent.maxRunsPerDay - l.runsToday - l.inflight);
    const budgetLeft = l.agent.monthlyTokenBudget === null ? null : Math.max(0, l.agent.monthlyTokenBudget - l.tokensMonth);
    let willRun = Math.min(eligible, runsLeft, l.quotaLeft ?? Number.POSITIVE_INFINITY);
    if (budgetLeft !== null && l.tokensPerRun) willRun = Math.min(willRun, Math.floor(budgetLeft / l.tokensPerRun));
    if (l.aiUnavailable) {
        willRun = 0;
        notes.push(l.aiUnavailable);
    }
    if (!l.agent.isActive) {
        willRun = 0;
        notes.push('El agente está en pausa.');
    }
    if (matched > eligible) notes.push(`Se toman los primeros ${eligible} de ${matched} registros (máximo ${AI_AGENT_BATCH_MAX} por lote).`);
    if (runsLeft < eligible) notes.push(`Al agente le quedan ${runsLeft} corridas hoy (tope de ${l.agent.maxRunsPerDay} por día).`);
    if (l.quotaLeft !== null && l.quotaLeft < eligible) notes.push(`Quedan ${l.quotaLeft} pedidos a la IA de tu plan este mes: cada registro usa uno.`);
    if (budgetLeft !== null && l.tokensPerRun && Math.floor(budgetLeft / l.tokensPerRun) < eligible) {
        notes.push(`Con el presupuesto de tokens del agente alcanza para unos ${Math.floor(budgetLeft / l.tokensPerRun)} registros más este mes.`);
    }
    return {
        agent: { id: l.agent.id, name: l.agent.name, mode: l.agent.mode, max_runs_per_day: l.agent.maxRunsPerDay },
        matched,
        eligible,
        runs_left_today: runsLeft,
        quota_left: l.quotaLeft,
        budget_left: budgetLeft,
        tokens_per_run: l.tokensPerRun,
        will_run: Math.max(0, willRun),
        notes,
    };
}

async function finish(tx: Tx, batchId: number, status: AgentBatchStatus, reason: string | null): Promise<void> {
    await tx
        .update(aiAgentBatches)
        .set({ status, stoppedReason: reason, finishedAt: new Date() })
        .where(eq(aiAgentBatches.id, batchId));
}

export type { AiAgentBatchRow };
