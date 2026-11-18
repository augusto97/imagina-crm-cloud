import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    USAGE_DAYS,
    USAGE_MODULES,
    compareUsageCells,
    usageCellUsing,
    type PlatformTenantUsage,
    type PlatformUsage,
    type PlatformUsageApp,
    type PlatformUsageModuleDetail,
    type UsageCell,
    type UsageModuleKey,
} from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import type Redis from 'ioredis';
import { PlansService } from '../billing/plans.service';
import { DRIZZLE, type Db } from '../db/client';
import { periodOf } from '../mail/email-quota.service';
import { REDIS } from '../redis/redis.module';

/**
 * v0.1.437 — Uso por módulo (Plataforma → Uso): qué empresa usa qué y cuánto.
 *
 * Una consulta agrupada por empresa por cada cosa que se mide, sobre la
 * conexión base (sin RLS: es la consola del operador). Ninguna recorre
 * `records`: sólo tablas de configuración (chicas) y de actividad con su
 * índice de fecha. El resultado completo —una matriz empresa × módulo— queda
 * en Redis unos minutos; las tres pantallas (resumen, un módulo, una empresa)
 * se arman de esa matriz sin volver a la base.
 *
 * La clave vive bajo `diag:` y NO bajo `platform:`: es un cálculo, no un
 * ajuste, y no tiene que viajar en las copias del servidor (ADR-S20).
 */

const CACHE_KEY = 'diag:usage:v1';
/** Se recalcula si tiene más de esto. */
const FRESH_MS = 10 * 60_000;
/** «Actualizar» no puede recalcular más seguido que esto. */
const MIN_REFRESH_MS = 30_000;
/** Consultas a la vez (las demás esperan su turno). */
const CONCURRENCY = 4;
/** Empresas que se listan en el detalle de un módulo. */
const DETAIL_LIMIT = 300;

interface Matrix {
    generated_at: string;
    /** Empresas sin archivar. */
    live: number[];
    cells: Partial<Record<UsageModuleKey, Record<string, UsageCell>>>;
    apps: PlatformUsageApp[];
    /** Módulos cuya consulta falló. */
    unmeasured: UsageModuleKey[];
}

interface Row {
    tenant_id: number | string;
    n: number | string | null;
    last_at: Date | string | null;
}

type Metric = { total?: (c: Ctx) => SQL; activity?: (c: Ctx) => SQL };
interface Ctx {
    since: Date;
    sinceDay: string;
    period: string;
}

function rowsOf<T>(res: unknown): T[] {
    return (res as { rows?: T[] }).rows ?? (res as T[]) ?? [];
}

const WHATSAPP_PROVIDERS = sql`('whatsapp', 'whatsapp_cloud', 'whatsapp_web')`;
const PAYMENT_PROVIDERS = sql`('mercadopago', 'wompi', 'paypal')`;

/**
 * Qué se cuenta de cada módulo. CANTIDAD = lo configurado y vivo; ACTIVIDAD =
 * lo que pasó desde `since` (o en el mes, si así se guarda el contador).
 * Cada consulta devuelve `tenant_id`, `n` y `last_at`.
 */
const METRICS: Record<UsageModuleKey, Metric> = {
    automations: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM automations WHERE deleted_at IS NULL AND is_active GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM automation_runs WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    agents: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM ai_agents WHERE is_active GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM ai_agent_runs WHERE created_at >= ${c.since} AND NOT simulated GROUP BY 1`,
    },
    ai_assistant: {
        activity: (c) => sql`SELECT tenant_id, sum(requests) AS n, max(updated_at) AS last_at FROM ai_usage WHERE period = ${c.period} GROUP BY 1`,
    },
    ai_fields: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM fields WHERE type = 'ai' AND deleted_at IS NULL GROUP BY 1`,
    },
    documents: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM document_templates GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM document_numbers WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    helpdesk: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM helpdesk_mailboxes WHERE enabled GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM helpdesk_messages WHERE direction = 'in' AND created_at >= ${c.since} GROUP BY 1`,
    },
    approvals: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM approval_flows WHERE is_active GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(requested_at) AS last_at FROM approval_requests WHERE requested_at >= ${c.since} GROUP BY 1`,
    },
    time_tracking: {
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM time_entries WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    dashboards: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM dashboards WHERE deleted_at IS NULL GROUP BY 1`,
    },
    forms: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM forms WHERE enabled GROUP BY 1`,
        activity: (c) =>
            sql`SELECT tenant_id, sum(COALESCE((counts->>'sub')::int, 0)) AS n, max(updated_at) AS last_at FROM form_stats WHERE day >= ${c.sinceDay}::date GROUP BY 1`,
    },
    widgets: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM contact_widgets WHERE enabled GROUP BY 1`,
        activity: (c) =>
            sql`SELECT tenant_id, sum(COALESCE((counts->>'v')::int, 0)) AS n, max(updated_at) AS last_at FROM widget_stats WHERE day >= ${c.sinceDay}::date GROUP BY 1`,
    },
    booking: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM booking_pages WHERE enabled GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM booking_appointments WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    shop: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM shops WHERE enabled AND suspended_at IS NULL GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM shop_orders WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    portal: {
        total: () => sql`SELECT tenant_id, count(DISTINCT user_id) AS n, max(created_at) AS last_at FROM portal_links GROUP BY 1`,
        activity: (c) =>
            sql`SELECT tenant_id, count(DISTINCT user_id) AS n, max(last_access_at) AS last_at FROM portal_links WHERE last_access_at >= ${c.since} GROUP BY 1`,
    },
    guests: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM memberships WHERE role = 'guest' GROUP BY 1`,
    },
    public_sharing: {
        total: () => sql`
            SELECT tenant_id, count(*) AS n, max(created_at) AS last_at
            FROM (SELECT tenant_id, created_at FROM public_lists UNION ALL SELECT tenant_id, created_at FROM public_dashboards) x
            GROUP BY 1`,
    },
    integrations: {
        total: () =>
            sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM connections WHERE provider NOT IN ('woocommerce', 'wordpress', 'sqlserver') GROUP BY 1`,
    },
    whatsapp: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM connections WHERE provider IN ${WHATSAPP_PROVIDERS} GROUP BY 1`,
        activity: (c) => sql`
            SELECT tenant_id, count(*) AS n,
                   max(GREATEST(COALESCE(last_inbound_at, '-infinity'), COALESCE(last_outbound_at, '-infinity'))) AS last_at
            FROM whatsapp_contacts
            WHERE last_inbound_at >= ${c.since} OR last_outbound_at >= ${c.since}
            GROUP BY 1`,
    },
    sms: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM connections WHERE provider LIKE 'sms\_%' GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM sms_messages WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    payments: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM connections WHERE provider IN ${PAYMENT_PROVIDERS} GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM payment_links WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    subscriptions: {
        total: () =>
            sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM subscriptions WHERE status IN ('active', 'retrying', 'past_due') GROUP BY 1`,
        activity: (c) => sql`SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM subscription_charges WHERE created_at >= ${c.since} GROUP BY 1`,
    },
    woocommerce: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM connection_syncs WHERE provider = 'woocommerce' AND enabled GROUP BY 1`,
    },
    wordpress: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM connection_syncs WHERE provider = 'wordpress' AND enabled GROUP BY 1`,
    },
    sql: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM sql_syncs WHERE enabled GROUP BY 1`,
    },
    api: {
        total: () => sql`
            SELECT tenant_id, count(*) AS n, max(created_at) AS last_at FROM personal_access_tokens
            WHERE revoked_at IS NULL AND (COALESCE(refresh_expires_at, expires_at) IS NULL OR COALESCE(refresh_expires_at, expires_at) > now())
            GROUP BY 1`,
        activity: (c) =>
            sql`SELECT tenant_id, count(*) AS n, max(last_used_at) AS last_at FROM personal_access_tokens WHERE last_used_at >= ${c.since} GROUP BY 1`,
    },
    teams: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM teams GROUP BY 1`,
    },
    custom_roles: {
        total: () => sql`SELECT tenant_id, count(*) AS n, max(updated_at) AS last_at FROM custom_roles GROUP BY 1`,
    },
    custom_domain: {
        total: () => sql`
            SELECT tenant_id, sum(n) AS n, max(last_at) AS last_at FROM (
                SELECT id AS tenant_id, (custom_domain IS NOT NULL)::int + (portal_domain IS NOT NULL)::int AS n, updated_at AS last_at
                FROM tenants WHERE custom_domain IS NOT NULL OR portal_domain IS NOT NULL
                UNION ALL
                SELECT tenant_id, 1 AS n, updated_at AS last_at FROM shops WHERE custom_domain IS NOT NULL
            ) x GROUP BY 1`,
    },
    email: {
        activity: (c) => sql`SELECT tenant_id, sum(sent) AS n, max(updated_at) AS last_at FROM email_usage WHERE period = ${c.period} GROUP BY 1`,
    },
};

function epochSec(v: Date | string | null): number | null {
    if (v === null || v === undefined) return null;
    const t = (v instanceof Date ? v : new Date(v)).getTime();
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function isoOf(sec: number | null): string | null {
    return sec === null ? null : new Date(sec * 1000).toISOString();
}

/** Corre funciones de a `n` a la vez, en orden. */
async function inBatches<T>(tasks: Array<() => Promise<T>>, n: number): Promise<T[]> {
    const out: T[] = new Array(tasks.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(n, tasks.length) }, async () => {
            while (next < tasks.length) {
                const i = next++;
                out[i] = await tasks[i]!();
            }
        }),
    );
    return out;
}

@Injectable()
export class PlatformUsageService {
    private readonly log = new Logger('PlatformUsage');
    private inflight: Promise<Matrix> | null = null;
    private local: Matrix | null = null;

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly plans: PlansService,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
    ) {}

    /** El resumen por módulo (y por app conectada). */
    async summary(opts: { refresh?: boolean; now?: Date } = {}): Promise<PlatformUsage> {
        const m = await this.matrix(opts);
        const live = new Set(m.live.map(String));
        const planList = await this.plans.list();
        const modules = USAGE_MODULES.map((info) => {
            const byTenant = m.cells[info.key] ?? {};
            let using = 0;
            let active = 0;
            let total = 0;
            let activity = 0;
            let last: number | null = null;
            for (const [tid, cell] of Object.entries(byTenant)) {
                if (!live.has(tid)) continue;
                if (usageCellUsing(info, cell)) using += 1;
                if ((cell[1] ?? 0) > 0) active += 1;
                total += cell[0];
                activity += cell[1] ?? 0;
                if (cell[2] !== null && (last === null || cell[2] > last)) last = cell[2];
            }
            return {
                key: info.key,
                tenants_using: using,
                tenants_active: active,
                total,
                activity: info.activity_label === null ? null : activity,
                last_at: isoOf(last),
                disabled_in_plans: info.plan_module
                    ? planList.filter((p) => (p.disabled_modules as string[]).includes(info.plan_module!)).map((p) => p.name)
                    : [],
            };
        });
        return { generated_at: m.generated_at, days: USAGE_DAYS, tenants_live: m.live.length, modules, apps: m.apps, unmeasured: m.unmeasured ?? [] };
    }

    /** Las empresas que usan un módulo, de la que más a la que menos. */
    async module(key: UsageModuleKey, opts: { now?: Date } = {}): Promise<PlatformUsageModuleDetail> {
        const info = USAGE_MODULES.find((x) => x.key === key);
        if (!info) throw new NotFoundException({ code: 'usage_module_not_found', message: 'Ese módulo no existe.' });
        const m = await this.matrix(opts);
        const live = new Set(m.live.map(String));
        const entries = Object.entries(m.cells[key] ?? {})
            .filter(([tid, cell]) => live.has(tid) && (usageCellUsing(info, cell) || (cell[1] ?? 0) > 0))
            .sort((a, b) => compareUsageCells(a[1], b[1]));
        const shown = entries.slice(0, DETAIL_LIMIT);
        const ids = shown.map(([tid]) => Number(tid));
        const names = new Map<number, { name: string; slug: string; plan: string }>();
        if (ids.length) {
            const res = await this.db.execute<{ id: number | string; name: string; slug: string; plan: string | null }>(
                sql`SELECT id, name, slug, plan FROM tenants WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
            );
            for (const r of rowsOf<{ id: number | string; name: string; slug: string; plan: string | null }>(res)) {
                names.set(Number(r.id), { name: r.name, slug: r.slug, plan: r.plan ?? 'trial' });
            }
        }
        return {
            key,
            generated_at: m.generated_at,
            truncated: entries.length > shown.length,
            rows: shown
                .filter(([tid]) => names.has(Number(tid)))
                .map(([tid, cell]) => {
                    const t = names.get(Number(tid))!;
                    return {
                        tenant_id: Number(tid),
                        name: t.name,
                        slug: t.slug,
                        plan: t.plan,
                        total: cell[0],
                        activity: info.activity_label === null ? null : (cell[1] ?? 0),
                        last_at: isoOf(cell[2]),
                    };
                }),
        };
    }

    /** Lo que usa una empresa. */
    async tenant(tenantId: number, opts: { now?: Date } = {}): Promise<PlatformTenantUsage> {
        const m = await this.matrix(opts);
        const tid = String(tenantId);
        const modules = USAGE_MODULES.flatMap((info) => {
            const cell = m.cells[info.key]?.[tid];
            if (!cell || (!usageCellUsing(info, cell) && (cell[1] ?? 0) === 0)) return [];
            return [{ key: info.key, total: cell[0], activity: info.activity_label === null ? null : (cell[1] ?? 0), last_at: isoOf(cell[2]) }];
        });
        return { tenant_id: tenantId, generated_at: m.generated_at, modules };
    }

    // ─────────────────────────── la matriz ───────────────────────────

    private async matrix(opts: { refresh?: boolean; now?: Date }): Promise<Matrix> {
        const now = opts.now ?? new Date();
        const cached = this.local ?? (await this.readCache());
        const age = cached ? now.getTime() - Date.parse(cached.generated_at) : Infinity;
        const wanted = opts.refresh ? age > MIN_REFRESH_MS : age > FRESH_MS;
        if (cached && !wanted) {
            this.local = cached;
            return cached;
        }
        if (!this.inflight) {
            this.inflight = this.compute(now)
                .then(async (m) => {
                    this.local = m;
                    await this.writeCache(m);
                    return m;
                })
                .finally(() => {
                    this.inflight = null;
                });
        }
        return this.inflight;
    }

    private async readCache(): Promise<Matrix | null> {
        if (!this.redis) return null;
        try {
            const raw = await this.redis.get(CACHE_KEY);
            if (!raw) return null;
            const m = JSON.parse(raw) as Matrix;
            return typeof m?.generated_at === 'string' && Array.isArray(m.live) ? m : null;
        } catch {
            return null;
        }
    }

    private async writeCache(m: Matrix): Promise<void> {
        if (!this.redis) return;
        try {
            await this.redis.set(CACHE_KEY, JSON.stringify(m), 'PX', FRESH_MS * 3);
        } catch (e) {
            this.log.warn(`no se pudo guardar el uso por módulo: ${(e as Error).message}`);
        }
    }

    /** Calcula la matriz entera (exportado para las pruebas a través de `summary`). */
    private async compute(now: Date): Promise<Matrix> {
        const t0 = Date.now();
        const since = new Date(now.getTime() - USAGE_DAYS * 24 * 60 * 60 * 1000);
        const ctx: Ctx = { since, sinceDay: since.toISOString().slice(0, 10), period: periodOf(now) };

        const jobs: Array<{ key: UsageModuleKey; kind: 'total' | 'activity'; q: SQL }> = [];
        for (const [key, metric] of Object.entries(METRICS) as Array<[UsageModuleKey, Metric]>) {
            if (metric.total) jobs.push({ key, kind: 'total', q: metric.total(ctx) });
            if (metric.activity) jobs.push({ key, kind: 'activity', q: metric.activity(ctx) });
        }
        const unmeasured = new Set<UsageModuleKey>();
        const results = await inBatches(
            jobs.map((j) => async () => {
                try {
                    return rowsOf<Row>(await this.db.execute(j.q));
                } catch (e) {
                    // Una medición rota no tumba las demás: ese módulo sale en cero,
                    // la pantalla lo dice y queda en el log.
                    unmeasured.add(j.key);
                    this.log.warn(`uso por módulo: falló «${j.key}» (${j.kind}): ${(e as Error).message}`);
                    return [] as Row[];
                }
            }),
            CONCURRENCY,
        );

        const cells: Matrix['cells'] = {};
        jobs.forEach((j, i) => {
            const byTenant = (cells[j.key] ??= {});
            for (const r of results[i]!) {
                const tid = String(r.tenant_id);
                const n = Math.max(0, Math.round(Number(r.n ?? 0)));
                const last = epochSec(r.last_at);
                const cell = (byTenant[tid] ??= [0, null, null]);
                if (j.kind === 'total') {
                    cell[0] = n;
                    // La última vez es la de la actividad si la hay; si no, el último cambio.
                    if (cell[2] === null) cell[2] = last;
                } else {
                    cell[1] = n;
                    if (last !== null) cell[2] = last;
                }
            }
        });

        const liveRes = await this.db.execute<{ id: number | string }>(sql`SELECT id FROM tenants WHERE archived_at IS NULL`);
        const live = rowsOf<{ id: number | string }>(liveRes).map((r) => Number(r.id));
        const appsRes = await this.db.execute<{ provider: string; tenants: number | string; connections: number | string }>(sql`
            SELECT c.provider, count(DISTINCT c.tenant_id) AS tenants, count(*) AS connections
            FROM connections c JOIN tenants t ON t.id = c.tenant_id AND t.archived_at IS NULL
            GROUP BY 1 ORDER BY 2 DESC, 1`);
        const apps = rowsOf<{ provider: string; tenants: number | string; connections: number | string }>(appsRes).map((r) => ({
            key: r.provider,
            tenants: Number(r.tenants),
            connections: Number(r.connections),
        }));

        this.log.log(`uso por módulo calculado en ${Date.now() - t0} ms (${jobs.length} consultas, ${live.length} empresas)`);
        return { generated_at: now.toISOString(), live, cells, apps, unmeasured: [...unmeasured] };
    }
}
