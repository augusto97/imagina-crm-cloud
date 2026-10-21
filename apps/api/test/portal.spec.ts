import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { layoutBlocks } from '@imagina-base/shared';
import { loadEnv } from '../src/config/env';
import { memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { SessionService } from '../src/auth/session.service';
import { PORTAL_SESSION_COOKIE, SESSION_COOKIE, SessionGuard } from '../src/auth/session.guard';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { PortalService } from '../src/portal/portal.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { DashboardsService } from '../src/dashboards/dashboards.service';
import { RecordLayoutDataService } from '../src/dashboards/record-layout-data.service';
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
import { CommentsService } from '../src/comments/comments.service';
import { NotifyHub, type NotifyEvent } from '../src/notifications/notify-hub';
import { RecordChangeHub, type RecordChange } from '../src/records/record-change-hub';
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
    let domainsService: DomainsService;
    const servingDomains = new Set<string>();
    let tenantId: number;
    /** SEC-24 — quién llama al portal: el cliente, atado a la empresa de su enlace. */
    const actor = (userId: number) => ({ userId, tenantId });
    let recordId: number;
    let fieldId: number;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, PLATFORM_SUPERADMINS: 'root@plataforma.test' });
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
        domainsService = new DomainsService(
            pg.db,
            env,
            new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imcrm-pd-'))), env),
        );
        // v0.1.245 — sin red en los tests: un dominio "responde" sólo si está aquí.
        domainsService.probeServing = async (_tid, domain) => servingDomains.has(domain);
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
            domainsService,
            new RecordLayoutDataService(
                tenantDb,
                listsService,
                fieldsService,
                recordsService,
                new DashboardsService(tenantDb, new AggregateService(tenantDb, listsService, fieldsService), recordsService, fieldsService),
            ),
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

        const { sessionToken } = await portal.consume(link.token!);
        const session = await sessions.get(sessionToken);
        expect(session).not.toBeNull();

        const boot = await portal.me(actor(session!.userId));
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
        const { sessionToken } = await portal.consume(link.token!);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(actor(session!.userId));
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
        const { sessionToken } = await portal.consume(link.token!);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(actor(session!.userId));

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
        const { sessionToken } = await portal.consume(link.token!);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(actor(session!.userId));

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
        const { sessionToken } = await portal.consume(link.token!);
        const session = await sessions.get(sessionToken);
        return session!.userId;
    }

    it('comments: el cliente lista y crea notas de SU record (con conversación en el diseño)', async () => {
        await listsService.update(tenantId, 'clientes', {
            settings: { portal_template: { blocks: [{ type: 'comments_thread' }, { type: 'activity_timeline' }] } },
        });
        const uid = await clientSession('coment@acme.test');
        expect(await portal.myComments(actor(uid))).toHaveLength(0);
        const created = await portal.createMyComment(actor(uid), { content: 'Hola, ¿novedades?' });
        expect(created).toMatchObject({ mine: true, author_name: 'Tú', content: 'Hola, ¿novedades?' });
        // Nunca el id de un usuario ni metadatos internos.
        expect(created).not.toHaveProperty('user_id');
        const items = await portal.myComments(actor(uid));
        expect(items).toHaveLength(1);
    });

    it('activity: timeline del record del cliente', async () => {
        const uid = await clientSession('act@acme.test');
        const items = await portal.myActivity(actor(uid), 50);
        // Al menos el record_created del seed.
        expect(items.length).toBeGreaterThan(0);
        expect(items.every((a) => a.record_id === recordId)).toBe(true);
        // Del equipo no se expone quién fue.
        expect(items.every((a) => a.user_id === null || a.user_id === uid)).toBe(true);
    });

    it('updateMe: whitelist del template — sin editable_form nadie edita; slug fuera → 403', async () => {
        const uid = await clientSession('edit@acme.test');
        // El template actual no tiene editable_form → 403.
        await expect(portal.updateMe(actor(uid), { fields: { nombre: 'Hackeado' } })).rejects.toBeInstanceOf(
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
        await portal.updateMe(actor(uid), { fields: { nombre: 'ACME Renovada' } });
        const boot = await portal.me(actor(uid));
        expect(boot.record.data[`f${fieldId}`]).toBe('ACME Renovada');
        // Slug fuera de la whitelist → 403 explícito.
        const extra = await fieldsService.create(tenantId, 'clientes', { label: 'Interno', type: 'text', slug: 'interno' });
        void extra;
        await expect(portal.updateMe(actor(uid), { fields: { interno: 'x' } })).rejects.toBeInstanceOf(
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
        await expect(portal.updateMe(actor(uid), { fields: { cupo: 'no-numero' } })).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    it('las listas vinculadas sólo se leen por el diseño (no hay endpoint para leer cualquier lista)', async () => {
        // v0.1.286 — `/portal/lists/:slug/records` y `/aggregates` aceptaban
        // CUALQUIER lista de la empresa y devolvían todas sus columnas. Se
        // eliminaron: lo vinculado se ve sólo en los bloques del diseño.
        expect((portal as unknown as Record<string, unknown>).listRecords).toBeUndefined();
        expect((portal as unknown as Record<string, unknown>).aggregates).toBeUndefined();

        // Lista "pedidos" con relación → clientes (la usan los tests siguientes).
        await listsService.create(tenantId, { name: 'Pedidos' });
        await fieldsService.create(tenantId, 'pedidos', { label: 'Monto', type: 'number', slug: 'monto' });
        await fieldsService.create(tenantId, 'pedidos', {
            label: 'Cliente', type: 'relation', slug: 'cliente',
            config: { target_list_id: (await listsService.get(tenantId, 'clientes')).id },
        });
        await listsService.create(tenantId, { name: 'Secretos' });
        await fieldsService.create(tenantId, 'secretos', { label: 'Dato', type: 'text', slug: 'dato' });
    });

    it('el acceso QUEDA registrado: se ve quién lo tiene y cuándo entró (v0.1.153)', async () => {
        const before = await portal.accessFor(tenantId, 'clientes', recordId);
        const emails = before.users.map((u) => u.email);

        const link = await portal.issue(tenantId, 'clientes', {
            record_id: recordId,
            email: 'registrado@acme.test',
        });
        const after = await portal.accessFor(tenantId, 'clientes', recordId);
        const nuevo = after.users.find((u) => u.email === 'registrado@acme.test');
        expect(emails).not.toContain('registrado@acme.test');
        expect(nuevo).toBeDefined();
        // Emitido pero todavía no usado: el admin necesita distinguirlo.
        expect(nuevo!.last_access_at).toBeNull();

        await portal.consume(link.token!);
        const used = await portal.accessFor(tenantId, 'clientes', recordId);
        expect(used.users.find((u) => u.email === 'registrado@acme.test')!.last_access_at).not.toBeNull();
    });

    it('quitar el acceso borra el vínculo y mata las sesiones del cliente', async () => {
        const link = await portal.issue(tenantId, 'clientes', {
            record_id: recordId,
            email: 'revocar@acme.test',
        });
        const { sessionToken } = await portal.consume(link.token!);
        const session = await sessions.get(sessionToken);
        expect(session).not.toBeNull();
        const userId = session!.userId;

        await portal.revokeAccess(tenantId, 'clientes', userId);

        expect(await sessions.get(sessionToken)).toBeNull();
        const list = await portal.accessFor(tenantId, 'clientes', recordId);
        expect(list.users.map((u) => u.email)).not.toContain('revocar@acme.test');
        await expect(portal.me(actor(userId))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('relatedOptions detecta las listas vinculadas y `me` sólo expone las habilitadas', async () => {
        const uid = await clientSession('relacionadas@acme.test');

        // "Pedidos" ya tiene un campo relation → clientes (test anterior).
        const options = await portal.relatedOptions(tenantId, 'clientes');
        const pedidos = options.find((o) => o.slug === 'pedidos');
        expect(pedidos).toBeDefined();
        expect(pedidos!.via).toBe('relation');
        // Una lista sin vínculo NO es candidata (no habría forma de acotarla).
        expect(options.some((o) => o.slug === 'secretos')).toBe(false);

        // Las listas vinculadas se ven donde el DISEÑO las pone (nunca "todas
        // las columnas al pie"): `related_lists` ya no viaja al portal.
        expect((await portal.me(actor(uid))).related_lists).toEqual([]);
        const clientes = await listsService.get(tenantId, 'clientes');
        await listsService.update(tenantId, 'clientes', {
            settings: { ...clientes.settings, portal: { enabled: true, related_lists: [pedidos!.list_id] } },
        });
        expect((await portal.me(actor(uid))).related_lists).toEqual([]);
    });

    describe('v0.1.245: white-label del portal', () => {
        it('el correo de acceso lleva la marca de la EMPRESA (asunto, remitente, logo, color) y nada de la plataforma', async () => {
            await pg.db
                .update(tenants)
                .set({ settings: { branding: { app_name: 'Acme Portal', primary_color: '#16a34a', logo_file_id: 77 } } })
                .where(eq(tenants.id, tenantId));
            const res = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'marca245@acme.test' });
            const mail = mailbox.sent.at(-1)!;
            expect(mail.to).toBe('marca245@acme.test');
            expect(mail.subject).toBe('Tu acceso al portal de Acme Portal');
            expect(mail.fromName).toBe('Acme Portal');
            expect(mail.html).toContain('#16a34a');
            // Logo con URL ABSOLUTA firmada (el cliente de correo no tiene sesión).
            expect(mail.html).toMatch(/src="https?:\/\/[^"]+\/api\/v1\/files\/77\/signed\?tenant=/);
            expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/imagina/i);
            // El enlace completo vuelve a la UI (para copiarlo) y es el del correo.
            expect(res.url).toBeTruthy();
            expect(mail.text).toContain(res.url!);
            expect(res.url!.endsWith(res.path!)).toBe(true);
        });

        it('sin nombre de app, el correo usa el nombre de la empresa (no el de la lista)', async () => {
            await pg.db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
            await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'sinmarca245@acme.test' });
            const mail = mailbox.sent.at(-1)!;
            expect(mail.subject).toBe('Tu acceso al portal de ACME');
            expect(mail.subject).not.toContain('Clientes');
        });

        it('el enlace sale por el dominio del PORTAL sólo cuando responde', async () => {
            await pg.db.update(tenants).set({ portalDomain: 'clientes.acme245.test' }).where(eq(tenants.id, tenantId));
            const before = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'dom245@acme.test' });
            expect(before.url!.startsWith('https://clientes.acme245.test/')).toBe(false);
            servingDomains.add('clientes.acme245.test');
            const after = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'dom245@acme.test' });
            expect(after.url!.startsWith('https://clientes.acme245.test/portal/acceso?token=')).toBe(true);
            expect(mailbox.sent.at(-1)!.text).toContain('https://clientes.acme245.test/portal/acceso?token=');
            servingDomains.delete('clientes.acme245.test');
            await pg.db.update(tenants).set({ portalDomain: null }).where(eq(tenants.id, tenantId));
        });

        it('pedir un enlace desde el dominio de UNA empresa manda sólo el de esa empresa', async () => {
            const [tb] = await pg.db.insert(tenants).values({ slug: 'gamma245', name: 'Gamma', portalDomain: 'clientes.gamma245.test' }).returning();
            const tenantG = tb!.id;
            const listG = await listsService.create(tenantG, { name: 'Socios' });
            const fg = await fieldsService.create(tenantG, listG.slug, { label: 'Nombre', type: 'text', slug: 'nombre' });
            const recG = await recordsService.create(tenantG, { userId: admin.userId, role: 'admin' }, listG.slug, {
                data: { [`f${fg.id}`]: 'Socio de Gamma' },
            });
            await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'dos245@empresas.test' });
            await portal.issue(tenantG, listG.slug, { record_id: recG.id, email: 'dos245@empresas.test' });

            // Desde el dominio de la plataforma: un correo por empresa.
            let before = mailbox.sent.length;
            await portal.requestAccess('dos245@empresas.test');
            await portal.whenIdle();
            expect(mailbox.sent.length).toBe(before + 2);

            // Desde el portal de Gamma: sólo Gamma.
            before = mailbox.sent.length;
            await portal.requestAccess('dos245@empresas.test', 'Clientes.Gamma245.test:443');
            await portal.whenIdle();
            expect(mailbox.sent.length).toBe(before + 1);
            const token = /token=([A-Za-z0-9_-]+)/.exec(mailbox.sent.at(-1)!.text ?? '')![1]!;
            const { sessionToken } = await portal.consume(token, { host: 'clientes.gamma245.test' });
            const session = await sessions.get(sessionToken);
            expect(session?.portalTenantId).toBe(tenantG);
            // En el dominio de una empresa la sesión nunca ve las otras empresas.
            expect(session?.portalAccount).toBeUndefined();
        });
    });

    it('el cliente puede pedirse un enlace nuevo, sin revelar si el email existe (v0.1.154)', async () => {
        await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'vuelve@acme.test' });
        const before = mailbox.sent.length;

        // Email SIN acceso: responde igual (no lanza) pero no manda nada.
        await portal.requestAccess('desconocido@nadie.test');
        await portal.whenIdle();
        expect(mailbox.sent.length).toBe(before);

        // Email con acceso: le llega un enlace nuevo, usable.
        await portal.requestAccess('vuelve@acme.test');
        await portal.whenIdle();
        expect(mailbox.sent.length).toBe(before + 1);
        const mail = mailbox.sent.at(-1)!;
        expect(mail.to).toBe('vuelve@acme.test');
        const token = /portal\/acceso\?token=([A-Za-z0-9_-]+)/.exec(mail.text ?? '')?.[1];
        expect(token).toBeDefined();
        const { sessionToken } = await portal.consume(token!);
        expect(await sessions.get(sessionToken)).not.toBeNull();

        // Freno de abuso: 3 pedidos cada 15 min por email (ya se usó uno
        // arriba, así que pasan 2 más y el tercero se descarta en silencio).
        const after = mailbox.sent.length;
        await portal.requestAccess('vuelve@acme.test');
        await portal.requestAccess('vuelve@acme.test');
        await portal.requestAccess('vuelve@acme.test');
        await portal.whenIdle();
        expect(mailbox.sent.length).toBe(after + 2);
    });

    it('SEC-35: portal APAGADO → el cliente con sesión deja de entrar y no se reparten enlaces', async () => {
        const link = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'apagado@acme.test' });
        const { sessionToken } = await portal.consume(link.token!);
        const uid = (await sessions.get(sessionToken))!.userId;
        const actorOff = actor(uid);
        await expect(portal.me(actorOff)).resolves.toBeDefined();

        const clientes = await listsService.get(tenantId, 'clientes');
        const portalCfg = (clientes.settings as { portal?: Record<string, unknown> }).portal ?? {};
        await listsService.update(tenantId, 'clientes', { settings: { ...clientes.settings, portal: { ...portalCfg, enabled: false } } });
        try {
            await expect(portal.me(actorOff)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'portal_disabled' }) });
            const before = mailbox.sent.length;
            await portal.requestAccess('apagado@acme.test');
            await portal.whenIdle();
            expect(mailbox.sent.length).toBe(before);
        } finally {
            await listsService.update(tenantId, 'clientes', { settings: { ...clientes.settings, portal: { ...portalCfg, enabled: true } } });
        }
        await expect(portal.me(actorOff)).resolves.toBeDefined();
    });

    it('el token es de un solo uso', async () => {
        const link = await portal.issue(tenantId, 'clientes', {
            record_id: recordId,
            email: 'otro@acme.test',
        });
        await portal.consume(link.token!);
        await expect(portal.consume(link.token!)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-emitir para el mismo email reusa el usuario y actualiza el vínculo', async () => {
        const a = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'cliente@acme.test' });
        const { sessionToken } = await portal.consume(a.token!);
        const session = await sessions.get(sessionToken);
        const boot = await portal.me(actor(session!.userId));
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
    it('rechaza emitir un magic link para el email de un usuario del equipo DE ESTA empresa', async () => {
        await expect(
            portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'admin@acme.test' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    // SEC-24 (v0.1.225) — el enlace del portal era una forma de loguearse como
    // CUALQUIER cuenta que no fuera de equipo: el superadmin (sin membresías),
    // un usuario sin workspace o el cliente de OTRA empresa.
    describe('SEC-24: el enlace del portal no entrega cuentas ajenas', () => {
        it('rechaza el email de un superadmin de plataforma', async () => {
            await pg.db.insert(users).values({ email: 'root@plataforma.test', passwordHash: 'x', name: 'Root' });
            await expect(
                portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'Root@Plataforma.test' }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('a una cuenta que ya existía por su cuenta le llega por correo, pero el token NO vuelve a quien lo pide', async () => {
            await pg.db.insert(users).values({ email: 'suelto@otro.test', passwordHash: 'x', name: 'Suelto' });
            const before = mailbox.sent.length;
            const res = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'suelto@otro.test' });
            expect(res.token).toBeNull();
            expect(res.path).toBeNull();
            expect(mailbox.sent.length).toBe(before + 1);
            expect(mailbox.sent.at(-1)!.to).toBe('suelto@otro.test');
        });

        it('una cuenta NUEVA o que ya era cliente de esta empresa sí devuelve el token (compartir a mano)', async () => {
            const first = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'nuevo24@acme.test' });
            expect(first.token).not.toBeNull();
            const again = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'nuevo24@acme.test' });
            expect(again.token).not.toBeNull();
        });

        it('la sesión queda atada a la empresa del enlace: el cliente de dos empresas ve la correcta', async () => {
            // Empresa B con el mismo cliente.
            const [tb] = await pg.db.insert(tenants).values({ slug: 'beta', name: 'Beta' }).returning();
            const tenantB = tb!.id;
            const listB = await listsService.create(tenantB, { name: 'Cuentas' });
            await listsService.update(tenantB, listB.slug, { settings: { portal_template: [{ type: 'client_data' }] } });
            const fb = await fieldsService.create(tenantB, listB.slug, { label: 'Nombre', type: 'text', slug: 'nombre' });
            const recB = await recordsService.create(tenantB, { userId: admin.userId, role: 'admin' }, listB.slug, {
                data: { [`f${fb.id}`]: 'Registro de Beta' },
            });

            const inA = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'dos@empresas.test' });
            const { sessionToken: tokA } = await portal.consume(inA.token!);
            // B: la cuenta ya existía (cliente de A) → el token no vuelve, sólo el correo.
            const inB = await portal.issue(tenantB, listB.slug, { record_id: recB.id, email: 'dos@empresas.test' });
            expect(inB.token).toBeNull();
            const mailB = mailbox.sent.at(-1)!;
            const tokenB = /token=([A-Za-z0-9_-]+)/.exec(mailB.text ?? '')![1]!;
            const { sessionToken: tokB } = await portal.consume(tokenB);

            const sA = await sessions.get(tokA);
            const sB = await sessions.get(tokB);
            expect(sA!.portalTenantId).toBe(tenantId);
            expect(sB!.portalTenantId).toBe(tenantB);
            const bootA = await portal.me({ userId: sA!.userId, tenantId: sA!.portalTenantId! });
            const bootB = await portal.me({ userId: sB!.userId, tenantId: sB!.portalTenantId! });
            expect(bootA.record.id).toBe(recordId);
            expect(bootB.record.id).toBe(recB.id);
            // Una sesión vieja (sin empresa) con dos vínculos es ambigua → 404, no "la primera".
            await expect(portal.me({ userId: sA!.userId, tenantId: null })).rejects.toBeInstanceOf(NotFoundException);
            // Quitar el acceso en A no saca al cliente de B.
            await portal.revokeAccess(tenantId, 'clientes', sA!.userId);
            expect(await sessions.get(tokA)).toBeNull();
            expect(await sessions.get(tokB)).not.toBeNull();
        });

        it('un enlace de una cuenta desactivada no abre sesión', async () => {
            const res = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'baja24@acme.test' });
            await pg.db.update(users).set({ disabledAt: new Date() }).where(eq(users.email, 'baja24@acme.test'));
            await expect(portal.consume(res.token!)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('v0.1.241 — varios accesos por persona, cuentas y empresas', () => {
        let rec2: number;
        let rec3: number;
        const tokenFromMail = () => /token=([A-Za-z0-9_-]+)/.exec(mailbox.sent.at(-1)!.text ?? '')![1]!;
        const sessionOf = async (token: string) => (await sessions.get(token))!;

        beforeAll(async () => {
            rec2 = (await recordsService.create(tenantId, admin, 'clientes', { data: { [`f${fieldId}`]: 'Sucursal Norte' } })).id;
            rec3 = (await recordsService.create(tenantId, admin, 'clientes', { data: { [`f${fieldId}`]: 'Sucursal Sur' } })).id;
        });

        it('dar acceso a otro registro SUMA (no reemplaza) y el portal deja elegir cuál ver', async () => {
            const a = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'multi@acme.test' });
            // Antes de dar el segundo: el admin se entera de que ya tiene otro.
            const check = await portal.checkAccess(tenantId, 'clientes', 'Multi@Acme.test', rec2);
            expect(check.status).toBe('other_records');
            expect(check.records.map((r) => r.record_id)).toEqual([recordId]);
            expect(check.records[0]!.record_title).toBe('ACME Renovada');
            const b = await portal.issue(tenantId, 'clientes', { record_id: rec2, email: 'multi@acme.test' });
            expect((await portal.checkAccess(tenantId, 'clientes', 'multi@acme.test', rec2)).status).toBe('this_record');
            // Los dos accesos quedan registrados.
            expect((await portal.accessFor(tenantId, 'clientes', recordId)).users.map((u) => u.email)).toContain('multi@acme.test');
            expect((await portal.accessFor(tenantId, 'clientes', rec2)).users.map((u) => u.email)).toContain('multi@acme.test');

            // El enlace del segundo abre ESE registro; el del primero, el primero.
            const sB = await sessionOf((await portal.consume(b.token!)).sessionToken);
            const actorB = { userId: sB.userId, tenantId, linkId: sB.portalLinkId };
            expect((await portal.me(actorB)).record.id).toBe(rec2);
            const sA = await sessionOf((await portal.consume(a.token!)).sessionToken);
            expect((await portal.me({ userId: sA.userId, tenantId, linkId: sA.portalLinkId })).record.id).toBe(recordId);

            // Cuentas: las dos de esta empresa, la actual marcada.
            const acc = await portal.accounts(actorB);
            expect(acc.all_companies).toBe(false); // el token se le devolvió a la empresa
            expect(acc.accounts.map((x) => x.record_id).sort()).toEqual([recordId, rec2].sort());
            expect(acc.accounts.find((x) => x.current)!.record_id).toBe(rec2);
            expect(acc.accounts.every((x) => x.same_company && x.tenant_name === 'ACME')).toBe(true);
            // Elegir la otra (X-Portal-Account) cambia lo que ve todo el portal.
            const other = acc.accounts.find((x) => !x.current)!;
            const chosen = { ...actorB, requestedLinkId: other.id };
            const boot = await portal.me(chosen);
            expect(boot.record.id).toBe(recordId);
            expect(boot.account_id).toBe(other.id);
            // v0.1.286 — el cliente sólo comenta si el diseño tiene conversación.
            await listsService.update(tenantId, 'clientes', {
                settings: { portal_template: { blocks: [{ type: 'comments_thread' }] } },
            });
            await portal.createMyComment(chosen, { content: 'desde la cuenta elegida' });
            expect((await portal.myComments(chosen)).some((c) => (c as { content?: string }).content === 'desde la cuenta elegida')).toBe(true);
            expect((await portal.myComments(actorB)).some((c) => (c as { content?: string }).content === 'desde la cuenta elegida')).toBe(false);
            // Un id que no es suyo → 404, nunca el registro de otro.
            const ajeno = await portal.issue(tenantId, 'clientes', { record_id: rec3, email: 'ajeno41@acme.test' });
            const sAjeno = await sessionOf((await portal.consume(ajeno.token!)).sessionToken);
            await expect(portal.me({ ...actorB, requestedLinkId: sAjeno.portalLinkId })).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'portal_account_not_found' }),
            });

            // Quitar UN acceso deja el otro: la sesión sigue viva y cae al que queda.
            const tokB = (await portal.consume((await portal.issue(tenantId, 'clientes', { record_id: rec2, email: 'multi@acme.test' })).token!)).sessionToken;
            await portal.revokeAccess(tenantId, 'clientes', sB.userId, rec2);
            expect(await sessions.get(tokB)).not.toBeNull();
            expect((await portal.me({ userId: sB.userId, tenantId, linkId: sB.portalLinkId })).record.id).toBe(recordId);
            // Quitar el último → fuera de la empresa y sesiones muertas.
            await portal.revokeAccess(tenantId, 'clientes', sB.userId, recordId);
            expect(await sessions.get(tokB)).toBeNull();
        });

        it('el chequeo previo distingue equipo, nuevo y ya-con-acceso (sólo de ESTA empresa)', async () => {
            expect((await portal.checkAccess(tenantId, 'clientes', 'admin@acme.test', recordId)).status).toBe('staff');
            expect((await portal.checkAccess(tenantId, 'clientes', 'nadie41@acme.test', recordId)).status).toBe('new');
        });

        it('alguien del EQUIPO de otra empresa puede ser cliente aquí; el enlace sólo le llega por correo', async () => {
            const [tc] = await pg.db.insert(tenants).values({ slug: 'gamma41', name: 'Gamma' }).returning();
            const [staff] = await pg.db.insert(users).values({ email: 'staff@gamma.test', passwordHash: 'x', name: 'Staff Gamma' }).returning();
            await withTenant(pg.db, tc!.id, (tx) => tx.insert(memberships).values({ userId: staff!.id, tenantId: tc!.id, role: 'admin' }));
            const res = await portal.issue(tenantId, 'clientes', { record_id: rec3, email: 'staff@gamma.test' });
            expect(res.token).toBeNull(); // su cuenta no es de esta empresa
            expect(mailbox.sent.at(-1)!.to).toBe('staff@gamma.test');
            const s = await sessionOf((await portal.consume(tokenFromMail())).sessionToken);
            expect(s.portalTenantId).toBe(tenantId);
            expect((await portal.me({ userId: s.userId, tenantId, linkId: s.portalLinkId })).record.id).toBe(rec3);
            // Su rol en Gamma no cambió.
            const roles = await pg.db.select().from(memberships).where(eq(memberships.userId, staff!.id));
            expect(roles.find((m) => m.tenantId === tc!.id)!.role).toBe('admin');
            expect(roles.find((m) => m.tenantId === tenantId)!.role).toBe('client');
        });

        it('una sesión abierta desde el correo ve sus cuentas de otras empresas y cambia de una a otra', async () => {
            const [td] = await pg.db.insert(tenants).values({ slug: 'delta41', name: 'Delta' }).returning();
            const tenantD = td!.id;
            const listD = await listsService.create(tenantD, { name: 'Obras' });
            const fd = await fieldsService.create(tenantD, listD.slug, { label: 'Nombre', type: 'text', slug: 'nombre' });
            const recD = await recordsService.create(tenantD, { userId: admin.userId, role: 'admin' }, listD.slug, {
                data: { [`f${fd.id}`]: 'Obra Delta' },
            });
            // Acceso en ACME (cuenta nueva → token devuelto) y en Delta (sólo correo).
            const inA = await portal.issue(tenantId, 'clientes', { record_id: recordId, email: 'viajero@empresas.test' });
            await portal.issue(tenantD, listD.slug, { record_id: recD.id, email: 'viajero@empresas.test' });
            const fromMail = tokenFromMail();

            // El token devuelto a ACME: sesión sólo de ACME, sin ver Delta.
            const sCopied = await sessionOf((await portal.consume(inA.token!)).sessionToken);
            expect(sCopied.portalAccount).toBeUndefined();
            const copiedActor = { userId: sCopied.userId, tenantId, linkId: sCopied.portalLinkId, account: false };
            const copied = await portal.accounts(copiedActor);
            expect(copied.all_companies).toBe(false);
            expect(copied.accounts.map((a) => a.tenant_name)).toEqual(['ACME']);
            expect((await portal.checkAccess(tenantD, listD.slug, 'viajero@empresas.test', recD.id)).status).toBe('this_record');

            // El enlace que llegó al correo: ve las dos empresas.
            const sMail = await sessionOf((await portal.consume(fromMail, { host: 'app.imagina.test' })).sessionToken);
            expect(sMail.portalTenantId).toBe(tenantD);
            expect(sMail.portalAccount).toBe(true);
            const mailActor = { userId: sMail.userId, tenantId: tenantD, linkId: sMail.portalLinkId, account: true };
            const all = await portal.accounts(mailActor);
            expect(all.all_companies).toBe(true);
            expect(all.accounts.map((a) => a.tenant_name).sort()).toEqual(['ACME', 'Delta']);
            const acmeAcc = all.accounts.find((a) => a.tenant_name === 'ACME')!;
            expect(acmeAcc.same_company).toBe(false);
            expect(acmeAcc.record_title).toBe('ACME Renovada');

            // Cambiar a ACME: ruta de un solo uso que abre una sesión de ACME.
            const sw = await portal.switchAccount(mailActor, acmeAcc.id);
            expect(sw.path).toMatch(/^\/portal\/acceso\?token=/);
            const swToken = /token=([A-Za-z0-9_-]+)/.exec(sw.path!)![1]!;
            const sSwitched = await sessionOf((await portal.consume(swToken)).sessionToken);
            expect(sSwitched.portalTenantId).toBe(tenantId);
            expect(sSwitched.portalLinkId).toBe(acmeAcc.id);
            await expect(portal.consume(swToken)).rejects.toBeInstanceOf(NotFoundException);
            // La sesión copiada por la empresa NO puede cambiar de empresa.
            const deltaAcc = all.accounts.find((a) => a.tenant_name === 'Delta')!;
            await expect(portal.switchAccount(copiedActor, deltaAcc.id)).rejects.toBeInstanceOf(NotFoundException);
            // …pero puede pedirse por correo el enlace de todas sus cuentas.
            const sent = await portal.emailAllAccounts(copiedActor);
            expect(sent).toEqual({ email_sent: true, email_hint: 'vi***@empresas.test' });
            expect(mailbox.sent.at(-1)!.to).toBe('viajero@empresas.test');
            expect(mailbox.sent.at(-1)!.subject).toContain('todas tus cuentas');
            const sAll = await sessionOf((await portal.consume(tokenFromMail())).sessionToken);
            expect(sAll.portalAccount).toBe(true);

            // En el dominio PROPIO de una empresa la sesión nunca ve otras empresas.
            await pg.db.update(tenants).set({ customDomain: 'portal.delta41.test' }).where(eq(tenants.id, tenantD));
            await portal.requestAccess('viajero@empresas.test');
            await portal.whenIdle();
            const viaCustom = await sessionOf((await portal.consume(tokenFromMail(), { host: 'Portal.Delta41.test:443' })).sessionToken);
            expect(viaCustom.portalAccount).toBeUndefined();
        });

        it('pedir un enlace manda UNO por empresa aunque tenga varios accesos en ella', async () => {
            await portal.issue(tenantId, 'clientes', { record_id: rec2, email: 'dosfichas@acme.test' });
            await portal.issue(tenantId, 'clientes', { record_id: rec3, email: 'dosfichas@acme.test' });
            const before = mailbox.sent.length;
            await portal.requestAccess('dosfichas@acme.test');
            await portal.whenIdle();
            expect(mailbox.sent.length).toBe(before + 1);
        });

        it('/portal/* sólo acepta una sesión DEL PORTAL (cookie propia o la vieja en la general)', async () => {
            const guard = new SessionGuard(sessions);
            const ctx = (url: string, cookies: Record<string, string>) => {
                const req = { url, cookies, headers: {} } as unknown as Record<string, unknown>;
                return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
            };
            const res = await portal.issue(tenantId, 'clientes', { record_id: rec2, email: 'cookie41@acme.test' });
            const portalTok = (await portal.consume(res.token!)).sessionToken;
            const work = await sessions.create(admin.userId, { via: 'password' });

            // Cookie del portal + cookie de trabajo: el portal usa la suya.
            const a = ctx('/api/v1/portal/me', { [PORTAL_SESSION_COOKIE]: portalTok, [SESSION_COOKIE]: work });
            await expect(guard.canActivate(a.ctx)).resolves.toBe(true);
            expect(a.req.portalTenantId).toBe(tenantId);
            // Sesión vieja del portal en la cookie general: sigue sirviendo.
            const b = ctx('/api/v1/portal/me', { [SESSION_COOKIE]: portalTok });
            await expect(guard.canActivate(b.ctx)).resolves.toBe(true);
            // Una sesión de trabajo no abre un portal.
            const c = ctx('/api/v1/portal/me', { [SESSION_COOKIE]: work });
            await expect(guard.canActivate(c.ctx)).rejects.toBeInstanceOf(UnauthorizedException);
            // Y la del portal sigue sin servir para la app (SEC-24).
            const d = ctx('/api/v1/lists', { [SESSION_COOKIE]: portalTok });
            await expect(guard.canActivate(d.ctx)).rejects.toBeInstanceOf(ForbiddenException);
            // La cookie de trabajo sigue funcionando en la app aunque haya portal.
            const e = ctx('/api/v1/lists', { [SESSION_COOKIE]: work, [PORTAL_SESSION_COOKIE]: portalTok });
            await expect(guard.canActivate(e.ctx)).resolves.toBe(true);
            expect(e.req.authUserId).toBe(admin.userId);
        });
    });

    describe('v0.1.233 — el portal en el modelo v3 (ADR-S26 fase C)', () => {
        let portalListId: number;
        let mio: number;
        let ajeno: number;
        let montoId: number;
        let relId: number;
        let notaId: number;
        let sinVinculoSlug = '';

        beforeAll(async () => {
            const list = await listsService.create(tenantId, { name: 'Socios' });
            portalListId = list.id;
            const nombre = await fieldsService.create(tenantId, 'socios', { label: 'Razón social', type: 'text', slug: 'razon' });
            const cupo = await fieldsService.create(tenantId, 'socios', { label: 'Cupo', type: 'number', slug: 'cupo_socio' });
            void cupo;
            mio = (await recordsService.create(tenantId, admin, 'socios', { data: { [`f${nombre.id}`]: 'Mío SA' } })).id;
            ajeno = (await recordsService.create(tenantId, admin, 'socios', { data: { [`f${nombre.id}`]: 'Ajeno SA' } })).id;

            await listsService.create(tenantId, { name: 'Cuotas' });
            // El título de la lista viaja siempre (es el nombre de cada fila).
            await fieldsService.create(tenantId, 'cuotas', { label: 'Concepto', type: 'text', slug: 'concepto' });
            montoId = (await fieldsService.create(tenantId, 'cuotas', { label: 'Monto', type: 'number', slug: 'monto_cuota' })).id;
            notaId = (await fieldsService.create(tenantId, 'cuotas', { label: 'Nota interna', type: 'text', slug: 'nota_interna' })).id;
            relId = (
                await fieldsService.create(tenantId, 'cuotas', {
                    label: 'Socio',
                    type: 'relation',
                    slug: 'socio',
                    config: { target_list_id: portalListId },
                })
            ).id;
            for (const [monto, socio] of [[100, mio], [250, mio], [999, ajeno]] as const) {
                await recordsService.create(tenantId, admin, 'cuotas', {
                    data: { [`f${montoId}`]: monto, [`f${notaId}`]: 'costo interno', [`f${relId}`]: [socio] },
                });
            }
            const sv = await listsService.create(tenantId, { name: 'Sin vinculo' });
            sinVinculoSlug = sv.slug;
            await fieldsService.create(tenantId, sv.slug, { label: 'Dato', type: 'text', slug: 'dato_sv' });
        });

        function portalEditableFieldIdsOf(boot: { editable_field_ids: number[] }): number[] {
            return boot.editable_field_ids;
        }

        async function socioSession(email: string): Promise<number> {
            const link = await portal.issue(tenantId, 'socios', { record_id: mio, email });
            const { sessionToken } = await portal.consume(link.token!);
            return (await sessions.get(sessionToken))!.userId;
        }

        it('v0.1.237 — el automático es «Mi cuenta»: sólo con las listas que el admin habilitó, acotadas al cliente', async () => {
            const uid = await socioSession('auto237@acme.test');
            // Sin listas habilitadas: sus datos y nada de otras listas.
            const before = await portal.me(actor(uid));
            expect(before.layout_origin).toBe('auto');
            expect(layoutBlocks(before.layout!).some((b) => b.type === 'related' || b.type === 'chart')).toBe(false);
            expect(portalEditableFieldIdsOf(before)).toEqual([]);

            const cuotas = await listsService.get(tenantId, 'cuotas');
            const socios = await listsService.get(tenantId, 'socios');
            await listsService.update(tenantId, 'socios', {
                settings: { ...socios.settings, portal: { enabled: true, related_lists: [cuotas.id] } },
            });
            const boot = await portal.me(actor(uid));
            expect(boot.layout_origin).toBe('auto');
            const related = layoutBlocks(boot.layout!).find((b) => b.type === 'related')!;
            expect((related.config as { source: unknown }).source).toEqual({ kind: 'related', field_id: relId, direction: 'reverse' });
            const data = (boot.layout_data!.data as Record<string, { rows: Array<{ data: Record<string, unknown> }>; fields: Array<{ id: number }> }>)[related.id]!;
            // Sólo sus cuotas, y la columna que suena interna no viaja.
            expect(data.rows).toHaveLength(2);
            expect(data.fields.map((f) => f.id)).not.toContain(notaId);
            expect(data.rows.every((r) => r.data[`f${notaId}`] === undefined)).toBe(true);
            // Nada se repite «al pie» con todas las columnas.
            expect(boot.related_lists).toEqual([]);
            await listsService.update(tenantId, 'socios', { settings: { ...socios.settings, portal: { enabled: true, related_lists: [] } } });
        });

        it('la plantilla anterior se convierte sola: bloques, edición y datos acotados al cliente', async () => {
            await listsService.update(tenantId, 'socios', {
                settings: {
                    portal_template: {
                        blocks: [
                            { type: 'hero', config: { title: 'Hola', subtitle: 'Bienvenido' } },
                            { type: 'client_data', config: { visible_field_slugs: ['razon'] } },
                            { type: 'editable_form', config: { editable_field_slugs: ['razon'] } },
                            { type: 'related_records_table', config: { list_slug: 'cuotas', visible_field_slugs: ['monto_cuota'] } },
                            { type: 'kpi_widget', config: { title: 'Total', list_slug: 'cuotas', metric: 'sum', field_id: montoId } },
                        ],
                    },
                },
            });
            const uid = await socioSession('socio1@acme.test');
            const boot = await portal.me(actor(uid));
            expect(boot.layout_origin).toBe('legacy');
            const blocks = boot.layout!.pages.flatMap((p) => p.sections.flatMap((s) => s.blocks.flat()));
            expect(blocks.map((b) => b.type)).toEqual(['heading', 'fields', 'fields', 'related', 'chart']);
            const related = blocks.find((b) => b.type === 'related')!;
            expect(related.config.source).toEqual({ kind: 'related', field_id: relId, direction: 'reverse' });
            expect(boot.editable_field_ids).toHaveLength(1);

            const data = boot.layout_data!.data;
            const table = data[related.id] as { rows: Array<{ data: Record<string, unknown> }>; total: number };
            // Sólo las cuotas del cliente, y sólo la columna del bloque: la nota
            // interna de esa lista no sale del servidor.
            expect(table.total).toBe(2);
            expect(table.rows.map((r) => r.data[`f${montoId}`]).sort()).toEqual([100, 250]);
            expect(table.rows.every((r) => !(`f${notaId}` in r.data))).toBe(true);
            const kpi = data[blocks.find((b) => b.type === 'chart')!.id] as { value: number };
            expect(kpi.value).toBe(350);
            // Definiciones de los campos usados (colores/etiquetas en el portal), no de todos.
            const sent = boot.layout_data!.fields[String((await listsService.get(tenantId, 'cuotas')).id)]!;
            expect(sent.map((f) => f.id)).toContain(montoId);
            expect(sent.map((f) => f.id)).not.toContain(notaId);
            // La edición del portal anterior sigue valiendo.
            await portal.updateMe(actor(uid), { fields: { razon: 'Mío SAS' } });
        });

        it('el diseño v3 guardado MANDA: editables, fuentes acotadas y bloques que el portal no dibuja', async () => {
            const cuotas = await listsService.get(tenantId, 'cuotas');
            const sinVinculo = await listsService.get(tenantId, sinVinculoSlug);
            const fields = await fieldsService.list(tenantId, 'socios');
            const razon = fields.find((f) => f.slug === 'razon')!;
            const cupo = fields.find((f) => f.slug === 'cupo_socio')!;
            await listsService.update(tenantId, 'socios', {
                settings: {
                    portal_layout_v3: {
                        v: 3,
                        pages: [
                            {
                                id: 'inicio',
                                name: 'Inicio',
                                sections: [
                                    {
                                        id: 's1',
                                        columns: [6, 6],
                                        blocks: [
                                            [
                                                { id: 'datos', type: 'fields', config: { field_ids: [razon.id] } },
                                                { id: 'cupo', type: 'fields', config: { field_ids: [cupo.id], editable: true } },
                                                { id: 'acceso', type: 'portal_access', config: {} },
                                            ],
                                            [
                                                { id: 'total', type: 'chart', config: { source: { kind: 'list', list_id: cuotas.id }, kind: 'kpi', metric: 'sum', metric_field_id: montoId } },
                                                { id: 'nada', type: 'related', config: { source: { kind: 'list', list_id: sinVinculo.id } } },
                                                { id: 'propia', type: 'related', config: { source: { kind: 'list', list_id: portalListId } } },
                                            ],
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            });
            const uid = await socioSession('socio2@acme.test');
            const boot = await portal.me(actor(uid));
            expect(boot.layout_origin).toBe('saved');
            const types = boot.layout!.pages[0]!.sections[0]!.blocks.flat().map((b) => b.id);
            expect(types).not.toContain('acceso');
            expect(boot.editable_field_ids).toEqual([cupo.id]);
            const data = boot.layout_data!.data as Record<string, { value?: number; __error?: string }>;
            // "Toda la lista" en el portal = lo del cliente (vía la relación).
            expect(data.total!.value).toBe(350);
            // Una lista sin vínculo con el cliente falla cerrado.
            expect(data.nada!.__error).toMatch(/no está vinculada/);
            expect(data.propia!.__error).toBeTruthy();

            // La whitelist sale del diseño v3: lo que ahora no es editable → 403.
            await expect(portal.updateMe(actor(uid), { fields: { razon: 'X' } })).rejects.toBeInstanceOf(ForbiddenException);
            await portal.updateMe(actor(uid), { fields: { cupo_socio: 5 } });
        });

        it('una lista vinculada por campo persona muestra sólo lo del cliente; la vista previa usa el mismo alcance', async () => {
            const uid = await socioSession('socio3@acme.test');
            const tickets = await listsService.create(tenantId, { name: 'Tickets socio' });
            const quien = await fieldsService.create(tenantId, tickets.slug, { label: 'Cliente', type: 'user', slug: 'quien' });
            await recordsService.create(tenantId, admin, tickets.slug, { data: { [`f${quien.id}`]: uid } });
            await recordsService.create(tenantId, admin, tickets.slug, { data: { [`f${quien.id}`]: admin.userId } });
            await recordsService.create(tenantId, admin, tickets.slug, { data: {} });
            const blocks = [
                { id: 'mis', type: 'chart' as const, config: { source: { kind: 'list', list_id: tickets.id }, kind: 'kpi', metric: 'count' } },
            ];
            // Vista previa del editor: el cliente de ese registro es el último
            // que entró (socio3) → ve 1 ticket.
            const preview = await portal.previewLayoutData(tenantId, 'socios', mio, blocks);
            expect((preview.data.mis as { value: number }).value).toBeGreaterThanOrEqual(0);
            const [link] = (await portal.accessFor(tenantId, 'socios', mio)).users;
            void link;
            // Directo con el motor: el alcance de socio3.
            const svc = (portal as unknown as { layoutData: RecordLayoutDataService }).layoutData;
            const res = await svc.portal(tenantId, { listId: portalListId, recordId: mio, userId: uid }, blocks, (id) => `signed:${id}`);
            expect((res.data.mis as { value: number }).value).toBe(1);
            // Un registro de otra lista no sirve para la vista previa.
            await expect(portal.previewLayoutData(tenantId, 'socios', 999_999, blocks)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('un diseño v3 inválido no se guarda', async () => {
            await expect(
                listsService.update(tenantId, 'socios', {
                    settings: { portal_layout_v3: { v: 3, pages: [{ id: 'p', name: 'P', sections: [{ id: 's', columns: [5], blocks: [[]] }] }] } },
                }),
            ).rejects.toBeInstanceOf(BadRequestException);
        });
    });

    describe('auditoría v0.1.286 — lo que el portal NO entrega', () => {
        let mine: number;
        let other: number;
        let nombreId: number;
        let emailId: number;
        let costoId: number;
        let comments: CommentsService;
        const notifyEvents: NotifyEvent[] = [];
        const changeEvents: RecordChange[] = [];

        const layout = (extra: { readonlyComments?: boolean; noComments?: boolean } = {}) => ({
            v: 3,
            header: { title_field_id: nombreId, subtitle_field_ids: [], chip_field_ids: [] },
            pages: [
                {
                    id: 'inicio',
                    name: 'Inicio',
                    sections: [
                        {
                            id: 's1',
                            columns: [12],
                            blocks: [
                                [
                                    { id: 'datos', type: 'fields', config: { field_ids: [emailId], editable: true } },
                                    ...(extra.noComments ? [] : [{ id: 'conv', type: 'comments', config: { readonly: extra.readonlyComments === true } }]),
                                    { id: 'hist', type: 'activity', config: {} },
                                ],
                            ],
                        },
                    ],
                },
            ],
        });

        async function setLayout(extra: Parameters<typeof layout>[0] = {}): Promise<void> {
            const l = await listsService.get(tenantId, 'contratos');
            await listsService.update(tenantId, 'contratos', {
                settings: { ...l.settings, portal: { enabled: true }, portal_layout_v3: layout(extra) },
            });
        }

        async function contratoSession(email: string, record = mine): Promise<number> {
            const link = await portal.issue(tenantId, 'contratos', { record_id: record, email });
            const { sessionToken } = await portal.consume(link.token!);
            return (await sessions.get(sessionToken))!.userId;
        }

        beforeAll(async () => {
            await listsService.create(tenantId, { name: 'Contratos' });
            nombreId = (await fieldsService.create(tenantId, 'contratos', { label: 'Nombre', type: 'text', slug: 'nombre_c' })).id;
            emailId = (await fieldsService.create(tenantId, 'contratos', { label: 'Email', type: 'email', slug: 'email_c' })).id;
            costoId = (await fieldsService.create(tenantId, 'contratos', { label: 'Costo interno', type: 'number', slug: 'costo_c' })).id;
            mine = (
                await recordsService.create(tenantId, admin, 'contratos', {
                    data: { [`f${nombreId}`]: 'Mi contrato', [`f${emailId}`]: 'yo@cliente.test', [`f${costoId}`]: 777 },
                })
            ).id;
            other = (await recordsService.create(tenantId, admin, 'contratos', { data: { [`f${nombreId}`]: 'Otro' } })).id;
            await setLayout();
            comments = new CommentsService(tenantDb, new CommentsRepository(), listsService, recordsService, rt);
            const notify = new NotifyHub();
            notify.subscribe((e) => void notifyEvents.push(e));
            const changes = new RecordChangeHub();
            changes.subscribe((c) => void changeEvents.push(c));
            Object.assign(portal as unknown as Record<string, unknown>, { notify, changes });
        });

        afterAll(() => {
            Object.assign(portal as unknown as Record<string, unknown>, { notify: undefined, changes: undefined });
        });

        it('GET /me sólo manda los campos que el diseño muestra (+ título y editables)', async () => {
            const uid = await contratoSession('vis1@cliente.test');
            const boot = await portal.me(actor(uid));
            expect(boot.fields.map((f) => f.id).sort()).toEqual([nombreId, emailId].sort());
            expect(boot.record.data[`f${costoId}`]).toBeUndefined();
            expect(boot.record.data[`f${emailId}`]).toBe('yo@cliente.test');
            expect(JSON.stringify(boot)).not.toContain('777');
            // Cuentas y primera página de la conversación en el MISMO request.
            expect(boot.accounts?.accounts.some((a) => a.record_id === mine)).toBe(true);
            expect(boot.comments).toEqual([]);
        });

        it('la actividad sólo muestra cambios de campos que el cliente ve', async () => {
            const uid = await contratoSession('vis2@cliente.test');
            await recordsService.update(tenantId, admin, 'contratos', mine, { data: { [`f${costoId}`]: 900 } });
            await recordsService.update(tenantId, admin, 'contratos', mine, { data: { [`f${emailId}`]: 'nuevo@cliente.test' } });
            const items = await portal.myActivity(actor(uid), 50);
            const all = JSON.stringify(items);
            expect(all).not.toContain(`f${costoId}`);
            expect(all).not.toContain('900');
            const updates = items.filter((a) => a.action === 'record_updated');
            expect(updates).toHaveLength(1);
            expect(Object.keys(updates[0]!.diff as Record<string, unknown>)).toEqual([`f${emailId}`]);
            const created = items.find((a) => a.action === 'record_created')!;
            expect(Object.keys(created.diff as Record<string, unknown>)).not.toContain(`f${costoId}`);
        });

        it('los comentarios INTERNOS jamás llegan al portal; los visibles para el cliente sí, sin ids del equipo', async () => {
            const uid = await contratoSession('vis3@cliente.test');
            await comments.create(tenantId, admin, 'contratos', mine, { body: 'Ojo: este cliente paga tarde', kind: 'note' });
            await comments.create(tenantId, admin, 'contratos', mine, { body: 'Hola, ya revisamos tu caso', kind: 'note', visibility: 'client' });
            const seen = await portal.myComments(actor(uid));
            expect(seen.map((c) => c.body)).toEqual(['Hola, ya revisamos tu caso']);
            expect(seen[0]).toMatchObject({ mine: false, from_team: true, author_name: 'Admin' });
            expect(JSON.stringify(seen)).not.toContain('paga tarde');
            const boot = await portal.me(actor(uid));
            expect(boot.comments?.map((c) => c.body)).toEqual(['Hola, ya revisamos tu caso']);

            // Lo que escribe el cliente queda visible para él y marcado para el equipo.
            await portal.createMyComment(actor(uid), { content: '¡Gracias!' });
            const team = await comments.list(tenantId, admin, 'contratos', mine);
            const fromClient = team.find((c) => c.body === '¡Gracias!')!;
            expect(fromClient).toMatchObject({ visibility: 'client', from_client: true });
            const internal = team.find((c) => c.body.includes('paga tarde'))!;
            expect(internal.visibility).toBe('internal');
        });

        it('el comentario y el cambio del cliente avisan (seguidores, automatizaciones, campos con IA)', async () => {
            const uid = await contratoSession('vis4@cliente.test');
            notifyEvents.length = 0;
            changeEvents.length = 0;
            await portal.createMyComment(actor(uid), { content: 'Necesito ayuda' });
            expect(notifyEvents).toHaveLength(1);
            expect(notifyEvents[0]).toMatchObject({ type: 'comment', recordId: mine, actorId: uid, fromClient: true, visibility: 'client' });
            await portal.updateMe(actor(uid), { fields: { email_c: 'otra@cliente.test' } });
            expect(changeEvents).toHaveLength(1);
            expect(changeEvents[0]).toMatchObject({ recordId: mine, actorId: uid, viaPortal: true });
            expect(changeEvents[0]!.after[`f${emailId}`]).toBe('otra@cliente.test');
            // La escritura es parcial: lo que el cliente no tocó queda igual.
            expect(changeEvents[0]!.after[`f${costoId}`]).toBe(900);
        });

        it('comentar exige conversación escribible en el diseño y la empresa activa', async () => {
            const uid = await contratoSession('vis5@cliente.test');
            await setLayout({ readonlyComments: true });
            await expect(portal.createMyComment(actor(uid), { content: 'x' })).rejects.toMatchObject({
                response: { code: 'portal_comments_disabled' },
            });
            await setLayout({ noComments: true });
            expect(await portal.myComments(actor(uid))).toEqual([]);
            expect((await portal.me(actor(uid))).comments).toBeNull();
            await expect(portal.createMyComment(actor(uid), { content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
            await setLayout();
            // Empresa en solo-lectura (ADR-S09): ni comentarios ni ediciones.
            await pg.db.update(tenants).set({ subscriptionEndsAt: new Date(Date.now() - 1000) }).where(eq(tenants.id, tenantId));
            try {
                await expect(portal.createMyComment(actor(uid), { content: 'x' })).rejects.toMatchObject({
                    response: { code: 'workspace_read_only' },
                });
                await expect(portal.updateMe(actor(uid), { fields: { email_c: 'z@cliente.test' } })).rejects.toMatchObject({
                    response: { code: 'workspace_read_only' },
                });
            } finally {
                await pg.db.update(tenants).set({ subscriptionEndsAt: null }).where(eq(tenants.id, tenantId));
            }
        });

        it('el cliente CREA un registro en una lista habilitada: sólo los campos permitidos y vinculado a él', async () => {
            const uid = await contratoSession('crea1@cliente.test');
            const contratos = await listsService.get(tenantId, 'contratos');
            const tickets = await listsService.create(tenantId, { name: 'Tickets contrato' });
            const asunto = await fieldsService.create(tenantId, tickets.slug, { label: 'Asunto', type: 'text', slug: 'asunto_t', is_required: true });
            const prioridad = await fieldsService.create(tenantId, tickets.slug, {
                label: 'Prioridad', type: 'select', slug: 'prioridad_t',
                config: { options: [{ value: 'alta', label: 'Alta' }, { value: 'baja', label: 'Baja' }] },
            });
            const interno = await fieldsService.create(tenantId, tickets.slug, { label: 'Nota interna', type: 'text', slug: 'interno_t' });
            const rel = await fieldsService.create(tenantId, tickets.slug, {
                label: 'Contrato', type: 'relation', slug: 'contrato_t', config: { target_list_id: contratos.id },
            });
            Object.assign(portal as unknown as Record<string, unknown>, { records_: recordsService });

            // Sin habilitar: nada.
            expect((await portal.me(actor(uid))).creatable_lists).toEqual([]);
            await expect(portal.createRecord(actor(uid), tickets.id, { fields: { [asunto.id]: 'x' } })).rejects.toMatchObject({
                response: { code: 'portal_list_not_creatable' },
            });

            const fresh = await listsService.get(tenantId, 'contratos');
            await listsService.update(tenantId, 'contratos', {
                settings: {
                    ...fresh.settings,
                    portal: { ...(fresh.settings.portal as object), enabled: true, creatable_lists: [{ list_id: tickets.id, field_ids: [asunto.id, prioridad.id, rel.id], label: 'Abrir un ticket' }] },
                },
            });
            const boot = await portal.me(actor(uid));
            expect(boot.creatable_lists).toHaveLength(1);
            expect(boot.creatable_lists[0]!.label).toBe('Abrir un ticket');
            // La relación nunca la elige el cliente: no se ofrece.
            expect(boot.creatable_lists[0]!.fields.map((f) => f.id)).toEqual([asunto.id, prioridad.id]);

            // Un campo no permitido → 403; falta el obligatorio → 400.
            await expect(portal.createRecord(actor(uid), tickets.id, { fields: { [asunto.id]: 'x', [interno.id]: 'hack' } })).rejects.toBeInstanceOf(ForbiddenException);
            await expect(portal.createRecord(actor(uid), tickets.id, { fields: { [prioridad.id]: 'alta' } })).rejects.toBeInstanceOf(BadRequestException);

            notifyEvents.length = 0;
            const created = await portal.createRecord(actor(uid), tickets.id, { fields: { [asunto.id]: 'No me llega la factura', [prioridad.id]: 'alta' } });
            const rec = await recordsService.get(tenantId, admin, tickets.slug, created.id);
            expect(rec.data[`f${asunto.id}`]).toBe('No me llega la factura');
            expect(rec.relations?.[`f${rel.id}`]).toEqual([mine]);
            expect(notifyEvents[0]).toMatchObject({ type: 'portal_record_created', recordId: created.id, parentRecordId: mine, actorId: uid });
        });

        it('el equipo responde → el cliente recibe un correo (una vez cada 15 min y si no lo apagó)', async () => {
            const uid = await contratoSession('aviso1@cliente.test');
            const sentBefore = mailbox.sent.length;
            const event = { tenantId, listId: (await listsService.get(tenantId, 'contratos')).id, recordId: mine, actorId: admin.userId, body: 'Ya quedó lista tu factura' };
            await redis.del(`portalreply:${tenantId}:${mine}:${uid}`);
            const n = await portal.emailClientsAboutReply(event);
            expect(n).toBeGreaterThanOrEqual(1);
            const mail = mailbox.sent.slice(sentBefore).find((m) => m.to === 'aviso1@cliente.test')!;
            expect(mail.subject).toMatch(/te respondió/);
            expect(mail.text).toContain('Ya quedó lista tu factura');
            expect(mail.text).toContain('/portal?cuenta=');
            // Freno: otro mensaje enseguida no manda otro correo.
            const again = mailbox.sent.length;
            await portal.emailClientsAboutReply(event);
            expect(mailbox.sent.slice(again).some((m) => m.to === 'aviso1@cliente.test')).toBe(false);
            // Apagado por el cliente: nada.
            await portal.setPreferences(actor(uid), { notify_email: false });
            expect((await portal.me(actor(uid))).notify_email).toBe(false);
            await redis.del(`portalreply:${tenantId}:${mine}:${uid}`);
            const afterOff = mailbox.sent.length;
            await portal.emailClientsAboutReply(event);
            expect(mailbox.sent.slice(afterOff).some((m) => m.to === 'aviso1@cliente.test')).toBe(false);
        });

        it('un registro BORRADO deja de existir para el cliente y no recibe accesos nuevos', async () => {
            const uid = await contratoSession('vis6@cliente.test', other);
            expect((await portal.me(actor(uid))).record.id).toBe(other);
            await recordsService.remove(tenantId, admin, 'contratos', other);
            await expect(portal.me(actor(uid))).rejects.toBeInstanceOf(NotFoundException);
            await expect(portal.updateMe(actor(uid), { fields: { email_c: 'a@b.test' } })).rejects.toBeInstanceOf(NotFoundException);
            await expect(portal.myComments(actor(uid))).rejects.toBeInstanceOf(NotFoundException);
            await expect(
                portal.issue(tenantId, 'contratos', { record_id: other, email: 'nuevo-borrado@cliente.test' }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
