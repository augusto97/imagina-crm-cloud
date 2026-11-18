import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocumentStarter, type DocDesign, type Field, type WhatsappTemplate } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { connectionIdOfAction } from '../src/connectors/connectors.service';
import IORedis from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { loadEnv } from '../src/config/env';
import { activity, connections, memberships, signatureRequests, signatureSigners, tenants, users, whatsappTemplates } from '../src/db/schema';
import { DocumentsService } from '../src/documents/documents.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { identificationText } from '../src/signatures/signature-pdf';
import { SignaturesService, signatureTokenFor } from '../src/signatures/signatures.service';
import type { SmsService } from '../src/sms/sms.service';
import type { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

class Mailbox implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

/** El SMS y el WhatsApp de mentira: guardan lo que se mandó y pueden fallar a pedido. */
interface SentCode {
    via: 'sms' | 'whatsapp';
    connectionId: number;
    to: string;
    text: string;
    code: string | null;
    template: { name: string; language: string } | null;
    source?: string;
    target?: unknown;
}

const admin: Actor = { userId: 1, role: 'admin' };

/**
 * v0.1.448 (ADR-S107) — El código para firmar por SMS o por WhatsApp: qué
 * conexiones pueden mandarlo (sólo las del equipo; Meta con una plantilla
 * aprobada que sirva), el celular de cada persona, el envío, que no queda
 * rastro en el registro, que un envío fallido no deja un código vivo, y la
 * constancia que dice por dónde se identificó cada persona.
 */
describe('v0.1.448 — código de firma por SMS o WhatsApp (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let docs: DocumentsService;
    let svc: SignaturesService;
    let tenantId: number;
    let f: Record<string, Field>;
    let templateId: number;
    let recordId: number;
    let png: string;
    const sent: SentCode[] = [];
    let failNext: string | null = null;
    const conn: Record<'sms' | 'smsPrivate' | 'cloud' | 'web' | 'mail', number> = { sms: 0, smsPrivate: 0, cloud: 0, web: 0, mail: 0 };
    const ip = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' };

    const fakeSms = {
        sendNow: (_tenant: number, args: { connectionId: number; to: string; message: string; source: string; target: unknown }) => {
            sent.push({ via: 'sms', connectionId: args.connectionId, to: args.to, text: args.message, code: /\b(\d{6})\b/.exec(args.message)?.[1] ?? null, template: null, source: args.source, target: args.target });
            if (failNext) {
                const error = failNext;
                failNext = null;
                return Promise.resolve({ ok: false, error });
            }
            return Promise.resolve({ ok: true, error: null });
        },
    };
    const fakeWhatsapp = {
        templatesOf: async (t: number, connectionId: number): Promise<WhatsappTemplate[]> => {
            const rows = await tenantDb.withTenant(t, (tx) => tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.connectionId, connectionId)));
            return rows
                .filter((r) => r.status === 'APPROVED')
                .map((r) => ({
                    id: r.id,
                    meta_id: r.metaId,
                    name: r.name,
                    language: r.language,
                    category: r.category,
                    status: r.status,
                    parameter_format: r.parameterFormat as 'POSITIONAL' | 'NAMED',
                    components: r.components,
                    rejected_reason: null,
                    synced_at: r.syncedAt.toISOString(),
                }));
        },
        sendSignatureCode: (_tenant: number, args: { connectionId: number; to: string; code: string; text: string; template: { name: string; language: string } | null }) => {
            sent.push({ via: 'whatsapp', connectionId: args.connectionId, to: args.to, text: args.text, code: args.code, template: args.template });
            if (failNext) {
                const error = failNext;
                failNext = null;
                return Promise.resolve({ ok: false as const, error });
            }
            return Promise.resolve({ ok: true as const, to: args.to.replace(/\D/g, '') });
        },
    };

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url);
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, act, new AutomationDispatcher(), new RelationsRepository());
        const env = loadEnv({ FILES_SIGNING_SECRET: 'test-secret', SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-sign-code-'))), env);
        const audit = new AuditService(tenantDb);
        docs = new DocumentsService(tenantDb, lists, fieldsSvc, recs, files, audit);
        svc = new SignaturesService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            files,
            docs,
            act,
            audit,
            redis as never,
            env,
            new MailService(env, new Mailbox()),
            new NotifyHub(),
            undefined,
            rt,
            undefined,
            undefined,
            fakeSms as unknown as SmsService,
            fakeWhatsapp as unknown as WhatsappService,
        );
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path d="M10 70 C 60 10, 110 90, 160 40" stroke="#111" stroke-width="5" fill="none"/></svg>');
        png = `data:image/png;base64,${(await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: svg }]).png().toBuffer()).toString('base64')}`;

        await pg.db.insert(users).values([{ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Gómez' }]);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', settings: { branding: { app_name: 'Acme SAS' } } }).returning();
        tenantId = t!.id;
        await pg.db.insert(memberships).values([{ tenantId, userId: 1, role: 'admin' }]);
        const mkConn = async (provider: string, name: string, visibility = 'workspace'): Promise<number> => {
            const [c] = await pg.db
                .insert(connections)
                .values({ tenantId, provider, name, visibility, ownerUserId: visibility === 'private' ? 1 : null, config: {} })
                .returning({ id: connections.id });
            return c!.id;
        };
        conn.sms = await mkConn('sms_twilio', 'Twilio de la empresa');
        conn.smsPrivate = await mkConn('sms_onurix', 'Onurix de Ana', 'private');
        conn.cloud = await mkConn('whatsapp_cloud', 'WhatsApp oficial');
        conn.web = await mkConn('whatsapp_web', 'Whats de ventas');
        conn.mail = await mkConn('http', 'API cualquiera');
        await pg.db.insert(whatsappTemplates).values([
            {
                tenantId,
                connectionId: conn.cloud,
                name: 'codigo_firma',
                language: 'es',
                category: 'AUTHENTICATION',
                status: 'APPROVED',
                components: [
                    { type: 'BODY', text: '*{{1}}* es tu código de verificación.' },
                    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }] },
                ],
            },
            {
                tenantId,
                connectionId: conn.cloud,
                name: 'promo_con_foto',
                language: 'es',
                category: 'MARKETING',
                status: 'APPROVED',
                components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hola {{1}}' }],
            },
            { tenantId, connectionId: conn.cloud, name: 'pendiente', language: 'es', category: 'UTILITY', status: 'PENDING', components: [{ type: 'BODY', text: '{{1}}' }] },
        ]);

        await lists.create(tenantId, { name: 'Contratos' });
        f = {};
        f.cliente = await fieldsSvc.create(tenantId, 'contratos', { label: 'Cliente', type: 'text', slug: 'cliente' });
        const starter = buildDocumentStarter('cuenta_cobro', { fields: { cliente: 'cliente' } }).design;
        const design: DocDesign = { ...starter, numbering: { ...starter.numbering, enabled: false } };
        templateId = (await docs.create(tenantId, admin.userId, 'contratos', { name: 'Contrato', filename: 'Contrato', design })).id;
        recordId = (await recs.create(tenantId, admin, 'contratos', { data: { [`f${f.cliente!.id}`]: 'Beta Ltda.' } })).id;
    }, 180_000);

    afterAll(async () => {
        await redis?.quit().catch(() => undefined);
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    const base = () => ({
        record_id: recordId,
        source: { kind: 'template' as const, template_id: templateId },
        title: '',
        order: 'parallel' as const,
        message: '',
        expires_days: 30,
        remind_days: 0,
        send_email: false,
        on_complete: { save_field_id: null, status_field_id: null, status_value: null, date_field_id: null },
    });

    it('las conexiones que pueden mandar el código: sólo las del equipo, y Meta con sus plantillas que sirven', async () => {
        const channels = await svc.codeChannels(tenantId);
        expect(channels.map((c) => [c.name, c.channel, c.needs_template]).sort()).toEqual([
            ['Twilio de la empresa', 'sms', false],
            ['Whats de ventas', 'whatsapp', false],
            ['WhatsApp oficial', 'whatsapp', true],
        ]);
        const cloud = channels.find((c) => c.id === conn.cloud)!;
        // Sólo aprobadas; las de Autenticación primero; la del encabezado con foto no sirve.
        expect(cloud.templates.map((t) => [t.name, t.usable])).toEqual([
            ['codigo_firma', true],
            ['promo_con_foto', false],
        ]);
        expect(cloud.templates[0]!.preview).toContain('*483921* es tu código');
        expect(cloud.templates[1]!.reason).toMatch(/archivo en el encabezado/);
    });

    it('pedir la firma valida la conexión, la plantilla y el celular de cada persona', async () => {
        const one = (phone: string) => [{ name: 'Carla', email: 'carla@cliente.co', role: '', phone }];
        await expect(svc.create(tenantId, admin, 'contratos', { ...base(), signers: one('300 111 2233'), verify: 'sms', verify_connection_id: null })).rejects.toMatchObject({
            response: { code: 'signature_code_connection' },
        });
        await expect(svc.create(tenantId, admin, 'contratos', { ...base(), signers: one(''), verify: 'sms', verify_connection_id: conn.sms })).rejects.toMatchObject({
            response: { code: 'signature_code_phone', message: expect.stringContaining('Carla') },
        });
        // Una conexión privada, otra de WhatsApp o una cualquiera: no.
        for (const id of [conn.smsPrivate, conn.web, conn.mail]) {
            await expect(svc.create(tenantId, admin, 'contratos', { ...base(), signers: one('3001112233'), verify: 'sms', verify_connection_id: id })).rejects.toMatchObject({
                response: { code: 'signature_code_connection' },
            });
        }
        // Meta: sin plantilla, con una pendiente o con una que no sirve.
        await expect(svc.create(tenantId, admin, 'contratos', { ...base(), signers: one('3001112233'), verify: 'whatsapp', verify_connection_id: conn.cloud })).rejects.toMatchObject({
            response: { code: 'signature_code_template' },
        });
        for (const name of ['pendiente', 'promo_con_foto', 'no_existe']) {
            await expect(
                svc.create(tenantId, admin, 'contratos', { ...base(), signers: one('3001112233'), verify: 'whatsapp', verify_connection_id: conn.cloud, verify_template: { name, language: 'es' } }),
            ).rejects.toMatchObject({ response: { code: 'signature_code_template' } });
        }
        expect(await pg.db.select().from(signatureRequests)).toHaveLength(0);
    });

    it('por SMS: el código llega al celular, no deja rastro en el registro y la constancia dice cómo se identificó', async () => {
        sent.length = 0;
        const dto = await svc.create(tenantId, admin, 'contratos', {
            ...base(),
            signers: [{ name: 'Carla Ruiz', email: 'carla@cliente.co', role: 'Cliente', phone: '+57 300 111 2233' }],
            verify: 'sms',
            verify_connection_id: conn.sms,
        });
        expect(dto).toMatchObject({ verify: 'sms', verify_connection_id: conn.sms, verify_connection_name: 'Twilio de la empresa' });
        expect(dto.signers[0]!.phone).toBe('+57 300 111 2233');
        const token = signatureTokenFor(svc, { tenantId, id: dto.id, linkVersion: 1 }, dto.signers[0]!.id);
        const view = await svc.publicView(token, ip);
        expect(view.verify).toBe('sms');
        expect(view.signer).toMatchObject({ phone_masked: '••• ••• 233', email_masked: 'ca***@cliente.co' });

        // Sin código no firma.
        await expect(svc.sign(token, { name: 'Carla Ruiz', kind: 'drawn', image: png, consent: true }, ip)).rejects.toMatchObject({ response: { code: 'signature_code_expired' } });
        const activityBefore = (await pg.db.select().from(activity)).length;
        const res = await svc.requestCode(token, ip);
        expect(res).toEqual({ sent: true, channel: 'sms', destination: '••• ••• 233', email_masked: '••• ••• 233', minutes: 10 });
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ via: 'sms', connectionId: conn.sms, to: '+57 300 111 2233', source: 'signature', target: { listId: null, recordId: null, userId: null } });
        expect(sent[0]!.text).toMatch(/^Acme SAS: tu código para firmar es \d{6}\. Vence en 10 minutos/);
        // El código no queda en la ficha.
        expect((await pg.db.select().from(activity)).length).toBe(activityBefore);

        const r = await svc.sign(token, { name: 'Carla Ruiz', kind: 'typed', image: png, consent: true, code: sent[0]!.code! }, ip);
        expect(r.status).toBe('completed');
        const [row] = await pg.db.select().from(signatureSigners).where(eq(signatureSigners.requestId, dto.id));
        expect(row).toMatchObject({ verifiedBy: 'sms', phone: '+57 300 111 2233' });
        expect(identificationText({ verifiedBy: 'sms', phone: row!.phone })).toBe('Código de 6 números enviado por SMS a su celular ••• ••• 233');
        expect(identificationText({ verifiedBy: 'whatsapp', phone: '3001112233' })).toBe('Código de 6 números enviado por WhatsApp a su celular ••• ••• 233');
        expect(identificationText({ verifiedBy: 'none' })).toBe('Enlace personal');
    });

    it('si el SMS no sale, no queda un código vivo y quien firma lee qué hacer (sin el motivo técnico)', async () => {
        sent.length = 0;
        const dto = await svc.create(tenantId, admin, 'contratos', {
            ...base(),
            signers: [{ name: 'Dora', email: 'dora@cliente.co', role: '', phone: '3109998877' }],
            verify: 'sms',
            verify_connection_id: conn.sms,
        });
        const token = signatureTokenFor(svc, { tenantId, id: dto.id, linkVersion: 1 }, dto.signers[0]!.id);
        failNext = 'Twilio no reconoce el Account SID o el Auth Token.';
        const err = await svc.requestCode(token, ip).catch((e: { status: number; response: { code: string; message: string } }) => e);
        expect(err).toMatchObject({ status: 503, response: { code: 'signature_code_channel' } });
        expect((err as { response: { message: string } }).response.message).toContain('••• ••• 877');
        expect((err as { response: { message: string } }).response.message).not.toContain('Twilio');
        // El código que alcanzó a generarse no sirve.
        await expect(svc.sign(token, { name: 'Dora', kind: 'typed', image: png, consent: true, code: sent[0]!.code! }, ip)).rejects.toMatchObject({
            response: { code: 'signature_code_expired' },
        });
    });

    it('por WhatsApp: Meta con la plantilla elegida y Whats con un mensaje de texto', async () => {
        sent.length = 0;
        const viaMeta = await svc.create(tenantId, admin, 'contratos', {
            ...base(),
            signers: [{ name: 'Eva', email: 'eva@cliente.co', role: '', phone: '3005550101' }],
            verify: 'whatsapp',
            verify_connection_id: conn.cloud,
            verify_template: { name: 'codigo_firma', language: 'es' },
        });
        const t1 = signatureTokenFor(svc, { tenantId, id: viaMeta.id, linkVersion: 1 }, viaMeta.signers[0]!.id);
        expect(await svc.requestCode(t1, ip)).toMatchObject({ channel: 'whatsapp', destination: '••• ••• 101' });
        expect(sent[0]).toMatchObject({ via: 'whatsapp', connectionId: conn.cloud, to: '3005550101', template: { name: 'codigo_firma', language: 'es' } });
        expect(sent[0]!.code).toMatch(/^\d{6}$/);
        await svc.sign(t1, { name: 'Eva', kind: 'typed', image: png, consent: true, code: sent[0]!.code! }, ip);

        const viaWhats = await svc.create(tenantId, admin, 'contratos', {
            ...base(),
            signers: [{ name: 'Fede', email: 'fede@cliente.co', role: '', phone: '3115550202' }],
            verify: 'whatsapp',
            verify_connection_id: conn.web,
        });
        expect(viaWhats.verify_connection_name).toBe('Whats de ventas');
        const t2 = signatureTokenFor(svc, { tenantId, id: viaWhats.id, linkVersion: 1 }, viaWhats.signers[0]!.id);
        await svc.requestCode(t2, ip);
        expect(sent[1]).toMatchObject({ via: 'whatsapp', connectionId: conn.web, template: null });
        expect(sent[1]!.text).toContain(`tu código para firmar es ${sent[1]!.code}`);
        // Borrar la conexión no rompe la solicitud: queda sin conexión y lo dice al pedir el código.
        await pg.db.delete(connections).where(eq(connections.id, conn.web));
        const [after] = await svc.listForRecord(tenantId, admin, 'contratos', recordId);
        expect(after).toBeDefined();
        await expect(svc.requestCode(t2, ip)).rejects.toMatchObject({ status: 503, response: { code: 'signature_code_channel' } });
    });

    it('una automatización que manda el código por una conexión la cuenta como «en uso»', () => {
        expect(connectionIdOfAction({ type: 'request_signature', config: { verify: 'sms', verify_connection_id: 7 } })).toBe(7);
        expect(connectionIdOfAction({ type: 'request_signature', config: { verify: 'whatsapp', verify_connection_id: '9' } })).toBe(9);
        // Con código por correo la conexión guardada no se usa.
        expect(connectionIdOfAction({ type: 'request_signature', config: { verify: 'email', verify_connection_id: 7 } })).toBeNull();
        expect(connectionIdOfAction({ type: 'call_webhook', config: { connection_id: 3 } })).toBe(3);
        expect(connectionIdOfAction({ type: 'update_field', config: { connection_id: 3 } })).toBeNull();
    });

    it('con código por correo todo sigue igual (el celular no se guarda)', async () => {
        const dto = await svc.create(tenantId, admin, 'contratos', {
            ...base(),
            signers: [{ name: 'Gina', email: 'gina@cliente.co', role: '', phone: '3000000000' }],
            verify: 'email',
            verify_connection_id: conn.sms,
        });
        expect(dto).toMatchObject({ verify: 'email', verify_connection_id: null });
        expect(dto.signers[0]!.phone).toBe('');
        const token = signatureTokenFor(svc, { tenantId, id: dto.id, linkVersion: 1 }, dto.signers[0]!.id);
        expect((await svc.publicView(token, ip)).signer.phone_masked).toBeNull();
        expect(await svc.requestCode(token, ip)).toMatchObject({ channel: 'email', destination: 'gi**@cliente.co' });
    });
});
