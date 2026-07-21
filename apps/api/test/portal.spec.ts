import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { RelationsRepository } from '../src/records/relations.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommentsRepository } from '../src/comments/comments.repository';
import { LocalFileStorage } from '../src/files/file-storage';
import { DomainsService } from '../src/domains/domains.service';
import { FilesService } from '../src/files/files.service';
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
            new RelationsRepository(),
        );
        sessions = new SessionService(redis, env);
        mailbox = new CapturingMailTransport();
        // MailService sin onModuleInit → enqueue cae a sendNow → transporte captura.
        const mail = new MailService(env, mailbox);
        const activityService = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        portal = new PortalService(
            pg.db,
            redis,
            env,
            tenantDb,
            listsService,
            sessions,
            mail,
            fieldsService,
            new CommentsRepository(),
            new ActivityRepository(),
            activityService,
            rt,
            new AutomationDispatcher(),
            new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-pf-'))), env),
            new DomainsService(pg.db, env, new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-pd-'))), env)),
        );

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

    it('me: extrae los bloques del shape `{ blocks: [...] }` que guarda el editor visual', async () => {
        // El editor drag&drop persiste el template como objeto, no como array plano.
        await listsService.update(tenantId, 'clientes', {
            settings: { portal_template: { blocks: [{ type: 'hero' }, { type: 'faq' }] } },
        });
        const link = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'c2@acme.test' });
        const { sessionToken } = await portal.consume(link.token);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(session!.userId);
        expect(boot.template).toEqual([{ type: 'hero' }, { type: 'faq' }]);
    });

    it('me: los bloques image con archivo subido reciben URL FIRMADA (incluye nested_section)', async () => {
        // v0.1.93 — el rol client no puede usar la descarga con sesión de
        // miembro: portal.me inyecta config.url firmada. La URL externa y
        // el estilo del bloque pasan intactos; los settings no se mutan.
        await listsService.update(tenantId, 'clientes', {
            settings: {
                portal_template: {
                    blocks: [
                        { type: 'image', config: { image_file_id: 77, alt: 'Logo', style: { bg: '#ffffff' } } },
                        { type: 'image', config: { url: 'https://cdn.acme.test/banner.png' } },
                        {
                            type: 'nested_section',
                            config: {
                                columns: [
                                    { id: 'c1', width: 6, blocks: [{ type: 'image', config: { image_file_id: 88 } }] },
                                ],
                            },
                        },
                    ],
                },
            },
        });
        const link = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'img@acme.test' });
        const { sessionToken } = await portal.consume(link.token);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(session!.userId);

        type RawBlock = { config: Record<string, unknown> };
        const [uploaded, external, nested] = boot.template as unknown as RawBlock[];
        expect(String(uploaded!.config.url)).toContain('/files/77/signed?');
        expect(String(uploaded!.config.url)).toContain(`tenant=${tenantId}`);
        expect(uploaded!.config.style).toEqual({ bg: '#ffffff' });
        expect(external!.config.url).toBe('https://cdn.acme.test/banner.png');
        const columns = nested!.config.columns as Array<{ blocks: RawBlock[] }>;
        const sub = columns[0]!.blocks[0]!;
        expect(String(sub.config.url)).toContain('/files/88/signed?');
    });

    it('me: galería firmada + ajustes de página del portal (template_page)', async () => {
        // v0.1.94 — cada imagen subida de la galería se firma; los ajustes
        // de página (fondo/ancho/tipografía) viajan en template_page.
        await listsService.update(tenantId, 'clientes', {
            settings: {
                portal_template: {
                    blocks: [
                        {
                            type: 'gallery',
                            config: {
                                images: [
                                    { image_file_id: 91 },
                                    { url: 'https://cdn.acme.test/foto.jpg' },
                                ],
                                columns: 3,
                            },
                        },
                    ],
                    page: { bg: '#f1f5f9', max_width: 1100, font: 'serif' },
                },
            },
        });
        const link = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'gal@acme.test' });
        const { sessionToken } = await portal.consume(link.token);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(session!.userId);

        type RawBlock = { config: Record<string, unknown> };
        const [gallery] = boot.template as unknown as RawBlock[];
        const images = gallery!.config.images as Array<Record<string, unknown>>;
        expect(String(images[0]!.url)).toContain('/files/91/signed?');
        expect(images[1]!.url).toBe('https://cdn.acme.test/foto.jpg');
        expect(boot.template_page).toEqual({ bg: '#f1f5f9', max_width: 1100, font: 'serif' });
    });

    // --- Endpoints de bloques del portal (scope + whitelist) ----------------

    /** Sesión de cliente lista para usar (issue + consume). */
    async function clientSession(email: string, recId: number = recordId): Promise<number> {
        const link = await portal.issue(tenantId, 'clientes', { record_id: recId, email });
        const { sessionToken } = await portal.consume(link.token);
        const session = await sessions.get(sessionToken);
        return session!.userId;
    }

    it('comments: el cliente lista y crea notas de SU record', async () => {
        const uid = await clientSession('coment@acme.test');
        expect(await portal.myComments(uid)).toHaveLength(0);
        const created = await portal.createMyComment(uid, { content: 'Hola, ¿novedades?' });
        expect(created).toMatchObject({ record_id: recordId, user_id: uid, kind: 'note' });
        expect((created as { content?: string }).content).toBe('Hola, ¿novedades?');
        const items = await portal.myComments(uid);
        expect(items).toHaveLength(1);
    });

    it('activity: timeline del record del cliente', async () => {
        const uid = await clientSession('act@acme.test');
        const items = await portal.myActivity(uid, 50);
        // Al menos el record_created del seed.
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((a) => a.record_id === recordId)).toBe(true);
    });

    it('updateMe: whitelist del template — sin editable_form nadie edita; slug fuera → 403', async () => {
        const uid = await clientSession('edit@acme.test');
        // El template actual no tiene editable_form → 403.
        await expect(portal.updateMe(uid, { fields: { nombre: 'Hackeado' } })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        // Habilitamos edición SOLO de `nombre`.
        await listsService.update(tenantId, 'clientes', {
            settings: {
                portal_template: {
                    blocks: [{ type: 'editable_form', config: { editable_field_slugs: ['nombre'] } }],
                },
            },
        });
        await portal.updateMe(uid, { fields: { nombre: 'ACME Renovada' } });
        const boot = await portal.me(uid);
        expect(boot.record.data[`f${fieldId}`]).toBe('ACME Renovada');
        // Slug fuera de la whitelist → 403 explícito.
        const extra = await fieldsService.create(tenantId, 'clientes', { label: 'Interno', type: 'text', slug: 'interno' });
        void extra;
        await expect(portal.updateMe(uid, { fields: { interno: 'x' } })).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        // Valor inválido → 400.
        const num = await fieldsService.create(tenantId, 'clientes', { label: 'Cupo', type: 'number', slug: 'cupo' });
        void num;
        await listsService.update(tenantId, 'clientes', {
            settings: {
                portal_template: {
                    blocks: [{ type: 'editable_form', config: { editable_field_slugs: ['cupo'] } }],
                },
            },
        });
        await expect(portal.updateMe(uid, { fields: { cupo: 'no-numero' } })).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    it('listRecords + aggregates: scope por relation hacia el record del cliente (fail-closed)', async () => {
        const uid = await clientSession('scope@acme.test');

        // Lista "pedidos" con relación → clientes y un monto.
        await listsService.create(tenantId, { name: 'Pedidos' });
        const monto = await fieldsService.create(tenantId, 'pedidos', { label: 'Monto', type: 'number', slug: 'monto' });
        const cliRel = await fieldsService.create(tenantId, 'pedidos', {
            label: 'Cliente', type: 'relation', slug: 'cliente',
            config: { target_list_id: (await listsService.get(tenantId, 'clientes')).id },
        });

        // Otro record cliente (ajeno) para verificar el aislamiento.
        const otro = await recordsService.create(tenantId, admin, 'clientes', { data: { [`f${fieldId}`]: 'Otra Corp' } });

        // 2 pedidos del cliente, 1 del ajeno.
        await recordsService.create(tenantId, admin, 'pedidos', { data: { [`f${monto.id}`]: 100, [`f${cliRel.id}`]: [recordId] } });
        await recordsService.create(tenantId, admin, 'pedidos', { data: { [`f${monto.id}`]: 250, [`f${cliRel.id}`]: [recordId] } });
        await recordsService.create(tenantId, admin, 'pedidos', { data: { [`f${monto.id}`]: 999, [`f${cliRel.id}`]: [otro.id] } });

        const page = await portal.listRecords(uid, 'pedidos', 1, 10);
        expect(page.meta.total).toBe(2);
        expect(page.data.map((r) => r.fields.monto).sort()).toEqual([100, 250]);

        const agg = await portal.aggregates(uid, 'pedidos', String(monto.id));
        expect(agg.totals.monto).toMatchObject({ count: 2, sum: 350 });

        // Lista sin vínculo con el cliente → fail-closed (vacío), nunca todo.
        await listsService.create(tenantId, { name: 'Secretos' });
        const sf = await fieldsService.create(tenantId, 'secretos', { label: 'Dato', type: 'text', slug: 'dato' });
        await recordsService.create(tenantId, admin, 'secretos', { data: { [`f${sf.id}`]: 'confidencial' } });
        const closed = await portal.listRecords(uid, 'secretos', 1, 10);
        expect(closed.meta.total).toBe(0);
        expect(closed.data).toHaveLength(0);
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
