import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
    BULK_STRUCTURE_CHUNK,
    BULK_STRUCTURE_MAX_TARGET,
    readStoreListMarker,
    resolveTitleFieldId,
    roleHasCapability,
    type BulkEditTarget,
    type BulkRevertPreview,
    type BulkRevertResult,
    type BulkStructureAction,
    type BulkStructurePreview,
    type BulkStructureResult,
    type Field,
    type List,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { records } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BulkHistoryService, type BulkEditHeader, type BulkItemInput, type BulkItemRow } from './bulk-history.service';
import { RecordsService, type Actor } from './records.service';

const SAMPLE_SIZE = 20;
const ERROR_LIST = 50;

/** Tipos que se copian al duplicar (ni calculados, ni vínculos, ni archivos). */
const NOT_COPIED = new Set(['computed', 'lookup', 'rollup', 'relation', 'file']);

type Row = Awaited<ReturnType<RecordsService['bulkRows']>>['rows'][number];

/**
 * Acciones masivas de ESTRUCTURA (v0.1.220): mover como subtareas, duplicar y
 * borrar — sobre la selección o todo lo que coincide con la vista. Mismo
 * patrón que la edición masiva: vista previa sobre todo lo abarcado, tandas
 * de 200 con avance, y cada tanda deja en el historial lo necesario para
 * DESHACERLA:
 *
 *  - mover → el padre anterior de cada registro;
 *  - borrar → las subtareas que se fueron con él y sus vínculos salientes
 *    (el borrado es suave: deshacer lo trae de vuelta entero);
 *  - duplicar → las copias creadas (deshacer las borra, salvo que alguien
 *    las haya editado después).
 */
@Injectable()
export class BulkStructureService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly records: RecordsService,
        private readonly history: BulkHistoryService,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
    ) {
        this.history.registerReverter('move', {
            preview: (t, a, e, i) => this.revertMovePreview(t, a, e, i),
            apply: (t, a, e, i, f) => this.revertMoveApply(t, a, e, i, f),
        });
        this.history.registerReverter('delete', {
            preview: (t, a, e, i) => this.revertDeletePreview(t, a, e, i),
            apply: (t, a, e, i, f) => this.revertDeleteApply(t, a, e, i, f),
        });
        this.history.registerReverter('duplicate', {
            preview: (t, a, e, i) => this.revertDuplicatePreview(t, a, e, i),
            apply: (t, a, e, i, f) => this.revertDuplicateApply(t, a, e, i, f),
        });
    }

    // ── Vista previa ────────────────────────────────────────────────────────

    async preview(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        action: BulkStructureAction,
        target: BulkEditTarget,
        parentId: number | null | undefined,
        includeSubtasks: boolean,
    ): Promise<BulkStructurePreview> {
        this.assertCan(actor, action, !('ids' in target));
        const loaded = await this.records.bulkRows(tenantId, actor, listIdOrSlug, target, BULK_STRUCTURE_MAX_TARGET, action === 'delete' ? 'delete' : 'edit');
        assertNotStore(loaded.list);
        const title = this.titleFn(loaded.list, loaded.fields);
        const out: BulkStructurePreview = { total: loaded.total, ids: [], unchanged: 0, error_count: 0, errors: [], sample: [], subtasks: 0, parent_title: null };
        const kids = await this.childCounts(tenantId, loaded.rows.map((r) => r.id));

        if (action === 'move') {
            const parent = await this.resolveParent(tenantId, actor, loaded.list, parentId ?? null);
            out.parent_title = parent ? title(parent.data, parent.id) : null;
            for (const row of loaded.rows) {
                const err = moveError(row, parent?.id ?? null, kids.get(row.id) ?? 0);
                if (err) {
                    out.error_count++;
                    if (out.errors.length < ERROR_LIST) out.errors.push({ id: row.id, title: title(row.data, row.id), message: err });
                    continue;
                }
                if ((row.parentId ?? null) === (parent?.id ?? null)) {
                    out.unchanged++;
                    continue;
                }
                out.ids.push(row.id);
                if (out.sample.length < SAMPLE_SIZE) out.sample.push({ id: row.id, title: title(row.data, row.id) });
            }
            return out;
        }
        const targeted = new Set(loaded.rows.map((r) => r.id));
        const carried = action === 'delete' || includeSubtasks;
        for (const row of loaded.rows) {
            // Una subtarea cuyo padre también está en la tanda se va (o se
            // copia) CON él: tocarla aparte la borraría dos veces o la
            // duplicaría dos veces.
            if (carried && row.parentId !== null && targeted.has(row.parentId)) continue;
            out.ids.push(row.id);
            if (out.sample.length < SAMPLE_SIZE) out.sample.push({ id: row.id, title: title(row.data, row.id) });
            if (carried) out.subtasks += kids.get(row.id) ?? 0;
        }
        return out;
    }

    // ── Aplicar (una tanda) ─────────────────────────────────────────────────

    async apply(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        action: BulkStructureAction,
        ids: number[],
        parentId: number | null | undefined,
        includeSubtasks: boolean,
        editId?: number,
    ): Promise<BulkStructureResult> {
        this.assertCan(actor, action, false);
        const loaded = await this.records.bulkRows(tenantId, actor, listIdOrSlug, { ids }, BULK_STRUCTURE_CHUNK, action === 'delete' ? 'delete' : 'edit');
        assertNotStore(loaded.list);
        const list = loaded.list;
        const title = this.titleFn(list, loaded.fields);
        const result: BulkStructureResult = { succeeded: [], unchanged: [], failed: [], created: 0, edit_id: editId ?? null };
        const found = new Set(loaded.rows.map((r) => r.id));
        for (const id of ids) if (!found.has(id)) result.failed.push({ id, message: 'El registro ya no existe o no lo podés tocar.' });

        const parent = action === 'move' ? await this.resolveParent(tenantId, actor, list, parentId ?? null) : null;
        const summary =
            action === 'move'
                ? parent
                    ? `Mover como subtareas de «${title(parent.data, parent.id)}»`
                    : 'Sacar al primer nivel'
                : action === 'delete'
                  ? 'Eliminar registros'
                  : includeSubtasks
                    ? 'Duplicar registros (con sus subtareas)'
                    : 'Duplicar registros';
        result.edit_id = await this.history.openEdit(tenantId, actor.userId, list.id, action, editId, summary, [
            { op: action, parent_id: parent?.id ?? null, include_subtasks: includeSubtasks },
        ]);
        const items: BulkItemInput[] = [];
        const kids = await this.childCounts(tenantId, loaded.rows.map((r) => r.id));
        if (action === 'delete' || (action === 'duplicate' && includeSubtasks)) {
            const inChunk = new Set(loaded.rows.map((r) => r.id));
            const own = loaded.rows.filter((r) => !(r.parentId !== null && inChunk.has(r.parentId)));
            for (const r of loaded.rows) if (!own.includes(r)) result.unchanged.push(r.id);
            loaded.rows = own;
        }

        if (action === 'duplicate') {
            const children = includeSubtasks ? await this.childRows(tenantId, actor, list, loaded.rows.map((r) => r.id)) : new Map<number, Row[]>();
            const total = loaded.rows.length + [...children.values()].reduce((n, c) => n + c.length, 0);
            // Límite del plan sobre la tanda completa (SEC-09): o entra entera o nada.
            await this.billing.assertCanCreateRecords(tenantId, total);
            for (const row of loaded.rows) {
                try {
                    const copy = await this.records.create(tenantId, actor, String(list.id), {
                        data: copyData(loaded.fields, row.data),
                        parent_id: row.parentId ?? null,
                    });
                    result.created++;
                    for (const child of children.get(row.id) ?? []) {
                        await this.records.create(tenantId, actor, String(list.id), { data: copyData(loaded.fields, child.data), parent_id: copy.id });
                        result.created++;
                    }
                    result.succeeded.push(row.id);
                    items.push({ recordId: copy.id, title: title(row.data, row.id), before: { __created: false }, after: { __created: true, updated_at: copy.updated_at } });
                } catch (err) {
                    result.failed.push({ id: row.id, message: explain(err) });
                }
            }
        } else if (action === 'move') {
            for (const row of loaded.rows) {
                const err = moveError(row, parent?.id ?? null, kids.get(row.id) ?? 0);
                if (err) {
                    result.failed.push({ id: row.id, message: err });
                    continue;
                }
                if ((row.parentId ?? null) === (parent?.id ?? null)) {
                    result.unchanged.push(row.id);
                    continue;
                }
                try {
                    await this.records.setParent(tenantId, actor, String(list.id), row.id, parent?.id ?? null, { silent: true });
                    result.succeeded.push(row.id);
                    items.push({ recordId: row.id, title: title(row.data, row.id), before: { __parent: row.parentId ?? null }, after: { __parent: parent?.id ?? null } });
                } catch (err) {
                    result.failed.push({ id: row.id, message: explain(err) });
                }
            }
        } else {
            const children = await this.aliveChildIds(tenantId, loaded.rows.map((r) => r.id));
            for (const row of loaded.rows) {
                const relations: Record<string, number[]> = {};
                for (const [fid, targets] of Object.entries(row.relations)) if (targets.length > 0) relations[`f${fid}`] = targets;
                try {
                    await this.records.remove(tenantId, actor, String(list.id), row.id, { silent: true });
                    result.succeeded.push(row.id);
                    items.push({
                        recordId: row.id,
                        title: title(row.data, row.id),
                        before: { __deleted: { children: children.get(row.id) ?? [], relations } },
                        after: { __deleted: true },
                    });
                } catch (err) {
                    result.failed.push({ id: row.id, message: explain(err) });
                }
            }
        }
        await this.history.addItems(tenantId, result.edit_id, items);
        if (result.succeeded.length > 0) this.realtime.records(tenantId, list.id);
        return result;
    }

    // ── Deshacer: mover ─────────────────────────────────────────────────────

    private async revertMovePreview(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const rows = await this.rowsById(tenantId, actor, edit.listId, items, 'edit');
        const out = emptyPreview(edit, items);
        for (const item of items) {
            const row = item.recordId ? rows.get(item.recordId) : undefined;
            if (!row) {
                out.missing++;
                continue;
            }
            if ((row.parentId ?? null) !== (item.after.__parent ?? null)) {
                out.conflict_ids.push(item.id);
                if (out.conflicts.length < ERROR_LIST) out.conflicts.push({ item_id: item.id, title: item.title, message: 'Se movió de nuevo después.' });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < 15) {
                out.sample.push({
                    item_id: item.id,
                    title: item.title,
                    changes: [{ label: 'Subtarea de', before: parentLabel(item.after.__parent), after: parentLabel(item.before.__parent) }],
                });
            }
        }
        return out;
    }

    private async revertMoveApply(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[], force: boolean): Promise<BulkRevertResult> {
        const rows = await this.rowsById(tenantId, actor, edit.listId, items, 'edit');
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const done: number[] = [];
        for (const item of items) {
            const row = item.recordId ? rows.get(item.recordId) : undefined;
            if (!row) {
                result.failed.push({ item_id: item.id, title: item.title, message: 'El registro ya no existe.' });
                continue;
            }
            if (!force && (row.parentId ?? null) !== (item.after.__parent ?? null)) {
                result.conflicts++;
                continue;
            }
            try {
                await this.records.setParent(tenantId, actor, String(edit.listId), row.id, (item.before.__parent as number | null) ?? null, { silent: true });
                done.push(item.id);
            } catch (err) {
                result.failed.push({ item_id: item.id, title: item.title, message: explain(err) });
            }
        }
        return this.finish(tenantId, actor, edit, done, result);
    }

    // ── Deshacer: borrar ────────────────────────────────────────────────────

    private async revertDeletePreview(tenantId: number, _actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const state = await this.deletedState(tenantId, edit.listId, items);
        const out = emptyPreview(edit, items);
        for (const item of items) {
            const s = item.recordId ? state.get(item.recordId) : undefined;
            if (!s) {
                out.missing++;
                continue;
            }
            if (s === 'alive') {
                out.conflict_ids.push(item.id);
                if (out.conflicts.length < ERROR_LIST) out.conflicts.push({ item_id: item.id, title: item.title, message: 'Ya se recuperó.' });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < 15) out.sample.push({ item_id: item.id, title: item.title, changes: [{ label: 'Estado', before: 'Eliminado', after: 'Vuelve a la lista' }] });
        }
        return out;
    }

    private async revertDeleteApply(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[], _force: boolean): Promise<BulkRevertResult> {
        const state = await this.deletedState(tenantId, edit.listId, items);
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const done: number[] = [];
        for (const item of items) {
            const s = item.recordId ? state.get(item.recordId) : undefined;
            if (!s) {
                result.failed.push({ item_id: item.id, title: item.title, message: 'El registro ya no existe.' });
                continue;
            }
            if (s === 'alive') {
                result.conflicts++;
                continue;
            }
            const snap = (item.before.__deleted ?? {}) as { children?: number[]; relations?: Record<string, number[]> };
            try {
                await this.records.restoreDeleted(tenantId, actor, String(edit.listId), item.recordId!, {
                    children: Array.isArray(snap.children) ? snap.children : [],
                    relations: snap.relations ?? {},
                }, { silent: true });
                done.push(item.id);
            } catch (err) {
                result.failed.push({ item_id: item.id, title: item.title, message: explain(err) });
            }
        }
        return this.finish(tenantId, actor, edit, done, result);
    }

    // ── Deshacer: duplicar ──────────────────────────────────────────────────

    private async revertDuplicatePreview(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const rows = await this.rowsById(tenantId, actor, edit.listId, items, 'delete');
        const out = emptyPreview(edit, items);
        for (const item of items) {
            const row = item.recordId ? rows.get(item.recordId) : undefined;
            if (!row) {
                out.missing++;
                continue;
            }
            if (!sameInstant(row.updatedAt, item.after.updated_at)) {
                out.conflict_ids.push(item.id);
                if (out.conflicts.length < ERROR_LIST) out.conflicts.push({ item_id: item.id, title: item.title, message: 'La copia se editó después.' });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < 15) out.sample.push({ item_id: item.id, title: item.title, changes: [{ label: 'Copia', before: 'Creada', after: 'Se elimina' }] });
        }
        return out;
    }

    private async revertDuplicateApply(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[], force: boolean): Promise<BulkRevertResult> {
        const rows = await this.rowsById(tenantId, actor, edit.listId, items, 'delete');
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const done: number[] = [];
        for (const item of items) {
            const row = item.recordId ? rows.get(item.recordId) : undefined;
            if (!row) {
                result.failed.push({ item_id: item.id, title: item.title, message: 'La copia ya no existe.' });
                continue;
            }
            if (!force && !sameInstant(row.updatedAt, item.after.updated_at)) {
                result.conflicts++;
                continue;
            }
            try {
                await this.records.remove(tenantId, actor, String(edit.listId), row.id, { silent: true });
                done.push(item.id);
            } catch (err) {
                result.failed.push({ item_id: item.id, title: item.title, message: explain(err) });
            }
        }
        return this.finish(tenantId, actor, edit, done, result);
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    private async finish(tenantId: number, actor: Actor, edit: BulkEditHeader, done: number[], result: BulkRevertResult): Promise<BulkRevertResult> {
        result.reverted = done.length;
        await this.history.markReverted(tenantId, actor, edit.id, done);
        if (done.length > 0) this.realtime.records(tenantId, edit.listId);
        return result;
    }

    private assertCan(actor: Actor, action: BulkStructureAction, byFilter: boolean): void {
        const role = actor.role;
        const can =
            action === 'duplicate'
                ? roleHasCapability(role, 'create_records')
                : action === 'delete'
                  ? roleHasCapability(role, 'delete_records') || roleHasCapability(role, 'delete_own_records')
                  : roleHasCapability(role, 'edit_records') || roleHasCapability(role, 'edit_own_records');
        if (!can) {
            throw new ForbiddenException({ code: 'forbidden', message: 'Tu rol no puede hacer esto.', data: { status: 403 } });
        }
        if (byFilter && !roleHasCapability(role, 'bulk_actions')) {
            throw new ForbiddenException({
                code: 'forbidden_bulk',
                message: 'Tu rol no puede actuar sobre todos los registros de un filtro: seleccioná las filas.',
                data: { status: 403 },
            });
        }
    }

    private titleFn(list: List, fields: Field[]) {
        const titleId = resolveTitleFieldId(fields, list.settings);
        return (data: Record<string, unknown>, id: number): string => {
            const v = titleId ? data[`f${titleId}`] : null;
            return typeof v === 'string' && v.trim() !== '' ? v.slice(0, 120) : `Registro #${id}`;
        };
    }

    private async resolveParent(tenantId: number, actor: Actor, list: List, parentId: number | null) {
        if (parentId === null) return null;
        const loaded = await this.records.bulkRows(tenantId, actor, String(list.id), { ids: [parentId] }, 1);
        const parent = loaded.rows[0];
        if (!parent) throw bad('El registro elegido como padre no existe o no lo podés editar.');
        if (parent.parentId !== null) throw bad('El padre tiene que ser un registro de primer nivel: una subtarea no puede tener subtareas.');
        return parent;
    }

    private async childCounts(tenantId: number, ids: number[]): Promise<Map<number, number>> {
        const out = new Map<number, number>();
        if (ids.length === 0) return out;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ parent: records.parentId, n: sql<number>`count(*)::int` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), inArray(records.parentId, ids), isNull(records.deletedAt)))
                .groupBy(records.parentId),
        );
        for (const r of rows) if (r.parent !== null) out.set(r.parent, r.n);
        return out;
    }

    private async aliveChildIds(tenantId: number, ids: number[]): Promise<Map<number, number[]>> {
        const out = new Map<number, number[]>();
        if (ids.length === 0) return out;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id, parent: records.parentId })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), inArray(records.parentId, ids), isNull(records.deletedAt))),
        );
        for (const r of rows) if (r.parent !== null) out.set(r.parent, [...(out.get(r.parent) ?? []), r.id]);
        return out;
    }

    private async childRows(tenantId: number, actor: Actor, list: List, ids: number[]): Promise<Map<number, Row[]>> {
        const childIds = [...(await this.aliveChildIds(tenantId, ids)).values()].flat();
        const out = new Map<number, Row[]>();
        if (childIds.length === 0) return out;
        const loaded = await this.records.bulkRows(tenantId, actor, String(list.id), { ids: childIds }, childIds.length);
        for (const r of loaded.rows) if (r.parentId !== null) out.set(r.parentId, [...(out.get(r.parentId) ?? []), r]);
        return out;
    }

    private async rowsById(tenantId: number, actor: Actor, listId: number, items: BulkItemRow[], scope: 'edit' | 'delete'): Promise<Map<number, Row>> {
        const ids = [...new Set(items.map((i) => i.recordId).filter((n): n is number => typeof n === 'number'))];
        if (ids.length === 0) return new Map();
        const loaded = await this.records.bulkRows(tenantId, actor, String(listId), { ids }, ids.length, scope);
        return new Map(loaded.rows.map((r) => [r.id, r]));
    }

    /** Por id: 'deleted' (sigue borrado), 'alive' (ya se recuperó) o ausente (no existe). */
    private async deletedState(tenantId: number, listId: number, items: BulkItemRow[]): Promise<Map<number, 'deleted' | 'alive'>> {
        const ids = [...new Set(items.map((i) => i.recordId).filter((n): n is number => typeof n === 'number'))];
        const out = new Map<number, 'deleted' | 'alive'>();
        if (ids.length === 0) return out;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: records.id, deleted: sql<boolean>`${records.deletedAt} IS NOT NULL` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), inArray(records.id, ids))),
        );
        for (const r of rows) out.set(r.id, r.deleted ? 'deleted' : 'alive');
        return out;
    }
}

function moveError(row: Row, parentId: number | null, childCount: number): string | null {
    if (parentId === null) return null;
    if (row.id === parentId) return 'No puede ser subtarea de sí mismo.';
    if (childCount > 0) return 'Tiene subtareas propias: una subtarea no puede tener subtareas.';
    return null;
}

function copyData(fields: Field[], data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
        if (NOT_COPIED.has(f.type)) continue;
        const v = data[`f${f.id}`];
        if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) out[`f${f.id}`] = v;
    }
    return out;
}

function assertNotStore(list: List): void {
    if (readStoreListMarker(list.settings)) {
        throw new ForbiddenException({
            code: 'store_managed',
            message: 'Esta lista viene de la tienda: los registros se crean, se borran y se ordenan en WooCommerce.',
            data: { status: 403 },
        });
    }
}

function emptyPreview(edit: BulkEditHeader, items: BulkItemRow[]): BulkRevertPreview {
    return { edit_id: edit.id, total: items.length, item_ids: [], conflict_ids: [], conflicts: [], missing: 0, sample: [] };
}

function parentLabel(v: unknown): string {
    return typeof v === 'number' ? `#${v}` : 'Primer nivel';
}

function sameInstant(a: string, b: unknown): boolean {
    if (typeof b !== 'string') return false;
    return new Date(a).getTime() === new Date(b.endsWith('Z') || b.includes('+') ? b : `${b.replace(' ', 'T')}Z`).getTime();
}

function bad(message: string): BadRequestException {
    return new BadRequestException({ code: 'bulk_structure_invalid', message, data: { status: 400 } });
}

function explain(err: unknown): string {
    if (err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: unknown }).getResponse === 'function') {
        const body = (err as { getResponse: () => unknown }).getResponse();
        if (body && typeof body === 'object') {
            const b = body as { message?: unknown; data?: { errors?: Record<string, unknown> } };
            const detail = b.data?.errors ? Object.values(b.data.errors).map(String).join(' · ') : '';
            if (typeof b.message === 'string') return detail ? `${b.message}: ${detail}` : b.message;
        }
    }
    return err instanceof Error ? err.message : 'Error';
}
