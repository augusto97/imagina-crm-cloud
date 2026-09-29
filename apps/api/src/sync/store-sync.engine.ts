import { Inject, Injectable, Logger } from '@nestjs/common';
import {
    validateFieldValue,
    type Field,
    type StoreMetaResource,
    type StoreSyncResource,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import type { Tx } from '../db/client';
import { connectionSyncs, records, relations, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import {
    metaResourceOf,
    readSettings,
    readState,
    type KeysetCursor,
    type MetaSeen,
    type SyncSettings,
    type SyncState,
} from './store-sync.types';
import { WOO_PAGE_SIZE, wooGetPage, wooSend } from './woocommerce/woo-fetch';
import { buildWriteBack, isVariationPayload, parseWooTopic, type WooHookResource } from './woocommerce/woo-hooks';
import {
    coerceMeta,
    customerFromOrder,
    mapCustomer,
    mapLineItems,
    mapOrder,
    mapProduct,
    mapVariation,
    metaSample,
    suggestMetaType,
    type ExtRef,
    type MappedItem,
    type WooJson,
} from './woocommerce/woo-map';

/**
 * Motor de sincronización con tiendas (v0.1.206, ADR-S24).
 *
 * Una corrida trae de la tienda lo que cambió (o TODO, la primera vez o si se
 * pide) y lo escribe en las listas del pack. Lo que no es obvio y por qué:
 *
 *  - **Actualizar, no duplicar**: cada registro traído queda vinculado a su id
 *    en la tienda (`sync_links`). La segunda vez que llega el mismo pedido se
 *    ACTUALIZA el registro; si alguien lo borró a mano, se vuelve a crear.
 *  - **Paginación por fecha de modificación, no por número de página**: si un
 *    pedido cambia mientras se recorre, con `page=N` se correría la lista y
 *    se saltearía otro. Acá cada página pide "modificados después del último
 *    que vi" (keyset); los empates del mismo segundo se deduplican por id.
 *  - **La importación inicial no dispara automatizaciones**: traer 10.000
 *    pedidos viejos no puede mandar 10.000 WhatsApps de "pedido nuevo". Desde
 *    la segunda corrida, un pedido nuevo o cambiado dispara las automatizaciones
 *    de la lista como cualquier registro.
 *  - **Lo de la tienda manda sobre sus campos, y SÓLO sobre ellos**: se pisan
 *    los datos que vienen de la tienda; un campo que la persona agregó a la
 *    lista (una nota, un responsable) nunca se toca.
 *  - **Un valor que no entra no rompe la fila**: un email mal escrito en la
 *    tienda deja ese campo vacío y un aviso, no un pedido sin importar.
 */

const LOCK_TTL_MS = 10 * 60 * 1000;
/** Barrido completo de clientes y variaciones: lo que la API no deja pedir "por cambios". */
const FULL_SWEEP_MS = 24 * 60 * 60 * 1000;
const MAX_WARNINGS = 20;
/** Tope de páginas por recurso y corrida: una tienda enorme sigue en la próxima. */
const MAX_PAGES_PER_RUN = 400;
const INSERT_CHUNK = 500;

export class SyncStopped extends Error {}

interface ListTarget {
    listId: number;
    fields: Map<number, Field>;
}

interface RunCtx {
    tenantId: number;
    syncId: number;
    actorId: number;
    settings: SyncSettings;
    state: SyncState;
    creds: IntegrationCreds;
    targets: Partial<Record<StoreSyncResource, ListTarget>>;
    /** La primera corrida no dispara automatizaciones (ver arriba). */
    dispatch: boolean;
    lockToken: string;
    warnings: Set<string>;
    touchedLists: Set<number>;
}

export interface RunOptions {
    full?: boolean;
    /** Limitar la corrida a estos recursos (p. ej. al mapear un campo de un plugin). */
    only?: StoreSyncResource[];
}

@Injectable()
export class StoreSyncEngine {
    private readonly logger = new Logger(StoreSyncEngine.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly fields: FieldsService,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
        private readonly activity: ActivityService,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    // ── Candado (una corrida a la vez por sincronización) ──────────────────

    private lockKey(syncId: number): string {
        return `storesync:lock:${syncId}`;
    }

    async acquire(syncId: number): Promise<string | null> {
        const token = randomBytes(12).toString('hex');
        const ok = await this.redis.set(this.lockKey(syncId), token, 'PX', LOCK_TTL_MS, 'NX');
        return ok === 'OK' ? token : null;
    }

    private async renew(ctx: RunCtx): Promise<void> {
        // Si el candado ya no es nuestro (expiró y otro lo tomó), paramos.
        const current = await this.redis.get(this.lockKey(ctx.syncId));
        if (current !== ctx.lockToken) throw new SyncStopped('Otra corrida tomó la sincronización.');
        await this.redis.pexpire(this.lockKey(ctx.syncId), LOCK_TTL_MS);
    }

    async release(syncId: number, token: string): Promise<void> {
        const current = await this.redis.get(this.lockKey(syncId));
        if (current === token) await this.redis.del(this.lockKey(syncId));
    }

    // ── Corrida ─────────────────────────────────────────────────────────────

    /**
     * Corre una sincronización. Devuelve `false` si otra corrida la tiene
     * tomada (el que llama decide si reintentar).
     */
    async run(
        tenantId: number,
        syncId: number,
        creds: IntegrationCreds,
        opts: RunOptions = {},
    ): Promise<boolean> {
        const token = await this.acquire(syncId);
        if (!token) return false;
        try {
            const loaded = await this.context(tenantId, syncId, creds, token);
            if (!loaded) return true;
            const { ctx, settings } = loaded;
            // Ni la importación inicial ni una resincronización COMPLETA
            // disparan automatizaciones: son puestas al día, no novedades.
            ctx.dispatch = ctx.state.initial_done && opts.full !== true;
            const startedAt = new Date().toISOString();
            await this.saveState(tenantId, syncId, {
                running: true,
                current: null,
                progress: {},
                last_run_at: startedAt,
                last_error: null,
            });
            const want = (r: StoreSyncResource) => !opts.only || opts.only.includes(r);
            let error: string | null = null;
            try {
                if (settings.resources.customers && want('customers')) await this.syncCustomers(ctx, opts.full === true);
                if (settings.resources.products && (want('products') || want('variations'))) {
                    await this.syncProducts(ctx, opts.full === true);
                }
                if (settings.resources.orders && (want('orders') || want('line_items'))) {
                    await this.syncOrders(ctx, opts.full === true);
                }
            } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                if (!(err instanceof SyncStopped)) {
                    this.logger.warn(`Sincronización #${syncId} (tenant ${tenantId}): ${error}`);
                }
            }
            const now = new Date();
            const patch: Record<string, unknown> = {
                running: false,
                current: null,
                warnings: [...ctx.warnings].slice(0, MAX_WARNINGS),
                meta: ctx.state.meta,
                cursors: ctx.state.cursors,
                customers_full_at: ctx.state.customers_full_at,
                variations_full_at: ctx.state.variations_full_at,
                products_full_at: ctx.state.products_full_at,
                last_error: error,
            };
            if (!error) {
                patch.initial_done = true;
                patch.last_success_at = now.toISOString();
            }
            await this.saveState(tenantId, syncId, patch);
            const minutes = settings.mode === 'realtime' ? 60 : settings.interval_minutes;
            await this.setNextRun(tenantId, syncId, new Date(now.getTime() + minutes * 60_000));
            for (const listId of ctx.touchedLists) this.realtime.records(tenantId, listId);
            return true;
        } finally {
            await this.release(syncId, token);
        }
    }

    /** Lo que necesita cualquier escritura: ajustes, estado y las listas destino con sus campos. */
    private async context(
        tenantId: number,
        syncId: number,
        creds: IntegrationCreds,
        lockToken: string,
    ): Promise<{ ctx: RunCtx; settings: SyncSettings } | null> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select()
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId)))
                .limit(1);
            return r ?? null;
        });
        if (!row) return null;
        const settings = readSettings(row.settings);
        const state = readState(row.state);
        const ctx: RunCtx = {
            tenantId,
            syncId,
            actorId: row.createdBy ?? 0,
            settings,
            state,
            creds,
            targets: await this.loadTargets(tenantId, settings),
            dispatch: state.initial_done,
            lockToken,
            warnings: new Set(),
            touchedLists: new Set(),
        };
        return { ctx, settings };
    }

    // ── Avisos en tiempo real (fase 3) ──────────────────────────────────────

    /**
     * Aplica UN aviso de la tienda (un pedido, producto o cliente que cambió).
     * No toma el candado de la corrida: cada escritura ya va con el candado de
     * Postgres de la sincronización, así un aviso y una corrida simultáneos no
     * duplican nada. Dispara automatizaciones (si la importación inicial ya
     * terminó): un aviso ES una novedad.
     */
    async applyHook(tenantId: number, syncId: number, creds: IntegrationCreds, topic: string, payload: WooJson): Promise<void> {
        const parsed = parseWooTopic(topic);
        if (!parsed) return;
        const loaded = await this.context(tenantId, syncId, creds, '');
        if (!loaded) return;
        const { ctx, settings } = loaded;
        const id = Number(payload.id);
        let error: string | null = null;
        try {
            if (!Number.isInteger(id) || id <= 0) return;
            if (parsed.event === 'deleted') {
                await this.applyDeletion(ctx, parsed.resource, payload);
            } else if (parsed.resource === 'order' && settings.resources.orders) {
                await this.upsertOrders(ctx, [payload]);
                // Una venta (o una cancelación que repone) mueve el stock de lo vendido.
                if (settings.resources.products) await this.refreshStock(ctx, [payload]);
            } else if (parsed.resource === 'customer' && settings.resources.customers) {
                await this.upsert(ctx, 'customers', [mapCustomer(payload)], {});
            } else if (parsed.resource === 'product' && settings.resources.products) {
                if (isVariationPayload(payload)) {
                    const parentId = String(Number(payload.parent_id));
                    const name = await this.productNameFromApp(ctx, parentId);
                    await this.upsert(ctx, 'variations', [mapVariation(payload, { id: Number(parentId), name }, this.inv(ctx))], {});
                } else {
                    await this.upsert(ctx, 'products', [mapProduct(payload, this.inv(ctx))], {});
                    // Un producto variable avisa como uno solo: sus variaciones se releen.
                    if (payload.type === 'variable') await this.syncVariationsOf(ctx, payload);
                }
            }
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Aviso ${topic} de la sincronización #${syncId}: ${error}`);
        }
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({
                    state: sql`jsonb_set(
                        ${connectionSyncs.state},
                        '{realtime}',
                        coalesce(${connectionSyncs.state}->'realtime', '{}'::jsonb) || jsonb_build_object(
                            'received', coalesce((${connectionSyncs.state}->'realtime'->>'received')::int, 0) + 1,
                            'last_received_at', ${new Date().toISOString()}::text,
                            'error', ${error}::text
                        )
                    )`,
                    updatedAt: new Date(),
                })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
        for (const listId of ctx.touchedLists) this.realtime.records(tenantId, listId);
    }

    /**
     * Borrado en la tienda: el registro NO se borra (los datos son de la
     * empresa, ADR-S09) — queda marcado en la papelera, como en la tienda.
     */
    private async applyDeletion(ctx: RunCtx, resource: WooHookResource, payload: WooJson): Promise<void> {
        const id = String(Number(payload.id));
        const trash = [{ value: 'trash', label: 'Papelera' }];
        if (resource === 'order') {
            await this.upsert(ctx, 'orders', [this.stub('orders', id, { estado: 'trash' }, { estado: trash })], { updateOnly: true });
        } else if (resource === 'product') {
            const variation = isVariationPayload(payload);
            await this.upsert(
                ctx,
                variation ? 'variations' : 'products',
                [this.stub(variation ? 'variations' : 'products', id, { estado: 'trash' }, { estado: trash })],
                { updateOnly: true },
            );
        }
        // Un cliente borrado en la tienda queda como está: sus compras siguen siendo suyas.
    }

    private stub(
        resource: StoreSyncResource,
        externalId: string,
        values: Record<string, unknown>,
        options: MappedItem['options'],
    ): MappedItem {
        return { resource, externalId, parentExternalId: null, values, relations: {}, options, meta: {} };
    }

    // ── Edición en los dos sentidos (fase 3) ─────────────────────────────────

    /**
     * Manda a la tienda lo que se cambió en un registro. Los valores se leen
     * AHORA (no los del momento del cambio): si la edición se revirtió, se
     * manda lo que la tienda ya tenía, que es inocuo. Lo que la tienda
     * devuelve se aplica sin disparar nada (puede normalizar un precio), y
     * el aviso que la tienda mande después no encuentra diferencias: así un
     * cambio nunca rebota en un bucle.
     */
    async push(
        tenantId: number,
        syncId: number,
        creds: IntegrationCreds,
        resource: StoreMetaResource,
        recordId: number,
        changedFieldIds: number[],
    ): Promise<{ sent: string[] } | null> {
        const loaded = await this.context(tenantId, syncId, creds, '');
        if (!loaded) return null;
        const { ctx, settings } = loaded;
        const found = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [link] = await tx
                .select({ externalId: syncLinks.externalId, parent: syncLinks.parentExternalId })
                .from(syncLinks)
                .where(and(eq(syncLinks.syncId, syncId), eq(syncLinks.resource, resource), eq(syncLinks.recordId, recordId)))
                // Un cliente con cuenta puede tener también su vínculo de invitada: manda la cuenta.
                .orderBy(sql`${syncLinks.externalId} LIKE 'id:%' DESC`)
                .limit(1);
            const [rec] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.id, recordId), isNull(records.deletedAt)))
                .limit(1);
            return link && rec ? { link, data: rec.data } : null;
        });
        if (!found) return null;
        const changed = new Set(changedFieldIds);
        const values: Record<string, unknown> = {};
        for (const [slug, fieldId] of Object.entries(settings.fields[resource] ?? {})) {
            if (changed.has(fieldId)) values[slug] = found.data[`f${fieldId}`] ?? null;
        }
        const seen = ctx.state.meta[resource] ?? {};
        const meta = Object.entries(settings.meta_map[resource] ?? {})
            .filter(([, fieldId]) => changed.has(fieldId))
            .map(([key, fieldId]) => ({ key, value: found.data[`f${fieldId}`] ?? null, sample: seen[key]?.sample ?? null }));
        const req = buildWriteBack({
            resource,
            externalId: found.link.externalId,
            parentExternalId: found.link.parent,
            changed: values,
            meta,
        });
        if (!req) return null;
        const res = await wooSend(creds, 'PUT', req.path, req.body);
        // La tienda devuelve el objeto como quedó: se aplica sin disparar nada.
        if (res && typeof res === 'object' && !Array.isArray(res)) {
            ctx.dispatch = false;
            const obj = res as WooJson;
            if (resource === 'orders') await this.upsert(ctx, 'orders', [mapOrder(obj, settings.store_url)], {});
            else if (resource === 'customers') await this.upsert(ctx, 'customers', [mapCustomer(obj)], {});
            else if (resource === 'products') await this.upsert(ctx, 'products', [mapProduct(obj, this.inv(ctx))], {});
            else {
                const name = await this.productNameFromApp(ctx, String(found.link.parent));
                await this.upsert(ctx, 'variations', [mapVariation(obj, { id: Number(found.link.parent), name }, this.inv(ctx))], {});
            }
            for (const listId of ctx.touchedLists) this.realtime.records(tenantId, listId);
        }
        return { sent: req.fields };
    }

    private async loadTargets(
        tenantId: number,
        settings: SyncSettings,
    ): Promise<Partial<Record<StoreSyncResource, ListTarget>>> {
        const out: Partial<Record<StoreSyncResource, ListTarget>> = {};
        for (const [resource, listId] of Object.entries(settings.lists) as Array<[StoreSyncResource, number]>) {
            try {
                const fields = await this.fields.listByListId(tenantId, listId);
                out[resource] = { listId, fields: new Map(fields.map((f) => [f.id, f])) };
            } catch {
                // La lista se borró: ese recurso deja de escribirse (sin romper el resto).
            }
        }
        return out;
    }

    async saveState(tenantId: number, syncId: number, patch: Record<string, unknown>): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({ state: sql`${connectionSyncs.state} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
    }

    private async setNextRun(tenantId: number, syncId: number, at: Date): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({ nextRunAt: at })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
    }

    private async progress(ctx: RunCtx, resource: StoreSyncResource, done: number, total: number | null): Promise<void> {
        ctx.state.progress[resource] = { done, total };
        await this.renew(ctx);
        await this.saveState(ctx.tenantId, ctx.syncId, {
            current: resource,
            progress: ctx.state.progress,
            meta: ctx.state.meta,
        });
    }

    // ── Clientes ────────────────────────────────────────────────────────────

    /**
     * La API de clientes no deja pedir "los que cambiaron": los NUEVOS se
     * detectan de arriba hacia abajo por id (se corta al encontrar una página
     * ya conocida) y los cambios de los existentes llegan en un barrido
     * completo diario —o al instante, con el modo en tiempo real—.
     */
    private async syncCustomers(ctx: RunCtx, forceFull: boolean): Promise<void> {
        const last = ctx.state.customers_full_at ? Date.parse(ctx.state.customers_full_at) : 0;
        const full = forceFull || !ctx.state.initial_done || Date.now() - last > FULL_SWEEP_MS;
        let done = 0;
        for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
            const res = await wooGetPage(ctx.creds, '/customers', [
                ['per_page', String(WOO_PAGE_SIZE)],
                ['page', String(page)],
                ['orderby', 'id'],
                ['order', full ? 'asc' : 'desc'],
            ]);
            const items = res.rows.map(mapCustomer);
            const outcome = await this.upsert(ctx, 'customers', items, {});
            done += items.length;
            await this.progress(ctx, 'customers', done, res.total);
            if (res.rows.length < WOO_PAGE_SIZE) break;
            if (!full && outcome.created === 0) break;
        }
        if (full) ctx.state.customers_full_at = new Date().toISOString();
    }

    // ── Productos y variaciones ─────────────────────────────────────────────

    private async syncProducts(ctx: RunCtx, forceFull: boolean): Promise<void> {
        const lastSweep = ctx.state.variations_full_at ? Date.parse(ctx.state.variations_full_at) : 0;
        const sweepVariations = forceFull || !ctx.state.initial_done || Date.now() - lastSweep > FULL_SWEEP_MS;
        // v0.1.208 — una vez por día se recorren TODOS los productos: un plugin
        // (ERP, POS, importador) puede cambiar el stock sin tocar la fecha de
        // modificación, y entonces el incremental nunca se enteraría.
        const lastProducts = ctx.state.products_full_at ? Date.parse(ctx.state.products_full_at) : 0;
        const sweepProducts = forceFull || !ctx.state.initial_done || Date.now() - lastProducts > FULL_SWEEP_MS;
        let done = 0;
        let variationsDone = 0;
        const variableSeen = new Set<string>();
        await this.keyset(ctx, 'products', sweepProducts, [], async (rows, remaining) => {
            // Con keyset la tienda informa lo que FALTA desde el cursor, no el total.
            const total = remaining === null ? null : done + remaining;
            await this.upsert(ctx, 'products', rows.map((p) => mapProduct(p, this.inv(ctx))), {});
            for (const p of rows) {
                if (p.type !== 'variable') continue;
                variableSeen.add(String(p.id));
                variationsDone += await this.syncVariationsOf(ctx, p);
            }
            done += rows.length;
            await this.progress(ctx, 'products', done, total);
            if (variationsDone > 0) await this.progress(ctx, 'variations', variationsDone, null);
        });
        // El stock de una variación puede cambiar sin tocar al producto padre
        // (una venta, un ajuste): una vez por día se recorren todas.
        if (sweepVariations) {
            const parents = await this.linkedParents(ctx);
            for (const parentId of parents) {
                if (variableSeen.has(parentId)) continue;
                variationsDone += await this.syncVariationsOf(ctx, { id: Number(parentId) }, true);
                await this.progress(ctx, 'variations', variationsDone, null);
            }
            ctx.state.variations_full_at = new Date().toISOString();
        }
        if (sweepProducts) ctx.state.products_full_at = new Date().toISOString();
    }

    /** Ids de productos padre de las variaciones ya vinculadas + productos variables vinculados. */
    private async linkedParents(ctx: RunCtx): Promise<string[]> {
        const target = ctx.targets.products;
        const tipoField = ctx.settings.fields.products?.tipo;
        return this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const fromVariations = await tx
                .selectDistinct({ id: syncLinks.parentExternalId })
                .from(syncLinks)
                .where(and(eq(syncLinks.syncId, ctx.syncId), eq(syncLinks.resource, 'variations')));
            const ids = new Set(fromVariations.map((r) => r.id).filter((v): v is string => !!v));
            if (target && tipoField) {
                const variable = await tx
                    .select({ id: syncLinks.externalId })
                    .from(syncLinks)
                    .innerJoin(records, eq(records.id, syncLinks.recordId))
                    .where(
                        and(
                            eq(syncLinks.syncId, ctx.syncId),
                            eq(syncLinks.resource, 'products'),
                            sql`${records.data}->>${`f${tipoField}`} = 'variable'`,
                        ),
                    );
                for (const r of variable) ids.add(r.id);
            }
            return [...ids];
        });
    }

    private inv(ctx: RunCtx) {
        return { lowStockDefault: ctx.settings.low_stock_amount };
    }

    /**
     * v0.1.208 — Re-lee el stock de lo que se vendió en estos pedidos. Es la
     * pieza que mantiene el INVENTARIO al día: una venta baja el stock de una
     * variación (talla, color) sin tocar la fecha del producto padre, así que el
     * incremental por fecha no se enteraría hasta el barrido diario. Pide los
     * productos de a 100 por `include=` y las variaciones por producto padre:
     * un puñado de requests aunque lleguen cientos de pedidos.
     */
    async refreshStock(ctx: RunCtx, orders: WooJson[]): Promise<void> {
        const productIds = new Set<number>();
        const variationsByParent = new Map<number, Set<number>>();
        for (const o of orders) {
            for (const raw of Array.isArray(o.line_items) ? o.line_items : []) {
                const l = raw && typeof raw === 'object' ? (raw as WooJson) : {};
                const pid = Number(l.product_id);
                const vid = Number(l.variation_id);
                if (!(pid > 0)) continue;
                if (vid > 0) {
                    if (!variationsByParent.has(pid)) variationsByParent.set(pid, new Set());
                    variationsByParent.get(pid)!.add(vid);
                } else {
                    productIds.add(pid);
                }
            }
        }
        const ids = [...productIds];
        for (let i = 0; i < ids.length; i += WOO_PAGE_SIZE) {
            const chunk = ids.slice(i, i + WOO_PAGE_SIZE);
            const res = await wooGetPage(ctx.creds, '/products', [
                ['include', chunk.join(',')],
                ['per_page', String(WOO_PAGE_SIZE)],
            ]);
            await this.upsert(ctx, 'products', res.rows.map((p) => mapProduct(p, this.inv(ctx))), {});
        }
        for (const [parentId, vids] of variationsByParent) {
            const name = await this.productNameFromApp(ctx, String(parentId));
            const list = [...vids];
            for (let i = 0; i < list.length; i += WOO_PAGE_SIZE) {
                let res;
                try {
                    res = await wooGetPage(ctx.creds, `/products/${parentId}/variations`, [
                        ['include', list.slice(i, i + WOO_PAGE_SIZE).join(',')],
                        ['per_page', String(WOO_PAGE_SIZE)],
                    ]);
                } catch (err) {
                    // Un producto que ya no existe no frena el resto.
                    if (err instanceof Error && /404/.test(err.message)) break;
                    throw err;
                }
                await this.upsert(
                    ctx,
                    'variations',
                    res.rows.map((v) => mapVariation(v, { id: parentId, name }, this.inv(ctx))),
                    {},
                );
            }
        }
    }

    /** Trae TODAS las variaciones de un producto variable. Devuelve cuántas. */
    async syncVariationsOf(ctx: RunCtx, parent: WooJson, fetchParent = false): Promise<number> {
        let product = parent;
        if (fetchParent || typeof parent.name !== 'string') {
            // Para el nombre de la variación («Camiseta — Rojo / M») hace falta el padre.
            const fromApp = await this.productNameFromApp(ctx, String(parent.id));
            product = { ...parent, name: fromApp ?? parent.name };
        }
        let count = 0;
        const seen: string[] = [];
        for (let page = 1; page <= 50; page++) {
            let res;
            try {
                res = await wooGetPage(ctx.creds, `/products/${Number(parent.id)}/variations`, [
                    ['per_page', String(WOO_PAGE_SIZE)],
                    ['page', String(page)],
                ]);
            } catch (err) {
                // Un producto que dejó de existir no frena el resto.
                if (err instanceof Error && /404/.test(err.message)) return count;
                throw err;
            }
            const items = res.rows.map((v) => mapVariation(v, product, this.inv(ctx)));
            seen.push(...items.map((i) => i.externalId));
            await this.upsert(ctx, 'variations', items, {});
            count += items.length;
            if (res.rows.length < WOO_PAGE_SIZE) break;
        }
        // Variaciones que el producto ya no tiene (se borró una talla).
        await this.removeStaleChildren(ctx, 'variations', String(parent.id), seen);
        return count;
    }

    private async productNameFromApp(ctx: RunCtx, productId: string): Promise<string | null> {
        const nameField = ctx.settings.fields.products?.nombre;
        if (!nameField) return null;
        return this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [row] = await tx
                .select({ data: records.data })
                .from(syncLinks)
                .innerJoin(records, eq(records.id, syncLinks.recordId))
                .where(
                    and(
                        eq(syncLinks.syncId, ctx.syncId),
                        eq(syncLinks.resource, 'products'),
                        eq(syncLinks.externalId, productId),
                    ),
                )
                .limit(1);
            const v = row?.data[`f${nameField}`];
            return typeof v === 'string' ? v : null;
        });
    }

    // ── Pedidos y líneas ────────────────────────────────────────────────────

    private async syncOrders(ctx: RunCtx, forceFull: boolean): Promise<void> {
        const extra: Array<[string, string]> = [];
        if (ctx.settings.orders_since) extra.push(['after', `${ctx.settings.orders_since}T00:00:00`]);
        let done = 0;
        let lines = 0;
        await this.keyset(ctx, 'orders', forceFull, extra, async (rows, remaining) => {
            const total = remaining === null ? null : done + remaining;
            lines += await this.upsertOrders(ctx, rows);
            // Incremental: el stock de lo que se vendió cambió. En la importación
            // inicial no hace falta (los productos se acaban de traer enteros).
            if (ctx.dispatch && ctx.settings.resources.products) await this.refreshStock(ctx, rows);
            done += rows.length;
            await this.progress(ctx, 'orders', done, total);
            await this.progress(ctx, 'line_items', lines, null);
        });
    }

    /** Escribe una tanda de pedidos (con su cliente y sus líneas). Devuelve cuántas líneas. */
    async upsertOrders(ctx: RunCtx, rows: WooJson[]): Promise<number> {
        // 1) El cliente de cada pedido tiene que existir para vincularlo; si
        //    todavía no (un invitado, o un registrado que no llegó), se crea
        //    con los datos de facturación del pedido — SIN pisar uno existente.
        const guests = rows.map(customerFromOrder).filter((c): c is MappedItem => c !== null);
        await this.upsert(ctx, 'customers', dedupe(guests), { createOnly: true });
        // 2) Pedidos, 3) líneas.
        await this.upsert(ctx, 'orders', rows.map((o) => mapOrder(o, ctx.settings.store_url)), {});
        const lineItems = rows.flatMap(mapLineItems);
        await this.upsert(ctx, 'line_items', lineItems, {});
        // 4) Las líneas que un pedido ya no tiene (se editó el pedido).
        for (const o of rows) {
            const keep = lineItems.filter((l) => l.parentExternalId === String(o.id)).map((l) => l.externalId);
            await this.removeStaleChildren(ctx, 'line_items', String(o.id), keep);
        }
        return lineItems.length;
    }

    // ── Paginación por fecha de modificación (keyset) ───────────────────────

    private async keyset(
        ctx: RunCtx,
        resource: 'products' | 'orders',
        forceFull: boolean,
        extra: Array<[string, string]>,
        onPage: (rows: WooJson[], total: number | null) => Promise<void>,
    ): Promise<void> {
        let cursor: KeysetCursor | null = forceFull || !ctx.state.initial_done ? null : (ctx.state.cursors[resource] ?? null);
        let page = 1;
        // Una tienda vieja que IGNORA `modified_after` devolvería siempre las
        // mismas primeras filas: se detecta y se pasa a paginar por número.
        let plainPaging = false;
        for (let n = 0; n < MAX_PAGES_PER_RUN; n++) {
            const query: Array<[string, string]> = [
                ['per_page', String(WOO_PAGE_SIZE)],
                ['page', String(page)],
                ['orderby', 'modified'],
                ['order', 'asc'],
                ['dates_are_gmt', 'true'],
                ...extra,
            ];
            // `modified_after` es EXCLUSIVO y la API compara por segundo: se
            // pide desde un segundo antes y los ya vistos se descartan por id.
            if (cursor) query.push(['modified_after', minusOneSecond(cursor.at)]);
            const res = await wooGetPage(ctx.creds, `/${resource}`, query);
            if (cursor && !plainPaging && res.rows.some((r) => gmt(r) !== '' && gmt(r) < minusOneSecond(cursor!.at))) {
                plainPaging = true;
            }
            const fresh = res.rows.filter(
                (r) => !(cursor && gmt(r) === cursor.at && cursor.ids.includes(String(r.id))),
            );
            if (fresh.length > 0) await onPage(fresh, res.total);
            // Avance del cursor (se guarda por página: una corrida cortada sigue desde acá).
            const maxAt = res.rows.reduce<string>((m, r) => (gmt(r) > m ? gmt(r) : m), cursor?.at ?? '');
            if (plainPaging) {
                page += 1;
                if (maxAt !== '' && (!cursor || maxAt > cursor.at)) {
                    cursor = { at: maxAt, ids: res.rows.filter((r) => gmt(r) === maxAt).map((r) => String(r.id)) };
                }
            } else if (maxAt !== '' && (!cursor || maxAt > cursor.at)) {
                cursor = { at: maxAt, ids: res.rows.filter((r) => gmt(r) === maxAt).map((r) => String(r.id)) };
                page = 1;
            } else if (cursor && maxAt === cursor.at) {
                // Página entera en el mismo segundo: se agregan y se pasa de página.
                cursor = { at: cursor.at, ids: [...new Set([...cursor.ids, ...res.rows.map((r) => String(r.id))])] };
                page += 1;
            }
            ctx.state.cursors[resource] = cursor;
            await this.saveState(ctx.tenantId, ctx.syncId, { cursors: ctx.state.cursors });
            if (res.rows.length < WOO_PAGE_SIZE) break;
        }
    }

    // ── Escritura ───────────────────────────────────────────────────────────

    /**
     * Escribe una tanda de un recurso: crea lo nuevo, actualiza lo que cambió,
     * vincula relaciones y registra la meta vista. Todo en UNA transacción,
     * con un candado de Postgres por sincronización: una corrida y un aviso en
     * tiempo real que llegan juntos no crean el mismo pedido dos veces.
     */
    async upsert(
        ctx: RunCtx,
        resource: StoreSyncResource,
        items: MappedItem[],
        /**
         * `createOnly`: no pisar lo que ya existe (el cliente armado desde un pedido).
         * `updateOnly`: no crear (un aviso de borrado de algo que nunca se trajo).
         */
        opts: { createOnly?: boolean; updateOnly?: boolean },
    ): Promise<{ created: number; updated: number }> {
        const target = ctx.targets[resource];
        this.recordMeta(ctx, resource, items);
        if (!target || items.length === 0) return { created: 0, updated: 0 };
        await this.ensureOptions(ctx, resource, target, items);

        const fieldMap = ctx.settings.fields[resource] ?? {};
        const metaMap = ctx.settings.meta_map[metaResourceOf(resource) ?? ('products' as StoreMetaResource)] ?? {};
        const useMeta = metaResourceOf(resource) !== null;

        // Límite de registros del plan (SEC-09): se cuenta lo NUEVO antes de escribir.
        const known = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            this.existingLinks(tx, ctx, resource, items.map((i) => i.externalId)),
        );
        const newCount = opts.updateOnly ? 0 : items.filter((i) => !known.has(i.externalId)).length;
        if (newCount > 0) {
            try {
                await this.billing.assertCanCreateRecords(ctx.tenantId, newCount);
            } catch {
                throw new SyncStopped(
                    'Se llegó al límite de registros de tu plan: la sincronización se detuvo. Subí de plan o acotá qué se trae (por ejemplo, pedidos desde una fecha).',
                );
            }
        }

        const result = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${ctx.syncId})`);
            if (resource === 'customers') await this.adoptGuests(tx, ctx, items);
            const links = await this.existingLinks(tx, ctx, resource, items.map((i) => i.externalId));
            const recordIds = [...new Set([...links.values()])];
            const current = recordIds.length
                ? await tx
                      .select({ id: records.id, data: records.data })
                      .from(records)
                      .where(
                          and(
                              eq(records.tenantId, ctx.tenantId),
                              inArray(records.id, recordIds),
                              isNull(records.deletedAt),
                          ),
                      )
                : [];
            const byId = new Map(current.map((r) => [r.id, r.data]));

            const toCreate: Array<{ item: MappedItem; data: Record<string, unknown> }> = [];
            const toUpdate: Array<{ item: MappedItem; id: number; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
            const untouched: Array<{ item: MappedItem; id: number }> = [];
            for (const item of items) {
                const data = this.buildData(ctx, target, fieldMap, useMeta ? metaMap : {}, item);
                const linked = links.get(item.externalId);
                const before = linked !== undefined ? byId.get(linked) : undefined;
                if (linked !== undefined && before) {
                    if (opts.createOnly) {
                        untouched.push({ item, id: linked });
                        continue;
                    }
                    const after = { ...before, ...data };
                    if (Object.keys(data).some((k) => !sameValue(before[k], data[k]))) {
                        toUpdate.push({ item, id: linked, before, after });
                    } else {
                        untouched.push({ item, id: linked });
                    }
                } else if (!opts.updateOnly) {
                    toCreate.push({ item, data });
                }
            }

            // Altas en bloque.
            const created: Array<{ item: MappedItem; id: number; data: Record<string, unknown> }> = [];
            for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
                const chunk = toCreate.slice(i, i + INSERT_CHUNK);
                const rows = await tx
                    .insert(records)
                    .values(
                        chunk.map((c) => ({
                            tenantId: ctx.tenantId,
                            listId: target.listId,
                            data: c.data,
                            createdBy: ctx.actorId,
                        })),
                    )
                    .returning({ id: records.id });
                rows.forEach((r, j) => created.push({ item: chunk[j]!.item, id: r.id, data: chunk[j]!.data }));
            }
            if (created.length > 0) {
                await tx
                    .insert(syncLinks)
                    .values(
                        created.map((c) => ({
                            tenantId: ctx.tenantId,
                            syncId: ctx.syncId,
                            resource,
                            externalId: c.item.externalId,
                            parentExternalId: c.item.parentExternalId,
                            recordId: c.id,
                        })),
                    )
                    .onConflictDoUpdate({
                        target: [syncLinks.syncId, syncLinks.resource, syncLinks.externalId],
                        set: {
                            recordId: sql`excluded.record_id`,
                            parentExternalId: sql`excluded.parent_external_id`,
                            updatedAt: new Date(),
                        },
                    });
            }

            // Cambios, uno por fila (sólo los que de verdad cambiaron).
            for (const u of toUpdate) {
                await tx
                    .update(records)
                    .set({ data: u.after, updatedAt: new Date() })
                    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, u.id)));
                if (ctx.dispatch) {
                    await this.activity.logInTx(tx, {
                        tenantId: ctx.tenantId,
                        listId: target.listId,
                        recordId: u.id,
                        userId: null,
                        action: 'record_updated',
                        diff: computeDiff(u.before, u.after),
                    });
                }
            }

            // Relaciones (a registros de la tienda ya vinculados).
            const all = [
                ...created.map((c) => ({ item: c.item, id: c.id, isNew: true })),
                ...toUpdate.map((u) => ({ item: u.item, id: u.id, isNew: false })),
                ...untouched.filter(() => !opts.createOnly).map((u) => ({ item: u.item, id: u.id, isNew: false })),
            ];
            await this.writeRelations(tx, ctx, resource, target, fieldMap, all);
            return { created, toUpdate };
        });

        if (result.created.length > 0 || result.toUpdate.length > 0) ctx.touchedLists.add(target.listId);
        if (ctx.dispatch) {
            for (const c of result.created) {
                this.automations.dispatch({
                    tenantId: ctx.tenantId,
                    listId: target.listId,
                    recordId: c.id,
                    trigger: 'record_created',
                    after: c.data,
                });
            }
            for (const u of result.toUpdate) {
                this.automations.dispatch({
                    tenantId: ctx.tenantId,
                    listId: target.listId,
                    recordId: u.id,
                    trigger: 'record_updated',
                    after: u.after,
                    before: u.before,
                });
            }
        }
        return { created: result.created.length, updated: result.toUpdate.length };
    }

    private async existingLinks(tx: Tx, ctx: RunCtx, resource: StoreSyncResource, ids: string[]): Promise<Map<string, number>> {
        if (ids.length === 0) return new Map();
        const rows = await tx
            .select({ externalId: syncLinks.externalId, recordId: syncLinks.recordId })
            .from(syncLinks)
            .where(
                and(
                    eq(syncLinks.syncId, ctx.syncId),
                    eq(syncLinks.resource, resource),
                    inArray(syncLinks.externalId, [...new Set(ids)]),
                ),
            );
        return new Map(rows.map((r) => [r.externalId, r.recordId]));
    }

    /**
     * Una misma persona puede llegar por dos claves: `email:x` (compró como
     * invitada) e `id:N` (su cuenta). Las dos quedan apuntando al MISMO
     * registro —dos vínculos, un registro—, así no aparece dos veces con las
     * compras repartidas:
     *  - llega la cuenta y ya había un registro de invitada con ese email →
     *    la cuenta adopta ese registro;
     *  - llega una compra como invitada de alguien que ya tiene cuenta (no
     *    inició sesión) → la compra va al registro de la cuenta.
     * Se conserva el vínculo por email porque los pedidos viejos de invitada
     * siguen diciendo `email:x`: renombrarlo haría que la próxima vuelta
     * completa creara a la invitada de nuevo.
     */
    private async adoptGuests(tx: Tx, ctx: RunCtx, items: MappedItem[]): Promise<void> {
        const emailField = ctx.settings.fields.customers?.email;
        if (!emailField) return;
        const byKey = new Map<string, string>();
        for (const item of items) {
            const email = typeof item.values.email === 'string' ? item.values.email.trim().toLowerCase() : '';
            if (email !== '' && email.length <= 180) byKey.set(item.externalId, email);
        }
        if (byKey.size === 0) return;
        // Sólo importan las claves que todavía no tienen registro.
        const known = await this.existingLinks(tx, ctx, 'customers', [...byKey.keys()]);
        const missing = [...byKey.entries()].filter(([key]) => !known.has(key));
        if (missing.length === 0) return;
        const emails = [...new Set(missing.map(([, email]) => email))];
        // Registros de clientes de esta tienda con esos emails (una query por tanda).
        const found = await tx
            .select({ recordId: syncLinks.recordId, email: sql<string>`lower(${records.data}->>${`f${emailField}`})` })
            .from(syncLinks)
            .innerJoin(records, eq(records.id, syncLinks.recordId))
            .where(
                and(
                    eq(syncLinks.syncId, ctx.syncId),
                    eq(syncLinks.resource, 'customers'),
                    isNull(records.deletedAt),
                    inArray(sql`lower(${records.data}->>${`f${emailField}`})`, emails),
                ),
            );
        const recordByEmail = new Map<string, number>();
        for (const f of found) if (!recordByEmail.has(f.email)) recordByEmail.set(f.email, f.recordId);
        const rows = missing
            .map(([key, email]) => ({ key, recordId: recordByEmail.get(email) }))
            .filter((r): r is { key: string; recordId: number } => r.recordId !== undefined);
        if (rows.length === 0) return;
        await tx
            .insert(syncLinks)
            .values(
                rows.map((r) => ({
                    tenantId: ctx.tenantId,
                    syncId: ctx.syncId,
                    resource: 'customers',
                    externalId: r.key,
                    parentExternalId: null,
                    recordId: r.recordId,
                    updatedAt: new Date(),
                })),
            )
            .onConflictDoNothing();
    }

    /** slug del pack → `f{id}`, validando cada valor contra el campo REAL de hoy. */
    private buildData(
        ctx: RunCtx,
        target: ListTarget,
        fieldMap: Record<string, number>,
        metaMap: Record<string, number>,
        item: MappedItem,
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        const put = (field: Field, raw: unknown) => {
            const v = validateFieldValue({ type: field.type, config: field.config, is_required: false }, raw);
            if (v.ok) out[`f${field.id}`] = v.value;
            else ctx.warnings.add(`${field.label}: ${v.error} (valor «${String(raw).slice(0, 60)}»)`);
        };
        for (const [slug, raw] of Object.entries(item.values)) {
            if (raw === undefined) continue;
            const field = target.fields.get(fieldMap[slug] ?? -1);
            if (!field || !isDataField(field)) continue;
            put(field, raw);
        }
        for (const [key, fieldId] of Object.entries(metaMap)) {
            if (!(key in item.meta)) continue;
            const field = target.fields.get(fieldId);
            if (!field || !isDataField(field)) continue;
            const coerced = coerceMeta(item.meta[key], field.type);
            if (coerced === undefined) continue;
            put(field, coerced);
        }
        return out;
    }

    private async writeRelations(
        tx: Tx,
        ctx: RunCtx,
        resource: StoreSyncResource,
        target: ListTarget,
        fieldMap: Record<string, number>,
        rows: Array<{ item: MappedItem; id: number; isNew: boolean }>,
    ): Promise<void> {
        const relSlugs = new Set(rows.flatMap((r) => Object.keys(r.item.relations)));
        if (relSlugs.size === 0) return;
        // Targets por recurso, en una query por recurso.
        const wanted = new Map<StoreSyncResource, Set<string>>();
        for (const r of rows) {
            for (const ref of Object.values(r.item.relations)) {
                if (!ref) continue;
                if (!wanted.has(ref.resource)) wanted.set(ref.resource, new Set());
                wanted.get(ref.resource)!.add(ref.externalId);
            }
        }
        const resolved = new Map<string, number>();
        for (const [res, ids] of wanted) {
            const links = await this.existingLinks(tx, ctx, res, [...ids]);
            for (const [ext, rid] of links) resolved.set(`${res}:${ext}`, rid);
        }
        const refId = (ref: ExtRef | null) => (ref ? resolved.get(`${ref.resource}:${ref.externalId}`) : undefined);

        for (const slug of relSlugs) {
            const field = target.fields.get(fieldMap[slug] ?? -1);
            if (!field || field.type !== 'relation') continue;
            const existing = rows.filter((r) => !r.isNew).map((r) => r.id);
            if (existing.length > 0) {
                await tx
                    .delete(relations)
                    .where(
                        and(
                            eq(relations.tenantId, ctx.tenantId),
                            eq(relations.fieldId, field.id),
                            inArray(relations.sourceRecordId, existing),
                        ),
                    );
            }
            const values = rows
                .map((r) => ({ source: r.id, target: refId(r.item.relations[slug] ?? null) }))
                .filter((v): v is { source: number; target: number } => v.target !== undefined);
            if (values.length > 0) {
                await tx.insert(relations).values(
                    values.map((v) => ({
                        tenantId: ctx.tenantId,
                        fieldId: field.id,
                        sourceRecordId: v.source,
                        targetRecordId: v.target,
                        position: 0,
                    })),
                );
            }
        }
        void target;
    }

    /**
     * Categorías, etiquetas y estados que agrega un plugin: si no existen
     * como opción del select, se suman (si no, el valor no validaría y la
     * columna quedaría vacía).
     */
    private async ensureOptions(ctx: RunCtx, resource: StoreSyncResource, target: ListTarget, items: MappedItem[]): Promise<void> {
        const fieldMap = ctx.settings.fields[resource] ?? {};
        const wanted = new Map<string, Map<string, string>>();
        for (const it of items) {
            for (const [slug, opts] of Object.entries(it.options)) {
                if (!wanted.has(slug)) wanted.set(slug, new Map());
                for (const o of opts) wanted.get(slug)!.set(o.value, o.label);
            }
        }
        const palette = ['sky', 'violet', 'amber', 'emerald', 'rose', 'blue', 'orange', 'pink', 'teal', 'slate'];
        for (const [slug, values] of wanted) {
            const field = target.fields.get(fieldMap[slug] ?? -1);
            if (!field || (field.type !== 'select' && field.type !== 'multi_select')) continue;
            const current = Array.isArray(field.config.options) ? (field.config.options as Array<{ value: string }>) : [];
            const have = new Set(current.map((o) => o.value));
            const missing = [...values].filter(([v]) => !have.has(v));
            if (missing.length === 0) continue;
            const options = [
                ...current,
                ...missing.map(([value, label], i) => ({ value, label, color: palette[(current.length + i) % palette.length] })),
            ];
            try {
                const updated = await this.fields.update(ctx.tenantId, String(target.listId), String(field.id), {
                    config: { ...field.config, options },
                });
                target.fields.set(updated.id, updated);
            } catch (err) {
                ctx.warnings.add(`No se pudieron agregar opciones a «${field.label}»: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    /** Hijos que el padre ya no tiene (líneas de un pedido editado, tallas borradas). */
    private async removeStaleChildren(
        ctx: RunCtx,
        resource: 'line_items' | 'variations',
        parentId: string,
        keep: string[],
    ): Promise<void> {
        await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const stale = await tx
                .select({ externalId: syncLinks.externalId, recordId: syncLinks.recordId })
                .from(syncLinks)
                .where(
                    and(
                        eq(syncLinks.syncId, ctx.syncId),
                        eq(syncLinks.resource, resource),
                        eq(syncLinks.parentExternalId, parentId),
                    ),
                );
            const gone = stale.filter((s) => !keep.includes(s.externalId));
            if (gone.length === 0) return;
            await tx
                .update(records)
                .set({ deletedAt: new Date() })
                .where(and(eq(records.tenantId, ctx.tenantId), inArray(records.id, gone.map((g) => g.recordId))));
            await tx.delete(syncLinks).where(
                and(
                    eq(syncLinks.syncId, ctx.syncId),
                    eq(syncLinks.resource, resource),
                    inArray(syncLinks.externalId, gone.map((g) => g.externalId)),
                ),
            );
            const target = ctx.targets[resource];
            if (target) ctx.touchedLists.add(target.listId);
        });
    }

    /** Claves de `meta_data` vistas (para ofrecerlas como campos). */
    private recordMeta(ctx: RunCtx, resource: StoreSyncResource, items: MappedItem[]): void {
        const metaRes = metaResourceOf(resource);
        if (!metaRes) return;
        const seen: Record<string, MetaSeen> = ctx.state.meta[metaRes] ?? {};
        for (const it of items) {
            for (const [key, value] of Object.entries(it.meta)) {
                const cur = seen[key];
                if (!cur && Object.keys(seen).length >= 200) continue; // tope: un plugin que genera claves al azar
                const sample = metaSample(value);
                seen[key] = {
                    count: (cur?.count ?? 0) + 1,
                    sample: cur?.sample ?? sample,
                    type: cur?.type ?? suggestMetaType(value),
                };
            }
        }
        ctx.state.meta[metaRes] = seen;
    }
}

// ── Utilidades ─────────────────────────────────────────────────────────────

function gmt(row: WooJson): string {
    const v = row.date_modified_gmt;
    return typeof v === 'string' ? v.slice(0, 19) : '';
}

function minusOneSecond(at: string): string {
    const t = Date.parse(`${at}Z`);
    return Number.isFinite(t) ? new Date(t - 1000).toISOString().slice(0, 19) : at;
}

function isDataField(f: Field): boolean {
    return !['relation', 'computed', 'lookup', 'rollup'].includes(f.type);
}

function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

function dedupe(items: MappedItem[]): MappedItem[] {
    const seen = new Map<string, MappedItem>();
    for (const it of items) if (!seen.has(it.externalId)) seen.set(it.externalId, it);
    return [...seen.values()];
}

export type { RunCtx };
