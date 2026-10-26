import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    APPROVAL_FIELD_OPTIONS,
    APPROVAL_RESULT_BY_STATUS,
    approvalFlowConfigProblems,
    createApprovalFlowSchema,
    describeApprover,
    jsonbKeyForField,
    readApprovalFlowConfig,
    resolveTitleFieldId,
    roleHasCapability,
    stepLabel,
    updateApprovalFlowSchema,
    validateFieldValue,
    type ApprovalActionResult,
    type ApprovalDecisionDto,
    type ApprovalDecisionKind,
    type ApprovalFlow,
    type ApprovalFlowConfig,
    type ApprovalInboxItem,
    type ApprovalRequestDto,
    type ApprovalStatus,
    type ApprovalStep,
    type ApprovalStepDto,
    type Approver,
    type CancelApprovalInput,
    type CreateApprovalFlowInput,
    type DecideApprovalInput,
    type Field,
    type List,
    type MyApprovalsDto,
    type RecordApprovalFlowDto,
    type RecordApprovalsDto,
    type RequestApprovalInput,
    type Role,
    type UpdateApprovalFlowInput,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import type { Tx } from '../db/client';
import { automations, fields as fieldsTable, lists as listsTable, memberships, records, users, type ApprovalFlowRow, type ApprovalRequestRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { listRowInScope, type AclSubject } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { NotificationsService, fallbackWorkTitle } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ApprovalHub, type ApprovalEventInfo } from './approval-hub';
import { approvalFlowRefs } from './approval-refs';
import { askTitle, decisionMessage, resolvedTitle } from './approval-text';
import { ApprovalsRepository } from './approvals.repository';

/**
 * Quién pide, decide o mira. Es el sujeto del ACL de las listas: C1 — con
 * sus equipos (`teamIds`), así el acceso por equipo cuenta para ver y editar.
 */
export type ApprovalActor = AclSubject;

/** Una persona del equipo que puede aprobar (miembro activo, no cliente). */
interface Member {
    userId: number;
    role: Role;
    name: string;
    /** C1 — sus equipos: el acceso por equipo a la lista cuenta para ver el registro. */
    teamIds: number[];
}

/** Lo mínimo del registro para resolver aprobadores y el ACL. */
interface RecordRowLite {
    id: number;
    listId: number;
    data: Record<string, unknown>;
    createdBy: number;
}

/**
 * Resolución de los miembros de un equipo. Los EQUIPOS los agrega otra entrega
 * (tablas `teams` / `team_members` y `TeamsService.memberIds(tx, teamId)`):
 * aquí está el único punto donde se conectan. Mientras no exista, un paso
 * «equipo» no tiene a nadie que apruebe (el schema ya lo valida y la interfaz
 * no lo ofrece).
 */
export type TeamMembersResolver = (tx: Tx, tenantId: number, teamId: number) => Promise<number[]>;

/** C1 — Los equipos de la empresa (id → nombre): nombran el aprobador y validan el flujo. */
export type TeamDirectoryResolver = (tx: Tx, tenantId: number) => Promise<ReadonlyMap<number, { name: string }>>;

/** Las resueltas que «Mi trabajo» muestra a quien las pidió. */
const REQUESTED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Tope de la bandeja (pendientes de mí y pedidas por mí). */
const INBOX_MAX = 200;
/** Cuántas pendientes de la empresa mira la bandeja como mucho (con filtro SQL previo). */
const INBOX_SCAN = 500;

/**
 * C5 — Aprobaciones: flujos por lista, solicitudes por registro y decisiones.
 *
 * Reglas que el servidor SIEMPRE re-chequea (la interfaz sólo oculta):
 *  - pedir: quien puede EDITAR el registro (o una automatización);
 *  - decidir: ser aprobador del PASO ACTUAL —resuelto EN VIVO: si el campo
 *    Persona cambió, manda el valor de ahora— y poder VER el registro;
 *  - cancelar: quien la pidió (o un admin).
 *
 * Concurrencia: la solicitud se lee con `FOR UPDATE` dentro de la
 * transacción de la decisión. Dos personas que aprueban a la vez un paso
 * «todos aprueban» se ponen en fila (la segunda cuenta la aprobación de la
 * primera); en «cualquiera aprueba» la segunda ve que el paso ya avanzó y
 * recibe 409. La decisión trae el paso que la persona VIO: un doble clic no
 * aprueba también el paso siguiente.
 */
@Injectable()
export class ApprovalsService {
    private readonly logger = new Logger(ApprovalsService.name);
    /** Ver `TeamMembersResolver`: lo conecta el módulo de equipos al arrancar. */
    private teamMembers: TeamMembersResolver | null = null;
    /** Ver `TeamDirectoryResolver`: idem. */
    private teamDirectory: TeamDirectoryResolver | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: ApprovalsRepository,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
        @Optional() private readonly notifications?: NotificationsService,
        @Optional() private readonly dispatcher?: AutomationDispatcher,
        @Optional() private readonly hub?: ApprovalHub,
    ) {}

    /** Conecta la resolución de equipos (la llama el módulo de equipos al arrancar). */
    setTeamMembersResolver(fn: TeamMembersResolver): void {
        this.teamMembers = fn;
    }

    /** C1 — Conecta el directorio de equipos (nombres y validación del flujo). */
    setTeamDirectoryResolver(fn: TeamDirectoryResolver): void {
        this.teamDirectory = fn;
    }

    // ─────────────────────────── Flujos ───────────────────────────

    async listFlows(tenantId: number, listIdOrSlug: string): Promise<ApprovalFlow[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await this.repo.listFlows(tx, tenantId, list.id);
            const pending = await this.repo.pendingCountsByFlow(tx, tenantId, rows.map((r) => r.id));
            return rows.flatMap((r) => {
                const dto = toFlowDto(r, pending.get(r.id) ?? 0);
                return dto ? [dto] : [];
            });
        });
    }

    async createFlow(tenantId: number, actor: ApprovalActor, listIdOrSlug: string, raw: CreateApprovalFlowInput): Promise<ApprovalFlow> {
        const input = createApprovalFlowSchema.parse(raw);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.assertFlowConfig(tx, tenantId, fields, input.config);
            return this.repo.insertFlow(tx, {
                tenantId,
                listId: list.id,
                name: input.name,
                description: input.description,
                config: input.config as unknown as Record<string, unknown>,
                isActive: input.is_active,
                position: await this.repo.nextFlowPosition(tx, tenantId, list.id),
                createdBy: actor.userId > 0 ? actor.userId : null,
            });
        });
        // La columna «Aprobación» de este flujo, para ver y filtrar en la tabla.
        if (input.add_status_field) {
            await this.fields
                .create(tenantId, String(list.id), {
                    label: uniqueLabel(fields, `Aprobación: ${input.name}`.slice(0, 120)),
                    type: 'approval',
                    config: { approval_flow_id: row.id, options: APPROVAL_FIELD_OPTIONS },
                })
                .catch((err: unknown) => this.logger.warn(`No se pudo crear la columna «Aprobación» del flujo ${row.id}: ${String(err)}`));
        }
        await this.audit.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'approval_flow.create',
            targetType: 'approval_flow',
            targetId: row.id,
            targetLabel: row.name,
            meta: { list_id: list.id, steps: input.config.steps.length },
        });
        this.realtime.records(tenantId, list.id);
        return toFlowDto(row, 0)!;
    }

    async updateFlow(tenantId: number, actor: ApprovalActor, listIdOrSlug: string, flowId: number, raw: UpdateApprovalFlowInput): Promise<ApprovalFlow> {
        const patch = updateApprovalFlowSchema.parse(raw);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findFlow(tx, tenantId, flowId);
            if (!current || current.listId !== list.id) throw flowNotFound();
            if (patch.config) await this.assertFlowConfig(tx, tenantId, fields, patch.config);
            const next = await this.repo.updateFlow(tx, tenantId, flowId, {
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.description !== undefined ? { description: patch.description } : {}),
                ...(patch.config !== undefined ? { config: patch.config as unknown as Record<string, unknown> } : {}),
                ...(patch.is_active !== undefined ? { isActive: patch.is_active } : {}),
            });
            if (!next) throw flowNotFound();
            const pending = await this.repo.pendingCountsByFlow(tx, tenantId, [flowId]);
            return { next, pending: pending.get(flowId) ?? 0 };
        });
        await this.audit.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'approval_flow.update',
            targetType: 'approval_flow',
            targetId: flowId,
            targetLabel: row.next.name,
            meta: { list_id: list.id, changed: Object.keys(patch) },
        });
        this.realtime.records(tenantId, list.id);
        return toFlowDto(row.next, row.pending)!;
    }

    /**
     * Borra un flujo. Una automatización que lo usa (pedir, esperar o el
     * disparador) lo impide con la lista de cuáles (409). Las solicitudes
     * pendientes se cancelan con el motivo; las resueltas quedan en el
     * historial de cada registro (con el nombre que tenía el flujo).
     */
    async deleteFlow(tenantId: number, actor: ApprovalActor, listIdOrSlug: string, flowId: number): Promise<void> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const cancelled = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findFlow(tx, tenantId, flowId);
            if (!current || current.listId !== list.id) throw flowNotFound();
            const users = await this.automationsUsingFlow(tx, tenantId, flowId);
            if (users.length > 0) {
                throw new ConflictException({
                    code: 'approval_flow_in_use',
                    message: `No se puede borrar: lo usa${users.length === 1 ? ' la automatización' : 'n las automatizaciones'} ${users.map((u) => `«${u}»`).join(', ')}. Quítalo de ahí primero.`,
                    data: { status: 409, automations: users },
                });
            }
            const out = await this.repo.cancelPendingOfFlow(tx, tenantId, flowId, 'Se eliminó el flujo de aprobación.');
            for (const r of out) {
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: r.listId,
                    recordId: r.recordId,
                    userId: actor.userId > 0 ? actor.userId : null,
                    action: 'approval',
                    diff: { approval: { event: 'cancelled', request_id: r.id, flow: current.name, reason: 'Se eliminó el flujo de aprobación.' } },
                });
            }
            await this.repo.deleteFlow(tx, tenantId, flowId);
            return { name: current.name, count: out.length };
        });
        await this.audit.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'approval_flow.delete',
            targetType: 'approval_flow',
            targetId: flowId,
            targetLabel: cancelled.name,
            meta: { list_id: list.id, cancelled_pending: cancelled.count },
        });
        this.realtime.records(tenantId, list.id);
    }

    /** Nombres de las automatizaciones (vivas) que usan un flujo. */
    private async automationsUsingFlow(tx: Tx, tenantId: number, flowId: number): Promise<string[]> {
        const rows = await tx
            .select({ name: automations.name, triggerConfig: automations.triggerConfig, actions: automations.actions, triggerType: automations.triggerType })
            .from(automations)
            .where(eq(automations.tenantId, tenantId));
        return rows
            .filter((a) => approvalFlowRefs({ trigger_type: a.triggerType, trigger_config: a.triggerConfig, actions: a.actions }).includes(flowId))
            .map((a) => a.name);
    }

    /** La config contra la lista real: campos, valores a poner y personas. */
    private async assertFlowConfig(tx: Tx, tenantId: number, fields: readonly Field[], config: ApprovalFlowConfig): Promise<void> {
        const problems = await this.flowConfigProblems(tx, tenantId, fields, config);
        if (problems.length > 0) {
            throw new BadRequestException({
                code: 'invalid_approval_flow',
                message: problems.join(' '),
                data: { status: 400, errors: { config: problems.join(' ') } },
            });
        }
    }

    /**
     * Lo que está mal en una config contra la lista (sin guardar nada): lo usa
     * el asistente para devolverle al modelo un error corregible al proponer.
     */
    async validateFlowConfig(tenantId: number, listId: number, config: ApprovalFlowConfig): Promise<string[]> {
        const fields = await this.fields.listByListId(tenantId, listId);
        return this.tenantDb.withTenant(tenantId, (tx) => this.flowConfigProblems(tx, tenantId, fields, config));
    }

    private async flowConfigProblems(tx: Tx, tenantId: number, fields: readonly Field[], config: ApprovalFlowConfig): Promise<string[]> {
        const byId = new Map(fields.map((f) => [f.id, f]));
        const problems = approvalFlowConfigProblems(config, byId);
        for (const [what, sets] of [
            ['Al aprobar', config.on_approve],
            ['Al rechazar', config.on_reject],
        ] as const) {
            for (const s of sets) {
                const f = byId.get(s.field_id);
                if (!f) continue;
                if (!['text', 'long_text', 'number', 'currency', 'select', 'multi_select', 'date', 'datetime', 'checkbox', 'url', 'email', 'user', 'phone', 'rating', 'percent', 'duration'].includes(f.type)) {
                    problems.push(`${what}: «${f.label}» no se puede poner desde una aprobación.`);
                    continue;
                }
                const res = validateFieldValue({ type: f.type, config: f.config, is_required: false }, s.value);
                if (!res.ok) problems.push(`${what}: «${f.label}» — ${res.error}`);
            }
        }
        // C1 — un paso «equipo» apunta a un equipo de ESTA empresa.
        const teamSteps = config.steps.filter((s) => s.approver.type === 'team');
        if (teamSteps.length > 0) {
            const known = this.teamDirectory ? await this.teamDirectory(tx, tenantId) : new Map<number, { name: string }>();
            for (const s of teamSteps) {
                const teamId = (s.approver as { team_id: number }).team_id;
                if (!known.has(teamId)) {
                    problems.push(`«${stepLabel(s, config.steps.indexOf(s))}»: ese equipo no existe en esta empresa.`);
                }
            }
        }
        const userIds = [...new Set(config.steps.flatMap((s) => (s.approver.type === 'users' ? s.approver.approver_user_ids : [])))];
        if (userIds.length > 0) {
            const members = await this.loadMembers(tx, tenantId);
            const missing = userIds.filter((id) => !members.has(id));
            if (missing.length > 0) problems.push(`Hay ${missing.length === 1 ? 'una persona que no es' : `${missing.length} personas que no son`} del equipo de la empresa entre los aprobadores.`);
        }
        return problems;
    }

    // ─────────────────────────── Ficha ───────────────────────────

    /** La sección «Aprobación» de la ficha: flujos que se pueden pedir y el historial. */
    async recordApprovals(tenantId: number, actor: ApprovalActor, listIdOrSlug: string, recordId: number): Promise<RecordApprovalsDto> {
        // Ver el registro (404 si no): el mismo ACL que la ficha.
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const record = await this.recordLite(tx, tenantId, list.id, recordId);
            if (!record) throw recordNotFound();
            const canEdit = canEditRecord(this.records, list, actor, record);
            const flows = await this.repo.listFlows(tx, tenantId, list.id);
            const rows = await this.repo.forRecord(tx, tenantId, recordId);
            const members = await this.loadMembers(tx, tenantId);
            const dtos = await this.toDtos(tx, tenantId, list, fields, record, rows, actor, members);
            const flowDtos: RecordApprovalFlowDto[] = [];
            for (const f of flows) {
                const cfg = readApprovalFlowConfig(f.config);
                if (!cfg || !f.isActive) continue;
                const mine = rows.filter((r) => r.flowId === f.id);
                const block = requestBlock(cfg, mine, canEdit);
                flowDtos.push({ id: f.id, name: f.name, description: f.description, steps: cfg.steps.length, can_request: block === null, blocked_reason: block });
            }
            return { flows: flowDtos, requests: dtos, can_request: canEdit };
        });
    }

    /** Una solicitud (la pantalla de confirmación del enlace del correo). */
    async getRequest(
        tenantId: number,
        actor: ApprovalActor,
        requestId: number,
    ): Promise<{ request: ApprovalRequestDto; list: { id: number; slug: string; name: string }; record_title: string }> {
        const found = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findRequest(tx, tenantId, requestId));
        if (!found) throw requestNotFound();
        // Ver el registro (404 opaco si no): un correo reenviado a alguien sin
        // acceso no revela ni el título.
        await this.records.get(tenantId, actor, String(found.listId), found.recordId).catch(() => {
            throw requestNotFound();
        });
        const list = await this.lists.get(tenantId, String(found.listId));
        const fields = await this.fields.listByListId(tenantId, list.id);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const record = await this.recordLite(tx, tenantId, list.id, found.recordId);
            if (!record) throw requestNotFound();
            const members = await this.loadMembers(tx, tenantId);
            const [dto] = await this.toDtos(tx, tenantId, list, fields, record, [found], actor, members);
            return { request: dto!, list: { id: list.id, slug: list.slug, name: list.name }, record_title: recordTitle(fields, list, record) };
        });
    }

    // ─────────────────────────── Pedir ───────────────────────────

    /** Pedir desde la ficha: quien puede EDITAR el registro. */
    async request(
        tenantId: number,
        actor: ApprovalActor,
        listIdOrSlug: string,
        recordId: number,
        input: RequestApprovalInput,
    ): Promise<ApprovalRequestDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const created = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const record = await this.recordLite(tx, tenantId, list.id, recordId);
            if (!record || !canViewRecord(list, actor, record)) throw recordNotFound();
            if (!canEditRecord(this.records, list, actor, record)) {
                throw new ForbiddenException({
                    code: 'approval_forbidden',
                    message: 'Para pedir una aprobación tienes que poder editar el registro.',
                    data: { status: 403 },
                });
            }
            return this.createRequestInTx(tx, tenantId, list, fields, record, Number(input.flow_id), (input.note ?? '').trim(), {
                requesterId: actor.userId,
                source: 'user',
            });
        });
        await this.afterRequested(tenantId, list, fields, created);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const record = await this.recordLite(tx, tenantId, list.id, recordId);
            const members = await this.loadMembers(tx, tenantId);
            const [dto] = await this.toDtos(tx, tenantId, list, fields, record!, [created.request], actor, members);
            return dto!;
        });
    }

    /**
     * Pedir desde una automatización (acción «Pedir aprobación»). Sin persona
     * que pida: no se chequea la edición (lo configuró quien gestiona las
     * automatizaciones). Si ya hay una pendiente de ese flujo, se reutiliza
     * (`created: false`) — así «Esperar aprobación» espera esa.
     */
    async requestBySystem(
        tenantId: number,
        listId: number,
        recordId: number,
        flowId: number,
        note: string,
        automation: { id: number; name: string } | null,
    ): Promise<{ created: boolean; info: ApprovalEventInfo; stepsCount: number; firstStep: string }> {
        const list = await this.lists.get(tenantId, String(listId));
        const fields = await this.fields.listByListId(tenantId, list.id);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const record = await this.recordLite(tx, tenantId, list.id, recordId);
            if (!record) throw recordNotFound();
            const existing = await this.repo.pendingFor(tx, tenantId, recordId, flowId);
            if (existing) return { created: null, existing };
            const created = await this.createRequestInTx(tx, tenantId, list, fields, record, flowId, note.trim().slice(0, 2000), {
                requesterId: null,
                source: 'automation',
                automation,
            });
            return { created, existing: null };
        });
        const row = result.created?.request ?? result.existing!;
        if (result.created) await this.afterRequested(tenantId, list, fields, result.created);
        const cfg = readApprovalFlowConfig(row.config);
        return {
            created: result.created !== null,
            info: await this.eventInfo(tenantId, row),
            stepsCount: cfg?.steps.length ?? 0,
            firstStep: cfg?.steps[0] ? stepLabel(cfg.steps[0], 0) : '',
        };
    }

    private async createRequestInTx(
        tx: Tx,
        tenantId: number,
        list: List,
        fields: readonly Field[],
        record: RecordRowLite,
        flowId: number,
        note: string,
        who: { requesterId: number | null; source: 'user' | 'automation'; automation?: { id: number; name: string } | null },
    ): Promise<{ request: ApprovalRequestRow; approvers: Member[]; config: ApprovalFlowConfig }> {
        const flow = await this.repo.findFlow(tx, tenantId, flowId);
        if (!flow || flow.listId !== list.id) throw flowNotFound();
        if (!flow.isActive) {
            throw new ConflictException({ code: 'approval_flow_inactive', message: `El flujo «${flow.name}» está desactivado.`, data: { status: 409 } });
        }
        const config = readApprovalFlowConfig(flow.config);
        if (!config) throw new BadRequestException({ code: 'invalid_approval_flow', message: `El flujo «${flow.name}» está mal configurado: revísalo en Ajustes de la lista.`, data: { status: 400 } });
        const previous = await this.repo.forRecord(tx, tenantId, record.id, 50);
        const block = requestBlock(config, previous.filter((r) => r.flowId === flow.id), true);
        if (block) {
            throw new ConflictException({
                code: previous.some((r) => r.flowId === flow.id && r.status === 'pending') ? 'approval_pending' : 'approval_rejected_final',
                message: block,
                data: { status: 409 },
            });
        }
        const members = await this.loadMembers(tx, tenantId);
        const first = config.steps[0]!;
        const approvers = await this.stepApprovers(tx, tenantId, list, first, record, who.requesterId, config, members);
        if (approvers.length === 0) {
            throw new BadRequestException({
                code: 'approval_no_approvers',
                message: noApproversMessage(first, 0, fields, record),
                data: { status: 400 },
            });
        }
        let row: ApprovalRequestRow;
        try {
            row = await this.repo.insertRequest(tx, {
                tenantId,
                listId: list.id,
                recordId: record.id,
                flowId: flow.id,
                flowName: flow.name,
                config: config as unknown as Record<string, unknown>,
                status: 'pending',
                currentStep: 0,
                note,
                source: who.source,
                automationId: who.automation?.id ?? null,
                automationName: who.automation?.name ?? null,
                requestedBy: who.requesterId,
            });
        } catch (err) {
            // Dos pedidos a la vez del mismo flujo: el índice único parcial frena al segundo.
            if (pgCode(err) === '23505') {
                throw new ConflictException({ code: 'approval_pending', message: `Ya hay una solicitud pendiente de «${flow.name}» para este registro.`, data: { status: 409 } });
            }
            throw err;
        }
        await this.activity.logInTx(tx, {
            tenantId,
            listId: list.id,
            recordId: record.id,
            userId: who.requesterId,
            action: 'approval',
            diff: {
                approval: {
                    event: 'requested',
                    request_id: row.id,
                    flow: flow.name,
                    step: 0,
                    steps: config.steps.length,
                    ...(note ? { note } : {}),
                    ...(who.automation ? { automation: who.automation.name } : {}),
                },
            },
        });
        return { request: row, approvers, config };
    }

    /** Después de confirmar el alta: avisos a los aprobadores del paso 1 y tiempo real. */
    private async afterRequested(
        tenantId: number,
        list: List,
        fields: readonly Field[],
        created: { request: ApprovalRequestRow; approvers: Member[]; config: ApprovalFlowConfig },
    ): Promise<void> {
        this.realtime.records(tenantId, list.id);
        await this.notifyStep(tenantId, list, fields, created.request, created.config, 0, created.approvers.map((m) => m.userId)).catch((err) =>
            this.logger.warn(`Avisos de la aprobación ${created.request.id}: ${String(err)}`),
        );
    }

    // ─────────────────────────── Decidir ───────────────────────────

    async decide(tenantId: number, actor: ApprovalActor, requestId: number, input: DecideApprovalInput): Promise<ApprovalActionResult> {
        const decision = input.decision as ApprovalDecisionKind;
        const reason = (input.reason ?? '').trim();
        if (decision !== 'approve' && reason === '') {
            throw new BadRequestException({ code: 'approval_reason_required', message: 'Escribe el motivo (se le muestra a quien pidió la aprobación).', data: { status: 400, errors: { reason: 'Obligatorio' } } });
        }
        const pre = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findRequest(tx, tenantId, requestId));
        if (!pre) throw requestNotFound();
        const list = await this.lists.get(tenantId, String(pre.listId)).catch(() => {
            throw requestNotFound();
        });
        const fields = await this.fields.listByListId(tenantId, list.id);

        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const req = await this.repo.lockRequest(tx, tenantId, requestId);
            if (!req) throw requestNotFound();
            const record = await this.recordLite(tx, tenantId, list.id, req.recordId);
            // Sin el registro (papelera) o sin poder verlo: 404 opaco.
            if (!record || !canViewRecord(list, actor, record)) throw requestNotFound();
            if (req.status !== 'pending') {
                throw new ConflictException({
                    code: 'approval_resolved',
                    message: `Esta solicitud ya no está pendiente: quedó ${statusWord(req.status as ApprovalStatus)}.`,
                    data: { status: 409, request_status: req.status },
                });
            }
            if (req.currentStep !== input.step) {
                throw new ConflictException({
                    code: 'approval_step_changed',
                    message: `Ese paso ya se resolvió: la solicitud está ahora en el paso ${req.currentStep + 1}.`,
                    data: { status: 409, current_step: req.currentStep },
                });
            }
            const config = readApprovalFlowConfig(req.config);
            const step = config?.steps[req.currentStep];
            if (!config || !step) throw new BadRequestException({ code: 'invalid_approval_flow', message: 'La solicitud está mal configurada.', data: { status: 400 } });
            const members = await this.loadMembers(tx, tenantId);
            const approvers = await this.stepApprovers(tx, tenantId, list, step, record, req.requestedBy, config, members);
            if (!approvers.some((m) => m.userId === actor.userId)) {
                throw new ForbiddenException({
                    code: 'approval_not_approver',
                    message: req.requestedBy === actor.userId && !config.self_approval
                        ? 'No puedes aprobar tu propia solicitud.'
                        : 'No eres aprobador del paso actual de esta solicitud.',
                    data: { status: 403 },
                });
            }
            const prior = await this.repo.decisionsFor(tx, tenantId, [req.id]);
            if (prior.some((d) => d.step === req.currentStep && d.userId === actor.userId)) {
                throw new ConflictException({ code: 'approval_already_decided', message: 'Ya decidiste este paso.', data: { status: 409 } });
            }
            try {
                await this.repo.insertDecision(tx, { tenantId, requestId: req.id, step: req.currentStep, userId: actor.userId, decision, reason });
            } catch (err) {
                if (pgCode(err) === '23505') throw new ConflictException({ code: 'approval_already_decided', message: 'Ya decidiste este paso.', data: { status: 409 } });
                throw err;
            }

            const stepIndex = req.currentStep;
            let outcome: 'advanced' | 'approved' | 'waiting' | 'rejected' | 'returned';
            let waitingOn = 0;
            let nextApprovers: Member[] = [];
            if (decision === 'reject' || decision === 'return') {
                outcome = decision === 'reject' ? 'rejected' : 'returned';
                await this.repo.updateRequest(tx, tenantId, req.id, {
                    status: outcome,
                    reason,
                    resolvedAt: sql`now()` as unknown as Date,
                    resolvedBy: actor.userId,
                });
            } else {
                const approvedIds = new Set(
                    [...prior.filter((d) => d.step === stepIndex && d.decision === 'approve').map((d) => d.userId), actor.userId].filter(
                        (u): u is number => u !== null,
                    ),
                );
                const missing = step.mode === 'all' ? approvers.filter((m) => !approvedIds.has(m.userId)) : [];
                if (missing.length > 0) {
                    outcome = 'waiting';
                    waitingOn = missing.length;
                } else if (stepIndex + 1 < config.steps.length) {
                    outcome = 'advanced';
                    await this.repo.updateRequest(tx, tenantId, req.id, { currentStep: stepIndex + 1, stepStartedAt: sql`now()` as unknown as Date });
                    nextApprovers = await this.stepApprovers(tx, tenantId, list, config.steps[stepIndex + 1]!, record, req.requestedBy, config, members);
                } else {
                    outcome = 'approved';
                    await this.repo.updateRequest(tx, tenantId, req.id, {
                        status: 'approved',
                        resolvedAt: sql`now()` as unknown as Date,
                        resolvedBy: actor.userId,
                    });
                }
            }
            const event = outcome === 'waiting' || outcome === 'advanced' ? 'approved_step' : outcome;
            await this.activity.logInTx(tx, {
                tenantId,
                listId: list.id,
                recordId: record.id,
                userId: actor.userId,
                action: 'approval',
                diff: {
                    approval: {
                        event,
                        request_id: req.id,
                        flow: req.flowName,
                        step: stepIndex,
                        steps: config.steps.length,
                        ...(reason ? { reason } : {}),
                        ...(outcome === 'waiting' ? { waiting_on: waitingOn } : {}),
                    },
                },
            });
            return { req, config, outcome, waitingOn, stepIndex, approvers, nextApprovers };
        });

        const warnings: string[] = [];
        const { req, config } = out;
        this.realtime.records(tenantId, list.id);
        // La bandeja de los demás aprobadores de ese paso (su pendiente cambió).
        for (const m of out.approvers) if (m.userId !== actor.userId) this.realtime.notifications(tenantId, m.userId);

        if (out.outcome === 'advanced') {
            await this.notifyStep(tenantId, list, fields, req, config, out.stepIndex + 1, out.nextApprovers.map((m) => m.userId)).catch((err) =>
                this.logger.warn(`Avisos de la aprobación ${req.id}: ${String(err)}`),
            );
            if (out.nextApprovers.length === 0) {
                warnings.push(`Nadie puede aprobar el paso ${out.stepIndex + 2} ahora mismo: revisa el flujo o el registro.`);
            }
        }
        if (out.outcome === 'approved' || out.outcome === 'rejected' || out.outcome === 'returned') {
            warnings.push(...(await this.applyOutcome(tenantId, actor, list, fields, req, config, out.outcome)));
            await this.afterResolved(tenantId, list, fields, req.id, actor.userId);
        }
        const dto = await this.requestDto(tenantId, actor, list, fields, req.id);
        return {
            request: dto,
            message: decisionMessage({ decision, stepIndex: out.stepIndex, stepsCount: config.steps.length, outcome: out.outcome, waitingOn: out.waitingOn }),
            warnings,
        };
    }

    /** Quien pidió (o un admin) cancela una pendiente. */
    async cancel(tenantId: number, actor: ApprovalActor, requestId: number, input: CancelApprovalInput): Promise<ApprovalActionResult> {
        const pre = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findRequest(tx, tenantId, requestId));
        if (!pre) throw requestNotFound();
        const list = await this.lists.get(tenantId, String(pre.listId)).catch(() => {
            throw requestNotFound();
        });
        const fields = await this.fields.listByListId(tenantId, list.id);
        const reason = (input.reason ?? '').trim();
        const approvers = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const req = await this.repo.lockRequest(tx, tenantId, requestId);
            if (!req) throw requestNotFound();
            const record = await this.recordLite(tx, tenantId, list.id, req.recordId);
            if (!record || !canViewRecord(list, actor, record)) throw requestNotFound();
            if (req.status !== 'pending') {
                throw new ConflictException({ code: 'approval_resolved', message: `Esta solicitud ya no está pendiente: quedó ${statusWord(req.status as ApprovalStatus)}.`, data: { status: 409 } });
            }
            if (req.requestedBy !== actor.userId && actor.role !== 'admin') {
                throw new ForbiddenException({ code: 'approval_cancel_forbidden', message: 'Sólo quien pidió la aprobación (o un admin) la puede cancelar.', data: { status: 403 } });
            }
            await this.repo.updateRequest(tx, tenantId, req.id, {
                status: 'cancelled',
                reason,
                resolvedAt: sql`now()` as unknown as Date,
                resolvedBy: actor.userId,
            });
            await this.activity.logInTx(tx, {
                tenantId,
                listId: list.id,
                recordId: record.id,
                userId: actor.userId,
                action: 'approval',
                diff: { approval: { event: 'cancelled', request_id: req.id, flow: req.flowName, ...(reason ? { reason } : {}) } },
            });
            const config = readApprovalFlowConfig(req.config);
            const step = config?.steps[req.currentStep];
            const members = await this.loadMembers(tx, tenantId);
            return config && step ? this.stepApprovers(tx, tenantId, list, step, record, req.requestedBy, config, members) : [];
        });
        this.realtime.records(tenantId, list.id);
        for (const m of approvers) this.realtime.notifications(tenantId, m.userId);
        await this.afterResolved(tenantId, list, fields, requestId, actor.userId);
        return { request: await this.requestDto(tenantId, actor, list, fields, requestId), message: 'Cancelaste la solicitud.', warnings: [] };
    }

    /**
     * Lo que pasa al resolver: el aviso a quien pidió, el evento para las
     * automatizaciones (disparador y esperas) — todo después de confirmar.
     */
    private async afterResolved(tenantId: number, list: List, fields: readonly Field[], requestId: number, actorId: number): Promise<void> {
        const loaded = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const req = await this.repo.findRequest(tx, tenantId, requestId);
            const record = req ? await this.recordLite(tx, tenantId, list.id, req.recordId) : null;
            return req && record ? { req, record } : null;
        });
        if (!loaded) return;
        const { req, record } = loaded;
        const info = await this.eventInfo(tenantId, req);
        const status = req.status as Exclude<ApprovalStatus, 'pending'>;
        // Al solicitante (si fue una persona y no se lo hizo él mismo).
        if (req.requestedBy !== null && status !== 'cancelled') {
            await this.notifications
                ?.deliver(tenantId, 'approval', [req.requestedBy], {
                    listId: list.id,
                    recordId: record.id,
                    actorId: actorId > 0 ? actorId : null,
                    title: resolvedTitle({ status, deciderName: info.decidio || null, recordTitle: recordTitle(fields, list, record), flowName: req.flowName }),
                    body: req.reason,
                })
                .catch((err) => this.logger.warn(`Aviso de la aprobación ${req.id} a quien la pidió: ${String(err)}`));
        }
        this.hub?.emit({ tenantId, listId: list.id, recordId: record.id, info });
        this.dispatcher?.dispatch({
            tenantId,
            listId: list.id,
            recordId: record.id,
            trigger: 'approval_resolved',
            after: record.data,
            approval: info,
        });
    }

    /** Al resolver: los campos que el flujo pone (Estado = Aprobado / Rechazado). */
    private async applyOutcome(
        tenantId: number,
        actor: ApprovalActor,
        list: List,
        fields: readonly Field[],
        req: ApprovalRequestRow,
        config: ApprovalFlowConfig,
        outcome: 'approved' | 'rejected' | 'returned',
    ): Promise<string[]> {
        const sets = outcome === 'approved' ? config.on_approve : outcome === 'rejected' ? config.on_reject : [];
        if (sets.length === 0) return [];
        const byId = new Map(fields.map((f) => [f.id, f]));
        const data: Record<string, unknown> = {};
        const warnings: string[] = [];
        for (const s of sets) {
            if (!byId.has(s.field_id)) {
                warnings.push('Un campo que el flujo tenía que poner ya no existe.');
                continue;
            }
            data[jsonbKeyForField(s.field_id)] = s.value ?? null;
        }
        if (Object.keys(data).length === 0) return warnings;
        try {
            // La persona que decidió es el autor del cambio (la actividad lo
            // dice); los campos los configuró quien gestiona la lista, así que
            // se escriben aunque su rol no pueda editar el registro.
            await this.records.update(tenantId, { userId: actor.userId, role: 'admin' }, String(list.id), req.recordId, { data });
        } catch (err) {
            const msg = errorText(err);
            this.logger.warn(`Aprobación ${req.id}: no se pudieron poner los campos del flujo: ${msg}`);
            warnings.push(`La decisión quedó registrada, pero no se pudieron poner los campos del flujo: ${msg}`);
        }
        return warnings;
    }

    /** Aviso «te toca aprobar» a los aprobadores de un paso, con los botones del correo. */
    private async notifyStep(
        tenantId: number,
        list: List,
        fields: readonly Field[],
        req: ApprovalRequestRow,
        config: ApprovalFlowConfig,
        stepIndex: number,
        userIds: number[],
    ): Promise<void> {
        if (!this.notifications || userIds.length === 0) return;
        const record = await this.tenantDb.withTenant(tenantId, (tx) => this.recordLite(tx, tenantId, list.id, req.recordId));
        if (!record) return;
        const requesterName = req.requestedBy !== null ? await this.userName(tenantId, req.requestedBy) : null;
        await this.notifications.deliver(tenantId, 'approval', userIds, {
            listId: list.id,
            recordId: record.id,
            actorId: req.requestedBy,
            title: askTitle({ requesterName, recordTitle: recordTitle(fields, list, record), flowName: req.flowName, stepIndex, steps: config.steps }),
            body: req.note,
            mail: {
                actions: [
                    { label: 'Aprobar', path: `/approvals/${req.id}?d=approve`, tone: 'primary' },
                    { label: 'Rechazar', path: `/approvals/${req.id}?d=reject`, tone: 'danger' },
                    { label: 'Abrir el registro', path: `/lists/${list.slug}/records/${record.id}`, tone: 'neutral' },
                ],
            },
        });
    }

    // ─────────────────────────── Mi trabajo ───────────────────────────

    /**
     * «Mi trabajo» → Aprobaciones: lo que espera MI decisión (paso actual, sin
     * decidir todavía, con el aprobador resuelto en vivo y el ACL de cada
     * lista) y lo que pedí. Un filtro SQL previo trae sólo las candidatas
     * (por el tipo de aprobador del paso actual en la copia de la config);
     * la verificación final es la MISMA resolución que la decisión.
     */
    async myApprovals(tenantId: number, actor: ApprovalActor): Promise<MyApprovalsDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const approver = sql`(ar.config #> ARRAY['steps', ar.current_step::text, 'approver'])`;
            const candidates = await tx.execute(sql`
                SELECT ar.id
                  FROM approval_requests ar
                  JOIN records r ON r.id = ar.record_id AND r.deleted_at IS NULL
                  JOIN lists l ON l.id = ar.list_id
                 WHERE ar.tenant_id = ${tenantId} AND ar.status = 'pending'
                   AND NOT EXISTS (SELECT 1 FROM approval_decisions d
                                    WHERE d.request_id = ar.id AND d.step = ar.current_step AND d.user_id = ${actor.userId})
                   AND (
                        (${approver} ->> 'type' = 'users' AND (${approver} -> 'approver_user_ids') @> to_jsonb(${actor.userId}::bigint))
                     OR (${approver} ->> 'type' = 'role' AND ${approver} ->> 'role' = ${actor.role})
                     OR (${approver} ->> 'type' = 'field' AND (r.data ->> ('f' || (${approver} ->> 'approver_field_id'))) = ${String(actor.userId)})
                     OR (${approver} ->> 'type' = 'team')
                   )
                 ORDER BY ar.id DESC
                 LIMIT ${INBOX_SCAN}`);
            const pendingIds = (candidates.rows as Array<{ id: unknown }>).map((r) => Number(r.id));
            const requested = await this.repo.requestedBy(tx, tenantId, actor.userId, new Date(Date.now() - REQUESTED_WINDOW_MS), INBOX_MAX);
            const pendingRows = pendingIds.length > 0 ? await this.requestsByIds(tx, tenantId, pendingIds) : [];
            const all = [...pendingRows, ...requested];
            if (all.length === 0) return { pending: [], requested: [], pending_count: 0 };

            const listIds = [...new Set(all.map((r) => r.listId))];
            const listRows = await tx.select().from(listsTable).where(and(eq(listsTable.tenantId, tenantId), inArray(listsTable.id, listIds)));
            const listById = new Map<number, List>();
            for (const l of listRows) listById.set(l.id, await this.lists.getWithinTx(tx, tenantId, String(l.id)));
            const fieldRows = await tx
                .select()
                .from(fieldsTable)
                .where(and(eq(fieldsTable.tenantId, tenantId), inArray(fieldsTable.listId, listIds)));
            const fieldsByList = new Map<number, Field[]>();
            for (const f of fieldRows) {
                const arr = fieldsByList.get(f.listId) ?? [];
                arr.push({ id: f.id, list_id: f.listId, slug: f.slug, label: f.label, type: f.type, config: f.config } as unknown as Field);
                fieldsByList.set(f.listId, arr);
            }
            const recordIds = [...new Set(all.map((r) => r.recordId))];
            const recordRows = await tx
                .select({ id: records.id, listId: records.listId, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), inArray(records.id, recordIds), isNull(records.deletedAt)));
            const recordById = new Map(recordRows.map((r) => [r.id, r as RecordRowLite]));
            const members = await this.loadMembers(tx, tenantId);
            const names = await this.names(tx, all.flatMap((r) => (r.requestedBy !== null ? [r.requestedBy] : [])));

            const item = (r: ApprovalRequestRow): ApprovalInboxItem | null => {
                const list = listById.get(r.listId);
                const record = recordById.get(r.recordId);
                if (!list || !record) return null;
                const cfg = readApprovalFlowConfig(r.config);
                const step = cfg?.steps[r.currentStep];
                return {
                    id: r.id,
                    status: r.status as ApprovalStatus,
                    flow_name: r.flowName,
                    current_step: r.currentStep,
                    steps_count: cfg?.steps.length ?? 0,
                    step_name: step ? stepLabel(step, r.currentStep) : '',
                    list_id: list.id,
                    list_slug: list.slug,
                    list_name: list.name,
                    list_icon: list.icon ?? null,
                    list_color: list.color ?? null,
                    record_id: record.id,
                    record_title: recordTitle(fieldsByList.get(list.id) ?? [], list, record),
                    requested_by_name: r.requestedBy !== null ? (names.get(r.requestedBy) ?? null) : r.automationName ? `Automatización «${r.automationName}»` : null,
                    requested_at: r.requestedAt.toISOString(),
                    note: r.note,
                    reason: r.reason,
                    resolved_at: r.resolvedAt?.toISOString() ?? null,
                };
            };

            const pending: ApprovalInboxItem[] = [];
            for (const r of pendingRows) {
                const list = listById.get(r.listId);
                const record = recordById.get(r.recordId);
                const cfg = readApprovalFlowConfig(r.config);
                const step = cfg?.steps[r.currentStep];
                if (!list || !record || !cfg || !step) continue;
                const approvers = await this.stepApprovers(tx, tenantId, list, step, record, r.requestedBy, cfg, members);
                if (!approvers.some((m) => m.userId === actor.userId)) continue;
                const it = item(r);
                if (it) pending.push(it);
                if (pending.length >= INBOX_MAX) break;
            }
            const mine: ApprovalInboxItem[] = [];
            for (const r of requested) {
                const list = listById.get(r.listId);
                const record = recordById.get(r.recordId);
                if (!list || !record || !canViewRecord(list, actor, record)) continue;
                const it = item(r);
                if (it) mine.push(it);
            }
            return { pending, requested: mine, pending_count: pending.length };
        });
    }

    // ─────────────────────────── Automatizaciones ───────────────────────────

    /** Lo que una automatización sabe de una solicitud (`{{aprobacion.x}}`). */
    async eventInfo(tenantId: number, req: ApprovalRequestRow): Promise<ApprovalEventInfo> {
        const ids = [req.requestedBy, req.resolvedBy].filter((u): u is number => u !== null);
        const names = ids.length > 0 ? await this.tenantDb.withTenant(tenantId, (tx) => this.names(tx, ids)) : new Map<number, string>();
        const status = req.status as ApprovalStatus;
        return {
            request_id: req.id,
            flow_id: req.flowId,
            flow_name: req.flowName,
            status,
            resultado: status === 'pending' ? '' : APPROVAL_RESULT_BY_STATUS[status],
            motivo: req.reason,
            decidio: req.resolvedBy !== null ? (names.get(req.resolvedBy) ?? '') : '',
            solicito: req.requestedBy !== null ? (names.get(req.requestedBy) ?? '') : req.automationName ? `Automatización «${req.automationName}»` : '',
            nota: req.note,
        };
    }

    /** Una solicitud por id (el motor la relee al reanudar «Esperar aprobación»). */
    async findForEngine(tenantId: number, requestId: number): Promise<ApprovalRequestRow | null> {
        return this.tenantDb.withTenant(tenantId, (tx) => this.repo.findRequest(tx, tenantId, requestId));
    }

    /**
     * La solicitud que espera «Esperar aprobación» cuando la corrida no pidió
     * una: la PENDIENTE del registro (del flujo elegido, o de cualquiera).
     */
    async findForWait(tenantId: number, recordId: number, flowId: number | null): Promise<ApprovalRequestRow | null> {
        return this.tenantDb.withTenant(tenantId, async (tx) => (await this.repo.pendingFor(tx, tenantId, recordId, flowId)) ?? null);
    }

    /** El nombre de un flujo (para los mensajes del motor y «Probar»). */
    async flowName(tenantId: number, flowId: number): Promise<string | null> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findFlow(tx, tenantId, flowId));
        return row?.name ?? null;
    }

    /** El último estado de la solicitud de un registro (resultado simulado de «Probar»). */
    async latestFor(tenantId: number, recordId: number, flowId: number | null): Promise<ApprovalRequestRow | null> {
        return this.tenantDb.withTenant(tenantId, (tx) => this.repo.latestFor(tx, tenantId, recordId, flowId));
    }

    // ─────────────────────────── Resolución de aprobadores ───────────────────────────

    /**
     * Quiénes pueden decidir un paso AHORA: el aprobador del paso resuelto en
     * vivo (el campo Persona de ahora, el rol de ahora), sólo miembros activos
     * del equipo, que PUEDEN VER el registro (ACL de la lista) y, salvo que el
     * flujo lo permita, sin quien pidió.
     *
     * Se resuelve en vivo y no se congela al entrar al paso: el caso habitual
     * de que cambie es reasignar (el jefe se fue de vacaciones), y ahí lo
     * correcto es que decida el nuevo. El cambio del campo queda en la
     * actividad del registro, y la regla «nadie aprueba lo suyo» impide que
     * quien pidió se ponga a sí mismo de aprobador para aprobarse.
     */
    async stepApprovers(
        tx: Tx,
        tenantId: number,
        list: List,
        step: ApprovalStep,
        record: RecordRowLite,
        requesterId: number | null,
        config: ApprovalFlowConfig,
        members: Map<number, Member>,
    ): Promise<Member[]> {
        const ids = await this.resolveApprovers(tx, tenantId, step.approver, record, members);
        const out: Member[] = [];
        for (const id of new Set(ids)) {
            const m = members.get(id);
            if (!m) continue;
            if (requesterId !== null && id === requesterId && !config.self_approval) continue;
            if (!canViewRecord(list, { userId: m.userId, role: m.role, teamIds: m.teamIds }, record)) continue;
            out.push(m);
        }
        return out;
    }

    /** El único punto donde un aprobador se convierte en personas (ids). */
    async resolveApprovers(tx: Tx, tenantId: number, approver: Approver, record: { data: Record<string, unknown> }, members: Map<number, Member>): Promise<number[]> {
        switch (approver.type) {
            case 'users':
                return approver.approver_user_ids.filter((id) => members.has(id));
            case 'role':
                return [...members.values()].filter((m) => m.role === approver.role).map((m) => m.userId);
            case 'field': {
                const raw = record.data[jsonbKeyForField(approver.approver_field_id)];
                const id = Number(raw);
                return Number.isInteger(id) && id > 0 && members.has(id) ? [id] : [];
            }
            case 'team':
                // C1 — las personas del equipo AHORA (lo conecta el módulo de
                // equipos con `setTeamMembersResolver`). Sin equipos, nadie.
                return this.teamMembers ? (await this.teamMembers(tx, tenantId, approver.team_id)).filter((id) => members.has(id)) : [];
        }
    }

    // ─────────────────────────── Helpers ───────────────────────────

    /** Las personas del equipo (id → nombre), para describir aprobadores fuera de una transacción. */
    async memberDirectory(tenantId: number): Promise<Array<{ id: number; name: string }>> {
        const members = await this.tenantDb.withTenant(tenantId, (tx) => this.loadMembers(tx, tenantId));
        return [...members.values()].map((m) => ({ id: m.userId, name: m.name }));
    }

    /** Los miembros activos del equipo (no clientes del portal), una consulta. */
    private async loadMembers(tx: Tx, tenantId: number): Promise<Map<number, Member>> {
        const rows = await tx
            .select({
                userId: memberships.userId,
                role: memberships.role,
                name: users.name,
                email: users.email,
                // C1 — sus equipos (para el acceso por equipo a la lista).
                teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), ne(memberships.role, 'client'), isNull(users.disabledAt)));
        return new Map(
            rows.map((r) => [
                r.userId,
                {
                    userId: r.userId,
                    role: r.role as Role,
                    name: r.name?.trim() || r.email,
                    teamIds: (r.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
                },
            ]),
        );
    }

    private async names(tx: Tx, ids: number[]): Promise<Map<number, string>> {
        const unique = [...new Set(ids)];
        if (unique.length === 0) return new Map();
        const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, unique));
        return new Map(rows.map((r) => [r.id, r.name?.trim() || r.email]));
    }

    private async userName(tenantId: number, id: number): Promise<string | null> {
        const names = await this.tenantDb.withTenant(tenantId, (tx) => this.names(tx, [id]));
        return names.get(id) ?? null;
    }

    private async recordLite(tx: Tx, tenantId: number, listId: number, recordId: number): Promise<RecordRowLite | null> {
        const [row] = await tx
            .select({ id: records.id, listId: records.listId, data: records.data, createdBy: records.createdBy })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), eq(records.id, recordId), isNull(records.deletedAt)))
            .limit(1);
        return row ? (row as RecordRowLite) : null;
    }

    private async requestsByIds(tx: Tx, tenantId: number, ids: number[]): Promise<ApprovalRequestRow[]> {
        const rows: ApprovalRequestRow[] = [];
        for (const id of ids) {
            const r = await this.repo.findRequest(tx, tenantId, id);
            if (r) rows.push(r);
        }
        return rows;
    }

    private async requestDto(tenantId: number, actor: ApprovalActor, list: List, fields: readonly Field[], requestId: number): Promise<ApprovalRequestDto> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const req = await this.repo.findRequest(tx, tenantId, requestId);
            if (!req) throw requestNotFound();
            const record = await this.recordLite(tx, tenantId, list.id, req.recordId);
            if (!record) throw requestNotFound();
            const members = await this.loadMembers(tx, tenantId);
            const [dto] = await this.toDtos(tx, tenantId, list, fields, record, [req], actor, members);
            return dto!;
        });
    }

    /** Solicitudes → DTO (pasos con aprobadores en vivo, decisiones con nombres). */
    private async toDtos(
        tx: Tx,
        tenantId: number,
        list: List,
        fields: readonly Field[],
        record: RecordRowLite,
        rows: ApprovalRequestRow[],
        viewer: ApprovalActor,
        members: Map<number, Member>,
    ): Promise<ApprovalRequestDto[]> {
        if (rows.length === 0) return [];
        const decisions = await this.repo.decisionsFor(tx, tenantId, rows.map((r) => r.id));
        const nameIds = [
            ...decisions.flatMap((d) => (d.userId !== null ? [d.userId] : [])),
            ...rows.flatMap((r) => [r.requestedBy, r.resolvedBy].filter((u): u is number => u !== null)),
        ];
        const names = await this.names(tx, nameIds);
        const fieldLabel = new Map(fields.map((f) => [f.id, f.label]));
        // C1 — el nombre del equipo de los pasos «equipo» (una consulta, sólo si hay).
        const hasTeamStep = rows.some((r) => (readApprovalFlowConfig(r.config)?.steps ?? []).some((s) => s.approver.type === 'team'));
        const teamNames = hasTeamStep && this.teamDirectory ? await this.teamDirectory(tx, tenantId) : new Map<number, { name: string }>();
        const out: ApprovalRequestDto[] = [];
        for (const r of rows) {
            const cfg = readApprovalFlowConfig(r.config);
            const steps = cfg?.steps ?? [];
            const mine = decisions.filter((d) => d.requestId === r.id);
            const status = r.status as ApprovalStatus;
            const userNames = new Map<number, string>();
            for (const s of steps) {
                if (s.approver.type === 'users') for (const id of s.approver.approver_user_ids) userNames.set(id, members.get(id)?.name ?? names.get(id) ?? `Persona #${id}`);
            }
            let current: Member[] = [];
            if (status === 'pending' && cfg && steps[r.currentStep]) {
                current = await this.stepApprovers(tx, tenantId, list, steps[r.currentStep]!, record, r.requestedBy, cfg, members);
            }
            const stepDtos: ApprovalStepDto[] = steps.map((s, i) => {
                const approvedHere = new Set(mine.filter((d) => d.step === i && d.decision === 'approve').map((d) => d.userId));
                const state: ApprovalStepDto['state'] =
                    status === 'approved'
                        ? 'done'
                        : i < r.currentStep
                          ? 'done'
                          : i === r.currentStep
                            ? status === 'pending'
                                ? 'current'
                                : 'stopped'
                            : status === 'pending'
                              ? 'upcoming'
                              : 'stopped';
                return {
                    id: s.id,
                    name: stepLabel(s, i),
                    mode: s.mode,
                    approver_label: describeApprover(s.approver, {
                        fieldLabel: s.approver.type === 'field' ? (fieldLabel.get(s.approver.approver_field_id) ?? null) : null,
                        userNames,
                        teamName: s.approver.type === 'team' ? (teamNames.get(s.approver.team_id)?.name ?? null) : null,
                    }),
                    state,
                    approvers:
                        state === 'current'
                            ? current.map((m) => ({ id: m.userId, name: m.name, approved: approvedHere.has(m.userId) }))
                            : [],
                };
            });
            const decided = mine.some((d) => d.step === r.currentStep && d.userId === viewer.userId);
            out.push({
                id: r.id,
                list_id: r.listId,
                record_id: r.recordId,
                flow_id: r.flowId,
                flow_name: r.flowName,
                status,
                current_step: r.currentStep,
                steps: stepDtos,
                requested_by: r.requestedBy !== null ? { id: r.requestedBy, name: names.get(r.requestedBy) ?? `Persona #${r.requestedBy}` } : null,
                source: r.source === 'automation' ? 'automation' : 'user',
                automation_name: r.automationName,
                requested_at: r.requestedAt.toISOString(),
                note: r.note,
                resolved_at: r.resolvedAt?.toISOString() ?? null,
                resolved_by: r.resolvedBy !== null ? { id: r.resolvedBy, name: names.get(r.resolvedBy) ?? `Persona #${r.resolvedBy}` } : null,
                reason: r.reason,
                decisions: mine.map(
                    (d): ApprovalDecisionDto => ({
                        id: d.id,
                        step: d.step,
                        user_id: d.userId,
                        user_name: d.userId !== null ? (names.get(d.userId) ?? null) : null,
                        decision: d.decision as ApprovalDecisionKind,
                        reason: d.reason,
                        created_at: d.createdAt.toISOString(),
                    }),
                ),
                can_decide: status === 'pending' && !decided && current.some((m) => m.userId === viewer.userId),
                can_cancel: status === 'pending' && (r.requestedBy === viewer.userId || viewer.role === 'admin'),
            });
        }
        return out;
    }
}

// ─────────────────────────── Puros ───────────────────────────

function toFlowDto(row: ApprovalFlowRow, pending: number): ApprovalFlow | null {
    const config = readApprovalFlowConfig(row.config);
    if (!config) return null;
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        description: row.description,
        config,
        is_active: row.isActive,
        pending_count: pending,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

/**
 * Por qué no se puede pedir un flujo para un registro (null = se puede): ya
 * hay una pendiente, o la última se rechazó y el flujo no deja pedir otra vez.
 */
export function requestBlock(config: ApprovalFlowConfig, rowsOfFlow: ReadonlyArray<Pick<ApprovalRequestRow, 'status' | 'id'>>, canEdit: boolean): string | null {
    if (!canEdit) return 'Para pedir una aprobación tienes que poder editar el registro.';
    const sorted = [...rowsOfFlow].sort((a, b) => b.id - a.id);
    if (sorted.some((r) => r.status === 'pending')) return 'Ya hay una solicitud pendiente de este flujo.';
    const last = sorted[0];
    if (last?.status === 'rejected' && !config.allow_resubmit) return 'Se rechazó y este flujo no deja pedirla otra vez.';
    return null;
}

/**
 * ¿Puede VER el registro? El mismo alcance que el listado: rol, persona y
 * C1 — equipos (acceso por equipo y «los asignados» por un campo Equipo).
 */
function canViewRecord(list: List, actor: ApprovalActor, record: RecordRowLite): boolean {
    return listRowInScope(list.settings, actor, 'view', { createdBy: record.createdBy, data: record.data });
}

function canEditRecord(records: RecordsService, list: List, actor: ApprovalActor, record: RecordRowLite): boolean {
    const caps = roleHasCapability(actor.role, 'edit_records') || roleHasCapability(actor.role, 'edit_own_records');
    return caps && records.canReach(list, actor, 'edit', { data: record.data, createdBy: record.createdBy });
}

function recordTitle(fields: readonly Field[], list: Pick<List, 'settings'>, record: RecordRowLite): string {
    const titleId = resolveTitleFieldId(fields.map((f) => ({ id: f.id, type: f.type })), list.settings);
    const raw = titleId !== null ? record.data[jsonbKeyForField(titleId)] : null;
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
    return fallbackWorkTitle([...fields], record.data, record.id);
}

function noApproversMessage(step: ApprovalStep, index: number, fields: readonly Field[], record: RecordRowLite): string {
    const name = stepLabel(step, index);
    if (step.approver.type === 'field') {
        const f = fields.find((x) => x.id === (step.approver as { approver_field_id: number }).approver_field_id);
        const empty = !record.data[jsonbKeyForField((step.approver as { approver_field_id: number }).approver_field_id)];
        return empty
            ? `Nadie puede aprobar «${name}»: el campo «${f?.label ?? 'Persona'}» está vacío en este registro.`
            : `Nadie puede aprobar «${name}»: la persona de «${f?.label ?? 'Persona'}» no puede (no ve el registro, no es del equipo o es quien pide).`;
    }
    return `Nadie puede aprobar «${name}»: revisa los aprobadores del flujo (tienen que ser del equipo, ver el registro y no ser quien pide).`;
}

function uniqueLabel(fields: readonly Field[], label: string): string {
    const taken = new Set(fields.map((f) => f.label.toLowerCase()));
    if (!taken.has(label.toLowerCase())) return label;
    for (let i = 2; i < 50; i++) {
        const next = `${label} ${i}`;
        if (!taken.has(next.toLowerCase())) return next;
    }
    return label;
}

function statusWord(status: ApprovalStatus): string {
    switch (status) {
        case 'approved':
            return 'aprobada';
        case 'rejected':
            return 'rechazada';
        case 'returned':
            return 'devuelta';
        case 'cancelled':
            return 'cancelada';
        default:
            return 'pendiente';
    }
}

function pgCode(err: unknown): string | undefined {
    const e = err as { code?: unknown; cause?: { code?: unknown } };
    const code = e?.code ?? e?.cause?.code;
    return typeof code === 'string' ? code : undefined;
}

function errorText(err: unknown): string {
    const resp = (err as { getResponse?: () => unknown }).getResponse?.();
    if (resp && typeof resp === 'object') {
        const r = resp as { message?: unknown; data?: { errors?: Record<string, unknown> } };
        if (r.data?.errors && Object.keys(r.data.errors).length > 0) {
            return Object.entries(r.data.errors).map(([k, v]) => `${k}: ${String(v)}`).join('; ');
        }
        if (typeof r.message === 'string') return r.message;
    }
    return err instanceof Error ? err.message : String(err);
}

function flowNotFound(): NotFoundException {
    return new NotFoundException({ code: 'approval_flow_not_found', message: 'Ese flujo de aprobación no existe en esta lista.', data: { status: 404 } });
}

function requestNotFound(): NotFoundException {
    return new NotFoundException({ code: 'approval_not_found', message: 'No se encontró esa solicitud de aprobación.', data: { status: 404 } });
}

function recordNotFound(): NotFoundException {
    return new NotFoundException({ code: 'record_not_found', message: 'Registro no encontrado', data: { status: 404 } });
}
