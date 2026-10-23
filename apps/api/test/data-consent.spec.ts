import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_DATA_CONSENT_TEMPLATE, formConfigSchema, newFormItemId, readDataConsentConfig, type Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
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
import { renderWithdrawLanding } from '../src/data-consent/consent-page';
import { consentTextHash, DataConsentService, mergeConfig } from '../src/data-consent/data-consent.service';
import {
    dataConsents,
    dataConsentVersions,
    formPendingSubmissions,
    forms,
    memberships,
    notifications,
    portalLinks,
    records,
    tenants,
    users,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DomainsService } from '../src/domains/domains.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { formConfirmEmail, formCopyEmail } from '../src/forms/form-email';
import { FormsService } from '../src/forms/forms.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PortalService } from '../src/portal/portal.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * Autorización de tratamiento de datos personales (Ley 1581 de 2012): el texto
 * de la empresa con sus versiones, la casilla obligatoria en los formularios
 * (también con la confirmación por correo), el portal que no se usa sin
 * aceptarla, la evidencia y el retiro desde el enlace firmado o el portal.
 */

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

const IP = '203.0.113.77';
const UA = 'Mozilla/5.0 (prueba) Chrome/130';
const RESPONSIBLE = {
    name: 'Acme S.A.S.',
    id_number: '900.123.456-7',
    address: 'Calle 10 # 5-20',
    city: 'Bogotá',
    email: 'datos@acme.test',
    phone: '+57 601 555 0000',
};

describe('autorización de datos (puro)', () => {
    it('la huella cambia si cambia cualquier parte de lo aceptado', () => {
        const a = consentTextHash({ label: 'Acepto', text: 'Texto', policy_url: null });
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(consentTextHash({ label: 'Acepto', text: 'Texto', policy_url: null })).toBe(a);
        expect(consentTextHash({ label: 'Acepto.', text: 'Texto', policy_url: null })).not.toBe(a);
        expect(consentTextHash({ label: 'Acepto', text: 'Texto', policy_url: 'https://x.test' })).not.toBe(a);
    });

    it('guardar la plantilla sugerida tal cual vuelve a «sugerida» (recibe sus mejoras)', () => {
        const cur = readDataConsentConfig({});
        expect(mergeConfig(cur, { template: `${DEFAULT_DATA_CONSENT_TEMPLATE}\n` }).template).toBeNull();
        expect(mergeConfig(cur, { template: 'Mi texto {{empresa}}' }).template).toBe('Mi texto {{empresa}}');
        expect(mergeConfig(cur, { purposes: ['  Una  ', '', '   '] }).purposes).toEqual(['Una']);
    });

    it('correos y página del enlace de retiro: todo escapado y sin retirar nada con un GET', () => {
        const brand = { name: 'Acme', color: '#0e7490', logoUrl: null };
        const c = formConfirmEmail(brand, 'https://x.test/confirm/t', { formTitle: 'F', withdrawUrl: 'https://x.test/api/v1/public/consent/withdraw/1.ref.sig' });
        expect(c.html).toContain('href="https://x.test/api/v1/public/consent/withdraw/1.ref.sig"');
        expect(c.text).toContain('retirarla en cualquier momento');
        const copy = formCopyEmail(brand, { formTitle: 'F', answers: [], withdrawUrl: 'https://x.test/w"><script>' });
        expect(copy.html).toContain('https://x.test/w&quot;&gt;&lt;script&gt;');
        expect(copy.html).not.toContain('"><script>');
        expect(formCopyEmail(brand, { formTitle: 'F', answers: [] }).html).not.toContain('retirarla');
        const page = renderWithdrawLanding(
            {
                kind: 'consent',
                brand: { company: 'Acme', accent: '#0e7490', logoUrl: null },
                company: 'Acme <b>',
                acceptedAt: '22/10/2026 10:00',
                sourceLabel: 'Formulario «<img>»',
                version: 2,
                text: 'Texto <script>alert(1)</script>',
                withdrawnAt: null,
                contactEmail: 'datos@acme.test',
            },
            '/api/v1/public/consent/withdraw/abc',
        );
        expect(page).toContain('<form method="post" action="/api/v1/public/consent/withdraw/abc">');
        expect(page).toContain('Acme &lt;b&gt;');
        expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(page).not.toContain('<script>alert');
        // La página de llegada NO se envía sola: retirar es decisión de la persona.
        expect(page).not.toContain('<script');
    });
});

describe('autorización de datos (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let files: FilesService;
    let consents: DataConsentService;
    let svc: FormsService;
    let portal: PortalService;
    let mailbox: CapturingMailTransport;
    let tenantId: number;
    let otherTenant: number;
    let adminId: number;
    let listId: number;
    let f: Record<string, Field>;

    const stampOf = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    const consentRows = () => withTenant(pg.db, tenantId, (tx) => tx.select().from(dataConsents).orderBy(dataConsents.id));
    const withdrawTokenOf = (m: MailMessage): string => /\/consent\/withdraw\/([0-9]+\.[A-Za-z0-9_-]+\.[0-9a-f]{64})/.exec(m.text ?? '')![1]!;
    const confirmTokenOf = (m: MailMessage): string => /\/f\/confirm\/([A-Za-z0-9_-]+)/.exec(m.text ?? '')![1]!;
    /** El último correo de confirmación que le llegó a esa dirección. */
    const confirmMailTo = (email: string): MailMessage =>
        mailbox.sent.filter((m) => m.to === email && m.subject.startsWith('Confirma tu respuesta')).at(-1)!;

    async function makeForm(settings: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
        const dto = await svc.create(tenantId, adminId, 'contactos', {
            name: 'Contacto',
            config: formConfigSchema.parse({
                items: [
                    { id: newFormItemId(), type: 'field', field_id: f.nombre!.id, required: true },
                    { id: newFormItemId(), type: 'field', field_id: f.correo!.id },
                ],
                settings: { title: 'Escríbenos', respondent_email_field_id: f.correo!.id, ...settings },
            }),
        });
        await svc.update(tenantId, 'contactos', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, new AutomationDispatcher(), new RelationsRepository());
        const env = loadEnv({
            REDIS_URL: rd.url,
            FILES_SIGNING_SECRET: 'consent-secret',
            SECRETS_KEY: 'clave-de-test-para-consent-32b',
            APP_BASE_URL: 'https://app.test',
        });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-consent-'))), env);
        mailbox = new CapturingMailTransport();
        const mail = new MailService(env, mailbox);
        const notifs = new NotificationsService(pg.db, tenantDb, lists, fieldsSvc, recs, rt, { enqueue: () => Promise.resolve() } as never, redis as never, env);
        consents = new DataConsentService(pg.db, tenantDb, files, new AuditService(tenantDb), notifs);
        svc = new FormsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            files,
            redis as never,
            new AutomationDispatcher(),
            env,
            undefined,
            undefined,
            undefined,
            undefined,
            mail,
            consents,
        );
        const domains = new DomainsService(pg.db, env, files);
        domains.probeServing = () => Promise.resolve(false);
        portal = new PortalService(
            pg.db,
            redis as never,
            env,
            tenantDb,
            lists,
            new SessionService(redis as never, env),
            mail,
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
                recs,
                new DashboardsService(tenantDb, new AggregateService(tenantDb, lists, fieldsSvc), recs, fieldsSvc),
            ),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            consents,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme-ley', name: 'Acme' }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otra-ley', name: 'Otra' }).returning();
        otherTenant = o!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@acme-ley.test', passwordHash: 'x', name: 'Admin Acme' }).returning();
        adminId = a!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        listId = (await lists.create(tenantId, { name: 'Contactos' })).id;
        f = {};
        f.nombre = await fieldsSvc.create(tenantId, 'contactos', { label: 'Nombre', type: 'text', slug: 'nombre' });
        f.correo = await fieldsSvc.create(tenantId, 'contactos', { label: 'Correo', type: 'email', slug: 'correo' });
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        mailbox.sent.length = 0;
        await redis.flushall();
    });

    it('el texto: no se activa incompleto; cada cambio del texto armado es una versión nueva', async () => {
        const fresh = await consents.state(tenantId);
        expect(fresh.active).toBe(false);
        expect(fresh.missing).toEqual(['Correo para ejercer los derechos', 'Teléfono del responsable']);
        expect(fresh.preview.text).toContain('a Acme, en su calidad de responsable');
        await expect(consents.update(tenantId, adminId, { enabled: true })).rejects.toMatchObject({
            response: { code: 'data_consent_incomplete', data: { missing: ['Correo para ejercer los derechos', 'Teléfono del responsable'] } },
        });
        // Completo: versión 1.
        const one = await consents.update(tenantId, adminId, { enabled: true, responsible: RESPONSIBLE, policy_url: 'https://acme.test/privacidad' });
        expect(one.newVersion).toBe(1);
        expect(one.state.active).toBe(true);
        expect(one.state.current).toMatchObject({ version: 1, policy_url: 'https://acme.test/privacidad', created_by_name: 'Admin Acme' });
        expect(one.state.current!.text).toContain('- NIT: 900.123.456-7');
        expect(one.state.current!.text_hash).toBe(consentTextHash({ label: one.state.current!.checkbox_label, text: one.state.current!.text, policy_url: 'https://acme.test/privacidad' }));
        // Guardar sin cambiar el texto (sólo el portal) NO crea otra versión.
        const same = await consents.update(tenantId, adminId, { ask_in_portal: true, responsible: RESPONSIBLE });
        expect(same.newVersion).toBeNull();
        // Cambiar las finalidades sí.
        const two = await consents.update(tenantId, adminId, {
            purposes: ['Atender mi solicitud.', 'Enviarme novedades de {{empresa}}.'],
        });
        expect(two.newVersion).toBe(2);
        expect(two.state.current!.text).toContain('- Enviarme novedades de Acme S.A.S..');
        expect(two.state.versions.map((v) => v.version)).toEqual([2, 1]);
        expect((await consents.version(tenantId, 1)).text).toContain('Atender mi solicitud y gestionar la relación');
        // RLS: otra empresa no ve las versiones.
        expect(await withTenant(pg.db, otherTenant, (tx) => tx.select().from(dataConsentVersions))).toEqual([]);
    });

    it('formulario: sin la casilla no se recibe; con ella queda la evidencia atada al registro', async () => {
        const { id, token } = await makeForm({ send_copy: true });
        const meta = await svc.meta(token);
        expect(meta.data_consent).toMatchObject({ version: 2 });
        expect(meta.data_consent!.text).toContain('Ley 1581 de 2012');
        expect(meta.data_consent!.label).toContain('Acme S.A.S.');

        // El servidor no le cree al navegador: sin `consent` → 400 y nada guardado.
        await expect(
            svc.submit(token, IP, { values: { [f.nombre!.id]: 'Ana', [f.correo!.id]: 'ana@cliente.test' }, uploads: {}, stamp: stampOf(id) }),
        ).rejects.toMatchObject({ response: { code: 'form_invalid', data: { errors: { __consent: expect.stringContaining('acepta la autorización') } } } });
        expect(await consentRows()).toHaveLength(0);
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)))).toHaveLength(0);

        await svc.submit(
            token,
            IP,
            { values: { [f.nombre!.id]: 'Ana Pérez', [f.correo!.id]: 'ana@cliente.test' }, uploads: {}, stamp: stampOf(id), consent: true, consent_version: 2 },
            { userAgent: UA },
        );
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        const [c] = await consentRows();
        expect(c).toMatchObject({
            version: 2,
            source: 'form',
            sourceLabel: 'Formulario «Escríbenos»',
            formId: id,
            listId,
            recordId: rec!.id,
            subjectEmail: 'ana@cliente.test',
            subjectName: 'Ana Pérez',
            ip: IP,
            userAgent: UA,
            withdrawnAt: null,
        });
        const [v2] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(dataConsentVersions).where(and(eq(dataConsentVersions.tenantId, tenantId), eq(dataConsentVersions.version, 2))),
        );
        expect(c!.textHash).toBe(v2!.textHash);
        expect(c!.withdrawRef).toMatch(/^[A-Za-z0-9_-]{16,40}$/);
        // La copia de sus respuestas lleva el enlace para retirarla.
        await new Promise((r) => setTimeout(r, 50));
        const copy = mailbox.sent.find((m) => m.subject.startsWith('Copia de tu respuesta'));
        expect(copy?.text).toContain('/api/v1/public/consent/withdraw/');

        // La ficha la ve (sin IP ni navegador).
        const line = await consents.forRecord(tenantId, rec!.id);
        expect(line).toEqual([
            expect.objectContaining({ version: 2, source: 'form', source_label: 'Formulario «Escríbenos»', subject_email: 'ana@cliente.test', withdrawn_at: null }),
        ]);
        expect(JSON.stringify(line)).not.toContain(IP);

        // La página se cargó con la versión 1 (antes del cambio): se registra la que VIO.
        await svc.submit(
            token,
            IP,
            { values: { [f.nombre!.id]: 'Beto' }, uploads: {}, stamp: stampOf(id), consent: true, consent_version: 1 },
        );
        expect((await consentRows()).at(-1)).toMatchObject({ version: 1, subjectName: 'Beto', subjectEmail: null, withdrawRef: null });
        // Una versión que no existe en la empresa se registra como la vigente.
        await svc.submit(token, IP, { values: { [f.nombre!.id]: 'Caro' }, uploads: {}, stamp: stampOf(id), consent: true, consent_version: 99 });
        expect((await consentRows()).at(-1)).toMatchObject({ version: 2, subjectName: 'Caro' });

        // Un formulario que la apaga no la pide.
        const off = await makeForm({ data_consent: false });
        expect((await svc.meta(off.token)).data_consent).toBeNull();
        await svc.submit(off.token, IP, { values: { [f.nombre!.id]: 'Sin casilla' }, uploads: {}, stamp: stampOf(off.id) });
        expect((await consentRows()).map((r) => r.subjectName)).not.toContain('Sin casilla');

        // RLS: otra empresa no ve la evidencia.
        expect(await withTenant(pg.db, otherTenant, (tx) => tx.select().from(dataConsents))).toEqual([]);
    });

    it('enlace de retiro: el GET no cambia nada, el POST la retira, avisa a los admins y no borra datos', async () => {
        const [c] = (await consentRows()).filter((r) => r.withdrawRef !== null);
        const token = withdrawTokenOf({ text: consents.withdrawUrl('https://app.test', tenantId, c!.withdrawRef!) } as MailMessage);
        const landing = await consents.peekWithdraw(token);
        expect(landing).toMatchObject({ kind: 'consent', company: 'Acme S.A.S.', sourceLabel: 'Formulario «Escríbenos»', version: 2, withdrawnAt: null, contactEmail: 'datos@acme.test' });
        expect((await consentRows()).find((r) => r.id === c!.id)!.withdrawnAt).toBeNull();

        // Firma alterada, otra empresa con la misma referencia, o basura: inválido (404 opaco).
        const [tid, ref, sig] = token.split('.');
        const flipped = `${tid}.${ref}.${sig!.slice(0, -1)}${sig!.endsWith('0') ? '1' : '0'}`;
        expect(await consents.peekWithdraw(flipped)).toBeNull();
        expect(await consents.peekWithdraw(`${otherTenant}.${ref}.${files.signParts('consentwithdraw', otherTenant, ref!)}`)).toBeNull();
        expect(await consents.peekWithdraw('cualquier-cosa')).toBeNull();

        const out = await consents.withdrawByToken(token, { ip: '198.51.100.9', userAgent: 'Safari' }, () => Promise.resolve());
        expect(out.status).toBe('withdrawn');
        const after = (await consentRows()).find((r) => r.id === c!.id)!;
        expect(after).toMatchObject({ withdrawnVia: 'link', withdrawnIp: '198.51.100.9', withdrawnUserAgent: 'Safari' });
        expect(after.withdrawnAt).toBeInstanceOf(Date);
        // El registro sigue ahí (retirar no borra datos).
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, after.recordId!)))).toHaveLength(1);
        // Los admins se enteran por la campana, con el registro.
        const bell = await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.kind, 'consent')));
        expect(bell).toEqual([expect.objectContaining({ userId: adminId, recordId: after.recordId, title: 'Ana Pérez retiró su autorización para el tratamiento de datos personales' })]);
        // Otra vez: «ya la habías retirado», sin otro aviso.
        expect((await consents.withdrawByToken(token, { ip: null, userAgent: null }, () => Promise.resolve())).status).toBe('already');
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.kind, 'consent')))).toHaveLength(1);
        // La ficha lo muestra.
        expect((await consents.forRecord(tenantId, after.recordId!))[0]).toMatchObject({ withdrawn_via: 'link' });
    });

    it('confirmación por correo: se registra al confirmar con los datos del envío; retirarla antes descarta la respuesta', async () => {
        const { id, token } = await makeForm({ confirm_email: true, send_copy: true });
        const before = (await consentRows()).length;
        const sentAt = Date.now();
        await svc.submit(
            token,
            IP,
            { values: { [f.nombre!.id]: 'Dora', [f.correo!.id]: 'dora@cliente.test' }, uploads: {}, stamp: stampOf(id), consent: true, consent_version: 2 },
            { userAgent: UA },
        );
        // Todavía no hay evidencia: espera con la respuesta.
        expect((await consentRows()).length).toBe(before);
        const [pending] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions).where(eq(formPendingSubmissions.formId, id)));
        expect(pending!.consent).toMatchObject({ version: 2, ip: IP, user_agent: UA });
        const mail = confirmMailTo('dora@cliente.test');
        expect(mail.subject).toContain('Confirma tu respuesta');
        const withdraw = withdrawTokenOf(mail);

        await new Promise((r) => setTimeout(r, 30));
        const outcome = await svc.confirm(confirmTokenOf(mail));
        expect(outcome.status).toBe('confirmed');
        const c = (await consentRows()).at(-1)!;
        expect(c).toMatchObject({ version: 2, subjectEmail: 'dora@cliente.test', ip: IP, userAgent: UA, withdrawRef: pending!.consent!.withdraw_ref });
        // Aceptada cuando ENVIÓ (no cuando confirmó).
        expect(Math.abs(c.acceptedAt.getTime() - sentAt)).toBeLessThan(2000);
        expect(c.createdAt.getTime()).toBeGreaterThanOrEqual(c.acceptedAt.getTime());
        // El enlace del correo de confirmación ya sirve para retirarla.
        expect((await consents.peekWithdraw(withdraw))?.kind).toBe('consent');

        // Retirarla ANTES de confirmar: la respuesta se descarta (sin datos).
        await svc.submit(
            token,
            IP,
            { values: { [f.nombre!.id]: 'Eva', [f.correo!.id]: 'eva@cliente.test' }, uploads: {}, stamp: stampOf(id), consent: true },
        );
        const evaMail = confirmMailTo('eva@cliente.test');
        const evaWithdraw = withdrawTokenOf(evaMail);
        expect((await consents.peekWithdraw(evaWithdraw))?.kind).toBe('pending');
        const res = await consents.withdrawByToken(evaWithdraw, { ip: null, userAgent: null }, (t, p) => svc.discardPending(t, p));
        expect(res.status).toBe('discarded');
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions).where(eq(formPendingSubmissions.email, 'eva@cliente.test')))).toEqual([]);
        expect((await svc.confirm(confirmTokenOf(evaMail))).status).toBe('invalid');
        expect((await consentRows()).map((r) => r.subjectEmail)).not.toContain('eva@cliente.test');
    });

    it('portal: sin aceptar la versión vigente no se usa; un cambio del texto la vuelve a pedir; retirarla bloquea y avisa', async () => {
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)).limit(1));
        const [u] = await pg.db.insert(users).values({ email: 'Ana@Cliente.test', passwordHash: 'x', name: 'Ana Pérez' }).returning();
        const clientId = u!.id;
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.insert(memberships).values({ userId: clientId, tenantId, role: 'client' });
            await tx.insert(portalLinks).values({ userId: clientId, tenantId, listId, recordId: rec!.id });
        });
        const actor = { userId: clientId, tenantId };

        await expect(portal.me(actor)).rejects.toMatchObject({ response: { code: 'consent_required', data: { consent_status: 'required' } } });
        // Todo lo del portal queda bloqueado, no sólo el arranque.
        await expect(portal.myComments(actor)).rejects.toMatchObject({ response: { code: 'consent_required' } });
        const st = await portal.consentStatus(actor);
        expect(st).toMatchObject({ status: 'required', consent: { version: 2 }, company: 'Acme' });

        await expect(portal.acceptConsent(actor, 1, { ip: IP, userAgent: UA })).rejects.toMatchObject({ response: { code: 'consent_outdated' } });
        const ok = await portal.acceptConsent(actor, 2, { ip: IP, userAgent: UA });
        expect(ok).toMatchObject({ status: 'accepted', accepted_version: 2 });
        const boot = await portal.me(actor);
        expect(boot.data_consent).toMatchObject({ version: 2 });
        expect((await consentRows()).at(-1)).toMatchObject({ source: 'portal', sourceLabel: 'Portal del cliente', userId: clientId, recordId: rec!.id, ip: IP });
        // Aceptarla otra vez no duplica la evidencia.
        const n = (await consentRows()).length;
        await portal.acceptConsent(actor, 2, { ip: IP, userAgent: UA });
        expect((await consentRows()).length).toBe(n);

        // La empresa cambia el texto (versión 3): se vuelve a pedir.
        await consents.update(tenantId, adminId, { purposes: ['Atender mi solicitud.'] });
        await expect(portal.me(actor)).rejects.toMatchObject({ response: { data: { consent_status: 'outdated' } } });
        await portal.acceptConsent(actor, 3, { ip: IP, userAgent: UA });
        expect((await portal.me(actor)).data_consent?.version).toBe(3);

        // La ficha del registro muestra la del portal (y la del formulario que lo creó).
        const line = await consents.forRecord(tenantId, rec!.id);
        expect(line.map((l) => l.source)).toContain('portal');

        // Retirar desde el portal: las del portal y las de formularios con SU
        // correo (es el titular, con su sesión).
        const again = await makeForm();
        await svc.submit(again.token, IP, { values: { [f.nombre!.id]: 'Ana P.', [f.correo!.id]: 'ANA@cliente.test' }, uploads: {}, stamp: stampOf(again.id), consent: true });
        const formByEmail = (await consentRows()).filter((r) => r.source === 'form' && r.subjectName === 'Ana P.' && r.withdrawnAt === null);
        expect(formByEmail).toHaveLength(1);
        const bellBefore = (await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.kind, 'consent')))).length;
        const w = await portal.withdrawConsent(actor, { ip: '198.51.100.20', userAgent: 'Firefox' });
        expect(w.status).toBe('withdrawn');
        const mine = (await consentRows()).filter((r) => r.userId === clientId || r.subjectEmail?.toLowerCase() === 'ana@cliente.test');
        expect(mine.every((r) => r.withdrawnAt !== null)).toBe(true);
        expect(mine.filter((r) => r.withdrawnVia === 'portal').length).toBeGreaterThan(1);
        expect(mine.find((r) => r.id === formByEmail[0]!.id)).toMatchObject({ withdrawnVia: 'portal', withdrawnIp: '198.51.100.20' });
        await expect(portal.me(actor)).rejects.toMatchObject({ response: { data: { consent_status: 'withdrawn' } } });
        expect((await withTenant(pg.db, tenantId, (tx) => tx.select().from(notifications).where(eq(notifications.kind, 'consent')))).length).toBeGreaterThan(bellBefore);

        // Si la empresa no la pide en el portal, el portal anda sin ella.
        await consents.update(tenantId, adminId, { ask_in_portal: false });
        expect((await portal.me(actor)).data_consent).toBeNull();
        await consents.update(tenantId, adminId, { ask_in_portal: true });
    });

    it('admin: listado con filtros, retiro registrado por la empresa y CSV con fórmulas neutralizadas', async () => {
        const { id, token } = await makeForm();
        await svc.submit(token, IP, { values: { [f.nombre!.id]: '=HYPERLINK("http://x")' }, uploads: {}, stamp: stampOf(id), consent: true });
        const all = await consents.list(tenantId, { status: 'all', source: 'all', limit: 50 });
        expect(all.items.length).toBe((await consentRows()).length);
        expect(all.items[0]!.list_name).toBe('Contactos');
        const portalOnly = await consents.list(tenantId, { status: 'all', source: 'portal', limit: 50 });
        expect(portalOnly.items.every((i) => i.source === 'portal')).toBe(true);
        const withdrawn = await consents.list(tenantId, { status: 'withdrawn', source: 'all', limit: 50 });
        expect(withdrawn.items.every((i) => i.withdrawn_at !== null)).toBe(true);
        const search = await consents.list(tenantId, { status: 'all', source: 'all', q: 'DORA@', limit: 50 });
        expect(search.items.map((i) => i.subject_email)).toEqual(['dora@cliente.test']);
        // Un "%" del buscador no es comodín.
        expect((await consents.list(tenantId, { status: 'all', source: 'all', q: '%', limit: 50 })).items).toEqual([]);
        // Paginación por cursor.
        const p1 = await consents.list(tenantId, { status: 'all', source: 'all', limit: 2 });
        const p2 = await consents.list(tenantId, { status: 'all', source: 'all', limit: 2, before: p1.next_cursor! });
        expect(p2.items[0]!.id).toBeLessThan(p1.items[1]!.id);

        const dora = search.items[0]!;
        const done = await consents.adminWithdraw(tenantId, adminId, dora.id, 'Lo pidió por teléfono');
        expect(done).toMatchObject({ withdrawn_via: 'admin', withdrawn_note: 'Lo pidió por teléfono', withdrawn_by_name: 'Admin Acme' });
        await expect(consents.adminWithdraw(tenantId, adminId, dora.id, '')).rejects.toMatchObject({ response: { code: 'already_withdrawn' } });
        await expect(consents.adminWithdraw(otherTenant, adminId, dora.id, '')).rejects.toMatchObject({ response: { code: 'not_found' } });

        const csv = await consents.exportCsv(tenantId, { status: 'all', source: 'all', limit: 50 });
        expect(csv.csv.startsWith('﻿')).toBe(true);
        expect(csv.csv).toContain('Huella del texto (SHA-256)');
        expect(csv.csv).toContain(`'=HYPERLINK(""http://x"")`);
        expect(csv.csv).toContain('registrada por la empresa (Admin Acme)');
        expect(csv.count).toBe(all.items.length + 0);
    });

    it('RLS: las dos tablas tienen RLS forzado y no se escribe evidencia en otra empresa', async () => {
        const rows = await pg.db.execute(sql`
            select relname, relrowsecurity, relforcerowsecurity from pg_class
            where relname in ('data_consents', 'data_consent_versions')`);
        expect(rows.rows).toHaveLength(2);
        for (const r of rows.rows) {
            expect(r.relrowsecurity, String(r.relname)).toBe(true);
            expect(r.relforcerowsecurity, String(r.relname)).toBe(true);
        }
        await expect(
            withTenant(pg.db, otherTenant, (tx) =>
                tx.insert(dataConsents).values({ tenantId, version: 1, textHash: 'x'.repeat(64), source: 'form', acceptedAt: new Date() }),
            ),
        ).rejects.toThrow();
        // Ni sin contexto de empresa.
        expect(await pg.db.transaction(async (tx) => {
            await tx.execute(sql`set local role imagina_app`);
            return tx.select().from(dataConsents);
        })).toEqual([]);
    });

    it('borrar la empresa se lleva su evidencia y sus versiones', async () => {
        // (la cascada desde `tenants` y el orden de `deleteTenant` no se traban
        // con la FK compuesta de la versión)
        const [tmp] = await pg.db.insert(tenants).values({ slug: 'temp-ley', name: 'Temporal' }).returning();
        await consents.update(tmp!.id, null, { enabled: true, responsible: RESPONSIBLE });
        await withTenant(pg.db, tmp!.id, (tx) =>
            tx.insert(dataConsents).values({ tenantId: tmp!.id, version: 1, textHash: 'x'.repeat(64), source: 'form', acceptedAt: new Date() }),
        );
        await pg.db.delete(tenants).where(eq(tenants.id, tmp!.id));
        expect(await pg.db.select().from(dataConsents).where(eq(dataConsents.tenantId, tmp!.id))).toEqual([]);
        expect(await pg.db.select().from(dataConsentVersions).where(eq(dataConsentVersions.tenantId, tmp!.id))).toEqual([]);
    });
});
