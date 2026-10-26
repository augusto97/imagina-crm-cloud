import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    FALLBACK_TIME_ZONE,
    RECORD_TEMPLATE_MAX_PER_LIST,
    isTemplateValueType,
    jsonbKeyForField,
    readTemplateContent,
    recordTemplateContentSchema,
    relativeFromAbsolute,
    resolveTemplateValues,
    resolveTitleFieldId,
    sanitizeRichDoc,
    remapTemplateContent,
    templateRefs,
    validateFieldValue,
    type ChecklistTemplateFromChecklistInput,
    type CreateFromTemplateInput,
    type CreateRecordTemplateInput,
    type Field,
    type FieldType,
    type FromTemplateResult,
    type List,
    type RecordDto,
    type RecordTemplate,
    type RecordTemplateContent,
    type RecordTemplateFromRecordInput,
    type RecordTemplateKind,
    type TemplateChecklist,
    type TemplateValues,
    type UpdateRecordTemplateInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import type { AutomationChain } from '../automations/automation-dispatcher.service';
import { ChecklistsRepository } from '../checklists/checklists.repository';
import { ChecklistsService, resolveItemSpecs, type ChecklistAssignment, type ChecklistSpecResolved } from '../checklists/checklists.service';
import type { Tx } from '../db/client';
import { automations, forms, memberships, records, recordTemplates, users, type RecordTemplateRow } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsRepository, type RecordRow } from '../records/records.repository';
import { RecordsService, type Actor, type PreparedCreate } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

/** Lo que crea una plantilla (uso interno: el registro raíz con sus datos). */
export interface FromTemplateOutcome extends FromTemplateResult {
    record: { id: number; data: Record<string, unknown> };
}

/** Opciones del alta desde una plantilla. */
export interface FromTemplateOptions {
    /** Lo pide una automatización (cadena: tope y sin auto-disparo). */
    automationChain?: AutomationChain;
    /** Crear aunque falte un obligatorio (automatizaciones; el motor lo avisa). */
    lenientRequired?: boolean;
}

/**
 * C6 — Plantillas de registro (y de checklist, A9).
 *
 * Una plantilla de registro crea, en UNA transacción, el registro con sus
 * valores, sus subtareas (con responsable y fecha relativa) y sus checklists:
 * todo pasa por el mismo camino que un alta normal (validación, valores por
 * defecto, «obligatorio si», unicidad, actividad) y, después del commit,
 * dispara las automatizaciones de «Cuando se crea un registro» de cada uno.
 * El límite de registros del plan se verifica para el LOTE entero.
 *
 * Administrarlas pide `manage_lists` o `manage_views` (las curan admins y
 * managers); usarlas, crear registros en la lista.
 */
@Injectable()
export class RecordTemplatesService {
    private readonly logger = new Logger(RecordTemplatesService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly checklists: ChecklistsService,
        private readonly checklistsRepo: ChecklistsRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly audit?: AuditService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ─────────────────────────── CRUD ───────────────────────────

    async list(tenantId: number, listKey: string, kind?: RecordTemplateKind): Promise<RecordTemplate[]> {
        const list = await this.lists.get(tenantId, listKey);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(recordTemplates)
                .where(
                    and(
                        eq(recordTemplates.tenantId, tenantId),
                        eq(recordTemplates.listId, list.id),
                        kind ? eq(recordTemplates.kind, kind) : undefined,
                    ),
                )
                .orderBy(asc(recordTemplates.position), asc(recordTemplates.id)),
        );
        return rows.map(toDto);
    }

    async get(tenantId: number, listKey: string, id: number): Promise<RecordTemplate> {
        const list = await this.lists.get(tenantId, listKey);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.find(tx, tenantId, list.id, id));
        return toDto(row);
    }

    async create(tenantId: number, actorId: number, listKey: string, input: CreateRecordTemplateInput): Promise<RecordTemplate> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [count] = await tx
                .select({ n: sql<number>`count(*)::int`, p: sql<number>`coalesce(max(${recordTemplates.position}), -1)::int` })
                .from(recordTemplates)
                .where(and(eq(recordTemplates.tenantId, tenantId), eq(recordTemplates.listId, list.id), eq(recordTemplates.kind, input.kind)));
            if ((count?.n ?? 0) >= RECORD_TEMPLATE_MAX_PER_LIST) {
                throw badRequest('template_limit', `Una lista admite hasta ${RECORD_TEMPLATE_MAX_PER_LIST} plantillas de cada tipo.`);
            }
            const content = await this.sanitize(tx, tenantId, fields, input.kind, input.content);
            const [inserted] = await tx
                .insert(recordTemplates)
                .values({
                    tenantId,
                    listId: list.id,
                    kind: input.kind,
                    name: input.name,
                    description: input.description ?? null,
                    icon: input.icon ?? null,
                    color: input.color ?? null,
                    content,
                    position: (count?.p ?? -1) + 1,
                    createdBy: actorId > 0 ? actorId : null,
                })
                .returning();
            return inserted!;
        });
        void this.audit?.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'record_template.create',
            targetType: 'list',
            targetId: list.id,
            targetLabel: `${list.name} · ${row.name}`,
            meta: { template_id: row.id, kind: row.kind },
        });
        this.realtime.records(tenantId, list.id);
        return toDto(row);
    }

    async update(tenantId: number, actorId: number, listKey: string, id: number, patch: UpdateRecordTemplateInput): Promise<RecordTemplate> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.find(tx, tenantId, list.id, id);
            const set: Partial<typeof recordTemplates.$inferInsert> = { updatedAt: new Date() };
            if (patch.name !== undefined) set.name = patch.name;
            if (patch.description !== undefined) set.description = patch.description;
            if (patch.icon !== undefined) set.icon = patch.icon;
            if (patch.color !== undefined) set.color = patch.color;
            if (patch.content !== undefined) {
                set.content = await this.sanitize(tx, tenantId, fields, current.kind as RecordTemplateKind, patch.content);
            }
            const [updated] = await tx
                .update(recordTemplates)
                .set(set)
                .where(and(eq(recordTemplates.tenantId, tenantId), eq(recordTemplates.id, id)))
                .returning();
            return updated!;
        });
        void this.audit?.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'record_template.update',
            targetType: 'list',
            targetId: list.id,
            targetLabel: `${list.name} · ${row.name}`,
            meta: { template_id: row.id },
        });
        this.realtime.records(tenantId, list.id);
        return toDto(row);
    }

    /**
     * Borrar. Una plantilla que usa una automatización («Crear subtareas desde
     * una plantilla», «Crear un registro» con plantilla) o un formulario no se
     * borra: 409 con quiénes la usan (si no, dejarían de hacer lo suyo sin
     * avisar).
     */
    async remove(tenantId: number, actorId: number, listKey: string, id: number): Promise<void> {
        const list = await this.lists.get(tenantId, listKey);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.find(tx, tenantId, list.id, id);
            const users_ = await this.usage(tx, tenantId, id);
            if (users_.length > 0) {
                throw new ConflictException({
                    code: 'template_in_use',
                    message: `La plantilla se usa en: ${users_.join(', ')}. Cámbialas antes de borrarla.`,
                    data: { status: 409, used_by: users_ },
                });
            }
            await tx.delete(recordTemplates).where(and(eq(recordTemplates.tenantId, tenantId), eq(recordTemplates.id, id)));
            return current;
        });
        void this.audit?.log({
            tenantId,
            userId: actorId > 0 ? actorId : null,
            action: 'record_template.delete',
            targetType: 'list',
            targetId: list.id,
            targetLabel: `${list.name} · ${row.name}`,
            meta: { template_id: row.id, kind: row.kind },
        });
        this.realtime.records(tenantId, list.id);
    }

    /** Quién usa una plantilla: automatizaciones (por nombre) y formularios. */
    private async usage(tx: Tx, tenantId: number, id: number): Promise<string[]> {
        const out: string[] = [];
        const autos = await tx
            .select({ name: automations.name, actions: automations.actions })
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), isNull(automations.deletedAt)));
        for (const a of autos) if (actionsUseTemplate(a.actions, id)) out.push(`la automatización «${a.name}»`);
        const fs = await tx
            .select({ name: forms.name, config: forms.config })
            .from(forms)
            .where(and(eq(forms.tenantId, tenantId), sql`(${forms.config}->'settings'->>'record_template_id')::text = ${String(id)}`));
        for (const f of fs) out.push(`el formulario «${f.name}»`);
        return out;
    }

    // ─────────────────────────── Desde un registro ───────────────────────────

    /**
     * «Guardar como plantilla» desde la ficha: los valores del registro (sin
     * el título, que es el nombre de ESE registro, ni los campos «Sin
     * repetidos», que chocarían en el segundo uso), sus subtareas y sus
     * checklists. Las fechas absolutas se vuelven relativas respecto de hoy.
     */
    async fromRecord(tenantId: number, actor: Actor, listKey: string, input: RecordTemplateFromRecordInput): Promise<RecordTemplate> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const tz = await this.timeZone(tenantId);
        const now = new Date();
        const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
        const toValues = (data: Record<string, unknown>, skipTitle: boolean): TemplateValues => {
            const out: TemplateValues = {};
            for (const f of fields) {
                if (!isTemplateValueType(f.type) || f.is_unique || (skipTitle && f.id === titleId)) continue;
                const key = jsonbKeyForField(f.id);
                const v = data[key];
                if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
                if (f.type === 'date' || f.type === 'datetime') {
                    const rel = relativeFromAbsolute(v, { now, timeZone: tz });
                    if (rel) out[key] = { mode: 'relative_date', date: rel };
                } else if (f.type === 'user') {
                    out[key] = { mode: 'person', person: { kind: 'user', user_id: Number(v) } };
                } else {
                    out[key] = { mode: 'fixed', value: v };
                }
            }
            return out;
        };
        const content = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.recordsRepo.findById(tx, tenantId, list.id, input.record_id);
            if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(input.record_id);
            const data = row.data as Record<string, unknown>;
            const out: RecordTemplateContent = { values: {}, subtasks: [], checklists: [], record_description: null };
            if (input.include.values) out.values = toValues(data, true);
            if (input.include.subtasks && row.parentId === null) {
                const subs = await tx
                    .select({ id: records.id, data: records.data })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.parentId, row.id), isNull(records.deletedAt)))
                    .orderBy(asc(records.id))
                    .limit(50);
                for (const s of subs) {
                    const sd = s.data as Record<string, unknown>;
                    const t = titleId !== null ? sd[jsonbKeyForField(titleId)] : null;
                    out.subtasks.push({ title: typeof t === 'string' && t.trim() ? t.trim().slice(0, 500) : `Subtarea ${out.subtasks.length + 1}`, values: toValues(sd, true) });
                }
            }
            if (input.include.checklists) {
                for (const c of (await this.checklistsRepo.forRecord(tx, tenantId, row.id)).slice(0, 10)) {
                    out.checklists.push({
                        name: c.name,
                        items: c.items.map((i) => ({
                            text: i.text,
                            assignee: i.assignee_id ? { kind: 'user' as const, user_id: i.assignee_id } : null,
                            due: i.due ? relativeFromAbsolute(i.due, { now, timeZone: tz }) : null,
                        })),
                    });
                }
            }
            if (input.include.description && row.hasDescription) {
                out.record_description = (await this.recordsRepo.findDescription(tx, tenantId, list.id, row.id))?.description ?? null;
            }
            return this.withoutFormerMembers(tx, tenantId, out);
        });
        return this.create(tenantId, actor.userId, String(list.id), {
            kind: 'record',
            name: input.name,
            description: input.description ?? null,
            icon: input.icon ?? null,
            content,
        });
    }

    /** Un checklist de un registro → plantilla de checklist de la lista. */
    async fromChecklist(tenantId: number, actor: Actor, listKey: string, input: ChecklistTemplateFromChecklistInput): Promise<RecordTemplate> {
        const list = await this.lists.get(tenantId, listKey);
        const tz = await this.timeZone(tenantId);
        const now = new Date();
        const spec = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const cl = await this.checklistsRepo.findChecklist(tx, tenantId, input.checklist_id);
            if (!cl || cl.listId !== list.id) throw new NotFoundException({ code: 'checklist_not_found', message: 'Ese checklist no existe en esta lista.', data: { status: 404 } });
            const row = await this.recordsRepo.findById(tx, tenantId, list.id, cl.recordId);
            if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(cl.recordId);
            const full = (await this.checklistsRepo.forRecord(tx, tenantId, row.id)).find((c) => c.id === cl.id)!;
            const out: TemplateChecklist = {
                name: full.name,
                items: full.items.map((i) => ({
                    text: i.text,
                    assignee: i.assignee_id ? { kind: 'user' as const, user_id: i.assignee_id } : null,
                    due: i.due ? relativeFromAbsolute(i.due, { now, timeZone: tz }) : null,
                })),
            };
            const content = await this.withoutFormerMembers(tx, tenantId, { values: {}, subtasks: [], checklists: [out], record_description: null });
            return content.checklists[0] ?? out;
        });
        return this.create(tenantId, actor.userId, String(list.id), {
            kind: 'checklist',
            name: input.name ?? spec.name,
            content: { values: {}, subtasks: [], checklists: [spec], record_description: null },
        });
    }

    // ─────────────────────────── Usar ───────────────────────────

    /**
     * Alta desde una plantilla: el registro (lo que trae `input.data` pisa la
     * plantilla), sus subtareas y sus checklists, en UNA transacción.
     */
    async createFromTemplate(
        tenantId: number,
        actor: Actor,
        listKey: string,
        input: CreateFromTemplateInput,
        opts: FromTemplateOptions = {},
    ): Promise<FromTemplateOutcome> {
        const list = await this.lists.get(tenantId, listKey);
        this.records.assertCanCreate(list, actor);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const tpl = await this.tenantDb.withTenant(tenantId, (tx) => this.find(tx, tenantId, list.id, input.template_id));
        if (tpl.kind !== 'record') throw badRequest('template_kind', 'Esa es una plantilla de checklist: se aplica desde la ficha de un registro.');
        const content = readTemplateContent(tpl.content);
        const tz = await this.timeZone(tenantId);
        const now = new Date();
        const warnings: string[] = [];

        // El registro principal: la plantilla, y encima lo que trae el alta.
        const root = resolveTemplateValues(content.values, fields, { now, timeZone: tz, creatorId: actor.userId, base: input.data });
        warnings.push(...root.warnings);
        const rootData = await this.dropNonMembers(tenantId, fields, { ...root.data, ...input.data }, new Set(Object.keys(input.data)), warnings);
        const lenient = opts.lenientRequired === true;
        const rootPrep = await this.records.prepareCreate(tenantId, actor, list, fields, { data: rootData, parent_id: input.parent_id ?? null }, { lenientRequired: lenient });

        // Subtareas: leen el registro principal YA resuelto (fechas desde un
        // campo, personas desde un campo Persona). Una subtarea no puede tener
        // subtareas: si el registro nace como subtarea, sus subtareas no van.
        const subPreps: PreparedCreate[] = [];
        if (content.subtasks.length > 0 && (input.parent_id ?? null) !== null) {
            warnings.push('El registro nace como subtarea: las subtareas de la plantilla no se crearon (una subtarea no puede tener subtareas).');
        } else {
            for (const s of content.subtasks) {
                subPreps.push(await this.prepareSubtask(tenantId, actor, list, fields, s, rootPrep.data, { now, tz, lenient }, warnings));
            }
        }

        const planCheck = await this.records.planRoomChecker(tenantId, 1 + subPreps.length);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (planCheck) await planCheck(tx);
            const rootRow = await this.records.insertPreparedInTx(tx, tenantId, actor, rootPrep);
            const subRows: RecordRow[] = [];
            for (const p of subPreps) subRows.push(await this.records.insertPreparedInTx(tx, tenantId, actor, p, rootRow.id));
            const doc = sanitizeRichDoc(content.record_description);
            if (doc) await this.recordsRepo.updateDescription(tx, tenantId, list.id, rootRow.id, doc, actor.userId);
            const cls = await this.checklists.insertResolvedInTx(
                tx,
                tenantId,
                list,
                rootRow.id,
                this.resolveChecklists(content.checklists, { now, tz, creatorId: actor.userId, data: rootRow.data as Record<string, unknown>, fields }),
                actor.userId,
            );
            await this.activity.logInTx(tx, {
                tenantId,
                listId: list.id,
                recordId: rootRow.id,
                userId: actor.userId > 0 ? actor.userId : null,
                action: 'record_template_applied',
                diff: { template: { id: tpl.id, name: tpl.name }, subtasks: subRows.length, checklists: cls.ids.length },
            });
            return { rootRow, subRows, cls };
        });

        this.realtime.records(tenantId, list.id);
        const chain = opts.automationChain ? { automationChain: opts.automationChain } : {};
        this.records.afterCreate(tenantId, actor, rootPrep, result.rootRow, chain);
        result.subRows.forEach((r, i) => this.records.afterCreate(tenantId, actor, subPreps[i]!, r, chain));
        this.checklists.announceAssignments(tenantId, list.id, result.rootRow.id, actor.userId, result.cls.assigned);
        return {
            record: { id: result.rootRow.id, data: result.rootRow.data as Record<string, unknown> },
            record_id: result.rootRow.id,
            subtask_ids: result.subRows.map((r) => r.id),
            checklist_ids: result.cls.ids,
            warnings,
        };
    }

    /**
     * «Crear subtareas desde una plantilla» (automatizaciones): las subtareas
     * de la plantilla —y, si se pide, sus checklists— sobre un registro que ya
     * existe, en una transacción. «Quien crea el registro» es quien creó ESE
     * registro.
     */
    async applyToRecord(
        tenantId: number,
        actor: Actor,
        listKey: string,
        recordId: number,
        templateId: number,
        opts: FromTemplateOptions & { includeChecklists?: boolean } = {},
    ): Promise<FromTemplateResult> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const tpl = await this.tenantDb.withTenant(tenantId, (tx) => this.find(tx, tenantId, list.id, templateId));
        if (tpl.kind !== 'record') throw badRequest('template_kind', 'Elige una plantilla de registro (no de checklist).');
        const content = readTemplateContent(tpl.content);
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.recordsRepo.findById(tx, tenantId, list.id, recordId));
        if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(recordId);
        if (!this.records.canReach(list, actor, 'edit', row)) {
            throw new ForbiddenException({ code: 'forbidden', message: 'No tienes permiso para cambiar ese registro.', data: { status: 403 } });
        }
        const tz = await this.timeZone(tenantId);
        const now = new Date();
        const warnings: string[] = [];
        const lenient = opts.lenientRequired === true;
        const base = row.data as Record<string, unknown>;
        const subPreps: PreparedCreate[] = [];
        if (content.subtasks.length > 0) {
            if (row.parentId !== null) {
                warnings.push('El registro es una subtarea: no puede tener subtareas.');
            } else {
                this.records.assertCanCreate(list, actor);
                for (const s of content.subtasks) {
                    subPreps.push(await this.prepareSubtask(tenantId, { ...actor }, list, fields, s, base, { now, tz, lenient, creatorId: row.createdBy }, warnings));
                }
            }
        }
        const wantChecklists = opts.includeChecklists === true && content.checklists.length > 0;
        const planCheck = subPreps.length > 0 ? await this.records.planRoomChecker(tenantId, subPreps.length) : null;
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (planCheck) await planCheck(tx);
            const subRows: RecordRow[] = [];
            for (const p of subPreps) subRows.push(await this.records.insertPreparedInTx(tx, tenantId, actor, p, row.id));
            const cls = wantChecklists
                ? await this.checklists.insertResolvedInTx(
                      tx,
                      tenantId,
                      list,
                      row.id,
                      this.resolveChecklists(content.checklists, { now, tz, creatorId: row.createdBy, data: base, fields }),
                      actor.userId,
                  )
                : { ids: [] as number[], assigned: [] as ChecklistAssignment[] };
            if (subRows.length > 0 || cls.ids.length > 0) {
                await this.activity.logInTx(tx, {
                    tenantId,
                    listId: list.id,
                    recordId: row.id,
                    userId: actor.userId > 0 ? actor.userId : null,
                    action: 'record_template_applied',
                    diff: { template: { id: tpl.id, name: tpl.name }, subtasks: subRows.length, checklists: cls.ids.length },
                });
            }
            return { subRows, cls };
        });
        this.realtime.records(tenantId, list.id);
        const chain = opts.automationChain ? { automationChain: opts.automationChain } : {};
        result.subRows.forEach((r, i) => this.records.afterCreate(tenantId, actor, subPreps[i]!, r, chain));
        this.checklists.announceAssignments(tenantId, list.id, row.id, actor.userId, result.cls.assigned);
        return { record_id: row.id, subtask_ids: result.subRows.map((r) => r.id), checklist_ids: result.cls.ids, warnings };
    }

    // ─────────────────────────── Internos ───────────────────────────

    private async prepareSubtask(
        tenantId: number,
        actor: Actor,
        list: List,
        fields: Field[],
        s: RecordTemplateContent['subtasks'][number],
        base: Record<string, unknown>,
        ctx: { now: Date; tz: string; lenient: boolean; creatorId?: number },
        warnings: string[],
    ): Promise<PreparedCreate> {
        const res = resolveTemplateValues(s.values, fields, { now: ctx.now, timeZone: ctx.tz, creatorId: ctx.creatorId ?? actor.userId, base });
        warnings.push(...res.warnings);
        const data: Record<string, unknown> = { ...res.data };
        const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
        if (titleId !== null) data[jsonbKeyForField(titleId)] = s.title;
        const clean = await this.dropNonMembers(tenantId, fields, data, new Set(), warnings);
        return this.records.prepareCreate(tenantId, actor, list, fields, { data: clean }, { lenientRequired: ctx.lenient });
    }

    private resolveChecklists(
        specs: TemplateChecklist[],
        ctx: { now: Date; tz: string; creatorId: number; data: Record<string, unknown>; fields: Field[] },
    ): ChecklistSpecResolved[] {
        return specs.map((c) => ({
            name: c.name,
            items: resolveItemSpecs(c.items, { now: ctx.now, timeZone: ctx.tz, creatorId: ctx.creatorId, data: ctx.data, fields: ctx.fields }),
        }));
    }

    /**
     * Una persona que la PLANTILLA puso (fija) y que ya no es del equipo se
     * descarta con un aviso; lo que trae el alta (`fromInput`) no se toca —el
     * validador de siempre decide—.
     */
    private async dropNonMembers(
        tenantId: number,
        fields: Field[],
        data: Record<string, unknown>,
        fromInput: ReadonlySet<string>,
        warnings: string[],
    ): Promise<Record<string, unknown>> {
        const userKeys = fields.filter((f) => f.type === 'user').map((f) => jsonbKeyForField(f.id)).filter((k) => k in data && !fromInput.has(k));
        const ids = [...new Set(userKeys.map((k) => Number(data[k])).filter((n) => Number.isInteger(n) && n > 0))];
        if (ids.length === 0) return data;
        const ok = await this.tenantDb.withTenant(tenantId, (tx) => this.memberIds(tx, tenantId, ids));
        const out = { ...data };
        for (const k of userKeys) {
            if (!ok.has(Number(out[k]))) {
                delete out[k];
                warnings.push('Una persona de la plantilla ya no es parte del equipo: ese campo quedó vacío.');
            }
        }
        return out;
    }

    /**
     * Valida una plantilla SIN guardarla (el asistente la revisa antes de
     * proponerla): mismo saneo que el alta. Un error → 400 con el motivo.
     */
    async validate(tenantId: number, listKey: string, kind: RecordTemplateKind, content: unknown): Promise<RecordTemplateContent> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.listByListId(tenantId, list.id);
        return this.tenantDb.withTenant(tenantId, (tx) => this.sanitize(tx, tenantId, fields, kind, content));
    }

    /**
     * Valida y normaliza el contenido de una plantilla contra los campos de la
     * lista: cada valor fijo con el validador compartido, las fechas relativas
     * sobre campos fecha, las personas sobre campos Persona y miembros del
     * equipo, la descripción saneada. Un error → 400 con el motivo.
     */
    private async sanitize(tx: Tx, tenantId: number, fields: Field[], kind: RecordTemplateKind, raw: unknown): Promise<RecordTemplateContent> {
        const parsed = recordTemplateContentSchema.safeParse(raw ?? {});
        if (!parsed.success) throw badRequest('invalid_template', `La plantilla no es válida: ${parsed.error.issues[0]?.message ?? 'formato'}.`);
        const content = parsed.data;
        if (kind === 'checklist') {
            if (content.checklists.length !== 1) throw badRequest('invalid_template', 'Una plantilla de checklist tiene exactamente un checklist.');
            content.values = {};
            content.subtasks = [];
            content.record_description = null;
        }
        const byId = new Map(fields.map((f) => [f.id, f]));
        const label = (id: number): string => byId.get(id)?.label ?? `#${id}`;
        const checkValues = (vals: TemplateValues, where: string): TemplateValues => {
            const out: TemplateValues = {};
            for (const [key, v] of Object.entries(vals)) {
                const f = byId.get(Number(key.slice(1)));
                if (!f) throw badRequest('invalid_template', `${where}: un valor apunta a un campo que no existe en la lista.`);
                if (!isTemplateValueType(f.type as FieldType)) {
                    throw badRequest('invalid_template', `${where}: «${f.label}» no se completa en una plantilla (la app lo calcula o apunta a otro registro).`);
                }
                if (v.mode === 'fixed') {
                    if (v.value === null || v.value === undefined || v.value === '') continue;
                    const res = validateFieldValue({ type: f.type, config: f.config, is_required: false }, v.value);
                    if (!res.ok) throw badRequest('invalid_template', `${where}: «${f.label}»: ${res.error}`);
                    out[key] = { mode: 'fixed', value: res.value };
                } else if (v.mode === 'relative_date') {
                    if (f.type !== 'date' && f.type !== 'datetime') throw badRequest('invalid_template', `${where}: «${f.label}» no es una fecha.`);
                    if (v.date.from_field_id !== null && !isDateField(byId.get(v.date.from_field_id))) {
                        throw badRequest('invalid_template', `${where}: la fecha de «${f.label}» se calcula desde «${label(v.date.from_field_id)}», que no es una fecha de la lista.`);
                    }
                    out[key] = v;
                } else {
                    if (f.type !== 'user') throw badRequest('invalid_template', `${where}: «${f.label}» no es un campo Persona.`);
                    if (v.person.kind === 'field' && byId.get(v.person.field_id)?.type !== 'user') {
                        throw badRequest('invalid_template', `${where}: «${f.label}» toma la persona de un campo que no es Persona.`);
                    }
                    out[key] = v;
                }
            }
            return out;
        };
        content.values = checkValues(content.values, 'Valores');
        content.subtasks = content.subtasks.map((s, i) => ({ title: s.title, values: checkValues(s.values, `Subtarea ${i + 1}`) }));
        for (const [ci, c] of content.checklists.entries()) {
            for (const [ii, item] of c.items.entries()) {
                const where = `Checklist «${c.name}», ítem ${ii + 1}`;
                if (item.assignee?.kind === 'field' && byId.get(item.assignee.field_id)?.type !== 'user') {
                    throw badRequest('invalid_template', `${where}: el responsable sale de un campo que no es Persona.`);
                }
                if (item.due?.from_field_id && !isDateField(byId.get(item.due.from_field_id))) {
                    throw badRequest('invalid_template', `${where}: la fecha sale de un campo que no es fecha.`);
                }
                void ci;
            }
        }
        const { userIds } = templateRefs(content);
        if (userIds.size > 0) {
            const ok = await this.memberIds(tx, tenantId, [...userIds]);
            const bad = [...userIds].filter((id) => !ok.has(id));
            if (bad.length > 0) throw badRequest('not_a_member', 'Las personas de una plantilla tienen que ser del equipo de esta empresa.');
        }
        content.record_description = content.record_description ? sanitizeRichDoc(content.record_description) : null;
        return content;
    }

    /**
     * Al guardar como plantilla lo que tiene un registro: una persona que ya no
     * es del equipo no se lleva (la plantilla la rechazaría entera).
     */
    private async withoutFormerMembers(tx: Tx, tenantId: number, content: RecordTemplateContent): Promise<RecordTemplateContent> {
        const { userIds } = templateRefs(content);
        if (userIds.size === 0) return content;
        const ok = await this.memberIds(tx, tenantId, [...userIds]);
        return remapTemplateContent(content, { field: (id) => id, user: (id) => (ok.has(id) ? id : null) });
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

    private async find(tx: Tx, tenantId: number, listId: number, id: number): Promise<RecordTemplateRow> {
        const [row] = await tx
            .select()
            .from(recordTemplates)
            .where(and(eq(recordTemplates.tenantId, tenantId), eq(recordTemplates.id, id), eq(recordTemplates.listId, listId)))
            .limit(1);
        if (!row) throw new NotFoundException({ code: 'template_not_found', message: 'La plantilla no existe en esta lista.', data: { status: 404 } });
        return row;
    }

    private async timeZone(tenantId: number): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
    }
}

function isDateField(f: Field | undefined): boolean {
    return f?.type === 'date' || f?.type === 'datetime';
}

/** ¿Alguna acción (también dentro de si/sino o un bucle) usa esta plantilla? */
export function actionsUseTemplate(actions: unknown, templateId: number): boolean {
    const walk = (list: unknown): boolean => {
        if (!Array.isArray(list)) return false;
        for (const a of list as Array<{ type?: unknown; config?: Record<string, unknown> }>) {
            const cfg = a?.config ?? {};
            if ((a?.type === 'create_subtasks_from_template' || a?.type === 'create_record') && Number(cfg.template_id) === templateId) return true;
            if (walk(cfg.then) || walk(cfg.else) || walk(cfg.actions)) return true;
        }
        return false;
    };
    return walk(actions);
}

export function toDto(row: RecordTemplateRow): RecordTemplate {
    return {
        id: row.id,
        list_id: row.listId,
        kind: row.kind as RecordTemplateKind,
        name: row.name,
        description: row.description ?? null,
        icon: row.icon ?? null,
        color: row.color ?? null,
        content: readTemplateContent(row.content),
        position: row.position,
        created_by: row.createdBy ?? null,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

function recordNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'record_not_found', message: `Registro ${id} no encontrado`, data: { status: 404 } });
}

/** Re-export para el DTO del endpoint de alta. */
export type { RecordDto };
