import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
    shopStatFields,
    shopStatsDayRange,
    summarizeShopStats,
    zonedToday,
    type ShopOrderDayRow,
    type ShopOrderSourceRow,
    type ShopSoldRow,
    type ShopStatCounts,
    type ShopStatEvent,
    type ShopStatsDto,
} from '@imagina-base/shared';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { rateKeyForIp } from '../common/client-ip';
import { records, shopStats } from '../db/schema';
import { isForeignKeyViolation } from '../forms/form-stats.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

/**
 * v0.1.418 (addendum ADR-S103) — Estadísticas de la tienda.
 *
 * Lo que pasa en la página (visitas, productos abiertos, carrito, compra) se
 * suma en un hash de Redis por tienda y día y cada dos minutos se vuelca a
 * `shop_stats` con un UPSERT que SUMA, igual que los formularios y el widget:
 * una tienda con muchas visitas no escribe en la base por cada una. Son
 * contadores: nunca la IP ni nada de la persona.
 *
 * Los pedidos, lo pagado, lo vendido y de dónde llegó cada pedido se cuentan
 * de `shop_orders` al pedir el resumen (con un índice por tienda y fecha).
 */

const KEY_PREFIX = 'sst:';
const DIRTY_KEY = 'sst:dirty';
const HASH_TTL_S = 4 * 86_400;
/** Tope de contadores por tienda y día: los generales más ~100 productos. */
const MAX_FIELDS = 240;
const MAX_BATCHES_PER_MIN = 60;
const FLUSH_EVERY_MS = 2 * 60 * 1000;
const FLUSH_BATCH = 200;

const INCR_SCRIPT = `
local n = redis.call('HLEN', KEYS[1])
for i = 3, #ARGV do
  local f = ARGV[i]
  if redis.call('HEXISTS', KEYS[1], f) == 1 or n < tonumber(ARGV[2]) then
    if redis.call('HINCRBY', KEYS[1], f, 1) == 1 then n = n + 1 end
  end
end
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[2], KEYS[1])
return 1
`;

export interface ShopStatsTarget {
    tenantId: number;
    shopId: number;
    timeZone: string;
}

function hashKey(t: { tenantId: number; shopId: number }, day: string): string {
    return `${KEY_PREFIX}${t.tenantId}:${t.shopId}:${day}`;
}

function parseKey(key: string): { tenantId: number; shopId: number; day: string } | null {
    const m = /^sst:(\d+):(\d+):(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m) return null;
    return { tenantId: Number(m[1]), shopId: Number(m[2]), day: m[3]! };
}

function toCounts(raw: Record<string, string>): ShopStatCounts {
    const out: ShopStatCounts = {};
    for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) out[k] = n;
    }
    return out;
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class ShopStatsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ShopStatsService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
        @Optional() private readonly zones?: TenantTimeZones,
    ) {}

    onModuleInit(): void {
        this.timer = setInterval(() => {
            this.flush().catch((err: unknown) => this.logger.warn(`Volcado de estadísticas de tiendas: ${String(err)}`));
        }, FLUSH_EVERY_MS);
        this.timer.unref?.();
    }

    async onModuleDestroy(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        await this.flush().catch(() => undefined);
    }

    async timeZone(tenantId: number): Promise<string> {
        return this.zones ? this.zones.orUtc(tenantId) : 'UTC';
    }

    private async overLimit(ip: string): Promise<boolean> {
        if (!this.redis) return true;
        const key = `sstrl:${rateKeyForIp(ip)}:${Math.floor(Date.now() / 60_000)}`;
        try {
            const res = await this.redis.multi().incr(key).expire(key, 90).exec();
            return Number(res?.[0]?.[1] ?? 0) > MAX_BATCHES_PER_MIN;
        } catch {
            return false;
        }
    }

    /**
     * Los eventos que manda la página. `productIds` = los productos que la
     * tienda vende HOY: abrir o agregar un producto que no existe no suma.
     */
    async record(target: ShopStatsTarget, ip: string, events: readonly ShopStatEvent[], productIds: ReadonlySet<number>, now = new Date()): Promise<void> {
        if (!this.redis || (await this.overLimit(ip))) return;
        const fields = events.filter((e) => (e.kind !== 'product' && e.kind !== 'add') || (typeof e.item === 'number' && productIds.has(e.item))).flatMap(shopStatFields);
        if (!fields.length) return;
        const key = hashKey(target, zonedToday(target.timeZone, now));
        try {
            await this.redis.eval(INCR_SCRIPT, 2, key, DIRTY_KEY, String(HASH_TTL_S), String(MAX_FIELDS), ...fields);
        } catch (err) {
            // Las estadísticas nunca le cuestan una respuesta a nadie.
            this.logger.warn(`No se pudo contar la tienda ${target.shopId}: ${String(err)}`);
        }
    }

    /** Vuelca a la base lo sumado en Redis (lee y borra cada hash en la misma transacción de Redis). */
    async flush(): Promise<number> {
        if (!this.redis) return 0;
        let done = 0;
        for (let round = 0; round < 50; round++) {
            const keys = (await this.redis.spop(DIRTY_KEY, FLUSH_BATCH)) as string[] | null;
            if (!keys || keys.length === 0) break;
            for (const key of keys) {
                const parsed = parseKey(key);
                if (!parsed) continue;
                const res = await this.redis.multi().hgetall(key).del(key).exec();
                const counts = toCounts((res?.[0]?.[1] as Record<string, string> | null) ?? {});
                if (!Object.keys(counts).length) continue;
                try {
                    await this.upsert(parsed.tenantId, parsed.shopId, parsed.day, counts);
                    done++;
                } catch (err) {
                    // La tienda (o la empresa) se borró: esos números ya no van a ningún lado.
                    if (isForeignKeyViolation(err)) continue;
                    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
                    this.logger.warn(`Volcado de ${key}: ${msg}`);
                    const back = this.redis.multi();
                    for (const [k, v] of Object.entries(counts)) back.hincrby(key, k, v);
                    await back.expire(key, HASH_TTL_S).sadd(DIRTY_KEY, key).exec().catch(() => undefined);
                }
            }
        }
        return done;
    }

    private async upsert(tenantId: number, shopId: number, day: string, counts: ShopStatCounts): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.execute(sql`
                INSERT INTO shop_stats (tenant_id, shop_id, day, counts)
                VALUES (${tenantId}, ${shopId}, ${day}::date, ${JSON.stringify(counts)}::jsonb)
                ON CONFLICT (shop_id, day) DO UPDATE SET
                    counts = (
                        SELECT COALESCE(jsonb_object_agg(k.key, to_jsonb(
                            COALESCE((shop_stats.counts ->> k.key)::numeric, 0) + COALESCE((EXCLUDED.counts ->> k.key)::numeric, 0)
                        )), '{}'::jsonb)
                        FROM (
                            SELECT jsonb_object_keys(shop_stats.counts) AS key
                            UNION
                            SELECT jsonb_object_keys(EXCLUDED.counts)
                        ) k
                    ),
                    updated_at = now()
            `),
        );
    }

    /**
     * El resumen de los últimos `days` días (hoy incluido, en la zona de la
     * empresa): los contadores (la base más lo que sigue en Redis) y lo que
     * sale de los pedidos.
     */
    async summary(target: ShopStatsTarget & { currency: string; titleKey: string | null }, days: number, now = new Date()): Promise<ShopStatsDto> {
        const tz = target.timeZone;
        const to = zonedToday(tz, now);
        const all = shopStatsDayRange(addDays(to, -(days - 1)), to);
        const from = all[0] ?? to;
        // Lo de los últimos días que todavía no se volcó (antes de la base: sus
        // productos también necesitan su nombre).
        const pending: Array<{ day: string; counts: ShopStatCounts }> = [];
        if (this.redis) {
            const recent = all.slice(-5);
            try {
                const pipe = this.redis.multi();
                for (const d of recent) pipe.hgetall(hashKey(target, d));
                const res = (await pipe.exec()) ?? [];
                recent.forEach((d, i) => {
                    const c = toCounts((res[i]?.[1] as Record<string, string> | null) ?? {});
                    if (Object.keys(c).length) pending.push({ day: d, counts: c });
                });
            } catch {
                // Sin Redis se ve lo ya volcado.
            }
        }
        const { counts, orders, sold, sources, titles } = await this.tenantDb.withTenant(target.tenantId, async (tx) => {
            const statRows = await tx
                .select({ day: shopStats.day, counts: shopStats.counts })
                .from(shopStats)
                .where(and(eq(shopStats.tenantId, target.tenantId), eq(shopStats.shopId, target.shopId), gte(shopStats.day, from), lte(shopStats.day, to)));
            // El día de cada pedido, en la zona de la empresa. Los vencidos (no
            // pagaron a tiempo o no se pudo preparar el pago) no cuentan como pedidos.
            const dayExpr = sql`(o.created_at AT TIME ZONE ${tz})::date`;
            const orderRows = (await tx.execute(sql`
                SELECT to_char(${dayExpr}, 'YYYY-MM-DD') AS day,
                       count(*) FILTER (WHERE o.payment_status <> 'vencido') AS orders,
                       count(*) FILTER (WHERE o.payment_status = 'pagado' AND o.cancelled_at IS NULL) AS paid,
                       COALESCE(sum(o.total) FILTER (WHERE o.payment_status = 'pagado' AND o.cancelled_at IS NULL), 0) AS revenue
                  FROM shop_orders o
                 WHERE o.tenant_id = ${target.tenantId} AND o.shop_id = ${target.shopId}
                   AND ${dayExpr} BETWEEN ${from}::date AND ${to}::date
                 GROUP BY 1
            `)) as unknown as { rows: Array<Record<string, unknown>> };
            const soldRows = (await tx.execute(sql`
                SELECT COALESCE(NULLIF(l->>'parent_id', '')::bigint, (l->>'product_id')::bigint) AS product_id,
                       sum(COALESCE((l->>'qty')::numeric, 0)) AS units,
                       sum(COALESCE((l->>'subtotal')::numeric, 0)) AS revenue
                  FROM shop_orders o, jsonb_array_elements(o.lines) l
                 WHERE o.tenant_id = ${target.tenantId} AND o.shop_id = ${target.shopId}
                   AND o.payment_status = 'pagado' AND o.cancelled_at IS NULL
                   AND ${dayExpr} BETWEEN ${from}::date AND ${to}::date
                   AND jsonb_typeof(l) = 'object' AND (l->>'product_id') ~ '^[0-9]{1,15}$'
                 GROUP BY 1
                 ORDER BY 3 DESC, 2 DESC
                 LIMIT 50
            `)) as unknown as { rows: Array<Record<string, unknown>> };
            const sourceRows = (await tx.execute(sql`
                SELECT COALESCE(NULLIF(o.origin->>'src', ''), 'd') AS key,
                       count(*) FILTER (WHERE o.payment_status <> 'vencido') AS orders,
                       count(*) FILTER (WHERE o.payment_status = 'pagado' AND o.cancelled_at IS NULL) AS paid,
                       COALESCE(sum(o.total) FILTER (WHERE o.payment_status = 'pagado' AND o.cancelled_at IS NULL), 0) AS revenue
                  FROM shop_orders o
                 WHERE o.tenant_id = ${target.tenantId} AND o.shop_id = ${target.shopId}
                   AND ${dayExpr} BETWEEN ${from}::date AND ${to}::date
                 GROUP BY 1
            `)) as unknown as { rows: Array<Record<string, unknown>> };
            const statCounts = statRows.map((r) => ({ day: String(r.day).slice(0, 10), counts: (r.counts ?? {}) as ShopStatCounts }));
            const soldList: ShopSoldRow[] = soldRows.rows.map((r) => ({ product_id: num(r.product_id), units: num(r.units), revenue: num(r.revenue) })).filter((r) => r.product_id > 0);
            // Los nombres de HOY de los productos que aparecen (los contadores guardan el id).
            const ids = new Set<number>(soldList.map((s) => s.product_id));
            for (const c of [...statCounts, ...pending]) for (const k of Object.keys(c.counts)) {
                const m = /^(?:p|a):(\d{1,15})$/.exec(k);
                if (m) ids.add(Number(m[1]));
            }
            const titleMap = new Map<number, string>();
            if (ids.size > 0) {
                const list = [...ids].slice(0, 500);
                const rows = await tx
                    .select({ id: records.id, data: records.data })
                    .from(records)
                    .where(and(eq(records.tenantId, target.tenantId), inArray(records.id, list)));
                for (const r of rows) {
                    const v = target.titleKey ? (r.data as Record<string, unknown> | null)?.[target.titleKey] : null;
                    titleMap.set(r.id, typeof v === 'string' ? v.slice(0, 200) : typeof v === 'number' ? String(v) : '');
                }
            }
            return {
                counts: statCounts,
                orders: orderRows.rows.map((r) => ({ day: String(r.day), orders: num(r.orders), paid: num(r.paid), revenue: num(r.revenue) })) as ShopOrderDayRow[],
                sold: soldList,
                sources: sourceRows.rows.map((r) => ({ key: String(r.key), orders: num(r.orders), paid: num(r.paid), revenue: num(r.revenue) })) as ShopOrderSourceRow[],
                titles: titleMap,
            };
        });
        return summarizeShopStats({ counts: [...counts, ...pending], orders, sold, orderSources: sources, range: { from, to }, currency: target.currency, titles });
    }

}
