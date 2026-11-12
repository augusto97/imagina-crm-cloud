import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { lists } from './lists';
import { records } from './records';
import { tenants } from './tenants';

/**
 * v0.1.412 (ADR-S103) — Tienda desde una lista. RLS: dato de la empresa. El
 * `token` es la dirección pública (único global) y el endpoint público lo
 * resuelve por la conexión base, como los formularios y el widget.
 */
export const shops = pgTable(
    'shops',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        listId: bigint('list_id', { mode: 'number' })
            .notNull()
            .references(() => lists.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 120 }).notNull(),
        token: varchar('token', { length: 64 }).notNull(),
        enabled: boolean('enabled').notNull().default(false),
        config: jsonb('config').$type<Record<string, unknown>>().notNull(),
        settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
        suspendedAt: timestamp('suspended_at', { withTimezone: true }),
        suspendedReason: text('suspended_reason'),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('shops_tenant_ix').on(t.tenantId), index('shops_list_ix').on(t.listId), uniqueIndex('shops_token_ux').on(t.token)],
);
export type ShopRow = typeof shops.$inferSelect;

/** Lo que la tienda sabe de cada pedido; el registro de «Pedidos» es lo que trabaja el equipo. */
export const shopOrders = pgTable(
    'shop_orders',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        shopId: bigint('shop_id', { mode: 'number' }).references(() => shops.id, { onDelete: 'set null' }),
        recordId: bigint('record_id', { mode: 'number' }).references(() => records.id, { onDelete: 'set null' }),
        token: varchar('token', { length: 64 }).notNull(),
        number: varchar('number', { length: 40 }).notNull().default(''),
        paymentMethod: varchar('payment_method', { length: 16 }).notNull(),
        paymentStatus: varchar('payment_status', { length: 16 }).notNull().default('pendiente'),
        currency: varchar('currency', { length: 8 }).notNull(),
        subtotal: numeric('subtotal', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
        shipping: numeric('shipping', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
        discount: numeric('discount', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
        total: numeric('total', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
        lines: jsonb('lines').$type<unknown[]>().notNull(),
        customer: jsonb('customer').$type<Record<string, unknown>>().notNull(),
        delivery: jsonb('delivery').$type<Record<string, unknown>>().notNull(),
        origin: jsonb('origin').$type<Record<string, unknown>>().notNull(),
        catalogListId: bigint('catalog_list_id', { mode: 'number' }),
        stockFieldId: bigint('stock_field_id', { mode: 'number' }),
        statusFieldId: bigint('status_field_id', { mode: 'number' }),
        stockState: varchar('stock_state', { length: 12 }).notNull().default('none'),
        paymentLinkId: bigint('payment_link_id', { mode: 'number' }),
        /** v0.1.415 — El cupón usado (el código queda aunque el cupón se borre). */
        couponId: bigint('coupon_id', { mode: 'number' }),
        couponCode: varchar('coupon_code', { length: 40 }).notNull().default(''),
        /** v0.1.416 — Descargas hechas por archivo: `{"<producto>:<archivo>": n}`. */
        downloads: jsonb('downloads').$type<Record<string, number>>().notNull().default({}),
        expiresAt: timestamp('expires_at', { withTimezone: true }),
        paidAt: timestamp('paid_at', { withTimezone: true }),
        cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('shop_orders_token_ux').on(t.token),
        index('shop_orders_shop_ix').on(t.tenantId, t.shopId, t.createdAt),
        index('shop_orders_record_ix').on(t.recordId),
        // v0.1.416 — «Mis pedidos» (el índice de la migración 0123 es por lower(customer->>'email')).
    ],
);
export type ShopOrderRow = typeof shopOrders.$inferSelect;

/**
 * v0.1.415 — Cupones de la tienda. Los usos se cuentan de `shop_orders`
 * (sin los cancelados) bajo el bloqueo de esta fila: cancelar un pedido libera
 * su uso sin contadores que sincronizar.
 */
export const shopCoupons = pgTable(
    'shop_coupons',
    {
        id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
        tenantId: bigint('tenant_id', { mode: 'number' })
            .notNull()
            .references(() => tenants.id, { onDelete: 'cascade' }),
        shopId: bigint('shop_id', { mode: 'number' })
            .notNull()
            .references(() => shops.id, { onDelete: 'cascade' }),
        code: varchar('code', { length: 40 }).notNull(),
        description: varchar('description', { length: 200 }).notNull().default(''),
        kind: varchar('kind', { length: 16 }).notNull(),
        value: numeric('value', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
        minSubtotal: numeric('min_subtotal', { precision: 14, scale: 2, mode: 'number' }),
        maxUses: integer('max_uses'),
        oncePerCustomer: boolean('once_per_customer').notNull().default(false),
        startsOn: date('starts_on', { mode: 'string' }),
        endsOn: date('ends_on', { mode: 'string' }),
        scope: jsonb('scope').$type<{ product_ids?: number[]; categories?: string[] }>().notNull(),
        active: boolean('active').notNull().default(true),
        createdBy: bigint('created_by', { mode: 'number' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('shop_coupons_code_ux').on(t.shopId, t.code), index('shop_coupons_tenant_ix').on(t.tenantId)],
);
export type ShopCouponRow = typeof shopCoupons.$inferSelect;
