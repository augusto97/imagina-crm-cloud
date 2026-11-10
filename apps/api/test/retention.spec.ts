import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pruneTables } from '../src/retention/retention.service';
import { startPostgres, type TestPg } from './helpers/containers';

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
});
