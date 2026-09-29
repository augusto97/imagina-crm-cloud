import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    defaultStoreEditable,
    normalizeStoreEditable,
    STORE_META_RESOURCES,
    STORE_SYNC_RESOURCES,
    type ListBlueprint,
    type MapStoreMetaInput,
    type Role,
    type SetupStoreSyncInput,
    type StoreListMarker,
    type StoreListRole,
    type StoreMetaKey,
    type StoreMetaResource,
    type StoreSyncResource,
    type StoreSyncStatus,
    type UnmapStoreMetaInput,
    type UpdateStoreSyncInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { wooStoreUrl } from '../connectors/woocommerce/wc-api';
import { DRIZZLE, type Db } from '../db/client';
import { connectionSyncs, dashboards, lists, records, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListGroupsService } from '../lists/list-groups.service';
import { ListsService } from '../lists/lists.service';
import { stripStoreMarkers } from '../lists/store-guard';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService } from '../templates/blueprint.service';
import { RealtimeService } from '../realtime/realtime.service';
import { StoreRealtimeService } from './store-realtime.service';
import { StoreSyncEngine, type RunOptions } from './store-sync.engine';
import { StoreSyncQueue } from './store-sync.queue';
import { META_RESOURCES_OF, readLegacyPurchaseLists, readSettings, readState, type SyncSettings } from './store-sync.types';
import { wooGet } from './woocommerce/woo-fetch';
import { buildWooPack, WOO_LIST_KEYS, WOO_PACK_VERSION, WOO_ROOT_RESOURCES } from './woocommerce/woo-pack';
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
        // v0.1.213 — avisar a las pestañas abiertas que la marca de sus listas cambió.
        @Optional() private readonly rt?: RealtimeService,
    ) {
        // Borrar la CONEXIÓN (no sólo dejar de sincronizar) también tiene que
        // sacar los avisos de la tienda: si no, WooCommerce sigue llamando a
        // una URL muerta hasta desactivarlos solo (lo encontró la prueba contra
        // un WooCommerce real, v0.1.214). Se hace ANTES de borrar: después ya
        // no hay credenciales para hablarle a la tienda.
        this.connectors.onBeforeRemove(async (tenantId, connectionId) => {
            const row = await this.findSync(tenantId, connectionId);
            if (!row) return;
            await this.realtime.unregister(tenantId, row.id, await this.credsOf(tenantId, connectionId).catch(() => null));
            this.realtime.forget(tenantId);
        });
    }

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
            editable: { customers: defaultStoreEditable('customers'), products: defaultStoreEditable('products'), orders: defaultStoreEditable('orders') },
            orders_since: null,
            resources: { customers: true, products: true, orders: true },
            lists: empty,
            dashboard_id: null,
            inventory_dashboard_id: null,
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
            const ids = [...Object.values(settings.lists)].filter(
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
            editable: {
                customers: settings.editable.customers ?? defaultStoreEditable('customers'),
                products: settings.editable.products ?? defaultStoreEditable('products'),
                orders: settings.editable.orders ?? defaultStoreEditable('orders'),
            },
            orders_since: settings.orders_since,
            resources: settings.resources,
            lists: listsOut,
            dashboard_id: settings.dashboard_id,
            inventory_dashboard_id: settings.inventory_dashboard_id,
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

        // Una carpeta propia: las tres listas y nada más, bien a la vista.
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
            editable: {},
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
        };
        // Variaciones y líneas viven en la lista de su padre (como subtareas):
        // mismo id de lista y mismo mapa de campos.
        for (const r of STORE_SYNC_RESOURCES) {
            const key = WOO_LIST_KEYS[r];
            const idx = pack.lists.findIndex((l) => l.key === key);
            const list = made.lists[idx];
            if (list) settings.lists[r] = list.id;
            settings.fields[r] = made.fieldIds[key] ?? {};
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
     * Upgrade liviano: agrega a las listas que ya existen las columnas del pack
     * que todavía no tienen (sin tocar tableros, vistas ni registros), guarda
     * sus ids, actualiza la marca de las listas y pide una vuelta de productos
     * para llenarlas. Corre bajo el candado de la sincronización (lo toma quien
     * llama).
     */
    private async addMissingPackFields(
        tenantId: number,
        syncId: number,
        actor: number,
        settings: SyncSettings,
        full: ListBlueprint,
    ): Promise<void> {
        const keyToListId = new Map<string, number>();
        const existing = new Map<string, Map<string, number>>();
        for (const r of WOO_ROOT_RESOURCES) {
            const listId = settings.lists[r];
            if (!listId) continue;
            keyToListId.set(WOO_LIST_KEYS[r], listId);
            existing.set(WOO_LIST_KEYS[r], new Map(Object.entries(settings.fields[r] ?? {})));
        }
        const addition: ListBlueprint = {
            version: full.version,
            lists: full.lists
                .filter((l) => keyToListId.has(l.key))
                .map((l) => ({ ...l, views: [], automations: [], records: [] })),
            dashboards: [],
        };
        const made = await this.blueprints.extend(tenantId, actor, addition, keyToListId, existing, { groupId: settings.folder_id });
        if (made.warnings.length > 0) this.logger.warn(`Actualización del pack #${syncId}: ${made.warnings.join(' | ')}`);
        const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).for('update');
            const s = readSettings(locked!.settings);
            for (const r of WOO_ROOT_RESOURCES) {
                const got = made.fieldIds[WOO_LIST_KEYS[r]];
                if (got) s.fields[r] = { ...(s.fields[r] ?? {}), ...got };
            }
            // Variaciones y líneas comparten el mapa de su lista (pack 5).
            if (s.lists.products) s.fields.variations = s.fields.products;
            if (s.lists.orders) s.fields.line_items = s.fields.orders;
            const from = s.pack_version;
            s.pack_version = WOO_PACK_VERSION;
            await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, syncId));
            await this.audit.logInTx(tx, {
                tenantId,
                userId: null,
                action: 'store_sync.migrate',
                targetType: 'connection',
                targetId: locked!.connectionId,
                targetLabel: s.store_name,
                meta: { from, to: WOO_PACK_VERSION },
            });
            return { s, connectionId: locked!.connectionId };
        });
        await this.markLists(tenantId, fresh.connectionId, fresh.s);
        this.realtime.forget(tenantId);
        // Una vuelta completa de productos llena las columnas nuevas.
        if (fresh.s.lists.products) this.queue.enqueueRun(tenantId, syncId, { full: true, only: ['products'] });
    }

    /**
     * v0.1.213 — MIGRA una sincronización creada con un pack anterior al
     * pack 5. Idempotente y bajo el candado de la corrida. Devuelve si migró.
     *
     *  - Productos, Pedidos y Clientes se CONSERVAN (mismos ids: vistas,
     *    favoritos, comentarios y columnas propias siguen donde estaban).
     *  - Variaciones y Líneas de pedido pasan a ser SUBTAREAS de Productos y
     *    Pedidos: sus listas viejas se borran y la vuelta completa que se
     *    encola al terminar las vuelve a traer donde van. Son un espejo de la
     *    tienda: no se pierde nada que no esté allá.
     *  - Las columnas que dependían de esas listas (rollups de ventas, «En
     *    camino», «Sumar al stock»…) se reemplazan por las del pack nuevo.
     *  - Las listas de compras (proveedores, órdenes y líneas de compra) NO son
     *    de la tienda: vacías se borran; con datos quedan como listas comunes,
     *    desvinculadas — los datos de la empresa no se tocan.
     *  - Los dos tableros del pack se rehacen (los viejos apuntaban a las
     *    listas que ya no existen).
     */
    async upgradePack(tenantId: number, syncId: number, creds: IntegrationCreds): Promise<boolean> {
        const token = await this.engine.acquire(syncId);
        if (!token) return false;
        let connectionId = 0;
        try {
            const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1),
            );
            if (!row) return false;
            connectionId = row.connectionId;
            const settings = readSettings(row.settings);
            if (settings.pack_version >= WOO_PACK_VERSION) return false;
            const actor = row.createdBy ?? 0;
            const shop = await this.storeFormat(creds);
            const full = buildWooPack({ storeName: settings.store_name, currency: shop.currency, precision: shop.precision, phoneCountry: shop.country });
            const packFields = new Map(full.lists.map((l) => [l.key, l]));
            // Una tienda que ya está en el pack 5 sólo SUMA lo nuevo (v0.1.215:
            // el slug del producto). Re-correr la migración entera re-traería las
            // variaciones y rehacería los tableros sin motivo.
            if (settings.pack_version >= 5) {
                await this.addMissingPackFields(tenantId, syncId, actor, settings, full);
                return true;
            }

            const productsList = settings.lists.products ?? null;
            const ordersList = settings.lists.orders ?? null;
            const oldVariations = settings.lists.variations && settings.lists.variations !== productsList ? settings.lists.variations : null;
            const oldLines = settings.lists.line_items && settings.lists.line_items !== ordersList ? settings.lists.line_items : null;

            // 1) Columnas que dependían de las listas viejas: fuera (se recrean abajo).
            const REBUILD: Record<string, string[]> = {
                productos: ['unidades_vendidas', 'ingresos', 'vendidas_30d', 'cobertura_meses'],
                pedidos: [],
                clientes: [],
            };
            const keep = (key: string, slug: string) =>
                (packFields.get(key)?.fields ?? []).some((f) => f.slug === slug) && !(REBUILD[key] ?? []).includes(slug);
            for (const [resource, key] of [['products', 'productos'], ['orders', 'pedidos'], ['customers', 'clientes']] as const) {
                const listId = settings.lists[resource];
                const map = { ...(settings.fields[resource] ?? {}) };
                if (!listId) continue;
                for (const [slug, fieldId] of Object.entries(map)) {
                    if (keep(key, slug)) continue;
                    await this.fields.remove(tenantId, String(listId), String(fieldId), { internal: true }).catch(() => undefined);
                    delete map[slug];
                }
                settings.fields[resource] = map;
            }
            // Opciones nuevas de los selects que ya existían (tipo «Variación»,
            // tipo de fila del pedido…) y fuera la de «Por variación».
            await this.mergePackOptions(tenantId, settings, full);

            // 2) Lo nuevo del pack (campos y tableros), sobre las listas que quedan.
            const keyToListId = new Map<string, number>();
            const existing = new Map<string, Map<string, number>>();
            for (const r of WOO_ROOT_RESOURCES) {
                const listId = settings.lists[r];
                if (!listId) continue;
                keyToListId.set(WOO_LIST_KEYS[r], listId);
                existing.set(WOO_LIST_KEYS[r], new Map(Object.entries(settings.fields[r] ?? {})));
            }
            const addition: ListBlueprint = {
                version: full.version,
                lists: full.lists
                    .filter((l) => keyToListId.has(l.key))
                    .map((l) => ({ ...l, views: [], automations: [], records: [] })),
                // Sin productos no hay tablero de inventario; sin pedidos, no hay ventas.
                dashboards: full.dashboards.filter((d) =>
                    d.widgets.every((w) => w.list === 0 || keyToListId.has(w.list.$list)),
                ),
            };
            const made = await this.blueprints.extend(tenantId, actor, addition, keyToListId, existing, {
                groupId: settings.folder_id,
            });
            if (made.warnings.length > 0) this.logger.warn(`Migración del pack #${syncId}: ${made.warnings.join(' | ')}`);

            // 3) Las listas viejas y los tableros viejos.
            const purchase = readLegacyPurchaseLists(row.settings);
            const leftovers: string[] = [];
            await this.tenantDb.withTenant(tenantId, async (tx) => {
                // Los registros de variaciones y líneas se vuelven a traer como
                // subtareas: los viejos se retiran con sus vínculos (así, aunque
                // alguno no viviera en su lista aparte, no queda duplicado).
                const old = await tx
                    .select({ recordId: syncLinks.recordId })
                    .from(syncLinks)
                    .where(and(eq(syncLinks.syncId, syncId), inArray(syncLinks.resource, ['variations', 'line_items'])));
                const oldIds = [...new Set(old.map((o) => o.recordId))];
                for (let i = 0; i < oldIds.length; i += 1000) {
                    await tx
                        .update(records)
                        .set({ deletedAt: new Date() })
                        .where(and(eq(records.tenantId, tenantId), inArray(records.id, oldIds.slice(i, i + 1000))));
                }
                await tx
                    .delete(syncLinks)
                    .where(and(eq(syncLinks.syncId, syncId), inArray(syncLinks.resource, ['variations', 'line_items'])));
                for (const id of [settings.dashboard_id, settings.inventory_dashboard_id]) {
                    if (id) await tx.delete(dashboards).where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id)));
                }
            });
            for (const id of [oldVariations, oldLines]) {
                if (id) await this.lists.remove(tenantId, String(id)).catch(() => undefined);
            }
            for (const id of purchase) {
                const [{ n } = { n: 0 }] = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select({ n: sql<number>`count(*)::int` })
                        .from(records)
                        .where(and(eq(records.tenantId, tenantId), eq(records.listId, id), isNull(records.deletedAt))),
                );
                if (n === 0) {
                    await this.lists.remove(tenantId, String(id)).catch(() => undefined);
                } else {
                    // Datos de la empresa: quedan como una lista común.
                    await this.tenantDb.withTenant(tenantId, (tx) =>
                        tx.update(lists).set({ settings: sql`${lists.settings} - 'store_sync'` }).where(and(eq(lists.tenantId, tenantId), eq(lists.id, id))),
                    );
                    leftovers.push(String(id));
                }
            }

            // 4) Los ajustes nuevos.
            const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).for('update');
                const s = readSettings(locked!.settings);
                for (const r of WOO_ROOT_RESOURCES) {
                    const got = made.fieldIds[WOO_LIST_KEYS[r]];
                    s.fields[r] = { ...settings.fields[r], ...(got ?? {}) };
                }
                s.lists.variations = s.lists.products;
                s.fields.variations = s.fields.products;
                s.lists.line_items = s.lists.orders;
                s.fields.line_items = s.fields.orders;
                if (!s.lists.products) delete s.lists.variations;
                if (!s.lists.orders) delete s.lists.line_items;
                const ventas = addition.dashboards.findIndex((d) => !d.name.startsWith('Inventario'));
                const inventario = addition.dashboards.findIndex((d) => d.name.startsWith('Inventario'));
                s.dashboard_id = ventas >= 0 ? (made.dashboardIds[ventas] ?? null) : null;
                s.inventory_dashboard_id = inventario >= 0 ? (made.dashboardIds[inventario] ?? null) : null;
                s.pack_version = WOO_PACK_VERSION;
                s.low_stock_amount = shop.lowStock;
                await tx
                    .update(connectionSyncs)
                    .set({
                        settings: s as unknown as Record<string, unknown>,
                        // Las variaciones y las líneas se vuelven a traer enteras.
                        state: sql`${connectionSyncs.state} || ${JSON.stringify({ variations_full_at: null, cursors: {} })}::jsonb`,
                        updatedAt: new Date(),
                    })
                    .where(eq(connectionSyncs.id, syncId));
                await this.audit.logInTx(tx, {
                    tenantId,
                    userId: null,
                    action: 'store_sync.migrate',
                    targetType: 'connection',
                    targetId: row.connectionId,
                    targetLabel: settings.store_name,
                    meta: { from: settings.pack_version, to: WOO_PACK_VERSION, purchase_lists_kept: leftovers },
                });
                return s;
            });
            await this.markLists(tenantId, row.connectionId, fresh);
        } finally {
            await this.engine.release(syncId, token);
        }
        // Una vuelta completa trae las variaciones y las líneas como subtareas
        // (sin disparar automatizaciones: es una puesta al día).
        this.queue.enqueueRun(tenantId, syncId, { full: true, only: ['products', 'orders'] });
        this.realtime.forget(tenantId);
        void connectionId;
        return true;
    }

    /**
     * Suma a los selects existentes las opciones del pack que les faltan (y
     * quita las que el pack ya no usa: «Por variación» del inventario).
     */
    private async mergePackOptions(tenantId: number, settings: SyncSettings, full: ListBlueprint): Promise<void> {
        for (const r of WOO_ROOT_RESOURCES) {
            const listId = settings.lists[r];
            const bl = full.lists.find((l) => l.key === WOO_LIST_KEYS[r]);
            if (!listId || !bl) continue;
            const current = await this.fields.listByListId(tenantId, listId);
            for (const def of bl.fields) {
                if (def.type !== 'select') continue;
                const fieldId = settings.fields[r]?.[def.slug];
                const field = current.find((f) => f.id === fieldId);
                if (!field) continue;
                const have = Array.isArray(field.config.options) ? (field.config.options as Array<{ value: string }>) : [];
                const want = (def.config.options ?? []) as Array<{ value: string }>;
                const next = [
                    ...have.filter((o) => o.value !== 'por_variacion'),
                    ...want.filter((o) => !have.some((h) => h.value === o.value)),
                ];
                if (next.length === have.length && next.every((o, i) => o.value === have[i]?.value)) continue;
                await this.fields
                    .update(tenantId, String(listId), String(field.id), { config: { ...field.config, options: next } }, { internal: true })
                    .catch(() => undefined);
            }
        }
    }

    /**
     * Marca cada lista de la tienda (`settings.store_sync`): de qué conexión es,
     * qué guarda, si se puede editar desde la app y QUÉ columnas son de la
     * tienda (v0.1.213). Con eso el backend rechaza lo que WooCommerce no
     * permitiría y la interfaz lo bloquea antes (`store-rules.ts`).
     * Idempotente: sólo escribe donde cambió.
     */
    async markLists(tenantId: number, connectionId: number, settings: SyncSettings): Promise<void> {
        const markers: Array<[number, StoreListMarker]> = [];
        const metaOf = (...rs: StoreMetaResource[]) => [...new Set(rs.flatMap((r) => Object.values(settings.meta_map[r] ?? {})))];
        const roles = Object.entries(META_RESOURCES_OF) as Array<[StoreListRole, StoreMetaResource[]]>;
        for (const [role, metaRes] of roles) {
            const listId = settings.lists[role];
            if (!listId) continue;
            markers.push([
                listId,
                {
                    connection_id: connectionId,
                    role,
                    store_name: settings.store_name,
                    store_url: settings.store_url,
                    write_back: settings.write_back,
                    fields: settings.fields[role] ?? {},
                    meta_fields: metaOf(...metaRes),
                    editable: settings.editable[role] ?? null,
                },
            ]);
        }
        if (markers.length === 0) return;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            for (const [listId, marker] of markers) {
                const json = JSON.stringify({ store_sync: marker });
                await tx
                    .update(lists)
                    .set({ settings: sql`${lists.settings} || ${json}::jsonb` })
                    .where(
                        and(
                            eq(lists.tenantId, tenantId),
                            eq(lists.id, listId),
                            sql`${lists.settings}->'store_sync' IS DISTINCT FROM ${json}::jsonb->'store_sync'`,
                        ),
                    );
            }
        });
        // Las pestañas abiertas vuelven a leer la marca (candados, banner, altas).
        this.rt?.lists(tenantId);
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
            // Qué columnas se editan: sólo las del catálogo de esa lista o los
            // campos de plugins que ya se traen a columnas.
            for (const [r, slugs] of Object.entries(input.editable ?? {}) as Array<[StoreListRole, string[] | undefined]>) {
                if (!slugs) continue;
                const metaIds = META_RESOURCES_OF[r].flatMap((m) => Object.values(settings.meta_map[m] ?? {}));
                settings.editable[r] = normalizeStoreEditable(r, slugs, metaIds);
            }
            if (input.editable_toggle) {
                const { role: r, slug, on } = input.editable_toggle;
                const current = settings.editable[r] ?? defaultStoreEditable(r);
                const metaIds = META_RESOURCES_OF[r].flatMap((m) => Object.values(settings.meta_map[m] ?? {}));
                settings.editable[r] = normalizeStoreEditable(r, on ? [...current, slug] : current.filter((x) => x !== slug), metaIds);
            }
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
        // «Editar desde la app» y la elección de columnas cambian qué se puede tocar.
        if (input.write_back !== undefined || input.editable !== undefined || input.editable_toggle !== undefined) await this.markLists(tenantId, connectionId, readSettings(updated.settings));
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
            // Las listas quedan como listas comunes: sin la marca, sin bloqueos.
            await stripStoreMarkers(tx, tenantId, connectionId);
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'store_sync.delete',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
            });
        });
        this.rt?.lists(tenantId);
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
        // La columna nueva es de la tienda (sólo lectura).
        await this.markLists(tenantId, row.connectionId, readSettings((await this.requireSync(tenantId, connectionId)).settings));
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
        // Deja de traerse: la columna pasa a ser propia de la empresa (editable).
        await this.markLists(tenantId, row.connectionId, readSettings(updated.settings));
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
        let settings = readSettings(row.settings);
        if (settings.pack_version < WOO_PACK_VERSION) {
            const upgraded = await this.upgradePack(tenantId, syncId, creds).catch((err) => {
                this.logger.warn(`No se pudo actualizar el pack #${syncId}: ${String(err)}`);
                return false;
            });
            // Lo leído antes de actualizar ya no vale: marcar las listas con eso
            // pisaría la marca nueva (columnas que no existen, faltan las nuevas).
            if (upgraded) {
                const fresh = await this.findSync(tenantId, row.connectionId);
                if (fresh) settings = readSettings(fresh.settings);
            }
        }
        await this.markLists(tenantId, row.connectionId, settings).catch(() => undefined);
        const ran = await this.engine.run(tenantId, syncId, creds, opts);
        // Modo tiempo real: cada vuelta (la red de seguridad horaria) revisa que
        // los avisos sigan activos en la tienda.
        if (ran && settings.mode === 'realtime') {
            await this.realtime.ensure(tenantId, syncId, creds, settings);
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
