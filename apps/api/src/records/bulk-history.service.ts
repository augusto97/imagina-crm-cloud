import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    BULK_HISTORY_DAYS,
    BULK_REVERT_CHUNK,
    roleHasCapability,
    sameBulkValue,
    type BulkEditKind,
    type BulkEditLog,
    type BulkRevertPreview,
    type BulkRevertResult,
    type Field,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { bulkEditItems, bulkEdits, users } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { RecordsService, type Actor } from './records.service';

/** Cuántas ediciones muestra el historial de una lista. */
const HISTORY_LIMIT = 30;
/** Cuántas filas se muestran de ejemplo en la vista previa de deshacer. */
const SAMPLE_SIZE = 15;
const CONFLICT_LIST = 50;

export interface BulkItemInput {
    recordId?: number | null;
    externalId?: string | null;
    parentExternalId?: string | null;
    title: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

export interface BulkItemRow {
    id: number;
    recordId: number | null;
    externalId: string | null;
    parentExternalId: string | null;
    title: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
}

export interface BulkEditHeader {
    id: number;
    listId: number;
    userId: number | null;
    kind: BulkEditKind;
}

/**
 * Quien sabe DESHACER un tipo de edición. Las ediciones de la app las revierte
 * este mismo servicio; las de la tienda (v0.1.217) las registra el módulo de
 * sincronización, que es quien sabe hablar con WooCommerce — así este módulo
 * no depende de aquel (el de la tienda ya depende de éste).
 */
export interface BulkReverter {
    preview(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview>;
    apply(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[], force: boolean): Promise<BulkRevertResult>;
}

/**
 * Historial de ediciones masivas y DESHACER (v0.1.218).
 *
 * Cada tanda de una edición masiva registra, por fila, el antes y el después
 * de lo que cambió. Deshacer vuelve cada fila a su antes, pero sólo si sigue
 * en el después: si alguien la tocó en el medio, pisarla le borraría ese
 * cambio — la fila se muestra como conflicto y sólo se revierte si la persona
 * lo pide a sabiendas.
 */
@Injectable()
export class BulkHistoryService {
    private readonly reverters = new Map<BulkEditKind, BulkReverter>();

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly records: RecordsService,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
    ) {
        this.reverters.set('records', {
            preview: (t, a, e, i) => this.previewRecords(t, a, e, i),
            apply: (t, a, e, i, f) => this.applyRecords(t, a, e, i, f),
        });
    }

    registerReverter(kind: BulkEditKind, reverter: BulkReverter): void {
        this.reverters.set(kind, reverter);
    }

    // ── Registro ────────────────────────────────────────────────────────────

    /**
     * La edición a la que pertenece una tanda: la primera la crea; las
     * siguientes mandan su id (que tiene que ser de la misma lista, del mismo
     * tipo y de la misma persona — no se le agregan filas a la edición de otro).
     */
    async openEdit(
        tenantId: number,
        userId: number,
        listId: number,
        kind: BulkEditKind,
        editId: number | undefined,
        summary: string,
        operations: unknown[],
    ): Promise<number> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            if (editId) {
                const [row] = await tx
                    .select({ id: bulkEdits.id, listId: bulkEdits.listId, userId: bulkEdits.userId, kind: bulkEdits.kind })
                    .from(bulkEdits)
                    .where(and(eq(bulkEdits.tenantId, tenantId), eq(bulkEdits.id, editId)))
                    .limit(1);
                if (row && row.listId === listId && (row.userId ?? 0) === userId && row.kind === kind) return row.id;
                throw new BadRequestException({ code: 'bulk_edit_mismatch', message: 'Esa edición masiva no es de esta lista.', data: { status: 400 } });
            }
            // Limpieza: lo que pasó los 30 días ya no se deshace.
            await tx
                .delete(bulkEdits)
                .where(and(eq(bulkEdits.tenantId, tenantId), lt(bulkEdits.createdAt, sql`now() - make_interval(days => ${BULK_HISTORY_DAYS})`)));
            const [created] = await tx
                .insert(bulkEdits)
                // v0.1.221 — una automatización escribe como usuario 0: queda sin autor.
                .values({ tenantId, listId, userId: userId > 0 ? userId : null, kind, summary, operations })
                .returning({ id: bulkEdits.id });
            return created!.id;
        });
    }

    async addItems(tenantId: number, editId: number, items: BulkItemInput[]): Promise<void> {
        if (items.length === 0) return;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx.insert(bulkEditItems).values(
                items.map((i) => ({
                    tenantId,
                    bulkEditId: editId,
                    recordId: i.recordId ?? null,
                    externalId: i.externalId ?? null,
                    parentExternalId: i.parentExternalId ?? null,
                    title: i.title.slice(0, 300),
                    before: i.before,
                    after: i.after,
                })),
            );
            await tx
                .update(bulkEdits)
                .set({ itemCount: sql`${bulkEdits.itemCount} + ${items.length}` })
                .where(and(eq(bulkEdits.tenantId, tenantId), eq(bulkEdits.id, editId)));
        });
    }

    // ── Consulta ────────────────────────────────────────────────────────────

    async list(tenantId: number, actor: Actor, listIdOrSlug: string): Promise<BulkEditLog[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: bulkEdits.id,
                    listId: bulkEdits.listId,
                    kind: bulkEdits.kind,
                    summary: bulkEdits.summary,
                    userId: bulkEdits.userId,
                    userName: users.name,
                    createdAt: bulkEdits.createdAt,
                    itemCount: bulkEdits.itemCount,
                    revertedCount: bulkEdits.revertedCount,
                    revertedAt: bulkEdits.revertedAt,
                })
                .from(bulkEdits)
                .leftJoin(users, eq(users.id, bulkEdits.userId))
                .where(and(eq(bulkEdits.tenantId, tenantId), eq(bulkEdits.listId, list.id)))
                .orderBy(desc(bulkEdits.id))
                .limit(HISTORY_LIMIT),
        );
        return rows
            .filter((r) => r.itemCount > 0)
            .map((r) => ({
                id: r.id,
                list_id: r.listId,
                kind: r.kind as BulkEditKind,
                summary: r.summary,
                user_id: r.userId,
                user_name: r.userName ?? null,
                created_at: r.createdAt.toISOString(),
                item_count: r.itemCount,
                reverted_count: r.revertedCount,
                reverted_at: r.revertedAt ? r.revertedAt.toISOString() : null,
                can_revert: r.revertedCount < r.itemCount && this.canRevert(actor, r.userId, r.kind as BulkEditKind),
            }));
    }

    // ── Deshacer ────────────────────────────────────────────────────────────

    async revertPreview(tenantId: number, actor: Actor, listIdOrSlug: string, editId: number): Promise<BulkRevertPreview> {
        const edit = await this.loadEdit(tenantId, actor, listIdOrSlug, editId);
        const items = await this.pendingItems(tenantId, edit.id, null);
        return this.reverterFor(edit.kind).preview(tenantId, actor, edit, items);
    }

    async revertApply(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        editId: number,
        itemIds: number[],
        force: boolean,
    ): Promise<BulkRevertResult> {
        const edit = await this.loadEdit(tenantId, actor, listIdOrSlug, editId);
        const items = await this.pendingItems(tenantId, edit.id, itemIds.slice(0, BULK_REVERT_CHUNK));
        const result = await this.reverterFor(edit.kind).apply(tenantId, actor, edit, items, force);
        if (result.reverted > 0) {
            await this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'bulk_edit.revert',
                targetType: 'list',
                targetId: edit.listId,
                targetLabel: '',
                meta: { edit_id: edit.id, kind: edit.kind, reverted: result.reverted, forced: force },
            });
        }
        return result;
    }

    /** Marca filas como revertidas y actualiza el contador de la edición. */
    async markReverted(tenantId: number, actor: Actor, editId: number, itemIds: number[]): Promise<void> {
        if (itemIds.length === 0) return;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const done = await tx
                .update(bulkEditItems)
                .set({ reverted: true })
                .where(and(eq(bulkEditItems.bulkEditId, editId), inArray(bulkEditItems.id, itemIds), eq(bulkEditItems.reverted, false)))
                .returning({ id: bulkEditItems.id });
            if (done.length === 0) return;
            await tx
                .update(bulkEdits)
                .set({ revertedCount: sql`${bulkEdits.revertedCount} + ${done.length}`, revertedAt: new Date(), revertedBy: actor.userId })
                .where(and(eq(bulkEdits.tenantId, tenantId), eq(bulkEdits.id, editId)));
        });
    }

    // ── Deshacer una edición de registros de la app ─────────────────────────

    private async previewRecords(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const out: BulkRevertPreview = { edit_id: edit.id, total: items.length, item_ids: [], conflict_ids: [], conflicts: [], missing: 0, sample: [] };
        const { rows, fields } = await this.currentRows(tenantId, actor, edit.listId, items);
        const byId = new Map(fields.map((f) => [f.id, f]));
        for (const item of items) {
            const row = item.recordId ? rows.get(item.recordId) : undefined;
            if (!row) {
                out.missing++;
                continue;
            }
            const drift = this.drift(item, row, byId);
            if (drift) {
                out.conflict_ids.push(item.id);
                if (out.conflicts.length < CONFLICT_LIST) out.conflicts.push({ item_id: item.id, title: item.title, message: drift });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < SAMPLE_SIZE) {
                out.sample.push({
                    item_id: item.id,
                    title: item.title,
                    changes: Object.keys(item.before).map((key) => {
                        const field = byId.get(Number(key.slice(1)));
                        return {
                            label: field?.label ?? key,
                            before: display(field, item.after[key]),
                            after: display(field, item.before[key]),
                        };
                    }),
                });
            }
        }
        return out;
    }

    private async applyRecords(
        tenantId: number,
        actor: Actor,
        edit: BulkEditHeader,
        items: BulkItemRow[],
        force: boolean,
    ): Promise<BulkRevertResult> {
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const { rows, fields } = await this.currentRows(tenantId, actor, edit.listId, items);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const done: number[] = [];
        for (const item of items) {
            const row = item.recordId ? rows.get(item.recordId) : undefined;
            if (!row) {
                result.failed.push({ item_id: item.id, title: item.title, message: 'El registro ya no existe o no lo puedes editar.' });
                continue;
            }
            if (!force && this.drift(item, row, byId)) {
                result.conflicts++;
                continue;
            }
            // Sólo lo que la edición cambió; lo demás de la fila no se toca.
            try {
                await this.records.update(tenantId, actor, String(edit.listId), row.id, { data: item.before }, { silent: true });
                done.push(item.id);
                result.reverted++;
            } catch (err) {
                result.failed.push({ item_id: item.id, title: item.title, message: explain(err) });
            }
        }
        await this.markReverted(tenantId, actor, edit.id, done);
        if (done.length > 0) this.realtime.records(tenantId, edit.listId);
        return result;
    }

    /** Si la fila ya no está como la dejó la edición, qué cambió (texto) — o null. */
    private drift(
        item: BulkItemRow,
        row: { data: Record<string, unknown>; relations: Record<number, number[]> },
        fields: Map<number, Field>,
    ): string | null {
        for (const [key, after] of Object.entries(item.after)) {
            const fieldId = Number(key.slice(1));
            const field = fields.get(fieldId);
            if (!field) return 'Una de las columnas ya no existe.';
            const isRel = field.type === 'relation';
            const current = isRel ? (row.relations[fieldId] ?? []) : row.data[key];
            if (!sameBulkValue(current, after, isRel || field.type === 'multi_select')) {
                return `«${field.label}» cambió después: ahora es ${display(field, current)}.`;
            }
        }
        return null;
    }

    private async currentRows(tenantId: number, actor: Actor, listId: number, items: BulkItemRow[]) {
        const ids = [...new Set(items.map((i) => i.recordId).filter((n): n is number => typeof n === 'number'))];
        if (ids.length === 0) {
            const list = await this.lists.get(tenantId, String(listId));
            return { rows: new Map<number, { id: number; data: Record<string, unknown>; relations: Record<number, number[]> }>(), fields: [] as Field[], list };
        }
        const loaded = await this.records.bulkRows(tenantId, actor, String(listId), { ids }, ids.length);
        return { rows: new Map(loaded.rows.map((r) => [r.id, r])), fields: loaded.fields, list: loaded.list };
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    private canRevert(actor: Actor, ownerId: number | null, kind: BulkEditKind): boolean {
        // La propia se deshace siempre; la de otro, sólo con permiso de acciones
        // masivas (quien puede editar todo un filtro puede volverlo atrás).
        if (kind === 'store') return roleHasCapability(actor.role, 'bulk_actions');
        return ownerId === actor.userId || roleHasCapability(actor.role, 'bulk_actions');
    }

    private reverterFor(kind: BulkEditKind): BulkReverter {
        const r = this.reverters.get(kind);
        if (!r) throw new BadRequestException({ code: 'bulk_revert_unsupported', message: 'Esta edición no se puede deshacer.', data: { status: 400 } });
        return r;
    }

    private async loadEdit(tenantId: number, actor: Actor, listIdOrSlug: string, editId: number): Promise<BulkEditHeader> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: bulkEdits.id, listId: bulkEdits.listId, userId: bulkEdits.userId, kind: bulkEdits.kind })
                .from(bulkEdits)
                .where(and(eq(bulkEdits.tenantId, tenantId), eq(bulkEdits.id, editId), eq(bulkEdits.listId, list.id)))
                .limit(1),
        );
        if (!row) throw new NotFoundException({ code: 'bulk_edit_not_found', message: 'Esa edición ya no está en el historial.', data: { status: 404 } });
        const edit = { ...row, kind: row.kind as BulkEditKind };
        if (!this.canRevert(actor, edit.userId, edit.kind)) {
            throw new ForbiddenException({
                code: 'forbidden_bulk_revert',
                message: 'Sólo puedes deshacer tus propias ediciones masivas.',
                data: { status: 403 },
            });
        }
        return edit;
    }

    private async pendingItems(tenantId: number, editId: number, ids: number[] | null): Promise<BulkItemRow[]> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: bulkEditItems.id,
                    recordId: bulkEditItems.recordId,
                    externalId: bulkEditItems.externalId,
                    parentExternalId: bulkEditItems.parentExternalId,
                    title: bulkEditItems.title,
                    before: bulkEditItems.before,
                    after: bulkEditItems.after,
                })
                .from(bulkEditItems)
                .where(
                    and(
                        eq(bulkEditItems.bulkEditId, editId),
                        eq(bulkEditItems.reverted, false),
                        ids ? inArray(bulkEditItems.id, ids.length > 0 ? ids : [-1]) : undefined,
                    ),
                )
                .orderBy(bulkEditItems.id),
        );
    }
}

/** Como lo ve la persona: la ETIQUETA de una opción, no su valor interno. */
function display(field: Field | undefined, v: unknown): string {
    if (field && (field.type === 'select' || field.type === 'multi_select')) {
        const opts = Array.isArray((field.config as { options?: unknown }).options)
            ? ((field.config as { options: Array<{ value?: unknown; label?: unknown }> }).options)
            : [];
        const label = (x: unknown) => String(opts.find((o) => o.value === x)?.label ?? x);
        if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(label).join(', ');
        if (v !== null && v !== undefined && v !== '') return label(v);
    }
    return show(v);
}

function show(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(String).join(', ');
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
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
