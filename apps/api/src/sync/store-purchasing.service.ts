import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    type CreatePurchaseOrderInput,
    type PurchaseOrderCreated,
    type PurchasePreviewInput,
    type PurchasePreviewItem,
} from '@imagina-base/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';

import type { Tx } from '../db/client';
import { connectionSyncs, records, relations } from '../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import type { RecordChange } from '../records/record-change-hub';
import { RecordsService, type Actor } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { StockAdjustError, StoreSyncEngine } from './store-sync.engine';
import { StoreSyncQueue, type StorePurchaseJob } from './store-sync.queue';
import { StoreSyncService } from './store-sync.service';
import { readSettings, type SyncSettings } from './store-sync.types';
import { WooApiError } from './woocommerce/woo-fetch';
import { DEFAULT_LOW_STOCK } from './woocommerce/woo-map';

/**
 * Reposición (v0.1.209, ADR-S24): órdenes de compra a proveedores y «Sumar al
 * stock».
 *
 * Las tres listas de compras (proveedores, órdenes, líneas) son de la empresa,
 * no de la tienda. Lo que cruza a WooCommerce es el EFECTO: al recibir una
 * orden, las unidades se suman al stock de cada producto o variación. Lo que
 * no es obvio y por qué:
 *
 *  - **Recibir dos veces no suma dos veces**: cada línea guarda cuánto ya se
 *    sumó («Sumado al stock»). Recibir es llevar lo sumado hasta lo recibido;
 *    marcar de nuevo la orden como recibida, o corregir una cantidad, suma (o
 *    resta) sólo la diferencia.
 *  - **Se suma sobre el stock de la tienda en ese momento**, no sobre el de la
 *    app (ver `StoreSyncEngine.adjustStock`): una venta que todavía no llegó
 *    no se pisa.
 *  - **Una operación a la vez por tienda** (candado en Redis): recibir una
 *    orden mientras alguien edita una de sus líneas no puede sumar dos veces
 *    la misma diferencia.
 *  - **Lo que escribe este servicio no pasa por el aviso de cambios**: las
 *    columnas que mantiene (subtotal, pendiente, sumado, artículo) se escriben
 *    directo, así no se disparan a sí mismas en un bucle.
 *  - **«Sumar al stock» se RECLAMA antes de ir a la tienda**: la celda se
 *    vacía sólo si todavía tiene el mismo número, y recién entonces se suma.
 *    Un trabajo repetido encuentra la celda vacía y no hace nada.
 */

type Role = 'orders' | 'lines' | 'products' | 'variations';

interface PurchaseTarget {
    syncId: number;
    connectionId: number;
    role: Role;
    settings: SyncSettings;
}

interface PurchaseCtx {
    tenantId: number;
    syncId: number;
    settings: SyncSettings;
    /** Listas que cambiaron (se avisa por realtime al final). */
    touched: Set<number>;
}

const TARGETS_TTL_MS = 30_000;
const TARGETS_MISS_RELOAD_MS = 2_000;
const LOCK_TTL_MS = 120_000;
const LOCK_WAIT_MS = 30_000;
/** Estados en los que la orden ya se pidió pero no llegó entera. */
const OPEN = new Set(['enviada', 'recibida_parcial']);
/** Estados que suman al stock. */
const RECEIVING = new Set(['recibida_parcial', 'recibida']);
const MAX_RESULT_LINES = 30;

const k = (id: number | undefined): string => `f${id ?? 0}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

/** El objetivo de UNA línea al recibir: cuánto tiene que haber sumado. `null` = no se toca. */
export function receiveTarget(status: string, ordered: number | null, received: number | null): number | null {
    if (status === 'recibida') return Math.max(0, Math.trunc(received ?? ordered ?? 0));
    // «Recibida en parte»: sólo las líneas con la cantidad recibida escrita.
    if (status === 'recibida_parcial') return received === null ? null : Math.max(0, Math.trunc(received));
    return null;
}

/** Lo que falta llegar de una línea: sólo cuenta en una orden ya pedida y no cerrada. */
export function pendingOf(status: string, ordered: number | null, applied: number | null): number {
    if (!OPEN.has(status)) return 0;
    return Math.max(0, Math.trunc(ordered ?? 0) - Math.trunc(applied ?? 0));
}

/**
 * Cuánto pedir: un mes de venta (lo vendido en 30 días) más la alerta de
 * stock bajo como colchón, menos lo que hay y lo que ya viene en camino.
 * Nunca menos de 1 (si la persona eligió el artículo, quiere pedir algo).
 */
export function suggestQuantity(stock: number | null, inTransit: number, sold30d: number, threshold: number): number {
    const need = sold30d + threshold - (stock ?? 0) - inTransit;
    return Math.max(1, Math.ceil(need));
}

/** «OC-0007» → 7; cualquier otra cosa → null. */
export function orderSeq(numero: string): number | null {
    const m = /^OC-(\d{1,9})$/.exec(numero.trim());
    return m ? Number(m[1]) : null;
}

export class PurchasingBusy extends Error {}

@Injectable()
export class StorePurchasingService {
    private readonly logger = new Logger(StorePurchasingService.name);
    private readonly targets = new Map<number, { at: number; byList: Map<number, PurchaseTarget> }>();

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(REDIS) private readonly redis: Redis,
        private readonly engine: StoreSyncEngine,
        private readonly queue: StoreSyncQueue,
        private readonly realtime: RealtimeService,
        private readonly recordsSvc: RecordsService,
        private readonly sync: StoreSyncService,
    ) {}

    // ── Oyente de cambios ───────────────────────────────────────────────────

    /** Lo que cambió en una lista de compras (o en «Sumar al stock») se procesa en la cola. */
    async onRecordChange(change: RecordChange): Promise<void> {
        const target = await this.targetFor(change.tenantId, change.listId);
        if (!target) return;
        const base = { tenantId: change.tenantId, syncId: target.syncId };
        let job: StorePurchaseJob | null = null;
        if (target.role === 'lines') {
            job = { ...base, kind: 'line', recordId: change.recordId };
        } else if (target.role === 'orders') {
            const statusKey = k(target.settings.purchase_fields.orders?.estado);
            const changed = str(change.before[statusKey]) !== str(change.after[statusKey]);
            if (change.kind === 'created' || changed) job = { ...base, kind: 'order', recordId: change.recordId };
        } else {
            const key = k(target.settings.fields[target.role]?.sumar_stock);
            const delta = num(change.after[key]);
            if (delta !== null && delta !== 0 && Number.isInteger(delta) && num(change.before[key]) !== delta) {
                job = { ...base, kind: 'adjust', resource: target.role, recordId: change.recordId, delta };
            }
        }
        if (!job) return;
        // Sin cola (tests, sin Redis): se procesa en el acto.
        if (!this.queue.enqueuePurchase(job)) await this.process(job);
    }

    /** Qué listas de este tenant son de compras (o tienen «Sumar al stock»). Cache corta: se consulta en CADA edición. */
    /**
     * El caché de 30 s no puede esconder una tienda recién armada (o
     * actualizada): si el cambio viene de una lista que el caché no conoce, se
     * recarga — a lo sumo una vez cada `TARGETS_MISS_RELOAD_MS`, para que los
     * cambios de listas que no son de la tienda no consulten en cada guardado.
     */
    private async targetFor(tenantId: number, listId: number): Promise<PurchaseTarget | undefined> {
        const found = (await this.purchaseTargets(tenantId)).get(listId);
        if (found) return found;
        const hit = this.targets.get(tenantId);
        if (!hit || Date.now() - hit.at < TARGETS_MISS_RELOAD_MS) return undefined;
        return (await this.purchaseTargets(tenantId, true)).get(listId);
    }

    private async purchaseTargets(tenantId: number, fresh = false): Promise<Map<number, PurchaseTarget>> {
        const hit = this.targets.get(tenantId);
        if (!fresh && hit && Date.now() - hit.at < TARGETS_TTL_MS) return hit.byList;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connectionSyncs.id, connectionId: connectionSyncs.connectionId, settings: connectionSyncs.settings })
                .from(connectionSyncs)
                .where(eq(connectionSyncs.tenantId, tenantId)),
        );
        const byList = new Map<number, PurchaseTarget>();
        for (const row of rows) {
            const settings = readSettings(row.settings);
            const add = (listId: number | undefined, role: Role) => {
                if (listId) byList.set(listId, { syncId: row.id, connectionId: row.connectionId, role, settings });
            };
            add(settings.purchase_lists.orders, 'orders');
            add(settings.purchase_lists.lines, 'lines');
            if (settings.fields.products?.sumar_stock) add(settings.lists.products, 'products');
            if (settings.fields.variations?.sumar_stock) add(settings.lists.variations, 'variations');
        }
        this.targets.set(tenantId, { at: Date.now(), byList });
        return byList;
    }

    forget(tenantId: number): void {
        this.targets.delete(tenantId);
    }

    // ── Trabajos ────────────────────────────────────────────────────────────

    async process(job: StorePurchaseJob): Promise<void> {
        const ctx = await this.context(job.tenantId, job.syncId);
        if (!ctx) return;
        await this.withLock(job.syncId, async () => {
            if (job.kind === 'line') await this.onLine(ctx, job.recordId);
            else if (job.kind === 'order') await this.onOrder(ctx, job.recordId);
            else await this.adjustFromColumn(ctx, job.resource, job.recordId, job.delta);
        });
        this.flush(ctx);
    }

    private async context(tenantId: number, syncId: number): Promise<PurchaseCtx | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ settings: connectionSyncs.settings }).from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1),
        );
        if (!row) return null;
        return { tenantId, syncId, settings: readSettings(row.settings), touched: new Set() };
    }

    private flush(ctx: PurchaseCtx): void {
        for (const listId of ctx.touched) this.realtime.records(ctx.tenantId, listId);
        ctx.touched.clear();
    }

    /** Una operación de compras a la vez por tienda (ver arriba). */
    private async withLock<T>(syncId: number, fn: () => Promise<T>): Promise<T> {
        const key = `storepurch:lock:${syncId}`;
        const token = randomBytes(12).toString('hex');
        const deadline = Date.now() + LOCK_WAIT_MS;
        for (;;) {
            const ok = await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
            if (ok === 'OK') break;
            if (Date.now() > deadline) throw new PurchasingBusy('Otra operación de compras de esta tienda sigue en curso.');
            await sleep(150);
        }
        try {
            return await fn();
        } finally {
            if ((await this.redis.get(key)) === token) await this.redis.del(key);
        }
    }

    // ── Líneas ──────────────────────────────────────────────────────────────

    private async onLine(ctx: PurchaseCtx, lineId: number): Promise<void> {
        const r = await this.normalizeLine(ctx, lineId);
        // Una línea de una orden que ya se está recibiendo (le corrigieron la
        // cantidad recibida): se suma la diferencia.
        if (r && r.orderId && RECEIVING.has(r.status)) await this.receiveOrder(ctx, r.orderId);
    }

    /**
     * Completa lo que la app mantiene en una línea: el artículo (nombre del
     * producto o la variación vinculada), el producto padre de una variación,
     * el subtotal y lo pendiente de recibir. Escribe sólo si cambió.
     */
    private async normalizeLine(ctx: PurchaseCtx, lineId: number): Promise<{ orderId: number | null; status: string } | null> {
        const L = ctx.settings.purchase_fields.lines ?? {};
        const listId = ctx.settings.purchase_lists.lines;
        if (!listId || !L.orden) return null;
        return this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [line] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, lineId), eq(records.listId, listId), isNull(records.deletedAt)))
                .limit(1);
            if (!line) return null;
            const rel = await this.targetsOf(tx, ctx.tenantId, [lineId], [L.orden, L.producto, L.variacion]);
            const orderId = rel.get(`${lineId}:${L.orden}`)?.[0] ?? null;
            let productId = rel.get(`${lineId}:${L.producto}`)?.[0] ?? null;
            const variationId = rel.get(`${lineId}:${L.variacion}`)?.[0] ?? null;

            // Una variación sin su producto: se vincula el padre (así «En
            // camino» del producto suma también lo pedido por variación).
            const varProductRel = ctx.settings.fields.variations?.producto;
            if (variationId && !productId && L.producto && varProductRel) {
                const parent = (await this.targetsOf(tx, ctx.tenantId, [variationId], [varProductRel])).get(`${variationId}:${varProductRel}`)?.[0];
                if (parent) {
                    await tx
                        .insert(relations)
                        .values({ tenantId: ctx.tenantId, fieldId: L.producto, sourceRecordId: lineId, targetRecordId: parent })
                        .onConflictDoNothing();
                    productId = parent;
                }
            }

            const status = orderId ? await this.orderStatus(tx, ctx, orderId) : '';
            const data = line.data;
            const patch: Record<string, unknown> = {};
            // El artículo es el nombre de lo vinculado; sin vínculo, lo que escribió la persona.
            // (`nameOf` lee un campo de texto del vinculado: también sirve para el SKU.)
            const nameOf = async (id: number | null, nameField: number | undefined) => {
                if (!id || !nameField) return null;
                const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, id)).limit(1);
                const v = row?.data[k(nameField)];
                return typeof v === 'string' && v.trim() !== '' ? v : null;
            };
            const name =
                (await nameOf(variationId, ctx.settings.fields.variations?.nombre)) ??
                (await nameOf(productId, ctx.settings.fields.products?.nombre));
            if (L.articulo && name && data[k(L.articulo)] !== name) patch[k(L.articulo)] = name;
            // v0.1.210 — el SKU viaja a la línea: al proveedor se le pide por SKU.
            const sku =
                (await nameOf(variationId, ctx.settings.fields.variations?.sku)) ??
                (await nameOf(productId, ctx.settings.fields.products?.sku));
            if (L.sku && sku && data[k(L.sku)] !== sku) patch[k(L.sku)] = sku;

            const qty = num(data[k(L.cantidad)]);
            const cost = num(data[k(L.costo)]);
            if (L.subtotal) {
                const subtotal = qty !== null && cost !== null ? Math.round(qty * cost * 10_000) / 10_000 : null;
                if (num(data[k(L.subtotal)]) !== subtotal) patch[k(L.subtotal)] = subtotal;
            }
            if (L.pendiente) {
                const pending = pendingOf(status, qty, num(data[k(L.aplicada)]));
                if (num(data[k(L.pendiente)]) !== pending) patch[k(L.pendiente)] = pending;
            }
            if (Object.keys(patch).length > 0) {
                await this.patch(tx, ctx, lineId, data, patch);
                ctx.touched.add(listId);
                // El total y lo «por recibir» de la orden son rollups: se recalculan solos.
                if (ctx.settings.purchase_lists.orders) ctx.touched.add(ctx.settings.purchase_lists.orders);
                // «En camino» del producto/variación también es un rollup de lo pendiente.
                if (L.pendiente && k(L.pendiente) in patch) {
                    if (ctx.settings.lists.products) ctx.touched.add(ctx.settings.lists.products);
                    if (ctx.settings.lists.variations) ctx.touched.add(ctx.settings.lists.variations);
                }
            }
            return { orderId, status };
        });
    }

    // ── Órdenes ─────────────────────────────────────────────────────────────

    /**
     * Una orden nueva o que cambió de estado: se numera sola si no tiene
     * número, toma la fecha de hoy y la entrega esperada del proveedor, sus
     * líneas recalculan lo pendiente y, si se recibió, se suma al stock.
     */
    private async onOrder(ctx: PurchaseCtx, orderId: number): Promise<void> {
        await this.fillOrder(ctx, orderId);
        for (const lineId of await this.linesOf(ctx, orderId)) await this.normalizeLine(ctx, lineId);
        const status = await this.tenantDb.withTenant(ctx.tenantId, (tx) => this.orderStatus(tx, ctx, orderId));
        if (RECEIVING.has(status)) await this.receiveOrder(ctx, orderId);
    }

    private async fillOrder(ctx: PurchaseCtx, orderId: number): Promise<void> {
        const O = ctx.settings.purchase_fields.orders ?? {};
        const listId = ctx.settings.purchase_lists.orders;
        if (!listId) return;
        await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [row] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, orderId), isNull(records.deletedAt)))
                .limit(1);
            if (!row) return;
            const patch: Record<string, unknown> = {};
            if (O.numero && str(row.data[k(O.numero)]).trim() === '') patch[k(O.numero)] = await this.nextNumber(tx, ctx);
            const today = new Date().toISOString().slice(0, 10);
            const fecha = str(row.data[k(O.fecha)]) || today;
            if (O.fecha && str(row.data[k(O.fecha)]) === '') patch[k(O.fecha)] = today;
            if (O.entrega && str(row.data[k(O.entrega)]) === '' && O.proveedor) {
                const days = await this.supplierLeadDays(tx, ctx, orderId);
                if (days !== null) patch[k(O.entrega)] = addDays(fecha, days);
            }
            if (Object.keys(patch).length > 0) {
                await this.patch(tx, ctx, orderId, row.data, patch);
                ctx.touched.add(listId);
            }
        });
    }

    /** El próximo número libre «OC-0001» de la lista de órdenes. */
    private async nextNumber(tx: Tx, ctx: PurchaseCtx): Promise<string> {
        const O = ctx.settings.purchase_fields.orders ?? {};
        const [row] = await tx
            .select({
                n: sql<number | null>`max((substring(${records.data}->>${k(O.numero)} from '^OC-([0-9]{1,9})$'))::int)`,
            })
            .from(records)
            .where(and(eq(records.tenantId, ctx.tenantId), eq(records.listId, ctx.settings.purchase_lists.orders!)));
        return `OC-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
    }

    private async supplierLeadDays(tx: Tx, ctx: PurchaseCtx, orderId: number): Promise<number | null> {
        const O = ctx.settings.purchase_fields.orders ?? {};
        const S = ctx.settings.purchase_fields.suppliers ?? {};
        if (!O.proveedor || !S.entrega_dias) return null;
        const supplier = (await this.targetsOf(tx, ctx.tenantId, [orderId], [O.proveedor])).get(`${orderId}:${O.proveedor}`)?.[0];
        if (!supplier) return null;
        const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, supplier)).limit(1);
        const days = num(row?.data[k(S.entrega_dias)]);
        return days !== null && days >= 0 && days <= 3650 ? Math.trunc(days) : null;
    }

    private async orderStatus(tx: Tx, ctx: PurchaseCtx, orderId: number): Promise<string> {
        const O = ctx.settings.purchase_fields.orders ?? {};
        const [row] = await tx
            .select({ data: records.data })
            .from(records)
            .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, orderId), isNull(records.deletedAt)))
            .limit(1);
        return row ? str(row.data[k(O.estado)]) : '';
    }

    private async linesOf(ctx: PurchaseCtx, orderId: number): Promise<number[]> {
        const L = ctx.settings.purchase_fields.lines ?? {};
        if (!L.orden) return [];
        const rows = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .select({ id: relations.sourceRecordId })
                .from(relations)
                .innerJoin(records, eq(records.id, relations.sourceRecordId))
                .where(
                    and(
                        eq(relations.tenantId, ctx.tenantId),
                        eq(relations.fieldId, L.orden!),
                        eq(relations.targetRecordId, orderId),
                        isNull(records.deletedAt),
                    ),
                )
                .orderBy(relations.sourceRecordId),
        );
        return rows.map((r) => r.id);
    }

    /**
     * Recibe una orden: lleva lo sumado de cada línea hasta lo recibido,
     * sumando (o restando) SÓLO la diferencia en la tienda. El resultado
     * queda en la orden y en cada línea, en criollo.
     */
    private async receiveOrder(ctx: PurchaseCtx, orderId: number): Promise<void> {
        const L = ctx.settings.purchase_fields.lines ?? {};
        const O = ctx.settings.purchase_fields.orders ?? {};
        const linesList = ctx.settings.purchase_lists.lines;
        const ordersList = ctx.settings.purchase_lists.orders;
        if (!linesList || !ordersList || !L.aplicada) return;
        const order = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [row] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, orderId), isNull(records.deletedAt)))
                .limit(1);
            return row ?? null;
        });
        if (!order) return;
        const status = str(order.data[k(O.estado)]);
        if (!RECEIVING.has(status)) return;
        const numero = str(order.data[k(O.numero)]) || `#${orderId}`;

        let creds: Awaited<ReturnType<StoreSyncService['credsForSync']>> | undefined;
        let added = 0;
        let moved = 0;
        const problems: string[] = [];
        const lineIds = await this.linesOf(ctx, orderId);
        for (const lineId of lineIds) {
            const line = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, lineId)).limit(1);
                const rel = await this.targetsOf(tx, ctx.tenantId, [lineId], [L.producto, L.variacion]);
                return row
                    ? {
                          data: row.data,
                          productId: rel.get(`${lineId}:${L.producto}`)?.[0] ?? null,
                          variationId: rel.get(`${lineId}:${L.variacion}`)?.[0] ?? null,
                      }
                    : null;
            });
            if (!line) continue;
            const applied = Math.trunc(num(line.data[k(L.aplicada)]) ?? 0);
            const target = receiveTarget(status, num(line.data[k(L.cantidad)]), num(line.data[k(L.recibida)]));
            if (target === null || target === applied) continue;
            const delta = target - applied;
            const label = str(line.data[k(L.articulo)]) || `línea #${lineId}`;
            const item = line.variationId
                ? { resource: 'variations' as const, id: line.variationId }
                : line.productId
                  ? { resource: 'products' as const, id: line.productId }
                  : null;
            if (!item) {
                await this.noteLine(ctx, lineId, 'Sin producto vinculado: no se sumó a ningún stock.');
                problems.push(`${label}: no tiene producto vinculado.`);
                continue;
            }
            if (creds === undefined) creds = await this.sync.credsForSync(ctx.tenantId, ctx.syncId);
            if (!creds) {
                const msg = 'La tienda está pausada o desconectada: no se sumó el stock. Reanudala y volvé a marcar la orden como recibida.';
                await this.noteLine(ctx, lineId, msg);
                problems.push(`${label}: ${msg}`);
                continue;
            }
            try {
                const res = await this.engine.adjustStock(ctx.tenantId, ctx.syncId, creds, item.resource, item.id, delta, `por ${numero}`);
                await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                    const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, lineId)).limit(1);
                    if (!row) return;
                    const patch: Record<string, unknown> = { [k(L.aplicada)]: target };
                    if (L.pendiente) patch[k(L.pendiente)] = pendingOf(status, num(row.data[k(L.cantidad)]), target);
                    if (L.movimiento) patch[k(L.movimiento)] = `${delta > 0 ? '+' : ''}${delta} al stock → quedó en ${res.after}`;
                    await this.patch(tx, ctx, lineId, row.data, patch);
                });
                ctx.touched.add(linesList);
                added += delta;
                moved += 1;
            } catch (err) {
                const msg = explain(err);
                await this.noteLine(ctx, lineId, `No se pudo sumar ${delta}: ${msg}`);
                problems.push(`${label}: ${msg}`);
            }
        }

        if (moved === 0 && problems.length === 0) return;
        const parts: string[] = [];
        if (moved > 0) {
            parts.push(
                `${added >= 0 ? 'Se sumaron' : 'Se descontaron'} ${Math.abs(added)} ${Math.abs(added) === 1 ? 'unidad' : 'unidades'} al stock de la tienda (${moved} ${moved === 1 ? 'artículo' : 'artículos'}).`,
            );
        }
        if (problems.length > 0) {
            parts.push(`${problems.length === 1 ? 'Un artículo no se pudo sumar' : `${problems.length} artículos no se pudieron sumar`}:`);
            parts.push(...problems.slice(0, MAX_RESULT_LINES).map((p) => `• ${p}`));
        }
        await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, orderId)).limit(1);
            if (!row) return;
            const patch: Record<string, unknown> = {};
            if (O.resultado) patch[k(O.resultado)] = parts.join('\n');
            if (O.recibida_el && status === 'recibida' && problems.length === 0 && str(row.data[k(O.recibida_el)]) === '') {
                patch[k(O.recibida_el)] = new Date().toISOString();
            }
            await this.patch(tx, ctx, orderId, row.data, patch);
        });
        ctx.touched.add(ordersList);
    }

    private async noteLine(ctx: PurchaseCtx, lineId: number, text: string): Promise<void> {
        const key = ctx.settings.purchase_fields.lines?.movimiento;
        if (!key) return;
        await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, lineId)).limit(1);
            if (row) await this.patch(tx, ctx, lineId, row.data, { [k(key)]: text.slice(0, 250) });
        });
        if (ctx.settings.purchase_lists.lines) ctx.touched.add(ctx.settings.purchase_lists.lines);
    }

    // ── «Sumar al stock» ────────────────────────────────────────────────────

    private async adjustFromColumn(ctx: PurchaseCtx, resource: 'products' | 'variations', recordId: number, delta: number): Promise<void> {
        const fields = ctx.settings.fields[resource] ?? {};
        const key = k(fields.sumar_stock);
        const listId = ctx.settings.lists[resource];
        if (!fields.sumar_stock || !listId) return;
        // Se reclama: la celda se vacía SÓLO si todavía dice ese número.
        const claimed = await this.tenantDb.withTenant(ctx.tenantId, (tx) =>
            tx
                .update(records)
                .set({ data: sql`${records.data} - ${key}`, updatedAt: new Date() })
                .where(
                    and(
                        eq(records.tenantId, ctx.tenantId),
                        eq(records.id, recordId),
                        sql`jsonb_typeof(${records.data}->${key}) = 'number'`,
                        sql`(${records.data}->>${key})::numeric = ${delta}`,
                    ),
                )
                .returning({ id: records.id }),
        );
        if (claimed.length === 0) return;
        ctx.touched.add(listId);
        const creds = await this.sync.credsForSync(ctx.tenantId, ctx.syncId);
        const note = async (text: string) => {
            if (!fields.ultimo_movimiento) return;
            await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
                const [row] = await tx.select({ data: records.data }).from(records).where(eq(records.id, recordId)).limit(1);
                if (row) await this.patch(tx, ctx, recordId, row.data, { [k(fields.ultimo_movimiento)]: text.slice(0, 250) });
            });
        };
        if (!creds) {
            await note(`No se pudo sumar ${delta}: la tienda está pausada o desconectada.`);
            return;
        }
        try {
            await this.engine.adjustStock(ctx.tenantId, ctx.syncId, creds, resource, recordId, delta, 'desde «Sumar al stock»');
        } catch (err) {
            await note(`No se pudo sumar ${delta}: ${explain(err)}`);
        }
    }

    // ── Crear una orden desde una selección ─────────────────────────────────

    /**
     * Lo que el diálogo «Crear orden de compra» muestra para las filas
     * elegidas: stock, en camino, vendido en 30 días, alerta y la cantidad
     * sugerida. Pasa por `RecordsService.list` con el actor: lo que la
     * persona no puede ver no aparece.
     */
    async preview(tenantId: number, actor: Actor, connectionId: number, input: PurchasePreviewInput): Promise<PurchasePreviewItem[]> {
        const { settings } = await this.requireSync(tenantId, connectionId);
        const listId = settings.lists[input.resource];
        if (!listId) throw noList();
        const F = settings.fields[input.resource] ?? {};
        const page = await this.recordsSvc.list(tenantId, actor, String(listId), {
            ids: input.record_ids.join(','),
            limit: 200,
            sort_dir: 'asc',
        });
        const lastCost = await this.lastCosts(tenantId, settings, input.resource, page.data.map((r) => r.id));
        const threshold0 = settings.low_stock_amount ?? DEFAULT_LOW_STOCK;
        const order = new Map(input.record_ids.map((id, i) => [id, i]));
        return page.data
            .map((r) => {
                const d = r.data as Record<string, unknown>;
                const stock = num(d[k(F.stock)]);
                const inTransit = num(d[k(F.en_camino)]) ?? 0;
                const sold = num(d[k(F.vendidas_30d)]) ?? 0;
                const threshold = num(d[k(F.umbral_stock)]) ?? threshold0;
                const variable = input.resource === 'products' && d[k(F.tipo)] === 'variable';
                return {
                    record_id: r.id,
                    name: str(d[k(F.nombre)]) || `#${r.id}`,
                    sku: str(d[k(F.sku)]) || null,
                    stock,
                    in_transit: inTransit,
                    sold_30d: sold,
                    threshold,
                    suggested: suggestQuantity(stock, inTransit, sold, threshold),
                    last_cost: lastCost.get(r.id) ?? null,
                    blocked: variable ? 'Tiene variaciones: se pide por talla/color desde la lista Variaciones.' : null,
                };
            })
            .sort((a, b) => (order.get(a.record_id) ?? 0) - (order.get(b.record_id) ?? 0));
    }

    /** El costo de la última línea de compra de cada artículo (para no tipearlo de nuevo). */
    private async lastCosts(tenantId: number, settings: SyncSettings, resource: 'products' | 'variations', ids: number[]): Promise<Map<number, number>> {
        const L = settings.purchase_fields.lines ?? {};
        const relField = resource === 'products' ? L.producto : L.variacion;
        if (!relField || !L.costo || ids.length === 0) return new Map();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.execute(sql`
                SELECT DISTINCT ON (r.target_record_id) r.target_record_id AS id, (rec.data->>${k(L.costo)})::numeric AS cost
                FROM relations r
                JOIN records rec ON rec.id = r.source_record_id AND rec.deleted_at IS NULL
                WHERE r.tenant_id = ${tenantId} AND r.field_id = ${relField}
                  AND r.target_record_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
                  AND jsonb_typeof(rec.data->${k(L.costo)}) = 'number'
                ORDER BY r.target_record_id, rec.id DESC
            `),
        );
        const out = new Map<number, number>();
        for (const row of rows.rows as Array<{ id: string | number; cost: string | number }>) {
            out.set(Number(row.id), Number(row.cost));
        }
        return out;
    }

    /**
     * Crea UNA orden de compra con una línea por artículo elegido. Todo pasa
     * por `RecordsService` con el actor (permisos de la lista, actividad,
     * automatizaciones: «avisar al proveedor cuando se crea una orden»
     * funciona como con cualquier registro).
     */
    async createOrder(tenantId: number, actor: Actor, connectionId: number, input: CreatePurchaseOrderInput): Promise<PurchaseOrderCreated> {
        const { syncId, settings } = await this.requireSync(tenantId, connectionId);
        const O = settings.purchase_fields.orders ?? {};
        const L = settings.purchase_fields.lines ?? {};
        const S = settings.purchase_fields.suppliers ?? {};
        const ordersList = settings.purchase_lists.orders;
        const linesList = settings.purchase_lists.lines;
        const sourceList = settings.lists[input.resource];
        if (!ordersList || !linesList || !sourceList || !L.orden) throw noList();
        const warnings: string[] = [];

        const preview = await this.preview(tenantId, actor, connectionId, {
            resource: input.resource,
            record_ids: input.items.map((i) => i.record_id),
        });
        const byId = new Map(preview.map((p) => [p.record_id, p]));
        // El producto padre de cada variación (así «En camino» del producto también suma).
        const parents = new Map<number, number>();
        if (input.resource === 'variations' && settings.fields.variations?.producto) {
            const relField = settings.fields.variations.producto;
            const rel = await this.tenantDb.withTenant(tenantId, (tx) =>
                this.targetsOf(tx, tenantId, [...byId.keys()], [relField]),
            );
            for (const id of byId.keys()) {
                const p = rel.get(`${id}:${relField}`)?.[0];
                if (p) parents.set(id, p);
            }
        }
        const items = input.items.filter((i) => {
            const p = byId.get(i.record_id);
            if (!p) {
                warnings.push(`El registro #${i.record_id} no está (o no tenés acceso): se omitió.`);
                return false;
            }
            if (p.blocked) {
                warnings.push(`${p.name}: ${p.blocked}`);
                return false;
            }
            return true;
        });
        if (items.length === 0) {
            throw new BadRequestException({
                code: 'purchase_nothing',
                message: warnings[0] ?? 'No hay artículos para pedir.',
                data: { status: 400, warnings },
            });
        }

        const ctx: PurchaseCtx = { tenantId, syncId, settings, touched: new Set() };
        const result = await this.withLock(syncId, async () => {
            // Proveedor: uno de la lista (se verifica que se pueda ver) o uno nuevo por nombre.
            let supplierId: number | null = null;
            if (input.supplier_id) {
                if (!settings.purchase_lists.suppliers) throw noList();
                const s = await this.recordsSvc.get(tenantId, actor, String(settings.purchase_lists.suppliers), input.supplier_id);
                supplierId = s.id;
            } else if (input.supplier_name && S.nombre && settings.purchase_lists.suppliers) {
                const s = await this.recordsSvc.create(tenantId, actor, String(settings.purchase_lists.suppliers), {
                    data: { [k(S.nombre)]: input.supplier_name },
                });
                supplierId = s.id;
            }
            const numero = await this.tenantDb.withTenant(tenantId, (tx) => this.nextNumber(tx, ctx));
            const orderData: Record<string, unknown> = {};
            if (O.numero) orderData[k(O.numero)] = numero;
            if (O.estado) orderData[k(O.estado)] = input.status;
            if (O.fecha) orderData[k(O.fecha)] = new Date().toISOString().slice(0, 10);
            if (O.entrega && input.expected_date) orderData[k(O.entrega)] = input.expected_date;
            if (O.notas && input.notes) orderData[k(O.notas)] = input.notes;
            if (O.proveedor && supplierId) orderData[k(O.proveedor)] = [supplierId];
            const order = await this.recordsSvc.create(tenantId, actor, String(ordersList), { data: orderData });
            await this.fillOrder(ctx, order.id);

            let lines = 0;
            for (const it of items) {
                const p = byId.get(it.record_id)!;
                const data: Record<string, unknown> = { [k(L.orden)]: [order.id] };
                if (L.articulo) data[k(L.articulo)] = p.name;
                if (L.cantidad) data[k(L.cantidad)] = it.quantity;
                const cost = it.cost ?? p.last_cost;
                if (L.costo && cost !== null && cost !== undefined) data[k(L.costo)] = cost;
                if (input.resource === 'variations') {
                    if (L.variacion) data[k(L.variacion)] = [it.record_id];
                    const parent = parents.get(it.record_id);
                    if (L.producto && parent) data[k(L.producto)] = [parent];
                } else if (L.producto) {
                    data[k(L.producto)] = [it.record_id];
                }
                try {
                    const line = await this.recordsSvc.create(tenantId, actor, String(linesList), { data });
                    await this.normalizeLine(ctx, line.id);
                    lines += 1;
                } catch (err) {
                    warnings.push(`${p.name}: ${explain(err)}`);
                }
            }
            return { order, numero, lines };
        });
        this.flush(ctx);
        const slug = await this.listSlug(tenantId, ordersList);
        return { order_id: result.order.id, order_number: result.numero, list_slug: slug, lines: result.lines, warnings };
    }

    // ── Ayudas ──────────────────────────────────────────────────────────────

    /** Merge de datos sin pasar por `RecordsService` (y sin aviso de cambios: ver arriba). */
    private async patch(tx: Tx, ctx: PurchaseCtx, recordId: number, before: Record<string, unknown>, patch: Record<string, unknown>): Promise<void> {
        const after = { ...before };
        for (const [key, v] of Object.entries(patch)) {
            if (v === null || v === undefined) delete after[key];
            else after[key] = v;
        }
        await tx
            .update(records)
            .set({ data: after, updatedAt: new Date() })
            .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, recordId)));
    }

    /** `${origen}:${campo}` → ids destino, para varios registros y campos relation en una query. */
    private async targetsOf(
        tx: Tx,
        tenantId: number,
        sourceIds: number[],
        fieldIds: Array<number | undefined>,
    ): Promise<Map<string, number[]>> {
        const fids = fieldIds.filter((f): f is number => typeof f === 'number' && f > 0);
        const out = new Map<string, number[]>();
        if (sourceIds.length === 0 || fids.length === 0) return out;
        const rows = await tx
            .select({ source: relations.sourceRecordId, field: relations.fieldId, target: relations.targetRecordId })
            .from(relations)
            .innerJoin(records, eq(records.id, relations.targetRecordId))
            .where(
                and(
                    eq(relations.tenantId, tenantId),
                    inArray(relations.sourceRecordId, sourceIds),
                    inArray(relations.fieldId, fids),
                    isNull(records.deletedAt),
                ),
            )
            .orderBy(relations.id);
        for (const r of rows) {
            const key = `${r.source}:${r.field}`;
            if (!out.has(key)) out.set(key, []);
            out.get(key)!.push(r.target);
        }
        return out;
    }

    private async requireSync(tenantId: number, connectionId: number): Promise<{ syncId: number; settings: SyncSettings }> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connectionSyncs.id, settings: connectionSyncs.settings })
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.connectionId, connectionId)))
                .limit(1),
        );
        if (!row) {
            throw new NotFoundException({ code: 'store_sync_not_found', message: 'Esta tienda no se está sincronizando.', data: { status: 404 } });
        }
        const settings = readSettings(row.settings);
        if (!settings.purchase_lists.orders) {
            throw new ConflictException({
                code: 'purchasing_not_ready',
                message: 'Las órdenes de compra todavía no están listas: se crean en la próxima sincronización de la tienda.',
                data: { status: 409 },
            });
        }
        return { syncId: row.id, settings };
    }

    private async listSlug(tenantId: number, listId: number): Promise<string> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.execute(sql`SELECT slug FROM lists WHERE tenant_id = ${tenantId} AND id = ${listId} LIMIT 1`),
        );
        const first = (rows.rows as Array<{ slug: string }>)[0];
        return first?.slug ?? String(listId);
    }
}

function noList(): BadRequestException {
    return new BadRequestException({ code: 'store_sync_no_list', message: 'Falta una de las listas de la tienda.', data: { status: 400 } });
}

function addDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return isoDate;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function explain(err: unknown): string {
    if (err instanceof StockAdjustError || err instanceof WooApiError) return err.message;
    if (err && typeof err === 'object' && 'getResponse' in err) {
        const r = (err as { getResponse(): unknown }).getResponse() as { message?: unknown };
        if (typeof r?.message === 'string') return r.message;
    }
    return err instanceof Error ? err.message : String(err);
}

