import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { PLATFORM_RETENTION_KEY, RetentionService, pruneTables, retentionRules, tableSizes } from '../src/retention/retention.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * v0.1.393 — Retención de las tablas que crecían sin tope: se borra lo viejo
 * que ya no sirve y nada de lo que todavía se usa.
 */
describe('v0.1.393 — retención de tablas (Postgres real)', () => {
    let pg: TestPg;
    let tenantId: number;
    let userId: number;
    const one = async (q: ReturnType<typeof sql>): Promise<number> => {
        const r = await pg.db.execute<{ n: number }>(q);
        return Number(((r as unknown as { rows: Array<{ n: number }> }).rows)[0]!.n);
    };

    beforeAll(async () => {
        pg = await startPostgres();
        tenantId = await one(sql`INSERT INTO tenants (slug, name) VALUES ('ret', 'Ret') RETURNING id AS n`);
        userId = await one(sql`INSERT INTO users (email, password_hash, name) VALUES ('ret@test.local', 'x', 'Ret') RETURNING id AS n`);
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('borra avisos, recordatorios y Problemas viejos; conserva lo reciente y lo pendiente', async () => {
        const ago = (days: number) => sql`now() - make_interval(days => ${days})`;
        await pg.db.execute(sql`
            INSERT INTO notifications (tenant_id, user_id, kind, title, read_at, created_at) VALUES
                (${tenantId}, ${userId}, 'mention', 'leído viejo', now(), ${ago(100)}),
                (${tenantId}, ${userId}, 'mention', 'sin leer de 100 días', null, ${ago(100)}),
                (${tenantId}, ${userId}, 'mention', 'sin leer de 200 días', null, ${ago(200)}),
                (${tenantId}, ${userId}, 'mention', 'leído reciente', now(), ${ago(10)})
        `);
        await pg.db.execute(sql`
            INSERT INTO reminders (tenant_id, user_id, remind_at, fired_at, created_at) VALUES
                (${tenantId}, ${userId}, ${ago(200)}, ${ago(200)}, ${ago(200)}),
                (${tenantId}, ${userId}, now() + interval '30 days', null, ${ago(200)})
        `);
        await pg.db.execute(sql`
            INSERT INTO incidents (tenant_id, key, source, title, resolved_at) VALUES
                (${tenantId}, 'viejo', 'automation', 'resuelto hace mucho', ${ago(120)}),
                (${tenantId}, 'abierto', 'automation', 'sigue abierto', null),
                (${tenantId}, 'reciente', 'automation', 'resuelto hace poco', ${ago(5)})
        `);
        const out = await pruneTables(pg.db);
        expect(out).toMatchObject({ notifications: 2, reminders: 1, incidents: 1 });
        const titles = async (table: string) =>
            ((await pg.db.execute<{ title: string }>(sql`SELECT title FROM ${sql.identifier(table)} ORDER BY id`)) as unknown as { rows: Array<{ title: string }> }).rows.map((r) => r.title);
        expect(await titles('notifications')).toEqual(['sin leer de 100 días', 'leído reciente']);
        expect(await titles('incidents')).toEqual(['sigue abierto', 'resuelto hace poco']);
        expect(await one(sql`SELECT count(*)::int AS n FROM reminders WHERE fired_at IS NULL`)).toBe(1);
        // Una segunda vuelta no encuentra nada más.
        expect(Object.values(await pruneTables(pg.db)).every((n) => n === 0)).toBe(true);
    });

    it('v0.1.439 — corridas viejas: sin la última, las que esperan ni lo que frena a «por fecha de vencimiento»', async () => {
        const ago = (days: number) => sql`now() - make_interval(days => ${days})`;
        const listId = await one(sql`INSERT INTO lists (tenant_id, slug, name) VALUES (${tenantId}, 'facturas', 'Facturas') RETURNING id AS n`);
        const rec = async () => one(sql`INSERT INTO records (tenant_id, list_id, data, created_by) VALUES (${tenantId}, ${listId}, '{}'::jsonb, ${userId}) RETURNING id AS n`);
        const auto = async (name: string, trigger: string) =>
            one(sql`INSERT INTO automations (tenant_id, list_id, name, trigger_type, is_active) VALUES (${tenantId}, ${listId}, ${name}, ${trigger}, true) RETURNING id AS n`);
        const run = async (automationId: number, recordId: number | null, status: string, days: number, label: string) =>
            one(sql`INSERT INTO automation_runs (tenant_id, automation_id, record_id, status, error, created_at)
                VALUES (${tenantId}, ${automationId}, ${recordId}, ${status}, ${label}, ${ago(days)}) RETURNING id AS n`);

        const r1 = await rec();
        const r2 = await rec();
        const r3 = await rec();
        const gone = await rec();
        const common = await auto('Bienvenida', 'record_created');
        const lonely = await auto('Una sola vez', 'record_created');
        const due = await auto('Recordar el pago', 'due_date_reached');

        await run(common, r1, 'success', 200, 'común vieja');
        await run(common, r1, 'failed', 150, 'común vieja fallida');
        await run(common, r1, 'waiting', 150, 'común esperando');
        await run(common, r2, 'success', 3, 'común reciente');
        await run(lonely, r1, 'success', 300, 'única de su automatización');
        await run(due, r1, 'success', 200, 'vencimiento viejo de r1');
        await run(due, r1, 'success', 120, 'vencimiento nuevo de r1');
        await run(due, r2, 'failed', 150, 'reintento fallido de r2');
        await run(due, gone, 'success', 200, 'vencimiento de un registro borrado');
        await run(due, r3, 'success', 2, 'vencimiento reciente de r3');
        await pg.db.execute(sql`DELETE FROM records WHERE id = ${gone}`);

        const left = async () =>
            ((await pg.db.execute<{ error: string }>(sql`SELECT error FROM automation_runs ORDER BY id`)) as unknown as { rows: Array<{ error: string }> }).rows.map((r) => r.error);

        // Para siempre: no se toca nada.
        await pruneTables(pg.db, retentionRules({ automation_runs_days: null, activity_days: null }));
        expect(await left()).toHaveLength(10);

        const out = await pruneTables(pg.db, retentionRules({ automation_runs_days: 90, activity_days: null }));
        expect(out.automation_runs).toBe(4);
        expect(await left()).toEqual([
            'común esperando',
            'común reciente',
            'única de su automatización',
            'vencimiento nuevo de r1',
            'reintento fallido de r2',
            'vencimiento reciente de r3',
        ]);
        // El escaneo de «por fecha de vencimiento» ve lo mismo que antes: r1
        // sigue con una corrida no fallida, r2 con su intento fallido.
        expect(await one(sql`SELECT count(*)::int AS n FROM automation_runs WHERE automation_id = ${due} AND record_id = ${r1} AND status <> 'failed'`)).toBe(1);
        expect(await one(sql`SELECT count(*)::int AS n FROM automation_runs WHERE automation_id = ${due} AND record_id = ${r2} AND status = 'failed'`)).toBe(1);
    });

    it('v0.1.439 — la actividad sólo se poda si el operador le pone plazo', async () => {
        const listId = await one(sql`SELECT id AS n FROM lists WHERE slug = 'facturas'`);
        await pg.db.execute(sql`
            INSERT INTO activity (tenant_id, list_id, action, created_at) VALUES
                (${tenantId}, ${listId}, 'record_updated', now() - interval '800 days'),
                (${tenantId}, ${listId}, 'record_updated', now() - interval '400 days'),
                (${tenantId}, ${listId}, 'record_updated', now() - interval '10 days')
        `);
        await pruneTables(pg.db, retentionRules({ automation_runs_days: 90, activity_days: null }));
        expect(await one(sql`SELECT count(*)::int AS n FROM activity`)).toBe(3);
        const out = await pruneTables(pg.db, retentionRules({ automation_runs_days: 90, activity_days: 730 }));
        expect(out.activity).toBe(1);
        expect(await one(sql`SELECT count(*)::int AS n FROM activity`)).toBe(2);
    });

    it('v0.1.439 — lo que pesa cada tabla y los ajustes del operador (Redis)', async () => {
        await pg.db.execute(sql`ANALYZE`);
        const sizes = await tableSizes(pg.db, 60);
        expect(sizes.db_bytes).toBeGreaterThan(0);
        const runs = sizes.tables.find((t) => t.table === 'automation_runs');
        expect(runs).toMatchObject({ label: 'Historial de corridas de automatizaciones', pruned: 'setting' });
        expect(sizes.tables.find((t) => t.table === 'notifications')?.pruned).toBe('auto');
        expect(sizes.tables.find((t) => t.table === 'records')?.pruned).toBe('never');

        let redisC: TestRedis | undefined;
        let redis: Redis | undefined;
        try {
            redisC = await startRedis();
            redis = new Redis(redisC.url);
            const svc = new RetentionService(loadEnv({}), pg.db, redis);
            expect((await svc.status()).settings).toEqual({ automation_runs_days: 90, activity_days: null });
            await redis.set(PLATFORM_RETENTION_KEY, '{no es json');
            expect((await svc.settings()).automation_runs_days).toBe(90);
            const st = await svc.setSettings({ automation_runs_days: 30 });
            expect(st.settings).toEqual({ automation_runs_days: 30, activity_days: null });
            expect(JSON.parse((await redis.get(PLATFORM_RETENTION_KEY))!)).toEqual({ automation_runs_days: 30, activity_days: null });
            // Una vuelta deja su resultado a la vista.
            await svc.tick();
            const last = (await svc.status()).last;
            expect(last).toMatchObject({ error: null, more: false });
            expect(last?.deleted).toHaveProperty('automation_runs');
        } finally {
            redis?.disconnect();
            await redisC?.stop();
        }
    }, 120_000);
});

