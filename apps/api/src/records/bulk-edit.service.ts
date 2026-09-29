import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
    BULK_EDIT_APPLY_CHUNK,
    BULK_EDIT_MAX_TARGET,
    applyBulkOperations,
    bulkOpsFor,
    isThroughField,
    readStoreListMarker,
    resolveTitleFieldId,
    roleHasCapability,
    storeCellAccess,
    storeValueError,
    type BulkEditPreview,
    type BulkEditResult,
    type BulkEditTarget,
    type BulkField,
    type BulkOperation,
    type BulkRowResult,
    type Field,
    type List,
} from '@imagina-base/shared';
import { hiddenFieldsFor } from '../lists/list-acl';
import { RealtimeService } from '../realtime/realtime.service';
import { RecordsService, type Actor } from './records.service';

/** Cuántos ejemplos muestra la vista previa y cuántos errores lista. */
const SAMPLE_SIZE = 25;
const ERROR_LIST = 50;

/**
 * Edición masiva (v0.1.216). La vista previa y la escritura calculan con la
 * MISMA función (`applyBulkOperations`, shared) sobre los valores ACTUALES de
 * cada fila; escribir pasa por `RecordsService.update`, así que una edición
 * masiva es exactamente N ediciones a mano: validación, permisos por fila,
 * bitácora, automatizaciones y —en una lista de tienda— reglas de lo que la
 * tienda acepta y el envío a WooCommerce.
 *
 * El cliente pide la vista previa (que resuelve TODOS los registros
 * abarcados, hasta 5.000) y aplica en tandas de 200 los ids que devuelve:
 * cada pedido es corto, hay barra de avance, y lo que se escribe es lo que
 * se previsualizó (una fila que entró al filtro después no se cuela).
 */
@Injectable()
export class BulkEditService {
    constructor(
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
    ) {}

    async preview(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        target: BulkEditTarget,
        operations: BulkOperation[],
    ): Promise<BulkEditPreview> {
        // Editar TODO lo que coincide con un filtro es la acción masiva de
        // verdad: exige `bulk_actions` (un agente edita su selección, no la lista).
        if (!('ids' in target) && !roleHasCapability(actor.role, 'bulk_actions')) {
            throw new ForbiddenException({
                code: 'forbidden_bulk',
                message: 'Tu rol no puede editar en lote todos los registros de un filtro: seleccioná las filas.',
                data: { status: 403 },
            });
        }
        const loaded = await this.records.bulkRows(tenantId, actor, listIdOrSlug, target, BULK_EDIT_MAX_TARGET);
        const ctx = this.context(loaded.list, loaded.fields, actor, operations);
        const out: BulkEditPreview = { total: loaded.total, ids: [], unchanged: 0, error_count: 0, errors: [], sample: [] };
        for (const row of loaded.rows) {
            const res = this.compute(ctx, row);
            if (res.errors.length > 0) {
                out.error_count++;
                if (out.errors.length < ERROR_LIST) {
                    out.errors.push({ id: row.id, title: ctx.title(row.data, row.id), message: res.errors.map((e) => e.message).join(' · ') });
                }
                continue;
            }
            if (res.changes.length === 0) {
                out.unchanged++;
                continue;
            }
            out.ids.push(row.id);
            if (out.sample.length < SAMPLE_SIZE) out.sample.push({ id: row.id, title: ctx.title(row.data, row.id), changes: res.changes });
        }
        return out;
    }

    async apply(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        ids: number[],
        operations: BulkOperation[],
    ): Promise<BulkEditResult> {
        const loaded = await this.records.bulkRows(tenantId, actor, listIdOrSlug, { ids }, BULK_EDIT_APPLY_CHUNK);
        const ctx = this.context(loaded.list, loaded.fields, actor, operations);
        const result: BulkEditResult = { succeeded: [], unchanged: [], failed: [] };
        const found = new Set(loaded.rows.map((r) => r.id));
        // Lo que no se encontró (borrado entre la vista previa y ahora, o fuera
        // del alcance de edición de la persona) se informa, no se calla.
        for (const id of ids) if (!found.has(id)) result.failed.push({ id, message: 'El registro ya no existe o no lo podés editar.' });
        for (const row of loaded.rows) {
            const res = this.compute(ctx, row);
            if (res.errors.length > 0) {
                result.failed.push({ id: row.id, message: res.errors.map((e) => e.message).join(' · ') });
                continue;
            }
            if (Object.keys(res.patch).length === 0) {
                result.unchanged.push(row.id);
                continue;
            }
            try {
                await this.records.update(tenantId, actor, String(loaded.list.id), row.id, { data: res.patch }, { silent: true });
                result.succeeded.push(row.id);
            } catch (err) {
                result.failed.push({ id: row.id, message: explain(err) });
            }
        }
        // Un solo aviso de realtime por tanda (no uno por fila).
        if (result.succeeded.length > 0) this.realtime.records(tenantId, loaded.list.id);
        return result;
    }

    // ── Detalles ─────────────────────────────────────────────────────────────

    private context(list: List, fields: Field[], actor: Actor, operations: BulkOperation[]) {
        const hidden = hiddenFieldsFor(list.settings, actor.role, actor.userId);
        const byId = new Map(fields.map((f) => [f.id, f]));
        // Las columnas que la operación ESCRIBE y las que LEE (operandos, origen de una copia).
        for (const op of operations) {
            const field = byId.get(op.field_id);
            if (!field) throw badOp('Una de las columnas ya no existe en esta lista.');
            if (hidden.has(field.slug)) throw badOp(`No podés editar «${field.label}».`);
            if (field.type === 'computed' || isThroughField(field.type)) {
                throw badOp(`«${field.label}» se calcula sola: no se edita.`);
            }
            if (!bulkOpsFor(field.type).includes(op.op)) throw badOp(`«${field.label}» no admite esa operación.`);
            for (const readId of readsOf(op)) {
                const src = byId.get(readId);
                if (!src || hidden.has(src.slug)) throw badOp('Una de las columnas del cálculo no existe o no la podés ver.');
            }
        }
        const bulkFields = new Map<number, BulkField>(
            fields.map((f) => [f.id, { id: f.id, label: f.label, type: f.type, config: f.config, is_required: f.is_required }]),
        );
        const titleId = resolveTitleFieldId(fields, list.settings);
        const marker = readStoreListMarker(list.settings);
        return {
            operations,
            bulkFields,
            marker,
            title: (data: Record<string, unknown>, id: number): string => {
                const v = titleId ? data[`f${titleId}`] : null;
                return typeof v === 'string' && v.trim() !== '' ? v.slice(0, 120) : `Registro #${id}`;
            },
        };
    }

    private compute(
        ctx: ReturnType<BulkEditService['context']>,
        row: { id: number; data: Record<string, unknown>; relations: Record<number, number[]> },
    ): BulkRowResult {
        const res = applyBulkOperations(ctx.operations, ctx.bulkFields, row);
        if (res.errors.length > 0 || !ctx.marker || res.changes.length === 0) return res;
        // Lista de una tienda: las MISMAS reglas que una edición a mano
        // (la vista previa avisa por fila en vez de fallar al aplicar).
        const merged = { ...row.data, ...res.patch };
        const marker = ctx.marker;
        const get = (slug: string): unknown => {
            const id = marker.fields[slug];
            return id ? merged[`f${id}`] : undefined;
        };
        for (const change of res.changes) {
            const label = ctx.bulkFields.get(change.field_id)?.label ?? 'Esa columna';
            const access = storeCellAccess(marker, change.field_id, get);
            if (access.access === 'locked') {
                return { patch: {}, changes: [], errors: [{ field_id: change.field_id, message: `${label}: ${access.reason}` }] };
            }
            if (access.access === 'editable') {
                const err = storeValueError(marker, change.field_id, change.after, get);
                if (err) return { patch: {}, changes: [], errors: [{ field_id: change.field_id, message: `${label}: ${err}` }] };
            }
        }
        return res;
    }
}

function readsOf(op: BulkOperation): number[] {
    if (op.op === 'copy') return [op.source_field_id];
    if (op.op === 'calc') {
        return [op.left, op.right].flatMap((o) => ('field_id' in o ? [o.field_id] : []));
    }
    return [];
}

function badOp(message: string): BadRequestException {
    return new BadRequestException({ code: 'bulk_invalid_operation', message, data: { status: 400 } });
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
