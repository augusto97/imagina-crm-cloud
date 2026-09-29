import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    STORE_BULK_APPLY_CHUNK,
    STORE_BULK_MAX_TARGET,
    readStoreListMarker,
    defaultStoreEditable,
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
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { StoreSyncEngine } from './store-sync.engine';
import { readSettings, type SyncSettings } from './store-sync.types';
import { BULK_OP_COLUMN, planBulkUpdate, type BulkItemKind, type BulkPlanContext } from './woocommerce/woo-bulk';
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
}

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
export class StoreBulkService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly connectors: ConnectorsService,
        private readonly engine: StoreSyncEngine,
        private readonly audit: AuditService,
    ) {}

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
        const push = (title: string, kind: BulkItemKind, obj: WooJson) => {
            if (out.sample.length >= SAMPLE_ROWS) return;
            const plan = planBulkUpdate(operations, obj, { ...planCtx, kind });
            if (plan.changes.length === 0 && plan.notes.length === 0) {
                out.sample_unchanged++;
                return;
            }
            out.sample.push({ title, kind, changes: plan.changes, notes: plan.notes });
        };
        for (const p of productObjs) {
            push(String(p.name ?? `#${p.id}`), 'product', p);
            if (includeVariations && p.type === 'variable' && out.sample.length < SAMPLE_ROWS) {
                const vars = await wooGetPage(ctx.creds, `/products/${Number(p.id)}/variations`, [['per_page', '5']]).catch(() => null);
                for (const v of vars?.rows ?? []) push(variationTitle(p, v), 'variation', v);
            }
        }
        if (out.sample.length < SAMPLE_ROWS && t.variations.length > 0) {
            for (const [parentId, ids] of groupBy(t.variations.slice(0, 20), (v) => v.parentId)) {
                const res = await wooGetPage(ctx.creds, `/products/${Number(parentId)}/variations`, [
                    ['include', ids.map((v) => v.id).join(',')],
                    ['per_page', String(WOO_PAGE_SIZE)],
                ]).catch(() => null);
                for (const v of res?.rows ?? []) push(variationTitle({ name: `#${parentId}` }, v), 'variation', v);
            }
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
    ): Promise<StoreBulkResult> {
        const ctx = await this.context(tenantId, listIdOrSlug);
        const t = await this.resolveTarget(tenantId, actor, ctx, { ids }, STORE_BULK_APPLY_CHUNK);
        const planCtx = await this.termsContext(ctx, operations, true);
        const result: StoreBulkResult = { updated: 0, unchanged: 0, failed: [], skipped: [] };

        const products = await this.fetchProducts(ctx.creds, t.products.map((p) => p.id));
        const productUpdates: Array<{ id: number; title: string; body: Record<string, unknown> }> = [];
        const variationUpdates = new Map<string, Array<{ id: number; title: string; body: Record<string, unknown> }>>();
        const addPlan = (kind: BulkItemKind, obj: WooJson, title: string, parentId?: string) => {
            const plan = planBulkUpdate(operations, obj, { ...planCtx, kind });
            if (Object.keys(plan.body).length === 0) {
                if (plan.notes.length > 0) result.skipped.push({ title, reason: plan.notes.join(' ') });
                else result.unchanged++;
                return;
            }
            const entry = { id: Number(obj.id), title, body: plan.body };
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
                message: 'Para editar la tienda desde la app activá «Editar desde la app» en los ajustes de la tienda.',
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
        };
    }
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
