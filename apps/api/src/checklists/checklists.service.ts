import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    CHECKLIST_MAX_ITEMS,
    CHECKLIST_MAX_PER_RECORD,
    DEFAULT_CHECKLIST_NAME,
    FALLBACK_TIME_ZONE,
    checklistProgressOf,
    isChecklistComplete,
    jsonbKeyForField,
    pickDueField,
    readTemplateContent,
    resolveRelativeDate,
    resolveTemplatePerson,
    resolveTitleFieldId,
    zonedDayAndMinute,
    zonedInstant,
    type ActivityAction,
    type Checklist,
    type ChecklistCompletedInfo,
    type ChecklistItemInput,
    type CreateChecklistInput,
    type CreateChecklistItemsInput,
    type Field,
    type List,
    type RecordChecklists,
    type RecordDto,
    type UpdateChecklistInput,
    type UpdateChecklistItemInput,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import type { Tx } from '../db/client';
import { memberships, recordTemplates, users } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { resolvePermissions } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { NotifyHub } from '../notifications/notify-hub';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository, type RecordListRow } from '../records/records.repository';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { ChecklistsRepository, dueOf, type NewChecklistItem } from './checklists.repository';

/** Una asignación nueva de un ítem (para el aviso). */
export interface ChecklistAssignment {
    userId: number;
    text: string;
    checklist: string;
}

/** Lo que junta una operación sobre los checklists de un registro. */
interface MutationCtx {
    tx: Tx;
    tenantId: number;
    list: List;
    row: RecordListRow;
    actor: Actor;
    before: Checklist[];
    assigned: ChecklistAssignment[];
    log: (action: ActivityAction, diff: Record<string, unknown>) => Promise<void>;
}

/** Checklists a crear de una vez (plantillas): ítems ya resueltos. */
export interface ChecklistSpecResolved {
    name: string;
    items: NewChecklistItem[];
}

/**
 * A9 — Checklist dentro del registro.
 *
 * Permisos (los valida SIEMPRE el servidor): VER el registro es ver sus
 * checklists; marcar, editar, agregar, borrar o convertir un ítem exige poder
 * EDITAR el registro (el ACL de la lista: alcance por rol y accesos por
 * persona). Una lista de tienda SÍ lleva checklists: son trabajo interno sobre
 * el registro (como los comentarios o el tiempo) y nunca viajan a WooCommerce;
 * lo que no se puede es convertir un ítem en subtarea (sería un alta).
 *
 * Cada operación corre con un candado por registro y compara el antes y el
 * después: un checklist que QUEDA completo dispara «Cuando se completa un
 * checklist» (después del commit). Asignar un ítem a alguien le avisa.
 */
@Injectable()
export class ChecklistsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly repo: ChecklistsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        private readonly dispatcher: AutomationDispatcher,
        @Optional() private readonly notify?: NotifyHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ─────────────────────────── Lectura ───────────────────────────

    async forRecord(tenantId: number, actor: Actor, listKey: string, recordId: number): Promise<RecordChecklists> {
        const list = await this.lists.get(tenantId, listKey);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.recordsRepo.findById(tx, tenantId, list.id, recordId);
            if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(recordId);
            return this.forRecordInTx(tx, tenantId, recordId);
        });
    }

    /** Dentro de una transacción abierta (bundle de la ficha: el registro ya pasó el ACL). */
    async forRecordInTx(tx: Tx, tenantId: number, recordId: number): Promise<RecordChecklists> {
        return summarize(await this.repo.forRecord(tx, tenantId, recordId));
    }

    // ─────────────────────────── Checklists ───────────────────────────

    /** Un checklist nuevo: vacío, con ítems, o desde una plantilla de checklist de la lista. */
    async create(tenantId: number, actor: Actor, listKey: string, recordId: number, input: CreateChecklistInput): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            if (ctx.before.length >= CHECKLIST_MAX_PER_RECORD) {
                throw badRequest('checklist_limit', `Un registro puede tener hasta ${CHECKLIST_MAX_PER_RECORD} checklists.`);
            }
            let name = input.name?.trim() || DEFAULT_CHECKLIST_NAME;
            let items: NewChecklistItem[] = [];
            if (input.template_id !== undefined) {
                const tpl = await this.checklistTemplate(ctx.tx, tenantId, ctx.list.id, input.template_id);
                const spec = tpl.content.checklists[0];
                if (!input.name) name = spec?.name || tpl.name;
                const fields = await this.fields.listByListIdWithinTx(ctx.tx, tenantId, ctx.list.id);
                const tz = await this.timeZone(tenantId, ctx.tx);
                items = await this.validMembers(ctx.tx, tenantId, resolveItemSpecs(spec?.items ?? [], { now: new Date(), timeZone: tz, creatorId: actor.userId, data: ctx.row.data as Record<string, unknown>, fields }));
            } else if (input.items) {
                items = await this.normalizeItems(ctx.tx, tenantId, input.items);
            }
            if (items.length > CHECKLIST_MAX_ITEMS) items = items.slice(0, CHECKLIST_MAX_ITEMS);
            const cl = await this.repo.insertChecklist(ctx.tx, {
                tenantId,
                listId: ctx.list.id,
                recordId: ctx.row.id,
                name,
                createdBy: actor.userId > 0 ? actor.userId : null,
            });
            await this.repo.insertItems(ctx.tx, cl, items, actor.userId > 0 ? actor.userId : null);
            for (const it of items) if (it.assigneeId) ctx.assigned.push({ userId: it.assigneeId, text: it.text, checklist: name });
            await ctx.log('checklist_created', { checklist: { id: cl.id, name }, count: items.length, ...(input.template_id ? { template_id: input.template_id } : {}) });
        });
    }

    async rename(tenantId: number, actor: Actor, listKey: string, recordId: number, checklistId: number, patch: UpdateChecklistInput): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            const cl = ctx.before.find((c) => c.id === checklistId);
            if (!cl) throw checklistNotFound();
            if (patch.name !== undefined && patch.name !== cl.name) {
                await this.repo.renameChecklist(ctx.tx, tenantId, checklistId, patch.name);
                await ctx.log('checklist_updated', { checklist: { id: cl.id, name: patch.name }, from: cl.name });
            }
        });
    }

    async remove(tenantId: number, actor: Actor, listKey: string, recordId: number, checklistId: number): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            const cl = ctx.before.find((c) => c.id === checklistId);
            if (!cl) throw checklistNotFound();
            const n = await this.repo.deleteChecklist(ctx.tx, tenantId, checklistId);
            await ctx.log('checklist_deleted', { checklist: { id: cl.id, name: cl.name }, count: n });
        });
    }

    async reorderChecklists(tenantId: number, actor: Actor, listKey: string, recordId: number, ids: number[]): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            await this.repo.reorderChecklists(ctx.tx, tenantId, ctx.row.id, ids);
        });
    }

    // ─────────────────────────── Ítems ───────────────────────────

    async addItems(
        tenantId: number,
        actor: Actor,
        listKey: string,
        recordId: number,
        checklistId: number,
        input: CreateChecklistItemsInput,
    ): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            const cl = ctx.before.find((c) => c.id === checklistId);
            if (!cl) throw checklistNotFound();
            if (cl.items.length + input.items.length > CHECKLIST_MAX_ITEMS) {
                throw badRequest('checklist_items_limit', `Un checklist admite hasta ${CHECKLIST_MAX_ITEMS} ítems.`);
            }
            const items = await this.normalizeItems(ctx.tx, tenantId, input.items);
            const row = await this.repo.findChecklist(ctx.tx, tenantId, checklistId);
            if (!row) throw checklistNotFound();
            await this.repo.insertItems(ctx.tx, row, items, actor.userId > 0 ? actor.userId : null, input.after_id ?? null);
            for (const it of items) if (it.assigneeId) ctx.assigned.push({ userId: it.assigneeId, text: it.text, checklist: cl.name });
            await ctx.log('checklist_items_added', {
                checklist: { id: cl.id, name: cl.name },
                count: items.length,
                items: items.slice(0, 5).map((i) => i.text),
            });
        });
    }

    async updateItem(
        tenantId: number,
        actor: Actor,
        listKey: string,
        recordId: number,
        itemId: number,
        patch: UpdateChecklistItemInput,
    ): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            const { cl, item } = findItem(ctx.before, itemId);
            const set: Parameters<ChecklistsRepository['updateItem']>[3] = {};
            const changes: Record<string, { from: unknown; to: unknown }> = {};
            if (patch.text !== undefined && patch.text !== item.text) {
                set.text = patch.text;
                changes.text = { from: item.text, to: patch.text };
            }
            if (patch.assignee_id !== undefined && patch.assignee_id !== item.assignee_id) {
                if (patch.assignee_id !== null) await this.assertMembers(ctx.tx, tenantId, [patch.assignee_id]);
                set.assigneeId = patch.assignee_id;
                changes.assignee_id = { from: item.assignee_id, to: patch.assignee_id };
                if (patch.assignee_id !== null) ctx.assigned.push({ userId: patch.assignee_id, text: patch.text ?? item.text, checklist: cl.name });
            }
            if (patch.due !== undefined && (patch.due ?? null) !== item.due) {
                set.due = patch.due ?? null;
                changes.due = { from: item.due, to: patch.due ?? null };
            }
            if (patch.checklist_id !== undefined && patch.checklist_id !== cl.id) {
                const target = ctx.before.find((c) => c.id === patch.checklist_id);
                if (!target) throw checklistNotFound();
                if (target.items.length >= CHECKLIST_MAX_ITEMS) {
                    throw badRequest('checklist_items_limit', `Un checklist admite hasta ${CHECKLIST_MAX_ITEMS} ítems.`);
                }
                set.checklistId = target.id;
                set.position = await this.repo.nextItemPosition(ctx.tx, tenantId, target.id);
                changes.checklist = { from: cl.name, to: target.name };
            }
            const toggled = patch.done !== undefined && patch.done !== item.done;
            if (toggled) {
                set.done = patch.done!;
                set.doneAt = patch.done ? new Date() : null;
                set.doneBy = patch.done && actor.userId > 0 ? actor.userId : null;
            }
            if (Object.keys(set).length === 0) return;
            await this.repo.updateItem(ctx.tx, tenantId, itemId, set);
            const ref = { checklist: { id: cl.id, name: cl.name }, item: { id: item.id, text: set.text ?? item.text } };
            if (toggled) await ctx.log(patch.done ? 'checklist_item_checked' : 'checklist_item_unchecked', ref);
            if (Object.keys(changes).length > 0) await ctx.log('checklist_item_updated', { ...ref, changes });
        });
    }

    async removeItem(tenantId: number, actor: Actor, listKey: string, recordId: number, itemId: number): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            const { cl, item } = findItem(ctx.before, itemId);
            await this.repo.deleteItem(ctx.tx, tenantId, itemId);
            await ctx.log('checklist_item_deleted', { checklist: { id: cl.id, name: cl.name }, item: { id: item.id, text: item.text } });
        });
    }

    async reorderItems(tenantId: number, actor: Actor, listKey: string, recordId: number, checklistId: number, ids: number[]): Promise<RecordChecklists> {
        return this.mutate(tenantId, actor, listKey, recordId, async (ctx) => {
            if (!ctx.before.some((c) => c.id === checklistId)) throw checklistNotFound();
            await this.repo.reorderItems(ctx.tx, tenantId, checklistId, ids);
        });
    }

    /**
     * Convertir un ítem en SUBTAREA: crea el registro hijo (título = el texto;
     * responsable y fecha del ítem en el campo de asignación/persona y en el
     * de vencimiento de la lista, si los hay) y quita el ítem — todo en una
     * transacción. Una subtarea no puede tener subtareas (un solo nivel), y en
     * una lista de tienda no se crean registros.
     */
    async convertToSubtask(
        tenantId: number,
        actor: Actor,
        listKey: string,
        recordId: number,
        itemId: number,
    ): Promise<{ record: RecordDto; checklists: RecordChecklists }> {
        const list = await this.lists.get(tenantId, listKey);
        this.records.assertCanCreate(list, actor);
        const fields = await this.fields.listByListId(tenantId, list.id);
        // Primero se lee el ítem (para armar el alta con el validador de siempre)…
        const peek = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.recordsRepo.findById(tx, tenantId, list.id, recordId);
            if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(recordId);
            if (!this.records.canReach(list, actor, 'edit', row)) throw cannotEdit();
            if (row.parentId !== null) {
                throw badRequest('subtask_depth', 'Este registro ya es una subtarea: una subtarea no puede tener subtareas.');
            }
            const item = await this.repo.findItem(tx, tenantId, itemId);
            if (!item || item.recordId !== recordId) throw itemNotFound();
            return item;
        });
        const tz = await this.timeZone(tenantId);
        const data = subtaskDataFor(list, fields, { text: peek.text, assigneeId: peek.assigneeId, due: dueOf(peek) }, tz);
        const prep = await this.records.prepareCreate(tenantId, actor, list, fields, { data, parent_id: recordId }, { lenientRequired: true });
        const planCap = await this.records.planRoomChecker(tenantId, 1);
        let createdRow: { id: number; data: Record<string, unknown> } | null = null;
        const result = await this.mutate(
            tenantId,
            actor,
            String(list.id),
            recordId,
            async (ctx) => {
                const { cl, item } = findItem(ctx.before, itemId);
                if (planCap) await planCap(ctx.tx);
                const inserted = await this.records.insertPreparedInTx(ctx.tx, tenantId, actor, prep);
                createdRow = { id: inserted.id, data: inserted.data as Record<string, unknown> };
                await this.repo.deleteItem(ctx.tx, tenantId, item.id);
                await ctx.log('checklist_item_to_subtask', { checklist: { id: cl.id, name: cl.name }, item: { id: item.id, text: item.text }, subtask_id: inserted.id });
            },
            { list },
        );
        const created = createdRow as { id: number; data: Record<string, unknown> } | null;
        if (!created) throw itemNotFound();
        this.records.afterCreate(tenantId, actor, prep, created);
        const record = await this.records.get(tenantId, actor, String(list.id), created.id);
        return { record, checklists: result };
    }

    // ─────────────────────────── Plantillas (en la tx del alta) ───────────────────────────

    /**
     * Crea checklists ya resueltos en un registro DENTRO de una transacción
     * abierta (plantillas de registro). Devuelve los ids y las asignaciones
     * para avisar después del commit (`announceAssignments`).
     */
    async insertResolvedInTx(
        tx: Tx,
        tenantId: number,
        list: Pick<List, 'id'>,
        recordId: number,
        specs: ChecklistSpecResolved[],
        actorId: number,
    ): Promise<{ ids: number[]; assigned: ChecklistAssignment[] }> {
        const ids: number[] = [];
        const assigned: ChecklistAssignment[] = [];
        const existing = await this.repo.countChecklists(tx, tenantId, recordId);
        for (const spec of specs.slice(0, Math.max(0, CHECKLIST_MAX_PER_RECORD - existing))) {
            const cl = await this.repo.insertChecklist(tx, {
                tenantId,
                listId: list.id,
                recordId,
                name: spec.name,
                createdBy: actorId > 0 ? actorId : null,
            });
            const items = await this.validMembers(tx, tenantId, spec.items.slice(0, CHECKLIST_MAX_ITEMS));
            await this.repo.insertItems(tx, cl, items, actorId > 0 ? actorId : null);
            for (const it of items) if (it.assigneeId) assigned.push({ userId: it.assigneeId, text: it.text, checklist: spec.name });
            ids.push(cl.id);
        }
        return { ids, assigned };
    }

    /** Los avisos de ítems asignados (después del commit). */
    announceAssignments(tenantId: number, listId: number, recordId: number, actorId: number, assigned: ChecklistAssignment[]): void {
        const others = assigned.filter((a) => a.userId !== actorId);
        if (others.length === 0 || !this.notify) return;
        this.notify.emit({ type: 'checklist_assigned', tenantId, listId, recordId, actorId, assignments: others });
    }

    // ─────────────────────────── Internos ───────────────────────────

    /**
     * Esqueleto de toda escritura: el registro tiene que verse y poder
     * editarse; candado por registro; antes y después para detectar los
     * checklists que QUEDARON completos. Después del commit: realtime,
     * disparador y avisos.
     */
    private async mutate(
        tenantId: number,
        actor: Actor,
        listKey: string,
        recordId: number,
        fn: (ctx: MutationCtx) => Promise<void>,
        opts: { list?: List } = {},
    ): Promise<RecordChecklists> {
        const list = opts.list ?? (await this.lists.get(tenantId, listKey));
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.repo.lockRecord(tx, tenantId, recordId);
            const row = await this.recordsRepo.findById(tx, tenantId, list.id, recordId);
            if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(recordId);
            if (!this.records.canReach(list, actor, 'edit', row)) throw cannotEdit();
            const before = await this.repo.forRecord(tx, tenantId, recordId);
            const assigned: ChecklistAssignment[] = [];
            const ctx: MutationCtx = {
                tx,
                tenantId,
                list,
                row,
                actor,
                before,
                assigned,
                log: (action, diff) =>
                    this.activity.logInTx(tx, {
                        tenantId,
                        listId: list.id,
                        recordId,
                        userId: actor.userId > 0 ? actor.userId : null,
                        action,
                        diff,
                    }),
            };
            await fn(ctx);
            const after = await this.repo.forRecord(tx, tenantId, recordId);
            return { after, row, assigned, completed: completedChecklists(before, after) };
        });
        this.realtime.records(tenantId, list.id);
        for (const info of out.completed) {
            this.dispatcher.dispatch({
                tenantId,
                listId: list.id,
                recordId,
                trigger: 'checklist_completed',
                after: out.row.data as Record<string, unknown>,
                checklist: info,
            });
        }
        this.announceAssignments(tenantId, list.id, recordId, actor.userId, out.assigned);
        return summarize(out.after);
    }

    private async checklistTemplate(tx: Tx, tenantId: number, listId: number, templateId: number) {
        const [row] = await tx
            .select()
            .from(recordTemplates)
            .where(and(eq(recordTemplates.tenantId, tenantId), eq(recordTemplates.id, templateId), eq(recordTemplates.listId, listId)))
            .limit(1);
        if (!row) {
            throw new NotFoundException({ code: 'template_not_found', message: 'La plantilla no existe en esta lista.', data: { status: 404 } });
        }
        return { name: row.name, content: readTemplateContent(row.content) };
    }

    /** Ítems de la persona → filas (responsable validado como miembro). */
    private async normalizeItems(tx: Tx, tenantId: number, items: ChecklistItemInput[]): Promise<NewChecklistItem[]> {
        const ids = [...new Set(items.map((i) => i.assignee_id).filter((v): v is number => typeof v === 'number'))];
        if (ids.length > 0) await this.assertMembers(tx, tenantId, ids);
        return items.map((i) => ({ text: i.text, assigneeId: i.assignee_id ?? null, due: i.due ?? null, done: i.done === true }));
    }

    /** Responsable que no es miembro (o no del equipo) → 400. */
    private async assertMembers(tx: Tx, tenantId: number, ids: number[]): Promise<void> {
        const ok = await this.memberIds(tx, tenantId, ids);
        const bad = ids.filter((id) => !ok.has(id));
        if (bad.length > 0) {
            throw new BadRequestException({
                code: 'not_a_member',
                message: 'El responsable tiene que ser una persona del equipo de esta empresa.',
                data: { status: 400, errors: { assignee_id: bad.join(', ') } },
            });
        }
    }

    /** En una plantilla, un responsable que ya no es del equipo queda vacío (sin fallar el alta). */
    private async validMembers(tx: Tx, tenantId: number, items: NewChecklistItem[]): Promise<NewChecklistItem[]> {
        const ids = [...new Set(items.map((i) => i.assigneeId).filter((v): v is number => v !== null))];
        if (ids.length === 0) return items;
        const ok = await this.memberIds(tx, tenantId, ids);
        return items.map((i) => (i.assigneeId !== null && !ok.has(i.assigneeId) ? { ...i, assigneeId: null } : i));
    }

    private async memberIds(tx: Tx, tenantId: number, ids: number[]): Promise<Set<number>> {
        if (ids.length === 0) return new Set();
        const rows = await tx
            .select({ id: memberships.userId, role: memberships.role })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, ids), isNull(users.disabledAt)));
        return new Set(rows.filter((r) => r.role !== 'client').map((r) => r.id));
    }

    private async timeZone(tenantId: number, tx?: Tx): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE;
    }
}

// ─────────────────────────── Puros ───────────────────────────

function summarize(checklists: Checklist[]): RecordChecklists {
    const all = checklists.flatMap((c) => c.items);
    const p = checklistProgressOf(all);
    return { checklists, done: p.done, total: p.total };
}

/**
 * Los checklists que QUEDARON completos con esta operación (no lo estaban
 * antes, o no existían). `all_done` se marca sólo en el último: así «cuando
 * se completan todos» dispara una vez aunque se completen dos juntos.
 */
export function completedChecklists(before: Checklist[], after: Checklist[]): ChecklistCompletedInfo[] {
    const wasComplete = new Map(before.map((c) => [c.id, isChecklistComplete(c.items)]));
    const allDone = after.length > 0 && after.every((c) => isChecklistComplete(c.items));
    const out: ChecklistCompletedInfo[] = [];
    for (const c of after) {
        if (!isChecklistComplete(c.items) || wasComplete.get(c.id) === true) continue;
        out.push({ id: c.id, name: c.name, all_done: false, total: c.items.length });
    }
    if (allDone && out.length > 0) out[out.length - 1]!.all_done = true;
    return out;
}

/**
 * Los datos de la subtarea que nace de un ítem: el título (campo de título de
 * la lista), el responsable (el campo de asignación del ACL o el primer campo
 * Persona) y la fecha (el campo de vencimiento: el que lo dice en el nombre o
 * el primero). Una fecha con hora va a un campo fecha como el día en la zona
 * de la empresa; una fecha sin hora a un campo fecha y hora, a las 9:00.
 */
export function subtaskDataFor(
    list: List,
    fields: Field[],
    item: { text: string; assigneeId: number | null; due: string | null },
    timeZone: string,
): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
    if (titleId !== null) data[jsonbKeyForField(titleId)] = item.text;
    if (item.assigneeId !== null) {
        const assignment = resolvePermissions(list.settings as Record<string, unknown>).assignment_field_id;
        const userField = fields.find((f) => f.id === assignment && f.type === 'user') ?? fields.find((f) => f.type === 'user');
        if (userField) data[jsonbKeyForField(userField.id)] = item.assigneeId;
    }
    if (item.due !== null) {
        const dueField = pickDueField(fields);
        if (dueField) {
            const hasTime = item.due.includes('T');
            if (dueField.type === 'date') {
                data[jsonbKeyForField(dueField.id)] = hasTime ? zonedDayAndMinute(new Date(item.due), timeZone).ymd : item.due;
            } else {
                data[jsonbKeyForField(dueField.id)] = hasTime ? item.due : zonedInstant(item.due, timeZone, { h: 9 }).toISOString();
            }
        }
    }
    return data;
}

/** Ítems de una plantilla → ítems a insertar (fechas relativas y personas resueltas). */
export function resolveItemSpecs(
    items: ReadonlyArray<{ text: string; assignee: Parameters<typeof resolveTemplatePerson>[0] | null; due: Parameters<typeof resolveRelativeDate>[0] | null }>,
    ctx: { now: Date; timeZone: string; creatorId: number; data: Record<string, unknown>; fields: ReadonlyArray<{ id: number; type: string }> },
): NewChecklistItem[] {
    return items.map((i) => ({
        text: i.text,
        assigneeId: i.assignee ? resolveTemplatePerson(i.assignee, { creatorId: ctx.creatorId, data: ctx.data }) : null,
        due: i.due ? resolveRelativeDate(i.due, { now: ctx.now, timeZone: ctx.timeZone, data: ctx.data, withTime: i.due.time !== null }) : null,
    }));
}

function findItem(checklists: Checklist[], itemId: number): { cl: Checklist; item: Checklist['items'][number] } {
    for (const cl of checklists) {
        const item = cl.items.find((i) => i.id === itemId);
        if (item) return { cl, item };
    }
    throw itemNotFound();
}

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function recordNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'record_not_found', message: `Registro ${id} no encontrado`, data: { status: 404 } });
}

function checklistNotFound(): NotFoundException {
    return new NotFoundException({ code: 'checklist_not_found', message: 'Ese checklist no existe en este registro.', data: { status: 404 } });
}

function itemNotFound(): NotFoundException {
    return new NotFoundException({ code: 'checklist_item_not_found', message: 'Ese ítem no existe en este registro.', data: { status: 404 } });
}

function cannotEdit(): ForbiddenException {
    return new ForbiddenException({
        code: 'forbidden',
        message: 'No tienes permiso para cambiar los checklists de este registro.',
        data: { status: 403 },
    });
}
