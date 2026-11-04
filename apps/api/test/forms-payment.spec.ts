import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, type Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.361 — Un formulario que cobra al enviar. La API de Mercado Pago se
 * simula en el borde de red (`safeWebhookFetch`), como en `collections.spec`:
 * el test ejercita todo lo nuestro — el monto lo decide el SERVIDOR (fijo, un
 * cálculo o la respuesta dentro de mínimo y máximo), el link se arma con la
 * conexión del equipo y la dirección de vuelta, la página de vuelta sólo ve
 * ESE pago, y si el pago no se puede armar la respuesta no se pierde.
 */
interface FakeCall {
    url: string;
    method?: string;
    body?: string;
}
const net = vi.hoisted(() => ({
    calls: [] as FakeCall[],
    handler: (_call: FakeCall): { status: number; body: string } => ({ status: 404, body: '' }),
}));
vi.mock('../src/common/safe-fetch', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/common/safe-fetch')>();
    return {
        ...real,
        safeWebhookFetch: async (url: string, opts: { method?: string; body?: string }) => {
            const call = { url, method: opts.method, body: opts.body };
            net.calls.push(call);
            const res = net.handler(call);
            return { status: res.status, body: res.body, contentType: 'application/json' };
        },
    };
});

import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { CollectionsService } from '../src/collections/collections.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { connections, formPendingSubmissions, forms, memberships, paymentLinks, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { FormsService } from '../src/forms/forms.service';
import type { IncidentHub } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';
const IP = '203.0.113.81';

class NoopDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class CapturingMail implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(m: MailMessage): Promise<void> {
        this.sent.push(m);
        return Promise.resolve();
    }
}

describe('v0.1.361 — formularios que cobran al enviar (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let connectors: ConnectorsService;
    let svc: FormsService;
    let tenantId: number;
    let adminId = 0;
    let connId = 0;
    const dispatcher = new NoopDispatcher();
    const mailbox = new CapturingMail();
    const incidents: Array<{ key: string; title: string; message: string }> = [];
    const resolved: string[] = [];
    const f: Record<string, Field> = {};
    let prefs: Array<Record<string, unknown>> = [];
    let mpSearch: Array<Record<string, unknown>> = [];

    function fakeMercadoPago(): void {
        prefs = [];
        mpSearch = [];
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) {
                return { status: 200, body: JSON.stringify({ id: 123, nickname: 'ACADEMIA', site_id: 'MCO' }) };
            }
            if (call.url === `${MP}/checkout/preferences` && call.method === 'POST') {
                prefs.push(JSON.parse(call.body!) as Record<string, unknown>);
                return {
                    status: 201,
                    body: JSON.stringify({ id: `pref-${prefs.length}`, init_point: `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-${prefs.length}` }),
                };
            }
            if (call.url.startsWith(`${MP}/v1/payments/search`)) {
                const ref = new URL(call.url).searchParams.get('external_reference');
                return { status: 200, body: JSON.stringify({ results: mpSearch.filter((p) => p.external_reference === ref) }) };
            }
            return { status: 404, body: '' };
        };
    }

    const stamp = (formId: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('formstamp', formId, ts)}`;
    };
    const tokenOf = async (formId: number): Promise<string> => {
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(forms).where(eq(forms.id, formId)));
        return row!.token;
    };
    const linksOf = async (formId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(paymentLinks).where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.formId, formId))));
    const recordCount = async (): Promise<number> =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select({ id: records.id }).from(records).where(eq(records.tenantId, tenantId)))).length;

    /** Inscripción: nombre, correo, plan (con su precio en un cálculo) y un aporte voluntario. */
    async function payForm(payment: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
        const items = [
            { id: 'qnombre1', type: 'field', field_id: f.nombre!.id, required: true },
            { id: 'qcorreo1', type: 'field', field_id: f.correo!.id, required: true },
            { id: 'qplan001', type: 'field', field_id: f.plan!.id },
            { id: 'qaporte1', type: 'field', field_id: f.aporte!.id },
        ];
        const calcs = [
            {
                id: 'cprecio1',
                name: 'Precio',
                key: 'precio',
                start: 0,
                parts: [{ field_id: f.plan!.id, points: { basico: 30000, premium: 80000 }, multiplier: null }],
                save_field_id: null,
            },
        ];
        const dto = await svc.create(tenantId, adminId, 'inscripciones', {
            name: 'Inscripción',
            config: formConfigSchema.parse({
                items,
                settings: {
                    title: 'Inscripción al taller',
                    calcs,
                    respondent_email_field_id: f.correo!.id,
                    payment: { enabled: true, connection_id: connId, ...payment },
                    ...extra,
                },
            }),
        });
        await svc.update(tenantId, 'inscripciones', dto.id, { enabled: true });
        return { id: dto.id, token: await tokenOf(dto.id) };
    }

    const answers = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
        [f.nombre!.id]: 'Ana Gómez',
        [f.correo!.id]: 'ana@correo.test',
        ...over,
    });

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const env = loadEnv({ REDIS_URL: rd.url, SECRETS_KEY: KEY, FILES_SIGNING_SECRET: 'form-pay-secret', APP_BASE_URL: 'https://app.imagina.test' });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env));
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, dispatcher, new RelationsRepository());
        const collections = new CollectionsService(tenantDb, pg.db, env, connectors, lists, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsSvc);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formpay-'))), env);
        const hub = {
            report: (i: { key: string; title: string; message: string }) => incidents.push(i),
            resolve: (_t: number, key: string) => resolved.push(key),
        } as unknown as IncidentHub;
        svc = new FormsService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            files,
            redis as never,
            dispatcher,
            env,
            undefined,
            hub,
            undefined,
            undefined,
            new MailService(env, mailbox),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            collections,
        );
        svc.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'academia', name: 'Academia', settings: { format: { number_format: 'dot_comma' } } }).returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@academia.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = a!.id;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        await lists.create(tenantId, { name: 'Inscripciones', slug: 'inscripciones' });
        const mk = async (slug: string, label: string, type: string, config?: Record<string, unknown>): Promise<void> => {
            f[slug] = await fieldsSvc.create(tenantId, 'inscripciones', { label, type, slug, ...(config ? { config } : {}) } as never);
        };
        await mk('nombre', 'Nombre', 'text');
        await mk('correo', 'Correo', 'email');
        await mk('plan', 'Plan', 'select', { options: [{ value: 'basico', label: 'Básico' }, { value: 'premium', label: 'Premium' }] });
        await mk('aporte', 'Aporte', 'currency', { currency: 'COP', precision: 0 });

        fakeMercadoPago();
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        connId = connection.id;
    });

    afterAll(async () => {
        svc?.onModuleDestroy();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        net.calls.length = 0;
        incidents.length = 0;
        resolved.length = 0;
        mailbox.sent.length = 0;
        fakeMercadoPago();
        await redis.flushall();
    });

    it('monto fijo: guarda la respuesta, arma el link con la conexión del equipo y vuelve a la página con su referencia', async () => {
        const form = await payForm({ source: 'fixed', amount: 50000, title: 'Inscripción de {{nombre}}', after: 'redirect' });
        const meta = await svc.meta(form.token);
        expect(meta.payment).toMatchObject({ source: 'fixed', amount: 50000, currency: 'COP', after: 'redirect', button_label: 'Ir a pagar' });

        const before = await recordCount();
        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(await recordCount()).toBe(before + 1);
        expect(out.payment).toMatchObject({ amount: 50000, currency: 'COP', after: 'redirect' });
        expect(out.payment!.url).toMatch(/^https:\/\/www\.mercadopago\.com\.co\/checkout/);
        expect(out.payment_error).toBeUndefined();

        // Lo que se le pidió a Mercado Pago: el concepto con el nombre, el monto, el correo y la vuelta.
        expect(prefs).toHaveLength(1);
        const pref = prefs[0]!;
        const item = (pref.items as Array<Record<string, unknown>>)[0]!;
        expect(item.title).toBe('Inscripción de Ana Gómez');
        expect(item.unit_price).toBe(50000);
        expect(pref.payer).toEqual({ email: 'ana@correo.test' });
        const back = (pref.back_urls as { success: string }).success;
        expect(back).toMatch(new RegExp(`^https://app\\.imagina\\.test/api/v1/public/f/${form.token}\\?pago=ib_`));
        expect(pref.auto_return).toBe('approved');

        const [link] = await linksOf(form.id);
        expect(link).toMatchObject({ formId: form.id, amount: 50000, status: 'pending' });
        const ref = new URL(back).searchParams.get('pago')!;
        expect(link!.reference).toBe(ref);

        // La página de vuelta: pendiente (con el link para reintentar) y, cuando el pago aparece, pagado.
        const pending = await svc.paymentStatus(form.token, ref);
        expect(pending).toMatchObject({ status: 'pending', title: 'Inscripción de Ana Gómez', amount: 50000, currency: 'COP' });
        expect(pending.url).toBe(out.payment!.url);
        mpSearch.push({ id: 9001, status: 'approved', transaction_amount: 50000, currency_id: 'COP', external_reference: ref, payment_method_id: 'pse' });
        // Se acaba de consultar: espera unos segundos antes de volver a preguntar (no se martilla al proveedor).
        const searches = () => net.calls.filter((c) => c.url.includes('/v1/payments/search')).length;
        const asked = searches();
        expect((await svc.paymentStatus(form.token, ref)).status).toBe('pending');
        expect(searches()).toBe(asked);
        await withTenant(pg.db, tenantId, (tx) => tx.update(paymentLinks).set({ lastCheckedAt: new Date(Date.now() - 60_000) }).where(eq(paymentLinks.id, link!.id)));
        const paid = await svc.paymentStatus(form.token, ref);
        expect(paid).toMatchObject({ status: 'paid', url: null });
        expect(dispatcher.events.some((e) => e.trigger === 'payment_received')).toBe(true);
    });

    it('la página de vuelta sólo ve pagos de ESE formulario y con su referencia', async () => {
        const a = await payForm({ source: 'fixed', amount: 20000 });
        const b = await payForm({ source: 'fixed', amount: 20000 });
        await svc.submit(a.token, IP, { values: answers(), uploads: {}, stamp: stamp(a.id) });
        const [link] = await linksOf(a.id);
        await expect(svc.paymentStatus(b.token, link!.reference!)).rejects.toMatchObject({ status: 404 });
        await expect(svc.paymentStatus(a.token, 'ib_noexistenoexiste')).rejects.toMatchObject({ status: 404 });
        await expect(svc.paymentStatus(a.token, '<script>')).rejects.toMatchObject({ status: 404 });
    });

    it('según un cálculo: el precio del plan elegido (y viaja a la página para mostrar el total)', async () => {
        const form = await payForm({ source: 'calc', calc_key: 'precio', after: 'button', button_label: 'Pagar la inscripción' });
        const meta = await svc.meta(form.token);
        expect(meta.payment).toMatchObject({ source: 'calc', calc_key: 'precio', after: 'button', button_label: 'Pagar la inscripción' });
        // El cálculo del monto se muestra antes de enviar: sus puntos viajan.
        expect(meta.calcs?.find((c) => c.key === 'precio')?.parts).not.toBeNull();

        const out = await svc.submit(form.token, IP, { values: answers({ [f.plan!.id]: 'premium' }), uploads: {}, stamp: stamp(form.id) });
        expect(out.payment).toMatchObject({ amount: 80000, after: 'button', button_label: 'Pagar la inscripción' });

        // Sin plan, el total da cero: se guarda la respuesta y no se cobra nada.
        const before = (await linksOf(form.id)).length;
        const free = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(free.payment).toBeUndefined();
        expect((await linksOf(form.id)).length).toBe(before);
    });

    it('lo escribe la persona: fuera del mínimo o el máximo es un error de la pregunta', async () => {
        const form = await payForm({ source: 'field', field_id: f.aporte!.id, min: 10000, max: 500000 });
        const err = await svc.submit(form.token, IP, { values: answers({ [f.aporte!.id]: 5000 }), uploads: {}, stamp: stamp(form.id) }).catch((e: unknown) => e);
        expect((err as { response?: { data?: { errors?: Record<string, string> } } }).response?.data?.errors?.qaporte1).toBe('El monto mínimo es 10.000.');
        const err2 = await svc.submit(form.token, IP, { values: answers({ [f.aporte!.id]: 900000 }), uploads: {}, stamp: stamp(form.id) }).catch((e: unknown) => e);
        expect((err2 as { response?: { data?: { errors?: Record<string, string> } } }).response?.data?.errors?.qaporte1).toBe('El monto máximo es 500.000.');
        const ok = await svc.submit(form.token, IP, { values: answers({ [f.aporte!.id]: 75000 }), uploads: {}, stamp: stamp(form.id) });
        expect(ok.payment).toMatchObject({ amount: 75000 });
    });

    it('sólo con una conexión de cobro del equipo; si la conexión desaparece, la respuesta no se pierde', async () => {
        // Una conexión privada (de una persona) no sirve para un formulario.
        await withTenant(pg.db, tenantId, (tx) => tx.update(connections).set({ visibility: 'private' }).where(eq(connections.id, connId)));
        await expect(payForm({ source: 'fixed', amount: 20000 })).rejects.toMatchObject({ response: { code: 'form_payment_connection' } });
        await withTenant(pg.db, tenantId, (tx) => tx.update(connections).set({ visibility: 'workspace' }).where(eq(connections.id, connId)));

        const form = await payForm({ source: 'fixed', amount: 20000 });
        // La conexión pasa a ser privada después de guardar el formulario: el envío entra igual y se avisa.
        await withTenant(pg.db, tenantId, (tx) => tx.update(connections).set({ visibility: 'private' }).where(eq(connections.id, connId)));
        const before = await recordCount();
        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(await recordCount()).toBe(before + 1);
        expect(out.payment).toBeUndefined();
        expect(out.payment_error).toMatch(/Recibimos tu respuesta, pero no pudimos preparar el pago/);
        expect(incidents.map((i) => i.key)).toContain(`form-payment:${form.id}`);
        await withTenant(pg.db, tenantId, (tx) => tx.update(connections).set({ visibility: 'workspace' }).where(eq(connections.id, connId)));

        // Al volver a funcionar, el aviso a la empresa se cierra solo.
        await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(resolved).toContain(`form-payment:${form.id}`);
    });

    it('con confirmación por correo, el link se arma al confirmar (sólo entonces existe el registro)', async () => {
        const form = await payForm({ source: 'calc', calc_key: 'precio' }, { confirm_email: true });
        const out = await svc.submit(form.token, IP, { values: answers({ [f.plan!.id]: 'basico' }), uploads: {}, stamp: stamp(form.id) });
        expect(out.pending_confirmation).toBe(true);
        expect(out.payment).toBeUndefined();
        expect(await linksOf(form.id)).toHaveLength(0);

        const mail = mailbox.sent.at(-1)!;
        const token = /\/api\/v1\/public\/f\/confirm\/([A-Za-z0-9_-]+)/.exec(mail.html ?? mail.text ?? '')?.[1];
        expect(token).toBeTruthy();
        const outcome = await svc.confirm(token!);
        expect(outcome.status).toBe('confirmed');
        expect(outcome.payUrl).toMatch(/^https:\/\/www\.mercadopago\.com\.co\/checkout/);
        expect(outcome.payAmountText).toBe('30.000 COP');
        expect(await linksOf(form.id)).toHaveLength(1);
        const left = await pg.db.select().from(formPendingSubmissions).where(eq(formPendingSubmissions.formId, form.id));
        expect(left).toHaveLength(0);
    });

    it('un enlace para actualizar no cobra', async () => {
        const form = await payForm({ source: 'fixed', amount: 20000 }, { edit_links: { enabled: true, days: 30 } });
        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ id: records.id }).from(paymentLinks).innerJoin(records, eq(records.id, paymentLinks.recordId)).where(eq(paymentLinks.formId, form.id)),
        );
        expect(out.payment).toBeDefined();
        const link = await svc.createEditLink(tenantId, { userId: adminId, role: 'admin' }, 'inscripciones', form.id, rec!.id);
        const code = new URL(link.url).searchParams.get('editar')!;
        const before = (await linksOf(form.id)).length;
        const upd = await svc.submit(form.token, IP, { values: answers({ [f.nombre!.id]: 'Ana G.' }), uploads: {}, stamp: stamp(form.id), edit: code });
        expect(upd.updated).toBe(true);
        expect(upd.payment).toBeUndefined();
        expect((await linksOf(form.id)).length).toBe(before);
    });
});
