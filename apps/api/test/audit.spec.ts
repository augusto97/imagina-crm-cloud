import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, tenants, users } from '../src/db/schema';
import { AuditService } from '../src/audit/audit.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.114 — Bitácora de acciones administrativas: aislamiento por tenant
 * (RLS), orden del feed y resistencia a fallos.
 */
describe('AuditService (Postgres real)', () => {
    let pg: TestPg;
    let audit: AuditService;
    let tenantA: number;
    let tenantB: number;
    let userId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        audit = new AuditService(tenantDb);

        const [a] = await pg.db
            .insert(tenants)
            .values({ name: 'Empresa A', slug: `audit-a-${Date.now()}` })
            .returning();
        const [b] = await pg.db
            .insert(tenants)
            .values({ name: 'Empresa B', slug: `audit-b-${Date.now()}` })
            .returning();
        tenantA = a!.id;
        tenantB = b!.id;

        const [u] = await pg.db
            .insert(users)
            .values({
                email: `auditor-${Date.now()}@test.local`,
                passwordHash: 'x',
                name: 'Ana Auditora',
            })
            .returning();
        userId = u!.id;
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    it('registra la acción con el nombre del objeto y quién la hizo', async () => {
        await audit.log({
            tenantId: tenantA,
            userId,
            action: 'list.delete',
            targetType: 'list',
            targetId: 987,
            targetLabel: 'Clientes',
            meta: { motivo: 'limpieza' },
        });

        const { data } = await audit.list(tenantA);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            action: 'list.delete',
            target_type: 'list',
            target_id: 987,
            // El nombre queda CONGELADO: la lista ya no existe y la entrada
            // sigue siendo legible.
            target_label: 'Clientes',
            user_id: userId,
            user_name: 'Ana Auditora',
        });
        expect(data[0]!.meta).toEqual({ motivo: 'limpieza' });
    });

    it('el feed no cruza empresas (RLS)', async () => {
        await audit.log({
            tenantId: tenantB,
            userId,
            action: 'member.remove',
            targetLabel: 'alguien@b.test',
        });

        const a = await audit.list(tenantA);
        const b = await audit.list(tenantB);
        expect(a.data.every((e) => e.action !== 'member.remove')).toBe(true);
        expect(b.data).toHaveLength(1);
        expect(b.data[0]!.target_label).toBe('alguien@b.test');
    });

    it('devuelve lo más reciente primero y pagina por cursor', async () => {
        for (const label of ['uno', 'dos', 'tres']) {
            await audit.log({ tenantId: tenantB, userId, action: 'field.delete', targetLabel: label });
        }
        const page1 = await audit.list(tenantB, { limit: 2 });
        expect(page1.data.map((e) => e.target_label)).toEqual(['tres', 'dos']);
        expect(page1.meta.next_cursor).not.toBeNull();

        const page2 = await audit.list(tenantB, { limit: 2, cursor: Number(page1.meta.next_cursor) });
        expect(page2.data[0]!.target_label).toBe('uno');
    });

    it('un fallo al registrar NO tumba la operación del usuario', async () => {
        // Acción más larga que la columna → el insert falla. La promesa
        // igual resuelve: la bitácora es best-effort.
        await expect(
            audit.log({
                tenantId: tenantA,
                userId,
                action: ('x'.repeat(200) as unknown) as 'list.delete',
                targetLabel: 'no importa',
            }),
        ).resolves.toBeUndefined();
    });

    it('es append-only desde el rol de la app (sin UPDATE/DELETE en el service)', async () => {
        // No hay API para modificar entradas: el service sólo expone log/list.
        expect(Object.getOwnPropertyNames(AuditService.prototype).sort()).toEqual(
            ['constructor', 'list', 'log', 'logInTx'].sort(),
        );
        const rows = await pg.db
            .select({ n: sql<number>`count(*)::int` })
            .from(auditLog)
            .where(eq(auditLog.tenantId, tenantA));
        expect(rows[0]!.n).toBeGreaterThan(0);
    });
});
