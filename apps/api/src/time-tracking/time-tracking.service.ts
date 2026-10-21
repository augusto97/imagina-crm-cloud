import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    FALLBACK_TIME_ZONE,
    RECORD_TIME_ENTRIES,
    formatDuration,
    jsonbKeyForField,
    resolveTitleFieldId,
    zonedToday,
    type ActiveTimerDto,
    type CreateTimeEntryInput,
    type RecordTimeDto,
    type Role,
    type TimeEntryDto,
    type UpdateTimeEntryInput,
} from '@imagina-base/shared';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { lists, records, timeEntries, users, type TimeEntryRow } from '../db/schema';
import { neutralizeFormula } from '../export/export.service';
import { FieldsService } from '../fields/fields.service';
import { effectivePermissions, resolvePermissions, scopeWhere } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

/** Nombre visible: el nombre, o el email si la cuenta no tiene nombre. */
const userName = sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`;

/** Un cronómetro en curso: de tipo `timer` y sin fin. */
const running: SQL = and(eq(timeEntries.source, 'timer'), isNull(timeEntries.endedAt))!;

/** Filas del CSV como mucho (una lista con años de registro de tiempo entra de sobra). */
const EXPORT_CAP = 50_000;

type EntryWithName = TimeEntryRow & { userName: string | null };

function canManageAll(role: Role): boolean {
    return role === 'admin' || role === 'manager';
}

function isRunning(row: Pick<TimeEntryRow, 'source' | 'endedAt'>): boolean {
    return row.source === 'timer' && row.endedAt === null;
}

export function toTimeEntry(row: EntryWithName): TimeEntryDto {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        user_name: row.userName,
        source: row.source === 'timer' ? 'timer' : 'manual',
        work_date: row.workDate,
        started_at: row.startedAt ? row.startedAt.toISOString() : null,
        ended_at: row.endedAt ? row.endedAt.toISOString() : null,
        seconds: row.seconds,
        note: row.note,
        running: isRunning(row),
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function entryNotFound(): NotFoundException {
    return new NotFoundException({ code: 'time_entry_not_found', message: 'Entrada de tiempo no encontrada', data: { status: 404 } });
}

function isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code === '23505' || e.cause?.code === '23505';
}

/** Las columnas de una entrada + el nombre de quien la cargó. */
const entryColumns = {
    id: timeEntries.id,
    tenantId: timeEntries.tenantId,
    listId: timeEntries.listId,
    recordId: timeEntries.recordId,
    userId: timeEntries.userId,
    source: timeEntries.source,
    workDate: timeEntries.workDate,
    startedAt: timeEntries.startedAt,
    endedAt: timeEntries.endedAt,
    seconds: timeEntries.seconds,
    note: timeEntries.note,
    createdAt: timeEntries.createdAt,
    updatedAt: timeEntries.updatedAt,
    userName,
};

/**
 * v0.1.288 — Registro de tiempo por registro.
 *
 * Reglas:
 *  - registra tiempo quien puede VER el registro (el mismo ACL que la ficha:
 *    `RecordsService.get` da 404 si el alcance del rol no lo alcanza);
 *  - cada persona tiene a lo sumo UN cronómetro en curso en toda la empresa
 *    (índice único parcial): iniciar otro detiene el anterior y lo guarda, en
 *    la MISMA transacción;
 *  - todos ven las entradas de un registro que ven (el total es útil para el
 *    equipo); cada uno edita y borra las suyas, admin y manager todas;
 *  - el total del registro es el campo «Tiempo registrado» (`time_tracked`):
 *    se resuelve en cada lectura sumando esta tabla, nunca se copia.
 */
@Injectable()
export class TimeTrackingService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    private async zone(tenantId: number): Promise<string> {
        return this.timeZones ? this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE;
    }

    // ─────────────────────────── Lectura ───────────────────────────

    /** El tiempo de un registro (ACL de la ficha: 404 si no se ve). */
    async recordTime(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number): Promise<RecordTimeDto> {
        await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        return this.tenantDb.withTenant(tenantId, (tx) => this.recordTimeInTx(tx, tenantId, actor, recordId));
    }

    /**
     * Lo mismo, para un registro YA autorizado (el bundle de la ficha lo
     * verificó al abrir): total y por persona en una query, las últimas
     * entradas en otra, su cantidad y el cronómetro de quien mira.
     */
    async recordTimeInTx(tx: Tx, tenantId: number, actor: Actor, recordId: number): Promise<RecordTimeDto> {
        const scope = and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.recordId, recordId))!;
        const totals = await tx
            .select({
                userId: timeEntries.userId,
                name: userName,
                seconds: sql<number>`coalesce(sum(${timeEntries.seconds}), 0)::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(timeEntries)
            .leftJoin(users, eq(users.id, timeEntries.userId))
            .where(scope)
            .groupBy(timeEntries.userId, users.name, users.email);
        const entries = await tx
            .select(entryColumns)
            .from(timeEntries)
            .leftJoin(users, eq(users.id, timeEntries.userId))
            .where(scope)
            // Lo que corre primero; después lo más nuevo.
            .orderBy(sql`CASE WHEN ${running} THEN 0 ELSE 1 END`, desc(timeEntries.workDate), desc(timeEntries.id))
            .limit(RECORD_TIME_ENTRIES);
        const mine = entries.find((e) => isRunning(e) && e.userId === actor.userId) ?? null;
        return {
            total_seconds: totals.reduce((acc, t) => acc + Number(t.seconds), 0),
            by_user: totals
                .filter((t) => Number(t.seconds) > 0)
                .map((t) => ({ user_id: t.userId, user_name: t.name, seconds: Number(t.seconds) }))
                .sort((a, b) => b.seconds - a.seconds),
            entries: entries.map(toTimeEntry),
            entries_count: totals.reduce((acc, t) => acc + Number(t.count), 0),
            my_running: mine ? toTimeEntry(mine) : null,
            can_manage_all: canManageAll(actor.role),
        };
    }

    /**
     * El cronómetro en curso de una persona (en cualquier registro de la
     * empresa), con lo que la barra superior necesita para nombrarlo. Si el
     * registro se borró mientras corría, el cronómetro se detiene solo (no
     * queda uno colgado que no lleva a ningún lado).
     */
    async active(tenantId: number, userId: number): Promise<ActiveTimerDto | null> {
        const found = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ ...entryColumns, listSlug: lists.slug, listName: lists.name, listSettings: lists.settings, data: records.data, recordDeleted: records.deletedAt })
                .from(timeEntries)
                .innerJoin(lists, eq(lists.id, timeEntries.listId))
                .innerJoin(records, eq(records.id, timeEntries.recordId))
                .leftJoin(users, eq(users.id, timeEntries.userId))
                .where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.userId, userId), running))
                .limit(1);
            if (!row) return null;
            if (row.recordDeleted !== null) {
                await this.stopRunningInTx(tx, tenantId, userId);
                return { kind: 'stopped' as const, listId: row.listId };
            }
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, row.listId);
            const titleId = resolveTitleFieldId(fields, row.listSettings as Record<string, unknown>);
            const raw = titleId !== null ? (row.data as Record<string, unknown>)[jsonbKeyForField(titleId)] : null;
            return {
                kind: 'timer' as const,
                timer: {
                    entry: toTimeEntry(row),
                    list_slug: row.listSlug,
                    list_name: row.listName,
                    record_title: typeof raw === 'string' && raw.trim() ? raw.trim() : `Registro #${row.recordId}`,
                } satisfies ActiveTimerDto,
            };
        });
        if (found?.kind === 'stopped') {
            this.realtime.records(tenantId, found.listId);
            this.realtime.timer(tenantId, userId);
            return null;
        }
        return found?.timer ?? null;
    }

    // ─────────────────────────── Cronómetro ───────────────────────────

    /**
     * Inicia el cronómetro en un registro. Si la persona tenía otro corriendo
     * (en cualquier registro), se detiene y se guarda en la MISMA
     * transacción. Si dos pestañas inician a la vez, el índice único deja
     * entrar a una y la otra reintenta (y detiene a la primera).
     */
    async start(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        note?: string,
    ): Promise<{ entry: TimeEntryDto; stopped: TimeEntryDto | null }> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const tz = await this.zone(tenantId);
        const attempt = () =>
            this.tenantDb.withTenant(tenantId, async (tx) => {
                const stopped = await this.stopRunningInTx(tx, tenantId, actor.userId);
                const [row] = await tx
                    .insert(timeEntries)
                    .values({
                        tenantId,
                        listId: record.list_id,
                        recordId,
                        userId: actor.userId,
                        source: 'timer',
                        workDate: zonedToday(tz),
                        startedAt: new Date(),
                        note: (note ?? '').slice(0, 500),
                    })
                    .returning();
                return { row: row!, stopped, name: await this.nameOf(tx, actor.userId) };
            });
        let result: Awaited<ReturnType<typeof attempt>>;
        try {
            result = await attempt();
        } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            result = await attempt();
        }
        this.realtime.records(tenantId, record.list_id);
        if (result.stopped && result.stopped.list_id !== record.list_id) this.realtime.records(tenantId, result.stopped.list_id);
        this.realtime.timer(tenantId, actor.userId);
        return { entry: toTimeEntry({ ...result.row, userName: result.name }), stopped: result.stopped };
    }

    /** Detiene el cronómetro en curso de la persona (donde sea). null si no tenía. */
    async stop(tenantId: number, actor: Actor): Promise<TimeEntryDto | null> {
        const stopped = await this.tenantDb.withTenant(tenantId, (tx) => this.stopRunningInTx(tx, tenantId, actor.userId));
        if (stopped) this.realtime.records(tenantId, stopped.list_id);
        this.realtime.timer(tenantId, actor.userId);
        return stopped;
    }

    /**
     * Cierra el cronómetro en curso de una persona con los segundos
     * transcurridos (medidos por la base: el reloj de un nodo no manda). Un
     * cronómetro de menos de un segundo no deja una entrada vacía.
     */
    private async stopRunningInTx(tx: Tx, tenantId: number, userId: number): Promise<TimeEntryDto | null> {
        const [row] = await tx
            .update(timeEntries)
            .set({
                endedAt: sql`now()`,
                seconds: sql`greatest(0, floor(extract(epoch from (now() - ${timeEntries.startedAt}))))::int`,
                updatedAt: sql`now()`,
            })
            .where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.userId, userId), running))
            .returning();
        if (!row) return null;
        if (row.seconds < 1) {
            await tx.delete(timeEntries).where(eq(timeEntries.id, row.id));
            return null;
        }
        return toTimeEntry({ ...row, userName: await this.nameOf(tx, userId) });
    }

    // ─────────────────────────── Entradas ───────────────────────────

    /** Carga manual: fecha + duración (ya en minutos) + nota. */
    async create(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        input: CreateTimeEntryInput,
    ): Promise<TimeEntryDto> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .insert(timeEntries)
                .values({
                    tenantId,
                    listId: record.list_id,
                    recordId,
                    userId: actor.userId,
                    source: 'manual',
                    workDate: input.work_date,
                    seconds: input.duration * 60,
                    note: input.note ?? '',
                })
                .returning();
            return toTimeEntry({ ...row!, userName: await this.nameOf(tx, actor.userId) });
        });
        this.realtime.records(tenantId, record.list_id);
        return out;
    }

    /** Edita una entrada: la propia, o cualquiera si es admin/manager. */
    async update(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        recordId: number,
        entryId: number,
        patch: UpdateTimeEntryInput,
    ): Promise<TimeEntryDto> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.ownedEntry(tx, tenantId, actor, recordId, entryId);
            if (patch.duration !== undefined && isRunning(current)) {
                throw new BadRequestException({
                    code: 'timer_running',
                    message: 'El cronómetro sigue corriendo: detenlo antes de cambiar la duración.',
                    data: { status: 400 },
                });
            }
            const [row] = await tx
                .update(timeEntries)
                .set({
                    ...(patch.work_date !== undefined ? { workDate: patch.work_date } : {}),
                    ...(patch.duration !== undefined ? { seconds: patch.duration * 60 } : {}),
                    ...(patch.note !== undefined ? { note: patch.note } : {}),
                    updatedAt: sql`now()`,
                })
                .where(eq(timeEntries.id, current.id))
                .returning();
            return toTimeEntry({ ...row!, userName: await this.nameOf(tx, row!.userId) });
        });
        this.realtime.records(tenantId, record.list_id);
        if (out.running && out.user_id !== null) this.realtime.timer(tenantId, out.user_id);
        return out;
    }

    /** Borra una entrada (la propia, o cualquiera si es admin/manager). */
    async remove(tenantId: number, actor: Actor, listIdOrSlug: string, recordId: number, entryId: number): Promise<void> {
        const record = await this.records.get(tenantId, actor, listIdOrSlug, recordId);
        const owner = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.ownedEntry(tx, tenantId, actor, recordId, entryId);
            await tx.delete(timeEntries).where(eq(timeEntries.id, current.id));
            return isRunning(current) ? current.userId : null;
        });
        this.realtime.records(tenantId, record.list_id);
        if (owner !== null) this.realtime.timer(tenantId, owner);
    }

    private async ownedEntry(tx: Tx, tenantId: number, actor: Actor, recordId: number, entryId: number): Promise<TimeEntryRow> {
        const [row] = await tx
            .select()
            .from(timeEntries)
            .where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.id, entryId), eq(timeEntries.recordId, recordId)))
            .limit(1);
        if (!row) throw entryNotFound();
        if (row.userId !== actor.userId && !canManageAll(actor.role)) {
            throw new ForbiddenException({
                code: 'time_entry_forbidden',
                message: 'Sólo puedes cambiar tu propio tiempo (admin y manager pueden cambiar el de todos).',
                data: { status: 403 },
            });
        }
        return row;
    }

    private async nameOf(tx: Tx, uid: number | null): Promise<string | null> {
        if (uid === null) return null;
        const [u] = await tx.select({ name: userName }).from(users).where(eq(users.id, uid)).limit(1);
        return u?.name ?? null;
    }

    // ─────────────────────────── Exportar ───────────────────────────

    /**
     * CSV con las entradas de una lista: fecha, persona, registro, duración,
     * nota. Con el ACL de quien exporta: sólo las de los registros que su rol
     * alcanza en esa lista (y el título no sale si su campo le está oculto).
     * Cada celda pasa por la neutralización de fórmulas del export de
     * registros (una nota que empieza con `=` no se ejecuta en Excel).
     */
    async exportCsv(tenantId: number, actor: Actor, listIdOrSlug: string): Promise<{ filename: string; csv: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const perms = effectivePermissions(list.settings, actor.role, actor.userId);
        const assignmentId = resolvePermissions(list.settings).assignment_field_id;
        const scope = scopeWhere(perms.view, actor.userId, assignmentId ? jsonbKeyForField(assignmentId) : null);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
            const titleField = titleId !== null ? fields.find((f) => f.id === titleId) : undefined;
            const titleKey = titleField && !perms.fields_hidden.includes(titleField.slug) ? jsonbKeyForField(titleField.id) : null;
            const found = await tx
                .select({ ...entryColumns, data: records.data })
                .from(timeEntries)
                .innerJoin(records, and(eq(records.id, timeEntries.recordId), isNull(records.deletedAt)))
                .leftJoin(users, eq(users.id, timeEntries.userId))
                .where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.listId, list.id), scope))
                .orderBy(desc(timeEntries.workDate), asc(timeEntries.id))
                .limit(EXPORT_CAP);
            return found.map((r) => {
                const raw = titleKey ? (r.data as Record<string, unknown>)[titleKey] : null;
                return { ...r, title: typeof raw === 'string' && raw.trim() ? raw.trim() : `Registro #${r.recordId}` };
            });
        });
        const header = ['Fecha', 'Persona', 'Registro', 'ID del registro', 'Duración', 'Horas', 'Nota', 'Tipo'];
        const lines = [header, ...rows.map((r) => {
            const minutes = Math.round(r.seconds / 60);
            return [
                r.workDate,
                r.userName ?? 'Persona eliminada',
                r.title,
                String(r.recordId),
                isRunning(r) ? 'En curso' : formatDuration(minutes),
                isRunning(r) ? '' : (r.seconds / 3600).toFixed(2),
                r.note,
                r.source === 'timer' ? 'Cronómetro' : 'Manual',
            ];
        })];
        const csv = '﻿' + lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
        const date = new Date().toISOString().slice(0, 10);
        return { filename: `tiempo-${list.slug}-${date}.csv`, csv };
    }
}

/** Una celda CSV (RFC 4180): fórmulas neutralizadas y comillas cuando hace falta. */
function csvCell(raw: string): string {
    const cell = neutralizeFormula(raw);
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
