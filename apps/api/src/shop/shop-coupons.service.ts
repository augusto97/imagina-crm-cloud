import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    SHOP_MAX_COUPONS,
    normalizeCouponCode,
    shopCouponEligible,
    shopCouponLabel,
    formatShopMoney,
    zonedToday,
    type ShopCouponDto,
    type ShopCouponInput,
    type ShopCouponKind,
    type ShopCouponRule,
    type TenantFormat,
} from '@imagina-base/shared';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records, shopCoupons, shopOrders, type ShopCouponRow } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { ShopService } from './shop.service';

function badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message, data: { status: 400 } });
}

/** Lo que el cupón cubre, para armar `eligible` contra lo que se compra. */
export interface CouponItem {
    id: number;
    product_id: number;
    categories: readonly string[];
}

/** Un cupón resuelto: la regla para el carrito y la fila (para guardar el pedido). */
export interface ResolvedCoupon {
    rule: ShopCouponRule;
    row: ShopCouponRow;
}

/**
 * v0.1.415 (addendum ADR-S103) — Los cupones de la tienda.
 *
 * Los usos no viven en un contador: se cuentan de `shop_orders` (pedidos con
 * el cupón que no están cancelados). Al hacer un pedido, la fila del cupón se
 * bloquea antes de contar, así dos compras a la vez no pasan el tope; cancelar
 * o vencer un pedido libera su uso solo, y un pago tardío que lo revive lo
 * vuelve a contar.
 */
@Injectable()
export class ShopCouponsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly shops: ShopService,
        @Optional() private readonly zones?: TenantTimeZones,
    ) {}

    // ─────────────────────────── Equipo ───────────────────────────

    async list(tenantId: number, shopId: number): Promise<ShopCouponDto[]> {
        await this.shops.row(tenantId, shopId);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select()
                .from(shopCoupons)
                .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId)))
                .orderBy(asc(shopCoupons.code));
            const usage = await this.usage(
                tx,
                tenantId,
                rows.map((r) => r.id),
            );
            return rows.map((r) => this.toDto(r, usage.get(r.id)));
        });
    }

    async create(tenantId: number, userId: number, shopId: number, input: ShopCouponInput): Promise<ShopCouponDto> {
        await this.shops.row(tenantId, shopId);
        const scope = await this.cleanScope(tenantId, shopId, input);
        // Las columnas «Descuento» y «Cupón» en «Pedidos» (una tienda de antes no las tiene).
        await this.shops.ensureOrderColumns(tenantId, shopId);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [n] = await tx
                .select({ n: count() })
                .from(shopCoupons)
                .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId)));
            if (Number(n?.n ?? 0) >= SHOP_MAX_COUPONS) badRequest('shop_coupon_limit', `Una tienda puede tener hasta ${SHOP_MAX_COUPONS} cupones.`);
            const [dup] = await tx
                .select({ id: shopCoupons.id })
                .from(shopCoupons)
                .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId), eq(shopCoupons.code, input.code)))
                .limit(1);
            if (dup) this.duplicate(input.code);
            const [inserted] = await tx
                .insert(shopCoupons)
                .values({ tenantId, shopId, ...this.values(input, scope), createdBy: userId })
                .onConflictDoNothing()
                .returning();
            if (!inserted) this.duplicate(input.code);
            return inserted!;
        });
        this.forgetShop(tenantId, shopId);
        return this.toDto(row, undefined);
    }

    async update(tenantId: number, shopId: number, couponId: number, input: ShopCouponInput): Promise<{ dto: ShopCouponDto; before: ShopCouponRow }> {
        await this.shops.row(tenantId, shopId);
        const scope = await this.cleanScope(tenantId, shopId, input);
        const res = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const before = await this.load(tx, tenantId, shopId, couponId, true);
            if (input.code !== before.code) {
                const [dup] = await tx
                    .select({ id: shopCoupons.id })
                    .from(shopCoupons)
                    .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId), eq(shopCoupons.code, input.code)))
                    .limit(1);
                if (dup) this.duplicate(input.code);
            }
            const [next] = await tx
                .update(shopCoupons)
                .set({ ...this.values(input, scope), updatedAt: new Date() })
                .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.id, couponId)))
                .returning();
            const usage = await this.usage(tx, tenantId, [couponId]);
            return { dto: this.toDto(next!, usage.get(couponId)), before };
        });
        this.forgetShop(tenantId, shopId);
        return res;
    }

    /** Borrarlo no toca los pedidos que lo usaron: guardan el código y el descuento. */
    async remove(tenantId: number, shopId: number, couponId: number): Promise<ShopCouponRow> {
        await this.shops.row(tenantId, shopId);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const r = await this.load(tx, tenantId, shopId, couponId, true);
            await tx.delete(shopCoupons).where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.id, couponId)));
            return r;
        });
        this.forgetShop(tenantId, shopId);
        return row;
    }

    /** Si la tienda tiene algún cupón activo (para mostrar «¿Tienes un cupón?»). */
    async hasActive(tx: Tx, tenantId: number, shopId: number): Promise<boolean> {
        const [r] = await tx
            .select({ id: shopCoupons.id })
            .from(shopCoupons)
            .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId), eq(shopCoupons.active, true)))
            .limit(1);
        return !!r;
    }

    // ─────────────────────────── Compra ───────────────────────────

    /**
     * Valida un código para un carrito. Con `lock`, bloquea la fila del cupón
     * (el pedido lo llama dentro de su transacción antes de contar los usos).
     * Devuelve el cupón o el motivo por el que no sirve.
     */
    async resolve(
        tx: Tx,
        tenantId: number,
        shopId: number,
        rawCode: string,
        opts: {
            items: Iterable<CouponItem>;
            currency: string;
            numberFormat: TenantFormat['number_format'];
            email?: string | null;
            lock?: boolean;
            now?: Date;
        },
    ): Promise<{ ok: true; coupon: ResolvedCoupon } | { ok: false; message: string }> {
        const code = normalizeCouponCode(rawCode);
        const invalid = { ok: false as const, message: 'Ese cupón no existe o ya no está vigente.' };
        if (!code) return invalid;
        const base = tx
            .select()
            .from(shopCoupons)
            .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId), eq(shopCoupons.code, code)))
            .limit(1);
        const [row] = opts.lock ? await base.for('update') : await base;
        if (!row || !row.active) return invalid;
        const tz = this.zones ? await this.zones.orUtc(tenantId, tx) : 'UTC';
        const today = zonedToday(tz, opts.now ?? new Date());
        if (row.startsOn && today < row.startsOn) return { ok: false, message: 'Ese cupón todavía no está vigente.' };
        if (row.endsOn && today > row.endsOn) return { ok: false, message: 'Ese cupón ya venció.' };
        if (row.maxUses !== null) {
            const used = (await this.usage(tx, tenantId, [row.id])).get(row.id)?.uses ?? 0;
            if (used >= row.maxUses) return { ok: false, message: 'Ese cupón ya se usó todas las veces que se podía.' };
        }
        if (row.oncePerCustomer && opts.email) {
            const [hit] = await tx
                .select({ id: shopOrders.id })
                .from(shopOrders)
                .where(
                    and(
                        eq(shopOrders.tenantId, tenantId),
                        eq(shopOrders.couponId, row.id),
                        isNull(shopOrders.cancelledAt),
                        sql`lower(${shopOrders.customer}->>'email') = ${opts.email.trim().toLowerCase()}`,
                    ),
                )
                .limit(1);
            if (hit) return { ok: false, message: 'Ya usaste este cupón en otra compra.' };
        }
        const money = (n: number): string => formatShopMoney(n, opts.currency, opts.numberFormat);
        const kind = row.kind as ShopCouponKind;
        const rule: ShopCouponRule = {
            code: row.code,
            label: row.description.trim() || shopCouponLabel({ kind, value: row.value }, money),
            kind,
            value: row.value,
            min_subtotal: row.minSubtotal,
            eligible: shopCouponEligible(row.scope ?? {}, opts.items),
        };
        return { ok: true, coupon: { rule, row } };
    }

    // ─────────────────────────── Internos ───────────────────────────

    /** Usos y monto descontado por cupón (pedidos no cancelados). */
    private async usage(tx: Tx, tenantId: number, ids: number[]): Promise<Map<number, { uses: number; discounted: number }>> {
        const out = new Map<number, { uses: number; discounted: number }>();
        if (ids.length === 0) return out;
        const rows = await tx
            .select({ id: shopOrders.couponId, n: count(), sum: sql<string>`coalesce(sum(${shopOrders.discount}), 0)` })
            .from(shopOrders)
            .where(and(eq(shopOrders.tenantId, tenantId), inArray(shopOrders.couponId, ids), isNull(shopOrders.cancelledAt)))
            .groupBy(shopOrders.couponId);
        for (const r of rows) if (r.id !== null) out.set(r.id, { uses: Number(r.n), discounted: Number(r.sum) });
        return out;
    }

    private async load(tx: Tx, tenantId: number, shopId: number, couponId: number, lock = false): Promise<ShopCouponRow> {
        const q = tx
            .select()
            .from(shopCoupons)
            .where(and(eq(shopCoupons.tenantId, tenantId), eq(shopCoupons.shopId, shopId), eq(shopCoupons.id, couponId)))
            .limit(1);
        const [row] = lock ? await q.for('update') : await q;
        if (!row) throw new NotFoundException({ code: 'shop_coupon_not_found', message: 'Ese cupón ya no existe.', data: { status: 404 } });
        return row;
    }

    /** Los productos elegidos tienen que ser del catálogo de la tienda (y de primer nivel). */
    private async cleanScope(tenantId: number, shopId: number, input: ShopCouponInput): Promise<{ product_ids: number[]; categories: string[] }> {
        const row = await this.shops.row(tenantId, shopId);
        const ids = [...new Set(input.product_ids)];
        let products: number[] = [];
        if (ids.length > 0) {
            products = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const rows = await tx
                    .select({ id: records.id })
                    .from(records)
                    .where(and(eq(records.tenantId, tenantId), eq(records.listId, row.listId), inArray(records.id, ids), isNull(records.deletedAt), isNull(records.parentId)));
                return rows.map((r) => r.id);
            });
        }
        const categories = [...new Set(input.categories.map((c) => c.trim()).filter(Boolean))];
        return { product_ids: products, categories };
    }

    private values(input: ShopCouponInput, scope: { product_ids: number[]; categories: string[] }) {
        return {
            code: input.code,
            description: input.description,
            kind: input.kind,
            value: input.kind === 'free_shipping' ? 0 : input.value,
            minSubtotal: input.min_subtotal,
            maxUses: input.max_uses,
            oncePerCustomer: input.once_per_customer,
            startsOn: input.starts_on ?? null,
            endsOn: input.ends_on ?? null,
            scope,
            active: input.active,
        };
    }

    private toDto(r: ShopCouponRow, usage: { uses: number; discounted: number } | undefined): ShopCouponDto {
        return {
            id: r.id,
            shop_id: r.shopId,
            code: r.code,
            description: r.description,
            kind: r.kind as ShopCouponKind,
            value: r.value,
            min_subtotal: r.minSubtotal,
            max_uses: r.maxUses,
            once_per_customer: r.oncePerCustomer,
            starts_on: r.startsOn,
            ends_on: r.endsOn,
            product_ids: r.scope?.product_ids ?? [],
            categories: r.scope?.categories ?? [],
            active: r.active,
            uses: usage?.uses ?? 0,
            discounted: usage?.discounted ?? 0,
            created_at: r.createdAt.toISOString(),
        };
    }

    private duplicate(code: string): never {
        throw new ConflictException({ code: 'shop_coupon_exists', message: `Ya hay un cupón «${code}» en esta tienda.`, data: { status: 409 } });
    }

    /** La página pública muestra «¿Tienes un cupón?» sólo si hay alguno: se olvida la caché. */
    private forgetShop(tenantId: number, shopId: number): void {
        void this.shops
            .row(tenantId, shopId)
            .then((r) => this.shops.forget(r.token))
            .catch(() => undefined);
    }
}
