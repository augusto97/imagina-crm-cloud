import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { tenants } from '../src/db/schema';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from '../test/helpers/containers';

/**
 * Benchmarks de los contratos de rendimiento (STANDALONE §13) contra un seed de
 * 100k records en un tenant. Reporta p50/p95 vs. presupuesto y marca PASS/FAIL.
 *
 * La aserción dura (fallar el build si se rompe el presupuesto) se activa con
 * BENCH_STRICT=1 — así CI puede hacerlo cumplir en hardware representativo,
 * mientras que en un runner efímero cualquiera el harness sólo reporta (el
 * timing absoluto de un contenedor compartido no es comparable a producción).
 */

const SEED = Number(process.env.BENCH_SEED ?? 100_000);
const ITERS = Number(process.env.BENCH_ITERS ?? 120);
const STRICT = process.env.BENCH_STRICT === '1';
const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

interface BudgetResult {
    metric: string;
    budgetMs: number;
    p50: number;
    p95: number;
    pass: boolean;
}

describe(`Perf §13 (seed ${SEED})`, () => {
    let pg: TestPg;
    let records: RecordsService;
    let tenantId: number;
    let f: Record<string, Field>;
    const results: BudgetResult[] = [];

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const lists = new ListsService(tenantDb, new ListsRepository(), rt);
        const fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        records = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fields,
            rt,
            activity,
            new AutomationDispatcher(),
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'bench', name: 'Bench' }).returning();
        tenantId = t!.id;
        await lists.create(tenantId, { name: 'Deals' });
        const defs: CreateFieldInput[] = [
            { label: 'Monto', type: 'number', slug: 'monto', is_indexed: true },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                is_indexed: true,
                config: {
                    options: ['a', 'b', 'c', 'd', 'e'].map((v) => ({ value: v, label: v.toUpperCase() })),
                },
            },
        ];
        f = {};
        for (const d of defs) f[d.slug!] = await fields.create(tenantId, 'deals', d);

        await seed(pg, tenantId, f.monto!.id, f.estado!.id, SEED);
    }, 600_000);

    afterAll(async () => {
        // eslint-disable-next-line no-console
        console.table(results);
        await pg?.stop();
    });

    it(`GET /records — ${SEED} filas, 2 filtros, cursor 50 (p95 ≤ 100 ms)`, async () => {
        const run = () =>
            records.list(tenantId, admin, 'deals', {
                limit: 50,
                sort_dir: 'desc',
                filter_tree: {
                    type: 'group',
                    logic: 'and',
                    children: [
                        { type: 'condition', field_id: f.monto!.id, op: 'gte', value: 5000 },
                        { type: 'condition', field_id: f.estado!.id, op: 'eq', value: 'a' },
                    ],
                },
            });
        const r = await measure('GET /records (2 filtros, cursor 50)', 100, run, ITERS);
        results.push(r);
        if (STRICT) expect(r.p95).toBeLessThanOrEqual(r.budgetMs);
        else expect(r.p95).toBeLessThan(2000); // guardia anti-regresión catastrófica
    });

    it('PATCH record (p95 ≤ 60 ms)', async () => {
        // Ids reales para actualizar (los primeros del seed).
        const page = await records.list(tenantId, admin, 'deals', { limit: 100, sort_dir: 'asc' });
        const ids = page.data.map((r) => r.id);
        let i = 0;
        const run = () => {
            const id = ids[i++ % ids.length]!;
            return records.update(tenantId, admin, 'deals', id, {
                data: { [`f${f.monto!.id}`]: 1234 },
            });
        };
        const r = await measure('PATCH record', 60, run, ITERS);
        results.push(r);
        if (STRICT) expect(r.p95).toBeLessThanOrEqual(r.budgetMs);
        else expect(r.p95).toBeLessThan(2000);
    });
});

/** Siembra `n` records vía generate_series (superusuario del contenedor → sin RLS). */
async function seed(pg: TestPg, tenantId: number, numId: number, selId: number, n: number): Promise<void> {
    const numKey = `f${numId}`;
    const selKey = `f${selId}`;
    await pg.pool.query(
        `INSERT INTO records (tenant_id, list_id, created_by, data, created_at, updated_at)
         SELECT $1, (SELECT id FROM lists WHERE tenant_id = $1 LIMIT 1), 0,
           jsonb_build_object(
             $2::text, (floor(random() * 100000))::int,
             $3::text, (ARRAY['a','b','c','d','e'])[1 + floor(random() * 5)]
           ), now(), now()
         FROM generate_series(1, $4)`,
        [tenantId, numKey, selKey, n],
    );
    // Índices de expresión que espeja lo que `is_indexed` debe crear (matchean
    // las expresiones tipadas del QueryBuilder). Parciales por deleted_at.
    await pg.pool.query(
        `CREATE INDEX IF NOT EXISTS bench_num ON records (((data ->> '${numKey}')::numeric)) WHERE deleted_at IS NULL`,
    );
    await pg.pool.query(
        `CREATE INDEX IF NOT EXISTS bench_sel ON records (list_id, (data ->> '${selKey}'), id DESC) WHERE deleted_at IS NULL`,
    );
    await pg.pool.query('ANALYZE records');
}

/** Corre `fn` ITERS veces (tras warmup) y calcula p50/p95 en ms. */
async function measure(
    metric: string,
    budgetMs: number,
    fn: () => Promise<unknown>,
    iters: number,
): Promise<BudgetResult> {
    for (let i = 0; i < 10; i++) await fn(); // warmup
    const samples: number[] = [];
    for (let i = 0; i < iters; i++) {
        const start = process.hrtime.bigint();
        await fn();
        samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p = (q: number) => samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)]!;
    const p50 = round(p(0.5));
    const p95 = round(p(0.95));
    return { metric, budgetMs, p50, p95, pass: p95 <= budgetMs };
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
