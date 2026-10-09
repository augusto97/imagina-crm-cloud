import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.251 (ADR-S31) — Cobros de las empresas con Mercado Pago y Wompi, de
 * punta a punta con Postgres real. Las APIs de los proveedores se simulan en el
 * borde de red (`safeWebhookFetch`), así el test ejercita TODO lo nuestro:
 * conectar (credencial verificada y cifrada), crear el link desde un registro
 * y desde una automatización, el aviso que se verifica RELEYENDO el pago, la
 * firma de Wompi, el monto distinto, el reembolso, «Verificar», el vencimiento
 * y el aislamiento entre empresas.
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
        safeWebhookFetch: async (
            url: string,
            opts: { method?: string; headers?: Record<string, string>; body?: string },
        ) => {
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
import {
    nextLinkState,
    precheckCreds,
    verifyWompiChecksum,
    type GatewayPayment,
} from '../src/collections/collection-gateways';
import { CollectionsService } from '../src/collections/collections.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine, parseAmount } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { automationRuns, automations, connections, fields, lists, paymentLinks, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryOAuthStore } from './helpers/oauth-store';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';
const WOMPI = 'https://sandbox.wompi.co/v1';

class NullMail implements MailTransport {
    readonly name = 'null';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

/** El dispatcher real es no-op sin cola: éste guarda los eventos para mirarlos. */
class CapturingDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

describe('Cobros de las empresas — Mercado Pago y Wompi (v0.1.251)', () => {
    let pg: TestPg;
    let connectors: ConnectorsService;
    let svc: CollectionsService;
    let fieldsService: FieldsService;
    let listsService: ListsService;
    let engine: AutomationEngine;
    let dispatcher: CapturingDispatcher;
    let tenantId: number;
    let otherTenantId: number;
    let adminId: number;
    let agentId: number;
    const admin = { userId: 0, role: 'admin' as const };

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const env = loadEnv({ SECRETS_KEY: KEY, APP_BASE_URL: 'https://app.imagina.test' });
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env));
        const rt = new RealtimeService();
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        dispatcher = new CapturingDispatcher();
        svc = new CollectionsService(
            tenantDb,
            pg.db,
            env,
            connectors,
            listsService,
            new RecordsRepository(),
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            rt,
            dispatcher,
            audit,
            fieldsService,
        );
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NullMail()),
            connectors,
            undefined,
            undefined,
            undefined,
            svc,
        );

        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        tenantId = t!.id;
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        otherTenantId = t2!.id;
        const [u] = await pg.db.insert(users).values({ email: 'admin@acme.test', passwordHash: 'x', name: 'Ada' }).returning();
        adminId = u!.id;
        admin.userId = adminId;
        const [a] = await pg.db.insert(users).values({ email: 'agent@acme.test', passwordHash: 'x', name: 'Agus' }).returning();
        agentId = a!.id;
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        net.calls.length = 0;
        net.handler = () => ({ status: 404, body: '' });
        dispatcher.events.length = 0;
        for (const tid of [tenantId, otherTenantId]) {
            await withTenant(pg.db, tid, async (tx) => {
                await tx.delete(paymentLinks).where(eq(paymentLinks.tenantId, tid));
                await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tid));
                await tx.delete(automations).where(eq(automations.tenantId, tid));
                await tx.delete(records).where(eq(records.tenantId, tid));
                await tx.delete(fields).where(eq(fields.tenantId, tid));
                await tx.delete(lists).where(eq(lists.tenantId, tid));
                await tx.delete(connections).where(eq(connections.tenantId, tid));
            });
        }
    });

    // ── Proveedores simulados ───────────────────────────────────────────

    /** Un Mercado Pago con memoria: preferencias creadas y pagos por id. */
    function fakeMercadoPago(): { payments: Map<string, Record<string, unknown>>; prefs: Array<Record<string, unknown>> } {
        const payments = new Map<string, Record<string, unknown>>();
        const prefs: Array<Record<string, unknown>> = [];
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) {
                return call.headers?.authorization === 'Bearer APP_USR-buena'
                    ? { status: 200, body: JSON.stringify({ id: 123, nickname: 'TIENDA_ACME', site_id: 'MCO' }) }
                    : { status: 401, body: JSON.stringify({ message: 'invalid access token' }) };
            }
            if (call.url === `${MP}/checkout/preferences` && call.method === 'POST') {
                const body = JSON.parse(call.body!) as Record<string, unknown>;
                prefs.push(body);
                return {
                    status: 201,
                    body: JSON.stringify({ id: `pref-${prefs.length}`, init_point: `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-${prefs.length}` }),
                };
            }
            const m = /\/v1\/payments\/(\d+)$/.exec(call.url);
            if (m) {
                const p = payments.get(m[1]!);
                return p ? { status: 200, body: JSON.stringify(p) } : { status: 404, body: '{}' };
            }
            if (call.url.startsWith(`${MP}/v1/payments/search`)) {
                const ref = new URL(call.url).searchParams.get('external_reference');
                const results = [...payments.values()].filter((p) => p.external_reference === ref).reverse();
                return { status: 200, body: JSON.stringify({ results }) };
            }
            return { status: 404, body: '' };
        };
        return { payments, prefs };
    }

    async function connectMp(): Promise<number> {
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        return connection.id;
    }

    /** Lista «Facturas» con número, total y correo + un registro. */
    async function seedInvoice(): Promise<{ listId: number; slug: string; recordId: number }> {
        const list = await listsService.create(tenantId, { name: 'Facturas', slug: 'facturas' });
        const numero = await fieldsService.create(tenantId, 'facturas', { label: 'Número', type: 'text' });
        const total = await fieldsService.create(tenantId, 'facturas', { label: 'Total', type: 'currency', config: { currency: 'COP', precision: 0 } });
        const email = await fieldsService.create(tenantId, 'facturas', { label: 'Correo', type: 'email' });
        const [rec] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(records)
                .values({
                    tenantId,
                    listId: list.id,
                    data: { [`f${numero.id}`]: 'FAC-001', [`f${total.id}`]: 150000, [`f${email.id}`]: 'cliente@correo.test' },
                    createdBy: adminId,
                })
                .returning(),
        );
        return { listId: list.id, slug: 'facturas', recordId: rec!.id };
    }

    async function recordData(listId: number, recordId: number): Promise<Record<string, unknown>> {
        const [r] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(records).where(and(eq(records.listId, listId), eq(records.id, recordId))),
        );
        return r!.data as Record<string, unknown>;
    }

    async function hookToken(connectionId: number): Promise<string> {
        const url = await svc.hookUrlFor(tenantId, connectionId, 'mercadopago');
        return url.split('/').pop()!;
    }

    // ── Piezas puras ────────────────────────────────────────────────────

    it('piezas puras: montos latinos, llaves mezcladas, firma de Wompi y reglas de estado', () => {
        expect(parseAmount('150000')).toBe(150000);
        expect(parseAmount('150.000')).toBe(150000);
        expect(parseAmount('$ 1.234.567,50')).toBe(1234567.5);
        expect(parseAmount('99.90')).toBe(99.9);
        expect(parseAmount('1,5')).toBe(1.5);
        expect(parseAmount('150,000')).toBe(150000);
        expect(parseAmount('abc')).toBeNull();

        const creds = (pub: string, prv: string, ev = '') => ({ secret: prv, accessToken: '', fields: { public_key: pub }, signingSecret: ev });
        expect(precheckCreds('wompi', creds('pub_prod_x', 'prv_test_y'))).toMatch(/mismo ambiente/);
        expect(precheckCreds('wompi', creds('pub_test_x', 'prv_test_y', 'prod_events_z'))).toMatch(/otro ambiente/);
        expect(precheckCreds('wompi', creds('pub_test_x', 'prv_test_y', 'test_events_z'))).toBeNull();
        expect(precheckCreds('mercadopago', { secret: 'TEST-123', accessToken: '', fields: {} })).toBeNull();
        expect(precheckCreds('mercadopago', { secret: 'APP_USR-pub-key-no', accessToken: '', fields: {} })).toBeNull();
        expect(precheckCreds('mercadopago', { secret: 'pk_123', accessToken: '', fields: {} })).toMatch(/Access Token/);

        const event = {
            event: 'transaction.updated',
            data: { transaction: { id: '1234-1610641025-49201', status: 'APPROVED', amount_in_cents: 4490000 } },
            signature: {
                properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
                checksum: '',
            },
            timestamp: 1530291411,
        };
        event.signature.checksum = createHash('sha256')
            .update('1234-1610641025-49201APPROVED44900001530291411test_events_secreto')
            .digest('hex')
            .toUpperCase();
        expect(verifyWompiChecksum(event, 'test_events_secreto')).toBe(true);
        expect(verifyWompiChecksum(event, 'otro')).toBe(false);
        expect(verifyWompiChecksum({ ...event, data: { transaction: { ...event.data.transaction, amount_in_cents: 100 } } }, 'test_events_secreto')).toBe(false);

        const pay = (over: Partial<GatewayPayment>): GatewayPayment => ({
            paymentId: '1',
            status: 'approved',
            amount: 100,
            currency: 'COP',
            paidAt: new Date(),
            method: 'PSE',
            linkRef: 'r',
            note: null,
            ...over,
        });
        const link = { status: 'pending' as const, amount: 100, currency: 'COP', paymentId: null };
        expect(nextLinkState(link, pay({}))?.status).toBe('approved');
        expect(nextLinkState(link, pay({ amount: 90 }))?.status).toBe('mismatch');
        expect(nextLinkState(link, pay({ currency: 'USD' }))?.status).toBe('mismatch');
        // Un pagado no se "despaga" con un intento rechazado de OTRO pago…
        const paid = { status: 'approved' as const, amount: 100, currency: 'COP', paymentId: '1' };
        expect(nextLinkState(paid, pay({ paymentId: '2', status: 'rejected' }))).toBeNull();
        // …pero sí pasa a reembolsado si ESE pago se devolvió.
        expect(nextLinkState(paid, pay({ status: 'refunded' }))?.status).toBe('refunded');
        // El mismo aviso repetido no cambia nada.
        expect(nextLinkState(paid, pay({}))).toBeNull();
    });

    // ── Conectar ────────────────────────────────────────────────────────

    it('Mercado Pago: la credencial se verifica antes de guardarse y queda cifrada', async () => {
        fakeMercadoPago();
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'mercadopago', {
                fields: { access_token: 'APP_USR-mala' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow(/no reconoce/);
        expect(await connectors.list(tenantId, adminId, 'admin')).toHaveLength(0);

        const id = await connectMp();
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, id)));
        expect(JSON.stringify(row!.secrets)).not.toContain('APP_USR-buena');
        const conns = await svc.connectionsFor(tenantId, admin);
        expect(conns).toEqual([
            { id, name: expect.stringContaining('Mercado Pago'), provider: 'mercadopago', account_label: 'TIENDA_ACME', test_mode: false },
        ]);
    });

    it('Wompi: las dos llaves y el secreto de eventos se guardan cifrados (el secreto en su propio lugar)', async () => {
        net.handler = (call) =>
            call.url === `${WOMPI}/merchants/pub_test_abc`
                ? { status: 200, body: JSON.stringify({ data: { name: 'Acme SAS' } }) }
                : { status: 404, body: '' };
        await expect(
            connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wompi', {
                fields: { public_key: 'pub_test_abc', private_key: 'prv_prod_xyz' },
                visibility: 'workspace',
            }),
        ).rejects.toThrow(/mismo ambiente/);

        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wompi', {
            fields: { public_key: 'pub_test_abc', private_key: 'prv_test_xyz', events_secret: 'test_events_s3creto' },
            visibility: 'workspace',
        });
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(connections).where(eq(connections.id, connection.id)));
        const secrets = row!.secrets as Record<string, string>;
        expect(JSON.stringify(secrets)).not.toContain('prv_test_xyz');
        expect(JSON.stringify(secrets)).not.toContain('test_events_s3creto');
        expect(typeof secrets.signing_secret).toBe('string');
        const creds = await connectors.integrationCredsFor(tenantId, connection.id);
        expect(creds?.creds.secret).toBe('prv_test_xyz');
        expect(creds?.creds.signingSecret).toBe('test_events_s3creto');
        expect((await svc.connectionsFor(tenantId, admin))[0]).toMatchObject({ provider: 'wompi', test_mode: true, account_label: 'Acme SAS (prueba)' });

        // Actualizar sin re-escribir las llaves conserva las dos.
        await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wompi', {
            fields: { public_key: 'pub_test_abc' },
            visibility: 'workspace',
            connection_id: connection.id,
        });
        const again = await connectors.integrationCredsFor(tenantId, connection.id);
        expect(again?.creds.signingSecret).toBe('test_events_s3creto');
    });

    // ── Cobrar desde un registro + aviso ────────────────────────────────

    it('crear un link desde el registro: queda en las columnas de cobro y el aviso lo pasa a pagado', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const inv = await seedInvoice();

        // Sin columnas de cobro todavía: el panel lo dice y sugiere monto/correo.
        const before = await svc.recordPayments(tenantId, admin, inv.slug, inv.recordId);
        expect(before.fields).toBeNull();
        expect(before.can_setup).toBe(true);
        expect(before.suggested).toEqual({ title: 'FAC-001', amount: 150000, currency: 'COP', payer_email: 'cliente@correo.test' });

        const mapping = await svc.setupFields(tenantId, admin, inv.slug);
        // Volver a armarlas no duplica.
        expect(await svc.setupFields(tenantId, admin, inv.slug)).toEqual(mapping);

        const link = await svc.createForRecord(tenantId, admin, inv.slug, inv.recordId, {
            connection_id: connId,
            title: 'Factura FAC-001',
            amount: 150000,
            currency: 'COP',
            payer_email: 'cliente@correo.test',
            expires_days: 7,
        });
        expect(link).toMatchObject({ provider: 'mercadopago', status: 'pending', amount: 150000, currency: 'COP' });
        expect(link.url).toContain('pref_id=pref-1');
        const pref = mp.prefs[0]!;
        expect(pref.external_reference).toMatch(/^ib_/);
        expect(pref.notification_url).toMatch(/^https:\/\/app\.imagina\.test\/api\/v1\/public\/collections\//);
        expect((pref.items as Array<Record<string, unknown>>)[0]).toMatchObject({ unit_price: 150000, currency_id: 'COP', title: 'Factura FAC-001' });
        expect(pref.payer).toEqual({ email: 'cliente@correo.test' });

        let data = await recordData(inv.listId, inv.recordId);
        expect(data[`f${mapping.link}`]).toBe(link.url);
        expect(data[`f${mapping.status}`]).toBe('pendiente');
        expect(dispatcher.events.at(-1)).toMatchObject({ trigger: 'record_updated', recordId: inv.recordId });

        // El cliente paga por PSE: Mercado Pago avisa SÓLO con el id; el estado se relee.
        mp.payments.set('9001', {
            id: 9001,
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: 150000,
            currency_id: 'COP',
            date_approved: '2026-10-03T15:00:00.000-05:00',
            payment_method_id: 'pse',
            payment_type_id: 'bank_transfer',
            external_reference: pref.external_reference,
        });
        const token = await hookToken(connId);
        dispatcher.events.length = 0;
        expect(await svc.handleHook(token, { 'data.id': '9001', type: 'payment' }, { type: 'payment', data: { id: '9001' } })).toBe('applied');
        // El reintento del proveedor no cambia nada.
        expect(await svc.handleHook(token, {}, { type: 'payment', data: { id: '9001' } })).toBe('ignored');

        data = await recordData(inv.listId, inv.recordId);
        expect(data[`f${mapping.status}`]).toBe('pagado');
        expect(data[`f${mapping.paid_amount}`]).toBe(150000);
        expect(data[`f${mapping.method}`]).toBe('PSE');
        expect(data[`f${mapping.paid_at}`]).toBe('2026-10-03T20:00:00.000Z');

        const triggers = dispatcher.events.map((e) => e.trigger);
        expect(triggers).toEqual(['record_updated', 'payment_received']);
        const paidEvent = dispatcher.events.find((e) => e.trigger === 'payment_received')!;
        expect(paidEvent.payment).toMatchObject({ estado: 'Pagado', monto_pagado: 150000, metodo: 'PSE', link: link.url, concepto: 'Factura FAC-001' });

        const panel = await svc.recordPayments(tenantId, admin, inv.slug, inv.recordId);
        expect(panel.links[0]).toMatchObject({ status: 'approved', paid_amount: 150000, method: 'PSE', payment_id: '9001' });
        expect(panel.fields).toMatchObject({ status: expect.any(String), link: expect.any(String) });

        const detail = await svc.connectionDetail(tenantId, admin, connId);
        expect(detail.totals).toEqual({ pending: 0, approved: 1, approved_amount: 150000 });
        expect(detail.links[0]).toMatchObject({ record_title: 'FAC-001', list_name: 'Facturas' });
        expect(detail.hook_needs_setup).toBe(false);
        expect(detail.last_hook_at).not.toBeNull();
    });

    it('un aviso no se cree: con el pago por OTRO monto queda «Monto distinto», y un id ajeno no toca nada', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const inv = await seedInvoice();
        await svc.setupFields(tenantId, admin, inv.slug);
        await svc.createForRecord(tenantId, admin, inv.slug, inv.recordId, { connection_id: connId, title: 'Factura', amount: 150000, currency: 'COP' });
        const ref = mp.prefs[0]!.external_reference as string;
        const token = await hookToken(connId);

        // Un pago de otra preferencia (otra empresa, otro sistema) se ignora.
        mp.payments.set('7', { id: 7, status: 'approved', transaction_amount: 150000, currency_id: 'COP', external_reference: 'ib_de_otro' });
        expect(await svc.handleHook(token, {}, { type: 'payment', data: { id: '7' } })).toBe('ignored');
        // Un token inventado tampoco.
        expect(await svc.handleHook('x'.repeat(32), {}, { type: 'payment', data: { id: '7' } })).toBe('unknown_token');

        mp.payments.set('8', { id: 8, status: 'approved', transaction_amount: 1500, currency_id: 'COP', external_reference: ref });
        expect(await svc.handleHook(token, {}, { type: 'payment', data: { id: '8' } })).toBe('applied');
        const [link] = await svc.recordPayments(tenantId, admin, inv.slug, inv.recordId).then((p) => p.links);
        expect(link).toMatchObject({ status: 'mismatch', paid_amount: 1500 });
        expect(link!.note).toMatch(/Se pagó 1500/);
        // «Monto distinto» NO dispara «Cuando se recibe un pago».
        expect(dispatcher.events.some((e) => e.trigger === 'payment_received')).toBe(false);
    });

    it('«Verificar» encuentra el pago aunque el aviso no haya llegado; un rechazo posterior no lo despaga; el reembolso sí', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const inv = await seedInvoice();
        const link = await svc.createForRecord(tenantId, admin, inv.slug, inv.recordId, { connection_id: connId, title: 'Factura', amount: 150000, currency: 'COP' });
        const ref = mp.prefs[0]!.external_reference as string;

        mp.payments.set('1', { id: 1, status: 'rejected', status_detail: 'cc_rejected_insufficient_amount', transaction_amount: 150000, currency_id: 'COP', external_reference: ref, payment_method_id: 'visa', payment_type_id: 'credit_card' });
        let checked = await svc.verifyLink(tenantId, admin, link.id);
        expect(checked).toMatchObject({ status: 'rejected', note: 'Rechazado: fondos insuficientes.' });

        mp.payments.set('2', { id: 2, status: 'approved', transaction_amount: 150000, currency_id: 'COP', external_reference: ref, payment_method_id: 'nequi', date_approved: '2026-10-03T10:00:00Z' });
        checked = await svc.verifyLink(tenantId, admin, link.id);
        expect(checked).toMatchObject({ status: 'approved', method: 'Nequi', payment_id: '2' });
        expect(checked.last_checked_at).not.toBeNull();

        // Un intento rechazado DESPUÉS (otro pago) no cambia nada.
        mp.payments.set('3', { id: 3, status: 'rejected', transaction_amount: 150000, currency_id: 'COP', external_reference: ref });
        const token = await hookToken(connId);
        expect(await svc.handleHook(token, {}, { type: 'payment', data: { id: '3' } })).toBe('ignored');

        // El reembolso de ESE pago sí.
        mp.payments.set('2', { ...mp.payments.get('2')!, status: 'refunded' });
        expect(await svc.handleHook(token, {}, { type: 'payment', data: { id: '2' } })).toBe('applied');
        expect((await svc.recordPayments(tenantId, admin, inv.slug, inv.recordId)).links[0]!.status).toBe('refunded');
    });

    it('Wompi: crea el link en COP, rechaza un aviso con firma falsa y aplica el bueno releyendo la transacción', async () => {
        const txs = new Map<string, Record<string, unknown>>();
        net.handler = (call) => {
            if (call.url === `${WOMPI}/merchants/pub_test_abc`) return { status: 200, body: JSON.stringify({ data: { name: 'Acme SAS' } }) };
            if (call.url === `${WOMPI}/payment_links` && call.method === 'POST') {
                expect(call.headers?.authorization).toBe('Bearer prv_test_xyz');
                const body = JSON.parse(call.body!) as Record<string, unknown>;
                expect(body).toMatchObject({ currency: 'COP', amount_in_cents: 8990000, single_use: true });
                return { status: 201, body: JSON.stringify({ data: { id: 'lnk_123' } }) };
            }
            const m = /\/transactions\/([\w-]+)$/.exec(call.url);
            if (m) {
                const t = txs.get(m[1]!);
                return t ? { status: 200, body: JSON.stringify({ data: t }) } : { status: 404, body: '{}' };
            }
            return { status: 404, body: '' };
        };
        const { connection } = await connectors.connectIntegrationKey(tenantId, adminId, 'admin', 'wompi', {
            fields: { public_key: 'pub_test_abc', private_key: 'prv_test_xyz', events_secret: 'test_events_s3creto' },
            visibility: 'workspace',
        });
        const inv = await seedInvoice();
        const mapping = await svc.setupFields(tenantId, admin, inv.slug);

        await expect(
            svc.createForRecord(tenantId, admin, inv.slug, inv.recordId, { connection_id: connection.id, title: 'Factura', amount: 1000, currency: 'COP' }),
        ).rejects.toThrow(/1\.500/);

        const link = await svc.createForRecord(tenantId, admin, inv.slug, inv.recordId, { connection_id: connection.id, title: 'Factura', amount: 89900, currency: 'COP' });
        expect(link.url).toBe('https://checkout.wompi.co/l/lnk_123');

        const detail = await svc.connectionDetail(tenantId, admin, connection.id);
        expect(detail).toMatchObject({ hook_needs_setup: true, events_secret_set: true });
        const token = detail.hook_url.split('/').pop()!;

        txs.set('tx-1', { id: 'tx-1', status: 'APPROVED', amount_in_cents: 8990000, currency: 'COP', payment_method_type: 'NEQUI', payment_link_id: 'lnk_123', finalized_at: '2026-10-03T12:00:00.000Z' });
        const event = (checksum: string) => ({
            event: 'transaction.updated',
            data: { transaction: { id: 'tx-1', status: 'APPROVED', amount_in_cents: 8990000 } },
            signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum },
            timestamp: 1700000000,
        });
        expect(await svc.handleHook(token, {}, event('0'.repeat(64)))).toBe('bad_signature');
        expect((await recordData(inv.listId, inv.recordId))[`f${mapping.status}`]).toBe('pendiente');

        const good = createHash('sha256').update('tx-1APPROVED89900001700000000test_events_s3creto').digest('hex');
        expect(await svc.handleHook(token, {}, event(good))).toBe('applied');
        const data = await recordData(inv.listId, inv.recordId);
        expect(data[`f${mapping.status}`]).toBe('pagado');
        expect(data[`f${mapping.paid_amount}`]).toBe(89900);
        expect(data[`f${mapping.method}`]).toBe('Nequi');
    });

    // ── Automatizaciones ────────────────────────────────────────────────

    it('la automatización crea el link con un monto «150.000» y la acción siguiente lo usa con {{pago.link}}', async () => {
        const mp = fakeMercadoPago();
        const connId = await connectMp();
        const inv = await seedInvoice();
        const mapping = await svc.setupFields(tenantId, admin, inv.slug);
        const sent: FakeCall[] = [];
        const prev = net.handler;
        net.handler = (call) => {
            if (call.url === 'https://hooks.example.test/whatsapp') {
                sent.push(call);
                return { status: 200, body: '{}' };
            }
            return prev(call);
        };
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId: inv.listId,
                    name: 'Cobrar al crear',
                    triggerType: 'record_created',
                    triggerConfig: {},
                    actions: [
                        {
                            type: 'connector_action',
                            config: {
                                connection_id: connId,
                                action_key: 'create_payment_link',
                                values: { title: 'Factura {{numero}}', amount: '150.000', currency: 'COP', expires_days: '3' },
                            },
                        },
                        {
                            type: 'call_webhook',
                            config: { url: 'https://hooks.example.test/whatsapp', method: 'POST', body_template: '{"msg":"Paga aquí: {{pago.link}} ({{pago.monto}})"}' },
                        },
                    ],
                    isActive: true,
                })
                .returning(),
        );
        const data = await recordData(inv.listId, inv.recordId);
        await engine.process({ tenantId, listId: inv.listId, recordId: inv.recordId, trigger: 'record_created', after: data });

        const [run] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        expect(run!.status).toBe('success');
        const items = (mp.prefs[0]!.items as Array<Record<string, unknown>>)[0]!;
        expect(items).toMatchObject({ unit_price: 150000, title: 'Factura FAC-001' });
        expect(sent[0]!.body).toContain('Paga aquí: https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-1 (150000)');
        expect((await recordData(inv.listId, inv.recordId))[`f${mapping.status}`]).toBe('pendiente');
    });

    it('«Cuando se recibe un pago» corre con {{pago.*}}; en solo-lectura no corre', async () => {
        fakeMercadoPago();
        const inv = await seedInvoice();
        const nota = await fieldsService.create(tenantId, inv.slug, { label: 'Nota', type: 'text' });
        const [auto] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(automations)
                .values({
                    tenantId,
                    listId: inv.listId,
                    name: 'Gracias por pagar',
                    triggerType: 'payment_received',
                    triggerConfig: {},
                    actions: [{ type: 'update_field', config: { values: { nota: 'Pagó {{pago.monto_pagado}} por {{pago.metodo}}' } } }],
                    isActive: true,
                })
                .returning(),
        );
        const event: TriggerEvent = {
            tenantId,
            listId: inv.listId,
            recordId: inv.recordId,
            trigger: 'payment_received',
            after: await recordData(inv.listId, inv.recordId),
            payment: { monto_pagado: 150000, metodo: 'PSE' },
        };
        await engine.process(event);
        expect((await recordData(inv.listId, inv.recordId))[`f${nota.id}`]).toBe('Pagó 150000 por PSE');
        const runs = await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)));
        expect(runs).toHaveLength(1);
        // Un record_updated NO dispara la de pago.
        await engine.process({ ...event, trigger: 'record_updated', payment: undefined });
        expect(await withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, auto!.id)))).toHaveLength(1);
    });

    // ── Permisos, aislamiento y vencimiento ─────────────────────────────

    it('aislamiento: otra empresa no ve los links, un agente sólo cobra lo suyo y un link vencido pasa a «Vencido»', async () => {
        fakeMercadoPago();
        const connId = await connectMp();
        const inv = await seedInvoice();
        const mapping = await svc.setupFields(tenantId, admin, inv.slug);
        const link = await svc.createForRecord(tenantId, admin, inv.slug, inv.recordId, {
            connection_id: connId,
            title: 'Factura',
            amount: 150000,
            currency: 'COP',
            expires_days: 1,
        });

        // RLS: otra empresa no ve la fila ni puede consultarla.
        const foreign = await withTenant(pg.db, otherTenantId, (tx) => tx.select().from(paymentLinks));
        expect(foreign).toHaveLength(0);
        await expect(svc.verifyLink(otherTenantId, { userId: adminId, role: 'admin' }, link.id)).rejects.toThrow(/no encontrado/);

        // Un agente (edita sólo lo suyo) no cobra un registro ajeno.
        await expect(
            svc.createForRecord(tenantId, { userId: agentId, role: 'agent' }, inv.slug, inv.recordId, {
                connection_id: connId,
                title: 'x',
                amount: 1000,
                currency: 'COP',
            }),
        ).rejects.toThrow(/no encontrado/);

        // Vencimiento: un link pendiente con fecha pasada pasa a «Vencido».
        await withTenant(pg.db, tenantId, (tx) =>
            tx.update(paymentLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(paymentLinks.id, link.id)),
        );
        expect(await svc.expireDue()).toBe(1);
        expect((await recordData(inv.listId, inv.recordId))[`f${mapping.status}`]).toBe('vencido');
        expect(await svc.expireDue()).toBe(0);

        // Anular: sólo un pendiente.
        await expect(svc.cancelLink(tenantId, admin, link.id)).rejects.toThrow(/pendiente/);
    });
});
