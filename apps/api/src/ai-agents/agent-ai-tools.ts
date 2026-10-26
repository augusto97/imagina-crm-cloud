import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
    AI_AGENT_DEFAULTS,
    AI_AGENT_MAX_STEPS,
    AI_AGENT_MODES,
    AI_AGENT_MODE_LABELS,
    AI_AGENT_QUICK_TRIGGERS,
    AI_AGENT_QUICK_TRIGGER_LABELS,
    AI_AGENT_TOOLS,
    AI_AGENT_TOOL_META,
    type AiAgentMode,
    type AiAgentQuickTrigger,
    type AiAgentTool,
    type AiProposal,
    type AiProposalKind,
    type List,
} from '@imagina-base/shared';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ProposalsStore, type AiApplyOutcome, type AiProposalApplier, type StoredProposal } from '../ai/proposals.store';
import { AiToolError, AiToolRegistry, type AiToolContext, type AiToolResult } from '../ai/tools/registry';
import { FieldsService } from '../fields/fields.service';
import { effectivePermissions } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { AiAgentsService } from './ai-agents.service';

/**
 * E6 — Los agentes de IA en el asistente y el MCP (ADR-S67): `get_list_schema`
 * cuenta qué agentes trabajan en la lista (para usarlos con la acción
 * `ask_agent` de una automatización) y `propose_create_ai_agent` arma uno con
 * su «Cuándo trabaja». Mismo contrato que el resto: proponer NO escribe;
 * aplicar pasa por `AiAgentsService` con el acceso de quien aplica.
 *
 * Vive en este módulo (y no en el del asistente) para no atar los dos: se
 * suma al registro de herramientas al arrancar.
 */

const triggerSpec = z.object({
    list: z.string().max(63).describe('Slug de una de las listas del agente'),
    trigger: z
        .enum(AI_AGENT_QUICK_TRIGGERS)
        .describe('record_created = cuando se crea un registro; record_updated = cuando cambia; form_submitted = cuando se envía un formulario de la lista; checklist_completed = cuando se completa un checklist'),
    changed_fields: z.array(z.string().max(63)).max(20).optional().describe('record_updated: sólo si cambia alguno de estos campos (slugs)'),
    instruction: z.string().max(1000).optional().describe('Instrucción extra para esa vez (admite variables {{slug}})'),
});

const agentSpec = z.object({
    name: z.string().min(1).max(80).describe('Nombre corto («Clasificador de tickets»)'),
    description: z.string().max(500).optional(),
    instructions: z
        .string()
        .min(1)
        .max(6000)
        .describe('Qué hace el agente, paso a paso y en lenguaje natural (qué lee, qué decide, qué campos cambia y con qué valores, qué nota deja)'),
    lists: z.array(z.string().max(63)).min(1).max(20).describe('Slugs de las listas en las que trabaja'),
    tools: z
        .array(z.enum(AI_AGENT_TOOLS))
        .min(1)
        .describe(
            'Herramientas que puede usar (sólo las necesarias): read_record, search_records, update_fields, create_records, comment, assign, request_approval, send_email (send_email sale de la app: sólo si se pidió).',
        ),
    mode: z.enum(AI_AGENT_MODES).default('propose').describe('propose = deja los cambios como propuesta para que una persona los apruebe (recomendado); act = hace los cambios solo'),
    max_steps: z.number().int().min(1).max(AI_AGENT_MAX_STEPS).optional(),
    when: z.array(triggerSpec).max(5).optional().describe('Cuándo trabaja (crea una automatización con la acción «Pedirle a un agente» por cada uno)'),
});
type AgentSpec = z.infer<typeof agentSpec>;

interface Payload {
    kind: 'create_ai_agent';
    agent: {
        name: string;
        description: string;
        instructions: string;
        list_ids: number[];
        tools: AiAgentTool[];
        mode: AiAgentMode;
        max_steps: number;
    };
    triggers: Array<{ list_id: number; trigger_type: AiAgentQuickTrigger; changed_fields: string[]; instruction: string }>;
}

@Injectable()
export class AgentAiTools implements AiProposalApplier, OnModuleInit {
    static readonly KINDS: ReadonlySet<AiProposalKind> = new Set(['create_ai_agent']);

    constructor(
        private readonly agents: AiAgentsService,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        @Optional() private readonly registry?: AiToolRegistry,
        @Optional() private readonly store?: ProposalsStore,
    ) {}

    onModuleInit(): void {
        if (!this.registry) return;
        this.registerInto(this.registry);
    }

    registerInto(registry: AiToolRegistry): void {
        if (registry.get('propose_create_ai_agent')) return;
        registry.register({
            name: 'propose_create_ai_agent',
            label: 'Preparando el agente de IA',
            description:
                'Propone crear un AGENTE DE IA: un compañero con una tarea en lenguaje natural que trabaja sobre los registros de unas listas con herramientas curadas, con el acceso de quien lo crea (nunca más). ' +
                'Ejemplos: clasificar cada ticket nuevo y ponerle prioridad, resumir el caso al cerrarlo, completar datos faltantes, sugerir una respuesta al cliente, asignar por tema. ' +
                'Escribe `instructions` concretas (qué campos mira, qué valores pone, cuándo no hace nada). Por defecto propone los cambios (mode propose) y una persona los aprueba en la ficha. ' +
                '`when` arma «Cuándo trabaja» (record_created, record_updated con changed_fields, form_submitted, checklist_completed); para cualquier otro disparador, propón después una automatización con la acción ask_agent {agent_id}. Lee antes get_list_schema de cada lista.',
            capability: 'manage_ai_agents',
            input: agentSpec,
            run: (ctx, input) => this.propose(ctx, input as AgentSpec),
        });
        registry.registerApplier(AgentAiTools.KINDS, this);
        registry.addListSchemaExtra((ctx, list) => this.schemaExtra(ctx, list));
    }

    // ── get_list_schema ──────────────────────────────────────────────────

    private async schemaExtra(ctx: AiToolContext, list: { id: number }): Promise<Record<string, unknown>> {
        const agents = await this.agents.forList(ctx.tenantId, list.id).catch(() => []);
        return {
            ai_agents: {
                _nota:
                    'Agentes de IA que trabajan en esta lista. Para que uno trabaje en otro momento, usa en una automatización la acción ask_agent {agent_id, instruction?}. Se crean con propose_create_ai_agent.',
                agents: agents.map((a) => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                    mode: a.mode,
                    is_active: a.is_active,
                    tools: a.tools,
                    when: a.triggers
                        .filter((t) => t.list_id === list.id)
                        .map((t) => ({ automation_id: t.automation_id, automation: t.automation_name, trigger: t.trigger_type, active: t.is_active })),
                })),
            },
        };
    }

    // ── Proponer ─────────────────────────────────────────────────────────

    private async propose(ctx: AiToolContext, input: AgentSpec): Promise<AiToolResult> {
        if (!this.store) throw new AiToolError('Las propuestas no están disponibles.');
        const resolved: List[] = [];
        for (const slug of [...new Set(input.lists)]) {
            let list: List;
            try {
                list = await this.lists.get(ctx.tenantId, slug);
            } catch {
                throw new AiToolError(`La lista «${slug}» no existe. Usa los slugs de list_lists.`);
            }
            if (effectivePermissions(list.settings, ctx).view === 'none') {
                throw new AiToolError(`La persona no tiene acceso a «${list.name}»: un agente no puede trabajar ahí.`);
            }
            resolved.push(list);
        }
        const tools = [...new Set(input.tools)];
        const subject = { role: ctx.role, capabilities: ctx.capabilities };
        const denied = tools.filter((t) => !AiAgentsService.ownerCanUse(subject, t));
        if (denied.length > 0) {
            throw new AiToolError(
                `El rol de la persona no permite: ${denied.map((t) => AI_AGENT_TOOL_META[t].label).join(', ')}. Quítalas: el agente nunca puede más que quien lo crea.`,
            );
        }
        const triggers: Payload['triggers'] = [];
        for (const w of input.when ?? []) {
            const list = resolved.find((l) => l.slug === w.list);
            if (!list) throw new AiToolError(`«${w.list}» no está entre las listas del agente (lists).`);
            const changed = w.trigger === 'record_updated' ? [...new Set(w.changed_fields ?? [])] : [];
            if (changed.length > 0) {
                const fields = await this.fields.listByListId(ctx.tenantId, list.id);
                const unknown = changed.filter((s) => !fields.some((f) => f.slug === s));
                if (unknown.length > 0) {
                    throw new AiToolError(`Campos desconocidos en «${list.name}»: ${unknown.join(', ')}. Válidos: ${fields.map((f) => f.slug).join(', ')}.`);
                }
            }
            triggers.push({ list_id: list.id, trigger_type: w.trigger, changed_fields: changed, instruction: (w.instruction ?? '').trim() });
        }
        const payload: Payload = {
            kind: 'create_ai_agent',
            agent: {
                name: input.name.trim(),
                description: (input.description ?? '').trim(),
                instructions: input.instructions.trim(),
                list_ids: resolved.map((l) => l.id),
                tools,
                mode: input.mode,
                max_steps: input.max_steps ?? AI_AGENT_DEFAULTS.max_steps,
            },
            triggers,
        };
        const listName = (id: number): string => resolved.find((l) => l.id === id)?.name ?? `#${id}`;
        const writes = tools.filter((t) => AI_AGENT_TOOL_META[t].writes);
        const proposal: AiProposal = {
            id: randomBytes(9).toString('base64url'),
            kind: 'create_ai_agent',
            title: `Crear el agente de IA «${payload.agent.name}»`,
            summary:
                `Trabaja en ${resolved.map((l) => `«${l.name}»`).join(', ')} · ${AI_AGENT_MODE_LABELS[input.mode]}` +
                (triggers.length > 0 ? ` · ${triggers.length} disparador${triggers.length === 1 ? '' : 'es'}` : ' · sin disparadores (se le pide trabajo desde una automatización)'),
            destructive: input.mode === 'act' && writes.length > 0,
            list_slug: resolved[0]?.slug ?? null,
            preview: {
                lists: [],
                fields: [],
                widgets: [],
                automation: null,
                changes: [
                    { label: 'Modo', from: null, to: AI_AGENT_MODE_LABELS[input.mode] },
                    { label: 'Herramientas', from: null, to: tools.map((t) => AI_AGENT_TOOL_META[t].label).join(', ') },
                    { label: 'Pasos por corrida', from: null, to: String(payload.agent.max_steps) },
                ],
                affected_count: 0,
                rows: [],
                blocks: [
                    { type: 'Tarea', label: payload.agent.instructions.slice(0, 160) + (payload.agent.instructions.length > 160 ? '…' : ''), detail: null },
                    ...triggers.map((t) => ({
                        type: 'Cuándo trabaja',
                        label: AI_AGENT_QUICK_TRIGGER_LABELS[t.trigger_type],
                        detail: `${listName(t.list_id)}${t.changed_fields.length > 0 ? ` · si cambia ${t.changed_fields.join(', ')}` : ''}`,
                    })),
                ],
            },
            applied: false,
            result: null,
            created_at: new Date().toISOString(),
        };
        await this.store.save({
            proposal,
            kind: 'create_ai_agent',
            payload,
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            capability: 'manage_ai_agents',
            conversationId: ctx.conversationId ?? null,
        });
        return {
            content: {
                ok: true,
                proposal_id: proposal.id,
                title: proposal.title,
                note: 'La propuesta quedó lista como TARJETA para la persona. No la apliques tú ni digas que ya está hecho: cuéntale brevemente qué contiene y que puede aplicarla con el botón.',
            },
            proposal,
        };
    }

    // ── Aplicar ──────────────────────────────────────────────────────────

    async apply(ctx: AiToolContext, stored: StoredProposal): Promise<AiApplyOutcome> {
        const p = stored.payload as Payload;
        const editor = { userId: ctx.userId, role: ctx.role, teamIds: ctx.teamIds, customRoleId: ctx.customRoleId, capabilities: ctx.capabilities };
        const agent = await this.agents.create(ctx.tenantId, editor, {
            name: p.agent.name,
            description: p.agent.description,
            color: null,
            icon: null,
            instructions: p.agent.instructions,
            list_ids: p.agent.list_ids,
            tools: p.agent.tools,
            mode: p.agent.mode,
            settings: { client_comments: false, reviewer_user_ids: [] },
            max_steps: p.agent.max_steps,
            max_runs_per_day: AI_AGENT_DEFAULTS.max_runs_per_day,
            monthly_token_budget: AI_AGENT_DEFAULTS.monthly_token_budget,
            is_active: true,
        });
        const warnings: string[] = [];
        for (const t of p.triggers) {
            try {
                await this.agents.addTrigger(ctx.tenantId, editor, agent.id, t);
            } catch (err) {
                warnings.push(`No se pudo armar «${AI_AGENT_QUICK_TRIGGER_LABELS[t.trigger_type]}»: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return {
            message: `Se creó el agente «${agent.name}».`,
            links: [{ label: 'Abrir el agente', href: `/agents/${agent.id}` }],
            warnings,
        };
    }
}
