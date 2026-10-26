import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
    AI_AGENT_MAX_CREATES_PER_RUN,
    AI_AGENT_MAX_WRITES_PER_RUN,
    AI_AGENT_TOOL_META,
    agentClip,
    filterOperatorSchema,
    isUserWritableType,
    jsonbKeyForField,
    readStoreListMarker,
    resolveTitleFieldId,
    type ActivityDto,
    type AiAgentMode,
    type AiAgentProposalItem,
    type AiAgentStepKind,
    type AiAgentTool,
    type Field,
    type List,
    type RecordDto,
} from '@imagina-base/shared';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ActivityService } from '../activity/activity.service';
import { displayValue, mapOptionValue } from '../ai/tools/data-tools';
import { rulesToFilterTree, type FilterRuleSpec } from '../ai/tools/structure-tools';
import type { ApprovalsService } from '../approvals/approvals.service';
import type { AutomationChain } from '../automations/automation-dispatcher.service';
import type { CommentsService } from '../comments/comments.service';
import type { Tx } from '../db/client';
import { memberships, records, teams, users } from '../db/schema';
import { assignmentKeys } from '../lists/list-acl';
import type { ListsService } from '../lists/lists.service';
import type { MailService } from '../mail/mail.service';
import type { RecordsService, Actor } from '../records/records.service';
import type { TenantDb } from '../tenancy/tenant-db.service';
import { asData, clipValue } from './agent-prompt';

/**
 * E6 — Las herramientas de un agente de IA (ADR-S67), con el acceso de su
 * DUEÑO. Una instancia por corrida (lleva la cuenta de escrituras y junta la
 * propuesta). Ninguna herramienta escribe por un camino propio: leer va por
 * `RecordsService.get/list`, cambiar por `RecordsService.update/create` (en
 * «propone», por `checkUpdate/checkCreate`, que hacen los MISMOS chequeos sin
 * escribir), comentar por `CommentsService`, pedir aprobación por
 * `ApprovalsService` y el correo por `MailService` (cuota de correos y correo
 * de la empresa incluidos). Lo que el ACL, el validador o la tienda rechazan
 * vuelve al modelo como error corregible.
 */

export interface AgentToolboxDeps {
    tenantDb: TenantDb;
    lists: ListsService;
    records: RecordsService;
    comments: CommentsService;
    activity: ActivityService;
    approvals?: ApprovalsService | null;
    mail?: MailService | null;
}

export interface AgentRunScope {
    tenantId: number;
    agent: { id: number; name: string; tools: readonly AiAgentTool[]; clientComments: boolean };
    /** El dueño con su ACL completo y el id del agente (la actividad lo nombra). */
    owner: Actor & { agentId: number };
    /** Listas en las que trabaja (vivas). */
    listIds: ReadonlySet<number>;
    /** Lista y registro de la corrida. */
    listId: number;
    recordId: number | null;
    mode: AiAgentMode;
    /** «Probar»: no escribe ni deja propuesta. */
    simulate: boolean;
    /** La cadena de la automatización que lo disparó (anti-bucle). */
    chain?: AutomationChain;
}

/** Un cambio guardado en una propuesta: el payload ya validado + lo que se ve. */
export type StoredAgentChange =
    | {
          kind: 'update_fields';
          list_id: number;
          record_id: number;
          patch: Record<string, unknown>;
          before: Record<string, unknown>;
          /** `f{id}` → nombre del campo (para decir qué se salteó al aplicar). */
          labels: Record<string, string>;
          title: string;
          lines: AiAgentProposalItem['lines'];
      }
    | { kind: 'create_record'; list_id: number; data: Record<string, unknown>; title: string; lines: AiAgentProposalItem['lines'] }
    | { kind: 'comment'; list_id: number; record_id: number; body: string; visibility: 'internal' | 'client'; title: string; lines: AiAgentProposalItem['lines'] }
    | { kind: 'request_approval'; list_id: number; record_id: number; flow_id: number; flow_name: string; note: string; title: string; lines: AiAgentProposalItem['lines'] }
    | { kind: 'send_email'; list_id: number; record_id: number | null; to: string[]; subject: string; body: string; title: string; lines: AiAgentProposalItem['lines'] };

export interface ToolOutcome {
    content: unknown;
    isError: boolean;
    kind: AiAgentStepKind;
    /** Una línea para el historial. */
    summary: string;
}

/** Error que vuelve al MODELO (corregible) y al historial. */
export class AgentToolError extends Error {}

interface ListCtx {
    list: List;
    fields: Field[];
    /** Los que su dueño ve. */
    visible: Field[];
    bySlug: Map<string, Field>;
    titleFieldId: number | null;
}

// ─────────────────────────── Esquemas de entrada ───────────────────────────

const recordIdSpec = z.number().int().positive().optional().describe('Id del registro (sin él, el registro sobre el que te pidieron trabajar)');
const valuesSpec = z
    .record(z.unknown())
    .describe('Mapa slug → valor. Selección: value o etiqueta de una opción; fechas AAAA-MM-DD; casilla true/false; persona: id numérico.');

const filterSpec = z.object({
    field: z.string().max(63).describe('Slug del campo'),
    op: filterOperatorSchema,
    value: z.unknown().optional(),
});

export const AGENT_TOOL_INPUTS: Record<AiAgentTool, ZodTypeAny> = {
    read_record: z.object({
        record_id: recordIdSpec,
        include: z
            .array(z.enum(['linked', 'comments', 'history']))
            .max(3)
            .optional()
            .describe('Qué más traer: registros vinculados, comentarios, historial de cambios'),
    }),
    search_records: z.object({
        list: z.string().max(63).optional().describe('Slug de la lista (sin él, la del registro)'),
        query: z.string().max(200).optional().describe('Texto libre'),
        filters: z.array(filterSpec).max(5).optional().describe('Condiciones (AND)'),
        limit: z.number().int().min(1).max(20).default(10),
    }),
    update_fields: z.object({ record_id: recordIdSpec, values: valuesSpec }),
    create_records: z.object({
        list: z.string().max(63).optional().describe('Slug de la lista (sin él, la del registro)'),
        records: z.array(valuesSpec).min(1).max(5),
    }),
    comment: z.object({
        record_id: recordIdSpec,
        body: z.string().trim().min(1).max(4000),
        visibility: z.enum(['internal', 'client']).optional().describe('internal (default): nota interna; client: la ve el cliente en su portal'),
    }),
    assign: z.object({
        record_id: recordIdSpec,
        field: z.string().max(63).optional().describe('Slug del campo de persona o equipo (sin él, el de asignación de la lista)'),
        user_id: z.number().int().positive().optional().describe('Id de la persona'),
        team_id: z.number().int().positive().optional().describe('Id del equipo'),
    }),
    request_approval: z.object({
        record_id: recordIdSpec,
        flow: z.union([z.string().max(120), z.number().int().positive()]).describe('Id o nombre del flujo de aprobación de la lista'),
        note: z.string().trim().max(1000).default(''),
    }),
    send_email: z.object({
        to: z.array(z.string().email().max(254)).min(1).max(5).describe('Sólo el contacto del registro (sus campos de correo) o alguien del equipo'),
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(8000).describe('Texto plano'),
    }),
};

const TOOL_DESCRIPTIONS: Record<AiAgentTool, string> = {
    read_record: 'Lee un registro (por defecto el de la corrida) con sus valores legibles; con `include` trae sus vinculados, sus comentarios y su historial.',
    search_records: 'Busca registros en las listas donde trabajas (texto libre y/o filtros). Devuelve id, título y algunos campos.',
    update_fields: 'Cambia campos de un registro (por defecto el de la corrida). Pasa sólo los campos que cambian.',
    create_records: 'Crea registros nuevos (hasta 5 por llamada) en una de tus listas.',
    comment: 'Deja un comentario en un registro: nota interna por defecto.',
    assign: 'Asigna un registro a una persona (user_id) o a un equipo (team_id).',
    request_approval: 'Pide una aprobación del registro con uno de los flujos de su lista.',
    send_email: 'Manda un correo de texto. Sólo al contacto del registro (sus campos de correo) o a alguien del equipo.',
};

/** Definiciones para el modelo (sólo las herramientas ofrecidas). */
export function agentToolDefinitions(tools: readonly AiAgentTool[]): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    const convert = zodToJsonSchema as unknown as (s: ZodTypeAny, o: Record<string, unknown>) => Record<string, unknown>;
    return tools.map((t) => {
        const json = convert(AGENT_TOOL_INPUTS[t], { $refStrategy: 'none', target: 'jsonSchema7' });
        delete json.$schema;
        return { name: t, description: TOOL_DESCRIPTIONS[t], input_schema: json.type === 'object' ? json : { type: 'object', properties: {}, ...json } };
    });
}

/** Lo que necesita cada herramienta del DUEÑO (su ACL de lista decide además fila por fila). */
export const AGENT_TOOL_CAPABILITIES: Record<AiAgentTool, readonly string[]> = {
    read_record: ['view_records', 'view_own_records'],
    search_records: ['view_records', 'view_own_records'],
    update_fields: ['edit_records', 'edit_own_records'],
    assign: ['edit_records', 'edit_own_records'],
    create_records: ['create_records'],
    comment: ['view_records', 'view_own_records'],
    request_approval: ['edit_records', 'edit_own_records'],
    send_email: ['view_records', 'view_own_records'],
};

// ─────────────────────────── La caja de herramientas ───────────────────────────

export class AgentToolbox {
    /** Cambios juntados (modo «propone» o «Probar»). */
    readonly changes: StoredAgentChange[] = [];
    /** Lo que se escribió de verdad (modo «hace»), para el resumen de la corrida. */
    readonly applied: string[] = [];
    private writes = 0;
    private creates = 0;
    private readonly listCache = new Map<number, ListCtx>();
    private listsBySlug: Map<string, List> | null = null;
    private recordEmails: string[] | null = null;

    constructor(
        private readonly deps: AgentToolboxDeps,
        private readonly scope: AgentRunScope,
    ) {}

    /** ¿Se escribe de verdad? (no en «propone» ni en «Probar»). */
    private get writesForReal(): boolean {
        return this.scope.mode === 'act' && !this.scope.simulate;
    }

    /** Ejecuta una herramienta pedida por el modelo. Nunca lanza: todo vuelve como resultado. */
    async run(name: string, rawInput: unknown): Promise<ToolOutcome> {
        const tool = name as AiAgentTool;
        if (!(this.scope.agent.tools as readonly string[]).includes(name) || !AGENT_TOOL_INPUTS[tool]) {
            const msg = `La herramienta «${name}» no está permitida para este agente. Sólo puedes usar: ${this.scope.agent.tools.join(', ')}.`;
            return { content: { error: msg }, isError: true, kind: 'blocked', summary: msg };
        }
        const parsed = AGENT_TOOL_INPUTS[tool].safeParse(rawInput ?? {});
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`);
            return { content: { error: 'Parámetros inválidos', issues }, isError: true, kind: 'error', summary: `Parámetros inválidos: ${issues.join('; ')}` };
        }
        if (AI_AGENT_TOOL_META[tool].writes) {
            if (this.writes >= AI_AGENT_MAX_WRITES_PER_RUN) {
                const msg = `Se alcanzó el tope de ${AI_AGENT_MAX_WRITES_PER_RUN} escrituras por corrida: termina y resume lo hecho.`;
                return { content: { error: msg }, isError: true, kind: 'blocked', summary: msg };
            }
            this.writes += 1;
        }
        try {
            return await this.dispatch(tool, parsed.data as Record<string, unknown>);
        } catch (err) {
            const msg = describeError(err);
            const blocked = err instanceof ForbiddenException || err instanceof NotFoundException || (err instanceof AgentToolError && /alcance|no puede|no está permitid|oculto/i.test(msg));
            return { content: { error: msg }, isError: true, kind: blocked ? 'blocked' : 'error', summary: msg };
        }
    }

    private async dispatch(tool: AiAgentTool, input: Record<string, unknown>): Promise<ToolOutcome> {
        switch (tool) {
            case 'read_record':
                return this.readRecord(input as { record_id?: number; include?: Array<'linked' | 'comments' | 'history'> });
            case 'search_records':
                return this.searchRecords(input as { list?: string; query?: string; filters?: FilterRuleSpec[]; limit: number });
            case 'update_fields':
                return this.updateFields(input as { record_id?: number; values: Record<string, unknown> });
            case 'create_records':
                return this.createRecords(input as { list?: string; records: Array<Record<string, unknown>> });
            case 'comment':
                return this.comment(input as { record_id?: number; body: string; visibility?: 'internal' | 'client' });
            case 'assign':
                return this.assign(input as { record_id?: number; field?: string; user_id?: number; team_id?: number });
            case 'request_approval':
                return this.requestApproval(input as { record_id?: number; flow: string | number; note: string });
            case 'send_email':
                return this.sendEmail(input as { to: string[]; subject: string; body: string });
        }
    }

    // ── Contexto ─────────────────────────────────────────────────────────

    /** La lista con los campos que su DUEÑO ve (ocultos y derivados restringidos afuera). */
    async listCtx(listId: number): Promise<ListCtx> {
        const cached = this.listCache.get(listId);
        if (cached) return cached;
        if (!this.scope.listIds.has(listId)) {
            throw new AgentToolError('Esa lista está fuera del alcance de este agente: sólo trabaja en las listas que tiene asignadas.');
        }
        const ctx = await this.deps.records.readScoped(this.scope.tenantId, this.scope.owner, String(listId), async (_tx, s) => {
            const visible = s.fields.filter((f) => !s.hiddenIds.has(f.id));
            const titleFieldId = resolveTitleFieldId(
                s.fields.map((f) => ({ id: f.id, type: f.type as never })),
                (s.list.settings ?? {}) as Record<string, unknown>,
            );
            return { list: s.list, fields: s.fields, visible, bySlug: new Map(visible.map((f) => [f.slug, f])), titleFieldId };
        });
        this.listCache.set(listId, ctx);
        return ctx;
    }

    private async listBySlug(slug: string | undefined): Promise<ListCtx> {
        if (!slug) return this.listCtx(this.scope.listId);
        if (!this.listsBySlug) {
            const all = await this.deps.lists.list(this.scope.tenantId);
            this.listsBySlug = new Map(all.filter((l) => this.scope.listIds.has(l.id)).map((l) => [l.slug, l]));
        }
        const list = this.listsBySlug.get(slug);
        if (!list) {
            throw new AgentToolError(
                `La lista «${slug}» está fuera del alcance de este agente. Sus listas: ${[...this.listsBySlug.keys()].join(', ') || '(ninguna)'}.`,
            );
        }
        return this.listCtx(list.id);
    }

    /** El registro pedido (por defecto, el de la corrida) y su lista — siempre dentro del alcance. */
    private async target(recordId: number | undefined): Promise<{ ctx: ListCtx; recordId: number }> {
        const id = recordId ?? this.scope.recordId;
        if (!id) throw new AgentToolError('Esta corrida no tiene un registro: pasa record_id.');
        if (id === this.scope.recordId) return { ctx: await this.listCtx(this.scope.listId), recordId: id };
        const [row] = await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx) =>
            tx
                .select({ listId: records.listId })
                .from(records)
                .where(and(eq(records.tenantId, this.scope.tenantId), eq(records.id, id), isNull(records.deletedAt)))
                .limit(1),
        );
        if (!row) throw new AgentToolError(`El registro #${id} no existe.`);
        if (!this.scope.listIds.has(row.listId)) {
            throw new AgentToolError(`El registro #${id} está en una lista fuera del alcance de este agente.`);
        }
        return { ctx: await this.listCtx(row.listId), recordId: id };
    }

    /** Los valores que ve su dueño, por slug y legibles. */
    private readable(ctx: ListCtx, rec: RecordDto, opts: { all?: boolean } = {}): Record<string, unknown> {
        const out: Record<string, unknown> = { id: rec.id };
        for (const f of ctx.visible) {
            if (f.type === 'relation' || f.type === 'button') continue;
            const v = rec.data[jsonbKeyForField(f.id)];
            if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
                if (opts.all && isUserWritableType(f.type)) out[f.slug] = null;
                continue;
            }
            out[f.slug] = clipValue(v);
            if (f.type === 'select' || f.type === 'multi_select' || f.type === 'checkbox') {
                const label = displayValue(f, v);
                if (label !== String(v)) out[`${f.slug}_etiqueta`] = label;
            }
        }
        if (rec.parent_id) out.subtarea_de = rec.parent_id;
        return out;
    }

    private titleOf(ctx: ListCtx, rec: RecordDto): string {
        const raw = ctx.titleFieldId !== null ? rec.data[jsonbKeyForField(ctx.titleFieldId)] : null;
        return typeof raw === 'string' && raw.trim() !== '' ? raw.trim().slice(0, 120) : `Registro #${rec.id}`;
    }

    /** Valores del modelo (por slug) → `f{id}`, con el validador de cada campo; un campo oculto o calculado es error. */
    private toPatch(ctx: ListCtx, values: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        const hiddenOrUnknown: string[] = [];
        for (const [slug, raw] of Object.entries(values)) {
            const f = ctx.bySlug.get(slug);
            if (!f) {
                hiddenOrUnknown.push(slug);
                continue;
            }
            if (!isUserWritableType(f.type) || f.type === 'relation' || f.type === 'file') {
                throw new AgentToolError(`El campo «${slug}» (${f.type}) no se escribe a mano: no lo puedes cambiar.`);
            }
            out[jsonbKeyForField(f.id)] = mapOptionValue(f, raw);
        }
        if (hiddenOrUnknown.length > 0) {
            throw new AgentToolError(
                `Estos campos no existen o están ocultos para el dueño del agente: ${hiddenOrUnknown.join(', ')}. Campos que puedes usar: ${[...ctx.bySlug.keys()].join(', ')}.`,
            );
        }
        if (Object.keys(out).length === 0) throw new AgentToolError('No pasaste ningún campo para cambiar.');
        return out;
    }

    private lines(ctx: ListCtx, patch: Record<string, unknown>, before: Record<string, unknown> | null): AiAgentProposalItem['lines'] {
        const byKey = new Map(ctx.fields.map((f) => [jsonbKeyForField(f.id), f]));
        return Object.entries(patch).map(([k, v]) => {
            const f = byKey.get(k);
            const from = before ? before[k] : undefined;
            return {
                label: f?.label ?? k,
                from: before === null ? null : f ? displayValue(f, from) || '(vacío)' : String(from ?? ''),
                to: f ? displayValue(f, v) || '(vacío)' : String(v ?? ''),
            };
        });
    }

    private actorWithChain(): Actor {
        return this.scope.owner;
    }

    // ── Leer ─────────────────────────────────────────────────────────────

    private async readRecord(input: { record_id?: number; include?: Array<'linked' | 'comments' | 'history'> }): Promise<ToolOutcome> {
        const { ctx, recordId } = await this.target(input.record_id);
        const rec = await this.deps.records.get(this.scope.tenantId, this.scope.owner, String(ctx.list.id), recordId);
        const payload: Record<string, unknown> = { registro: this.readable(ctx, rec, { all: true }) };
        const include = new Set(input.include ?? []);
        if (include.has('linked')) payload.vinculados = await this.linked(ctx, rec);
        if (include.has('comments')) {
            const comments = await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx) => this.deps.comments.listInTx(tx, this.scope.tenantId, recordId, 30));
            payload.comentarios = comments.slice(-15).map((c) => ({
                autor: c.author_name ?? c.user_name ?? 'Alguien',
                ...(c.visibility === 'client' ? { visible_para_el_cliente: true } : {}),
                fecha: c.created_at.slice(0, 16),
                texto: agentClip(c.body, 600),
            }));
        }
        if (include.has('history')) {
            const page = await this.deps.activity.list(this.scope.tenantId, String(ctx.list.id), {
                recordId,
                limit: 15,
                viewer: this.scope.owner,
            });
            payload.historial = page.data.map((a) => historyLine(a, ctx.fields));
        }
        return { content: asData(payload), isError: false, kind: 'read', summary: `Leyó «${this.titleOf(ctx, rec)}»${include.size > 0 ? ` (${[...include].join(', ')})` : ''}` };
    }

    private async linked(ctx: ListCtx, rec: RecordDto): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        for (const f of ctx.visible.filter((x) => x.type === 'relation')) {
            const ids = (rec.relations?.[jsonbKeyForField(f.id)] ?? []).slice(0, 10);
            if (ids.length === 0) continue;
            const targetListId = Number((f.config as { target_list_id?: unknown }).target_list_id);
            if (!this.scope.listIds.has(targetListId)) {
                out[f.slug] = `${ids.length} registro(s) en una lista fuera del alcance del agente`;
                continue;
            }
            const other = await this.listCtx(targetListId);
            const page = await this.deps.records.list(this.scope.tenantId, this.scope.owner, String(targetListId), { limit: 10, ids: ids.join(','), sort_dir: 'asc' } as never);
            out[f.slug] = page.data.map((r) => ({ id: r.id, titulo: this.titleOf(other, r) }));
        }
        return out;
    }

    private async searchRecords(input: { list?: string; query?: string; filters?: FilterRuleSpec[]; limit: number }): Promise<ToolOutcome> {
        const ctx = await this.listBySlug(input.list);
        const filters = (input.filters ?? []).map((r) => {
            const f = ctx.bySlug.get(r.field);
            if (!f) throw new AgentToolError(`El campo «${r.field}» no existe o está oculto. Campos: ${[...ctx.bySlug.keys()].join(', ')}.`);
            return { ...r, value: mapOptionValue(f, r.value) };
        });
        const page = await this.deps.records.list(this.scope.tenantId, this.scope.owner, String(ctx.list.id), {
            limit: input.limit,
            sort_dir: 'desc',
            ...(input.query && input.query.trim() !== '' ? { search: input.query.trim() } : {}),
            ...(filters.length > 0 ? { filter_tree: rulesToFilterTree(filters, (slug) => ctx.bySlug.get(slug)!.id) } : {}),
        } as never);
        const shown = ctx.visible.filter((f) => isUserWritableType(f.type)).slice(0, 6);
        const rows = page.data.map((r) => {
            const row: Record<string, unknown> = { id: r.id, titulo: this.titleOf(ctx, r) };
            for (const f of shown) {
                const v = r.data[jsonbKeyForField(f.id)];
                if (v !== undefined && v !== null && v !== '') row[f.slug] = displayValue(f, v);
            }
            return row;
        });
        return {
            content: asData({ lista: ctx.list.slug, encontrados: rows.length, registros: rows }),
            isError: false,
            kind: 'read',
            summary: `Buscó en «${ctx.list.name}»: ${rows.length} resultado(s)`,
        };
    }

    // ── Escribir ─────────────────────────────────────────────────────────

    private async updateFields(input: { record_id?: number; values: Record<string, unknown> }, title?: string): Promise<ToolOutcome> {
        const { ctx, recordId } = await this.target(input.record_id);
        const patchIn = this.toPatch(ctx, input.values);
        // Los MISMOS chequeos que una edición (ACL de edición, validador,
        // unicidad, «obligatorio si», reglas de la tienda), sin escribir.
        const checked = await this.deps.records.checkUpdate(this.scope.tenantId, this.scope.owner, String(ctx.list.id), recordId, patchIn, {
            lenientRequired: this.scope.chain !== undefined,
        });
        const changed = Object.fromEntries(
            Object.entries(checked.patch).filter(([k, v]) => JSON.stringify(checked.before[k] ?? null) !== JSON.stringify(v ?? null)),
        );
        if (Object.keys(changed).length === 0) {
            return { content: { ok: true, nota: 'Esos campos ya tenían esos valores: no hay nada que cambiar.' }, isError: false, kind: 'read', summary: 'Nada que cambiar (ya tenía esos valores)' };
        }
        const lines = this.lines(ctx, changed, checked.before);
        const text = lines.map((l) => `${l.label}: ${l.from} → ${l.to}`).join('; ');
        const label = title ?? 'Cambiar campos';
        if (!this.writesForReal) {
            const labels = Object.fromEntries(Object.keys(changed).map((k) => [k, ctx.fields.find((f) => jsonbKeyForField(f.id) === k)?.label ?? k]));
            this.changes.push({ kind: 'update_fields', list_id: ctx.list.id, record_id: recordId, patch: changed, before: pick(checked.before, Object.keys(changed)), labels, title: label, lines });
            return {
                content: { ok: true, propuesto: true, nota: this.scope.simulate ? 'Prueba: no se escribió.' : 'Quedó en la propuesta para que una persona la aplique.' },
                isError: false,
                kind: this.scope.simulate ? 'simulated' : 'proposed',
                summary: `${this.scope.simulate ? 'Cambiaría' : 'Propone'}: ${text}`,
            };
        }
        await this.deps.records.update(this.scope.tenantId, this.actorWithChain(), String(ctx.list.id), recordId, { data: changed }, {
            ...(this.scope.chain ? { automationChain: this.scope.chain } : {}),
        });
        this.applied.push(text);
        return { content: { ok: true, cambiado: text }, isError: false, kind: 'write', summary: `Cambió ${text}` };
    }

    private async createRecords(input: { list?: string; records: Array<Record<string, unknown>> }): Promise<ToolOutcome> {
        const ctx = await this.listBySlug(input.list);
        if (this.creates + input.records.length > AI_AGENT_MAX_CREATES_PER_RUN) {
            throw new AgentToolError(`Una corrida crea como máximo ${AI_AGENT_MAX_CREATES_PER_RUN} registros.`);
        }
        if (readStoreListMarker(ctx.list.settings)) {
            throw new AgentToolError(`«${ctx.list.name}» es una lista de una tienda: sus registros nacen en la tienda, no se crean aquí.`);
        }
        const created: string[] = [];
        for (const values of input.records) {
            const data = this.toPatch(ctx, values);
            const checked = await this.deps.records.checkCreate(this.scope.tenantId, this.scope.owner, String(ctx.list.id), { data } as never, {
                lenientRequired: this.scope.chain !== undefined,
            });
            const lines = this.lines(ctx, checked.data, null);
            const titleField = ctx.titleFieldId !== null ? checked.data[jsonbKeyForField(ctx.titleFieldId)] : null;
            const name = typeof titleField === 'string' && titleField.trim() !== '' ? titleField.trim() : 'registro nuevo';
            this.creates += 1;
            if (!this.writesForReal) {
                this.changes.push({ kind: 'create_record', list_id: ctx.list.id, data: checked.data, title: `Nuevo registro en «${ctx.list.name}»: ${agentClip(name, 80)}`, lines });
                created.push(name);
                continue;
            }
            const rec = await this.deps.records.create(this.scope.tenantId, this.actorWithChain(), String(ctx.list.id), { data: checked.data } as never, {
                ...(this.scope.chain ? { automationChain: this.scope.chain, lenientRequired: true } : {}),
            });
            created.push(`${name} (#${rec.id})`);
            this.applied.push(`Creó «${name}» en «${ctx.list.name}»`);
        }
        const verb = this.writesForReal ? 'Creó' : this.scope.simulate ? 'Crearía' : 'Propone crear';
        return {
            content: { ok: true, ...(this.writesForReal ? { creados: created } : { propuesto: true }) },
            isError: false,
            kind: this.writesForReal ? 'write' : this.scope.simulate ? 'simulated' : 'proposed',
            summary: `${verb} ${created.length} registro(s) en «${ctx.list.name}»: ${created.map((c) => agentClip(c, 40)).join(', ')}`,
        };
    }

    private async comment(input: { record_id?: number; body: string; visibility?: 'internal' | 'client' }): Promise<ToolOutcome> {
        const { ctx, recordId } = await this.target(input.record_id);
        const visibility = input.visibility === 'client' ? 'client' : 'internal';
        if (visibility === 'client' && !this.scope.agent.clientComments) {
            throw new AgentToolError('Este agente no puede escribir comentarios visibles para el cliente: deja una nota interna.');
        }
        // Tiene que poder ver el registro (y comentar, lo chequea el servicio al escribir).
        const rec = await this.deps.records.get(this.scope.tenantId, this.scope.owner, String(ctx.list.id), recordId);
        const title = visibility === 'client' ? 'Comentario para el cliente' : 'Nota interna';
        const lines = [{ label: title, from: null, to: agentClip(input.body, 600) }];
        if (!this.writesForReal) {
            this.changes.push({ kind: 'comment', list_id: ctx.list.id, record_id: recordId, body: input.body, visibility, title, lines });
            return {
                content: { ok: true, propuesto: true },
                isError: false,
                kind: this.scope.simulate ? 'simulated' : 'proposed',
                summary: `${this.scope.simulate ? 'Dejaría' : 'Propone'} una ${visibility === 'client' ? 'respuesta al cliente' : 'nota interna'}: ${agentClip(input.body, 120)}`,
            };
        }
        await this.writeComment(this.scope.owner, ctx.list.id, recordId, input.body, visibility);
        this.applied.push(`Dejó una nota en «${this.titleOf(ctx, rec)}»`);
        return { content: { ok: true }, isError: false, kind: 'write', summary: `Dejó una ${visibility === 'client' ? 'respuesta al cliente' : 'nota interna'}: ${agentClip(input.body, 120)}` };
    }

    /** Escribe el comentario como el agente (autor: su dueño, con la marca del agente) y deja la actividad. */
    async writeComment(actor: Actor, listId: number, recordId: number, body: string, visibility: 'internal' | 'client'): Promise<void> {
        const c = await this.deps.comments.create(this.scope.tenantId, actor, String(listId), recordId, {
            body,
            kind: 'note',
            visibility,
            metadata: { agent: { id: this.scope.agent.id, name: this.scope.agent.name } },
        });
        await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx) =>
            this.deps.activity.logInTx(tx, {
                tenantId: this.scope.tenantId,
                listId,
                recordId,
                userId: actor.agentId && !actor.viaAgentProposal ? null : actor.userId,
                action: 'ai_agent',
                diff: { agent: { event: 'note', agent_id: this.scope.agent.id, agent_name: this.scope.agent.name, visibility, excerpt: agentClip(c.body, 160) } },
                agentId: this.scope.agent.id,
            }),
        );
    }

    private async assign(input: { record_id?: number; field?: string; user_id?: number; team_id?: number }): Promise<ToolOutcome> {
        const { ctx } = await this.target(input.record_id);
        if ((input.user_id === undefined) === (input.team_id === undefined)) {
            throw new AgentToolError('Pasa user_id (una persona) o team_id (un equipo), uno solo.');
        }
        const wantType = input.user_id !== undefined ? 'user' : 'team';
        let field: Field | undefined;
        if (input.field) {
            field = ctx.bySlug.get(input.field);
            if (!field || field.type !== wantType) {
                throw new AgentToolError(`«${input.field}» no es un campo de ${wantType === 'user' ? 'persona' : 'equipo'} que puedas usar.`);
            }
        } else {
            const keys = assignmentKeys((ctx.list.settings ?? {}) as Record<string, unknown>);
            const key = wantType === 'user' ? keys.user : keys.team;
            field = (key ? ctx.visible.find((f) => jsonbKeyForField(f.id) === key) : undefined) ?? ctx.visible.find((f) => f.type === wantType);
            if (!field) throw new AgentToolError(`La lista no tiene un campo de ${wantType === 'user' ? 'persona' : 'equipo'} para asignar.`);
        }
        let who = '';
        let value: unknown;
        if (input.user_id !== undefined) {
            const person = await this.member(input.user_id);
            if (!person) throw new AgentToolError(`La persona ${input.user_id} no es del equipo de esta empresa.`);
            who = person;
            value = input.user_id;
        } else {
            const team = await this.team(input.team_id!);
            if (!team) throw new AgentToolError(`El equipo ${input.team_id} no existe.`);
            who = team;
            value = [input.team_id];
        }
        return this.updateFields({ record_id: input.record_id, values: { [field.slug]: value } }, `Asignar a ${who}`);
    }

    private async requestApproval(input: { record_id?: number; flow: string | number; note: string }): Promise<ToolOutcome> {
        const svc = this.deps.approvals;
        if (!svc) throw new AgentToolError('Las aprobaciones no están disponibles en este servidor.');
        const { ctx, recordId } = await this.target(input.record_id);
        const rec = await this.deps.records.get(this.scope.tenantId, this.scope.owner, String(ctx.list.id), recordId);
        // Pedir una aprobación es actuar sobre el registro: hace falta poder editarlo.
        if (!this.deps.records.canReach(ctx.list, this.scope.owner, 'edit', { data: rec.data, createdBy: rec.created_by })) {
            throw new AgentToolError('El dueño del agente no puede editar ese registro: no se puede pedir la aprobación.');
        }
        const flows = await svc.listFlows(this.scope.tenantId, String(ctx.list.id));
        const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
        const flow = flows.find((f) => f.is_active && (f.id === Number(input.flow) || norm(f.name) === norm(String(input.flow))));
        if (!flow) {
            throw new AgentToolError(`No existe el flujo «${String(input.flow)}» en la lista. Flujos: ${flows.filter((f) => f.is_active).map((f) => `${f.name} (id ${f.id})`).join(', ') || '(ninguno)'}.`);
        }
        const title = `Pedir la aprobación «${flow.name}»`;
        const lines = [{ label: 'Aprobación', from: null, to: flow.name + (input.note ? ` — «${agentClip(input.note, 120)}»` : '') }];
        if (!this.writesForReal) {
            this.changes.push({ kind: 'request_approval', list_id: ctx.list.id, record_id: recordId, flow_id: flow.id, flow_name: flow.name, note: input.note, title, lines });
            return { content: { ok: true, propuesto: true }, isError: false, kind: this.scope.simulate ? 'simulated' : 'proposed', summary: `${this.scope.simulate ? 'Pediría' : 'Propone pedir'} la aprobación «${flow.name}»` };
        }
        const res = await svc.requestBySystem(this.scope.tenantId, ctx.list.id, recordId, flow.id, input.note, { id: 0, name: `${this.scope.agent.name} (agente de IA)` });
        this.applied.push(`Pidió la aprobación «${flow.name}»`);
        return {
            content: { ok: true, creada: res.created },
            isError: false,
            kind: 'write',
            summary: res.created ? `Pidió la aprobación «${flow.name}»` : `Ya había una solicitud pendiente de «${flow.name}»`,
        };
    }

    private async sendEmail(input: { to: string[]; subject: string; body: string }): Promise<ToolOutcome> {
        const allowed = await this.allowedRecipients();
        const to = [...new Set(input.to.map((e) => e.trim().toLowerCase()))];
        const outside = to.filter((e) => !allowed.has(e));
        if (outside.length > 0) {
            throw new AgentToolError(
                `No puedes escribirle a ${outside.join(', ')}: sólo al contacto del registro (sus campos de correo) o a alguien del equipo de la empresa.`,
            );
        }
        const title = `Correo a ${to.join(', ')}`;
        const lines = [
            { label: 'Asunto', from: null, to: agentClip(input.subject, 200) },
            { label: 'Mensaje', from: null, to: agentClip(input.body, 600) },
        ];
        if (!this.writesForReal) {
            this.changes.push({ kind: 'send_email', list_id: this.scope.listId, record_id: this.scope.recordId, to, subject: input.subject, body: input.body, title, lines });
            return { content: { ok: true, propuesto: true }, isError: false, kind: this.scope.simulate ? 'simulated' : 'proposed', summary: `${this.scope.simulate ? 'Mandaría' : 'Propone mandar'} un correo a ${to.join(', ')}: «${agentClip(input.subject, 80)}»` };
        }
        await this.deliverEmail(to, input.subject, input.body);
        this.applied.push(`Mandó un correo a ${to.join(', ')}`);
        return { content: { ok: true }, isError: false, kind: 'write', summary: `Mandó un correo a ${to.join(', ')}: «${agentClip(input.subject, 80)}»` };
    }

    async deliverEmail(to: string[], subject: string, body: string): Promise<void> {
        if (!this.deps.mail) throw new AgentToolError('El correo no está disponible en este servidor.');
        await this.deps.mail.sendNow({ tenantId: this.scope.tenantId, to: to.join(', '), subject, text: body });
        if (this.scope.recordId !== null) {
            await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx) =>
                this.deps.activity.logInTx(tx, {
                    tenantId: this.scope.tenantId,
                    listId: this.scope.listId,
                    recordId: this.scope.recordId,
                    userId: null,
                    action: 'ai_agent',
                    diff: { agent: { event: 'email', agent_id: this.scope.agent.id, agent_name: this.scope.agent.name, excerpt: agentClip(`${to.join(', ')} — ${subject}`, 160) } },
                    agentId: this.scope.agent.id,
                }),
            );
        }
    }

    /**
     * A quién puede escribirle: los correos que están en los campos de correo
     * del registro de la corrida y las personas activas del equipo. Así un texto
     * malicioso no puede hacer que el agente le mande datos a cualquiera.
     */
    private async allowedRecipients(): Promise<Set<string>> {
        if (!this.recordEmails) {
            const emails: string[] = [];
            if (this.scope.recordId !== null) {
                const ctx = await this.listCtx(this.scope.listId);
                const rec = await this.deps.records.get(this.scope.tenantId, this.scope.owner, String(ctx.list.id), this.scope.recordId);
                for (const f of ctx.visible.filter((x) => x.type === 'email')) {
                    const v = rec.data[jsonbKeyForField(f.id)];
                    if (typeof v === 'string' && v.includes('@')) emails.push(v.trim().toLowerCase());
                }
            }
            this.recordEmails = emails;
        }
        const team = await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx) =>
            tx
                .select({ email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, this.scope.tenantId), ne(memberships.role, 'client'), ne(memberships.role, 'guest'), isNull(users.disabledAt))),
        );
        return new Set([...this.recordEmails, ...team.map((t) => t.email.trim().toLowerCase())]);
    }

    private async member(userId: number): Promise<string | null> {
        const [row] = await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx: Tx) =>
            tx
                .select({ name: users.name, email: users.email, role: memberships.role })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, this.scope.tenantId), eq(memberships.userId, userId), isNull(users.disabledAt)))
                .limit(1),
        );
        if (!row || row.role === 'client' || row.role === 'guest') return null;
        return row.name || row.email;
    }

    private async team(teamId: number): Promise<string | null> {
        const [row] = await this.deps.tenantDb.withTenant(this.scope.tenantId, (tx: Tx) =>
            tx.select({ name: teams.name }).from(teams).where(and(eq(teams.tenantId, this.scope.tenantId), eq(teams.id, teamId))).limit(1),
        );
        return row ? `el equipo «${row.name}»` : null;
    }

    /** Personas y equipos para asignar (van en el primer mensaje si el agente asigna). */
    async peopleAndTeams(): Promise<{ people: Array<{ id: number; name: string }>; teams: Array<{ id: number; name: string }> }> {
        return this.deps.tenantDb.withTenant(this.scope.tenantId, async (tx) => {
            const people = await tx
                .select({ id: users.id, name: users.name, email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, this.scope.tenantId), ne(memberships.role, 'client'), ne(memberships.role, 'guest'), isNull(users.disabledAt)))
                .orderBy(users.name)
                .limit(100);
            const ts = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tenantId, this.scope.tenantId)).orderBy(teams.name).limit(50);
            return { people: people.map((p) => ({ id: p.id, name: p.name || p.email })), teams: ts };
        });
    }

    /** El registro de la corrida, como lo ve el modelo en el primer mensaje. */
    async initialRecord(): Promise<{ ctx: ListCtx; record: { id: number; values: Record<string, unknown> } | null; title: string | null }> {
        const ctx = await this.listCtx(this.scope.listId);
        if (this.scope.recordId === null) return { ctx, record: null, title: null };
        const rec = await this.deps.records.get(this.scope.tenantId, this.scope.owner, String(ctx.list.id), this.scope.recordId);
        return { ctx, record: { id: rec.id, values: this.readable(ctx, rec, { all: true }) }, title: this.titleOf(ctx, rec) };
    }
}

// ─────────────────────────── Puras ───────────────────────────

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    return Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
}

/** Una entrada del historial, legible para el modelo. */
function historyLine(a: ActivityDto, fields: Field[]): string {
    const who = a.agent ? `el agente «${a.agent.name}»` : (a.user_name ?? 'el sistema');
    const at = a.created_at.slice(0, 16).replace('T', ' ');
    if (a.action === 'record_updated') {
        const byKey = new Map(fields.map((f) => [jsonbKeyForField(f.id), f]));
        const changes = Object.entries(a.diff ?? {})
            .filter(([k]) => /^f\d+$/.test(k))
            .map(([k, v]) => {
                const f = byKey.get(k);
                const to = (v as { to?: unknown })?.to;
                return `${f?.label ?? k} → ${f ? displayValue(f, to) || '(vacío)' : agentClip(to, 40)}`;
            });
        return `${at} ${who} cambió ${changes.join(', ') || 'el registro'}`;
    }
    return `${at} ${who}: ${a.action}`;
}

/** El mensaje legible de un error de dominio (400/403/404 de Nest) o cualquiera. */
export function describeError(err: unknown): string {
    const resp = (err as { getResponse?: () => unknown }).getResponse?.();
    if (resp && typeof resp === 'object') {
        const r = resp as { message?: unknown; code?: unknown; data?: { errors?: Record<string, string> } };
        const parts: string[] = [];
        if (r.code === 'record_not_found' || (err instanceof NotFoundException && !r.message)) parts.push('El registro no existe o el dueño del agente no lo puede ver.');
        else if (typeof r.message === 'string') parts.push(r.message);
        if (r.data?.errors) parts.push(Object.entries(r.data.errors).map(([k, v]) => `${k}: ${v}`).join('; '));
        if (parts.length > 0) return parts.join(' — ');
    }
    if (err instanceof BadRequestException) return err.message;
    return err instanceof Error ? err.message : String(err);
}
