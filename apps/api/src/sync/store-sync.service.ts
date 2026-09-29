import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    STORE_META_RESOURCES,
    STORE_SYNC_RESOURCES,
    type MapStoreMetaInput,
    type Role,
    type SetupStoreSyncInput,
    type StoreMetaKey,
    type StoreMetaResource,
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
import { connectionSyncs, lists, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListGroupsService } from '../lists/list-groups.service';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService } from '../templates/blueprint.service';
import { StoreSyncEngine, type RunOptions } from './store-sync.engine';
import { StoreSyncQueue } from './store-sync.queue';
import { readSettings, readState, type SyncSettings } from './store-sync.types';
import { wooGet } from './woocommerce/woo-fetch';
import { buildWooPack, WOO_LIST_KEYS } from './woocommerce/woo-pack';

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
            realtime: { active: false, received: 0, last_received_at: null, error: null },
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
            const ids = Object.values(settings.lists).filter((v): v is number => typeof v === 'number');
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
            },
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
        };
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
        this.queue.enqueueRun(tenantId, row.id, { full: true });
        return this.toStatus(tenantId, row, conn.name);
    }

    /** Moneda, decimales y país de la tienda (para los campos de dinero y teléfono). */
    private async storeFormat(creds: IntegrationCreds): Promise<{ currency: string; precision: number; country: string | null }> {
        const out = { currency: 'USD', precision: 2, country: null as string | null };
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
        return this.toStatus(tenantId, updated, conn.name);
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
        return this.engine.run(tenantId, syncId, creds, opts);
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
