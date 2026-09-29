import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    STORE_META_RESOURCES,
    STORE_PURCHASE_LISTS,
    STORE_SYNC_RESOURCES,
    type MapStoreMetaInput,
    type Role,
    type SetupStoreSyncInput,
    type StoreMetaKey,
    type StoreListMarker,
    type StoreMetaResource,
    type StorePurchaseList,
    type StoreSyncResource,
    type StoreSyncStatus,
    type UnmapStoreMetaInput,
    type UpdateStoreSyncInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { wooStoreUrl } from '../connectors/woocommerce/wc-api';
import { DRIZZLE, type Db } from '../db/client';
import { connectionSyncs, dashboards, fields as fieldsTable, lists, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListGroupsService } from '../lists/list-groups.service';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService } from '../templates/blueprint.service';
import { StoreRealtimeService } from './store-realtime.service';
import { StoreSyncEngine, type RunOptions } from './store-sync.engine';
import { StoreSyncQueue } from './store-sync.queue';
import { readSettings, readState, type SyncSettings } from './store-sync.types';
import { wooGet } from './woocommerce/woo-fetch';
import { buildWooPack, packAddition, PURCHASE_LIST_KEYS, WOO_LIST_KEYS, WOO_PACK_VERSION } from './woocommerce/woo-pack';
import { DEFAULT_LOW_STOCK } from './woocommerce/woo-map';

/**
 * Sincronización con tiendas — lo que ve y toca la persona (v0.1.206,
 * ADR-S24). El trabajo pesado lo hace `StoreSyncEngine` en la cola; acá se
 * crea el pack, se guardan los ajustes y se arma el estado que muestra la
 * pantalla de la tienda.
 */
@Injectable()
export class StoreSyncService {
    private readonly logger = new Logger(StoreSyncService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly connectors: ConnectorsService,
        private readonly blueprints: BlueprintService,
        private readonly lists: ListsService,
        private readonly groups: ListGroupsService,
        private readonly fields: FieldsService,
        private readonly audit: AuditService,
        private readonly engine: StoreSyncEngine,
        private readonly queue: StoreSyncQueue,
        private readonly realtime: StoreRealtimeService,
    ) {}

    // ── Lectura ─────────────────────────────────────────────────────────────

    async status(tenantId: number, userId: number, role: Role, connectionId: number): Promise<StoreSyncStatus> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        const row = await this.findSync(tenantId, connectionId);
        if (!row) return this.emptyStatus(connectionId, conn.name);
        return this.toStatus(tenantId, row, conn.name);
    }

    private emptyStatus(connectionId: number, name: string): StoreSyncStatus {
        const empty = Object.fromEntries(STORE_SYNC_RESOURCES.map((r) => [r, null])) as StoreSyncStatus['lists'];
        const progress = Object.fromEntries(
            STORE_SYNC_RESOURCES.map((r) => [r, { count: 0, done: 0, total: null }]),
        ) as StoreSyncStatus['progress'];
        return {
            configured: false,
            connection_id: connectionId,
            store_name: storeLabel(name),
            enabled: false,
            mode: 'interval',
            interval_minutes: 15,
            write_back: false,
            orders_since: null,
            resources: { customers: true, products: true, orders: true },
            lists: empty,
            dashboard_id: null,
            inventory_dashboard_id: null,
            purchase_lists: { suppliers: null, orders: null, lines: null },
            folder_id: null,
            running: false,
            current: null,
            progress,
            initial_done: false,
            last_run_at: null,
            last_success_at: null,
            next_run_at: null,
            last_error: null,
            warnings: [],
            meta_keys: { customers: [], products: [], variations: [], orders: [] },
            realtime: { active: false, received: 0, last_received_at: null, error: null, webhooks: 0 },
            write_back_status: { pushed: 0, failed: 0, last_at: null, last_error: null },
        };
    }

    private async toStatus(
        tenantId: number,
        row: typeof connectionSyncs.$inferSelect,
        connName: string,
    ): Promise<StoreSyncStatus> {
        const settings = readSettings(row.settings);
        const state = readState(row.state);
        const { counts, listRows } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const c = await tx
                .select({ resource: syncLinks.resource, n: sql<number>`count(DISTINCT ${syncLinks.recordId})::int` })
                .from(syncLinks)
                .where(eq(syncLinks.syncId, row.id))
                .groupBy(syncLinks.resource);
            const ids = [...Object.values(settings.lists), ...Object.values(settings.purchase_lists)].filter(
                (v): v is number => typeof v === 'number',
            );
            const l = ids.length
                ? await tx
                      .select({ id: lists.id, slug: lists.slug, name: lists.name })
                      .from(lists)
                      .where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids)))
                : [];
            return { counts: c, listRows: l };
        });
        const countOf = new Map(counts.map((c) => [c.resource, c.n]));
        const byId = new Map(listRows.map((l) => [l.id, l]));
        const listsOut = {} as StoreSyncStatus['lists'];
        const progress = {} as StoreSyncStatus['progress'];
        for (const r of STORE_SYNC_RESOURCES) {
            const id = settings.lists[r];
            const l = id ? byId.get(id) : undefined;
            listsOut[r] = l ? { id: l.id, slug: l.slug, name: l.name } : null;
            const p = state.progress[r];
            progress[r] = { count: countOf.get(r) ?? 0, done: p?.done ?? 0, total: p?.total ?? null };
        }
        const metaKeys = {} as StoreSyncStatus['meta_keys'];
        for (const r of STORE_META_RESOURCES) {
            const seen = state.meta[r] ?? {};
            const mapped = settings.meta_map[r] ?? {};
            const keys: StoreMetaKey[] = Object.entries(seen).map(([key, m]) => ({
                key,
                count: m.count,
                sample: m.sample,
                suggested_type: (['text', 'long_text', 'number', 'date', 'checkbox', 'url'].includes(m.type)
                    ? m.type
                    : 'text') as StoreMetaKey['suggested_type'],
                private: key.startsWith('_'),
                field_id: mapped[key] ?? null,
            }));
            // Los mapeados que ya no aparecen igual se listan (para poder quitarlos).
            for (const [key, fieldId] of Object.entries(mapped)) {
                if (!seen[key]) {
                    keys.push({ key, count: 0, sample: null, suggested_type: 'text', private: key.startsWith('_'), field_id: fieldId });
                }
            }
            keys.sort((a, b) => Number(b.field_id !== null) - Number(a.field_id !== null) || b.count - a.count || a.key.localeCompare(b.key));
            metaKeys[r] = keys;
        }
        return {
            configured: true,
            connection_id: row.connectionId,
            store_name: settings.store_name || storeLabel(connName),
            enabled: row.enabled,
            mode: settings.mode,
            interval_minutes: settings.interval_minutes,
            write_back: settings.write_back,
            orders_since: settings.orders_since,
            resources: settings.resources,
            lists: listsOut,
            dashboard_id: settings.dashboard_id,
            inventory_dashboard_id: settings.inventory_dashboard_id,
            purchase_lists: Object.fromEntries(
                STORE_PURCHASE_LISTS.map((k) => {
                    const id = settings.purchase_lists[k];
                    const l = id ? byId.get(id) : undefined;
                    return [k, l ? { id: l.id, slug: l.slug, name: l.name } : null];
                }),
            ) as StoreSyncStatus['purchase_lists'],
            folder_id: settings.folder_id,
            running: state.running,
            current: state.current,
            progress,
            initial_done: state.initial_done,
            last_run_at: state.last_run_at,
            last_success_at: state.last_success_at,
            next_run_at: row.nextRunAt ? row.nextRunAt.toISOString() : null,
            last_error: state.last_error,
            warnings: state.warnings,
            meta_keys: metaKeys,
            realtime: {
                active: settings.mode === 'realtime' && state.realtime.webhook_ids.length > 0,
                received: state.realtime.received,
                last_received_at: state.realtime.last_received_at,
                error: state.realtime.error,
                webhooks: state.realtime.webhook_ids.length,
            },
            write_back_status: state.write_back,
        };
    }

    // ── Alta ────────────────────────────────────────────────────────────────

    async setup(
        tenantId: number,
        userId: number,
        role: Role,
        connectionId: number,
        input: SetupStoreSyncInput,
    ): Promise<StoreSyncStatus> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        if (await this.findSync(tenantId, connectionId)) {
            throw new ConflictException({
                code: 'store_sync_exists',
                message: 'Esta tienda ya se está sincronizando.',
                data: { status: 409 },
            });
        }
        const creds = await this.credsOf(tenantId, connectionId);
        const storeUrl = wooStoreUrl(creds.fields.store_url ?? '');
        const storeName = storeLabel(conn.name);
        const shop = await this.storeFormat(creds);

        // Una carpeta propia: las cinco listas y nada más, bien a la vista.
        const folder = await this.groups.create(tenantId, {
            name: `WooCommerce · ${storeName}`.slice(0, 120),
            icon: 'storefront',
            color: '#7F54B3',
        });
        const pack = buildWooPack({ storeName, currency: shop.currency, precision: shop.precision, phoneCountry: shop.country });
        const made = await this.blueprints.materialize(tenantId, userId, pack, {
            includeRecords: false,
            groupId: folder.id,
        });
        const settings: SyncSettings = {
            resources: input.resources,
            orders_since: input.orders_since ?? null,
            mode: input.mode,
            interval_minutes: input.interval_minutes,
            write_back: false,
            store_url: storeUrl,
            store_name: storeName,
            lists: {},
            fields: {},
            meta_map: {},
            dashboard_id: made.dashboardIds[0] ?? null,
            folder_id: folder.id,
            low_stock_amount: shop.lowStock,
            pack_version: WOO_PACK_VERSION,
            inventory_dashboard_id: made.dashboardIds[1] ?? null,
            purchase_lists: {},
            purchase_fields: {},
        };
        for (const r of STORE_SYNC_RESOURCES) {
            const key = WOO_LIST_KEYS[r];
            const idx = pack.lists.findIndex((l) => l.key === key);
            const list = made.lists[idx];
            if (list) settings.lists[r] = list.id;
            settings.fields[r] = made.fieldIds[key] ?? {};
        }
        for (const k of STORE_PURCHASE_LISTS) {
            const key = PURCHASE_LIST_KEYS[k];
            const list = made.lists[pack.lists.findIndex((l) => l.key === key)];
            if (list) settings.purchase_lists[k] = list.id;
            settings.purchase_fields[k] = made.fieldIds[key] ?? {};
        }
        if (made.warnings.length > 0) this.logger.warn(`Pack de la tienda con avisos: ${made.warnings.join(' | ')}`);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(connectionSyncs)
                .values({
                    tenantId,
                    connectionId,
                    provider: 'woocommerce',
                    settings: settings as unknown as Record<string, unknown>,
                    state: {},
                    enabled: true,
                    nextRunAt: new Date(Date.now() + input.interval_minutes * 60_000),
                    createdBy: userId,
                })
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'store_sync.create',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
                meta: { resources: input.resources, mode: input.mode, interval_minutes: input.interval_minutes },
            });
            return created!;
        });
        await this.markLists(tenantId, connectionId, settings);
        let current = row;
        if (input.mode === 'realtime') {
            try {
                await this.realtime.register(tenantId, row.id, creds, settings);
            } catch (err) {
                // Sin avisos (clave de sólo lectura, tienda que no llega a este
                // servidor…): la tienda igual se sincroniza por intervalos, y la
                // pantalla dice por qué no quedó en tiempo real.
                current = await this.fallbackToInterval(tenantId, row.id, err);
            }
        }
        this.queue.enqueueRun(tenantId, row.id, { full: true });
        const fresh = (await this.findSync(tenantId, connectionId)) ?? current;
        return this.toStatus(tenantId, fresh, conn.name);
    }

    /** Moneda, decimales y país de la tienda (para los campos de dinero y teléfono). */
    private async storeFormat(
        creds: IntegrationCreds,
    ): Promise<{ currency: string; precision: number; country: string | null; lowStock: number }> {
        const out = { currency: 'USD', precision: 2, country: null as string | null, lowStock: DEFAULT_LOW_STOCK };
        out.lowStock = await this.storeLowStock(creds);
        try {
            const { json } = await wooGet(creds, '/settings/general');
            if (Array.isArray(json)) {
                const value = (id: string) => {
                    const hit = json.find((s) => s && typeof s === 'object' && (s as { id?: unknown }).id === id) as
                        | { value?: unknown }
                        | undefined;
                    return typeof hit?.value === 'string' ? hit.value : null;
                };
                const cur = value('woocommerce_currency');
                if (cur && /^[A-Z]{3}$/.test(cur)) out.currency = cur;
                const dec = Number(value('woocommerce_price_num_decimals'));
                if (Number.isInteger(dec) && dec >= 0 && dec <= 4) out.precision = dec;
                const country = value('woocommerce_default_country');
                if (country && /^[A-Z]{2}/.test(country)) out.country = country.slice(0, 2);
            }
        } catch {
            // Los ajustes piden permisos de administrador de la tienda: sin
            // ellos se usan valores por defecto (se pueden cambiar en cada campo).
        }
        return out;
    }

    /**
     * El umbral general de «stock bajo» de la tienda (WooCommerce → Ajustes →
     * Productos → Inventario). Sin permisos para leerlo, el default de
     * WooCommerce (2).
     */
    private async storeLowStock(creds: IntegrationCreds): Promise<number> {
        try {
            const { json } = await wooGet(creds, '/settings/products');
            if (Array.isArray(json)) {
                const hit = json.find((s) => s && typeof s === 'object' && (s as { id?: unknown }).id === 'woocommerce_notify_low_stock_amount') as
                    | { value?: unknown }
                    | undefined;
                const n = Number(hit?.value);
                if (Number.isInteger(n) && n >= 0) return n;
            }
        } catch {
            // Sin permiso de administrador de la tienda: el default.
        }
        return DEFAULT_LOW_STOCK;
    }

    /**
     * Actualiza el pack de una sincronización creada con una versión anterior
     * (v0.1.208 el inventario, v0.1.209 la reposición): agrega lo que falta
     * —campos, vistas, tableros y listas nuevas— SIN tocar lo que ya está, y
     * encola una vuelta completa de productos para llenar lo nuevo.
     * Idempotente y bajo el candado de la corrida (dos trabajos simultáneos no
     * duplican campos). Devuelve si actualizó.
     */
    async upgradePack(tenantId: number, syncId: number, creds: IntegrationCreds): Promise<boolean> {
        const token = await this.engine.acquire(syncId);
        if (!token) return false;
        // Qué hay que re-leer al terminar (los campos nuevos se llenan solos).
        const only: StoreSyncResource[] = ['products'];
        try {
            const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1),
            );
            if (!row) return false;
            const settings = readSettings(row.settings);
            const from = settings.pack_version;
            // Desde el pack 3 también clientes: su enlace «Editar en WooCommerce».
            if (from < 4 && settings.resources.customers && settings.lists.customers) only.push('customers');
            if (from >= WOO_PACK_VERSION) return false;
            const shop = await this.storeFormat(creds);
            const full = buildWooPack({ storeName: settings.store_name, currency: shop.currency, precision: shop.precision, phoneCountry: shop.country });
            const keyToListId = new Map<string, number>();
            const existing = new Map<string, Map<string, number>>();
            for (const r of STORE_SYNC_RESOURCES) {
                const key = WOO_LIST_KEYS[r];
                const listId = settings.lists[r];
                if (listId) keyToListId.set(key, listId);
                existing.set(key, new Map(Object.entries(settings.fields[r] ?? {})));
            }
            for (const k of STORE_PURCHASE_LISTS) {
                const listId = settings.purchase_lists[k];
                if (listId) keyToListId.set(PURCHASE_LIST_KEYS[k], listId);
                existing.set(PURCHASE_LIST_KEYS[k], new Map(Object.entries(settings.purchase_fields[k] ?? {})));
            }
            // Sólo se completan las listas que existen (una tienda que no trae
            // clientes no gana una lista de Clientes vacía).
            const addition = packAddition(full, from, new Set(keyToListId.keys()));
            const made = await this.blueprints.extend(tenantId, row.createdBy ?? 0, addition, keyToListId, existing, {
                groupId: settings.folder_id,
            });
            if (made.warnings.length > 0) this.logger.warn(`Actualización del pack #${syncId}: ${made.warnings.join(' | ')}`);
            const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).for('update');
                const s = readSettings(locked!.settings);
                for (const r of STORE_SYNC_RESOURCES) {
                    const got = made.fieldIds[WOO_LIST_KEYS[r]];
                    if (got && Object.keys(got).length > 0) s.fields[r] = { ...(s.fields[r] ?? {}), ...got };
                }
                for (const k of STORE_PURCHASE_LISTS) {
                    const key = PURCHASE_LIST_KEYS[k];
                    if (made.createdLists[key]) s.purchase_lists[k] = made.createdLists[key];
                    const got = made.fieldIds[key];
                    if (got && Object.keys(got).length > 0) s.purchase_fields[k] = { ...(s.purchase_fields[k] ?? {}), ...got };
                }
                s.pack_version = WOO_PACK_VERSION;
                if (from < 2) {
                    // El pack 1 armó las tablas del tablero de ventas con una clave que
                    // el widget no lee (`columns`): mostraban las columnas por defecto.
                    if (s.dashboard_id) await this.patchTables(tx, s.dashboard_id, (cfg) => {
                        if (!Array.isArray(cfg.columns) || Array.isArray(cfg.visible_field_ids)) return null;
                        const { columns, ...rest } = cfg;
                        return { ...rest, visible_field_ids: columns };
                    });
                    s.inventory_dashboard_id = made.dashboardIds[0] ?? s.inventory_dashboard_id;
                } else if (s.inventory_dashboard_id) {
                    // Pack 2 → 3: las tablas «para reponer» suman «En camino» (lo
                    // ya pedido a proveedores), así nadie pide dos veces lo mismo.
                    const byList = new Map<number, number | undefined>();
                    if (s.lists.products) byList.set(s.lists.products, s.fields.products?.en_camino);
                    if (s.lists.variations) byList.set(s.lists.variations, s.fields.variations?.en_camino);
                    await this.patchTables(tx, s.inventory_dashboard_id, (cfg, listId) => {
                        const add = byList.get(listId);
                        const cols = Array.isArray(cfg.visible_field_ids) ? (cfg.visible_field_ids as unknown[]) : null;
                        if (!add || !cols || cols.includes(add)) return null;
                        return { ...cfg, visible_field_ids: [...cols.slice(0, 2), add, ...cols.slice(2)] };
                    });
                }
                if (from < 4) await this.upgradeIdentity(tx, tenantId, s, from);
                s.low_stock_amount = shop.lowStock;
                await tx
                    .update(connectionSyncs)
                    .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                    .where(eq(connectionSyncs.id, syncId));
                return s;
            });
            await this.markLists(tenantId, row.connectionId, fresh);
        } finally {
            await this.engine.release(syncId, token);
        }
        // Llenar los campos nuevos: una vuelta completa de productos (sin
        // disparar automatizaciones: es una puesta al día).
        this.queue.enqueueRun(tenantId, syncId, { full: true, only });
        this.realtime.forget(tenantId);
        return true;
    }

    /**
     * v0.1.210 (pack 3 → 4) — Lo que no se resuelve agregando campos:
     *  - las columnas «Imagen» que ya existían pasan a mostrarse como
     *    MINIATURA (`config.display = 'image'`);
     *  - las líneas de compra que ya existían reciben el SKU de lo que piden
     *    (de la variación o, si no, del producto). Las nuevas lo completa
     *    `StorePurchasingService.normalizeLine` sola.
     * Los enlaces de edición y el de las variaciones los llena la vuelta
     * completa que se encola al terminar.
     */
    private async upgradeIdentity(
        tx: Parameters<Parameters<TenantDb['withTenant']>[1]>[0],
        tenantId: number,
        s: SyncSettings,
        from: number,
    ): Promise<void> {
        const images = [s.fields.products?.imagen, s.fields.variations?.imagen].filter((x): x is number => !!x);
        if (images.length > 0) {
            await tx
                .update(fieldsTable)
                .set({ config: sql`${fieldsTable.config} || '{"display":"image"}'::jsonb` })
                .where(and(eq(fieldsTable.tenantId, tenantId), inArray(fieldsTable.id, images)));
        }
        const L = s.purchase_fields.lines ?? {};
        const linesList = s.purchase_lists.lines;
        const pSku = s.fields.products?.sku;
        const vSku = s.fields.variations?.sku;
        if (from < 3 || !linesList || !L.sku || (!pSku && !vSku)) return;
        // Un solo UPDATE: la variación manda; si no hay, el producto.
        await tx.execute(sql`
            UPDATE records r
               SET data = r.data || jsonb_build_object(${`f${L.sku}`}::text, src.sku),
                   updated_at = now()
              FROM (
                    SELECT l.id,
                           COALESCE(
                               NULLIF(v.data ->> ${`f${vSku ?? 0}`}::text, ''),
                               NULLIF(p.data ->> ${`f${pSku ?? 0}`}::text, '')
                           ) AS sku
                      FROM records l
                      LEFT JOIN relations rv ON rv.source_record_id = l.id AND rv.field_id = ${L.variacion ?? 0}
                      LEFT JOIN records v ON v.id = rv.target_record_id
                      LEFT JOIN relations rp ON rp.source_record_id = l.id AND rp.field_id = ${L.producto ?? 0}
                      LEFT JOIN records p ON p.id = rp.target_record_id
                     WHERE l.tenant_id = ${tenantId} AND l.list_id = ${linesList} AND l.deleted_at IS NULL
                   ) src
             WHERE r.id = src.id AND src.sku IS NOT NULL
        `);
    }

    /** Reescribe los widgets de TABLA de un tablero (`fix` devuelve null = sin cambios). */
    private async patchTables(
        tx: Parameters<Parameters<TenantDb['withTenant']>[1]>[0],
        dashboardId: number,
        fix: (cfg: Record<string, unknown>, listId: number) => Record<string, unknown> | null,
    ): Promise<void> {
        const [dash] = await tx.select({ widgets: dashboards.widgets }).from(dashboards).where(eq(dashboards.id, dashboardId));
        if (!dash || !Array.isArray(dash.widgets)) return;
        let changed = false;
        const next = (dash.widgets as Array<Record<string, unknown>>).map((w) => {
            if (w.type !== 'table') return w;
            const out = fix((w.config ?? {}) as Record<string, unknown>, Number(w.list_id));
            if (!out) return w;
            changed = true;
            return { ...w, config: out };
        });
        if (changed) await tx.update(dashboards).set({ widgets: next as never }).where(eq(dashboards.id, dashboardId));
    }

    /**
     * v0.1.209 — Marca cada lista de la tienda con su conexión y su papel
     * (`settings.store_sync`): la UI lo usa para ofrecer «Crear orden de
     * compra» en Productos/Variaciones. Idempotente: sólo escribe donde falta
     * o cambió (una lista cuyos ajustes se reescribieron sin la marca la
     * recupera en la próxima vuelta).
     */
    async markLists(tenantId: number, connectionId: number, settings: SyncSettings): Promise<void> {
        const roles: Array<[number, StoreListMarker['role']]> = [];
        for (const r of STORE_SYNC_RESOURCES) if (settings.lists[r]) roles.push([settings.lists[r]!, r]);
        const purchaseRole: Record<StorePurchaseList, StoreListMarker['role']> = {
            suppliers: 'suppliers',
            orders: 'purchase_orders',
            lines: 'purchase_lines',
        };
        for (const k of STORE_PURCHASE_LISTS) if (settings.purchase_lists[k]) roles.push([settings.purchase_lists[k]!, purchaseRole[k]]);
        if (roles.length === 0) return;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            for (const [listId, role] of roles) {
                const marker = JSON.stringify({ store_sync: { connection_id: connectionId, role } });
                await tx
                    .update(lists)
                    .set({ settings: sql`${lists.settings} || ${marker}::jsonb` })
                    .where(
                        and(
                            eq(lists.tenantId, tenantId),
                            eq(lists.id, listId),
                            sql`${lists.settings}->'store_sync' IS DISTINCT FROM ${marker}::jsonb->'store_sync'`,
                        ),
                    );
            }
        });
    }

    // ── Cambios ─────────────────────────────────────────────────────────────

    async update(
        tenantId: number,
        userId: number,
        role: Role,
        connectionId: number,
        input: UpdateStoreSyncInput,
    ): Promise<StoreSyncStatus> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const before = readSettings(row.settings);
        // Pasar a tiempo real registra los avisos ANTES de cambiar nada: si la
        // tienda no los acepta, el modo no cambia y la persona ve el motivo.
        if (input.mode === 'realtime' && before.mode !== 'realtime') {
            await this.realtime.register(tenantId, row.id, await this.credsOf(tenantId, connectionId), before);
        }
        const updated = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx
                .select()
                .from(connectionSyncs)
                .where(eq(connectionSyncs.id, row.id))
                .for('update');
            const settings = readSettings(locked!.settings);
            if (input.mode !== undefined) settings.mode = input.mode;
            if (input.interval_minutes !== undefined) settings.interval_minutes = input.interval_minutes;
            if (input.write_back !== undefined) settings.write_back = input.write_back;
            const minutes = settings.mode === 'realtime' ? 60 : settings.interval_minutes;
            const [next] = await tx
                .update(connectionSyncs)
                .set({
                    settings: settings as unknown as Record<string, unknown>,
                    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
                    nextRunAt: new Date(Date.now() + minutes * 60_000),
                    updatedAt: new Date(),
                })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'store_sync.update',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
                meta: { ...input },
            });
            return next!;
        });
        if (input.mode === 'interval' && before.mode === 'realtime') {
            const creds = await this.credsOf(tenantId, connectionId).catch(() => null);
            await this.realtime.unregister(tenantId, row.id, creds);
        }
        this.realtime.forget(tenantId);
        const fresh = (await this.findSync(tenantId, connectionId)) ?? updated;
        return this.toStatus(tenantId, fresh, conn.name);
    }

    /** El modo tiempo real no se pudo activar: queda por intervalos, con el motivo a la vista. */
    private async fallbackToInterval(tenantId: number, syncId: number, err: unknown) {
        const message = err instanceof BadRequestException ? String((err.getResponse() as { message?: unknown }).message ?? err.message) : err instanceof Error ? err.message : String(err);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).for('update');
            const s = readSettings(locked!.settings);
            s.mode = 'interval';
            const [next] = await tx
                .update(connectionSyncs)
                .set({
                    settings: s as unknown as Record<string, unknown>,
                    state: sql`${connectionSyncs.state} || ${JSON.stringify({ realtime: { ...readState(locked!.state).realtime, error: message } })}::jsonb`,
                    nextRunAt: new Date(Date.now() + s.interval_minutes * 60_000),
                    updatedAt: new Date(),
                })
                .where(eq(connectionSyncs.id, syncId))
                .returning();
            return next!;
        });
    }

    /** Credenciales de la tienda de una sincronización (para la cola). `null` si ya no se pueden leer. */
    async credsForSync(tenantId: number, syncId: number): Promise<IntegrationCreds | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ connectionId: connectionSyncs.connectionId, enabled: connectionSyncs.enabled }).from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1),
        );
        if (!row || !row.enabled) return null;
        return this.credsOf(tenantId, row.connectionId).catch(() => null);
    }

    async runNow(tenantId: number, userId: number, role: Role, connectionId: number, full: boolean): Promise<StoreSyncStatus> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        this.queue.enqueueRun(tenantId, row.id, { full });
        return this.toStatus(tenantId, row, conn.name);
    }

    /** Deja de sincronizar. Las listas y sus datos QUEDAN (son de la empresa). */
    async remove(tenantId: number, userId: number, role: Role, connectionId: number): Promise<void> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        // Los avisos de la tienda se borran (best-effort): no tiene sentido que siga llamando.
        await this.realtime.unregister(tenantId, row.id, await this.credsOf(tenantId, connectionId).catch(() => null));
        this.realtime.forget(tenantId);
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx.delete(connectionSyncs).where(eq(connectionSyncs.id, row.id));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'store_sync.delete',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
            });
        });
    }

    // ── Campos de otros plugins ─────────────────────────────────────────────

    /**
     * Trae una clave de `meta_data` (un campo que agregó un plugin) a un campo
     * nuevo de la lista, y re-recorre ese recurso para llenarlo en todos los
     * registros que ya estaban.
     */
    async mapMeta(
        tenantId: number,
        userId: number,
        role: Role,
        connectionId: number,
        input: MapStoreMetaInput,
    ): Promise<StoreSyncStatus> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const settings = readSettings(row.settings);
        const state = readState(row.state);
        const listId = settings.lists[input.resource];
        if (!listId) throw new BadRequestException({ code: 'store_sync_no_list', message: 'La lista de ese dato ya no existe.', data: { status: 400 } });
        if (settings.meta_map[input.resource]?.[input.key]) {
            throw new ConflictException({ code: 'store_meta_mapped', message: 'Ese dato ya se trae a un campo.', data: { status: 409 } });
        }
        const suggested = state.meta[input.resource]?.[input.key]?.type;
        const type = input.type ?? (suggested as MapStoreMetaInput['type']) ?? 'text';
        const field = await this.fields.create(tenantId, String(listId), {
            label: input.label,
            type,
            description: `Viene de la tienda (${input.key}).`.slice(0, 500),
        });
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSettings(locked!.settings);
            s.meta_map[input.resource] = { ...(s.meta_map[input.resource] ?? {}), [input.key]: field.id };
            await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, row.id));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'store_sync.map_meta',
                targetType: 'field',
                targetId: field.id,
                targetLabel: input.label,
                meta: { key: input.key, resource: input.resource },
            });
        });
        // Para llenar los registros que ya estaban hay que volver a pasar por todos.
        const only: StoreSyncResource[] = input.resource === 'variations' ? ['products'] : [input.resource];
        this.queue.enqueueRun(tenantId, row.id, { full: true, only });
        this.realtime.forget(tenantId);
        const fresh = await this.requireSync(tenantId, connectionId);
        return this.toStatus(tenantId, fresh, conn.name);
    }

    /** Deja de traer ese dato (el campo y lo que ya tiene quedan). */
    async unmapMeta(
        tenantId: number,
        userId: number,
        role: Role,
        connectionId: number,
        input: UnmapStoreMetaInput,
    ): Promise<StoreSyncStatus> {
        const conn = await this.requireStore(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const updated = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSettings(locked!.settings);
            const map = { ...(s.meta_map[input.resource] ?? {}) };
            delete map[input.key];
            s.meta_map[input.resource] = map;
            const [next] = await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            return next!;
        });
        this.realtime.forget(tenantId);
        return this.toStatus(tenantId, updated, conn.name);
    }

    // ── Cola ────────────────────────────────────────────────────────────────

    /** Lo llama el worker. `false` = otra corrida la tenía tomada. */
    async runJob(tenantId: number, syncId: number, opts: RunOptions): Promise<boolean> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1);
            return r ?? null;
        });
        if (!row || !row.enabled) return true;
        let creds: IntegrationCreds;
        try {
            creds = await this.credsOf(tenantId, row.connectionId);
        } catch (err) {
            await this.engine.saveState(tenantId, syncId, {
                running: false,
                last_error: err instanceof Error ? err.message : String(err),
            });
            return true;
        }
        if (readSettings(row.settings).pack_version < WOO_PACK_VERSION) {
            await this.upgradePack(tenantId, syncId, creds).catch((err) =>
                this.logger.warn(`No se pudo actualizar el pack #${syncId}: ${String(err)}`),
            );
        }
        await this.markLists(tenantId, row.connectionId, readSettings(row.settings)).catch(() => undefined);
        const ran = await this.engine.run(tenantId, syncId, creds, opts);
        // Modo tiempo real: cada vuelta (la red de seguridad horaria) revisa que
        // los avisos sigan activos en la tienda.
        if (ran && readSettings(row.settings).mode === 'realtime') {
            await this.realtime.ensure(tenantId, syncId, creds, readSettings(row.settings));
        }
        return ran;
    }

    /**
     * Tick global (cada minuto): encola las sincronizaciones que tocan. Corre
     * con la conexión base (cross-tenant, como las recurrencias); cada corrida
     * después trabaja dentro de su tenant.
     */
    async tick(): Promise<number> {
        const due = await this.db
            .select({ id: connectionSyncs.id, tenantId: connectionSyncs.tenantId })
            .from(connectionSyncs)
            .where(and(eq(connectionSyncs.enabled, true), lte(connectionSyncs.nextRunAt, new Date())))
            .orderBy(asc(connectionSyncs.nextRunAt))
            .limit(100);
        for (const d of due) {
            // Provisorio: evita re-encolar mientras espera; el motor pone el real al terminar.
            await this.db
                .update(connectionSyncs)
                .set({ nextRunAt: new Date(Date.now() + 10 * 60_000) })
                .where(eq(connectionSyncs.id, d.id));
            this.queue.enqueueRun(d.tenantId, d.id, {});
        }
        return due.length;
    }

    // ── Ayudas ──────────────────────────────────────────────────────────────

    private async requireStore(tenantId: number, userId: number, role: Role, connectionId: number) {
        const conn = await this.connectors.editableConnection(tenantId, userId, role, connectionId);
        if (conn.provider !== 'woocommerce') {
            throw new BadRequestException({
                code: 'not_a_store',
                message: 'Esa conexión no es una tienda.',
                data: { status: 400 },
            });
        }
        return conn;
    }

    private async findSync(tenantId: number, connectionId: number) {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select()
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.connectionId, connectionId)))
                .limit(1);
            return r ?? null;
        });
    }

    private async requireSync(tenantId: number, connectionId: number) {
        const row = await this.findSync(tenantId, connectionId);
        if (!row) {
            throw new NotFoundException({
                code: 'store_sync_not_found',
                message: 'Esta tienda no se está sincronizando.',
                data: { status: 404 },
            });
        }
        return row;
    }

    private async credsOf(tenantId: number, connectionId: number): Promise<IntegrationCreds> {
        const found = await this.connectors.integrationCredsFor(tenantId, connectionId);
        if (!found) {
            throw new NotFoundException({
                code: 'connection_not_found',
                message: 'La conexión con la tienda ya no existe.',
                data: { status: 404 },
            });
        }
        return found.creds;
    }
}

/** «WooCommerce · Tienda Demo» → «Tienda Demo». */
function storeLabel(connectionName: string): string {
    return connectionName.replace(/^WooCommerce\s*·\s*/i, '').trim() || connectionName;
}

export type { StoreMetaResource };
