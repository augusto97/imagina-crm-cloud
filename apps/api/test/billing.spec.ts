import { ForbiddenException } from '@nestjs/common';
import { isReadOnly } from '@imagina-base/shared';
import { eq, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { BillingService, recordBulkKey, recordCountKey } from '../src/billing/billing.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { attachments, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

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
        const plansSvc = new PlansService(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        billing = new BillingService(
            tenantDb,
            plansSvc,
            new EmailQuotaService(pg.db, plansSvc),
            new TenantSmtpService(pg.db, env),
        );
    });

    afterAll(async () => {
        client?.disconnect();
        await redis?.stop();
        await pg?.stop();
    });

    let redis: TestRedis | undefined;
    let client: Redis | undefined;
    /** Un BillingService con el conteo guardado en Redis (como en la app). */
    async function billingWithRedis(): Promise<{ svc: BillingService; r: { client: Redis } }> {
        redis ??= await startRedis();
        client ??= new Redis(redis.url);
        const plansSvc = new PlansService(pg.db);
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const svc = new BillingService(
            tenantDb,
            plansSvc,
            new EmailQuotaService(pg.db, plansSvc),
            new TenantSmtpService(pg.db, env),
            undefined,
            undefined,
            client,
        );
        return { svc, r: { client } };
    }

    function recordsWith(b: BillingService): RecordsService {
        const fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        return new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            b,
        );
    }

    it('lejos del tope, un alta no vuelve a contar la tabla: usa el conteo guardado', async () => {
        const { svc, r } = await billingWithRedis();
        const list = await listsService.create(tenantId, { name: 'Lejos' });
        const recs = recordsWith(svc);
        const count = vi.spyOn(svc as unknown as { countRecords: () => Promise<number> }, 'countRecords');
        const actor = { userId: 1, role: 'admin' as const };
        // La primera cuenta de verdad y guarda el conteo.
        await recs.create(tenantId, actor, String(list.id), { data: {} });
        expect(count).toHaveBeenCalledTimes(1);
        expect(await r.client.get(recordCountKey(tenantId))).toBe('1');
        // Las siguientes sólo suman al conteo guardado.
        for (let i = 0; i < 5; i++) await recs.create(tenantId, actor, String(list.id), { data: {} });
        expect(count).toHaveBeenCalledTimes(1);
        expect(await r.client.get(recordCountKey(tenantId))).toBe('6');
        // Dentro del margen (trial 500, margen 250) se vuelve a contar siempre.
        await r.client.set(recordCountKey(tenantId), '250', 'EX', 60);
        await recs.create(tenantId, actor, String(list.id), { data: {} });
        expect(count).toHaveBeenCalledTimes(2);
        // ...y el conteo exacto reemplaza al guardado.
        expect(await r.client.get(recordCountKey(tenantId))).toBe('7');
        count.mockRestore();
    });

    it('un lote que está por entrar cuenta contra el lugar de las altas sueltas', async () => {
        const { svc, r } = await billingWithRedis();
        const list = await listsService.create(tenantId, { name: 'Lote' });
        const recs = recordsWith(svc);
        const actor = { userId: 1, role: 'admin' as const };
        await recs.create(tenantId, actor, String(list.id), { data: {} });
        const count = vi.spyOn(svc as unknown as { countRecords: () => Promise<number> }, 'countRecords');
        // 300 por entrar (pasó su chequeo, todavía no se insertó).
        await svc.assertCanCreateRecords(tenantId, 300);
        expect(await r.client.get(recordBulkKey(tenantId))).toBe('300');
        count.mockClear();
        // 2 guardados + 300 por entrar > 500 - 250: se cuenta de verdad.
        await recs.create(tenantId, actor, String(list.id), { data: {} });
        expect(count).toHaveBeenCalledTimes(1);
        count.mockRestore();
    });

    it('con el conteo guardado, altas simultáneas a uno del tope siguen entrando de a UNA', async () => {
        const { svc, r } = await billingWithRedis();
        const list = await listsService.create(tenantId, { name: 'Tope' });
        const recs = recordsWith(svc);
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values(Array.from({ length: 498 }, () => ({ tenantId, listId: list.id, createdBy: 0, data: {} }))),
        );
        const actor = { userId: 1, role: 'admin' as const };
        // Deja el conteo guardado (499) como lo dejaría el uso normal.
        await recs.create(tenantId, actor, String(list.id), { data: {} });
        expect(await r.client.get(recordCountKey(tenantId))).toBe('499');
        const results = await Promise.allSettled(Array.from({ length: 6 }, () => recs.create(tenantId, actor, String(list.id), { data: {} })));
        expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
        const [n] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ n: sql<number>`count(*)::int` }).from(records).where(eq(records.tenantId, tenantId)),
        );
        expect(n!.n).toBe(500);
        // Borrar libera lugar aunque el conteo guardado diga que no hay.
        await withTenant(pg.db, tenantId, (tx) => tx.execute(sql`update records set deleted_at = now() where id = (select max(id) from records where tenant_id = ${tenantId})`));
        await expect(recs.create(tenantId, actor, String(list.id), { data: {} })).resolves.toBeTruthy();
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

    it('altas simultáneas a uno del tope: entra UNA, el resto rebota (sin pasarse del plan)', async () => {
        const list = await listsService.create(tenantId, { name: 'Tope' });
        const fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            new AutomationDispatcher(),
            new RelationsRepository(),
            undefined,
            undefined,
            billing,
        );
        // 499 de 500 (trial): queda lugar para UNO.
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(records).values(Array.from({ length: 499 }, () => ({ tenantId, listId: list.id, createdBy: 0, data: {} }))),
        );
        const results = await Promise.allSettled(
            Array.from({ length: 6 }, () => recs.create(tenantId, { userId: 1, role: 'admin' }, String(list.id), { data: {} })),
        );
        // Antes las 6 contaban 499 a la vez y entraban todas (505 > 500).
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ForbiddenException);
        const [n] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ n: sql<number>`count(*)::int` }).from(records).where(eq(records.tenantId, tenantId)),
        );
        expect(n!.n).toBe(500);
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
