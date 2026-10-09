import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
    STORE_BULK_APPLY_CHUNK,
    STORE_BULK_MAX_TARGET,
    type StoreVariationsPreview,
    type StoreVariationsResult,
    readStoreListMarker,
    defaultStoreEditable,
    summarizeStoreBulkOperations,
    type BulkRevertPreview,
    type BulkRevertResult,
    type StoreBulkCatalog,
    type StoreBulkOperation,
    type StoreBulkPreview,
    type StoreBulkResult,
    type StoreBulkTarget,
} from '@imagina-base/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { ConnectorsService } from '../connectors/connectors.service';
import { connectionSyncs, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { BulkHistoryService, type BulkEditHeader, type BulkItemInput, type BulkItemRow } from '../records/bulk-history.service';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { StoreSyncEngine } from './store-sync.engine';
import { readSettings, type SyncSettings } from './store-sync.types';
import {
    BULK_OP_COLUMN,
    STORE_FIELD_LABEL,
    planBulkUpdate,
    planVariations,
    revertBody,
    type VariationsSpec,
    snapshotBody,
    storeDrift,
    type BulkItemKind,
    type BulkPlanContext,
} from './woocommerce/woo-bulk';
import { WOO_PAGE_SIZE, WooApiError, wooGetPage, wooSend } from './woocommerce/woo-fetch';
import { variationAttributes, type WooJson } from './woocommerce/woo-map';

/** WooCommerce acepta hasta 100 elementos por pedido de lote. */
const BATCH_SIZE = 100;
/** Cuántos productos se leen de la tienda para la muestra de la vista previa. */
const SAMPLE_PRODUCTS = 10;
const SAMPLE_ROWS = 20;

interface StoreCtx {
    listId: number;
    listName: string;
    syncId: number;
    settings: SyncSettings;
    creds: IntegrationCreds;
    priceDecimals: number;
    currency: string;
    editable: Set<string> | null;
    /** v0.1.223 — etiqueta y tipo de cada campo de la lista (para `price_from_field`). */
    fieldLabels: Map<number, string>;
    fieldTypes: Map<number, string>;
}

/** Columnas de las que se puede calcular un precio. */
const NUMERIC_SOURCE_TYPES = new Set(['number', 'currency', 'percent', 'computed', 'rollup', 'lookup']);

interface Target {
    /** Registros de la app abarcados. */
    recordIds: number[];
    /** Productos (id de la tienda) y si son variables, según el espejo. */
    products: Array<{ id: string; variable: boolean; recordId: number }>;
    /** Variaciones elegidas una por una (id de la tienda y su producto). */
    variations: Array<{ id: string; parentId: string; recordId: number }>;
}

/**
 * Edición masiva de la tienda (v0.1.217, ADR-S24). Lo que cambia es la
 * TIENDA —con su API por lotes— y lo que la tienda devuelve se aplica a las
 * listas, como cualquier dato que llega de WooCommerce. Cada cálculo parte de
 * lo que la tienda tiene en ESE momento (se lee antes de escribir): el espejo
 * puede estar atrasado por una venta que todavía no llegó.
 */
@Injectable()
export class StoreBulkService implements OnModuleInit {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly connectors: ConnectorsService,
        private readonly engine: StoreSyncEngine,
        private readonly audit: AuditService,
        private readonly history: BulkHistoryService,
    ) {}

    /** v0.1.218 — Deshacer una edición de la tienda lo sabe hacer este servicio. */
    onModuleInit(): void {
        this.history.registerReverter('store', {
            preview: (t, a, e, i) => this.revertPreview(t, a, e, i),
            apply: (t, a, e, i, f) => this.revertApply(t, a, e, i, f),
        });
        // v0.1.223 — Deshacer variaciones creadas en lote = borrarlas (si nadie las tocó).
        this.history.registerReverter('store_create', {
            preview: (t, a, e, i) => this.revertCreatePreview(t, a, e, i),
            apply: (t, a, e, i, f) => this.revertCreateApply(t, a, e, i, f),
        });
    }

    // ── Catálogo (lo que la pantalla ofrece para elegir) ─────────────────────

    async catalog(tenantId: number, listIdOrSlug: string): Promise<StoreBulkCatalog> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const [categories, tags, attributes, shipping, taxes] = await Promise.all([
            this.allPages(ctx.creds, '/products/categories', 10),
            this.allPages(ctx.creds, '/products/tags', 10),
            this.allPages(ctx.creds, '/products/attributes', 2),
            this.allPages(ctx.creds, '/products/shipping_classes', 2).catch(() => []),
            this.allPages(ctx.creds, '/taxes/classes', 1).catch(() => []),
        ]);
        const term = (t: WooJson) => ({ slug: String(t.slug ?? ''), name: String(t.name ?? '') });
        return {
            categories: categories.map(term).filter((t) => t.slug !== ''),
            tags: tags.map(term).filter((t) => t.slug !== ''),
            attributes: attributes
                .map((a) => ({ id: Number(a.id), name: String(a.name ?? ''), slug: String(a.slug ?? '') }))
                .filter((a) => a.id > 0),
            shipping_classes: shipping.map(term).filter((t) => t.slug !== ''),
            tax_classes: taxes.map(term).filter((t) => t.slug !== ''),
            price_decimals: ctx.priceDecimals,
            currency: ctx.currency,
        };
    }

    /** Valores de un atributo global (Rojo, Azul…) para elegirlos en vez de tipearlos. */
    async attributeTerms(tenantId: number, listIdOrSlug: string, attributeId: number): Promise<Array<{ slug: string; name: string }>> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const rows = await this.allPages(ctx.creds, `/products/attributes/${attributeId}/terms`, 5);
        return rows.map((t) => ({ slug: String(t.slug ?? ''), name: String(t.name ?? '') })).filter((t) => t.name !== '');
    }

    // ── Vista previa ─────────────────────────────────────────────────────────

    async preview(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        target: StoreBulkTarget,
        operations: StoreBulkOperation[],
        includeVariations: boolean,
    ): Promise<StoreBulkPreview> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const t = await this.resolveTarget(tenantId, actor, ctx, 'ids' in target ? { ids: target.ids } : { ...target, include_subtasks: false }, STORE_BULK_MAX_TARGET);
        const warnings: string[] = [];
        const blocked = operations.filter((op) => this.isBlocked(ctx, op));
        if (blocked.length > 0) {
            warnings.push(
                'Algunas operaciones tocan columnas que la empresa no habilitó para editar desde la app (Ajustes → Campos): esas no se aplican.',
            );
        }
        // Cuántas variaciones abarca: las elegidas + las de los productos variables.
        const variableIds = t.products.filter((p) => p.variable).map((p) => p.id);
        let expanded = 0;
        if (includeVariations && variableIds.length > 0) {
            expanded = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const rows = await tx
                    .select({ id: syncLinks.externalId })
                    .from(syncLinks)
                    .where(
                        and(
                            eq(syncLinks.syncId, ctx.syncId),
                            eq(syncLinks.resource, 'variations'),
                            inArray(syncLinks.parentExternalId, variableIds),
                        ),
                    );
                return rows.length;
            });
        }
        const selectedVar = new Set(t.variations.map((v) => v.id));
        const out: StoreBulkPreview = {
            record_ids: t.recordIds,
            products: t.products.length,
            variations: Math.max(expanded, 0) + selectedVar.size,
            sample: [],
            sample_unchanged: 0,
            warnings,
        };

        // Muestra: se lee de la tienda (lo que se va a calcular de verdad).
        const planCtx = await this.termsContext(ctx, operations, false);
        const sampleProducts = t.products.slice(0, SAMPLE_PRODUCTS);
        const productObjs = await this.fetchProducts(ctx.creds, sampleProducts.map((p) => p.id));
        const collected: Array<{ title: string; kind: BulkItemKind; obj: WooJson }> = [];
        for (const p of productObjs) {
            collected.push({ title: String(p.name ?? `#${p.id}`), kind: 'product', obj: p });
            if (includeVariations && p.type === 'variable' && collected.length < SAMPLE_ROWS) {
                const vars = await wooGetPage(ctx.creds, `/products/${Number(p.id)}/variations`, [['per_page', '5']]).catch(() => null);
                for (const v of vars?.rows ?? []) collected.push({ title: variationTitle(p, v), kind: 'variation', obj: v });
            }
        }
        if (collected.length < SAMPLE_ROWS && t.variations.length > 0) {
            for (const [parentId, ids] of groupBy(t.variations.slice(0, 20), (v) => v.parentId)) {
                const res = await wooGetPage(ctx.creds, `/products/${Number(parentId)}/variations`, [
                    ['include', ids.map((v) => v.id).join(',')],
                    ['per_page', String(WOO_PAGE_SIZE)],
                ]).catch(() => null);
                for (const v of res?.rows ?? []) collected.push({ title: variationTitle({ name: `#${parentId}` }, v), kind: 'variation', obj: v });
            }
        }
        const source = await this.sourceValues(tenantId, actor, ctx, operations, collected);
        for (const c of collected) {
            if (out.sample.length >= SAMPLE_ROWS) break;
            const plan = planBulkUpdate(operations, c.obj, { ...planCtx, kind: c.kind, ...source.of(c.kind, c.obj) });
            if (plan.changes.length === 0 && plan.notes.length === 0) {
                out.sample_unchanged++;
                continue;
            }
            out.sample.push({ title: c.title, kind: c.kind, changes: plan.changes, notes: plan.notes });
        }
        return out;
    }

    // ── Aplicar (una tanda de registros de la app) ─────────────────────────

    async apply(
        tenantId: number,
        actor: Actor,
        listIdOrSlug: string,
        ids: number[],
        operations: StoreBulkOperation[],
        includeVariations: boolean,
        editId?: number,
    ): Promise<StoreBulkResult> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const t = await this.resolveTarget(tenantId, actor, ctx, { ids }, STORE_BULK_APPLY_CHUNK);
        const planCtx = await this.termsContext(ctx, operations, true);
        const result: StoreBulkResult = { updated: 0, unchanged: 0, failed: [], skipped: [], edit_id: editId ?? null };
        // v0.1.218 — historial para poder deshacer (la primera tanda abre la edición).
        result.edit_id = await this.history.openEdit(
            tenantId,
            actor.userId,
            ctx.listId,
            'store',
            editId,
            summarizeStoreBulkOperations(operations, (id) => ctx.fieldLabels.get(id) ?? `#${id}`),
            operations,
        );
        const sources = new Map<string, { obj: WooJson; body: Record<string, unknown>; title: string; parentId: string | null }>();

        const products = await this.fetchProducts(ctx.creds, t.products.map((p) => p.id));
        const productUpdates: Array<{ id: number; title: string; body: Record<string, unknown> }> = [];
        const variationUpdates = new Map<string, Array<{ id: number; title: string; body: Record<string, unknown> }>>();
        // v0.1.223 — se juntan primero los objetos (para leer de una vez la
        // columna de la app que usa `price_from_field`) y después se planifica.
        const pending: Array<{ kind: BulkItemKind; obj: WooJson; title: string; parentId?: string }> = [];
        const addPlan = (kind: BulkItemKind, obj: WooJson, title: string, parentId?: string) => {
            pending.push({ kind, obj, title, ...(parentId ? { parentId } : {}) });
        };
        const planOne = (kind: BulkItemKind, obj: WooJson, title: string, parentId: string | undefined, src: Pick<BulkPlanContext, 'source' | 'sourceLabel'>) => {
            const plan = planBulkUpdate(operations, obj, { ...planCtx, kind, ...src });
            if (Object.keys(plan.body).length === 0) {
                if (plan.notes.length > 0) result.skipped.push({ title, reason: plan.notes.join(' ') });
                else result.unchanged++;
                return;
            }
            const entry = { id: Number(obj.id), title, body: plan.body };
            sources.set(`${parentId ?? ''}:${entry.id}`, { obj, body: plan.body, title, parentId: parentId ?? null });
            if (kind === 'product') productUpdates.push(entry);
            else variationUpdates.set(parentId!, [...(variationUpdates.get(parentId!) ?? []), entry]);
        };
        const doneVariations = new Set<string>();
        for (const p of products) {
            addPlan('product', p, String(p.name ?? `#${p.id}`));
            if (includeVariations && p.type === 'variable') {
                for (const v of await this.allPages(ctx.creds, `/products/${Number(p.id)}/variations`, 50)) {
                    doneVariations.add(String(v.id));
                    addPlan('variation', v, variationTitle(p, v), String(p.id));
                }
            }
        }
        for (const [parentId, list] of groupBy(t.variations.filter((v) => !doneVariations.has(v.id)), (v) => v.parentId)) {
            const res = await wooGetPage(ctx.creds, `/products/${Number(parentId)}/variations`, [
                ['include', list.map((v) => v.id).join(',')],
                ['per_page', String(WOO_PAGE_SIZE)],
            ]);
            for (const v of res.rows) addPlan('variation', v, variationTitle({ name: `#${parentId}` }, v), parentId);
        }
        const source = await this.sourceValues(tenantId, actor, ctx, operations, pending);
        for (const p of pending) planOne(p.kind, p.obj, p.title, p.parentId, source.of(p.kind, p.obj));

        // Escritura por lotes; lo que la tienda devuelve se aplica a la app.
        const writtenProducts: WooJson[] = [];
        const writtenVariations: Array<{ parentId: string; obj: WooJson }> = [];
        for (const chunk of chunks(productUpdates, BATCH_SIZE)) {
            const res = await this.batch(ctx.creds, '/products/batch', chunk, result);
            writtenProducts.push(...res);
        }
        for (const [parentId, list] of variationUpdates) {
            for (const chunk of chunks(list, BATCH_SIZE)) {
                const res = await this.batch(ctx.creds, `/products/${Number(parentId)}/variations/batch`, chunk, result);
                writtenVariations.push(...res.map((obj) => ({ parentId, obj })));
            }
        }
        result.updated = writtenProducts.length + writtenVariations.length;
        // Antes y después de cada objeto escrito: el después es lo que devolvió
        // la tienda (ya normalizado), así «sigue igual» se compara bien al deshacer.
        const items: BulkItemInput[] = [];
        const record = (parentId: string | null, row: WooJson) => {
            const src = sources.get(`${parentId ?? ''}:${Number(row.id)}`);
            if (!src) return;
            const keys = Object.keys(src.body);
            items.push({
                externalId: String(row.id),
                parentExternalId: parentId,
                title: src.title,
                before: snapshotBody(src.obj, keys, src.body),
                after: snapshotBody(row, keys, src.body),
            });
        };
        for (const row of writtenProducts) record(null, row);
        for (const { parentId, obj } of writtenVariations) record(parentId, obj);
        await this.history.addItems(tenantId, result.edit_id, items);
        if (result.updated > 0) {
            await this.engine.applyStoreObjects(tenantId, ctx.syncId, ctx.creds, writtenProducts, writtenVariations);
            await this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'store_sync.bulk_edit',
                targetType: 'list',
                targetId: ctx.listId,
                targetLabel: ctx.listName,
                meta: { operations: operations.map((o) => o.op), updated: result.updated, failed: result.failed.length },
            });
        }
        return result;
    }

    // ── Crear variaciones en lote (v0.1.223) ──────────────────────────────

    async previewVariations(tenantId: number, actor: Actor, listIdOrSlug: string, target: StoreBulkTarget, spec: VariationsSpec): Promise<StoreVariationsPreview> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const t = await this.resolveTarget(tenantId, actor, ctx, 'ids' in target ? { ids: target.ids } : { ...target, include_subtasks: false }, STORE_BULK_MAX_TARGET);
        const variable = t.products.filter((p) => p.variable);
        const out: StoreVariationsPreview = { record_ids: t.recordIds, products: variable.length, to_create: 0, existing: 0, sample: [], warnings: [] };
        const simple = t.products.length - variable.length;
        if (simple > 0) out.warnings.push(`${simple} ${simple === 1 ? 'producto no es variable' : 'productos no son variables'}: no reciben variaciones (cambia su tipo en WooCommerce).`);
        if (t.variations.length > 0) out.warnings.push('Las variaciones elegidas se ignoran: las variaciones nuevas se crean sobre sus PRODUCTOS.');
        // La cuenta exacta necesita las variaciones de cada producto: se leen los primeros
        // (los que entran en la muestra); el resto se estima con las combinaciones.
        const objs = await this.fetchProducts(ctx.creds, variable.slice(0, SAMPLE_PRODUCTS).map((p) => p.id));
        for (const p of objs) {
            const existing = await this.allPages(ctx.creds, `/products/${Number(p.id)}/variations`, 10);
            const plan = planVariations(p, existing, spec, ctx.priceDecimals);
            out.to_create += plan.create.length;
            out.existing += plan.existing;
            out.sample.push({ title: String(p.name ?? `#${p.id}`), create: plan.create.slice(0, 10).map((c) => c.title), existing: plan.existing, notes: plan.notes });
        }
        const rest = variable.length - objs.length;
        if (rest > 0) {
            const per = variationCombosCount(spec);
            out.to_create += rest * per;
            out.warnings.push(`De los otros ${rest} productos se calcula al aplicar: hasta ${per} variaciones cada uno (las que ya existan se saltean).`);
        }
        return out;
    }

    async applyVariations(tenantId: number, actor: Actor, listIdOrSlug: string, ids: number[], spec: VariationsSpec, editId?: number): Promise<StoreVariationsResult> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const t = await this.resolveTarget(tenantId, actor, ctx, { ids }, STORE_BULK_APPLY_CHUNK);
        const result: StoreVariationsResult = { created: 0, skipped: [], failed: [], edit_id: editId ?? null };
        result.edit_id = await this.history.openEdit(tenantId, actor.userId, ctx.listId, 'store_create', editId, `Crear variaciones: ${spec.attributes.map((a) => `${a.name} (${a.options.join(', ')})`).join(' × ')}`, [spec]);
        const items: BulkItemInput[] = [];
        const touchedProducts: WooJson[] = [];
        const created: Array<{ parentId: string; obj: WooJson }> = [];
        const products = await this.fetchProducts(ctx.creds, t.products.map((p) => p.id));
        for (const p of products) {
            const title = String(p.name ?? `#${p.id}`);
            const existing = p.type === 'variable' ? await this.allPages(ctx.creds, `/products/${Number(p.id)}/variations`, 50) : [];
            const plan = planVariations(p, existing, spec, ctx.priceDecimals);
            if (plan.create.length === 0) {
                result.skipped.push({ title, reason: plan.notes[0] ?? `Ya tenía las ${plan.existing} combinaciones.` });
                continue;
            }
            let product = p;
            if (plan.productAttributes) {
                try {
                    product = (await wooSend(ctx.creds, 'PUT', `/products/${Number(p.id)}`, { attributes: plan.productAttributes })) as WooJson;
                } catch (err) {
                    result.failed.push({ title, message: `No se pudieron agregar los valores a los atributos: ${err instanceof Error ? err.message : String(err)}` });
                    continue;
                }
            }
            touchedProducts.push(product);
            for (const chunk of chunks(plan.create, BATCH_SIZE)) {
                let res: unknown;
                try {
                    res = await wooSend(ctx.creds, 'POST', `/products/${Number(p.id)}/variations/batch`, { create: chunk.map((c) => c.body) });
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    for (const c of chunk) result.failed.push({ title: c.title, message });
                    continue;
                }
                const rows = Array.isArray((res as { create?: unknown } | null)?.create) ? ((res as { create: WooJson[] }).create) : [];
                rows.forEach((row, i) => {
                    const c = chunk[i];
                    const err = row?.error as { message?: unknown } | undefined;
                    if (err || !(Number(row?.id) > 0)) {
                        result.failed.push({ title: c?.title ?? title, message: stripTags(String(err?.message ?? 'La tienda la rechazó.')) });
                        return;
                    }
                    created.push({ parentId: String(Number(p.id)), obj: row });
                    items.push({
                        externalId: String(row.id),
                        parentExternalId: String(Number(p.id)),
                        title: c?.title ?? variationTitle(p, row),
                        before: { __created: false },
                        after: { __created: true, date_modified: modifiedAt(row) },
                    });
                });
            }
        }
        result.created = created.length;
        await this.history.addItems(tenantId, result.edit_id, items);
        if (created.length > 0) {
            await this.engine.applyStoreObjects(tenantId, ctx.syncId, ctx.creds, touchedProducts, created);
            await this.audit.log({
                tenantId,
                userId: actor.userId,
                action: 'store_sync.create_variations',
                targetType: 'list',
                targetId: ctx.listId,
                targetLabel: ctx.listName,
                meta: { created: created.length, products: touchedProducts.length, failed: result.failed.length },
            });
        }
        return result;
    }

    private async revertCreatePreview(tenantId: number, _actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const ctx = await this.context(tenantId, String(edit.listId));
        const fresh = await this.freshObjects(ctx.creds, items);
        const out: BulkRevertPreview = { edit_id: edit.id, total: items.length, item_ids: [], conflict_ids: [], conflicts: [], missing: 0, sample: [] };
        for (const item of items) {
            const obj = fresh.get(itemKey(item));
            if (!obj) {
                out.missing++;
                continue;
            }
            if (modifiedAt(obj) !== String(item.after.date_modified ?? '')) {
                out.conflict_ids.push(item.id);
                if (out.conflicts.length < 50) out.conflicts.push({ item_id: item.id, title: item.title, message: 'Se modificó en la tienda después de crearla.' });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < 15) out.sample.push({ item_id: item.id, title: item.title, changes: [{ label: 'Variación', before: 'Creada', after: 'Se elimina de la tienda' }] });
        }
        return out;
    }

    private async revertCreateApply(tenantId: number, actor: Actor, edit: BulkEditHeader, items: BulkItemRow[], force: boolean): Promise<BulkRevertResult> {
        const ctx = await this.context(tenantId, String(edit.listId));
        const fresh = await this.freshObjects(ctx.creds, items);
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const byParent = new Map<string, BulkItemRow[]>();
        for (const item of items) {
            const obj = fresh.get(itemKey(item));
            if (!obj) {
                result.failed.push({ item_id: item.id, title: item.title, message: 'Ya no existe en la tienda.' });
                continue;
            }
            if (!force && modifiedAt(obj) !== String(item.after.date_modified ?? '')) {
                result.conflicts++;
                continue;
            }
            byParent.set(item.parentExternalId!, [...(byParent.get(item.parentExternalId!) ?? []), item]);
        }
        const done: number[] = [];
        for (const [parentId, list] of byParent) {
            for (const chunk of chunks(list, BATCH_SIZE)) {
                try {
                    const res = await wooSend(ctx.creds, 'POST', `/products/${Number(parentId)}/variations/batch`, { delete: chunk.map((i) => Number(i.externalId)) });
                    const rows = Array.isArray((res as { delete?: unknown } | null)?.delete) ? ((res as { delete: WooJson[] }).delete) : [];
                    const ok = new Set(rows.filter((r) => !r?.error && Number(r?.id) > 0).map((r) => String(Number(r.id))));
                    for (const i of chunk) {
                        if (ok.has(String(Number(i.externalId)))) done.push(i.id);
                        else result.failed.push({ item_id: i.id, title: i.title, message: 'La tienda no la borró.' });
                    }
                } catch (err) {
                    for (const i of chunk) result.failed.push({ item_id: i.id, title: i.title, message: err instanceof Error ? err.message : String(err) });
                }
            }
        }
        result.reverted = done.length;
        await this.history.markReverted(tenantId, actor, edit.id, done);
        if (done.length > 0) {
            // Releer los productos: sus variaciones borradas salen de la lista.
            const parents = await this.fetchProducts(ctx.creds, [...byParent.keys()]);
            await this.engine.applyStoreObjects(tenantId, ctx.syncId, ctx.creds, parents, []);
        }
        return result;
    }

    // ── Deshacer (v0.1.218) ────────────────────────────────────────────────

    private async revertPreview(tenantId: number, _actor: Actor, edit: BulkEditHeader, items: BulkItemRow[]): Promise<BulkRevertPreview> {
        const ctx = await this.context(tenantId, String(edit.listId));
        const fresh = await this.freshObjects(ctx.creds, items);
        const out: BulkRevertPreview = { edit_id: edit.id, total: items.length, item_ids: [], conflict_ids: [], conflicts: [], missing: 0, sample: [] };
        for (const item of items) {
            const obj = fresh.get(itemKey(item));
            if (!obj) {
                out.missing++;
                continue;
            }
            const drift = storeDrift(obj, item.after);
            if (drift) {
                out.conflict_ids.push(item.id);
                if (out.conflicts.length < 50) out.conflicts.push({ item_id: item.id, title: item.title, message: drift });
                continue;
            }
            out.item_ids.push(item.id);
            if (out.sample.length < 15) {
                out.sample.push({
                    item_id: item.id,
                    title: item.title,
                    changes: Object.keys(item.before).map((key) => ({
                        label: STORE_FIELD_LABEL[key] ?? key,
                        before: showStore(item.after[key]),
                        after: showStore(item.before[key]),
                    })),
                });
            }
        }
        return out;
    }

    private async revertApply(
        tenantId: number,
        actor: Actor,
        edit: BulkEditHeader,
        items: BulkItemRow[],
        force: boolean,
    ): Promise<BulkRevertResult> {
        const ctx = await this.context(tenantId, String(edit.listId));
        const fresh = await this.freshObjects(ctx.creds, items);
        const result: BulkRevertResult = { reverted: 0, conflicts: 0, failed: [] };
        const products: Array<{ id: number; title: string; body: Record<string, unknown>; itemId: number }> = [];
        const variations = new Map<string, Array<{ id: number; title: string; body: Record<string, unknown>; itemId: number }>>();
        for (const item of items) {
            const obj = fresh.get(itemKey(item));
            if (!obj) {
                result.failed.push({ item_id: item.id, title: item.title, message: 'Ya no existe en la tienda.' });
                continue;
            }
            if (!force && storeDrift(obj, item.after)) {
                result.conflicts++;
                continue;
            }
            const entry = { id: Number(item.externalId), title: item.title, body: revertBody(item.before), itemId: item.id };
            if (item.parentExternalId) variations.set(item.parentExternalId, [...(variations.get(item.parentExternalId) ?? []), entry]);
            else products.push(entry);
        }
        const tmp: StoreBulkResult = { updated: 0, unchanged: 0, failed: [], skipped: [], edit_id: null };
        const done: number[] = [];
        const writtenProducts: WooJson[] = [];
        const writtenVariations: Array<{ parentId: string; obj: WooJson }> = [];
        for (const chunk of chunks(products, BATCH_SIZE)) {
            const ok = await this.batch(ctx.creds, '/products/batch', chunk, tmp);
            const okIds = new Set(ok.map((o) => Number(o.id)));
            for (const e of chunk) if (okIds.has(e.id)) done.push(e.itemId);
            writtenProducts.push(...ok);
        }
        for (const [parentId, list] of variations) {
            for (const chunk of chunks(list, BATCH_SIZE)) {
                const ok = await this.batch(ctx.creds, `/products/${Number(parentId)}/variations/batch`, chunk, tmp);
                const okIds = new Set(ok.map((o) => Number(o.id)));
                for (const e of chunk) if (okIds.has(e.id)) done.push(e.itemId);
                writtenVariations.push(...ok.map((obj) => ({ parentId, obj })));
            }
        }
        const titleToItem = new Map(items.map((i) => [i.title, i.id]));
        for (const f of tmp.failed) result.failed.push({ item_id: titleToItem.get(f.title) ?? 0, title: f.title, message: f.message });
        result.reverted = done.length;
        await this.history.markReverted(tenantId, actor, edit.id, done);
        if (done.length > 0) await this.engine.applyStoreObjects(tenantId, ctx.syncId, ctx.creds, writtenProducts, writtenVariations);
        return result;
    }

    /** Los productos y variaciones de las filas, leídos AHORA de la tienda. */
    private async freshObjects(creds: IntegrationCreds, items: BulkItemRow[]): Promise<Map<string, WooJson>> {
        const out = new Map<string, WooJson>();
        const productIds = items.filter((i) => !i.parentExternalId && i.externalId).map((i) => i.externalId!);
        for (const p of await this.fetchProducts(creds, [...new Set(productIds)])) out.set(`:${Number(p.id)}`, p);
        const byParent = groupBy(
            items.filter((i) => i.parentExternalId && i.externalId),
            (i) => i.parentExternalId!,
        );
        for (const [parentId, list] of byParent) {
            for (const chunk of chunks([...new Set(list.map((i) => i.externalId!))], WOO_PAGE_SIZE)) {
                const res = await wooGetPage(creds, `/products/${Number(parentId)}/variations`, [
                    ['include', chunk.join(',')],
                    ['per_page', String(WOO_PAGE_SIZE)],
                ]).catch(() => null);
                for (const v of res?.rows ?? []) out.set(`${parentId}:${Number(v.id)}`, v);
            }
        }
        return out;
    }

    // ── Detalles ────────────────────────────────────────────────────────────

    private async batch(
        creds: IntegrationCreds,
        path: string,
        items: Array<{ id: number; title: string; body: Record<string, unknown> }>,
        result: StoreBulkResult,
    ): Promise<WooJson[]> {
        let res: unknown;
        try {
            res = await wooSend(creds, 'POST', path, { update: items.map((i) => ({ id: i.id, ...i.body })) });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            for (const i of items) result.failed.push({ title: i.title, message });
            return [];
        }
        const list = Array.isArray((res as { update?: unknown } | null)?.update) ? ((res as { update: unknown[] }).update as WooJson[]) : [];
        const byId = new Map(items.map((i) => [i.id, i.title]));
        const ok: WooJson[] = [];
        for (const row of list) {
            const err = row?.error as { message?: unknown } | undefined;
            if (err) {
                result.failed.push({ title: byId.get(Number(row.id)) ?? `#${row.id}`, message: stripTags(String(err.message ?? 'La tienda lo rechazó.')) });
            } else if (Number(row?.id) > 0) {
                ok.push(row);
            }
        }
        return ok;
    }

    /**
     * v0.1.223 — El valor de la columna de la app que usa `price_from_field`
     * para cada producto/variación (por su vínculo con el registro). Se lee con
     * el alcance de la persona; una columna que no existe o no es numérica es
     * un error, no un «sin valor» silencioso.
     */
    private async sourceValues(
        tenantId: number,
        actor: Actor,
        ctx: StoreCtx,
        operations: StoreBulkOperation[],
        objs: Array<{ kind: BulkItemKind; obj: WooJson }>,
    ): Promise<{ of: (kind: BulkItemKind, obj: WooJson) => Pick<BulkPlanContext, 'source' | 'sourceLabel'> }> {
        const op = operations.find((o) => o.op === 'price_from_field');
        if (!op || op.op !== 'price_from_field') return { of: () => ({}) };
        const label = ctx.fieldLabels.get(op.field_id);
        const type = ctx.fieldTypes.get(op.field_id);
        if (!label || !type || !NUMERIC_SOURCE_TYPES.has(type)) {
            throw new BadRequestException({
                code: 'store_bulk_bad_source',
                message: 'La columna de la que se calcula el precio no existe en la lista o no es numérica.',
                data: { status: 400 },
            });
        }
        const ids = (resource: 'products' | 'variations') => [...new Set(objs.filter((o) => (o.kind === 'product') === (resource === 'products')).map((o) => String(Number(o.obj.id))))];
        const productIds = ids('products');
        const variationIds = ids('variations');
        const links = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ resource: syncLinks.resource, externalId: syncLinks.externalId, recordId: syncLinks.recordId })
                .from(syncLinks)
                .where(
                    and(
                        eq(syncLinks.syncId, ctx.syncId),
                        inArray(syncLinks.resource, ['products', 'variations']),
                        inArray(syncLinks.externalId, [...productIds, ...variationIds, '__none__']),
                    ),
                ),
        );
        const recordIds = [...new Set(links.map((l) => l.recordId))];
        const values = new Map<number, number | null>();
        if (recordIds.length > 0) {
            const loaded = await this.records.bulkRows(tenantId, actor, String(ctx.listId), { ids: recordIds }, recordIds.length);
            for (const r of loaded.rows) {
                const v = r.data[`f${op.field_id}`];
                const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
                values.set(r.id, Number.isFinite(n) ? n : null);
            }
        }
        const byKey = new Map(links.map((l) => [`${l.resource}:${l.externalId}`, values.get(l.recordId) ?? null]));
        return {
            of: (kind, obj) => ({
                source: byKey.get(`${kind === 'product' ? 'products' : 'variations'}:${String(Number(obj.id))}`) ?? null,
                sourceLabel: label,
            }),
        };
    }

    private isBlocked(ctx: StoreCtx, op: StoreBulkOperation): boolean {
        const col = BULK_OP_COLUMN[op.op];
        return !!col && ctx.editable !== null && !ctx.editable.has(col);
    }

    /**
     * Términos (categorías / etiquetas) de las operaciones, resueltos a ids de
     * la tienda. Al APLICAR se crean los que falten (igual que una edición a
     * mano); en la vista previa no se crea nada: los nuevos se muestran como
     * «(nueva)» con un id provisorio.
     */
    private async termsContext(ctx: StoreCtx, operations: StoreBulkOperation[], create: boolean): Promise<Omit<BulkPlanContext, 'kind'>> {
        const terms = { categories: new Map<string, number>(), tags: new Map<string, number>() };
        const termNames = new Map<number, string>();
        let provisional = -1;
        for (const taxonomy of ['categories', 'tags'] as const) {
            const values = [
                ...new Set(operations.flatMap((o) => (o.op === taxonomy ? o.values : []))),
            ];
            if (values.length === 0) continue;
            const known = await this.allPages(ctx.creds, `/products/${taxonomy}`, 10);
            const map = terms[taxonomy];
            for (const t of known) {
                const id = Number(t.id);
                map.set(String(t.slug ?? '').toLowerCase(), id);
                map.set(String(t.name ?? '').toLowerCase(), id);
                termNames.set(id, String(t.name ?? ''));
            }
            const missing = values.filter((v) => !map.has(v.toLowerCase()));
            const wantsCreate = operations.some((o) => o.op === taxonomy && o.mode !== 'remove');
            if (missing.length === 0 || !wantsCreate) continue;
            if (create) {
                const ids = await this.engine.resolveTerms(ctx.creds, taxonomy, missing, new Map(missing.map((m) => [m, m])));
                missing.forEach((m, i) => {
                    const id = ids[i];
                    if (id) {
                        map.set(m.toLowerCase(), id);
                        termNames.set(id, m);
                    }
                });
            } else {
                for (const m of missing) {
                    const id = provisional--;
                    map.set(m.toLowerCase(), id);
                    termNames.set(id, `${m} (nueva)`);
                }
            }
        }
        return { priceDecimals: ctx.priceDecimals, terms, termNames, editable: ctx.editable };
    }

    private async resolveTarget(
        tenantId: number,
        actor: Actor,
        ctx: StoreCtx,
        target: Parameters<RecordsService['bulkRows']>[3],
        cap: number,
    ): Promise<Target> {
        const loaded = await this.records.bulkRows(tenantId, actor, String(ctx.listId), target, cap);
        const recordIds = loaded.rows.map((r) => r.id);
        const tipoKey = ctx.settings.fields.products?.tipo ? `f${ctx.settings.fields.products.tipo}` : null;
        const dataById = new Map(loaded.rows.map((r) => [r.id, r.data]));
        if (recordIds.length === 0) return { recordIds, products: [], variations: [] };
        const links = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ resource: syncLinks.resource, externalId: syncLinks.externalId, parent: syncLinks.parentExternalId, recordId: syncLinks.recordId })
                .from(syncLinks)
                .where(
                    and(
                        eq(syncLinks.syncId, ctx.syncId),
                        inArray(syncLinks.recordId, recordIds),
                        inArray(syncLinks.resource, ['products', 'variations']),
                    ),
                ),
        );
        const products: Target['products'] = [];
        const variations: Target['variations'] = [];
        for (const l of links) {
            if (l.resource === 'products') {
                const tipo = tipoKey ? dataById.get(l.recordId)?.[tipoKey] : null;
                products.push({ id: l.externalId, variable: tipo === 'variable', recordId: l.recordId });
            } else if (l.parent) {
                variations.push({ id: l.externalId, parentId: l.parent, recordId: l.recordId });
            }
        }
        // Una variación cuyo producto también está elegido ya se edita con él.
        const parents = new Set(products.filter((p) => p.variable).map((p) => p.id));
        return { recordIds, products, variations: variations.filter((v) => !parents.has(v.parentId)) };
    }

    private async fetchProducts(creds: IntegrationCreds, ids: string[]): Promise<WooJson[]> {
        const out: WooJson[] = [];
        for (const chunk of chunks(ids, WOO_PAGE_SIZE)) {
            if (chunk.length === 0) continue;
            const res = await wooGetPage(creds, '/products', [
                ['include', chunk.join(',')],
                ['per_page', String(WOO_PAGE_SIZE)],
            ]);
            out.push(...res.rows);
        }
        return out;
    }

    private async allPages(creds: IntegrationCreds, path: string, maxPages: number): Promise<WooJson[]> {
        const out: WooJson[] = [];
        for (let page = 1; page <= maxPages; page++) {
            const res = await wooGetPage(creds, path, [
                ['per_page', String(WOO_PAGE_SIZE)],
                ['page', String(page)],
            ]);
            out.push(...res.rows);
            if (res.rows.length < WOO_PAGE_SIZE || (res.totalPages !== null && page >= res.totalPages)) break;
        }
        return out;
    }

    private async context(tenantId: number, listIdOrSlug: string): Promise<StoreCtx> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const marker = readStoreListMarker(list.settings);
        if (!marker || marker.role !== 'products') {
            throw new BadRequestException({
                code: 'not_store_products',
                message: 'La edición masiva de la tienda es para la lista de productos de una tienda.',
                data: { status: 400 },
            });
        }
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select()
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.connectionId, marker.connection_id)))
                .limit(1);
            return r ?? null;
        });
        if (!row) throw new NotFoundException({ code: 'store_sync_not_found', message: 'Esta tienda no se está sincronizando.', data: { status: 404 } });
        const settings = readSettings(row.settings);
        if (!settings.write_back) {
            throw new BadRequestException({
                code: 'store_write_back_off',
                message: 'Para editar la tienda desde la app activa «Editar desde la app» en los ajustes de la tienda.',
                data: { status: 400 },
            });
        }
        const found = await this.connectors.integrationCredsFor(tenantId, marker.connection_id);
        if (!found) throw new NotFoundException({ code: 'connection_not_found', message: 'La conexión con la tienda ya no existe.', data: { status: 404 } });
        const priceField = settings.fields.products?.precio_normal;
        const fields = await this.fields.listByListId(tenantId, list.id);
        const cfg = (fields.find((f) => f.id === priceField)?.config ?? {}) as { precision?: unknown; currency?: unknown };
        const editable = settings.editable.products ?? defaultStoreEditable('products');
        return {
            listId: list.id,
            listName: list.name,
            syncId: row.id,
            settings,
            creds: found.creds,
            priceDecimals: typeof cfg.precision === 'number' ? cfg.precision : 2,
            currency: typeof cfg.currency === 'string' ? cfg.currency : '',
            editable: new Set(editable),
            fieldLabels: new Map(fields.map((f) => [f.id, f.label])),
            fieldTypes: new Map(fields.map((f) => [f.id, f.type])),
        };
    }
}

/** Cuántas combinaciones da una especificación (para estimar sin leer la tienda). */
function variationCombosCount(spec: VariationsSpec): number {
    return spec.attributes.reduce((n, a) => n * new Set(a.options).size, 1);
}

/** Cuándo se modificó por última vez en la tienda (para detectar cambios posteriores). */
function modifiedAt(obj: WooJson): string {
    return String(obj.date_modified_gmt ?? obj.date_modified ?? '');
}

function itemKey(item: BulkItemRow): string {
    return `${item.parentExternalId ?? ''}:${Number(item.externalId)}`;
}

function showStore(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    if (Array.isArray(v)) {
        if (v.length === 0) return '—';
        return v
            .map((x) => {
                const e = (x ?? {}) as Record<string, unknown>;
                if ('options' in e) return `${String(e.name ?? `#${String(e.id)}`)}: ${Array.isArray(e.options) ? e.options.join(', ') : ''}`;
                if ('key' in e) return `${String(e.key)}=${String(e.value ?? '')}`;
                return `#${String(e.id)}`;
            })
            .join(' · ');
    }
    if (typeof v === 'object') {
        const d = v as Record<string, unknown>;
        if ('length' in d) return `${String(d.length || '—')} × ${String(d.width || '—')} × ${String(d.height || '—')}`;
        return JSON.stringify(v);
    }
    return String(v);
}

function variationTitle(parent: WooJson, v: WooJson): string {
    const attrs = variationAttributes(v);
    return `${String(parent.name ?? '')}${attrs ? ` — ${attrs}` : ` #${v.id}`}`.trim();
}

function chunks<T>(list: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
    const out = new Map<string, T[]>();
    for (const t of list) out.set(key(t), [...(out.get(key(t)) ?? []), t]);
    return out;
}

function stripTags(s: string): string {
    return s.replace(/<[^>]*>/g, '').trim();
}

export { WooApiError };
