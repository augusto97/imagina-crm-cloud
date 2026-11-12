import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    SHOP_CATALOG_FIELD_TYPES,
    SHOP_VARIANT_ATTRIBUTE_TYPES,
    SHOP_ITEM_ID_RE,
    SHOP_LIST_MARKER_KEY,
    collectionCurrencyError,
    defaultShopConfig,
    newShopItemId,
    readMirrorListMarker,
    readShopConfig,
    readShopListMarker,
    resolveTitleFieldId,
    shopCurrencyDecimals,
    shopProblems,
    suggestShopCatalog,
    type CollectionConnection,
    type CreateShopInput,
    type Field,
    type PlatformShopDto,
    type ShopCatalogFields,
    type ShopConfig,
    type ShopDto,
    type ShopOptions,
    type ShopOrdersLists,
    type ShopProblem,
    type UpdateShopInput,
} from '@imagina-base/shared';
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { lists, memberships, records, shopOrders, shops, tenants, users, type ShopRow } from '../db/schema';
import { CollectionsService } from '../collections/collections.service';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { staffRoleSql } from '../helpdesk/staff-roles';
import { ListsService } from '../lists/lists.service';
import { PlatformNetworkService } from '../network/platform-network.service';
import { NO_PUBLIC_CACHE, type PublicCacheLike } from '../public-cache/public-cache';
import { PublicCacheService } from '../public-cache/public-cache.service';
import { BlueprintService } from '../templates/blueprint.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { LATER_ORDER_COLUMNS, LINE_ROLES, PROTECTED_ORDER_ROLES, packFieldIds, shopPackBlueprint } from './shop-pack';

/**
 * v0.1.412 (ADR-S103) — La tienda vista por el equipo: crearla (con su pack
 * de listas de pedidos), configurarla, publicarla y borrarla.
 *
 * Lo que decide el SERVIDOR y nunca llega del navegador: las listas de los
 * pedidos (`config.orders`), que los campos del catálogo sean de esa lista y
 * de un tipo que sirva, a quién le llegan los avisos y si se puede publicar.
 */

export const shopCacheKey = (token: string): string => `shop:${token}`;

export class ShopNotReadyError extends BadRequestException {}

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

function newToken(): string {
    return randomBytes(18).toString('base64url');
}

@Injectable()
export class ShopService {
    private readonly pcache: PublicCacheLike;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        @Optional() cache?: PublicCacheService,
        @Optional() private readonly moduleRef?: ModuleRef,
        @Optional() private readonly network?: PlatformNetworkService,
        @Optional() private readonly domains?: DomainsService,
        // v0.1.413 — las cuentas de cobro del equipo para el pago en línea.
        @Optional() private readonly collections?: CollectionsService,
    ) {
        this.pcache = cache ?? NO_PUBLIC_CACHE;
    }

    /** v0.1.413 — Las cuentas de cobro del equipo (Mercado Pago, Wompi, PayPal). Se leen ANTES de abrir la transacción. */
    private async payTeam(tenantId: number): Promise<CollectionConnection[]> {
        if (!this.collections) return [];
        return this.collections.teamConnections(tenantId).catch(() => []);
    }

    private get blueprints(): BlueprintService {
        const svc = this.moduleRef?.get(BlueprintService, { strict: false });
        if (!svc) throw new Error('BlueprintService no disponible');
        return svc;
    }

    private async embedOrigin(tenantId: number): Promise<string | null> {
        if (!this.network?.embedOrigin()) return null;
        const base = this.domains ? await this.domains.baseUrlFor(tenantId, 'app').catch(() => undefined) : undefined;
        return this.network.embedOriginFor(base);
    }

    /** Lo que cambió en la tienda: la página guardada deja de valer en todos los servidores. */
    forget(...tokens: Array<string | null | undefined>): void {
        for (const t of tokens) if (t) this.pcache.invalidate(shopCacheKey(t));
    }

    // ─────────────────────────── Lectura ───────────────────────────

    async listForList(tenantId: number, listId: number): Promise<ShopDto[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.listId, listId))).orderBy(asc(shops.id)),
        );
        const out: ShopDto[] = [];
        for (const r of rows) out.push(await this.toDto(tenantId, r));
        const embed = await this.embedOrigin(tenantId);
        return out.map((d) => ({ ...d, embed_origin: embed }));
    }

    async get(tenantId: number, id: number): Promise<ShopDto> {
        const row = await this.tenantDb.withTenant(tenantId, (tx) => this.load(tx, tenantId, id));
        const dto = await this.toDto(tenantId, row);
        return { ...dto, embed_origin: await this.embedOrigin(tenantId) };
    }

    /** La fila (para el controller: bitácora). */
    async row(tenantId: number, id: number): Promise<ShopRow> {
        return this.tenantDb.withTenant(tenantId, (tx) => this.load(tx, tenantId, id));
    }

    async options(tenantId: number, id: number): Promise<ShopOptions> {
        const team = await this.payTeam(tenantId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id);
            const list = await this.lists.getWithinTx(tx, tenantId, String(row.listId));
            const fields = await this.fields.listByListIdWithinTx(tx, tenantId, row.listId);
            const titleId = resolveTitleFieldId(fields, list.settings);
            const [products] = await tx
                .select({ n: count() })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, row.listId), isNull(records.deletedAt), isNull(records.parentId)));
            const others = await tx
                .select({ id: shops.id, name: shops.name, config: shops.config })
                .from(shops)
                .where(and(eq(shops.tenantId, tenantId), ne(shops.id, id)))
                .orderBy(asc(shops.name));
            const orderListIds = others.map((o) => readShopConfig(o.config).orders.list_id).filter((x): x is number => x !== null);
            const names = orderListIds.length
                ? new Map(
                      (await tx.select({ id: lists.id, name: lists.name }).from(lists).where(and(eq(lists.tenantId, tenantId), inArray(lists.id, orderListIds)))).map((l) => [
                          l.id,
                          l.name,
                      ]),
                  )
                : new Map<number, string>();
            const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
            const branding = ((t?.settings ?? {}) as Record<string, unknown>).branding as { primary_color?: unknown } | undefined;
            const brandColor = typeof branding?.primary_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(branding.primary_color) ? branding.primary_color : null;
            return {
                list: { id: list.id, name: list.name, slug: list.slug },
                brand_color: brandColor,
                fields: fields.map((f) => ({ id: f.id, label: f.label, slug: f.slug, type: f.type, is_primary: f.id === titleId })),
                suggested: suggestShopCatalog(fields.map((f) => ({ id: f.id, type: f.type, label: f.label, slug: f.slug, is_primary: f.id === titleId }))),
                members: await this.staff(tx, tenantId),
                products_count: Number(products?.n ?? 0),
                other_shops: others.map((o) => {
                    const lid = readShopConfig(o.config).orders.list_id;
                    return { id: o.id, name: o.name, orders_list_name: lid !== null ? (names.get(lid) ?? null) : null };
                }),
                payment_connections: team.map((c) => ({ id: c.id, name: c.name, provider: c.provider, test_mode: c.test_mode })),
                categories: await this.catalogCategories(tx, tenantId, row, fields),
            };
        });
    }

    /** v0.1.415 — Las categorías del catálogo: las opciones del campo, o los textos que ya usan los productos. */
    private async catalogCategories(tx: Tx, tenantId: number, row: ShopRow, fields: Field[]): Promise<string[]> {
        const id = readShopConfig(row.config).catalog.category;
        const field = id !== null ? fields.find((f) => f.id === id) : undefined;
        if (!field) return [];
        if (field.type !== 'text') {
            const opts = (field.config as { options?: unknown }).options;
            if (!Array.isArray(opts)) return [];
            return opts
                .map((o) => (o && typeof o === 'object' ? ((o as { label?: unknown; value?: unknown }).label ?? (o as { value?: unknown }).value) : null))
                .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
                .slice(0, 100);
        }
        const key = `f${field.id}`;
        const rows = await tx
            .selectDistinct({ v: sql<string>`trim(${records.data}->>${key})` })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), eq(records.listId, row.listId), isNull(records.deletedAt), sql`coalesce(trim(${records.data}->>${key}), '') <> ''`))
            .limit(100);
        return rows.map((r) => r.v).sort((a, b) => a.localeCompare(b, 'es'));
    }

    // ─────────────────────────── Alta ───────────────────────────

    async create(tenantId: number, userId: number, input: CreateShopInput): Promise<ShopDto> {
        const list = await this.lists.get(tenantId, String(input.list_id)).catch(() => null);
        if (!list) throw new NotFoundException({ code: 'list_not_found', message: 'Esa lista no existe.', data: { status: 404 } });
        // Una lista que manda una tienda WooCommerce o un sitio WordPress ya
        // tiene su tienda: aquí no se venden productos que alguien edita allá.
        if (readMirrorListMarker(list.settings)) badRequest('shop_mirror_list', `«${list.name}» la manda una tienda o un sitio: elige otra lista como catálogo.`);
        if (readShopListMarker(list.settings)) badRequest('shop_orders_list', `«${list.name}» es una lista de pedidos de una tienda: elige la lista de los productos.`);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const titleId = resolveTitleFieldId(fields, list.settings);
        const config = defaultShopConfig();
        config.catalog = suggestShopCatalog(fields.map((f) => ({ id: f.id, type: f.type, label: f.label, slug: f.slug, is_primary: f.id === titleId })));
        const priceField = fields.find((f) => f.id === config.catalog.price);
        const cur = (priceField?.config as { currency?: unknown } | undefined)?.currency;
        if (priceField?.type === 'currency' && typeof cur === 'string' && /^[A-Z]{3}$/.test(cur)) config.currency = cur;
        config.texts.title = input.name.slice(0, 120);
        const company = await this.companyName(tenantId);
        config.seller.legal_name = company.slice(0, 160);

        // Las listas de los pedidos: las de otra tienda de la empresa, o un pack nuevo.
        let orders: ShopConfig['orders'] | null = null;
        if (input.reuse_orders_from) {
            const other = await this.tenantDb.withTenant(tenantId, (tx) => this.load(tx, tenantId, input.reuse_orders_from!)).catch(() => null);
            if (!other) badRequest('shop_not_found', 'Esa tienda no existe.');
            const oc = readShopConfig(other!.config).orders;
            if (oc.list_id === null) badRequest('shop_no_orders', 'Esa tienda no tiene listas de pedidos.');
            orders = oc;
        } else {
            const res = await this.blueprints.materialize(
                tenantId,
                userId,
                shopPackBlueprint({ shopName: input.name, catalogListId: list.id, catalogListName: list.name, currency: config.currency, withDashboard: true }),
                { groupId: list.group_id ?? null, includeRecords: false },
            );
            const byKey = new Map<string, number>();
            for (const [i, l] of res.lists.entries()) byKey.set(['pedidos', 'lineas', 'clientes'][i] ?? `x${i}`, l.id);
            const ids = packFieldIds(res.fieldIds);
            orders = {
                list_id: byKey.get('pedidos') ?? null,
                lines_list_id: byKey.get('lineas') ?? null,
                customers_list_id: byKey.get('clientes') ?? null,
                fields: ids.fields as Record<string, number>,
                line_fields: ids.line_fields as Record<string, number>,
                customer_fields: ids.customer_fields as Record<string, number>,
            };
        }
        config.orders = orders!;

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [inserted] = await tx
                .insert(shops)
                .values({ tenantId, listId: list.id, name: input.name, token: newToken(), enabled: false, config, settings: {}, createdBy: userId })
                .returning();
            await this.writeMarkers(tx, tenantId, inserted!.id, config.orders, 'add');
            return inserted!;
        });
        return this.get(tenantId, row.id);
    }

    // ─────────────────────────── Cambios ───────────────────────────

    async update(tenantId: number, id: number, input: UpdateShopInput): Promise<{ dto: ShopDto; before: ShopRow; after: ShopRow }> {
        const team = await this.payTeam(tenantId);
        const res = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.load(tx, tenantId, id, true);
            const saved = readShopConfig(row.config);
            const config = input.config !== undefined ? await this.cleanConfig(tx, tenantId, row, input.config, saved, team) : saved;
            const enabled = input.enabled ?? row.enabled;
            if (enabled && !row.enabled && row.suspendedAt) {
                throw new ForbiddenException({
                    code: 'shop_suspended',
                    message: 'La plataforma suspendió esta tienda: escribe a soporte para reactivarla.',
                    data: { status: 403 },
                });
            }
            if (enabled) {
                const problems = await this.problemsFor(tx, tenantId, row.listId, config, team);
                if (problems.length > 0) {
                    throw new ShopNotReadyError({
                        code: 'shop_not_ready',
                        message: `Antes de publicarla: ${problems[0]!.text}`,
                        data: { status: 400, problems },
                    });
                }
            }
            const [next] = await tx
                .update(shops)
                .set({
                    name: input.name ?? row.name,
                    enabled,
                    config,
                    ...(input.theme !== undefined ? { settings: { ...(row.settings ?? {}), theme: input.theme } } : {}),
                    updatedAt: new Date(),
                })
                .where(and(eq(shops.id, id), eq(shops.tenantId, tenantId)))
                .returning();
            return { before: row, after: next! };
        });
        this.forget(res.before.token);
        const dto = await this.toDto(tenantId, res.after);
        return { dto: { ...dto, embed_origin: await this.embedOrigin(tenantId) }, before: res.before, after: res.after };
    }

    async regenerate(tenantId: number, id: number): Promise<ShopDto> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const r = await this.load(tx, tenantId, id, true);
            await tx.update(shops).set({ token: newToken(), updatedAt: new Date() }).where(and(eq(shops.id, id), eq(shops.tenantId, tenantId)));
            return r;
        });
        this.forget(row.token);
        return this.get(tenantId, id);
    }

    /** Borra la tienda. Los pedidos y los clientes QUEDAN (son datos de la empresa); sus columnas se liberan. */
    async remove(tenantId: number, id: number): Promise<ShopRow> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const r = await this.load(tx, tenantId, id, true);
            await this.writeMarkers(tx, tenantId, id, readShopConfig(r.config).orders, 'remove');
            await tx.delete(shops).where(and(eq(shops.id, id), eq(shops.tenantId, tenantId)));
            return r;
        });
        this.forget(row.token);
        return row;
    }

    /** Plataforma (ADR-S15): suspender o reactivar una tienda de cualquier empresa. */
    async setSuspended(tenantId: number, id: number, suspended: boolean, reason: string | null): Promise<ShopRow> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const r = await this.load(tx, tenantId, id, true);
            await tx
                .update(shops)
                .set(
                    suspended
                        ? { suspendedAt: new Date(), suspendedReason: (reason ?? '').slice(0, 500) || null, enabled: false, updatedAt: new Date() }
                        : { suspendedAt: null, suspendedReason: null, updatedAt: new Date() },
                )
                .where(and(eq(shops.id, id), eq(shops.tenantId, tenantId)));
            return r;
        });
        this.forget(row.token);
        return row;
    }

    // ─────────────────────────── Internos ───────────────────────────

    private async load(tx: Tx, tenantId: number, id: number, lock = false): Promise<ShopRow> {
        const q = tx.select().from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.id, id))).limit(1);
        const [row] = lock ? await q.for('update') : await q;
        if (!row) throw new NotFoundException({ code: 'shop_not_found', message: 'Esa tienda no existe.', data: { status: 404 } });
        return row;
    }

    private async companyName(tenantId: number): Promise<string> {
        const [t] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return t?.name ?? '';
    }

    private async staff(tx: Tx, tenantId: number, only?: number[]): Promise<Array<{ id: number; name: string }>> {
        const where = [eq(memberships.tenantId, tenantId), staffRoleSql(), isNull(users.disabledAt)];
        if (only) where.push(inArray(memberships.userId, only));
        const rows = await tx
            .select({ id: users.id, name: users.name, email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(...where))
            .orderBy(asc(users.name))
            .limit(500);
        return rows.map((r) => ({ id: r.id, name: (r.name ?? '').trim() || r.email }));
    }

    /** Valida lo que manda el editor. `orders` nunca se toma del navegador. */
    private async cleanConfig(tx: Tx, tenantId: number, row: ShopRow, raw: Record<string, unknown>, saved: ShopConfig, team: CollectionConnection[]): Promise<ShopConfig> {
        const next = readShopConfig({ ...raw, orders: saved.orders });
        // v0.1.413 — Sólo una cuenta de cobro DEL EQUIPO: la tienda no es de nadie en particular.
        if (next.payments.online.connection_id !== null && !team.some((c) => c.id === next.payments.online.connection_id)) {
            next.payments.online = { ...next.payments.online, connection_id: null };
        }
        const fields = await this.fields.listByListIdWithinTx(tx, tenantId, row.listId);
        const byId = new Map(fields.map((f) => [f.id, f]));
        const catalog: ShopCatalogFields = { ...next.catalog };
        const used = new Map<number, string>();
        for (const role of Object.keys(catalog) as Array<keyof ShopCatalogFields>) {
            const fid = catalog[role];
            if (fid === null) continue;
            const f = byId.get(fid);
            if (!f) badRequest('invalid_shop_catalog', 'Uno de los campos elegidos ya no está en la lista.');
            if (!SHOP_CATALOG_FIELD_TYPES[role].includes(f!.type)) badRequest('invalid_shop_catalog', `«${f!.label}» no sirve para ese papel: es de otro tipo.`);
            const other = used.get(fid);
            if (other) badRequest('invalid_shop_catalog', `«${f!.label}» no puede cumplir dos papeles a la vez.`);
            used.set(fid, role);
        }
        next.catalog = catalog;
        // v0.1.414 — Atributos de las variantes: selección o texto de la lista, sin repetir y sin ser un papel del catálogo.
        const attrs: number[] = [];
        for (const fid of next.variants.attributes) {
            const f = byId.get(fid);
            if (!f || !(SHOP_VARIANT_ATTRIBUTE_TYPES as readonly string[]).includes(f.type) || used.has(fid) || attrs.includes(fid)) continue;
            attrs.push(fid);
        }
        next.variants = { ...next.variants, attributes: attrs };
        // Formas de entrega con ids únicos.
        const seen = new Set<string>();
        next.delivery = next.delivery
            .map((d) => (SHOP_ITEM_ID_RE.test(d.id) && !seen.has(d.id) ? d : { ...d, id: newShopItemId(seen) }))
            .map((d) => {
                seen.add(d.id);
                return d;
            });
        // Avisos: sólo personas del equipo.
        if (next.checkout.notify_user_ids.length > 0) {
            const alive = new Set((await this.staff(tx, tenantId, next.checkout.notify_user_ids)).map((m) => m.id));
            next.checkout.notify_user_ids = next.checkout.notify_user_ids.filter((u) => alive.has(u));
        }
        next.allowed_domains = cleanDomains(next.allowed_domains);
        next.payments.whatsapp.phone = next.payments.whatsapp.phone.replace(/[\s().-]/g, '');
        return next;
    }

    private async problemsFor(tx: Tx, tenantId: number, listId: number, config: ShopConfig, team: CollectionConnection[]): Promise<ShopProblem[]> {
        const fields = await this.fields.listByListIdWithinTx(tx, tenantId, listId);
        const price = config.catalog.price ? fields.find((f) => f.id === config.catalog.price) : undefined;
        const ordersOk = await this.ordersListsAlive(tx, tenantId, config.orders);
        const conn = team.find((c) => c.id === config.payments.online.connection_id) ?? null;
        return shopProblems(config, {
            hasOrdersLists: ordersOk,
            priceFieldOk: !!price && SHOP_CATALOG_FIELD_TYPES.price.includes(price.type),
            onlineConnectionOk: conn !== null,
            onlineCurrencyError: conn ? collectionCurrencyError(conn.provider, config.currency) : null,
        });
    }

    private async ordersListsAlive(tx: Tx, tenantId: number, orders: ShopConfig['orders']): Promise<boolean> {
        const ids = [orders.list_id, orders.lines_list_id].filter((x): x is number => x !== null);
        if (ids.length < 2) return false;
        const rows = await tx
            .select({ id: lists.id })
            .from(lists)
            .where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids), isNull(lists.deletedAt)));
        return rows.length === ids.length;
    }

    /**
     * v0.1.415 — Las columnas «Descuento» y «Cupón» en «Pedidos» de una tienda
     * creada antes de los cupones. Usa las que ya existan con ese nombre y
     * tipo; si no, las crea. Todas las tiendas que escriben en esa lista
     * quedan con ellas (y con su candado).
     */
    async ensureOrderColumns(tenantId: number, shopId: number): Promise<void> {
        const row = await this.row(tenantId, shopId);
        const config = readShopConfig(row.config);
        const listId = config.orders.list_id;
        if (listId === null) return;
        const missing = LATER_ORDER_COLUMNS.filter((c) => typeof config.orders.fields[c.role] !== 'number');
        if (missing.length === 0) return;
        const current = await this.tenantDb.withTenant(tenantId, (tx) => this.fields.listByListIdWithinTx(tx, tenantId, listId));
        const found: Record<string, number> = {};
        for (const c of missing) {
            const existing = current.find((f) => f.slug === c.slug && f.type === c.type);
            if (existing) {
                found[c.role] = existing.id;
                continue;
            }
            const extra = c.type === 'currency' ? { config: { currency: config.currency, precision: shopCurrencyDecimals(config.currency) } } : {};
            const created = await this.fields.create(tenantId, String(listId), {
                label: c.label,
                slug: current.some((f) => f.slug === c.slug) ? undefined : c.slug,
                type: c.type,
                ...extra,
            } as never);
            found[c.role] = created.id;
        }
        const tokens = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx.select().from(shops).where(eq(shops.tenantId, tenantId)).orderBy(asc(shops.id)).for('update');
            const out: string[] = [];
            for (const r of rows) {
                const c = readShopConfig(r.config);
                if (c.orders.list_id !== listId) continue;
                const fields = { ...c.orders.fields };
                for (const [role, id] of Object.entries(found)) if (typeof fields[role] !== 'number') fields[role] = id;
                const next: ShopConfig = { ...c, orders: { ...c.orders, fields } };
                await tx.update(shops).set({ config: next, updatedAt: new Date() }).where(and(eq(shops.tenantId, tenantId), eq(shops.id, r.id)));
                await this.writeMarkers(tx, tenantId, r.id, next.orders, 'add');
                out.push(r.token);
            }
            return out;
        });
        for (const t of tokens) this.forget(t);
    }

    /**
     * La marca `shop_orders_of` en las listas de pedidos y líneas: qué tiendas
     * escriben ahí y qué columnas quedan con candado. Varias tiendas pueden
     * compartir las mismas listas; la marca se va con la última.
     */
    private async writeMarkers(tx: Tx, tenantId: number, shopId: number, orders: ShopConfig['orders'], op: 'add' | 'remove'): Promise<void> {
        const targets: Array<{ listId: number | null; role: 'orders' | 'lines'; fieldIds: number[] }> = [
            {
                listId: orders.list_id,
                role: 'orders',
                fieldIds: PROTECTED_ORDER_ROLES.map((r) => orders.fields[r]).filter((x): x is number => typeof x === 'number'),
            },
            {
                listId: orders.lines_list_id,
                role: 'lines',
                fieldIds: LINE_ROLES.map((r) => orders.line_fields[r]).filter((x): x is number => typeof x === 'number'),
            },
        ];
        for (const t of targets) {
            if (t.listId === null) continue;
            const [l] = await tx
                .select({ settings: lists.settings })
                .from(lists)
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, t.listId)))
                .for('update')
                .limit(1);
            if (!l) continue;
            const prev = readShopListMarker(l.settings);
            const shopIds = new Set(prev?.shop_ids ?? []);
            if (op === 'add') shopIds.add(shopId);
            else shopIds.delete(shopId);
            if (shopIds.size === 0) {
                await tx
                    .update(lists)
                    .set({ settings: sql`${lists.settings} - ${SHOP_LIST_MARKER_KEY}::text` })
                    .where(and(eq(lists.tenantId, tenantId), eq(lists.id, t.listId)));
                continue;
            }
            const marker = { shop_ids: [...shopIds], role: t.role, field_ids: [...new Set([...(prev?.field_ids ?? []), ...t.fieldIds])] };
            await tx
                .update(lists)
                .set({ settings: sql`jsonb_set(coalesce(${lists.settings}, '{}'::jsonb), ${`{${SHOP_LIST_MARKER_KEY}}`}::text[], ${JSON.stringify(marker)}::jsonb)` })
                .where(and(eq(lists.tenantId, tenantId), eq(lists.id, t.listId)));
        }
    }

    private async toDto(tenantId: number, row: ShopRow): Promise<ShopDto> {
        const config = readShopConfig(row.config);
        const embed = await this.embedOrigin(tenantId);
        const team = await this.payTeam(tenantId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const problems = await this.problemsFor(tx, tenantId, row.listId, config, team);
            let orders: ShopOrdersLists | null = null;
            if (config.orders.list_id !== null) {
                const [l] = await tx
                    .select({ id: lists.id, name: lists.name, slug: lists.slug })
                    .from(lists)
                    .where(and(eq(lists.tenantId, tenantId), eq(lists.id, config.orders.list_id), isNull(lists.deletedAt)))
                    .limit(1);
                if (l) orders = { list_id: l.id, list_name: l.name, list_slug: l.slug, lines_list_id: config.orders.lines_list_id, customers_list_id: config.orders.customers_list_id };
            }
            const [n] = await tx.select({ n: count() }).from(shopOrders).where(and(eq(shopOrders.tenantId, tenantId), eq(shopOrders.shopId, row.id)));
            return {
                id: row.id,
                list_id: row.listId,
                name: row.name,
                enabled: row.enabled,
                suspended: row.suspendedAt !== null,
                suspended_reason: row.suspendedReason,
                config,
                public_path: `/api/v1/public/s/${row.token}`,
                problems,
                orders,
                orders_count: Number(n?.n ?? 0),
                embed_origin: embed,
                created_at: row.createdAt.toISOString(),
                updated_at: row.updatedAt.toISOString(),
            };
        });
    }

    /** Plataforma: las tiendas de una empresa (con cuántos pedidos tiene cada una). */
    async platformList(tenantId: number): Promise<PlatformShopDto[]> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx.select().from(shops).where(eq(shops.tenantId, tenantId)).orderBy(shops.id).limit(200);
            if (rows.length === 0) return [];
            const counts = await tx
                .select({ shopId: shopOrders.shopId, n: count() })
                .from(shopOrders)
                .where(and(eq(shopOrders.tenantId, tenantId), inArray(shopOrders.shopId, rows.map((r) => r.id))))
                .groupBy(shopOrders.shopId);
            const byShop = new Map(counts.map((c) => [c.shopId, Number(c.n)]));
            return rows.map((r) => ({
                id: r.id,
                tenant_id: r.tenantId,
                name: r.name,
                enabled: r.enabled,
                suspended: r.suspendedAt !== null,
                suspended_reason: r.suspendedReason,
                public_path: `/api/v1/public/s/${r.token}`,
                orders_count: byShop.get(r.id) ?? 0,
                created_at: r.createdAt.toISOString(),
            }));
        });
    }

    /** Plataforma: la empresa dueña de una tienda (la consola trabaja por la conexión base). */
    async tenantOf(id: number): Promise<number | null> {
        const [r] = await this.db.select({ tenantId: shops.tenantId }).from(shops).where(eq(shops.id, id)).limit(1);
        return r?.tenantId ?? null;
    }
}

/** Sitios donde se puede insertar: sólo el dominio, sin protocolo ni ruta. */
function cleanDomains(raw: readonly string[]): string[] {
    const out: string[] = [];
    for (const r of raw) {
        const d = r
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, '')
            .replace(/:\d+$/, '');
        if (/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/.test(d) && !out.includes(d)) out.push(d);
        if (out.length >= 20) break;
    }
    return out;
}
