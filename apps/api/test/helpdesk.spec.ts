import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Field, HelpdeskSettings, SlaPolicy } from '@imagina-base/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { CommentsRepository } from '../src/comments/comments.repository';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import {
    automationRuns,
    automations,
    comments,
    helpdeskMailboxes,
    helpdeskMessages,
    helpdeskTickets,
    lists as listsTable,
    memberships,
    plans,
    records,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { HelpdeskConfigService } from '../src/helpdesk/helpdesk-config.service';
import { HelpdeskIngestService } from '../src/helpdesk/helpdesk-ingest.service';
import { HelpdeskReplyService } from '../src/helpdesk/helpdesk-reply.service';
import { HelpdeskSlaService } from '../src/helpdesk/helpdesk-sla.service';
import { HelpdeskQueue } from '../src/helpdesk/helpdesk.queue';
import { ImapFlowReader } from '../src/helpdesk/imap-reader';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { buildMime, startFakeImap, type FakeImapServer } from './helpers/fake-imap-server';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

interface Delivered {
    kind: string;
    users: number[];
    title: string;
}

/** Espera a que una condición se cumpla (los oyentes de los hubs corren sueltos). */
async function eventually<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > until) throw new Error('eventually: no se cumplió a tiempo');
        await new Promise((r) => setTimeout(r, 25));
    }
}

const SECRET = 'clave-de-test-32-bytes-o-lo-que-sea';
const SUPPORT = 'soporte@acme.test';
const PASS = 'clave123';

/**
 * D2 + E5 — Mesa de ayuda con Postgres, Redis y un servidor IMAP de verdad
 * (sockets, la librería IMAP real): buzón → tickets, respuestas por el hilo,
 * protecciones, responder desde la ficha, Problemas, límite del plan, SLA con
 * horas hábiles, alertas una sola vez, escalamiento y automatizaciones.
 */
describe('Mesa de ayuda (Postgres + Redis + IMAP reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let imap: FakeImapServer;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let config: HelpdeskConfigService;
    let sla: HelpdeskSlaService;
    let reply: HelpdeskReplyService;
    let ingest: HelpdeskIngestService;
    let notify: NotifyHub;
    let plansSvc: PlansService;
    const mail = new CapturingMail();
    const dispatcher = new CapturingDispatcher();
    const delivered: Delivered[] = [];
    const reports: IncidentReport[] = [];
    const resolved: string[] = [];
    let tenantId: number;
    let otherTenant: number;
    let ana: Actor;
    let juan: Actor;
    let f: Record<string, Field>;
    let listId: number;
    let mailboxId: number;
    const env = loadEnv({ SECRETS_KEY: SECRET, SMTP_ALLOW_PRIVATE_HOSTS: 'true', FILES_SIGNING_SECRET: 'hd-secret' });

    const settings = async (): Promise<HelpdeskSettings> => (await config.getSettings(tenantId, 'soporte')).settings;
    const ticketRows = async () =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.listId, listId), sql`${records.deletedAt} IS NULL`)).orderBy(asc(records.id)));
    const messageRows = async () => withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskMessages).where(eq(helpdeskMessages.listId, listId)).orderBy(asc(helpdeskMessages.id)));
    const ticketOf = async (recordId: number) =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskTickets).where(eq(helpdeskTickets.recordId, recordId))))[0]!;
    const commentsOf = async (recordId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(comments).where(eq(comments.recordId, recordId)).orderBy(asc(comments.id)));
    const key = (slug: string): string => `f${f[slug]!.id}`;
    const run = (): Promise<boolean> => ingest.run(tenantId, mailboxId);

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        imap = await startFakeImap({ user: SUPPORT, pass: PASS });
        // Un plan sin lugar para registros (el límite se prueba cambiando la empresa a él).
        await pg.db.insert(plans).values({ slug: 'tiny', name: 'Tiny', maxRecords: 0 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const changes = new RecordChangeHub();
        notify = new NotifyHub();
        const incidents = new IncidentHub();
        incidents.subscribe({
            report: (r) => void reports.push(r),
            resolve: (_t, k) => void resolved.push(k),
            resolvePrefix: (_t, p) => void resolved.push(`${p}*`),
        });
        plansSvc = new PlansService(pg.db);
        const emailQuota = new EmailQuotaService(pg.db, plansSvc);
        const billing = new BillingService(tenantDb, plansSvc, emailQuota, new TenantSmtpService(pg.db, env));
        const tz = new TenantTimeZones(tenantDb);
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activitySvc, dispatcher, new RelationsRepository(), undefined, changes, billing, tz, notify);
        const files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-helpdesk-'))), env);
        const queue = new HelpdeskQueue();
        config = new HelpdeskConfigService(tenantDb, env, lists, fieldsSvc, new AuditService(tenantDb), new ImapFlowReader(), queue, incidents);
        const notifications = {
            deliver: (_t: number, kind: string, userIds: number[], p: { title: string }) => {
                delivered.push({ kind, users: [...userIds].sort((a, b) => a - b), title: p.title });
                return Promise.resolve();
            },
        } as unknown as NotificationsService;
        sla = new HelpdeskSlaService(tenantDb, pg.db, lists, fieldsSvc, recs, activitySvc, rt, dispatcher, notifications, changes, notify, tz);
        sla.onModuleInit();
        const comms = new CommentsRepository();
        reply = new HelpdeskReplyService(tenantDb, lists, fieldsSvc, recs, comms, new MailService(env, mail), sla, rt, notify, tz);
        ingest = new HelpdeskIngestService(tenantDb, pg.db, redis as never, config, lists, fieldsSvc, recs, comms, files, billing, sla, dispatcher, rt, queue, notify, incidents, tz);

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'Acme', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        otherTenant = (await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra', plan: 'enterprise' }).returning())[0]!.id;
        const mk = async (email: string, name: string) => (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana Admin'), role: 'admin' };
        juan = { userId: await mk('juan@acme.test', 'Juan Jefe'), role: 'agent' };
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([ana, juan].map((a) => ({ tenantId, userId: a.userId, role: a.role }))),
        );

        listId = (await lists.create(tenantId, { name: 'Soporte', slug: 'soporte' })).id;
        f = {};
        const defs = [
            { label: 'Asunto', type: 'text', slug: 'asunto' },
            { label: 'Nombre', type: 'text', slug: 'nombre' },
            { label: 'Correo', type: 'email', slug: 'correo' },
            { label: 'Recibido', type: 'datetime', slug: 'recibido' },
            { label: 'Texto', type: 'long_text', slug: 'texto' },
            { label: 'Adjuntos', type: 'file', slug: 'adjuntos' },
            { label: 'Responsable', type: 'user', slug: 'responsable' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: {
                    options: [
                        { value: 'nuevo', label: 'Nuevo' },
                        { value: 'en_curso', label: 'En curso' },
                        { value: 'esperando', label: 'Esperando al cliente' },
                        { value: 'resuelto', label: 'Resuelto' },
                    ],
                },
            },
            {
                label: 'Prioridad',
                type: 'select',
                slug: 'prioridad',
                config: { options: [{ value: 'alta', label: 'Alta' }, { value: 'baja', label: 'Baja' }] },
            },
        ];
        for (const d of defs) f[d.slug] = await fieldsSvc.create(tenantId, 'soporte', d as never);
        await config.updateSettings(tenantId, ana.userId, 'soporte', {
            title_field_id: f.asunto!.id,
            from_name_field_id: f.nombre!.id,
            from_email_field_id: f.correo!.id,
            received_at_field_id: f.recibido!.id,
            body_text_field_id: f.texto!.id,
            attachments_field_id: f.adjuntos!.id,
            status_field_id: f.estado!.id,
            initial_status: 'nuevo',
            paused_statuses: ['esperando'],
            closed_statuses: ['resuelto'],
            reopen_status: 'en_curso',
            blocked_senders: ['@spam.test'],
            reply_templates: [{ id: 'gracias', name: 'Gracias', body: 'Hola {{cliente.nombre}}, ya lo revisamos ({{ticket.numero}}).' }],
            include_signature: false,
        });
    });

    afterAll(async () => {
        redis?.disconnect();
        await imap?.close();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(() => {
        dispatcher.events.length = 0;
        mail.sent.length = 0;
        delivered.length = 0;
        reports.length = 0;
        resolved.length = 0;
    });

    it('conectar el buzón: guard anti-SSRF, «Probar» con diagnóstico, contraseña cifrada y marca protegida en la lista', async () => {
        // Sin permiso para la red interna, 127.0.0.1 se rechaza (SEC-27).
        const strict = new HelpdeskConfigService(tenantDb, loadEnv({ SECRETS_KEY: SECRET }), lists, fieldsSvc, new AuditService(tenantDb), new ImapFlowReader(), new HelpdeskQueue());
        await expect(
            strict.saveMailbox(tenantId, ana.userId, 'soporte', {
                preset: 'generic',
                host: '127.0.0.1',
                port: imap.port,
                security: 'none',
                username: SUPPORT,
                password: PASS,
                folder: 'INBOX',
                support_address: SUPPORT,
                mark_seen: false,
                allow_invalid_cert: false,
                enabled: true,
            }),
        ).rejects.toMatchObject({ response: { code: 'invalid_helpdesk_settings' } });

        const base = { preset: 'generic' as const, host: '127.0.0.1', port: imap.port, security: 'none' as const, username: SUPPORT, folder: 'INBOX', allow_invalid_cert: false, mark_seen: false, enabled: true };
        const bad = await config.test(tenantId, 'soporte', { ...base, password: 'mala' });
        expect(bad.ok).toBe(false);
        expect(bad.step).toBe('auth');
        const missing = await config.test(tenantId, 'soporte', { ...base, password: PASS, folder: 'Ventas' });
        expect(missing.step).toBe('folder');
        expect(missing.folders).toContain('INBOX');
        const good = await config.test(tenantId, 'soporte', { ...base, password: PASS });
        expect(good.ok).toBe(true);

        const dto = await config.saveMailbox(tenantId, ana.userId, 'soporte', {
            ...base,
            password: PASS,
            support_address: SUPPORT,
            mark_seen: false,
            enabled: true,
        });
        mailboxId = dto.id;
        expect(dto.password_state).toBe('ok');
        expect(JSON.stringify(dto)).not.toContain(PASS);
        const [raw] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskMailboxes).where(eq(helpdeskMailboxes.id, mailboxId)));
        expect(raw!.passwordEnc).not.toContain(PASS);

        // La marca del buzón en la lista: una edición general de los ajustes no la cambia ni la borra.
        const l = await lists.get(tenantId, 'soporte');
        expect((l.settings.helpdesk as { mailbox: { id: number } }).mailbox.id).toBe(mailboxId);
        await lists.update(tenantId, 'soporte', { settings: { ...l.settings, helpdesk: { ...(l.settings.helpdesk as object), mailbox: { id: 999, support_address: 'otro@malo.test' } } } });
        const { settings: fixedSettings } = await lists.get(tenantId, 'soporte');
        expect((fixedSettings.helpdesk as { mailbox: { id: number; support_address: string } }).mailbox).toEqual({ id: mailboxId, support_address: SUPPORT });
        await lists.update(tenantId, 'soporte', { settings: { ...fixedSettings, helpdesk: undefined } });
        expect(((await lists.get(tenantId, 'soporte')).settings.helpdesk as { title_field_id: number }).title_field_id).toBe(f.asunto!.id);
    });

    it('el primer recorrido arranca DESDE AHORA; un correo nuevo crea el ticket con su asunto, remitente, texto, adjunto y descripción saneada', async () => {
        imap.append(buildMime({ from: 'Viejo <viejo@cliente.test>', to: SUPPORT, subject: 'Correo de antes', text: 'antes', messageId: 'viejo@cliente.test' }));
        expect(await run()).toBe(true);
        expect(await ticketRows()).toHaveLength(0);

        imap.append(
            buildMime({
                from: 'Ana Pérez <ana@cliente.test>',
                to: SUPPORT,
                subject: 'No me llega el pedido',
                text: 'Hola, no me llega el pedido 1234.',
                html: '<p>Hola, <b>no me llega</b> el pedido 1234.</p><script>alert(1)</script>',
                messageId: 'm1@cliente.test',
                attachments: [{ filename: 'captura.png', contentType: 'image/png', content: Buffer.from('89504e470d0a1a0a', 'hex') }],
            }),
        );
        await run();
        const rows = await ticketRows();
        expect(rows).toHaveLength(1);
        const t = rows[0]!;
        const data = t.data as Record<string, unknown>;
        expect(data[key('asunto')]).toBe('No me llega el pedido');
        expect(data[key('nombre')]).toBe('Ana Pérez');
        expect(data[key('correo')]).toBe('ana@cliente.test');
        expect(data[key('estado')]).toBe('nuevo');
        expect(String(data[key('texto')])).toContain('no me llega el pedido 1234');
        expect(typeof data[key('recibido')]).toBe('string');
        expect(data[key('adjuntos')]).toHaveLength(1);
        const desc = JSON.stringify(t.description);
        expect(desc).toContain('no me llega');
        expect(desc).toContain('bold');
        expect(desc).not.toContain('alert');
        const ticket = await ticketOf(t.id);
        expect(ticket.customerEmail).toBe('ana@cliente.test');
        expect(ticket.mailboxId).toBe(mailboxId);
        const ev = dispatcher.events.find((e) => e.trigger === 'email_received');
        expect(ev?.email).toMatchObject({ tipo: 'nuevo', de: 'ana@cliente.test', asunto: 'No me llega el pedido' });
        // Sólo lectura: EXAMINE, nunca SELECT ni STORE (no se marca ni se borra nada).
        expect(imap.commands.some((c) => c.startsWith('EXAMINE'))).toBe(true);
        expect(imap.commands.some((c) => c.includes('STORE') || c.startsWith('SELECT'))).toBe(false);
        // Volver a leer no duplica.
        await run();
        expect(await ticketRows()).toHaveLength(1);
    });

    it('respuestas del cliente: por In-Reply-To y por el número en el asunto; un extraño con el número abre otro ticket; automáticos y bucles se ignoran', async () => {
        const [first] = await ticketRows();
        const id = first!.id;
        imap.append(
            buildMime({
                from: 'Ana Pérez <ana@cliente.test>',
                to: SUPPORT,
                subject: 'Re: No me llega el pedido',
                text: 'Lo pedí el lunes.\n\nEl lun, 2 nov 2026 a las 10:00, Soporte <soporte@acme.test> escribió:\n> anterior',
                messageId: 'm2@cliente.test',
                inReplyTo: 'm1@cliente.test',
                references: ['m1@cliente.test'],
            }),
        );
        imap.append(buildMime({ from: 'ana@cliente.test', to: SUPPORT, subject: `Otra cosa [#${id}]`, text: 'Y además…', messageId: 'm3@cliente.test' }));
        imap.append(buildMime({ from: 'intruso@otro.test', to: SUPPORT, subject: `Hackeo [#${id}]`, text: 'meterme', messageId: 'm4@otro.test' }));
        imap.append(buildMime({ from: 'ana@cliente.test', to: SUPPORT, subject: 'Fuera de la oficina', text: 'vuelvo', messageId: 'm5@cliente.test', headers: { 'Auto-Submitted': 'auto-replied' } }));
        imap.append(buildMime({ from: SUPPORT, to: SUPPORT, subject: 'copia', text: 'eco', messageId: 'm6@acme.test' }));
        imap.append(buildMime({ from: 'MAILER-DAEMON@mx.cliente.test', to: SUPPORT, subject: 'Undelivered Mail', text: 'x', messageId: 'm7@mx.test' }));
        imap.append(buildMime({ from: 'promo@spam.test', to: SUPPORT, subject: 'Oferta', text: 'compra', messageId: 'm8@spam.test' }));
        await run();

        const rows = await ticketRows();
        expect(rows).toHaveLength(2); // el original + el del intruso
        const cs = await commentsOf(id);
        expect(cs).toHaveLength(2);
        expect(cs[0]!.body).toBe('Lo pedí el lunes.');
        expect(cs[0]!.kind).toBe('email');
        expect(cs[0]!.visibility).toBe('client');
        expect((cs[0]!.metadata as { email: { direction: string; from: string } }).email).toMatchObject({ direction: 'in', from: 'ana@cliente.test' });
        const msgs = await messageRows();
        const status = (mid: string) => msgs.find((m) => m.messageId === mid)?.status;
        expect(status('m2@cliente.test')).toBe('reply');
        expect(status('m3@cliente.test')).toBe('reply');
        expect(status('m4@otro.test')).toBe('ticket');
        expect(status('m5@cliente.test')).toBe('ignored');
        expect(status('m6@acme.test')).toBe('ignored');
        expect(status('m7@mx.test')).toBe('ignored');
        expect(status('m8@spam.test')).toBe('ignored');
        expect(msgs.find((m) => m.messageId === 'm8@spam.test')?.reason).toMatch(/bloqueado/);
        expect(dispatcher.events.filter((e) => e.trigger === 'email_received' && e.email?.tipo === 'respuesta')).toHaveLength(2);
    });

    it('responder desde la ficha: sale por el correo de la empresa con las cabeceras del hilo, queda como comentario y una nota interna no sale', async () => {
        const [first] = await ticketRows();
        const id = first!.id;
        const tpl = await reply.renderTemplate(tenantId, ana, 'soporte', id, 'gracias');
        expect(tpl.body).toBe(`Hola Ana Pérez, ya lo revisamos (#${id}).`);
        const res = await reply.reply(tenantId, ana, 'soporte', id, { body: tpl.body, set_status: 'esperando' });
        expect(res.ok).toBe(true);
        expect(mail.sent).toHaveLength(1);
        const m = mail.sent[0]!;
        expect(m.to).toBe('ana@cliente.test');
        expect(m.subject).toBe(`Re: No me llega el pedido [#${id}]`);
        expect(m.inReplyTo).toBe('m3@cliente.test');
        expect(m.references).toEqual(expect.arrayContaining(['m1@cliente.test', 'm2@cliente.test', 'm3@cliente.test']));
        expect(m.headers?.['X-Imagina-Helpdesk']).toBe('1');
        expect(m.replyTo).toBe(SUPPORT);
        const out = (await commentsOf(id)).at(-1)!;
        expect((out.metadata as { email: { direction: string } }).email.direction).toBe('out');
        expect(out.userId).toBe(ana.userId);
        const ticket = await ticketOf(id);
        expect(ticket.firstResponseAt).not.toBeNull();
        expect(((await ticketRows())[0]!.data as Record<string, unknown>)[key('estado')]).toBe('esperando');

        // Una nota INTERNA del equipo (otro ticket): ni sale por correo ni cuenta como respuesta.
        const second = (await ticketRows())[1]!.id;
        notify.emit({ type: 'comment', tenantId, listId, recordId: second, actorId: ana.userId, body: 'nota', mentioned: [], visibility: 'internal' });
        await new Promise((r) => setTimeout(r, 100));
        expect(mail.sent).toHaveLength(1);
        expect((await ticketOf(second)).firstResponseAt).toBeNull();

        // El cliente contesta a NUESTRO correo: se suma al mismo ticket y lo saca de «Esperando».
        imap.append(buildMime({ from: 'ana@cliente.test', to: SUPPORT, subject: m.subject, text: 'Ya llegó, gracias', messageId: 'm9@cliente.test', inReplyTo: m.messageId }));
        // Un eco de nuestro propio correo (copia en la bandeja) no crea nada.
        imap.append(buildMime({ from: SUPPORT, to: 'ana@cliente.test', subject: m.subject, text: 'eco', messageId: m.messageId! }));
        await run();
        expect((await commentsOf(id)).at(-1)!.body).toBe('Ya llegó, gracias');
        expect(((await ticketRows())[0]!.data as Record<string, unknown>)[key('estado')]).toBe('en_curso');
        expect(await ticketRows()).toHaveLength(2);
    });

    it('un buzón con la contraseña cambiada abre un Problema con el motivo; al arreglarla se resuelve', async () => {
        imap.setPassword('cambiada');
        await run();
        const report = reports.find((r) => r.key === `helpdesk:${mailboxId}`);
        expect(report?.title).toMatch(/No se puede leer el buzón/);
        expect(report?.message).toMatch(/usuario o la contraseña/);
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskMailboxes).where(eq(helpdeskMailboxes.id, mailboxId)));
        expect(String((row!.state as Record<string, unknown>).last_error)).toMatch(/contraseña/);
        imap.setPassword(PASS);
        await run();
        expect(resolved).toContain(`helpdesk:${mailboxId}`);
    });

    it('el límite del plan no pierde el correo: queda en el buzón (el cursor no avanza) y avisa; al subir el plan entra', async () => {
        const before = (await ticketRows()).length;
        const [mb] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskMailboxes).where(eq(helpdeskMailboxes.id, mailboxId)));
        const cursor = (mb!.state as { last_uid: number }).last_uid;
        await pg.db.update(tenants).set({ plan: 'tiny' }).where(eq(tenants.id, tenantId));
        imap.append(buildMime({ from: 'nuevo@cliente.test', to: SUPPORT, subject: 'Plan lleno', text: 'hola', messageId: 'm10@cliente.test' }));
        await run();
        expect(await ticketRows()).toHaveLength(before);
        const [after] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskMailboxes).where(eq(helpdeskMailboxes.id, mailboxId)));
        expect((after!.state as { last_uid: number }).last_uid).toBe(cursor);
        expect(String((after!.state as Record<string, unknown>).pending_reason)).toMatch(/límite de registros/);
        expect(reports.find((r) => r.key === `helpdesk:${mailboxId}:pending`)).toBeDefined();
        await pg.db.update(tenants).set({ plan: 'enterprise' }).where(eq(tenants.id, tenantId));
        await run();
        expect(await ticketRows()).toHaveLength(before + 1);
        expect(resolved).toContain(`helpdesk:${mailboxId}:pending`);
    });

    describe('SLA', () => {
        const policy = (over: Partial<SlaPolicy> = {}): Partial<SlaPolicy> => ({
            enabled: true,
            priority_field_id: f.prioridad!.id,
            targets: [
                { priority: 'alta', first_response_hours: 2, resolution_hours: 4 },
                { priority: null, first_response_hours: 8, resolution_hours: 40 },
            ],
            calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', holidays: 'co' },
            at_risk_percent: 75,
            notify_user_ids: [ana.userId],
            notify_roles: [],
            notify_team_ids: [],
            notify_assignee_field_id: null,
            escalate_user_ids: [juan.userId],
            escalate_roles: [],
            escalate_team_ids: [],
            escalate_set_field_id: f.responsable!.id,
            escalate_set_value: null,
            escalate_set_user_id: juan.userId,
            ...over,
        });

        let id: number;

        beforeAll(async () => {
            const s = await settings();
            await config.updateSettings(tenantId, ana.userId, 'soporte', { sla: { ...s.sla, ...policy() } as SlaPolicy });
            await config.createSlaColumns(tenantId, ana.userId, 'soporte');
            f = Object.fromEntries((await fieldsSvc.list(tenantId, 'soporte')).map((x) => [x.slug, x]));
        });

        it('vencimientos en horas hábiles (noche, fin de semana y festivo) en la zona de la empresa, guardados en las columnas', async () => {
            const created = await recs.create(tenantId, ana, 'soporte', { data: { [key('asunto')]: 'Caído', [key('prioridad')]: 'alta', [key('estado')]: 'nuevo' } });
            id = created.id;
            await eventually(async () => (await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskTickets).where(eq(helpdeskTickets.recordId, id))))[0]);
            // Viernes 30-oct-2026 17:00 en Bogotá. El lunes 2-nov es festivo.
            await withTenant(pg.db, tenantId, (tx) =>
                tx.update(helpdeskTickets).set({ startedAt: new Date('2026-10-30T22:00:00Z'), alerts: {}, firstResponseAt: null, resolvedAt: null, pauses: [] }).where(eq(helpdeskTickets.recordId, id)),
            );
            const dto = await sla.recompute(tenantId, id, { now: new Date('2026-10-30T22:30:00Z') });
            // 1 h el viernes + 1 h el martes 3-nov desde las 8:00 → 9:00 Bogotá (14:00Z).
            expect(dto?.first_response_due).toBe('2026-11-03T14:00:00.000Z');
            // 1 h el viernes + 3 h el martes → 11:00 Bogotá (16:00Z).
            expect(dto?.resolution_due).toBe('2026-11-03T16:00:00.000Z');
            expect(dto?.status).toBe('a_tiempo');
            const row = (await ticketRows()).find((r) => r.id === id)!;
            const data = row.data as Record<string, unknown>;
            const s = (await settings()).sla;
            expect(data[`f${s.first_due_field_id}`]).toBe('2026-11-03T14:00:00Z');
            expect(data[`f${s.sla_status_field_id}`]).toBe('a_tiempo');
        });

        it('«en riesgo» y «vencido» avisan UNA vez; al vencer escala (otra persona + pone al responsable)', async () => {
            await sla.recompute(tenantId, id, { now: new Date('2026-11-03T13:35:00Z') }); // 95 de 120 min
            expect(delivered.filter((d) => d.kind === 'sla')).toEqual([{ kind: 'sla', users: [ana.userId], title: expect.stringMatching(/en riesgo/) }]);
            expect(dispatcher.events.filter((e) => e.trigger === 'sla_alert').map((e) => e.sla)).toEqual([
                expect.objectContaining({ alerta: 'at_risk', objetivo: 'first_response', prioridad: 'Alta' }),
            ]);
            await sla.recompute(tenantId, id, { now: new Date('2026-11-03T13:40:00Z') });
            expect(delivered.filter((d) => d.kind === 'sla')).toHaveLength(1);

            await sla.recompute(tenantId, id, { now: new Date('2026-11-03T14:05:00Z') });
            const breached = delivered.filter((d) => d.kind === 'sla' && /Se venció/.test(d.title));
            expect(breached).toHaveLength(1);
            expect(breached[0]!.users).toEqual([ana.userId, juan.userId].sort((a, b) => a - b));
            const row = (await ticketRows()).find((r) => r.id === id)!;
            expect((row.data as Record<string, unknown>)[key('responsable')]).toBe(juan.userId);
            const s = (await settings()).sla;
            expect((row.data as Record<string, unknown>)[`f${s.sla_status_field_id}`]).toBe('vencido');
            await sla.recompute(tenantId, id, { now: new Date('2026-11-03T14:30:00Z') });
            expect(delivered.filter((d) => d.kind === 'sla' && /Se venció/.test(d.title))).toHaveLength(1);
        });

        it('una pausa («Esperando al cliente») detiene el reloj: el vencimiento se corre lo que duró', async () => {
            await withTenant(pg.db, tenantId, (tx) =>
                tx
                    .update(helpdeskTickets)
                    .set({ pauses: [{ from: '2026-11-03T13:00:00.000Z', to: '2026-11-03T14:00:00.000Z' }] })
                    .where(eq(helpdeskTickets.recordId, id)),
            );
            const dto = await sla.recompute(tenantId, id, { now: new Date('2026-11-03T14:10:00Z') });
            expect(dto?.resolution_due).toBe('2026-11-03T17:00:00.000Z');
            // Una pausa abierta: el reloj está detenido.
            await withTenant(pg.db, tenantId, (tx) =>
                tx.update(helpdeskTickets).set({ pauses: [{ from: '2026-11-03T14:30:00.000Z', to: null }] }).where(eq(helpdeskTickets.recordId, id)),
            );
            const paused = await sla.recompute(tenantId, id, { now: new Date('2026-11-03T15:00:00Z') });
            expect(paused?.paused).toBe(true);
            expect(paused?.resolution_due).toBeNull();
        });

        it('cerrar a tiempo deja «cumplido»; las columnas del SLA no se escriben a mano ni por el alta', async () => {
            const c = await recs.create(tenantId, ana, 'soporte', { data: { [key('asunto')]: 'Rápido', [key('prioridad')]: 'baja', [key('estado')]: 'nuevo' } });
            await eventually(async () => (await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskTickets).where(eq(helpdeskTickets.recordId, c.id))))[0]);
            await reply.reply(tenantId, ana, 'soporte', c.id, { body: 'Hola', to: 'cliente@x.test' });
            await recs.update(tenantId, ana, 'soporte', c.id, { data: { [key('estado')]: 'resuelto' } });
            const s = (await settings()).sla;
            const done = await eventually(async () => {
                const r = (await ticketRows()).find((x) => x.id === c.id)!;
                return (r.data as Record<string, unknown>)[`f${s.sla_status_field_id}`] === 'cumplido' ? r : null;
            });
            expect(done).toBeTruthy();
            await expect(recs.update(tenantId, ana, 'soporte', c.id, { data: { [`f${s.sla_status_field_id}`]: 'a_tiempo' } })).rejects.toMatchObject({
                response: { code: 'helpdesk_field_locked' },
            });
            const x = await recs.create(tenantId, ana, 'soporte', { data: { [key('asunto')]: 'Trampa', [`f${s.resolution_due_field_id}`]: '2099-01-01T00:00:00Z' } });
            expect((x.data as Record<string, unknown>)[`f${s.resolution_due_field_id}`]).not.toBe('2099-01-01T00:00:00Z');
        });
    });

    describe('Automatizaciones', () => {
        let engine: AutomationEngine;
        let recordId: number;

        beforeAll(async () => {
            const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
            const moduleRef = { get: (cls: unknown) => (cls === RecordsService ? recs : cls === HelpdeskReplyService ? reply : null) };
            engine = new AutomationEngine(
                tenantDb,
                new AutomationsRepository(),
                new FieldsRepository(),
                new RecordsRepository(),
                new RelationsRepository(),
                new MailService(env, mail),
                connectors,
                undefined,
                dispatcher,
                undefined,
                undefined,
                new TenantTimeZones(tenantDb),
                undefined,
                undefined,
                moduleRef as never,
            );
            recordId = (await ticketRows())[1]!.id;
        });

        const addAuto = async (triggerType: string, triggerConfig: Record<string, unknown>, body: string): Promise<number> => {
            const [a] = await withTenant(pg.db, tenantId, (tx) =>
                tx
                    .insert(automations)
                    .values({
                        tenantId,
                        listId,
                        name: `Auto ${triggerType}`,
                        triggerType,
                        triggerConfig,
                        actions: [{ type: 'reply_email', config: { body } }],
                        isActive: true,
                    })
                    .returning(),
            );
            return a!.id;
        };

        it('«Cuando llega un correo» (sólo nuevos) + «Responder por correo al hilo»: variables del correo y del ticket, marcado como automático', async () => {
            const autoId = await addAuto('email_received', { email_kind: 'new' }, 'Hola {{correo.nombre}}, recibimos «{{correo.asunto}}» ({{ticket.numero}}).');
            const ticketBefore = await ticketOf(recordId);
            await engine.process({
                tenantId,
                listId,
                recordId,
                trigger: 'email_received',
                after: {},
                email: { tipo: 'respuesta', de: 'intruso@otro.test', nombre: 'Intruso', asunto: 'Hackeo', texto: 'x', message_id: null },
            });
            expect(mail.sent).toHaveLength(0);
            await engine.process({
                tenantId,
                listId,
                recordId,
                trigger: 'email_received',
                after: {},
                email: { tipo: 'nuevo', de: 'intruso@otro.test', nombre: 'Intruso', asunto: 'Hackeo', texto: 'x', message_id: null },
            });
            expect(mail.sent).toHaveLength(1);
            expect(mail.sent[0]!.text).toBe(`Hola Intruso, recibimos «Hackeo» (#${recordId}).`);
            expect(mail.sent[0]!.headers?.['Auto-Submitted']).toBe('auto-generated');
            expect(mail.sent[0]!.to).toBe('intruso@otro.test');
            // Un acuse automático no es la primera respuesta del SLA.
            expect((await ticketOf(recordId)).firstResponseAt).toEqual(ticketBefore.firstResponseAt);
            const runs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, autoId)));
            expect(runs.at(-1)!.status).toBe('success');
        });

        it('«Cuando un SLA está en riesgo o se vence» filtra por alerta y arma {{sla.*}} legible', async () => {
            await withTenant(pg.db, tenantId, (tx) => tx.delete(automations).where(eq(automations.tenantId, tenantId)));
            await addAuto('sla_alert', { sla_alerts: ['breached'] }, 'Se venció la {{sla.objetivo}} ({{sla.vence}}), prioridad {{sla.prioridad}}.');
            const sla0 = { objetivo: 'resolution' as const, vence: '2026-11-03T16:00:00.000Z', prioridad: 'Alta', estado: 'vencido' as const };
            await engine.process({ tenantId, listId, recordId, trigger: 'sla_alert', after: {}, sla: { ...sla0, alerta: 'at_risk' } });
            expect(mail.sent).toHaveLength(0);
            await engine.process({ tenantId, listId, recordId, trigger: 'sla_alert', after: {}, sla: { ...sla0, alerta: 'breached' } });
            expect(mail.sent).toHaveLength(1);
            // 16:00Z es 11:00 en Bogotá (formato regional por defecto de la empresa).
            expect(mail.sent[0]!.text).toMatch(/^Se venció la resolución \(2026-11-03 11:00\), prioridad Alta\.$/);
        });
    });

    it('RLS: los buzones, correos y tickets de una empresa no los ve otra', async () => {
        const seen = await withTenant(pg.db, otherTenant, async (tx) => ({
            mailboxes: await tx.select().from(helpdeskMailboxes),
            messages: await tx.select().from(helpdeskMessages),
            tickets: await tx.select().from(helpdeskTickets),
        }));
        expect(seen.mailboxes).toHaveLength(0);
        expect(seen.messages).toHaveLength(0);
        expect(seen.tickets).toHaveLength(0);
        await expect(
            withTenant(pg.db, otherTenant, (tx) =>
                tx.insert(helpdeskMessages).values({ tenantId, listId, direction: 'in', status: 'ignored' }),
            ),
        ).rejects.toThrow();
        const own = await withTenant(pg.db, tenantId, (tx) => tx.select().from(helpdeskTickets));
        expect(own.length).toBeGreaterThan(0);
        // La lista de otra empresa tampoco: no se puede apuntar un ticket a ella.
        const [l] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(listsTable).where(eq(listsTable.id, listId)));
        expect(l).toBeDefined();
    });
});
