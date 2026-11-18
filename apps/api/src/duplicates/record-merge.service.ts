import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import {
    MERGE_CHOICE_UNION,
    isMergeableFieldType,
    managedFieldLocks,
    mergeCanUnion,
    mergeResolveValue,
    mergeSuggestedChoice,
    mergeValuesDiffer,
    mirrorSourceName,
    readMirrorListMarker,
    resolveTitleFieldId,
    type BulkRevertPreview,
    type BulkRevertResult,
    type Field,
    type List,
    type MergeFieldPreview,
    type MergeMoveSummary,
    type MergePreview,
    type MergeRecordsInput,
    type MergeResult,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { Tx } from '../db/client';
import { records } from '../db/schema';
import { listRowInScope } from '../lists/list-acl';
import { BulkHistoryService, type BulkEditHeader, type BulkItemRow } from '../records/bulk-history.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { MOVE_STEPS, SPECIAL_MOVES, countMoves, dependencyGraph, mergeBlockers, moveRows, moveRowsBack, type MovedRows } from './merge-plan';

interface Analysis {
    list: List;
    fields: Field[];
    /** Campos que se pueden elegir (visibles, escribibles, sin candado). */
    mergeFields: Field[];
    ids: number[];
    rows: Map<number, { id: number; data: Record<string, unknown>; hasDescription: boolean }>;
    titles: Map<number, string>;
    preview: MergePreview;
}

const MOVE_LABELS = new Map<string, string>([
    ...MOVE_STEPS.filter((s) => !s.hidden).map((s): [string, string] => [s.key, s.label]),
    ...SPECIAL_MOVES.map((s): [string, string] => [s.key, s.label]),
]);

/**
 * A14 (v0.1.445, ADR-S106) — FUSIONAR registros duplicados.
 *
 * El que queda toma los valores elegidos campo por campo (o juntos, en
 * varias opciones y archivos) y todo lo que colgaba de los otros
 * (comentarios, vínculos, archivos del historial, tiempo, cobros… ver
 * merge-plan.ts). Los otros van a la papelera (se restauran 30 días) y la
 * fusión queda en el historial de ediciones masivas: «Deshacer» devuelve lo
 * movido, los saca de la papelera y vuelve los valores del que quedó.
 */
@Injectable()
export class RecordMergeService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly records: RecordsService,
        private readonly history: BulkHistoryService,
        private readonly audit: AuditService,
    ) {
        this.history.registerReverter('merge', {
            preview: (t, a, e, i) => this.revertPreview(t, a, e, i),
            apply: (t, a, e, i, f) => this.revertApply(t, a, e, i, f),
        });
    }

    async preview(tenantId: number, actor: Actor, listIdOrSlug: string, primaryId: number, dupIds: number[]): Promise<MergePreview> {
        return (await this.analyze(tenantId, actor, listIdOrSlug, primaryId, dupIds)).preview;
    }

    async merge(tenantId: number, actor: Actor, listIdOrSlug: string, input: MergeRecordsInput): Promise<MergeResult> {
        const dupIds = [...new Set(input.duplicate_ids)].filter((id) => id !== input.primary_id);
        const a = await this.analyze(tenantId, actor, listIdOrSlug, input.primary_id, dupIds);
        if (a.preview.blockers.length > 0) {
            throw new ConflictException({ code: 'merge_blocked', message: a.preview.blockers[0], data: { status: 409, blockers: a.preview.blockers } });
        }
        const primary = a.rows.get(input.primary_id)!;
        // Valores del que queda (sólo lo que cambia).
        const patch: Record<string, unknown> = {};
        const before: Record<string, unknown> = {};
        for (const f of a.mergeFields) {
            const key = `f${f.id}`;
            const values = a.ids.map((id) => a.rows.get(id)?.data[key] ?? null);
            const raw = input.choices?.[String(f.id)];
            const choice = raw === MERGE_CHOICE_UNION ? MERGE_CHOICE_UNION : typeof raw === 'number' && a.ids.includes(raw) ? raw : mergeSuggestedChoice(f.type, f.config as Record<string, unknown>, a.ids, values);
            const next = mergeResolveValue(f.type, f.config as Record<string, unknown>, a.ids, values, choice);
            if (JSON.stringify(next ?? null) !== JSON.stringify(primary.data[key] ?? null)) {
                patch[key] = next;
                before[key] = primary.data[key] ?? null;
            }
        }
        // Descripción: la elegida, o la del que queda; si no tiene, la primera que haya.
        const descFrom =
            input.description_from && a.ids.includes(input.description_from)
                ? input.description_from
                : primary.hasDescription
                  ? input.primary_id
                  : (a.ids.find((id) => a.rows.get(id)?.hasDescription) ?? input.primary_id);

        // 1) Mover lo de los otros y mandarlos a la papelera (una transacción).
        let prevDescription: unknown = undefined;
        const moved = await this.records.absorbMerged(
            tenantId,
            actor,
            String(a.list.id),
            input.primary_id,
            dupIds,
            async (tx) => {
                const graph = await dependencyGraph(tx, tenantId, a.ids);
                const out = new Map<number, MovedRows>();
                for (const dup of dupIds) out.set(dup, await moveRows(tx, tenantId, input.primary_id, dup, graph));
                if (descFrom !== input.primary_id) prevDescription = await copyDescription(tx, tenantId, input.primary_id, descFrom);
                return out;
            },
            a.titles,
        );

        // 2) Los valores elegidos en el que queda. Va DESPUÉS: con los otros ya
        // en la papelera, un campo «Sin repetidos» no choca consigo mismo. Si
        // falla (una regla de validación nueva), se deshace el paso 1.
        if (Object.keys(patch).length > 0) {
            try {
                await this.records.update(tenantId, actor, String(a.list.id), input.primary_id, { data: patch }, { expect: before });
            } catch (err) {
                await this.records.unabsorbMerged(tenantId, actor, a.list.id, input.primary_id, dupIds, async (tx, back) => {
                    for (const dup of back) await moveRowsBack(tx, tenantId, input.primary_id, dup, moved.get(dup)!);
                    if (prevDescription !== undefined) await restoreDescription(tx, tenantId, input.primary_id, prevDescription, null);
                });
                throw err;
            }
        }

        // 3) Historial (para «Deshacer») y bitácora.
        const totals = new Map<string, number>();
        let skippedCycles = 0;
        for (const m of moved.values()) {
            for (const [k, ids] of Object.entries(m.steps)) totals.set(k, (totals.get(k) ?? 0) + ids.length);
            if (m.follows.length > 0) totals.set('follows', (totals.get('follows') ?? 0) + m.follows.length);
            if (m.dependencies.length > 0) totals.set('dependencies', (totals.get('dependencies') ?? 0) + m.dependencies.length);
            skippedCycles += m.skipped_cycles;
        }
        const movedSummary: MergeMoveSummary[] = [...totals.entries()]
            .filter(([k]) => MOVE_LABELS.has(k))
            .map(([key, count]) => ({ key, label: MOVE_LABELS.get(key)!, count }));
        const primaryTitle = a.titles.get(input.primary_id) ?? `#${input.primary_id}`;
        let editId: number | null = null;
        try {
            editId = await this.history.openEdit(tenantId, actor.userId, a.list.id, 'merge', undefined, `Fusionó ${dupIds.length + 1} registros en «${primaryTitle}»`, []);
            await this.history.addItems(tenantId, editId, [
                {
                    recordId: input.primary_id,
                    title: primaryTitle,
                    before: { ...before, ...(prevDescription !== undefined ? { __description: prevDescription } : {}) },
                    after: { ...patch, ...(prevDescription !== undefined ? { __description_from: descFrom } : {}), __dups: dupIds },
                },
                ...dupIds.map((dup) => ({
                    recordId: dup,
                    title: a.titles.get(dup) ?? `#${dup}`,
                    before: {},
                    after: { __into: input.primary_id, __moved: moved.get(dup) as unknown as Record<string, unknown> },
                })),
            ]);
        } catch {
            editId = null; // el historial no es crítico: la fusión ya está hecha.
        }
        await this.audit.log({
            tenantId,
            userId: actor.userId,
            action: 'records.merge',
            targetType: 'list',
            targetId: a.list.id,
            targetLabel: a.list.name,
            meta: { primary_id: input.primary_id, merged_ids: dupIds },
        });
        const warnings = [...a.preview.warnings];
        if (skippedCycles > 0) warnings.push(`${skippedCycles === 1 ? 'Una dependencia se quedó' : `${skippedCycles} dependencias se quedaron`} con el registro que se fue: habría formado un círculo.`);
        return { primary_id: input.primary_id, merged_ids: dupIds, moved: movedSummary, edit_id: editId, warnings };
    }

    // ── Análisis (vista previa y validación) ────────────────────────────────

    private async analyze(tenantId: number, actor: Actor, listIdOrSlug: string, primaryId: number, dupIdsRaw: number[]): Promise<Analysis> {
        const dupIds = [...new Set(dupIdsRaw)].filter((id) => id !== primaryId);
        if (dupIds.length === 0) throw new HttpException({ code: 'merge_nothing', message: 'Elige al menos otro registro para fusionar.', data: { status: 400 } }, 400);
        const ids = [primaryId, ...dupIds];
        return this.records.readScoped(tenantId, actor, listIdOrSlug, async (tx, scope) => {
            const scopeW = scope.where({});
            const found = await tx
                .select({
                    id: records.id,
                    data: records.data,
                    parentId: records.parentId,
                    createdBy: records.createdBy,
                    createdAt: records.createdAt,
                    updatedAt: records.updatedAt,
                    hasDescription: sql<boolean>`(${records.description} IS NOT NULL)`,
                })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, scope.list.id), inArray(records.id, ids), isNull(records.deletedAt), ...(scopeW ? [scopeW] : [])));
            if (found.length !== ids.length) {
                throw new NotFoundException({ code: 'record_not_found', message: 'Alguno de esos registros ya no existe o no lo puedes ver.', data: { status: 404 } });
            }
            const byId = new Map(found.map((r) => [r.id, r]));
            const titleId = resolveTitleFieldId(scope.fields, scope.list.settings);
            const titles = new Map<number, string>();
            for (const r of found) {
                const v = titleId ? (r.data as Record<string, unknown>)[`f${titleId}`] : null;
                titles.set(r.id, typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 160) : `Registro #${r.id}`);
            }
            const titleOf = (id: number): string => titles.get(id) ?? `#${id}`;

            const blockers: string[] = [];
            const mirror = readMirrorListMarker(scope.list.settings);
            if (mirror) blockers.push(`Esta lista se sincroniza con ${mirrorSourceName(mirror)}: los registros se combinan allá.`);
            const primaryRow = byId.get(primaryId)!;
            if (!listRowInScope(scope.list.settings, actor, 'edit', { id: primaryId, createdBy: primaryRow.createdBy, data: primaryRow.data })) {
                blockers.push(`No puedes editar «${titleOf(primaryId)}», el registro que queda.`);
            }
            for (const d of dupIds) {
                const r = byId.get(d)!;
                if (!listRowInScope(scope.list.settings, actor, 'delete', { id: d, createdBy: r.createdBy, data: r.data })) {
                    blockers.push(`No puedes borrar «${titleOf(d)}»: fusionarlo lo manda a la papelera.`);
                }
            }
            if (found.some((r) => r.parentId !== null)) blockers.push('Las subtareas no se fusionan: fusiona los registros principales.');
            blockers.push(...(await mergeBlockers(tx, tenantId, primaryId, dupIds, titleOf)));

            const locked = new Set(managedFieldLocks(scope.list.settings).map((l) => l.field_id));
            const mergeFields = scope.fields.filter((f) => isMergeableFieldType(f.type) && !scope.hiddenIds.has(f.id) && !locked.has(f.id));
            const fields: MergeFieldPreview[] = mergeFields.map((f) => {
                const values = ids.map((id) => (byId.get(id)!.data as Record<string, unknown>)[`f${f.id}`] ?? null);
                const config = (f.config ?? {}) as Record<string, unknown>;
                return {
                    field_id: f.id,
                    label: f.label,
                    type: f.type,
                    values,
                    suggested: mergeSuggestedChoice(f.type, config, ids, values),
                    can_union: mergeCanUnion(f.type, config),
                    differs: mergeValuesDiffer(values),
                };
            });

            const totals = new Map<string, number>();
            for (const d of dupIds) for (const [k, n] of await countMoves(tx, tenantId, primaryId, d)) totals.set(k, (totals.get(k) ?? 0) + n);
            const moves: MergeMoveSummary[] = [...totals.entries()]
                .filter(([k]) => MOVE_LABELS.has(k))
                .map(([key, count]) => ({ key, label: MOVE_LABELS.get(key)!, count }));

            const warnings: string[] = [];
            const files = mergeFields.filter((f) => f.type === 'file');
            for (const f of files) {
                const max = Number((f.config as { max_files?: unknown } | null)?.max_files);
                const total = new Set(ids.flatMap((id) => {
                    const v = (byId.get(id)!.data as Record<string, unknown>)[`f${f.id}`];
                    return Array.isArray(v) ? v.map((x) => JSON.stringify(x)) : [];
                })).size;
                if (Number.isInteger(max) && max > 0 && total > max) warnings.push(`«${f.label}» admite ${max} archivo${max === 1 ? '' : 's'}: al juntar quedan los primeros.`);
            }
            if (found.filter((r) => r.hasDescription).length > 1) warnings.push('Más de uno tiene descripción: queda la del registro que elijas (las otras siguen en la papelera con su registro).');

            const preview: MergePreview = {
                records: ids.map((id) => {
                    const r = byId.get(id)!;
                    return { id, title: titleOf(id), created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt).toISOString(), has_description: r.hasDescription };
                }),
                fields,
                moves,
                blockers,
                warnings,
            };
            return {
                list: scope.list,
                fields: scope.fields,
                mergeFields,
                ids,
                rows: new Map(found.map((r) => [r.id, { id: r.id, data: (r.data ?? {}) as Record<string, unknown>, hasDescription: r.hasDescription }])),
                titles,
                preview,
            };
        });
    }

    // ── Deshacer ────────────────────────────────────────────────────────────

    private async revertPreview(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const out: BulkRevertPreview = { edit_id: edit.id, total: items.length, item_ids: [], conflict_ids: [], conflicts: [], missing: 0, sample: [] };
        const state = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const ids = items.map((i) => i.recordId).filter((x): x is number => typeof x === 'number');
            if (ids.length === 0) return new Map<number, { deleted: boolean; data: Record<string, unknown> }>();
            const rows = await tx
                .select({ id: records.id, deletedAt: records.deletedAt, data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), inArray(records.id, ids)));
            return new Map(rows.map((r) => [r.id, { deleted: r.deletedAt !== null, data: (r.data ?? {}) as Record<string, unknown> }]));
        });
        void actor;
        for (const item of items) {
            const s = item.recordId ? state.get(item.recordId) : undefined;
            if (!s) {
                out.missing++;
                continue;
            }
            if ('__into' in item.after) {
                if (!s.deleted) {
                    out.conflict_ids.push(item.id);
                    out.conflicts.push({ item_id: item.id, title: item.title, message: 'Ya volvió de la papelera.' });
                    continue;
                }
                out.item_ids.push(item.id);
                if (out.sample.length < 15) out.sample.push({ item_id: item.id, title: item.title, changes: [{ label: 'Registro', before: 'Fusionado', after: 'Vuelve a la lista' }] });
                continue;
            }
            const changed = Object.keys(item.after).filter((k) => /^f\d+$/.test(k) && JSON.stringify(s.data[k] ?? null) !== JSON.stringify(item.after[k] ?? null));
            if (s.deleted || changed.length > 0) {
                out.conflict_ids.push(item.id);
                out.conflicts.push({ item_id: item.id, title: item.title, message: s.deleted ? 'El registro que quedó está en la papelera.' : 'Alguien cambió el registro que quedó después de fusionar.' });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < 15) out.sample.push({ item_id: item.id, title: item.title, changes: [{ label: 'Valores', before: 'Los elegidos al fusionar', after: 'Los que tenía antes' }] });
        }
        return out;
    }

    private async revertApply(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[], force: boolean): Promise<BulkRevertResult> {
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const done: number[] = [];
        const primaryItem = items.find((i) => !('__into' in i.after));
        const dupItems = items.filter((i) => '__into' in i.after);
        // 1) Lo movido vuelve y los fusionados salen de la papelera.
        const byPrimary = new Map<number, BulkItemRow[]>();
        for (const it of dupItems) {
            const into = Number(it.after.__into);
            if (!byPrimary.has(into)) byPrimary.set(into, []);
            byPrimary.get(into)!.push(it);
        }
        for (const [primaryId, group] of byPrimary) {
            const dupIds = group.map((g) => g.recordId).filter((x): x is number => typeof x === 'number');
            try {
                const back = await this.records.unabsorbMerged(tenantId, actor, edit.listId, primaryId, dupIds, async (tx, ok) => {
                    for (const it of group) {
                        if (!it.recordId || !ok.includes(it.recordId)) continue;
                        await moveRowsBack(tx, tenantId, primaryId, it.recordId, readMoved(it.after.__moved));
                    }
                    const p = primaryItem && Number(primaryItem.recordId) === primaryId ? primaryItem : null;
                    if (p && '__description' in p.before) {
                        await restoreDescription(tx, tenantId, primaryId, p.before.__description, force ? null : Number(p.after.__description_from));
                    }
                });
                for (const it of group) {
                    if (it.recordId && back.includes(it.recordId)) done.push(it.id);
                    else result.conflicts++;
                }
            } catch (err) {
                for (const it of group) result.failed.push({ item_id: it.id, title: it.title, message: explain(err) });
            }
        }
        // 2) Los valores del que quedó vuelven (si nadie los cambió después).
        if (primaryItem?.recordId) {
            const data: Record<string, unknown> = {};
            const expect: Record<string, unknown> = {};
            for (const k of Object.keys(primaryItem.after)) {
                if (!/^f\d+$/.test(k)) continue;
                data[k] = primaryItem.before[k] ?? null;
                expect[k] = primaryItem.after[k] ?? null;
            }
            try {
                if (Object.keys(data).length > 0) {
                    await this.records.update(tenantId, actor, String(edit.listId), primaryItem.recordId, { data }, force ? {} : { expect });
                }
                done.push(primaryItem.id);
            } catch (err) {
                if (err instanceof ConflictException) result.conflicts++;
                else result.failed.push({ item_id: primaryItem.id, title: primaryItem.title, message: explain(err) });
            }
        }
        result.reverted = done.length;
        await this.history.markReverted(tenantId, actor, edit.id, done);
        return result;
    }
}

/** Copia la descripción de `from` al que queda; devuelve la que tenía (para deshacer). */
async function copyDescription(tx: Tx, tenantId: number, primaryId: number, from: number): Promise<unknown> {
    const [row] = await tx
        .select({ description: records.description })
        .from(records)
        .where(and(eq(records.tenantId, tenantId), eq(records.id, primaryId)))
        .limit(1);
    await tx.execute(sql`
        UPDATE records SET description = (SELECT d.description FROM records d WHERE d.tenant_id = ${tenantId} AND d.id = ${from})
        WHERE tenant_id = ${tenantId} AND id = ${primaryId}`);
    return row?.description ?? null;
}

/**
 * Vuelve la descripción de antes. Con `onlyIfFrom`, sólo si el que quedó
 * sigue con la que se copió de ese registro (nadie la editó después).
 */
async function restoreDescription(tx: Tx, tenantId: number, primaryId: number, previous: unknown, onlyIfFrom: number | null): Promise<void> {
    const guard = onlyIfFrom
        ? sql`AND description IS NOT DISTINCT FROM (SELECT d.description FROM records d WHERE d.tenant_id = ${tenantId} AND d.id = ${onlyIfFrom})`
        : sql``;
    await tx.execute(sql`
        UPDATE records SET description = ${previous === null || previous === undefined ? null : JSON.stringify(previous)}::jsonb
        WHERE tenant_id = ${tenantId} AND id = ${primaryId} ${guard}`);
}

function readMoved(raw: unknown): MovedRows {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<MovedRows>;
    return {
        steps: o.steps && typeof o.steps === 'object' ? (o.steps as Record<string, number[]>) : {},
        follows: Array.isArray(o.follows) ? o.follows.map(Number) : [],
        dependencies: Array.isArray(o.dependencies) ? o.dependencies : [],
        skipped_cycles: 0,
    };
}

function explain(err: unknown): string {
    if (err instanceof HttpException) {
        const r = err.getResponse() as { message?: unknown } | string;
        return typeof r === 'string' ? r : String(r.message ?? err.message);
    }
    return err instanceof Error ? err.message : 'Error desconocido';
}

