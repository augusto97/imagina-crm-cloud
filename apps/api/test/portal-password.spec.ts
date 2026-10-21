import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AuditService } from '../src/audit/audit.service';
import { SessionService } from '../src/auth/session.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { loadEnv } from '../src/config/env';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { RecordLayoutDataService } from '../src/dashboards/record-layout-data.service';
import { auditLog, memberships, portalCredentials, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DomainsService } from '../src/domains/domains.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { PortalAuthService } from '../src/portal/portal-auth.service';
import { PortalService } from '../src/portal/portal.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

/**
 * v0.1.290 — Entrar al portal con contraseña. La contraseña del portal es POR
 * EMPRESA y no es la de la cuenta: estos tests verifican justamente eso, más
 * el freno de fuerza bruta, la opción apagada y la limpieza al quitar acceso.
 */
describe('v0.1.290 — contraseña del portal (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let records: RecordsService;
    let sessions: SessionService;
    let portal: PortalService;
    let auth: PortalAuthService;
    const t: Record<'acme' | 'beta', { id: number; recordId: number; admin: Actor }> = {
        acme: { id: 0, recordId: 0, admin: { userId: 0, role: 'admin' } },
        beta: { id: 0, recordId: 0, admin: { userId: 0, role: 'admin' } },
    };
    const CLIENT = 'ana@cliente.test';
    let clientId = 0;
    const META = { ip: '198.51.100.7', userAgent: 'vitest' };

    const mailbox = new CapturingMailTransport();

    /**
     * Abre una sesión del portal con un enlace. La persona ya tenía cuenta
     * (trabaja en otra empresa), así que el enlace llega SÓLO a su correo
     * (SEC-24): se toma de ahí.
     */
    async function openWithLink(tenant: 'acme' | 'beta'): Promise<string> {
        await portal.issue(t[tenant].id, 'clientes', { record_id: t[tenant].recordId, email: CLIENT });
        await portal.whenIdle();
        const token = /token=([A-Za-z0-9_-]+)/.exec(mailbox.sent.at(-1)?.text ?? '')?.[1];
        expect(token).toBeTruthy();
        return (await portal.consume(token!)).sessionToken;
    }

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, PLATFORM_SUPERADMINS: 'root@plataforma.test' });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        records = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, new AutomationDispatcher(), new RelationsRepository());
        sessions = new SessionService(redis, env);
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-ppw-'))), env);
        const domains = new DomainsService(pg.db, env, files);
        domains.probeServing = () => Promise.resolve(false);
        portal = new PortalService(
            pg.db,
            redis,
            env,
            tenantDb,
            lists,
            sessions,
            new MailService(env, mailbox),
            fieldsSvc,
            new CommentsRepository(),
            new ActivityRepository(),
            activity,
            rt,
            new AutomationDispatcher(),
            files,
            domains,
            new RecordLayoutDataService(
                tenantDb,
                lists,
                fieldsSvc,
                records,
                new DashboardsService(tenantDb, new AggregateService(tenantDb, lists, fieldsSvc), records, fieldsSvc),
            ),
        );
        auth = new PortalAuthService(pg.db, redis, env, tenantDb, sessions, domains, portal, new AuditService(tenantDb));

        for (const slug of ['acme', 'beta'] as const) {
            const [row] = await pg.db.insert(tenants).values({ slug, name: slug.toUpperCase() }).returning();
            t[slug].id = row!.id;
            const [a] = await pg.db.insert(users).values({ email: `admin@${slug}.test`, passwordHash: 'x', name: 'Admin' }).returning();
            t[slug].admin = { userId: a!.id, role: 'admin' };
            await withTenant(pg.db, row!.id, (tx) => tx.insert(memberships).values({ userId: a!.id, tenantId: row!.id, role: 'admin' }));
            await lists.create(row!.id, { name: 'Clientes' });
            const f = await fieldsSvc.create(row!.id, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
            const rec = await records.create(row!.id, t[slug].admin, 'clientes', { data: { [`f${f.id}`]: `Ana en ${slug}` } });
            t[slug].recordId = rec.id;
        }
        // La misma persona además trabaja (con su cuenta y su contraseña) en
        // una tercera empresa: esa contraseña jamás abre un portal.
        const [gamma] = await pg.db.insert(tenants).values({ slug: 'gamma', name: 'Gamma' }).returning();
        const [u] = await pg.db
            .insert(users)
            .values({ email: CLIENT, passwordHash: await argon2.hash('Cuenta-de-trabajo-1'), name: 'Ana' })
            .returning();
        clientId = u!.id;
        await withTenant(pg.db, gamma!.id, (tx) => tx.insert(memberships).values({ userId: clientId, tenantId: gamma!.id, role: 'agent' }));
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    beforeEach(async () => {
        await redis.flushall();
    });

    it('sin la opción encendida no se entra ni se crea contraseña', async () => {
        const session = await openWithLink('acme');
        const actor = { userId: clientId, tenantId: t.acme.id };
        await expect(auth.setPassword(actor, session, 'Portal-acme-1')).rejects.toMatchObject({ response: { code: 'portal_password_disabled' } });
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'acme' }, META)).rejects.toMatchObject({
            response: { code: 'portal_password_disabled' },
        });
        expect((await auth.loginOptions(undefined, 'acme')).password).toBe(false);
        expect((await auth.loginOptions(undefined, 'acme')).tenant?.slug).toBe('acme');
        // Sin empresa (dominio de la plataforma y sin enlace de entrada): neutro, sólo enlace.
        expect(await auth.loginOptions(undefined, null)).toEqual({ tenant: null, password: false });
        expect(await auth.loginOptions(undefined, 'no-existe')).toEqual({ tenant: null, password: false });
    });

    it('la contraseña es POR EMPRESA e independiente de la de la cuenta de trabajo', async () => {
        await auth.update(t.acme.id, t.acme.admin.userId, { password_enabled: true });
        await auth.update(t.beta.id, t.beta.admin.userId, { password_enabled: true });
        const settings = await auth.settings(t.acme.id);
        expect(settings).toMatchObject({ password_enabled: true });
        expect(settings.entry_url).toContain('/portal?empresa=acme');
        const logged = await pg.db.select().from(auditLog).where(eq(auditLog.tenantId, t.acme.id));
        expect(logged.map((r) => r.action)).toContain('workspace.portal_password_on');

        const teamHashBefore = (await pg.db.select({ h: users.passwordHash }).from(users).where(eq(users.id, clientId)))[0]!.h;

        // Crea la de ACME desde su sesión del portal.
        const sA = await openWithLink('acme');
        await auth.setPassword({ userId: clientId, tenantId: t.acme.id }, sA, 'Portal-acme-1');
        // La de la cuenta de trabajo no cambió.
        expect((await pg.db.select({ h: users.passwordHash }).from(users).where(eq(users.id, clientId)))[0]!.h).toBe(teamHashBefore);

        // Entra a ACME con su contraseña del portal → sesión del portal atada a ACME.
        const { sessionToken } = await auth.login({ email: CLIENT.toUpperCase(), password: 'Portal-acme-1', empresa: 'acme' }, META);
        const s = await sessions.get(sessionToken);
        expect(s).toMatchObject({ userId: clientId, portalTenantId: t.acme.id });
        // Con la contraseña de UNA empresa no se ven las cuentas de otras.
        expect(s?.portalAccount).not.toBe(true);
        // ...y el portal le muestra su registro de ACME.
        expect((await portal.me({ userId: clientId, tenantId: t.acme.id })).record.id).toBe(t.acme.recordId);

        // En BETA todavía no creó ninguna: la de ACME no sirve.
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'beta' }, META)).rejects.toMatchObject({
            response: { code: 'invalid_credentials' },
        });
        // La de la cuenta de trabajo tampoco abre ningún portal.
        await expect(auth.login({ email: CLIENT, password: 'Cuenta-de-trabajo-1', empresa: 'acme' }, META)).rejects.toMatchObject({
            response: { code: 'invalid_credentials' },
        });

        const sB = await openWithLink('beta');
        await auth.setPassword({ userId: clientId, tenantId: t.beta.id }, sB, 'Portal-beta-2');
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'beta' }, META)).rejects.toMatchObject({
            response: { code: 'invalid_credentials' },
        });
        const okB = await auth.login({ email: CLIENT, password: 'Portal-beta-2', empresa: 'beta' }, META);
        expect((await sessions.get(okB.sessionToken))?.portalTenantId).toBe(t.beta.id);

        // RLS: desde BETA no se ve la credencial de ACME.
        const fromBeta = await withTenant(pg.db, t.beta.id, (tx) => tx.select().from(portalCredentials));
        expect(fromBeta.map((c) => c.tenantId)).toEqual([t.beta.id]);
        // Lo guardado es un hash argon2, nunca la contraseña.
        expect(fromBeta[0]!.passwordHash.startsWith('$argon2')).toBe(true);
    });

    it('correo desconocido y contraseña equivocada responden IGUAL', async () => {
        const outcome = (input: { email: string; password: string; empresa: string }): Promise<[number, unknown]> =>
            auth.login(input, META).then(
                (): [number, unknown] => [200, null],
                (e: { getStatus(): number; getResponse(): unknown }): [number, unknown] => [e.getStatus(), e.getResponse()],
            );
        const unknown = await outcome({ email: 'nadie@x.test', password: 'Lo-que-sea-1', empresa: 'acme' });
        const wrong = await outcome({ email: CLIENT, password: 'Lo-que-sea-1', empresa: 'acme' });
        expect(unknown).toEqual(wrong);
        expect(unknown[0]).toBe(401);
        // Sin empresa no se puede entrar con contraseña (sólo con enlace).
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1' }, META)).rejects.toMatchObject({ response: { code: 'portal_company_required' } });
    });

    it('freno de fuerza bruta por cuenta y empresa (la otra empresa no se traba)', async () => {
        for (let i = 0; i < 10; i++) {
            await expect(auth.login({ email: CLIENT, password: `mal-${i}-xxxx`, empresa: 'acme' }, { ...META, ip: `10.0.0.${i}` })).rejects.toMatchObject({
                response: { code: 'invalid_credentials' },
            });
        }
        // Ni la contraseña correcta entra mientras dura el freno.
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'acme' }, { ...META, ip: '10.0.1.1' })).rejects.toMatchObject({
            response: { code: 'too_many_attempts' },
        });
        // En BETA sí (otra contraseña, otro contador).
        await expect(auth.login({ email: CLIENT, password: 'Portal-beta-2', empresa: 'beta' }, { ...META, ip: '10.0.1.2' })).resolves.toHaveProperty('sessionToken');
    });

    it('freno por IP aunque se prueben correos distintos', async () => {
        for (let i = 0; i < 40; i++) {
            await auth.login({ email: `x${i}@x.test`, password: 'Lo-que-sea-1', empresa: 'acme' }, { ...META, ip: '192.0.2.9' }).catch(() => undefined);
        }
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'acme' }, { ...META, ip: '192.0.2.9' })).rejects.toMatchObject({
            response: { code: 'too_many_attempts' },
        });
    });

    it('cambiarla cierra las demás sesiones del portal de ESA empresa', async () => {
        const one = (await auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'acme' }, META)).sessionToken;
        const two = (await auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'acme' }, META)).sessionToken;
        const beta = (await auth.login({ email: CLIENT, password: 'Portal-beta-2', empresa: 'beta' }, META)).sessionToken;
        await auth.setPassword({ userId: clientId, tenantId: t.acme.id }, one, 'Portal-acme-nueva');
        expect(await sessions.get(one)).not.toBeNull();
        expect(await sessions.get(two)).toBeNull();
        expect(await sessions.get(beta)).not.toBeNull();
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-1', empresa: 'acme' }, META)).rejects.toMatchObject({ response: { code: 'invalid_credentials' } });
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-nueva', empresa: 'acme' }, META)).resolves.toHaveProperty('sessionToken');
    });

    it('apagar la opción frena el login; cuenta desactivada se dice sólo con la contraseña correcta', async () => {
        await auth.update(t.beta.id, t.beta.admin.userId, { password_enabled: false });
        await expect(auth.login({ email: CLIENT, password: 'Portal-beta-2', empresa: 'beta' }, META)).rejects.toMatchObject({
            response: { code: 'portal_password_disabled' },
        });
        await auth.update(t.beta.id, t.beta.admin.userId, { password_enabled: true });

        await pg.db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, clientId));
        await expect(auth.login({ email: CLIENT, password: 'Portal-beta-2', empresa: 'beta' }, META)).rejects.toMatchObject({
            response: { code: 'account_disabled' },
        });
        await expect(auth.login({ email: CLIENT, password: 'mala-pass-1', empresa: 'beta' }, META)).rejects.toMatchObject({
            response: { code: 'invalid_credentials' },
        });
        await pg.db.update(users).set({ disabledAt: null }).where(eq(users.id, clientId));
    });

    it('quitar el acceso borra la contraseña de esa empresa (y la otra sigue)', async () => {
        await portal.revokeAccess(t.beta.id, 'clientes', clientId, t.beta.recordId);
        const left = await withTenant(pg.db, t.beta.id, (tx) => tx.select().from(portalCredentials));
        expect(left).toHaveLength(0);
        await expect(auth.login({ email: CLIENT, password: 'Portal-beta-2', empresa: 'beta' }, META)).rejects.toMatchObject({
            response: { code: 'invalid_credentials' },
        });
        await expect(auth.login({ email: CLIENT, password: 'Portal-acme-nueva', empresa: 'acme' }, META)).resolves.toHaveProperty('sessionToken');
    });

    it('un superadmin jamás entra a un portal, aunque haya una credencial', async () => {
        const [root] = await pg.db.insert(users).values({ email: 'root@plataforma.test', passwordHash: 'x', name: 'Root' }).returning();
        const hash = await argon2.hash('Root-portal-1');
        await withTenant(pg.db, t.acme.id, (tx) => tx.insert(portalCredentials).values({ tenantId: t.acme.id, userId: root!.id, passwordHash: hash }));
        await expect(auth.login({ email: 'root@plataforma.test', password: 'Root-portal-1', empresa: 'acme' }, META)).rejects.toMatchObject({
            response: { code: 'invalid_credentials' },
        });
    });
});
