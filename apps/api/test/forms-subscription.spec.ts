import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formConfigSchema, type Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.368 (ADR-S96) — Un formulario que SUSCRIBE al enviar: la persona elige
 * un plan (si hay varios) y autoriza su tarjeta en Mercado Pago. La API de
 * Mercado Pago se simula en el borde de red (`safeWebhookFetch`), como en
 * `subscriptions.spec`: el test ejercita lo nuestro — los planes que se pueden
 * ofrecer (del equipo, activos), la elección validada en el servidor, el
 * correo obligatorio, la suscripción con su registro y la vuelta a la página,
 * la confirmación por correo y que una falla no pierda la respuesta.
 */
interface FakeCall {
    url: string;
    method?: string;
    headers?: Record<string, string>;
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
        safeWebhookFetch: async (url: string, opts: { method?: string; headers?: Record<string, string>; body?: string }) => {
            const call = { url, method: opts.method, headers: opts.headers, body: opts.body };
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
import { formPendingSubmissions, forms, memberships, records, subscriptionPlans, subscriptions, tenants, users } from '../src/db/schema';
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
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';
const IP = '203.0.113.82';

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

describe('v0.1.368 — formularios que suscriben al enviar (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let connectors: ConnectorsService;
    let subs: SubscriptionsService;
    let svc: FormsService;
    let tenantId: number;
    let adminId = 0;
    let teamConn = 0;
    let privateConn = 0;
    const admin = { userId: 0, role: 'admin' as const };
    const dispatcher = new NoopDispatcher();
    const mailbox = new CapturingMail();
    const incidents: Array<{ key: string; title: string; message: string }> = [];
    const f: Record<string, Field> = {};
    /** Las suscripciones del Mercado Pago simulado. */
    const pre = new Map<string, Record<string, unknown>>();
    let preFails = false;

    function fakeMercadoPago(): void {
        pre.clear();
        preFails = false;
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) return { status: 200, body: JSON.stringify({ id: 123, nickname: 'GIMNASIO', site_id: 'MCO' }) };
            if (call.url === `${MP}/preapproval` && call.method === 'POST') {
                if (preFails) return { status: 500, body: JSON.stringify({ message: 'internal_error' }) };
                const body = JSON.parse(call.body!) as Record<string, unknown>;
                const id = `pre-${pre.size + 1}`;
                const row = {
                    id,
                    status: 'pending',
                    reason: body.reason,
                    external_reference: body.external_reference,
                    payer_email: body.payer_email,
                    auto_recurring: body.auto_recurring,
                    back_url: body.back_url,
                    init_point: `https://www.mercadopago.com.co/subscriptions/checkout?preapproval_id=${id}`,
                    next_payment_date: null,
                };
                pre.set(id, row);
                return { status: 201, body: JSON.stringify(row) };
            }
            const m = /\/preapproval\/([\w-]+)$/.exec(call.url);
            if (m) {
                const row = pre.get(m[1]!);
                return row ? { status: 200, body: JSON.stringify(row) } : { status: 404, body: '{}' };
            }
            if (call.url.startsWith(`${MP}/authorized_payments/search`)) return { status: 200, body: JSON.stringify({ results: [] }) };
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
    const subsOf = async (formId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(subscriptions).where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.formId, formId))));
    const recordCount = async (): Promise<number> =>
        (await withTenant(pg.db, tenantId, (tx) => tx.select({ id: records.id }).from(records).where(eq(records.tenantId, tenantId)))).length;

    async function plan(connectionId: number, name: string, amount: number, extra: Record<string, unknown> = {}) {
        return subs.createPlan(tenantId, admin, {
            connection_id: connectionId,
            name,
            description: null,
            amount,
            currency: 'COP',
            frequency: 1,
            frequency_type: 'months',
            cycles: null,
            trial_days: 0,
            grace_days: 10,
            on_expire: 'mark',
            ...extra,
        } as Parameters<SubscriptionsService['createPlan']>[2]);
    }

    /** Membresía del gimnasio: nombre y correo. */
    async function subForm(subscription: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<{ id: number; token: string }> {
        const dto = await svc.create(tenantId, adminId, 'socios', {
            name: 'Membresía',
            config: formConfigSchema.parse({
                items: [
                    { id: 'qnombre1', type: 'field', field_id: f.nombre!.id, required: true },
                    { id: 'qcorreo1', type: 'field', field_id: f.correo!.id },
                ],
                settings: {
                    title: 'Únete al gimnasio',
                    respondent_email_field_id: f.correo!.id,
                    subscription: { enabled: true, ...subscription },
                    ...extra,
                },
            }),
        });
        await svc.update(tenantId, 'socios', dto.id, { enabled: true });
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
        const env = loadEnv({ REDIS_URL: rd.url, SECRETS_KEY: KEY, FILES_SIGNING_SECRET: 'form-sub-secret', APP_BASE_URL: 'https://app.imagina.test' });
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
        subs = new SubscriptionsService(tenantDb, pg.db, env, connectors, lists, new RecordsRepository(), activity, rt, dispatcher, audit, collections, fieldsSvc);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-formsub-'))), env);
        const hub = {
            report: (i: { key: string; title: string; message: string }) => incidents.push(i),
            resolve: () => undefined,
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
            subs,
        );
        svc.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'gimnasio', name: 'Gimnasio', settings: { format: { number_format: 'dot_comma' } } }).returning();
        tenantId = t!.id;
        const [a] = await pg.db.insert(users).values({ email: 'admin@gimnasio.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = a!.id;
        admin.userId = adminId;
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ userId: adminId, tenantId, role: 'admin' }));
        await lists.create(tenantId, { name: 'Socios', slug: 'socios' });
        f.nombre = await fieldsSvc.create(tenantId, 'socios', { label: 'Nombre', type: 'text', slug: 'nombre' } as never);
        f.correo = await fieldsSvc.create(tenantId, 'socios', { label: 'Correo', type: 'email', slug: 'correo' } as never);

        fakeMercadoPago();
        teamConn = (await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', { fields: { access_token: 'APP_USR-equipo' }, visibility: 'workspace' }))
            .connection.id;
        privateConn = (
            await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', { fields: { access_token: 'APP_USR-mia' }, visibility: 'private', name: 'Mi cuenta' } as never)
        ).connection.id;
    });

    afterAll(async () => {
        svc?.onModuleDestroy();
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        net.calls.length = 0;
        incidents.length = 0;
        mailbox.sent.length = 0;
        fakeMercadoPago();
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
            await tx.delete(formPendingSubmissions).where(eq(formPendingSubmissions.tenantId, tenantId));
            await tx.delete(forms).where(eq(forms.tenantId, tenantId));
            await tx.delete(subscriptionPlans).where(eq(subscriptionPlans.tenantId, tenantId));
        });
    });

    it('sólo planes activos de una conexión del equipo; la página los ve en su orden y no cobra una vez además', async () => {
        const mio = await plan(privateConn, 'Plan privado', 10000);
        await expect(subForm({ plan_ids: [mio.id] })).rejects.toMatchObject({ response: { code: 'form_subscription_plan' } });

        const mensual = await plan(teamConn, 'Mensual', 150000);
        const anual = await plan(teamConn, 'Anual', 1500000, { frequency: 12, trial_days: 7 });
        const form = await subForm({ plan_ids: [anual.id, mensual.id, anual.id] }, { payment: { enabled: true, connection_id: teamConn, source: 'fixed', amount: 5000 } });
        const meta = await svc.meta(form.token);
        // Repetidos fuera, en el orden elegido, con lo que necesita la página (sin la conexión).
        expect(meta.subscription?.plans.map((p) => p.name)).toEqual(['Anual', 'Mensual']);
        expect(meta.subscription?.plans[0]).toMatchObject({ amount: 1500000, currency: 'COP', frequency: 12, frequency_type: 'months', trial_days: 7 });
        expect(meta.subscription).toMatchObject({ plan_label: 'Elige tu plan', after: 'redirect', button_label: 'Autorizar el débito automático' });
        expect(JSON.stringify(meta.subscription)).not.toContain('connection');
        // Suscribir manda: no se cobra una vez además.
        expect(meta.payment).toBeNull();

        // Un plan pausado deja de ofrecerse; sin ninguno, el formulario se recibe como uno común.
        await subs.updatePlan(tenantId, admin, anual.id, { active: false } as never);
        expect((await svc.meta(form.token)).subscription?.plans.map((p) => p.name)).toEqual(['Mensual']);
    });

    it('con varios planes hay que elegir uno de los ofrecidos; al enviar se suscribe con el correo y vuelve a la página', async () => {
        const mensual = await plan(teamConn, 'Mensual', 150000);
        const otro = await plan(teamConn, 'Trimestral', 400000, { frequency: 3 });
        const ajeno = await plan(teamConn, 'No ofrecido', 1);
        const form = await subForm({ plan_ids: [mensual.id, otro.id] });

        const before = await recordCount();
        await expect(svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) })).rejects.toMatchObject({
            response: { code: 'form_invalid', data: { errors: { __plan: 'Elige un plan.' } } },
        });
        await expect(svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id), plan_id: ajeno.id })).rejects.toMatchObject({
            response: { data: { errors: { __plan: 'Elige un plan.' } } },
        });
        expect(await recordCount()).toBe(before);

        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id), plan_id: otro.id });
        expect(await recordCount()).toBe(before + 1);
        expect(out.subscription).toMatchObject({ plan: 'Trimestral', amount: 400000, currency: 'COP', frequency: 3, frequency_type: 'months', after: 'redirect' });
        expect(out.subscription!.url).toMatch(/^https:\/\/www\.mercadopago\.com\.co\/subscriptions\/checkout/);
        expect(out.subscription_error).toBeUndefined();

        // Lo que se le pidió a Mercado Pago: el correo, el valor del plan y la vuelta a ESTA página.
        const created = [...pre.values()][0]!;
        expect(created.payer_email).toBe('ana@correo.test');
        expect((created.auto_recurring as { transaction_amount: number; frequency: number }).transaction_amount).toBe(400000);
        expect(String(created.back_url)).toMatch(new RegExp(`^https://app\\.imagina\\.test/api/v1/public/f/${form.token}\\?suscripcion=ibs_`));

        const [row] = await subsOf(form.id);
        expect(row).toMatchObject({ formId: form.id, planId: otro.id, status: 'pending' });
        expect(row!.recordId).toBeGreaterThan(0);

        // La página de vuelta: «por autorizar» (con el link para terminar) y, autorizada, activa.
        const ref = new URL(String(created.back_url)).searchParams.get('suscripcion')!;
        expect(ref).toBe(row!.reference);
        const pending = await svc.subscriptionStatus(form.token, ref);
        expect(pending).toMatchObject({ state: 'pending', plan: 'Trimestral', amount: 400000, frequency: 3 });
        expect(pending.url).toBe(out.subscription!.url);
        created.status = 'authorized';
        created.next_payment_date = new Date(Date.now() + 30 * 86_400_000).toISOString();
        await withTenant(pg.db, tenantId, (tx) => tx.update(subscriptions).set({ lastCheckedAt: null }).where(eq(subscriptions.id, row!.id)));
        const active = await svc.subscriptionStatus(form.token, ref);
        expect(active.state).toBe('active');
        expect(active.url).toBeNull();

        // Otra referencia (o la de otro formulario) no se ve: 404 opaco.
        const other = await subForm({ plan_ids: [mensual.id] });
        await expect(svc.subscriptionStatus(other.token, ref)).rejects.toMatchObject({ status: 404 });
        await expect(svc.subscriptionStatus(form.token, 'ibs_noexiste12345')).rejects.toMatchObject({ status: 404 });
    });

    it('con un solo plan no hace falta elegir, pero sí el correo; el botón queda en la pantalla de gracias', async () => {
        const mensual = await plan(teamConn, 'Mensual', 150000);
        const form = await subForm({ plan_ids: [mensual.id], after: 'button', button_label: 'Activar mi membresía' });
        await expect(svc.submit(form.token, IP, { values: answers({ [f.correo!.id]: '' }), uploads: {}, stamp: stamp(form.id) })).rejects.toMatchObject({
            response: { data: { errors: { qcorreo1: 'Necesitamos tu correo para la suscripción.' } } },
        });
        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(out.subscription).toMatchObject({ plan: 'Mensual', after: 'button', button_label: 'Activar mi membresía' });
    });

    it('con confirmación por correo, la suscripción se arma al confirmar y la página la ofrece', async () => {
        const mensual = await plan(teamConn, 'Mensual', 150000);
        const form = await subForm({ plan_ids: [mensual.id] }, { confirm_email: true });
        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(out.pending_confirmation).toBe(true);
        expect(out.subscription).toBeUndefined();
        expect(pre.size).toBe(0);
        const [pending] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(formPendingSubmissions).where(eq(formPendingSubmissions.formId, form.id)));
        expect(pending!.planId).toBe(mensual.id);

        const mail = mailbox.sent.find((m) => m.to.includes('ana@correo.test'))!;
        const token = /\/confirm\/([A-Za-z0-9_-]+)/.exec(mail.html ?? mail.text ?? '')![1]!;
        const confirmed = await svc.confirm(token);
        expect(confirmed.status).toBe('confirmed');
        expect(confirmed.payTotalLabel).toBe('Suscripción');
        expect(confirmed.payAmountText).toBe('150.000 COP cada mes · Mensual');
        expect(confirmed.payUrl).toMatch(/subscriptions\/checkout/);
        expect(pre.size).toBe(1);
    });

    it('si Mercado Pago falla, la respuesta queda guardada, se le dice a la persona y se avisa a la empresa', async () => {
        const mensual = await plan(teamConn, 'Mensual', 150000);
        const form = await subForm({ plan_ids: [mensual.id] });
        preFails = true;
        const before = await recordCount();
        const out = await svc.submit(form.token, IP, { values: answers(), uploads: {}, stamp: stamp(form.id) });
        expect(await recordCount()).toBe(before + 1);
        expect(out.subscription).toBeUndefined();
        expect(out.subscription_error).toMatch(/Te contactaremos/);
        expect(incidents.some((i) => i.key === `form-subscription:${form.id}` && /no pudo armar la suscripción/.test(i.title))).toBe(true);
    });
});
