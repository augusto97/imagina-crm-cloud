import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { rateKeyForIp } from '../common/client-ip';
import {
    summarizeWidgetStats,
    widgetStatFields,
    widgetStatsDayRange,
    zonedToday,
    type WidgetStatCounts,
    type WidgetStatEvent,
    type WidgetStatsDto,
} from '@imagina-base/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { widgetStats } from '../db/schema';
import { isForeignKeyViolation } from '../forms/form-stats.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { workersEnabled } from '../redis/queue-runtime';

/**
 * v0.1.396 (ADR-S99) — Estadísticas del widget de contacto: cuántas veces
 * apareció, cuántas lo abrieron, los toques de cada botón, el saludo y los
 * registros que llegaron por cada botón.
 *
 * El widget va en sitios con muchas visitas: igual que las estadísticas de
 * los formularios (v0.1.358), los eventos se suman en un hash de Redis por
 * widget y día y cada dos minutos se vuelcan a `widget_stats` con un UPSERT
 * que SUMA. Son contadores: nunca la IP ni nada de la persona.
 */

const KEY_PREFIX = 'wst:';
const DIRTY_KEY = 'wst:dirty';
const HASH_TTL_S = 4 * 86_400;
/** Tope de contadores por widget y día (8 botones × clics y registros, más los generales: sobra). */
const MAX_FIELDS = 60;
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

export interface WidgetStatsTarget {
    tenantId: number;
    widgetId: number;
    timeZone: string;
}

function hashKey(t: WidgetStatsTarget, day: string): string {
    return `${KEY_PREFIX}${t.tenantId}:${t.widgetId}:${day}`;
}

function parseKey(key: string): { tenantId: number; widgetId: number; day: string } | null {
    const m = /^wst:(\d+):(\d+):(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m) return null;
    return { tenantId: Number(m[1]), widgetId: Number(m[2]), day: m[3]! };
}

function toCounts(raw: Record<string, string>): WidgetStatCounts {
    const out: WidgetStatCounts = {};
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

@Injectable()
export class WidgetStatsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(WidgetStatsService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    onModuleInit(): void {
        if (!workersEnabled()) return;
        this.timer = setInterval(() => {
            this.flush().catch((err: unknown) => this.logger.warn(`Volcado de estadísticas de widgets: ${String(err)}`));
        }, FLUSH_EVERY_MS);
        this.timer.unref?.();
    }

    async onModuleDestroy(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        await this.flush().catch(() => undefined);
    }

    private async overLimit(ip: string): Promise<boolean> {
        const key = `wstrl:${rateKeyForIp(ip)}:${Math.floor(Date.now() / 60_000)}`;
        try {
            const res = await this.redis.multi().incr(key).expire(key, 90).exec();
            return Number(res?.[0]?.[1] ?? 0) > MAX_BATCHES_PER_MIN;
        } catch {
            return false;
        }
    }

    /**
     * Los eventos que manda la página del widget. `buttons` = los ids que el
     * widget tiene HOY: un clic (o un contacto) en un botón que no existe no suma.
     */
    async record(target: WidgetStatsTarget, ip: string, events: readonly WidgetStatEvent[], buttons: ReadonlySet<string>, now = new Date()): Promise<void> {
        if (await this.overLimit(ip)) return;
        const fields = events
            .filter((e) => (e.kind !== 'click' && e.kind !== 'lead') || (typeof e.button === 'string' && buttons.has(e.button)))
            .flatMap(widgetStatFields);
        if (!fields.length) return;
        await this.incr(target, fields, now);
    }

    private async incr(target: WidgetStatsTarget, fields: string[], now: Date): Promise<void> {
        const key = hashKey(target, zonedToday(target.timeZone, now));
        try {
            await this.redis.eval(INCR_SCRIPT, 2, key, DIRTY_KEY, String(HASH_TTL_S), String(MAX_FIELDS), ...fields);
        } catch (err) {
            // Las estadísticas nunca le cuestan una respuesta a nadie.
            this.logger.warn(`No se pudo contar el widget ${target.widgetId}: ${String(err)}`);
        }
    }

    /** Vuelca a la base lo sumado en Redis (lee y borra cada hash en la misma transacción de Redis). */
    async flush(): Promise<number> {
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
                    await this.upsert(parsed.tenantId, parsed.widgetId, parsed.day, counts);
                    done++;
                } catch (err) {
                    // El widget (o la empresa) se borró: esos números ya no van a ningún lado.
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

    private async upsert(tenantId: number, widgetId: number, day: string, counts: WidgetStatCounts): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.execute(sql`
                INSERT INTO widget_stats (tenant_id, widget_id, day, counts)
                VALUES (${tenantId}, ${widgetId}, ${day}::date, ${JSON.stringify(counts)}::jsonb)
                ON CONFLICT (widget_id, day) DO UPDATE SET
                    counts = (
                        SELECT COALESCE(jsonb_object_agg(k.key, to_jsonb(
                            COALESCE((widget_stats.counts ->> k.key)::numeric, 0) + COALESCE((EXCLUDED.counts ->> k.key)::numeric, 0)
                        )), '{}'::jsonb)
                        FROM (
                            SELECT jsonb_object_keys(widget_stats.counts) AS key
                            UNION
                            SELECT jsonb_object_keys(EXCLUDED.counts)
                        ) k
                    ),
                    updated_at = now()
            `),
        );
    }

    /** El resumen de los últimos `days` días (hoy incluido, en la zona de la empresa): la base más lo que sigue en Redis. */
    async summary(target: WidgetStatsTarget, days: number, now = new Date()): Promise<WidgetStatsDto> {
        const to = zonedToday(target.timeZone, now);
        const all = widgetStatsDayRange(addDays(to, -(days - 1)), to);
        const from = all[0] ?? to;
        const rows = await this.tenantDb.withTenant(target.tenantId, (tx) =>
            tx
                .select({ day: widgetStats.day, counts: widgetStats.counts })
                .from(widgetStats)
                .where(
                    and(
                        eq(widgetStats.tenantId, target.tenantId),
                        eq(widgetStats.widgetId, target.widgetId),
                        gte(widgetStats.day, from),
                        lte(widgetStats.day, to),
                    ),
                ),
        );
        const merged = rows.map((r) => ({ day: String(r.day).slice(0, 10), counts: (r.counts ?? {}) as WidgetStatCounts }));
        const recent = all.slice(-5);
        try {
            const pipe = this.redis.multi();
            for (const d of recent) pipe.hgetall(hashKey(target, d));
            const res = (await pipe.exec()) ?? [];
            recent.forEach((d, i) => {
                const counts = toCounts((res[i]?.[1] as Record<string, string> | null) ?? {});
                if (Object.keys(counts).length) merged.push({ day: d, counts });
            });
        } catch {
            // Sin Redis se ve lo ya volcado.
        }
        return summarizeWidgetStats(merged, { from, to });
    }
}
