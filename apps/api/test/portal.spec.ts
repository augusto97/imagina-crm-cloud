import { ForbiddenException, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { SessionService } from '../src/auth/session.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { PortalService } from '../src/portal/portal.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

describe('PortalService (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let sessions: SessionService;
    let portal: PortalService;
    let mailbox: CapturingMailTransport;
    let tenantId: number;
    let recordId: number;
    let fieldId: number;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url });
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            activity,
            new AutomationDispatcher(),
        );
        sessions = new SessionService(redis, env);
        mailbox = new CapturingMailTransport();
        // MailService sin onModuleInit → enqueue cae a sendNow → transporte captura.
        const mail = new MailService(env, mailbox);
        portal = new PortalService(pg.db, redis, env, tenantDb, listsService, sessions, mail);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [adminUser] = await pg.db
            .insert(users)
            .values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Admin' })
            .returning();
        admin.userId = adminUser!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values({ userId: admin.userId, tenantId, role: 'admin' }),
        );
        const list = await listsService.create(tenantId, {
            name: 'Clientes',
        });
        // Template de portal en settings.
        await listsService.update(tenantId, list.slug, {
            settings: { portal_template: [{ type: 'client_data' }] },
        });
        const f = await fieldsService.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        fieldId = f.id;
        const rec = await recordsService.create(tenantId, admin, 'clientes', { data: { [`f${f.id}`]: 'ACME Corp' } });
        recordId = rec.id;
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    it('issue → consume → me: el client accede a su record y template', async () => {
        const link = await portal.issue(tenantId, 'clientes', {
            record_id: recordId,
            email: 'cliente@acme.test',
        });
        expect(link.token).toBeTruthy();
        expect(link.path).toContain(link.token);

        // Email transaccional: el cliente recibe el enlace absoluto.
        expect(mailbox.sent.at(-1)).toMatchObject({ to: 'cliente@acme.test' });
        expect(mailbox.sent.at(-1)?.text).toContain(link.token);

        const { sessionToken } = await portal.consume(link.token);
        const session = await sessions.get(sessionToken);
        expect(session).not.toBeNull();

        const boot = await portal.me(session!.userId);
        expect(boot.list_name).toBe('Clientes');
        expect(boot.record.id).toBe(recordId);
        expect(boot.record.data[`f${fieldId}`]).toBe('ACME Corp');
        expect(boot.fields.map((f) => f.slug)).toContain('nombre');
        expect(boot.template).toEqual([{ type: 'client_data' }]);
    });

    it('el token es de un solo uso', async () => {
        const link = await portal.issue(tenantId, 'clientes', {
            record_id: recordId,
            email: 'otro@acme.test',
        });
        await portal.consume(link.token);
        await expect(portal.consume(link.token)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-emitir para el mismo email reusa el usuario y actualiza el vínculo', async () => {
        const a = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'cliente@acme.test' });
        const { sessionToken } = await portal.consume(a.token);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(session!.userId);
        expect(boot.record.id).toBe(recordId);
    });

    it('magic link sobre record inexistente → 404', async () => {
        await expect(
            portal.issue(tenantId, 'clientes', { record_id: 999999, email: 'x@acme.test' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    // SEC-01: emitir un magic link acuña una sesión para el usuario del email.
    // Si el email pertenece a un usuario del equipo (staff), quien lo canjea
    // obtendría la sesión de esa cuenta → apropiación. Debe rechazarse.
    it('rechaza emitir un magic link para el email de un usuario del equipo', async () => {
        await expect(
            portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'admin@acme.test' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });
});
