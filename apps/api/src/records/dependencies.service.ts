import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    DEFAULT_DEPENDENCY_SETTINGS,
    DEPENDENCY_MAX_PER_RECORD,
    doneRuleFor,
    findDependencyCycle,
    isDoneValue,
    jsonbKeyForField,
    readDependencySettings,
    resolveTitleFieldId,
    type CreateDependencyInput,
    type DependencyKind,
    type DependencyLink,
    type DependencySettings,
    type Field,
    type List,
    type RecordDependencies,
    type UpdateDependencySettingsInput,
} from '@imagina-base/shared';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { FieldsService } from '../fields/fields.service';
import { hiddenFieldsFor } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { DependenciesRepository, type DependencyLinkRow } from './dependencies.repository';
import { RecordsRepository } from './records.repository';
import { RecordsService, type Actor } from './records.service';

interface Prepared {
    list: List;
    fields: Field[];
}

/**
 * A8 — Dependencias entre registros: «bloquea» / «bloqueado por».
 *
 * Reglas:
 *  - Hoy las dos puntas son de la MISMA lista (la API recibe `list_id` para
 *    que permitir otra lista no la cambie).
 *  - Sin ciclos: A→B→A se rechaza con el camino que lo cerraría. El chequeo
 *    corre con un candado por lista, así dos altas simultáneas no lo esquivan.
 *  - Quien agrega o quita una dependencia tiene que poder VER las dos puntas y
 *    EDITAR el registro bloqueado (es su calendario el que cambia).
 *  - Un registro en la papelera deja sus dependencias inertes (no cuentan ni
 *    se listan) y vuelven con él si se restaura.
 * Cada alta/baja deja una entrada de actividad en los DOS registros y avisa
 * por realtime a la lista.
 */
@Injectable()
export class DependenciesService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly repo: DependenciesRepository,
        private readonly activity: ActivityService,
        private readonly realtime: RealtimeService,
        @Optional() private readonly audit?: AuditService,
    ) {}

    /** Las dependencias de un registro, desde su punto de vista (ficha, aviso al cerrar). */
    async forRecord(tenantId: number, actor: Actor, listKey: string, recordId: number): Promise<RecordDependencies> {
        const list = await this.lists.get(tenantId, listKey);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const row = await this.recordsRepo.findById(tx, tenantId, list.id, recordId);
            if (!row || !this.records.canReach(list, actor, 'view', row)) throw recordNotFound(recordId);
            return this.linksInTx(tx, tenantId, actor, { list, fields }, recordId);
        });
    }

    /** Lo mismo dentro de una transacción ya abierta (bundle de la ficha). */
    async linksInTx(tx: Tx, tenantId: number, actor: Actor, prep: Prepared, recordId: number): Promise<RecordDependencies> {
        const { blockedBy, blocks } = await this.repo.linksOf(tx, tenantId, recordId);
        const view = this.linkView(prep, actor);
        return {
            blocked_by: blockedBy.filter((l) => l.other !== null).map(view),
            blocks: blocks.filter((l) => l.other !== null).map(view),
        };
    }

    /** Alta desde un registro: «este registro está bloqueado por X» o «bloquea a X». */
    async add(tenantId: number, actor: Actor, listKey: string, recordId: number, input: CreateDependencyInput): Promise<RecordDependencies> {
        const [blocker, blocked] = input.kind === 'blocked_by' ? [input.record_id, recordId] : [recordId, input.record_id];
        const list = await this.lists.get(tenantId, listKey);
        if (input.list_id !== undefined && input.list_id !== list.id) {
            throw new BadRequestException({
                code: 'dependency_other_list',
                message: 'Por ahora las dependencias son entre registros de la misma lista.',
                data: { status: 400 },
            });
        }
        await this.addPair(tenantId, actor, String(list.id), blocker, blocked, input.lag_days ?? 0);
        return this.forRecord(tenantId, actor, String(list.id), recordId);
    }

    /**
     * Alta por las dos puntas (Gantt: de una barra a otra; asistente). Si ya
     * existe, se actualiza el desfase y se devuelve la misma.
     */
    async addPair(
        tenantId: number,
        actor: Actor,
        listKey: string,
        blockerId: number,
        blockedId: number,
        lagDays = 0,
    ): Promise<{ id: number; blocker_id: number; blocked_id: number; lag_days: number; created: boolean }> {
        if (blockerId === blockedId) {
            throw new BadRequestException({
                code: 'dependency_self',
                message: 'Un registro no puede bloquearse a sí mismo.',
                data: { status: 400 },
            });
        }
        const list = await this.lists.get(tenantId, listKey);
        const result = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await this.repo.lockList(tx, tenantId, list.id);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const blocker = await this.recordsRepo.findById(tx, tenantId, list.id, blockerId);
            const blocked = await this.recordsRepo.findById(tx, tenantId, list.id, blockedId);
            if (!blocker || !this.records.canReach(list, actor, 'view', blocker)) throw recordNotFound(blockerId);
            if (!blocked || !this.records.canReach(list, actor, 'view', blocked)) throw recordNotFound(blockedId);
            if (!this.records.canReach(list, actor, 'edit', blocked)) throw cannotEdit();

            const existing = await this.repo.findPair(tx, tenantId, blockerId, blockedId);
            if (existing) {
                const row = existing.lagDays === lagDays ? existing : (await this.repo.updateLag(tx, tenantId, existing.id, lagDays)) ?? existing;
                return { row, created: false, fields };
            }
            if ((await this.repo.countBlockersOf(tx, tenantId, blockedId)) >= DEPENDENCY_MAX_PER_RECORD) {
                throw new BadRequestException({
                    code: 'dependency_limit',
                    message: `Un registro puede tener hasta ${DEPENDENCY_MAX_PER_RECORD} bloqueantes.`,
                    data: { status: 400 },
                });
            }
            // Sin ciclos: se miran TODAS las aristas de la lista (también las
            // de registros en la papelera, para que restaurar uno nunca cierre
            // un círculo).
            const edges = await this.repo.edgesOfList(tx, tenantId, list.id);
            const out = new Map<number, number[]>();
            for (const e of edges) out.set(e.blocker, [...(out.get(e.blocker) ?? []), e.blocked]);
            const cycle = findDependencyCycle(blockerId, blockedId, (id) => out.get(id) ?? []);
            if (cycle) {
                const titles = await this.titlesOf(tx, tenantId, list, fields, cycle);
                throw new BadRequestException({
                    code: 'dependency_cycle',
                    message:
                        `No se puede: «${titles.get(blockedId)}» ya bloquea a «${titles.get(blockerId)}»` +
                        (cycle.length > 2 ? ` (${cycle.map((id) => `«${titles.get(id)}»`).join(' → ')})` : '') +
                        '. Una dependencia así cerraría un círculo.',
                    data: { status: 400, path: cycle },
                });
            }
            const row = await this.repo.insert(tx, {
                tenantId,
                blockerListId: list.id,
                blockerRecordId: blockerId,
                blockedListId: list.id,
                blockedRecordId: blockedId,
                lagDays,
                createdBy: actor.userId > 0 ? actor.userId : null,
            });
            const titles = await this.titlesOf(tx, tenantId, list, fields, [blockerId, blockedId]);
            await this.logPair(tx, tenantId, list.id, actor, 'dependency_added', blockerId, blockedId, titles);
            return { row, created: true, fields };
        });
        this.realtime.records(tenantId, list.id);
        const r = result.row;
        return { id: r.id, blocker_id: r.blockerRecordId, blocked_id: r.blockedRecordId, lag_days: r.lagDays, created: result.created };
    }

    async updateLag(tenantId: number, actor: Actor, listKey: string, depId: number, lagDays: number): Promise<{ id: number; lag_days: number }> {
        const list = await this.lists.get(tenantId, listKey);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const dep = await this.repo.findById(tx, tenantId, depId);
            if (!dep || dep.blockedListId !== list.id) throw dependencyNotFound(depId);
            const blocked = await this.recordsRepo.findById(tx, tenantId, list.id, dep.blockedRecordId);
            if (!blocked || !this.records.canReach(list, actor, 'edit', blocked)) throw dependencyNotFound(depId);
            return this.repo.updateLag(tx, tenantId, depId, lagDays);
        });
        if (!row) throw dependencyNotFound(depId);
        this.realtime.records(tenantId, list.id);
        return { id: row.id, lag_days: row.lagDays };
    }

    /**
     * Quitar una dependencia. `recordId` (opcional) es el registro desde el
     * que se pide: la dependencia tiene que tocarlo.
     */
    async remove(tenantId: number, actor: Actor, listKey: string, depId: number, recordId?: number): Promise<void> {
        const list = await this.lists.get(tenantId, listKey);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const dep = await this.repo.findById(tx, tenantId, depId);
            if (!dep || dep.blockedListId !== list.id) throw dependencyNotFound(depId);
            if (recordId !== undefined && dep.blockedRecordId !== recordId && dep.blockerRecordId !== recordId) throw dependencyNotFound(depId);
            const blocked = await this.recordsRepo.findById(tx, tenantId, list.id, dep.blockedRecordId);
            if (!blocked || !this.records.canReach(list, actor, 'view', blocked)) throw dependencyNotFound(depId);
            if (!this.records.canReach(list, actor, 'edit', blocked)) throw cannotEdit();
            await this.repo.delete(tx, tenantId, depId);
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const titles = await this.titlesOf(tx, tenantId, list, fields, [dep.blockerRecordId, dep.blockedRecordId]);
            await this.logPair(tx, tenantId, list.id, actor, 'dependency_removed', dep.blockerRecordId, dep.blockedRecordId, titles);
        });
        this.realtime.records(tenantId, list.id);
    }

    /** Quitar por las dos puntas (asistente). No existe → 404. */
    async removePair(tenantId: number, actor: Actor, listKey: string, blockerId: number, blockedId: number): Promise<void> {
        const list = await this.lists.get(tenantId, listKey);
        const dep = await this.tenantDb.withTenant(tenantId, (tx) => this.repo.findPair(tx, tenantId, blockerId, blockedId));
        if (!dep || dep.blockedListId !== list.id) throw dependencyNotFound(0);
        await this.remove(tenantId, actor, String(list.id), dep.id);
    }

    // ─────────────────────────── Ajustes ───────────────────────────

    async settings(tenantId: number, listKey: string): Promise<DependencySettings> {
        const list = await this.lists.get(tenantId, listKey);
        return readDependencySettings(list.settings);
    }

    /**
     * Reprogramación: se guarda en `settings.dependencies` de la LISTA (es una
     * regla de los datos, ver `dependency.ts`). Los campos tienen que ser de
     * fecha (o fecha y hora) de esa lista; encenderla exige al menos uno.
     */
    async updateSettings(tenantId: number, actor: Actor, listKey: string, patch: UpdateDependencySettingsInput): Promise<DependencySettings> {
        const list = await this.lists.get(tenantId, listKey);
        const current = readDependencySettings(list.settings);
        const next: DependencySettings = { ...DEFAULT_DEPENDENCY_SETTINGS, ...current, ...patch };
        const fields = await this.fields.listByListId(tenantId, list.id);
        for (const [key, label] of [['start_field_id', 'inicio'], ['end_field_id', 'fin']] as const) {
            const id = next[key];
            if (id === null) continue;
            const f = fields.find((x) => x.id === id);
            if (!f || (f.type !== 'date' && f.type !== 'datetime')) {
                throw new BadRequestException({
                    code: 'invalid_dependency_field',
                    message: `El campo de ${label} tiene que ser una fecha de esta lista.`,
                    data: { status: 400 },
                });
            }
        }
        if (next.start_field_id !== null && next.start_field_id === next.end_field_id) next.end_field_id = null;
        if (next.reschedule && next.start_field_id === null && next.end_field_id === null) {
            throw new BadRequestException({
                code: 'invalid_dependency_field',
                message: 'Para reprogramar hace falta elegir el campo de fin (o de inicio).',
                data: { status: 400 },
            });
        }
        // Se relee y se mezcla SÓLO esta clave (otra pestaña pudo cambiar otras).
        const fresh = await this.lists.get(tenantId, String(list.id));
        await this.lists.update(tenantId, String(list.id), { settings: { ...fresh.settings, dependencies: next } });
        void this.audit?.log({
            tenantId,
            userId: actor.userId > 0 ? actor.userId : null,
            action: 'list.dependencies_settings',
            targetType: 'list',
            targetId: list.id,
            targetLabel: list.name,
            meta: { reschedule: next.reschedule, start_field_id: next.start_field_id, end_field_id: next.end_field_id },
        });
        this.realtime.records(tenantId, list.id);
        return next;
    }

    // ─────────────────────────── Internos ───────────────────────────

    private linkView(prep: Prepared, actor: Actor): (l: DependencyLinkRow) => DependencyLink {
        const titleId = resolveTitleFieldId(prep.fields, prep.list.settings as Record<string, unknown>);
        const titleKey = titleId !== null ? jsonbKeyForField(titleId) : null;
        const rule = doneRuleFor(prep.fields);
        const hidden = hiddenFieldsFor(prep.list.settings as Record<string, unknown>, actor.role, actor.userId);
        const statusField = rule ? prep.fields.find((f) => f.id === rule.fieldId) ?? null : null;
        const statusVisible = statusField !== null && !hidden.has(statusField.slug);
        const titleVisible = titleId !== null && !hidden.has(prep.fields.find((f) => f.id === titleId)?.slug ?? '');
        const options = ((statusField?.config as { options?: Array<{ value: string; label?: string; color?: string }> } | undefined)?.options ?? []);
        return (l) => {
            const other = l.other!;
            const reachable = this.records.canReach(prep.list, actor, 'view', other);
            const rawStatus = rule ? other.data[jsonbKeyForField(rule.fieldId)] : null;
            const opt = rawStatus !== null && rawStatus !== undefined ? options.find((o) => String(o.value) === String(rawStatus)) : undefined;
            const rawTitle = titleKey ? other.data[titleKey] : null;
            return {
                id: l.dep.id,
                record_id: other.id,
                list_id: other.listId,
                title: reachable
                    ? titleVisible && typeof rawTitle === 'string' && rawTitle.trim() !== ''
                        ? rawTitle.trim()
                        : `Registro #${other.id}`
                    : null,
                status:
                    reachable && statusVisible && opt
                        ? { value: String(opt.value), label: opt.label ?? String(opt.value), color: opt.color ?? null }
                        : null,
                // Si el estado está oculto para quien mira, cuenta como abierto
                // (no se deduce un dato que no puede ver; igual que el listado).
                done: statusVisible && isDoneValue(rule, rawStatus),
                lag_days: l.dep.lagDays,
                created_at: l.dep.createdAt.toISOString(),
            };
        };
    }

    private async titlesOf(tx: Tx, tenantId: number, list: List, fields: Field[], ids: number[]): Promise<Map<number, string>> {
        const titleId = resolveTitleFieldId(fields, list.settings as Record<string, unknown>);
        const rows = await this.repo.rowsOf(tx, tenantId, list.id, ids);
        const out = new Map<number, string>();
        for (const id of new Set(ids)) {
            const raw = titleId !== null ? rows.get(id)?.data[jsonbKeyForField(titleId)] : null;
            out.set(id, typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : `Registro #${id}`);
        }
        return out;
    }

    /**
     * Asistente/MCP — revisa un lote de altas y bajas SIN escribir: que los
     * registros existan y se vean, que quien pide pueda editar el bloqueado,
     * que una baja exista y que las altas (aplicadas en orden, después de las
     * bajas) no cierren un círculo. Devuelve los problemas legibles y los
     * títulos para la tarjeta.
     */
    async plan(
        tenantId: number,
        actor: Actor,
        listKey: string,
        add: Array<{ blocker: number; blocked: number; lag_days?: number }>,
        remove: Array<{ blocker: number; blocked: number }>,
    ): Promise<{ listId: number; problems: string[]; titles: Map<number, string>; existing: Set<string> }> {
        const list = await this.lists.get(tenantId, listKey);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, list.id);
            const ids = [...add, ...remove].flatMap((p) => [p.blocker, p.blocked]);
            const rows = await this.repo.rowsOf(tx, tenantId, list.id, ids);
            const titles = await this.titlesOf(tx, tenantId, list, fields, ids);
            const t = (id: number): string => `«${titles.get(id) ?? `Registro #${id}`}» (#${id})`;
            const problems: string[] = [];
            const visible = (id: number): boolean => {
                const r = rows.get(id);
                return !!r && this.records.canReach(list, actor, 'view', r);
            };
            const edges = await this.repo.edgesOfList(tx, tenantId, list.id);
            const out = new Map<number, Set<number>>();
            for (const e of edges) (out.get(e.blocker) ?? out.set(e.blocker, new Set()).get(e.blocker)!).add(e.blocked);
            const existing = new Set(edges.map((e) => `${e.blocker}>${e.blocked}`));
            for (const p of remove) {
                if (!existing.has(`${p.blocker}>${p.blocked}`)) {
                    problems.push(`No existe la dependencia ${t(p.blocker)} bloquea a ${t(p.blocked)}.`);
                    continue;
                }
                const r = rows.get(p.blocked);
                if (!r || !this.records.canReach(list, actor, 'edit', r)) problems.push(`No tienes permiso para cambiar las dependencias de ${t(p.blocked)}.`);
                out.get(p.blocker)?.delete(p.blocked);
            }
            for (const p of add) {
                if (p.blocker === p.blocked) {
                    problems.push(`${t(p.blocker)} no puede bloquearse a sí mismo.`);
                    continue;
                }
                if (!visible(p.blocker)) problems.push(`El registro #${p.blocker} no existe en «${list.name}» (o no puedes verlo).`);
                if (!visible(p.blocked)) problems.push(`El registro #${p.blocked} no existe en «${list.name}» (o no puedes verlo).`);
                if (!visible(p.blocker) || !visible(p.blocked)) continue;
                if (!this.records.canReach(list, actor, 'edit', rows.get(p.blocked)!)) {
                    problems.push(`No tienes permiso para cambiar las dependencias de ${t(p.blocked)}.`);
                    continue;
                }
                if (out.get(p.blocker)?.has(p.blocked)) continue;
                const cycle = findDependencyCycle(p.blocker, p.blocked, (id) => [...(out.get(id) ?? [])]);
                if (cycle) {
                    problems.push(`${t(p.blocked)} ya bloquea (directa o indirectamente) a ${t(p.blocker)}: agregarla cerraría un círculo.`);
                    continue;
                }
                (out.get(p.blocker) ?? out.set(p.blocker, new Set()).get(p.blocker)!).add(p.blocked);
            }
            return { listId: list.id, problems, titles, existing };
        });
    }

    /** Una entrada de actividad en CADA punta, contada desde su lado. */
    private async logPair(
        tx: Tx,
        tenantId: number,
        listId: number,
        actor: Actor,
        action: 'dependency_added' | 'dependency_removed',
        blockerId: number,
        blockedId: number,
        titles: Map<number, string>,
    ): Promise<void> {
        const userId = actor.userId > 0 ? actor.userId : null;
        const entry = (recordId: number, kind: DependencyKind, otherId: number) =>
            this.activity.logInTx(tx, {
                tenantId,
                listId,
                recordId,
                userId,
                action,
                diff: { dependency: { kind, record_id: otherId, title: titles.get(otherId) ?? `Registro #${otherId}` } },
            });
        await entry(blockedId, 'blocked_by', blockerId);
        await entry(blockerId, 'blocks', blockedId);
    }
}

function recordNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'record_not_found', message: `Registro ${id} no encontrado`, data: { status: 404 } });
}

function dependencyNotFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'dependency_not_found', message: id > 0 ? `Dependencia ${id} no encontrada` : 'Esa dependencia no existe', data: { status: 404 } });
}

function cannotEdit(): ForbiddenException {
    return new ForbiddenException({
        code: 'forbidden',
        message: 'No tienes permiso para cambiar las dependencias de ese registro.',
        data: { status: 403 },
    });
}
