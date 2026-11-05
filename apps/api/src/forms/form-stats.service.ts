import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
    formStatFields,
    formStatsDayRange,
    summarizeFormStats,
    zonedToday,
    type FormStatCounts,
    type FormStatEvent,
    type FormStatsDto,
} from '@imagina-base/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { formStats } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * v0.1.358 — Estadísticas de los formularios públicos.
 *
 * Un formulario insertado en un sitio con muchas visitas no puede escribir en
 * la base por cada visita (ADR-S95): los eventos se suman en un hash de Redis
 * por formulario y día, y cada dos minutos se vuelcan a `form_stats` con un
 * UPSERT que SUMA (dos servidores que vuelcan a la vez no se pisan). Son
 * contadores: nunca la IP ni nada de la persona.
 */

const KEY_PREFIX = 'fst:';
const DIRTY_KEY = 'fst:dirty';
/** Un día sin volcar se conserva en Redis hasta 4 días (si la base estuvo caída). */
const HASH_TTL_S = 4 * 86_400;
/** Tope de contadores distintos por formulario y día (orígenes y preguntas de más no crecen sin límite). */
const MAX_FIELDS = 400;
/** Lotes de eventos por IP y minuto (cada lote trae hasta 12). */
const MAX_BATCHES_PER_MIN = 60;
const FLUSH_EVERY_MS = 2 * 60 * 1000;
const FLUSH_BATCH = 200;

/**
 * Suma los contadores de un evento sin dejar crecer el hash: lo que ya existe
 * siempre suma; lo nuevo sólo si hay lugar (un origen de más va a «Otros»,
 * una pregunta de más no se cuenta).
 */
const INCR_SCRIPT = `
local n = redis.call('HLEN', KEYS[1])
for i = 3, #ARGV do
  local f = ARGV[i]
  if redis.call('HEXISTS', KEYS[1], f) == 1 or n < tonumber(ARGV[2]) then
    if redis.call('HINCRBY', KEYS[1], f, 1) == 1 then n = n + 1 end
  elseif string.sub(f, 1, 4) == 'src:' then
    redis.call('HINCRBY', KEYS[1], 'src:o', 1)
  end
end
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('SADD', KEYS[2], KEYS[1])
return 1
`;

export interface FormStatsTarget {
    tenantId: number;
    formId: number;
    timeZone: string;
}

function hashKey(t: FormStatsTarget, day: string): string {
    return `${KEY_PREFIX}${t.tenantId}:${t.formId}:${day}`;
}

/** ¿El error (o su causa, que es donde drizzle deja el de Postgres) es una FK rota? */
export function isForeignKeyViolation(err: unknown): boolean {
    for (let e: unknown = err, i = 0; e && typeof e === 'object' && i < 4; e = (e as { cause?: unknown }).cause, i++) {
        const x = e as { code?: unknown; message?: unknown };
        if (x.code === '23503') return true;
        if (typeof x.message === 'string' && /violates foreign key/i.test(x.message)) return true;
    }
    return false;
}

function parseKey(key: string): { tenantId: number; formId: number; day: string } | null {
    const m = /^fst:(\d+):(\d+):(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (!m) return null;
    return { tenantId: Number(m[1]), formId: Number(m[2]), day: m[3]! };
}

function toCounts(raw: Record<string, string>): FormStatCounts {
    const out: FormStatCounts = {};
    for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) out[k] = n;
    }
    return out;
}

@Injectable()
export class FormStatsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(FormStatsService.name);
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(REDIS) private readonly redis: Redis,
    ) {}

    onModuleInit(): void {
        this.timer = setInterval(() => {
            this.flush().catch((err: unknown) => this.logger.warn(`Volcado de estadísticas de formularios: ${String(err)}`));
        }, FLUSH_EVERY_MS);
        this.timer.unref?.();
    }

    async onModuleDestroy(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        // Lo último antes de apagar (best-effort: si no se puede, queda en Redis).
        await this.flush().catch(() => undefined);
    }

    /** ¿Este IP ya mandó demasiados lotes este minuto? (un lote de más se ignora sin error). */
    private async overLimit(ip: string): Promise<boolean> {
        const key = `fstrl:${ip}:${Math.floor(Date.now() / 60_000)}`;
        try {
            const res = await this.redis.multi().incr(key).expire(key, 90).exec();
            return Number(res?.[0]?.[1] ?? 0) > MAX_BATCHES_PER_MIN;
        } catch {
            return false;
        }
    }

    /** Los eventos que manda la página (visitas, empezados, pasos, abandonos). */
    async record(target: FormStatsTarget, ip: string, events: readonly FormStatEvent[], now = new Date()): Promise<void> {
        if (await this.overLimit(ip)) return;
        const fields = events.flatMap(formStatFields);
        if (!fields.length) return;
        const key = hashKey(target, zonedToday(target.timeZone, now));
        try {
            await this.redis.eval(INCR_SCRIPT, 2, key, DIRTY_KEY, String(HASH_TTL_S), String(MAX_FIELDS), ...fields);
        } catch (err) {
            // Las estadísticas nunca le cuestan una respuesta a nadie.
            this.logger.warn(`No se pudo contar la visita del formulario ${target.formId}: ${String(err)}`);
        }
    }

    /** Una respuesta enviada (con lo que tardó, si la página lo sabe). */
    async recordSubmit(target: FormStatsTarget, elapsedMs: number | undefined, now = new Date()): Promise<void> {
        const key = hashKey(target, zonedToday(target.timeZone, now));
        const pipe = this.redis.multi().hincrby(key, 'sub', 1);
        // Más de 6 horas no es «lo que tarda en responder» (dejó la pestaña abierta).
        if (typeof elapsedMs === 'number' && elapsedMs >= 1000 && elapsedMs <= 6 * 3_600_000) {
            pipe.hincrby(key, 'tsum', Math.round(elapsedMs / 1000)).hincrby(key, 'tn', 1);
        }
        try {
            await pipe.expire(key, HASH_TTL_S).sadd(DIRTY_KEY, key).exec();
        } catch (err) {
            this.logger.warn(`No se pudo contar la respuesta del formulario ${target.formId}: ${String(err)}`);
        }
    }

    /**
     * Vuelca a la base lo que se sumó en Redis. Cada hash se lee y se borra en
     * la MISMA transacción de Redis (nada se cuenta dos veces) y se suma con un
     * UPSERT que suma clave por clave. Si la base falla, los números vuelven a
     * Redis para el próximo volcado.
     */
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
                    await this.upsert(parsed.tenantId, parsed.formId, parsed.day, counts);
                    done++;
                } catch (err) {
                    // El formulario (o la empresa) se borró: esos números ya no van a
                    // ningún lado. OJO: drizzle envuelve el error de Postgres
                    // («Failed query: …») y el código 23503 viaja en `cause` — antes
                    // se miraba sólo el mensaje y el hash volvía a Redis para siempre.
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

    private async upsert(tenantId: number, formId: number, day: string, counts: FormStatCounts): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.execute(sql`
                INSERT INTO form_stats (tenant_id, form_id, day, counts)
                VALUES (${tenantId}, ${formId}, ${day}::date, ${JSON.stringify(counts)}::jsonb)
                ON CONFLICT (form_id, day) DO UPDATE SET
                    counts = (
                        SELECT COALESCE(jsonb_object_agg(k.key, to_jsonb(
                            COALESCE((form_stats.counts ->> k.key)::numeric, 0) + COALESCE((EXCLUDED.counts ->> k.key)::numeric, 0)
                        )), '{}'::jsonb)
                        FROM (
                            SELECT jsonb_object_keys(form_stats.counts) AS key
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
     * empresa): lo de la base más lo que todavía está en Redis.
     */
    async summary(target: FormStatsTarget, days: number, now = new Date()): Promise<FormStatsDto> {
        const to = zonedToday(target.timeZone, now);
        const all = formStatsDayRange(addDays(to, -(days - 1)), to);
        const from = all[0] ?? to;
        const rows = await this.tenantDb.withTenant(target.tenantId, (tx) =>
            tx
                .select({ day: formStats.day, counts: formStats.counts })
                .from(formStats)
                .where(and(eq(formStats.tenantId, target.tenantId), eq(formStats.formId, target.formId), gte(formStats.day, from), lte(formStats.day, to))),
        );
        const merged = rows.map((r) => ({ day: String(r.day).slice(0, 10), counts: (r.counts ?? {}) as FormStatCounts }));
        // Lo que no se volcó todavía (sólo puede ser de los últimos días).
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
        return summarizeFormStats(merged, { from, to });
    }

    /** Los contadores de un formulario por día, tal cual (para tests y la migración de empresa). */
    async rawDays(tenantId: number, formId: number): Promise<Array<{ day: string; counts: FormStatCounts }>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ day: formStats.day, counts: formStats.counts }).from(formStats).where(and(eq(formStats.tenantId, tenantId), eq(formStats.formId, formId))),
        );
        return rows.map((r) => ({ day: String(r.day).slice(0, 10), counts: (r.counts ?? {}) as FormStatCounts }));
    }
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
