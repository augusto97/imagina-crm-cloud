import { ForbiddenException } from '@nestjs/common';
import { isReadOnly } from '@imagina-base/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { attachments, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

describe('BillingService (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let billing: BillingService;
    let tenantId: number;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        billing = new BillingService(tenantDb, new PlansService(pg.db));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    beforeEach(async () => {
        // Cada test usa su propio tenant (el uso/límites son por-tenant, así
        // no hace falta limpiar entre tests — y RLS bloquea el borrado cruzado).
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `acme-${counter}`, name: 'ACME', plan: 'trial', status: 'trialing' })
            .returning();
        tenantId = t!.id;
    });

    it('summary: plan, límites, uso y read_only', async () => {
        const list = await listsService.create(tenantId, { name: 'L' });
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values({ tenantId, listId: list.id, createdBy: 0, data: {} }),
        );
        const [u] = await pg.db
            .insert(users)
            .values({ email: `u${tenantId}@acme.test`, passwordHash: 'x', name: 'U' })
            .returning();
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId: u!.id, tenantId, role: 'admin' }).onConflictDoNothing(),
        );

        const s = await billing.summary(tenantId);
        expect(s).toMatchObject({ plan: 'trial', status: 'trialing', read_only: false });
        expect(s.limits.max_records).toBe(500);
        expect(s.usage).toMatchObject({ records: 1, users: 1, automations: 0 });
    });

    it('setBilling cambia plan/estado; read_only sigue al status (ADR-S09)', async () => {
        let s = await billing.setBilling(tenantId, { plan: 'pro', status: 'active' });
        expect(s).toMatchObject({ plan: 'pro', status: 'active', read_only: false });

        s = await billing.setBilling(tenantId, { status: 'past_due' });
        expect(s.read_only).toBe(true);
        expect(isReadOnly('past_due')).toBe(true);

        s = await billing.setBilling(tenantId, { status: 'active' });
        expect(s.read_only).toBe(false);
    });

    it('assertCanCreateRecord: por debajo del límite pasa; enterprise es ilimitado', async () => {
        await expect(billing.assertCanCreateRecord(tenantId)).resolves.toBeUndefined();
        await billing.setBilling(tenantId, { plan: 'enterprise' });
        await expect(billing.assertCanCreateRecord(tenantId)).resolves.toBeUndefined();
    });

    it('assertCanCreateRecord: alcanzado el tope del trial (500) → Forbidden', async () => {
        const list = await listsService.create(tenantId, { name: 'L' });
        // Inserta 500 records de una (tope del plan trial).
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values(
                Array.from({ length: 500 }, () => ({ tenantId, listId: list.id, createdBy: 0, data: {} })),
            ),
        );
        await expect(billing.assertCanCreateRecord(tenantId)).rejects.toBeInstanceOf(ForbiddenException);

        // Subir de plan libera el límite.
        await billing.setBilling(tenantId, { plan: 'starter' });
        await expect(billing.assertCanCreateRecord(tenantId)).resolves.toBeUndefined();
    });

    it('assertCanUpload: cuota de storage del plan (trial 100MB) y enterprise ilimitado', async () => {
        await billing.setBilling(tenantId, { plan: 'trial' });
        const [up] = await pg.db
            .insert(users)
            .values({ email: `up${tenantId}@acme.test`, passwordHash: 'x', name: 'Up' })
            .returning();
        const userId = up!.id;
        // 99 MB ya usados → subir 2 MB más rebota; 1 MB pasa.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(attachments).values({
                tenantId,
                filename: 'grande.bin',
                mime: 'application/octet-stream',
                sizeBytes: 99 * 1024 * 1024,
                storageKey: `t${tenantId}/grande.bin`,
                createdBy: userId,
            }),
        );
        await expect(billing.assertCanUpload(tenantId, 2 * 1024 * 1024)).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        await expect(billing.assertCanUpload(tenantId, 1024 * 1024)).resolves.toBeUndefined();
        // El summary expone el uso de storage.
        const summary = await billing.summary(tenantId);
        expect(summary.usage.storage_bytes).toBe(99 * 1024 * 1024);
        expect(summary.limits.max_storage_mb).toBe(100);
        // Enterprise: ilimitado.
        await billing.setBilling(tenantId, { plan: 'enterprise' });
        await expect(billing.assertCanUpload(tenantId, 10 ** 12)).resolves.toBeUndefined();
    });

    it('el gate de límite es ortogonal al status (el read-only lo aplica TenantGuard)', async () => {
        await billing.setBilling(tenantId, { status: 'past_due' });
        await expect(billing.assertCanCreateRecord(tenantId)).resolves.toBeUndefined();
    });
});
