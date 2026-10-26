import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    AI_AGENT_QUICK_TRIGGER_LABELS,
    AI_AGENT_TOOLS,
    AI_AGENT_TOOL_META,
    AI_AGENT_VERSIONS_KEPT,
    agentDayStart,
    agentIdsInActions,
    agentMonthStart,
    effectiveCapabilities,
    isManagedAgentAutomation,
    readAiAgentSettings,
    readAskAgentConfig,
    type AiAgentDto,
    type AiAgentListRef,
    type AiAgentMode,
    type AiAgentRunDto,
    type AiAgentRunStatus,
    type AiAgentRunStep,
    type AiAgentTool,
    type AiAgentTriggerDto,
    type AiAgentVersionDto,
    type Capability,
    type CreateAiAgentInput,
    type CreateAiAgentTriggerInput,
    type Role,
    type UpdateAiAgentInput,
    type UpdateAiAgentTriggerInput,
} from '@imagina-base/shared';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AutomationsService } from '../automations/automations.service';
import { canAny } from '../authz/can';
import type { Tx } from '../db/client';
import { aiAgentLists, aiAgentProposals, aiAgentRuns, aiAgentVersions, aiAgents, automations, customRoles, lists, memberships, records, users, type AiAgentRow } from '../db/schema';
import { IncidentHub } from '../incidents/incident-hub';
import { effectivePermissions, type AclSubject } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AGENT_TOOL_CAPABILITIES } from './agent-toolbox';

/** El dueño de un agente con su acceso VIGENTE (rol, rol propio, equipos). */
export interface OwnerActor extends AclSubject {
    capabilities: Capability[];
    name: string;
}

export interface AgentLoaded {
    row: AiAgentRow;
    /** Listas vivas (las de la papelera quedan afuera por la RLS de `lists`). */
    lists: AiAgentListRef[];
}

/** Quien administra agentes (el ACL del pedido). */
export type AgentEditor = AclSubject & { capabilities?: readonly Capability[] };

/**
 * E6 — Agentes de IA (ADR-S67): configuración, «Cuándo trabaja» (las
 * automatizaciones con la acción `ask_agent`), historial y versiones.
 *
 * Un agente corre con el acceso de su DUEÑO. Por eso guardar un agente lo
 * valida contra QUIEN GUARDA (que vea sus listas y pueda usar sus
 * herramientas) y, si guarda otra persona, el agente pasa a trabajar con el
 * acceso de esa persona: nadie puede darle a un agente más de lo que tiene.
 */
@Injectable()
export class AiAgentsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly automationsSvc: AutomationsService,
        private readonly audit: AuditService,
        @Optional() private readonly incidents?: IncidentHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ── Dueño ────────────────────────────────────────────────────────────

    /**
     * El acceso VIGENTE de una persona (rol en vivo, rol propio, equipos).
     * `null` si ya no es del equipo, su cuenta está desactivada o es cliente
     * del portal o invitada: un agente suyo no puede trabajar.
     */
    async ownerActor(tenantId: number, userId: number | null, tx?: Tx): Promise<OwnerActor | null> {
        if (!userId) return null;
        const read = async (t: Tx) => {
            const [row] = await t
                .select({
                    role: memberships.role,
                    name: users.name,
                    email: users.email,
                    teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
                    customRoleId: memberships.customRoleId,
                    customCaps: customRoles.capabilities,
                })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .leftJoin(customRoles, and(eq(customRoles.id, memberships.customRoleId), eq(customRoles.tenantId, memberships.tenantId)))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), isNull(users.disabledAt)))
                .limit(1);
            return row ?? null;
        };
        const row = tx ? await read(tx) : await this.tenantDb.withTenant(tenantId, read);
        if (!row || row.role === 'client' || row.role === 'guest') return null;
        const custom = row.customCaps ? (row.customCaps as string[]) : null;
        return {
            userId,
            role: row.role as Role,
            teamIds: (row.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
            customRoleId: custom ? row.customRoleId : null,
            capabilities: effectiveCapabilities(row.role as Role, custom),
            name: row.name || row.email,
        };
    }

    /** ¿El dueño puede usar esta herramienta? (sus capacidades; el ACL de lista decide fila por fila). */
    static ownerCanUse(owner: { role: Role | string; capabilities?: readonly Capability[] }, tool: AiAgentTool): boolean {
        return canAny(owner, AGENT_TOOL_CAPABILITIES[tool] as readonly Capability[]);
    }

    // ── Leer ─────────────────────────────────────────────────────────────

    async list(tenantId: number): Promise<AiAgentDto[]> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx.select().from(aiAgents).where(eq(aiAgents.tenantId, tenantId)).orderBy(aiAgents.name);
            if (rows.length === 0) return [];
            const dtos = await this.toDtos(tx, tenantId, rows);
            // Papelera: un agente cuyas listas están TODAS en la papelera no se muestra.
            return dtos.filter((d) => d.lists.length > 0);
        });
    }

    async get(tenantId: number, id: number): Promise<AiAgentDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.rowOrThrow(tx, tenantId, id);
            const [dto] = await this.toDtos(tx, tenantId, [row]);
            if (!dto || dto.lists.length === 0) throw agentNotFound(id);
            return dto;
        });
    }

    /** Para el editor de automatizaciones: qué agentes hay y en qué listas trabajan. */
    async options(tenantId: number): Promise<Array<{ id: number; name: string; color: string | null; icon: string | null; list_ids: number[]; is_active: boolean; mode: AiAgentMode }>> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx.select().from(aiAgents).where(eq(aiAgents.tenantId, tenantId)).orderBy(aiAgents.name);
            const listsBy = await this.liveLists(tx, tenantId, rows.map((r) => r.id));
            return rows
                .map((r) => ({
                    id: r.id,
                    name: r.name,
                    color: r.color,
                    icon: r.icon,
                    list_ids: (listsBy.get(r.id) ?? []).map((l) => l.id),
                    is_active: r.isActive,
                    mode: r.mode as AiAgentMode,
                }))
                .filter((r) => r.list_ids.length > 0);
        });
    }

    /** Para el motor: el agente y sus listas vivas (o null). */
    async load(tenantId: number, id: number, tx?: Tx): Promise<AgentLoaded | null> {
        const read = async (t: Tx): Promise<AgentLoaded | null> => {
            const [row] = await t.select().from(aiAgents).where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.id, id))).limit(1);
            if (!row) return null;
            const listsBy = await this.liveLists(t, tenantId, [row.id]);
            return { row, lists: listsBy.get(row.id) ?? [] };
        };
        return tx ? read(tx) : this.tenantDb.withTenant(tenantId, read);
    }

    /** Los agentes que trabajan en una lista (para el asistente y el índice de automatizaciones). */
    async forList(tenantId: number, listId: number): Promise<AiAgentDto[]> {
        return (await this.list(tenantId)).filter((a) => a.list_ids.includes(listId));
    }

    // ── Escribir ─────────────────────────────────────────────────────────

    async create(tenantId: number, editor: AgentEditor, input: CreateAiAgentInput): Promise<AiAgentDto> {
        await this.checkConfig(tenantId, editor, {
            list_ids: input.list_ids,
            tools: input.tools,
            settings: input.settings,
        });
        const id = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .insert(aiAgents)
                .values({
                    tenantId,
                    name: input.name,
                    description: input.description,
                    color: input.color ?? null,
                    icon: input.icon ?? null,
                    instructions: input.instructions,
                    tools: orderedTools(input.tools),
                    mode: input.mode,
                    settings: normalizedSettings(input.settings, input.tools),
                    maxSteps: input.max_steps,
                    maxRunsPerDay: input.max_runs_per_day,
                    monthlyTokenBudget: input.monthly_token_budget,
                    ownerId: editor.userId,
                    isActive: input.is_active,
                    createdBy: editor.userId,
                })
                .returning();
            await this.replaceLists(tx, tenantId, row!.id, input.list_ids);
            await this.recordVersion(tx, tenantId, row!.id, editor.userId, input.template_key ? `Creó el agente desde la plantilla «${input.template_key}»` : 'Creó el agente');
            return row!.id;
        });
        const dto = await this.get(tenantId, id);
        await this.audit.log({ tenantId, userId: editor.userId, action: 'ai_agent.create', targetType: 'ai_agent', targetId: id, targetLabel: dto.name, meta: { lists: dto.list_ids, tools: dto.tools, mode: dto.mode } });
        return dto;
    }

    async update(tenantId: number, editor: AgentEditor, id: number, input: UpdateAiAgentInput): Promise<AiAgentDto> {
        const before = await this.get(tenantId, id);
        const listIds = input.list_ids ?? before.list_ids;
        const tools = input.tools ?? before.tools;
        await this.checkConfig(tenantId, editor, { list_ids: listIds, tools, settings: input.settings ?? before.settings });
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const patch: Partial<typeof aiAgents.$inferInsert> = { updatedAt: new Date() };
            if (input.name !== undefined) patch.name = input.name;
            if (input.description !== undefined) patch.description = input.description;
            if (input.color !== undefined) patch.color = input.color;
            if (input.icon !== undefined) patch.icon = input.icon;
            if (input.instructions !== undefined) patch.instructions = input.instructions;
            if (input.tools !== undefined) patch.tools = orderedTools(input.tools);
            if (input.mode !== undefined) patch.mode = input.mode;
            if (input.settings !== undefined || input.tools !== undefined) patch.settings = normalizedSettings(input.settings ?? before.settings, tools);
            if (input.max_steps !== undefined) patch.maxSteps = input.max_steps;
            if (input.max_runs_per_day !== undefined) patch.maxRunsPerDay = input.max_runs_per_day;
            if (input.monthly_token_budget !== undefined) patch.monthlyTokenBudget = input.monthly_token_budget;
            if (input.is_active !== undefined) {
                patch.isActive = input.is_active;
                // Reanudar limpia el motivo de una pausa automática.
                if (input.is_active) patch.pausedReason = null;
            }
            // Nadie le da a un agente más de lo que tiene: si guarda otra
            // persona, el agente pasa a trabajar con SU acceso.
            if (before.owner?.id !== editor.userId) patch.ownerId = editor.userId;
            await tx.update(aiAgents).set(patch).where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.id, id)));
            if (input.list_ids !== undefined) await this.replaceLists(tx, tenantId, id, input.list_ids);
            const note = input.restored_from
                ? 'Restauró una versión anterior'
                : input.is_active !== undefined && Object.keys(input).length === 1
                  ? input.is_active
                      ? 'Reanudó el agente'
                      : 'Pausó el agente'
                  : 'Cambió el agente';
            await this.recordVersion(tx, tenantId, id, editor.userId, note);
        });
        if (input.is_active === true) this.incidents?.resolvePrefix(tenantId, `ai_agent:${id}`);
        const dto = await this.get(tenantId, id);
        await this.audit.log({
            tenantId,
            userId: editor.userId,
            action: 'ai_agent.update',
            targetType: 'ai_agent',
            targetId: id,
            targetLabel: dto.name,
            meta: { changed: Object.keys(input), owner_changed: before.owner?.id !== editor.userId },
        });
        return dto;
    }

    /**
     * Borra el agente. Las automatizaciones que SÓLO le pedían trabajo a él (las
     * que mantiene su editor) van a la papelera; las demás quedan y su paso
     * «Pedirle a un agente» falla con el motivo. Sus propuestas pendientes se
     * descartan.
     */
    async remove(tenantId: number, editor: AgentEditor, id: number): Promise<{ id: number; name: string; automations_removed: number }> {
        const agent = await this.get(tenantId, id);
        let removed = 0;
        for (const t of agent.triggers.filter((x) => x.managed)) {
            try {
                await this.automationsSvc.remove(tenantId, String(t.list_id), t.automation_id, editor.userId);
                removed += 1;
            } catch {
                // Ya no estaba: nada que hacer.
            }
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx
                .update(aiAgentProposals)
                .set({ status: 'discarded', decidedAt: new Date(), decidedBy: editor.userId, updatedAt: new Date(), result: { reason: 'Se borró el agente.' } })
                .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.agentId, id), eq(aiAgentProposals.status, 'pending')));
            await tx.delete(aiAgents).where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.id, id)));
        });
        this.incidents?.resolvePrefix(tenantId, `ai_agent:${id}`);
        await this.audit.log({ tenantId, userId: editor.userId, action: 'ai_agent.delete', targetType: 'ai_agent', targetId: id, targetLabel: agent.name, meta: { automations_removed: removed } });
        return { id, name: agent.name, automations_removed: removed };
    }

    /** El dueño perdió el acceso (se fue, lo desactivaron, ya no ve sus listas): se pausa y avisa. */
    async pauseForOwner(tenantId: number, id: number, name: string, reason: string, listId: number | null): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(aiAgents).set({ isActive: false, pausedReason: reason, updatedAt: new Date() }).where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.id, id))),
        );
        this.incidents?.report({
            tenantId,
            key: `ai_agent:${id}`,
            source: 'ai_agent',
            sourceId: id,
            listId,
            title: `El agente «${name}» se pausó`,
            message: `${reason} Edítalo y guárdalo (pasa a trabajar con tu acceso) o bórralo.`,
        });
    }

    // ── «Cuándo trabaja» ─────────────────────────────────────────────────

    async addTrigger(tenantId: number, editor: AgentEditor, id: number, input: CreateAiAgentTriggerInput): Promise<AiAgentDto> {
        const agent = await this.get(tenantId, id);
        if (!agent.list_ids.includes(input.list_id)) {
            throw new BadRequestException({ code: 'agent_list_out_of_scope', message: 'El agente no trabaja en esa lista: agrégala a sus listas primero.', data: { status: 400 } });
        }
        const triggerConfig: Record<string, unknown> = {};
        if (input.trigger_type === 'record_updated' && input.changed_fields.length > 0) triggerConfig.changed_fields = input.changed_fields;
        const label = AI_AGENT_QUICK_TRIGGER_LABELS[input.trigger_type];
        await this.automationsSvc.create(
            tenantId,
            String(input.list_id),
            {
                name: `Agente «${agent.name}» — ${label.toLowerCase()}`.slice(0, 190),
                description: 'Le pide trabajo a un agente de IA. Se edita desde el agente (Agentes de IA → Cuándo trabaja).',
                trigger_type: input.trigger_type,
                trigger_config: triggerConfig,
                actions: [{ type: 'ask_agent', config: { agent_id: id, instruction: input.instruction } }],
                is_active: true,
            },
            { actorId: editor.userId, note: `Creada desde el agente «${agent.name}»` },
        );
        await this.audit.log({ tenantId, userId: editor.userId, action: 'ai_agent.trigger_add', targetType: 'ai_agent', targetId: id, targetLabel: agent.name, meta: { list_id: input.list_id, trigger: input.trigger_type } });
        return this.get(tenantId, id);
    }

    async updateTrigger(tenantId: number, editor: AgentEditor, id: number, automationId: number, input: UpdateAiAgentTriggerInput): Promise<AiAgentDto> {
        const agent = await this.get(tenantId, id);
        const t = agent.triggers.find((x) => x.automation_id === automationId);
        if (!t) throw new NotFoundException({ code: 'agent_trigger_not_found', message: 'Esa automatización no le pide trabajo a este agente.', data: { status: 404 } });
        const patch: Record<string, unknown> = {};
        if (input.is_active !== undefined) patch.is_active = input.is_active;
        if (input.instruction !== undefined) {
            if (!t.managed) {
                throw new BadRequestException({ code: 'agent_trigger_not_managed', message: 'Esa automatización tiene más pasos: cámbiala en el editor de automatizaciones.', data: { status: 400 } });
            }
            patch.actions = [{ type: 'ask_agent', config: { agent_id: id, instruction: input.instruction } }];
        }
        await this.automationsSvc.update(tenantId, String(t.list_id), automationId, patch, { actorId: editor.userId, note: `Cambiada desde el agente «${agent.name}»` });
        return this.get(tenantId, id);
    }

    async removeTrigger(tenantId: number, editor: AgentEditor, id: number, automationId: number): Promise<AiAgentDto> {
        const agent = await this.get(tenantId, id);
        const t = agent.triggers.find((x) => x.automation_id === automationId);
        if (!t) throw new NotFoundException({ code: 'agent_trigger_not_found', message: 'Esa automatización no le pide trabajo a este agente.', data: { status: 404 } });
        if (!t.managed) {
            throw new BadRequestException({ code: 'agent_trigger_not_managed', message: 'Esa automatización tiene más pasos: quítale el paso «Pedirle a un agente» en el editor de automatizaciones.', data: { status: 400 } });
        }
        await this.automationsSvc.remove(tenantId, String(t.list_id), automationId, editor.userId);
        return this.get(tenantId, id);
    }

    // ── Historial y versiones ────────────────────────────────────────────

    async runs(tenantId: number, id: number, cursor?: number): Promise<{ data: AiAgentRunDto[]; meta: { next_cursor: string | null } }> {
        await this.get(tenantId, id);
        const limit = 30;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.runRows(tx, and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.agentId, id), cursor ? lt(aiAgentRuns.id, cursor) : undefined)!, limit + 1),
        );
        const page = rows.slice(0, limit);
        return { data: page, meta: { next_cursor: rows.length > limit ? String(page[page.length - 1]!.id) : null } };
    }

    async run(tenantId: number, id: number, runId: number): Promise<AiAgentRunDto> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.runRows(tx, and(eq(aiAgentRuns.tenantId, tenantId), eq(aiAgentRuns.agentId, id), eq(aiAgentRuns.id, runId))!, 1),
        );
        if (!row) throw new NotFoundException({ code: 'agent_run_not_found', message: 'Esa corrida no existe.', data: { status: 404 } });
        return row;
    }

    private async runRows(tx: Tx, where: ReturnType<typeof and>, limit: number): Promise<AiAgentRunDto[]> {
        const rows = await tx
            .select({
                r: aiAgentRuns,
                listSlug: lists.slug,
                listName: lists.name,
                byName: users.name,
                proposalId: sql<number | null>`(SELECT p.id FROM ai_agent_proposals p WHERE p.run_id = ${aiAgentRuns.id} ORDER BY p.id DESC LIMIT 1)`,
            })
            .from(aiAgentRuns)
            .leftJoin(lists, eq(lists.id, aiAgentRuns.listId))
            .leftJoin(users, eq(users.id, aiAgentRuns.createdBy))
            .where(where)
            .orderBy(desc(aiAgentRuns.id))
            .limit(limit);
        // El título del registro: una consulta por página (no una por corrida).
        const recIds = [...new Set(rows.map((x) => x.r.recordId).filter((n): n is number => n !== null))];
        const titles = await this.recordTitles(tx, recIds);
        return rows.map(({ r, listSlug, listName, byName, proposalId }) => ({
            id: r.id,
            agent_id: r.agentId,
            list_id: r.listId,
            list_slug: listSlug ?? null,
            list_name: listName ?? null,
            record_id: r.recordId,
            record_title: r.recordId !== null ? (titles.get(r.recordId) ?? `Registro #${r.recordId}`) : null,
            automation_id: r.automationId,
            automation_name: r.automationName,
            trigger_label: r.triggerLabel,
            status: r.status as AiAgentRunStatus,
            simulated: r.simulated,
            mode: r.mode as AiAgentMode,
            instruction: r.instruction,
            steps: (Array.isArray(r.steps) ? r.steps : []) as AiAgentRunStep[],
            summary: r.summary,
            input_tokens: Number(r.inputTokens),
            output_tokens: Number(r.outputTokens),
            error: r.error,
            proposal_id: proposalId === null ? null : Number(proposalId),
            created_by_name: byName ?? null,
            created_at: r.createdAt.toISOString(),
            started_at: r.startedAt?.toISOString() ?? null,
            finished_at: r.finishedAt?.toISOString() ?? null,
        }));
    }

    /** Título de cada registro (campo título de su lista, o el primer texto). */
    async recordTitles(tx: Tx, ids: number[]): Promise<Map<number, string>> {
        if (ids.length === 0) return new Map();
        const rows = await tx.execute<{ id: string; title: string | null }>(sql`
            select r.id,
                   coalesce(
                       r.data ->> ('f' || coalesce(
                           nullif(l.settings ->> 'title_field_id', '')::bigint,
                           (select f.id from fields f where f.list_id = r.list_id and f.type in ('text', 'long_text') and f.deleted_at is null order by f.position, f.id limit 1)
                       )),
                       null
                   ) as title
              from records r
              join lists l on l.id = r.list_id
             where r.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
        const out = new Map<number, string>();
        for (const row of rows.rows) {
            const t = typeof row.title === 'string' ? row.title.trim() : '';
            if (t) out.set(Number(row.id), t.slice(0, 160));
        }
        return out;
    }

    async versions(tenantId: number, id: number): Promise<AiAgentVersionDto[]> {
        await this.get(tenantId, id);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select({ v: aiAgentVersions, name: users.name, email: users.email })
                .from(aiAgentVersions)
                .leftJoin(users, eq(users.id, aiAgentVersions.authorId))
                .where(and(eq(aiAgentVersions.tenantId, tenantId), eq(aiAgentVersions.agentId, id)))
                .orderBy(desc(aiAgentVersions.id))
                .limit(AI_AGENT_VERSIONS_KEPT);
            return rows.map(({ v, name, email }) => ({
                id: v.id,
                agent_id: v.agentId,
                snapshot: v.snapshot as AiAgentVersionDto['snapshot'],
                author: v.authorId ? { id: v.authorId, name: name || email || 'Alguien' } : null,
                note: v.note,
                created_at: v.createdAt.toISOString(),
            }));
        });
    }

    // ── Internos ─────────────────────────────────────────────────────────

    /**
     * Lo que se guarda tiene que estar al alcance de QUIEN GUARDA: ver cada
     * lista (ACL de la lista) y poder usar cada herramienta. Los revisores son
     * personas activas del equipo.
     */
    async checkConfig(
        tenantId: number,
        editor: AgentEditor,
        cfg: { list_ids: number[]; tools: readonly string[]; settings?: { reviewer_user_ids?: number[] } | null },
    ): Promise<void> {
        const errors: Record<string, string> = {};
        for (const listId of [...new Set(cfg.list_ids)]) {
            let list;
            try {
                list = await this.lists.get(tenantId, String(listId));
            } catch {
                errors[`list_ids.${listId}`] = 'Esa lista no existe (o está en la papelera).';
                continue;
            }
            if (effectivePermissions(list.settings, editor).view === 'none') {
                errors[`list_ids.${listId}`] = `No tienes acceso a «${list.name}»: un agente no puede trabajar donde tú no puedes.`;
            }
        }
        const subject = { role: editor.role, capabilities: editor.capabilities };
        for (const tool of cfg.tools) {
            if (!(AI_AGENT_TOOLS as readonly string[]).includes(tool)) continue;
            if (!AiAgentsService.ownerCanUse(subject, tool as AiAgentTool)) {
                errors[`tools.${tool}`] = `Tu rol no permite «${AI_AGENT_TOOL_META[tool as AiAgentTool].label}»: el agente tampoco podría.`;
            }
        }
        const reviewers = cfg.settings?.reviewer_user_ids ?? [];
        for (const userId of reviewers) {
            if (!(await this.ownerActor(tenantId, userId))) errors[`settings.reviewer_user_ids.${userId}`] = 'Esa persona no es del equipo.';
        }
        if (Object.keys(errors).length > 0) {
            throw new ForbiddenException({
                code: 'agent_out_of_reach',
                message: Object.values(errors)[0] ?? 'Configuración fuera de tu alcance.',
                data: { status: 403, errors },
            });
        }
    }

    private async rowOrThrow(tx: Tx, tenantId: number, id: number): Promise<AiAgentRow> {
        const [row] = await tx.select().from(aiAgents).where(and(eq(aiAgents.tenantId, tenantId), eq(aiAgents.id, id))).limit(1);
        if (!row) throw agentNotFound(id);
        return row;
    }

    private async replaceLists(tx: Tx, tenantId: number, agentId: number, listIds: number[]): Promise<void> {
        await tx.delete(aiAgentLists).where(and(eq(aiAgentLists.tenantId, tenantId), eq(aiAgentLists.agentId, agentId)));
        const unique = [...new Set(listIds)];
        if (unique.length > 0) await tx.insert(aiAgentLists).values(unique.map((listId) => ({ tenantId, agentId, listId })));
    }

    /** Listas vivas de cada agente (la RLS de `lists` esconde las de la papelera). */
    private async liveLists(tx: Tx, tenantId: number, agentIds: number[]): Promise<Map<number, AiAgentListRef[]>> {
        const out = new Map<number, AiAgentListRef[]>();
        if (agentIds.length === 0) return out;
        const rows = await tx
            .select({ agentId: aiAgentLists.agentId, id: lists.id, slug: lists.slug, name: lists.name, icon: lists.icon, color: lists.color })
            .from(aiAgentLists)
            .innerJoin(lists, eq(lists.id, aiAgentLists.listId))
            .where(and(eq(aiAgentLists.tenantId, tenantId), inArray(aiAgentLists.agentId, agentIds)))
            .orderBy(lists.position, lists.id);
        for (const r of rows) {
            const arr = out.get(r.agentId) ?? [];
            arr.push({ id: r.id, slug: r.slug, name: r.name, icon: r.icon, color: r.color });
            out.set(r.agentId, arr);
        }
        return out;
    }

    private async toDtos(tx: Tx, tenantId: number, rows: AiAgentRow[]): Promise<AiAgentDto[]> {
        const ids = rows.map((r) => r.id);
        const listsBy = await this.liveLists(tx, tenantId, ids);
        const tz = this.timeZones ? await this.timeZones.orUtc(tenantId, tx) : 'UTC';
        const now = new Date();
        const dayStart = agentDayStart(now, tz);
        const monthStart = agentMonthStart(now);
        const usage = await tx
            .select({
                agentId: aiAgentRuns.agentId,
                runsToday: sql<number>`count(*) filter (where ${aiAgentRuns.createdAt} >= ${dayStart.toISOString()}::timestamptz and not ${aiAgentRuns.simulated} and ${aiAgentRuns.status} <> 'skipped')`,
                tokensMonth: sql<string>`coalesce(sum(${aiAgentRuns.inputTokens} + ${aiAgentRuns.outputTokens}), 0)`,
            })
            .from(aiAgentRuns)
            .where(and(eq(aiAgentRuns.tenantId, tenantId), inArray(aiAgentRuns.agentId, ids), gte(aiAgentRuns.createdAt, monthStart < dayStart ? monthStart : dayStart)))
            .groupBy(aiAgentRuns.agentId);
        const usageBy = new Map(usage.map((u) => [u.agentId, { runs_today: Number(u.runsToday), tokens_month: Number(u.tokensMonth) }]));
        const last = await tx.execute<{ agent_id: string; id: string; status: string; created_at: Date | string; error: string | null }>(sql`
            select distinct on (agent_id) agent_id, id, status, created_at, error
              from ai_agent_runs
             where tenant_id = ${tenantId} and agent_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and not simulated
             order by agent_id, id desc`);
        const lastBy = new Map(
            last.rows.map((r) => [Number(r.agent_id), { id: Number(r.id), status: r.status as AiAgentRunStatus, at: new Date(r.created_at).toISOString(), error: r.error }]),
        );
        const pending = await tx
            .select({ agentId: aiAgentProposals.agentId, n: sql<number>`count(*)` })
            .from(aiAgentProposals)
            .innerJoin(records, eq(records.id, aiAgentProposals.recordId))
            .where(and(eq(aiAgentProposals.tenantId, tenantId), eq(aiAgentProposals.status, 'pending'), inArray(aiAgentProposals.agentId, ids)))
            .groupBy(aiAgentProposals.agentId);
        const pendingBy = new Map(pending.map((p) => [p.agentId, Number(p.n)]));
        const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((n): n is number => n !== null))];
        const owners = ownerIds.length
            ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ownerIds))
            : [];
        const ownerBy = new Map(owners.map((o) => [o.id, o.name || o.email]));
        const triggers = await this.triggersFor(tx, tenantId, ids);
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            color: r.color,
            icon: r.icon,
            instructions: r.instructions,
            list_ids: (listsBy.get(r.id) ?? []).map((l) => l.id),
            lists: listsBy.get(r.id) ?? [],
            tools: orderedTools((Array.isArray(r.tools) ? r.tools : []) as AiAgentTool[]),
            mode: r.mode as AiAgentMode,
            settings: readAiAgentSettings(r.settings),
            max_steps: r.maxSteps,
            max_runs_per_day: r.maxRunsPerDay,
            monthly_token_budget: r.monthlyTokenBudget === null ? null : Number(r.monthlyTokenBudget),
            owner: r.ownerId ? { id: r.ownerId, name: ownerBy.get(r.ownerId) ?? 'Alguien' } : null,
            is_active: r.isActive,
            paused_reason: r.pausedReason,
            usage: usageBy.get(r.id) ?? { runs_today: 0, tokens_month: 0 },
            triggers: triggers.get(r.id) ?? [],
            last_run: lastBy.get(r.id) ?? null,
            pending_proposals: pendingBy.get(r.id) ?? 0,
            created_at: r.createdAt.toISOString(),
            updated_at: r.updatedAt.toISOString(),
        }));
    }

    /** Las automatizaciones (vivas) que le piden trabajo a cada agente. */
    private async triggersFor(tx: Tx, tenantId: number, agentIds: number[]): Promise<Map<number, AiAgentTriggerDto[]>> {
        const out = new Map<number, AiAgentTriggerDto[]>();
        const rows = await tx
            .select({ a: automations, listSlug: lists.slug, listName: lists.name })
            .from(automations)
            .innerJoin(lists, eq(lists.id, automations.listId))
            .where(and(eq(automations.tenantId, tenantId), sql`${automations.actions}::text like '%ask_agent%'`))
            .orderBy(automations.id);
        const wanted = new Set(agentIds);
        for (const { a, listSlug, listName } of rows) {
            for (const agentId of agentIdsInActions(a.actions)) {
                if (!wanted.has(agentId)) continue;
                const managed = isManagedAgentAutomation(a.actions, agentId);
                const first = Array.isArray(a.actions) ? (a.actions as Array<{ config?: unknown }>)[0] : undefined;
                const cfg = (a.triggerConfig ?? {}) as Record<string, unknown>;
                const arr = out.get(agentId) ?? [];
                arr.push({
                    automation_id: a.id,
                    automation_name: a.name,
                    list_id: a.listId,
                    list_slug: listSlug,
                    list_name: listName,
                    trigger_type: a.triggerType,
                    is_active: a.isActive,
                    managed,
                    instruction: managed && first ? readAskAgentConfig(first.config).instruction : '',
                    changed_fields: Array.isArray(cfg.changed_fields) ? (cfg.changed_fields as unknown[]).map(String) : [],
                });
                out.set(agentId, arr);
            }
        }
        return out;
    }

    private async recordVersion(tx: Tx, tenantId: number, agentId: number, authorId: number | null, note: string): Promise<void> {
        const row = await this.rowOrThrow(tx, tenantId, agentId);
        const listRows = await tx.select({ listId: aiAgentLists.listId }).from(aiAgentLists).where(and(eq(aiAgentLists.tenantId, tenantId), eq(aiAgentLists.agentId, agentId)));
        await tx.insert(aiAgentVersions).values({
            tenantId,
            agentId,
            authorId,
            note,
            snapshot: {
                name: row.name,
                description: row.description,
                color: row.color,
                icon: row.icon,
                instructions: row.instructions,
                list_ids: listRows.map((l) => l.listId),
                tools: row.tools,
                mode: row.mode,
                settings: readAiAgentSettings(row.settings),
                max_steps: row.maxSteps,
                max_runs_per_day: row.maxRunsPerDay,
                monthly_token_budget: row.monthlyTokenBudget === null ? null : Number(row.monthlyTokenBudget),
                is_active: row.isActive,
            },
        });
        // Sólo las últimas N.
        await tx.execute(sql`
            delete from ai_agent_versions
             where agent_id = ${agentId}
               and id not in (select id from ai_agent_versions where agent_id = ${agentId} order by id desc limit ${AI_AGENT_VERSIONS_KEPT})`);
    }
}

function orderedTools(tools: readonly string[]): AiAgentTool[] {
    return AI_AGENT_TOOLS.filter((t) => tools.includes(t));
}

/** Los comentarios para el cliente sólo tienen sentido si el agente comenta. */
function normalizedSettings(raw: unknown, tools: readonly string[]): Record<string, unknown> {
    const s = readAiAgentSettings(raw);
    return { ...s, client_comments: s.client_comments && tools.includes('comment'), reviewer_user_ids: [...new Set(s.reviewer_user_ids)] };
}

export function agentNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'agent_not_found', message: `El agente ${id} no existe.`, data: { status: 404 } });
}
