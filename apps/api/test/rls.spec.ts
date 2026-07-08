import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lists, memberships, records, tenants, users } from '../src/db/schema';
import { withoutContext, withTenant, withUser } from '../src/db/tenant-tx';
import { startPostgres, type TestPg } from './helpers/containers';

/** Aplana `message` + toda la cadena de `cause` de un error a un solo string. */
function errorChainText(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; current instanceof Error && depth < 10; depth++) {
        parts.push(current.message);
        current = (current as { cause?: unknown }).cause;
    }
    return parts.join(' | ');
}

/**
 * Tests de RLS (obligatorios para toda tabla nueva — CLAUDE.md §4).
 * Postgres real vía Testcontainers; las policies usan FORCE ROW LEVEL
 * SECURITY, así que aplican incluso a la conexión owner de los tests.
 */
describe('Row-Level Security por tenant', () => {
    let pg: TestPg;
    let tenantA: number;
    let tenantB: number;
    let userA: number;
    let userB: number;
    let recordA: number;
    let recordB: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const { db } = pg;

        // tenants/users son plano global (sin tenant_id → sin RLS de tenant).
        const [ta] = await db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;

        const [ua] = await db
            .insert(users)
            .values({ email: 'a@acme.test', passwordHash: 'x', name: 'Ana' })
            .returning();
        const [ub] = await db
            .insert(users)
            .values({ email: 'b@globex.test', passwordHash: 'x', name: 'Beto' })
            .returning();
        userA = ua!.id;
        userB = ub!.id;

        // Datos de cada tenant, insertados DENTRO de su contexto RLS.
        recordA = await withTenant(db, tenantA, async (tx) => {
            await tx.insert(memberships).values({ userId: userA, tenantId: tenantA, role: 'admin' });
            const [list] = await tx
                .insert(lists)
                .values({ tenantId: tenantA, slug: 'clientes', name: 'Clientes' })
                .returning();
            const [record] = await tx
                .insert(records)
                .values({
                    tenantId: tenantA,
                    listId: list!.id,
                    data: { f1: 'CC Fundadores' },
                    createdBy: userA,
                })
                .returning();
            return record!.id;
        });

        recordB = await withTenant(db, tenantB, async (tx) => {
            await tx.insert(memberships).values({ userId: userB, tenantId: tenantB, role: 'admin' });
            const [list] = await tx
                .insert(lists)
                .values({ tenantId: tenantB, slug: 'clientes', name: 'Clientes' })
                .returning();
            const [record] = await tx
                .insert(records)
                .values({
                    tenantId: tenantB,
                    listId: list!.id,
                    data: { f1: 'Globex Corp' },
                    createdBy: userB,
                })
                .returning();
            return record!.id;
        });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    it('cada tenant ve SOLO sus records', async () => {
        const seenByA = await withTenant(pg.db, tenantA, (tx) => tx.select().from(records));
        expect(seenByA.map((r) => r.id)).toEqual([recordA]);

        const seenByB = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records));
        expect(seenByB.map((r) => r.id)).toEqual([recordB]);
    });

    it('cada tenant ve SOLO sus lists (mismo slug en ambos tenants)', async () => {
        const listsA = await withTenant(pg.db, tenantA, (tx) => tx.select().from(lists));
        expect(listsA).toHaveLength(1);
        expect(listsA[0]!.tenantId).toBe(tenantA);
    });

    it('sin contexto de tenant: cero filas (default deny), no un error silencioso', async () => {
        const noContext = await withoutContext(pg.db, (tx) => tx.select().from(records));
        expect(noContext).toHaveLength(0);
        const noContextLists = await withoutContext(pg.db, (tx) => tx.select().from(lists));
        expect(noContextLists).toHaveLength(0);
    });

    it('INSERT con tenant_id ajeno viola el WITH CHECK de la policy', async () => {
        const error = await withTenant(pg.db, tenantA, async (tx) => {
            const [foreignList] = await tx
                .select()
                .from(lists)
                .where(sql`${lists.tenantId} = ${tenantB}`);
            // Ni siquiera podemos leer la lista ajena…
            expect(foreignList).toBeUndefined();
            // …y el insert cruzado revienta contra la policy.
            return tx
                .insert(records)
                .values({ tenantId: tenantB, listId: 999, data: {}, createdBy: userA })
                .then(() => null)
                .catch((e: unknown) => e);
        });

        // Drizzle envuelve el error de pg: el motivo RLS vive en la cadena de causes.
        expect(error).not.toBeNull();
        expect(errorChainText(error)).toMatch(/row-level security|violates/i);
    });

    it('UPDATE cruzado no afecta filas de otro tenant', async () => {
        const updated = await withTenant(pg.db, tenantA, (tx) =>
            tx
                .update(records)
                .set({ data: { f1: 'hackeado' } })
                .where(sql`${records.id} = ${recordB}`)
                .returning(),
        );
        expect(updated).toHaveLength(0);

        const intact = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records));
        expect(intact[0]!.data).toEqual({ f1: 'Globex Corp' });
    });

    it('DELETE cruzado no borra filas de otro tenant', async () => {
        await withTenant(pg.db, tenantA, (tx) =>
            tx.delete(records).where(sql`${records.id} = ${recordB}`),
        );
        const stillThere = await withTenant(pg.db, tenantB, (tx) => tx.select().from(records));
        expect(stillThere.map((r) => r.id)).toEqual([recordB]);
    });

    it('memberships: el plano auth ve solo las memberships PROPIAS', async () => {
        const ofA = await withUser(pg.db, userA, (tx) => tx.select().from(memberships));
        expect(ofA).toHaveLength(1);
        expect(ofA[0]!.userId).toBe(userA);

        const ofB = await withUser(pg.db, userB, (tx) => tx.select().from(memberships));
        expect(ofB).toHaveLength(1);
        expect(ofB[0]!.userId).toBe(userB);
    });

    it('fields hereda el mismo aislamiento (tabla con tenant_id ⇒ RLS)', async () => {
        const rlsTables = await pg.db.execute(sql`
            select relname, relrowsecurity, relforcerowsecurity
            from pg_class
            where relname in ('lists', 'fields', 'records', 'memberships')
        `);
        for (const row of rlsTables.rows) {
            expect(row.relrowsecurity, `${String(row.relname)} sin RLS`).toBe(true);
            expect(row.relforcerowsecurity, `${String(row.relname)} sin FORCE RLS`).toBe(true);
        }
    });
});
