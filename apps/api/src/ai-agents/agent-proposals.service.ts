import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    agentClip,
    readAiAgentSettings,
    type AiAgentApplyResult,
    type AiAgentProposalDto,
    type AiAgentProposalItem,
    type AiAgentProposalStatus,
    type MyAgentProposalsDto,
} from '@imagina-base/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CommentsService } from '../comments/comments.service';
import type { Tx } from '../db/client';
import { aiAgentProposals, aiAgents, lists, records, users, type AiAgentProposalRow } from '../db/schema';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from '../records/records.service';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AiAgentsService } from './ai-agents.service';
import { describeError, type StoredAgentChange } from './agent-toolbox';

/** Tope de propuestas pendientes que trae «Mi trabajo». */
const MY_PROPOSALS_LIMIT = 100;

/**
 * E6 — Propuestas de los agentes de IA (modo «Propone y una persona aprueba»).
 *
 * Mismo contrato que el asistente (ADR-S21): el agente PROPONE con el payload
 * ya validado (los mismos chequeos de una edición, sin escribir) y una PERSONA
 * APLICA por id — nunca se aplica lo que mande el cliente. Distinto del
 * asistente, la propuesta es DURABLE (vive en Postgres, no en Redis por 2 h):
 * espera en la ficha del registro y en «Mi trabajo» hasta que alguien decida.
 *
 * Aplicar corre con el acceso de QUIEN APLICA (no puede aplicar lo que no
 * podría hacer a mano) y no pisa lo que cambió desde que se propuso: un campo
 * cuyo valor ya no es el de antes se saltea con el motivo.
 */
@Injectable()
export class AgentProposalsService {
    private readonly logger = new Logger(AgentProposalsService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly comments: CommentsService,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly agents: AiAgentsService,
        @Optional() private readonly notifications?: NotificationsService,
        @Optional() private readonly approvals?: ApprovalsService,
        @Optional() private readonly mail?: MailService,
    ) {}

    /** Deja la propuesta de una corrida, con su actividad y el aviso a quienes la revisan. */
    async create(p: {
        tenantId: number;
        agent: { id: number; name: string; ownerId: number | null; settings: unknown };
        runId: number;
        listId: number;
        recordId: number;
        summary: string;
        changes: StoredAgentChange[];
    }): Promise<number> {
        const id = await this.tenantDb.withTenant(p.tenantId, async (tx) => {
            const [row] = await tx
                .insert(aiAgentProposals)
                .values({
                    tenantId: p.tenantId,
                    agentId: p.agent.id,
                    agentName: p.agent.name,
                    runId: p.runId,
                    listId: p.listId,
                    recordId: p.recordId,
                    summary: agentClip(p.summary, 2000),
                    changes: p.changes,
                })
                .returning({ id: aiAgentProposals.id });
            await this.activity.logInTx(tx, {
                tenantId: p.tenantId,
                listId: p.listId,
                recordId: p.recordId,
                userId: null,
                action: 'ai_agent',
                diff: {
                    agent: {
                        event: 'proposed',
                        agent_id: p.agent.id,
                        agent_name: p.agent.name,
                        proposal_id: row!.id,
                        count: p.changes.length,
                        summary: agentClip(p.changes.map((c) => c.title).join(' · '), 300),
                    },
                },
                agentId: p.agent.id,
            });
            return row!.id;
        });
        this.realtime.records(p.tenantId, p.listId);
        const reviewers = reviewersOf(p.agent);
        if (reviewers.length > 0) {
            await this.notifications
                ?.deliver(p.tenantId, 'agent', reviewers, {
                    listId: p.listId,
                    recordId: p.recordId,
                    actorId: null,
                    title: `El agente «${p.agent.name}» propone ${p.changes.length === 1 ? 'un cambio' : `${p.changes.length} cambios`}`,
                    body: agentClip(p.changes.map((c) => c.title).join(' · '), 280),
                })
                .catch((err) => this.logger.warn(`No se pudo avisar de la propuesta ${id}: ${String(err)}`));
        }
        return id;
    }

    /** Las pendientes de un registro (para la tarjeta de la ficha). Quien mira tiene que ver el registro. */
    async forRecord(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<AiAgentProposalDto[]> {
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        return this.tenantDb.withTenant(tenantId, (tx) => this.pendingForRecordInTx(tx, tenantId, recordId));
    }

    async pendingForRecordInTx(tx: Tx, tenantId: number, recordId: number): Promise<AiAgentProposalDto[]> {
        const rows = await tx
            .select({ p: aiAgentProposals, color: aiAgents.color, icon: aiAgents.icon, liveName: aiAgents.name })
            .from(aiAgentProposals)
            .leftJoin(aiAgents, eq(aiAgents.id, aiAgentProposals.agentId))
            .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.recordId, recordId), eq(aiAgentProposals.status, 'pending')))
            .orderBy(desc(aiAgentProposals.id))
            .limit(20);
        return rows.map((r) => toDto(r.p, { color: r.color, icon: r.icon, name: r.liveName }, null, null));
    }

    /** «Mi trabajo»: lo que espera MI revisión (soy revisor del agente, o su dueño si no tiene revisores) y puedo ver. */
    async mine(tenantId: number, actor: Actor): Promise<MyAgentProposalsDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({
                    p: aiAgentProposals,
                    color: aiAgents.color,
                    icon: aiAgents.icon,
                    liveName: aiAgents.name,
                    ownerId: aiAgents.ownerId,
                    settings: aiAgents.settings,
                    listSlug: lists.slug,
                    listName: lists.name,
                    recData: records.data,
                    recCreatedBy: records.createdBy,
                })
                .from(aiAgentProposals)
                .innerJoin(aiAgents, eq(aiAgents.id, aiAgentProposals.agentId))
                // RLS: un registro o una lista en la papelera no aparecen.
                .innerJoin(records, eq(records.id, aiAgentProposals.recordId))
                .innerJoin(lists, eq(lists.id, aiAgentProposals.listId))
                .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.status, 'pending')))
                .orderBy(desc(aiAgentProposals.id))
                .limit(MY_PROPOSALS_LIMIT * 3);
            const mineRows = rows.filter((r) => reviewersOf({ ownerId: r.ownerId, settings: r.settings }).includes(actor.userId));
            if (mineRows.length === 0) return { pending: [] };
            const listIds = [...new Set(mineRows.map((r) => r.p.listId))];
            const listsById = new Map<number, Awaited<ReturnType<ListsService['getWithinTx']>>>();
            for (const id of listIds) {
                try {
                    listsById.set(id, await this.lists.getWithinTx(tx, tenantId, String(id)));
                } catch {
                    // lista inaccesible: sus propuestas no se muestran
                }
            }
            const titles = await this.agents.recordTitles(tx, [...new Set(mineRows.map((r) => r.p.recordId))]);
            const out: AiAgentProposalDto[] = [];
            for (const r of mineRows) {
                const list = listsById.get(r.p.listId);
                if (!list || !this.records.canReach(list, actor, 'view', { data: r.recData, createdBy: r.recCreatedBy })) continue;
                out.push(
                    toDto(r.p, { color: r.color, icon: r.icon, name: r.liveName }, { slug: r.listSlug, name: r.listName }, titles.get(r.p.recordId) ?? `Registro #${r.p.recordId}`),
                );
                if (out.length >= MY_PROPOSALS_LIMIT) break;
            }
            return { pending: out };
        });
    }

    /**
     * Aplica una propuesta. Quien aplica tiene que poder EDITAR el registro;
     * cada cambio corre con su acceso por el mismo camino de siempre. La marca
     * «aplicada» se toma primero (`WHERE status = 'pending'`): dos clics no
     * aplican dos veces.
     */
    async apply(tenantId: number, actor: Actor, proposalId: number): Promise<AiAgentApplyResult> {
        const row = await this.loadForDecision(tenantId, actor, proposalId);
        const claimed = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(aiAgentProposals)
                .set({ status: 'applied', decidedBy: actor.userId, decidedAt: new Date(), updatedAt: new Date() })
                .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.id, proposalId), eq(aiAgentProposals.status, 'pending')))
                .returning({ id: aiAgentProposals.id }),
        );
        if (claimed.length === 0) throw alreadyDecided();
        const agentName = row.agentName || 'Agente de IA';
        const applier: Actor = { ...actor, ...(row.agentId ? { agentId: row.agentId, viaAgentProposal: true } : {}) };
        const outcomes: Array<{ ok: boolean; message: string }> = [];
        const warnings: string[] = [];
        for (const change of (Array.isArray(row.changes) ? row.changes : []) as StoredAgentChange[]) {
            try {
                outcomes.push(await this.applyChange(tenantId, applier, row, change, agentName));
            } catch (err) {
                const message = describeError(err);
                outcomes.push({ ok: false, message });
                warnings.push(`${change.title}: ${message}`);
            }
            const last = outcomes[outcomes.length - 1]!;
            if (last.ok && last.message.startsWith('No se aplicó')) warnings.push(`${change.title}: ${last.message}`);
        }
        const applied = outcomes.filter((o) => o.ok && !o.message.startsWith('No se aplicó')).length;
        const failed = outcomes.length - applied;
        const status: AiAgentProposalStatus = applied === 0 && outcomes.length > 0 ? 'failed' : 'applied';
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(aiAgentProposals)
                .set({ status, result: { items: outcomes }, updatedAt: new Date() })
                .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.id, proposalId)));
            await this.activity.logInTx(tx, {
                tenantId,
                listId: row.listId,
                recordId: row.recordId,
                userId: actor.userId,
                action: 'ai_agent',
                diff: { agent: { event: 'applied', agent_id: row.agentId ?? 0, agent_name: agentName, proposal_id: proposalId, count: applied } },
                agentId: row.agentId,
            });
        });
        this.realtime.records(tenantId, row.listId);
        const [proposal] = await this.tenantDb.withTenant(tenantId, (tx) => this.byIds(tx, tenantId, [proposalId]));
        return { proposal: proposal!, applied, failed, warnings };
    }

    async discard(tenantId: number, actor: Actor, proposalId: number): Promise<AiAgentProposalDto> {
        const row = await this.loadForDecision(tenantId, actor, proposalId);
        const done = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const upd = await tx
                .update(aiAgentProposals)
                .set({ status: 'discarded', decidedBy: actor.userId, decidedAt: new Date(), updatedAt: new Date() })
                .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.id, proposalId), eq(aiAgentProposals.status, 'pending')))
                .returning({ id: aiAgentProposals.id });
            if (upd.length === 0) return false;
            await this.activity.logInTx(tx, {
                tenantId,
                listId: row.listId,
                recordId: row.recordId,
                userId: actor.userId,
                action: 'ai_agent',
                diff: { agent: { event: 'discarded', agent_id: row.agentId ?? 0, agent_name: row.agentName || 'Agente de IA', proposal_id: proposalId } },
                agentId: row.agentId,
            });
            return true;
        });
        if (!done) throw alreadyDecided();
        this.realtime.records(tenantId, row.listId);
        const [dto] = await this.tenantDb.withTenant(tenantId, (tx) => this.byIds(tx, tenantId, [proposalId]));
        return dto!;
    }

    // ── Internos ─────────────────────────────────────────────────────────

    /** La propuesta pendiente, si quien decide puede EDITAR su registro (si no, 404/403). */
    private async loadForDecision(tenantId: number, actor: Actor, proposalId: number): Promise<AiAgentProposalRow> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(aiAgentProposals).where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.id, proposalId))).limit(1),
        );
        if (!row) throw proposalNotFound(proposalId);
        // 404 si no ve el registro (o está en la papelera).
        const rec = await this.records.get(tenantId, actor, String(row.listId), row.recordId).catch(() => {
            throw proposalNotFound(proposalId);
        });
        const list = await this.lists.get(tenantId, String(row.listId));
        if (!this.records.canReach(list, actor, 'edit', { data: rec.data, createdBy: rec.created_by })) {
            throw new ForbiddenException({ code: 'agent_proposal_forbidden', message: 'Para decidir sobre esta propuesta tienes que poder editar el registro.', data: { status: 403 } });
        }
        if (row.status !== 'pending') throw alreadyDecided();
        return row;
    }

    private async applyChange(tenantId: number, actor: Actor, row: AiAgentProposalRow, change: StoredAgentChange, agentName: string): Promise<{ ok: boolean; message: string }> {
        switch (change.kind) {
            case 'update_fields': {
                const current = await this.records.get(tenantId, actor, String(change.list_id), change.record_id);
                // No pisar lo que cambió desde que se propuso.
                const fresh: Record<string, unknown> = {};
                const moved: string[] = [];
                for (const [k, v] of Object.entries(change.patch)) {
                    const was = change.before[k] ?? null;
                    const now = current.data[k] ?? null;
                    if (JSON.stringify(now) === JSON.stringify(v ?? null)) continue; // ya estaba así
                    if (JSON.stringify(now) !== JSON.stringify(was)) {
                        moved.push(change.labels?.[k] ?? k);
                        continue;
                    }
                    fresh[k] = v;
                }
                if (Object.keys(fresh).length === 0) {
                    return {
                        ok: true,
                        message: moved.length > 0 ? `No se aplicó: ${moved.map((m) => `«${m}»`).join(', ')} cambió después de la propuesta.` : 'Ya tenía esos valores.',
                    };
                }
                await this.records.update(tenantId, actor, String(change.list_id), change.record_id, { data: fresh });
                return { ok: true, message: moved.length > 0 ? `Se aplicó en parte: ${moved.map((m) => `«${m}»`).join(', ')} cambió después de la propuesta.` : 'Aplicado.' };
            }
            case 'create_record': {
                const rec = await this.records.create(tenantId, actor, String(change.list_id), { data: change.data } as never);
                return { ok: true, message: `Creado (#${rec.id}).` };
            }
            case 'comment': {
                await this.comments.create(tenantId, actor, String(change.list_id), change.record_id, {
                    body: change.body,
                    kind: 'note',
                    visibility: change.visibility,
                    metadata: { agent: { id: row.agentId, name: agentName } },
                });
                return { ok: true, message: 'Comentario publicado.' };
            }
            case 'request_approval': {
                if (!this.approvals) throw new NotFoundException({ code: 'approvals_unavailable', message: 'Las aprobaciones no están disponibles.', data: { status: 404 } });
                await this.approvals.request(tenantId, actor, String(change.list_id), change.record_id, { flow_id: change.flow_id, note: change.note } as never);
                return { ok: true, message: `Se pidió la aprobación «${change.flow_name}».` };
            }
            case 'send_email': {
                if (!this.mail) throw new NotFoundException({ code: 'mail_unavailable', message: 'El correo no está disponible.', data: { status: 404 } });
                await this.mail.sendNow({ tenantId, to: change.to.join(', '), subject: change.subject, text: change.body });
                return { ok: true, message: `Correo enviado a ${change.to.join(', ')}.` };
            }
        }
    }

    private async byIds(tx: Tx, tenantId: number, ids: number[]): Promise<AiAgentProposalDto[]> {
        const rows = await tx
            .select({ p: aiAgentProposals, color: aiAgents.color, icon: aiAgents.icon, liveName: aiAgents.name, decidedName: users.name })
            .from(aiAgentProposals)
            .leftJoin(aiAgents, eq(aiAgents.id, aiAgentProposals.agentId))
            .leftJoin(users, eq(users.id, aiAgentProposals.decidedBy))
            .where(and(eq(aiAgentProposals.tenantId, tenantId), inArray(aiAgentProposals.id, ids)));
        return rows.map((r) => ({ ...toDto(r.p, { color: r.color, icon: r.icon, name: r.liveName }, null, null), decided_by_name: r.decidedName ?? null }));
    }
}

/** Quiénes revisan las propuestas de un agente: sus revisores o, si no tiene, su dueño. */
export function reviewersOf(agent: { ownerId: number | null; settings: unknown }): number[] {
    const s = readAiAgentSettings(agent.settings);
    if (s.reviewer_user_ids.length > 0) return s.reviewer_user_ids;
    return agent.ownerId ? [agent.ownerId] : [];
}

function toDto(
    p: AiAgentProposalRow,
    agent: { color: string | null; icon: string | null; name: string | null },
    list: { slug: string; name: string } | null,
    recordTitle: string | null,
): AiAgentProposalDto {
    const result = (p.result ?? {}) as { items?: Array<{ ok: boolean; message: string }> };
    const changes = (Array.isArray(p.changes) ? p.changes : []) as StoredAgentChange[];
    const items: AiAgentProposalItem[] = changes.map((c, i) => ({
        kind: c.kind,
        title: c.title,
        lines: c.lines ?? [],
        outcome: result.items?.[i] ?? null,
    }));
    return {
        id: p.id,
        agent: p.agentId ? { id: p.agentId, name: agent.name ?? p.agentName, color: agent.color, icon: agent.icon } : null,
        run_id: p.runId,
        list_id: p.listId,
        list_slug: list?.slug ?? null,
        list_name: list?.name ?? null,
        record_id: p.recordId,
        record_title: recordTitle,
        status: p.status as AiAgentProposalStatus,
        summary: p.summary,
        items,
        decided_by_name: null,
        decided_at: p.decidedAt?.toISOString() ?? null,
        created_at: p.createdAt.toISOString(),
    };
}

function proposalNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'agent_proposal_not_found', message: `La propuesta ${id} no existe.`, data: { status: 404 } });
}

function alreadyDecided(): ConflictException {
    return new ConflictException({ code: 'agent_proposal_decided', message: 'Alguien ya decidió sobre esta propuesta.', data: { status: 409 } });
}
