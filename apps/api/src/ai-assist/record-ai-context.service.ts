import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    listRecordsQuerySchema,
    resolveTitleFieldId,
    richDocToMarkdown,
    zonedToday,
    type CommentDto,
    type Field,
    type List,
    type RecordDto,
} from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ChecklistsService } from '../checklists/checklists.service';
import { CollectionsService } from '../collections/collections.service';
import { CommentsService } from '../comments/comments.service';
import { mapLimit } from '../common/map-limit';
import { bookingAppointments, teams } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { aclExtras } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { DependenciesService } from '../records/dependencies.service';
import { RecordsService, type Actor } from '../records/records.service';
import { memberNames } from '../tenancy/member-names';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import {
    CTX_ACTIVITY,
    CTX_CHECKLIST_ITEMS,
    CTX_COMMENTS,
    CTX_COMMENT_MAX,
    CTX_DESCRIPTION_MAX,
    CTX_LINKED_LISTS,
    CTX_LINKED_ROWS,
    CTX_SUBTASKS,
    activityLine,
    clip,
    recordValues,
    type SummaryContext,
    type ValueNames,
} from './record-ai-context';

/** Lo que se junta de un registro para la IA (siempre con el acceso de quien pide). */
export interface GatheredRecord {
    list: List;
    fields: Field[];
    record: RecordDto;
    title: string;
    /** Campos que quien pide no ve (no se leen ni se mandan). */
    hidden: Set<number>;
    names: ValueNames;
    comments: CommentDto[];
    context: SummaryContext;
}

const PARALLEL = 4;

/**
 * v0.1.456 (ADR-S109) — Junta lo que la persona PUEDE ver de un registro
 * para mandárselo a la IA: sus campos (sin los ocultos), la descripción, los
 * últimos comentarios y la actividad, las subtareas, los vinculados con su
 * total, checklists, aprobaciones, cobros, dependencias y citas. Cada pieza
 * pasa por el MISMO service que usa la ficha con la persona que pide (ACL,
 * alcance del rol, campos ocultos); una pieza que falla no se manda.
 */
@Injectable()
export class RecordAiContextService {
    private readonly logger = new Logger(RecordAiContextService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly comments: CommentsService,
        private readonly activity: ActivityService,
        private readonly timeZones: TenantTimeZones,
        @Optional() private readonly collections?: CollectionsService,
        @Optional() private readonly approvals?: ApprovalsService,
        @Optional() private readonly checklists?: ChecklistsService,
        @Optional() private readonly dependencies?: DependenciesService,
    ) {}

    /** Lo mínimo (campos y título): para redactar y sugerir respuestas. */
    async basic(tenantId: number, actor: Actor, listKey: string, recordId: number): Promise<Omit<GatheredRecord, 'context' | 'comments'> & { values: Record<string, string> }> {
        // El registro primero: 404 si no lo puede ver (y no se junta nada más).
        const record = await this.records.get(tenantId, actor, listKey, recordId);
        const list = await this.lists.get(tenantId, String(record.list_id));
        const fields = await this.fields.list(tenantId, String(list.id));
        const hiddenSlugs = await this.fields.hiddenSlugsFor(tenantId, list, fields, actor);
        const hidden = new Set(fields.filter((f) => hiddenSlugs.has(f.slug)).map((f) => f.id));
        const visible = fields.filter((f) => !hidden.has(f.id));
        const titleId = resolveTitleFieldId(visible, list.settings);
        const names = await this.names(tenantId, actor, visible, [record], record);
        const titleRaw = titleId !== null ? record.data[`f${titleId}`] : null;
        const title = typeof titleRaw === 'string' && titleRaw.trim() ? clip(titleRaw, 200) : `Registro #${record.id}`;
        const values = recordValues(visible, record.data, names, { skip: new Set(titleId !== null ? [titleId] : []) });
        return { list, fields: visible, record, title, hidden, names, values };
    }

    async gather(tenantId: number, actor: Actor, listKey: string, recordId: number): Promise<GatheredRecord> {
        const base = await this.basic(tenantId, actor, listKey, recordId);
        const { list, record, names } = base;
        const key = String(list.id);
        const fieldById = new Map(base.fields.map((f) => [f.id, f]));
        const tz = await this.timeZones.orUtc(tenantId);

        const soft = async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
            try {
                return await fn();
            } catch (err) {
                const status = (err as { getStatus?: () => number }).getStatus?.() ?? 500;
                if (status >= 500) this.logger.warn(`contexto de IA: «${what}» falló: ${(err as Error).message}`);
                return null;
            }
        };

        const tasks: Array<() => Promise<unknown>> = [
            () => soft('descripción', () => this.records.getDescription(tenantId, actor, key, recordId)),
            () => soft('comentarios', () => this.tenantDb.withTenant(tenantId, (tx) => this.comments.listInTx(tx, tenantId, recordId))),
            () =>
                soft('actividad', async () =>
                    (
                        await this.activity.list(tenantId, key, {
                            recordId,
                            limit: CTX_ACTIVITY,
                            viewer: { ...aclExtras(actor), role: actor.role, userId: actor.userId },
                        })
                    ).data,
                ),
            () =>
                record.parent_id !== null
                    ? Promise.resolve(null)
                    : soft('subtareas', () => this.records.list(tenantId, actor, key, listRecordsQuerySchema.parse({ parent: recordId, limit: CTX_SUBTASKS, page: 1 }))),
            () => soft('relaciones', () => this.fields.relationPaths(tenantId, key)),
            () =>
                this.checklists
                    ? soft('checklists', () => this.tenantDb.withTenant(tenantId, (tx) => this.checklists!.forRecordInTx(tx, tenantId, recordId)))
                    : Promise.resolve(null),
            () => (this.approvals ? soft('aprobaciones', () => this.approvals!.recordApprovals(tenantId, actor, key, recordId)) : Promise.resolve(null)),
            () => (this.collections ? soft('cobros', () => this.collections!.recordPayments(tenantId, actor, key, recordId)) : Promise.resolve(null)),
            () => (this.dependencies ? soft('dependencias', () => this.dependencies!.forRecord(tenantId, actor, key, recordId)) : Promise.resolve(null)),
            () =>
                soft('citas', () =>
                    this.tenantDb.withTenant(tenantId, (tx) =>
                        tx
                            .select({ start: bookingAppointments.startAt, end: bookingAppointments.endAt, status: bookingAppointments.status })
                            .from(bookingAppointments)
                            .where(and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.recordId, recordId)))
                            .limit(5),
                    ),
                ),
        ];
        const [description, comments, activity, subtasks, paths, checklists, approvals, payments, dependencies, appointments] = (await mapLimit(
            tasks,
            PARALLEL,
            (t) => t(),
        )) as [
            Awaited<ReturnType<RecordsService['getDescription']>> | null,
            CommentDto[] | null,
            Array<{ action: string; diff: Record<string, unknown>; user_name: string | null; created_at: string; agent?: { name: string } | null }> | null,
            { data: RecordDto[]; meta: Record<string, unknown> } | null,
            Awaited<ReturnType<FieldsService['relationPaths']>> | null,
            Awaited<ReturnType<ChecklistsService['forRecordInTx']>> | null,
            Awaited<ReturnType<ApprovalsService['recordApprovals']>> | null,
            Awaited<ReturnType<CollectionsService['recordPayments']>> | null,
            Awaited<ReturnType<DependenciesService['forRecord']>> | null,
            Array<{ start: Date; end: Date; status: string }> | null,
        ];

        // Los vinculados: las listas que apuntan a este registro (con su total).
        const reverse = (paths ?? []).filter((p) => p.direction === 'reverse').slice(0, CTX_LINKED_LISTS);
        const linked = (
            await mapLimit(reverse, PARALLEL, (p) =>
                soft('vinculados', async () => {
                    const otherKey = String(p.list_id);
                    const page = await this.records.list(
                        tenantId,
                        actor,
                        otherKey,
                        listRecordsQuerySchema.parse({ limit: CTX_LINKED_ROWS, page: 1, related_to: `${p.relation_field_id}:${recordId}` }),
                    );
                    const otherList = await this.lists.get(tenantId, otherKey);
                    const otherFields = await this.fields.list(tenantId, otherKey);
                    return { path: p, page, otherList, otherFields };
                }),
            )
        ).filter((x): x is NonNullable<typeof x> => x !== null);

        // Los nombres de las personas y equipos de todo lo junto (una consulta).
        const more = await this.names(tenantId, actor, [...base.fields, ...linked.flatMap((l) => l.otherFields)], [
            ...(subtasks?.data ?? []),
            ...linked.flatMap((l) => l.page.data),
        ], null);
        for (const [id, n] of more.users) (names.users as Map<number, string>).set(id, n);
        for (const [id, n] of more.teams) (names.teams as Map<number, string>).set(id, n);

        const rowsOf = (fs: Field[], rows: RecordDto[], settings: Record<string, unknown>) => {
            const t = resolveTitleFieldId(fs, settings);
            return rows.map((r) => {
                const raw = t !== null ? r.data[`f${t}`] : null;
                return {
                    titulo: typeof raw === 'string' && raw.trim() ? clip(raw, 120) : `#${r.id}`,
                    datos: recordValues(fs, r.data, { users: names.users, teams: names.teams }, { skip: new Set(t !== null ? [t] : []), max: 4 }),
                };
            });
        };
        const iso = (d: string | Date | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : null);

        const visibleComments = (comments ?? []).filter((c) => (c.body ?? '').trim() !== '');
        const ctx: SummaryContext = {
            hoy: zonedToday(tz),
            zona_horaria: tz,
            lista: list.name,
            titulo: base.title,
            creado: iso(record.created_at),
            actualizado: iso(record.updated_at),
            campos: base.values,
        };
        const desc = description ? richDocToMarkdown(description as never).trim() : '';
        if (desc) ctx.descripcion = clip(desc, CTX_DESCRIPTION_MAX);
        if (visibleComments.length) {
            ctx.comentarios_total = visibleComments.length;
            ctx.comentarios = visibleComments.slice(-CTX_COMMENTS).map((c) => ({
                fecha: iso(c.created_at) ?? '',
                autor: c.from_client ? `${c.author_name ?? 'Cliente'} (cliente)` : (c.user_name ?? (c.user_id === 0 ? 'Sistema' : 'Alguien del equipo')),
                para_el_cliente: c.visibility === 'client',
                texto: clip(c.body, CTX_COMMENT_MAX),
                ...(c.parent_id ? { respuesta_a: c.parent_id } : {}),
            }));
        }
        if (activity?.length) {
            ctx.actividad = activity.slice(0, CTX_ACTIVITY).map((a) => ({
                fecha: iso(a.created_at) ?? '',
                quien: a.agent?.name ? `Agente «${a.agent.name}»` : (a.user_name ?? 'Sistema'),
                que: activityLine(a, fieldById, names),
            }));
        }
        if (subtasks && subtasks.data.length) {
            ctx.subtareas = { total: Number(subtasks.meta.total ?? subtasks.data.length), items: rowsOf(base.fields, subtasks.data, list.settings) };
        }
        if (linked.length) {
            ctx.vinculados = linked
                .map(({ path, page, otherList, otherFields }) => {
                    const total = Number(page.meta.total ?? page.data.length);
                    if (total === 0) return null;
                    const sums: Record<string, string> = {};
                    // Sólo si están TODOS (con más filas que las traídas, la suma mentiría).
                    if (total <= page.data.length) {
                        for (const f of otherFields.filter((x) => x.type === 'currency' || x.type === 'number')) {
                            const vals = page.data.map((r) => r.data[`f${f.id}`]).filter((v): v is number => typeof v === 'number');
                            if (vals.length === 0) continue;
                            const cur = f.type === 'currency' && typeof (f.config as { currency?: unknown }).currency === 'string' ? ` ${(f.config as { currency: string }).currency}` : '';
                            sums[f.label] = `${vals.reduce((a, b) => a + b, 0)}${cur}`;
                        }
                    }
                    return {
                        lista: otherList.name,
                        relacion: path.relation_label,
                        total,
                        ...(Object.keys(sums).length ? { sumas: sums } : {}),
                        ultimos: rowsOf(otherFields, page.data, otherList.settings),
                    };
                })
                .filter((x): x is NonNullable<typeof x> => x !== null);
            if (!ctx.vinculados.length) delete ctx.vinculados;
        }
        if (checklists && checklists.checklists.length) {
            ctx.checklists = checklists.checklists.map((c) => ({
                nombre: c.name,
                hechos: c.items.filter((i) => i.done).length,
                total: c.items.length,
                pendientes: c.items
                    .filter((i) => !i.done)
                    .slice(0, CTX_CHECKLIST_ITEMS)
                    .map((i) => ({ texto: clip(i.text, 160), vence: i.due, responsable: i.assignee_id ? (names.users.get(i.assignee_id) ?? null) : null })),
            }));
        }
        if (approvals && approvals.requests.length) {
            ctx.aprobaciones = approvals.requests.slice(0, 5).map((r) => ({
                flujo: r.flow_name,
                estado: r.status,
                paso: r.steps[r.current_step]?.name ?? '',
                pedida: iso(r.requested_at) ?? '',
                ...(r.reason ? { motivo: clip(r.reason, 200) } : {}),
            }));
        }
        if (payments && payments.links.length) {
            ctx.cobros = payments.links.slice(0, 8).map((l) => ({
                concepto: clip(l.title, 120),
                monto: `${l.amount} ${l.currency}`,
                estado: l.status,
                vence: iso(l.expires_at),
                pagado: iso(l.paid_at),
            }));
        }
        if (dependencies && (dependencies.blocked_by.length || dependencies.blocks.length)) {
            const dep = (d: { title: string | null; record_id: number; done: boolean }) => ({ titulo: d.title ?? `#${d.record_id}`, terminado: d.done });
            ctx.dependencias = { bloqueado_por: dependencies.blocked_by.map(dep), bloquea: dependencies.blocks.map(dep) };
        }
        if (appointments && appointments.length) {
            ctx.citas = appointments.map((a) => ({ inicio: iso(a.start) ?? '', fin: iso(a.end) ?? '', estado: a.status }));
        }
        return { ...base, comments: visibleComments, context: ctx };
    }

    /** Nombres de las personas (del equipo) y equipos que aparecen en los registros. */
    private async names(
        tenantId: number,
        actor: Actor,
        fields: Field[],
        rows: RecordDto[],
        /** El registro cuyas relaciones se nombran (sólo el de la ficha). */
        relationsOf: RecordDto | null,
    ): Promise<ValueNames & { users: Map<number, string>; teams: Map<number, string> }> {
        const userIds = new Set<number>();
        const teamIds = new Set<number>();
        const add = (set: Set<number>, v: unknown) => {
            for (const x of Array.isArray(v) ? v : [v]) {
                const n = Number(x);
                if (Number.isInteger(n) && n > 0) set.add(n);
            }
        };
        for (const r of rows) {
            for (const f of fields) {
                const v = r.data[`f${f.id}`];
                if (v === undefined || v === null) continue;
                if (f.type === 'user' || f.type === 'created_by' || f.type === 'updated_by') add(userIds, v);
                else if (f.type === 'team') add(teamIds, v);
            }
        }
        // Títulos de los vinculados por las relaciones de ESTE registro (con el ACL de quien pide).
        const relations = new Map<string, string[]>();
        const rel = relationsOf?.relations ?? {};
        const relFields = fields.filter((f) => f.type === 'relation' && Array.isArray(rel[`f${f.id}`]) && rel[`f${f.id}`]!.length > 0);
        for (const f of relFields.slice(0, 6)) {
            const target = Number((f.config as { target_list_id?: unknown }).target_list_id);
            const ids = rel[`f${f.id}`]!.slice(0, 20);
            if (!Number.isInteger(target) || target <= 0) continue;
            try {
                const page = await this.records.list(tenantId, actor, String(target), listRecordsQuerySchema.parse({ ids: ids.join(','), limit: ids.length }));
                const tList = await this.lists.get(tenantId, String(target));
                const tFields = await this.fields.list(tenantId, String(target));
                const t = resolveTitleFieldId(tFields, tList.settings);
                relations.set(
                    `f${f.id}`,
                    page.data.map((r) => {
                        const raw = t !== null ? r.data[`f${t}`] : null;
                        return typeof raw === 'string' && raw.trim() ? clip(raw, 120) : `#${r.id}`;
                    }),
                );
            } catch {
                // sin acceso a la otra lista: no se nombra
            }
        }
        const [users, teamRows] = await this.tenantDb.withTenant(tenantId, async (tx) => [
            await memberNames(tx, tenantId, [...userIds]),
            teamIds.size
                ? await tx
                      .select({ id: teams.id, name: teams.name })
                      .from(teams)
                      .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, [...teamIds])))
                : [],
        ]);
        return {
            users: new Map([...users].map(([id, u]) => [id, u.name || u.email])),
            teams: new Map(teamRows.map((t) => [t.id, t.name])),
            relations,
        };
    }
}
