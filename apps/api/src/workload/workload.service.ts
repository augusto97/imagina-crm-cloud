import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    addDaysYmd,
    doneRuleFor,
    FALLBACK_TIME_ZONE,
    isValidTimeZone,
    readWorkloadCapacity,
    resolveTitleFieldId,
    roleHasCapability,
    summarizeWorkload,
    workloadItemLoad,
    WORKLOAD_DATE_TYPES,
    WORKLOAD_ESTIMATE_TYPES,
    WORKLOAD_MAX_ITEMS,
    WORKLOAD_MAX_RANGE_DAYS,
    WORKLOAD_MAX_ROWS,
    WORKLOAD_PERSON_TYPES,
    WORKLOAD_UNASSIGNED,
    workloadBucketKey,
    type FilterGroup,
    type Role,
    type WorkloadBundle,
    type WorkloadCapacity,
    type WorkloadEstimateUnit,
    type WorkloadItem,
    type WorkloadMetric,
    type WorkloadPerson,
    type WorkloadZoom,
} from '@imagina-base/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { memberships, users } from '../db/schema';
import { effectivePermissions, resolvePermissions, rowInScope } from '../lists/list-acl';
import { RealtimeService } from '../realtime/realtime.service';
import type { FilterableField } from '../records/query-builder';
import { RecordsService, type Actor, type ReadScope } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { workloadItemsSql, workloadTimeSql, workloadUnscheduledSql, type WorkloadDateField, type WorkloadSqlBase } from './workload-sql';

export interface WorkloadBundleQuery {
    from: string;
    to: string;
    zoom: WorkloadZoom;
    metric: WorkloadMetric;
    personFieldId: number;
    startFieldId: number | null;
    endFieldId: number | null;
    estimateFieldId: number | null;
    estimateUnit: WorkloadEstimateUnit;
    hideDone: boolean;
    /**
     * Personas visibles (ids). `null` = todas las que pueden ver la lista. Es el
     * punto donde se engancha un filtro por EQUIPO: se le pasa el conjunto de
     * personas del equipo.
     */
    userIds: number[] | null;
    showUnassigned: boolean;
    filterTree?: FilterGroup;
    search?: string;
    /** Zona del navegador, para una empresa que no eligió la suya. */
    clientTimeZone?: string;
}

/** Una persona del equipo con lo que importa para la carga. */
interface MemberInfo {
    userId: number;
    role: Role;
    name: string;
    email: string;
    canView: boolean;
    capacity: WorkloadCapacity;
    custom: boolean;
}

/** Una persona de la lista de «personas visibles» del diálogo de la vista. */
export interface WorkloadMemberDto {
    user_id: number;
    name: string;
    email: string;
    capacity: WorkloadCapacity;
    capacity_custom: boolean;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * B2 — Vista «Carga de trabajo».
 *
 *  - `bundle`: en UNA request (regla de oro nº 8) las personas (filas), la
 *    grilla persona × columna, los totales por persona y del equipo, los
 *    registros sin fecha por persona y los registros que viajan para el panel
 *    y el arrastre. Filtros, búsqueda, ACL y campos ocultos son los del
 *    listado; «hoy» y los días, los de la zona de la empresa.
 *  - Capacidad por persona en `memberships.settings.capacity` (la editan
 *    quienes pueden editar el trabajo de todos: admin y manager).
 */
@Injectable()
export class WorkloadService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly audit?: AuditService,
    ) {}

    async bundle(tenantId: number, actor: Actor, listKey: string, q: WorkloadBundleQuery): Promise<WorkloadBundle> {
        assertRange(q.from, q.to);
        const ownZone = this.timeZones ? await this.timeZones.get(tenantId) : null;
        const timeZone = ownZone ?? (q.clientTimeZone && isValidTimeZone(q.clientTimeZone) ? q.clientTimeZone : FALLBACK_TIME_ZONE);
        return this.records.readScoped(tenantId, actor, listKey, async (tx, scope) => {
            const fields = new Map(scope.fields.map((f) => [f.id, f]));
            const person = fields.get(q.personFieldId);
            if (!person || !WORKLOAD_PERSON_TYPES.includes(person.type) || scope.hiddenIds.has(person.id)) {
                throw badRequest('invalid_workload_field', 'El campo de la persona tiene que ser un campo Persona visible de esta lista.');
            }
            const dateField = (id: number | null): WorkloadDateField | null => {
                if (id === null) return null;
                const f = fields.get(id);
                if (!f || !WORKLOAD_DATE_TYPES.includes(f.type) || scope.hiddenIds.has(f.id)) {
                    throw badRequest('invalid_workload_field', 'Las fechas de la carga tienen que ser campos de fecha visibles de esta lista.');
                }
                return { id: f.id, type: f.type as 'date' | 'datetime' };
            };
            const start = dateField(q.startFieldId);
            const end = q.endFieldId !== q.startFieldId ? dateField(q.endFieldId) : null;
            if (q.metric !== 'time' && !start && !end) {
                throw badRequest('invalid_workload_field', 'La carga necesita al menos una fecha (inicio, o una sola fecha) para ubicar cada registro.');
            }
            let estimate: FilterableField | null = null;
            let unitMinutes = 60;
            if (q.metric === 'estimate') {
                const f = q.estimateFieldId !== null ? fields.get(q.estimateFieldId) : undefined;
                const filterable = f ? scope.fieldsById.get(f.id) : undefined;
                if (!f || !WORKLOAD_ESTIMATE_TYPES.includes(f.type) || !filterable || !numericFilterable(filterable)) {
                    throw badRequest(
                        'invalid_workload_estimate',
                        'El esfuerzo estimado necesita un campo numérico o de duración visible de esta lista.',
                    );
                }
                estimate = filterable;
                unitMinutes = f.type === 'duration' || q.estimateUnit === 'minutes' ? 1 : 60;
            }
            // «Terminado»: el criterio de «Mi trabajo». Si el estado está oculto
            // para quien mira, no se aplica (filtrar por él sería un oráculo).
            const rule = doneRuleFor(scope.fields);
            let doneReason: 'no_status' | 'hidden' | undefined;
            let done = rule;
            if (!rule) doneReason = q.hideDone ? 'no_status' : undefined;
            else if (scope.hiddenIds.has(rule.fieldId)) {
                done = null;
                if (q.hideDone) doneReason = 'hidden';
            }
            const base = {
                tenantId,
                listId: scope.list.id,
                where: scope.where({ filter_tree: q.filterTree, search: q.search }),
                personFieldId: person.id,
                titleFieldId: visibleTitle(scope),
                assignmentFieldId: resolvePermissions(scope.list.settings).assignment_field_id ?? null,
                done,
                hideDone: q.hideDone && done !== null,
            };

            const members = await this.members(tx, tenantId, scope.list.settings);
            const editableFor = editability(scope, actor);
            const raw =
                q.metric === 'time'
                    ? await this.timeRows(tx, base, q)
                    : await this.dateRows(tx, base, q, { start, end, estimate, unitMinutes, timeZone });
            const unscheduled: Record<string, number> = {};
            if (q.metric !== 'time') {
                const res = await tx.execute(workloadUnscheduledSql({ ...base, start, end }));
                for (const r of res.rows as Array<Record<string, unknown>>) {
                    const key = personKey(r.person);
                    unscheduled[key] = (unscheduled[key] ?? 0) + Number(r.n ?? 0);
                }
            }

            // Filas: el equipo que ve la lista + quien tenga registros sin ser parte.
            const memberById = new Map(members.map((m) => [m.userId, m]));
            const presentIds = new Set<number>();
            for (const it of raw.items) if (it.person !== WORKLOAD_UNASSIGNED) presentIds.add(Number(it.person));
            for (const k of Object.keys(unscheduled)) if (k !== WORKLOAD_UNASSIGNED) presentIds.add(Number(k));
            const outsiders = [...presentIds].filter((id) => !memberById.get(id)?.canView);
            const outsiderNames = await this.userNames(tx, outsiders.filter((id) => !memberById.has(id)));
            const wanted = q.userIds ? new Set(q.userIds) : null;
            const people: WorkloadPerson[] = [];
            for (const m of members) {
                if (!m.canView || (wanted && !wanted.has(m.userId))) continue;
                people.push(toPerson(m.userId, m.name, m.email, true, m.capacity, m.custom));
            }
            for (const id of outsiders) {
                if (wanted && !wanted.has(id)) continue;
                const m = memberById.get(id);
                const name = m?.name ?? outsiderNames.get(id)?.name ?? `#${id}`;
                const email = m?.email ?? outsiderNames.get(id)?.email ?? null;
                const cap = m ? { capacity: m.capacity, custom: m.custom } : readWorkloadCapacity(undefined);
                people.push(toPerson(id, name, email, false, cap.capacity, cap.custom));
            }
            if (q.showUnassigned) {
                people.push(toPerson(null, 'Sin asignar', null, false, readWorkloadCapacity(undefined).capacity, false));
            }
            const shown = new Set(people.map((p) => p.key));
            const capacityOf = new Map(people.map((p) => [p.key, p.capacity]));

            // La carga de cada registro con los días laborables de SU persona.
            const items: Array<RawItem & { editable: boolean }> = [];
            for (const it of raw.items) {
                if (!shown.has(it.person)) continue;
                const load =
                    q.metric === 'time'
                        ? it.load
                        : workloadItemLoad(it, q.metric, capacityOf.get(it.person)!.work_days, q.from, q.to, q.zoom);
                if (Object.keys(load).length === 0) continue;
                items.push({ ...it, load, editable: editableFor(it) });
            }
            const summary = summarizeWorkload(items, people, { metric: q.metric, from: q.from, to: q.to, zoom: q.zoom });
            const shownUnscheduled: Record<string, number> = {};
            for (const [k, n] of Object.entries(unscheduled)) if (shown.has(k)) shownUnscheduled[k] = n;
            return {
                meta: {
                    from: q.from,
                    to: q.to,
                    zoom: q.zoom,
                    metric: q.metric,
                    time_zone: timeZone,
                    person_field_id: person.id,
                    start_field_id: start?.id ?? null,
                    end_field_id: end?.id ?? null,
                    estimate_field_id: estimate ? q.estimateFieldId : null,
                    estimate_unit_minutes: unitMinutes,
                    hide_done: base.hideDone,
                    ...(doneReason ? { done_reason: doneReason } : {}),
                    truncated: raw.truncated,
                    items_truncated: items.length > WORKLOAD_MAX_ITEMS,
                    total_records: items.length,
                },
                people,
                ...summary,
                unscheduled: shownUnscheduled,
                items: items.slice(0, WORKLOAD_MAX_ITEMS).map(({ created_by: _c, assigned: _a, ...rest }): WorkloadItem => rest),
            };
        });
    }

    /** Registros con fecha que se solapan con el rango (una consulta). */
    private async dateRows(
        tx: Tx,
        base: WorkloadSqlBase,
        q: WorkloadBundleQuery,
        o: { start: WorkloadDateField | null; end: WorkloadDateField | null; estimate: FilterableField | null; unitMinutes: number; timeZone: string },
    ): Promise<{ items: RawItem[]; truncated: boolean }> {
        const res = await tx.execute(
            workloadItemsSql({ ...base, start: o.start, end: o.end, estimate: o.estimate, from: q.from, to: q.to, timeZone: o.timeZone, limit: WORKLOAD_MAX_ROWS + 1 }),
        );
        const rows = res.rows as Array<Record<string, unknown>>;
        const items = rows.slice(0, WORKLOAD_MAX_ROWS).map((r): RawItem => {
            const est = r.est === null || r.est === undefined ? null : Number(r.est);
            return {
                ...rawRow(r),
                start: typeof r.s === 'string' ? r.s : null,
                end: typeof r.e === 'string' ? r.e : null,
                estimate_minutes: est !== null && Number.isFinite(est) && est > 0 ? est * o.unitMinutes : null,
                load: {},
            };
        });
        return { items, truncated: rows.length > WORKLOAD_MAX_ROWS };
    }

    /** El tiempo registrado del rango, por (quien lo cargó, registro), con su carga por columna. */
    private async timeRows(
        tx: Tx,
        base: WorkloadSqlBase,
        q: WorkloadBundleQuery,
    ): Promise<{ items: RawItem[]; truncated: boolean }> {
        const res = await tx.execute(workloadTimeSql({ ...base, from: q.from, to: q.to, limit: WORKLOAD_MAX_ROWS + 1 }));
        const rows = res.rows as Array<Record<string, unknown>>;
        const byKey = new Map<string, RawItem>();
        for (const r of rows.slice(0, WORKLOAD_MAX_ROWS)) {
            const who = personKey(r.uid);
            const key = `${String(r.id)}:${who}`;
            const item = byKey.get(key) ?? { ...rawRow(r), person: who, start: null, end: null, estimate_minutes: null, load: {} };
            const bucket = workloadBucketKey(String(r.day), q.zoom);
            item.load[bucket] = (item.load[bucket] ?? 0) + Number(r.secs ?? 0) / 60;
            byKey.set(key, item);
        }
        return { items: [...byKey.values()], truncated: rows.length > WORKLOAD_MAX_ROWS };
    }

    /**
     * El equipo (sin clientes del portal ni cuentas desactivadas) con su rol,
     * si puede VER la lista y su capacidad. Una consulta.
     */
    private async members(tx: Tx, tenantId: number, listSettings: Record<string, unknown>): Promise<MemberInfo[]> {
        const rows = await tx
            .select({
                userId: memberships.userId,
                role: memberships.role,
                settings: memberships.settings,
                name: users.name,
                email: users.email,
                disabledAt: users.disabledAt,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), ne(memberships.role, 'client')));
        return rows
            .filter((r) => r.disabledAt === null)
            .map((r) => {
                const cap = readWorkloadCapacity((r.settings as Record<string, unknown> | null)?.capacity);
                return {
                    userId: r.userId,
                    role: r.role,
                    name: r.name?.trim() ? r.name : r.email,
                    email: r.email,
                    canView: effectivePermissions(listSettings, r.role, r.userId).view !== 'none',
                    capacity: cap.capacity,
                    custom: cap.custom,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.userId - b.userId);
    }

    /** Nombres de quienes tienen registros asignados sin ser (ya) del equipo. */
    private async userNames(tx: Tx, ids: number[]): Promise<Map<number, { name: string; email: string }>> {
        if (ids.length === 0) return new Map();
        const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids.slice(0, 500)));
        return new Map(rows.map((r) => [r.id, { name: r.name?.trim() ? r.name : r.email, email: r.email }]));
    }

    /** Las personas que pueden ver la lista, con su capacidad (el diálogo de la vista). */
    async people(tenantId: number, actor: Actor, listKey: string): Promise<WorkloadMemberDto[]> {
        return this.records.readScoped(tenantId, actor, listKey, async (tx, scope) => {
            const members = await this.members(tx, tenantId, scope.list.settings);
            return members
                .filter((m) => m.canView)
                .map((m) => ({ user_id: m.userId, name: m.name, email: m.email, capacity: m.capacity, capacity_custom: m.custom }));
        });
    }

    // ─────────────────────────── Capacidad ───────────────────────────

    /**
     * Guarda (o vuelve al valor por defecto, con `null`) la capacidad de una
     * persona del equipo. Escritura atómica sobre `memberships.settings` (no
     * pisa sus favoritos ni sus avisos). Bitácora + aviso por realtime.
     */
    async setCapacity(
        tenantId: number,
        actor: Actor,
        userId: number,
        capacity: WorkloadCapacity | null,
    ): Promise<WorkloadMemberDto> {
        if (!roleHasCapability(actor.role, 'edit_records')) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Sólo quien administra el trabajo del equipo cambia la capacidad.', data: { status: 403 } });
        }
        const next = capacity ? readWorkloadCapacity(capacity) : null;
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [m] = await tx
                .select({ role: memberships.role, name: users.name, email: users.email, disabledAt: users.disabledAt })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1);
            if (!m || m.role === 'client' || m.disabledAt !== null) {
                throw new NotFoundException({ code: 'member_not_found', message: 'Esa persona no es del equipo de la empresa.', data: { status: 404 } });
            }
            const value = next ? sql`jsonb_build_object('capacity', ${JSON.stringify(next.capacity)}::jsonb)` : null;
            await tx
                .update(memberships)
                .set({
                    settings: value
                        ? sql`coalesce(${memberships.settings}, '{}'::jsonb) || ${value}`
                        : sql`coalesce(${memberships.settings}, '{}'::jsonb) - 'capacity'`,
                    updatedAt: new Date(),
                })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
            return m;
        });
        const cap = next ?? readWorkloadCapacity(undefined);
        const name = row.name?.trim() ? row.name : row.email;
        await this.audit?.log({
            tenantId,
            userId: actor.userId,
            action: 'workload.capacity',
            targetType: 'user',
            targetId: userId,
            targetLabel: name,
            meta: next ? { ...next.capacity } : { reset: true },
        });
        // Las vistas de carga abiertas (de cualquier lista) se refrescan.
        this.realtime.invalidate(tenantId, 'records');
        return { user_id: userId, name, email: row.email, capacity: cap.capacity, capacity_custom: next !== null };
    }

}

/** Fila cruda de las consultas, antes de calcular la carga. */
interface RawItem extends Omit<WorkloadItem, 'editable'> {
    created_by: number;
    assigned: unknown;
}

function rawRow(r: Record<string, unknown>): Pick<RawItem, 'id' | 'title' | 'person' | 'person_value' | 'done' | 'created_by' | 'assigned'> {
    const person = personKey(r.person);
    return {
        id: Number(r.id),
        title: typeof r.title === 'string' && r.title.trim() !== '' ? r.title : null,
        person,
        person_value: person === WORKLOAD_UNASSIGNED ? null : Number(person),
        done: r.done === true,
        created_by: Number(r.created_by ?? 0),
        assigned: r.assigned ?? null,
    };
}

/** El valor de un campo Persona → clave de fila (`__none__` si no hay persona válida). */
function personKey(v: unknown): string {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? String(n) : WORKLOAD_UNASSIGNED;
}

function toPerson(userId: number | null, name: string, email: string | null, member: boolean, capacity: WorkloadCapacity, custom: boolean): WorkloadPerson {
    return { key: userId === null ? WORKLOAD_UNASSIGNED : String(userId), user_id: userId, name, email, member, capacity, capacity_custom: custom };
}

/** El título de la lista, si quien mira lo ve. */
function visibleTitle(scope: ReadScope): number | null {
    const id = resolveTitleFieldId(scope.fields, scope.list.settings);
    return id !== null && !scope.hiddenIds.has(id) ? id : null;
}

/** ¿Un derivado se puede sumar como número? (los demás tipos ya son numéricos) */
function numericFilterable(f: FilterableField): boolean {
    if (f.type === 'number' || f.type === 'duration') return true;
    if (!f.expr) return false;
    if (f.type === 'formula') return f.formulaKind === 'number';
    if (f.type === 'rollup') return f.valueKind !== 'text';
    return true;
}

/** ¿Quien mira puede editar ESTA fila? (capacidad del rol + alcance de edición de la lista) */
function editability(scope: ReadScope, actor: Actor): (row: Pick<RawItem, 'created_by' | 'assigned'>) => boolean {
    const canEditAny = roleHasCapability(actor.role, 'edit_records') || roleHasCapability(actor.role, 'edit_own_records');
    const editScope = effectivePermissions(scope.list.settings, actor.role, actor.userId).edit;
    return (row) => canEditAny && rowInScope(editScope, actor.userId, { createdBy: row.created_by, assignmentValue: row.assigned });
}

function assertRange(from: string, to: string): void {
    if (!YMD.test(from) || !YMD.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
        throw badRequest('invalid_range', 'from y to tienen que ser fechas AAAA-MM-DD');
    }
    if (to < from) throw badRequest('invalid_range', 'to no puede ser anterior a from');
    if (addDaysYmd(from, WORKLOAD_MAX_RANGE_DAYS - 1) < to) {
        throw badRequest('invalid_range', `La carga abarca como máximo ${WORKLOAD_MAX_RANGE_DAYS} días`);
    }
}

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}
