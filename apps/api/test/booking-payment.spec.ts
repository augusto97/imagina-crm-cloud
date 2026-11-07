import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDaysYmd, bookingConfigSchema, zonedInstant, zonedToday, type BookingConfig, type BusyInterval, type Field } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v0.1.387 — Cobrar al agendar. Postgres y Redis reales; lo simulado es el
 * borde: la API de Mercado Pago (`safeWebhookFetch`, como en
 * `collections.spec`), el transporte de correo y el calendario externo.
 *
 * Lo que se prueba es lo nuestro: con «pagar para confirmar» la cita queda
 * «Esperando el pago» con el horario apartado; el aviso del proveedor (que se
 * RELEE) la confirma; si vence sin pagar se libera; un pago que llega tarde
 * vuelve a tomar el horario si sigue libre o avisa al equipo; el equipo la
 * marca pagada a mano; y con aprobación, primero se paga y después se aprueba.
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
import { BookingAvailabilityService } from '../src/booking/booking-availability.service';
import { BookingCalendarService, type CalendarEventInput, type CreatedCalendarEvent, type StaffCalendarRef } from '../src/booking/booking-calendar';
import { BookingMyCalendarService } from '../src/booking/booking-my-calendar.service';
import { BookingPublicService } from '../src/booking/booking-public.service';
import { BookingService } from '../src/booking/booking.service';
import { CollectionsService } from '../src/collections/collections.service';
import { loadEnv, type Env } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { IntegrationAppsService } from '../src/connectors/integration-apps.service';
import { bookingAppointments, bookingPages, memberships, paymentLinks, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import type { IncidentHub } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotifyHub, type NotifyEvent } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { NO_HOLIDAYS } from './helpers/no-holidays';
import { memoryOAuthStore } from './helpers/oauth-store';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const KEY = 'clave-de-test-32-bytes-o-lo-que-sea';
const MP = 'https://api.mercadopago.com';
const TZ = 'America/Bogota';
const at = (ymd: string, h: number, m = 0): string => zonedInstant(ymd, TZ, { h, m }).toISOString();

class CapturingDispatcher extends AutomationDispatcher {
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

/** Un calendario que no tiene nada ocupado y anota los eventos que crea la agenda. */
class FakeCalendar extends BookingCalendarService {
    created: CalendarEventInput[] = [];
    constructor(env: Env, redis: IORedis, tenantDb: TenantDb) {
        super(tenantDb, undefined as never, redis as never, env);
    }
    override busy(): Promise<BusyInterval[]> {
        return Promise.resolve([]);
    }
    override createEvent(_t: number, ref: StaffCalendarRef | number, input: CalendarEventInput): Promise<CreatedCalendarEvent> {
        this.created.push(input);
        const id = typeof ref === 'number' ? ref : ref.connectionId;
        return Promise.resolve({
            event: { connection_id: id, provider: 'google_calendar', event_id: `ev${this.created.length}`, calendar: 'primary', start: input.start.toISOString(), end: input.end.toISOString() },
            meeting: null,
            meetingError: null,
        });
    }
}

/** Un día hábil (lunes a viernes) a partir de `fromYmd`. */
function workday(fromYmd: string): string {
    let ymd = fromYmd;
    for (;;) {
        const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
        if (dow !== 0 && dow !== 6) return ymd;
        ymd = addDaysYmd(ymd, 1);
    }
}

describe('v0.1.387 — cobrar al agendar (Postgres + Redis reales, Mercado Pago simulado)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let connectors: ConnectorsService;
    let collections: CollectionsService;
    let booking: BookingService;
    let pub: BookingPublicService;
    let tenantId: number;
    let ana = 0;
    let beto = 0;
    let connId = 0;
    let listId = 0;
    let pageId = 0;
    let token = '';
    let D = '';
    const dispatcher = new CapturingDispatcher();
    const mailbox = new CapturingMail();
    const notified: NotifyEvent[] = [];
    const incidents: Array<{ key: string; title: string; message: string }> = [];
    const f: Record<string, Field> = {};
    const payments = new Map<string, Record<string, unknown>>();
    const prefs: Array<Record<string, unknown>> = [];
    let ipSeq = 0;
    const nextIp = (): string => `198.51.100.${(ipSeq++ % 250) + 1}`;

    function fakeMercadoPago(): void {
        payments.clear();
        prefs.length = 0;
        net.handler = (call) => {
            if (call.url === `${MP}/users/me`) return { status: 200, body: JSON.stringify({ id: 123, nickname: 'CLINICA', site_id: 'MCO' }) };
            if (call.url === `${MP}/checkout/preferences` && call.method === 'POST') {
                prefs.push(JSON.parse(call.body!) as Record<string, unknown>);
                return { status: 201, body: JSON.stringify({ id: `pref-${prefs.length}`, init_point: `https://www.mercadopago.com.co/checkout/v1/redirect?pref_id=pref-${prefs.length}` }) };
            }
            const m = /\/v1\/payments\/(\d+)$/.exec(call.url);
            if (m) {
                const p = payments.get(m[1]!);
                return p ? { status: 200, body: JSON.stringify(p) } : { status: 404, body: '{}' };
            }
            if (call.url.startsWith(`${MP}/v1/payments/search`)) {
                const ref = new URL(call.url).searchParams.get('external_reference');
                return { status: 200, body: JSON.stringify({ results: [...payments.values()].filter((p) => p.external_reference === ref).reverse() }) };
            }
            return { status: 404, body: '' };
        };
    }

    const stamp = (id: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('bookstamp', id, ts)}`;
    };
    const week = (intervals: Array<{ start: string; end: string }>) => [[], intervals, intervals, intervals, intervals, intervals, []];

    function pageConfig(mutate: (c: BookingConfig) => void = () => undefined): BookingConfig {
        const c = bookingConfigSchema.parse({
            settings: { title: 'Clínica Sonrisa' },
            services: [
                { id: 'svclimpieza', name: 'Limpieza', duration_min: 30, price: 80000 },
                { id: 'svcvaloracion', name: 'Valoración', duration_min: 30, payment: 'none' },
            ],
            staff: [{ id: 'stfana', kind: 'user', staff_user_id: ana, availability: { week: week([{ start: '08:00', end: '17:00' }]) } }],
            rules: { min_notice_min: 60, max_days_ahead: 60, slot_interval_min: 30, buffer_after_min: 0 },
            mapping: {
                start_field_id: f.inicio!.id,
                person_field_id: f.profesional!.id,
                service_field_id: f.servicio!.id,
                name_field_id: f.cliente!.id,
                email_field_id: f.email!.id,
                status_field_id: f.estado!.id,
            },
            payment: { enabled: true, connection_id: connId, mode: 'required', amount: 'full', hold_minutes: 30, currency: 'COP' },
        });
        mutate(c);
        return c;
    }

    async function freshPage(mutate?: (c: BookingConfig) => void): Promise<void> {
        const dto = await booking.create(tenantId, ana, 'citas', { name: 'Clínica Sonrisa' });
        await booking.update(tenantId, 'citas', dto.id, { config: pageConfig(mutate) });
        const live = await booking.update(tenantId, 'citas', dto.id, { enabled: true });
        expect(live.problems).toEqual([]);
        pageId = live.id;
        token = live.public_path.split('/').pop()!;
        pub.forgetLists(tenantId);
    }

    function book(input: { service?: string; start: string; email?: string; name?: string }) {
        return pub.book(token, nextIp(), {
            service_id: input.service ?? 'svclimpieza',
            staff_id: 'any',
            start: input.start,
            name: input.name ?? 'Luis Gómez',
            email: input.email ?? 'luis@cliente.co',
            phone: '+57 300 111 2233',
            values: {},
            stamp: stamp(pageId),
            time_zone: TZ,
        });
    }

    const refOf = (manageUrl: string): string => manageUrl.split('/manage/')[1]!;
    const appointments = () => withTenant(pg.db, tenantId, (tx) => tx.select().from(bookingAppointments).where(eq(bookingAppointments.pageId, pageId)));
    const linkOf = async (id: number) => (await withTenant(pg.db, tenantId, (tx) => tx.select().from(paymentLinks).where(eq(paymentLinks.id, id))))[0]!;
    const statusLabel = async (recordId: number): Promise<string | null> => {
        const [r] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(and(eq(records.tenantId, tenantId), eq(records.id, recordId))));
        const value = (r!.data as Record<string, unknown>)[`f${f.estado!.id}`];
        const fields = await fieldsSvc.listByListId(tenantId, listId);
        const opts = ((fields.find((x) => x.id === f.estado!.id)!.config as { options?: Array<{ value: string; label: string }> }).options ?? []);
        return opts.find((o) => o.value === value)?.label ?? null;
    };
    const hookToken = async (): Promise<string> => (await collections.hookUrlFor(tenantId, connId, 'mercadopago')).split('/').pop()!;

    /** El cliente paga: Mercado Pago avisa con el id y el estado se relee. */
    async function pay(paymentId: string, prefIndex: number, amount = 80000): Promise<void> {
        payments.set(paymentId, {
            id: Number(paymentId),
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: amount,
            currency_id: 'COP',
            date_approved: new Date().toISOString(),
            payment_method_id: 'pse',
            payment_type_id: 'bank_transfer',
            external_reference: prefs[prefIndex]!.external_reference,
        });
        expect(await collections.handleHook(await hookToken(), {}, { type: 'payment', data: { id: paymentId } })).toBe('applied');
    }

    /** Lo que sigue al pago corre después de responder al aviso: se espera a que la cita cambie. */
    async function waitStatus(id: number, status: string): Promise<void> {
        for (let i = 0; i < 60; i++) {
            const row = (await appointments()).find((a) => a.id === id);
            if (row?.status === status) return;
            await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`La cita ${id} no llegó a «${status}»`);
    }

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        const env = loadEnv({ REDIS_URL: rd.url, SECRETS_KEY: KEY, FILES_SIGNING_SECRET: 'book-pay-secret', APP_BASE_URL: 'https://app.test' });
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const store = memoryOAuthStore();
        const audit = new AuditService(tenantDb);
        connectors = new ConnectorsService(tenantDb, pg.db, env, store, audit, new IntegrationAppsService(store, env));
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), lists);
        const hub = new RecordChangeHub();
        const recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activity, dispatcher, new RelationsRepository(), undefined, hub);
        collections = new CollectionsService(tenantDb, pg.db, env, connectors, lists, new RecordsRepository(), activity, rt, dispatcher, audit, fieldsSvc);
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-bookpay-'))), env);
        const calendar = new FakeCalendar(env, redis, tenantDb);
        const availability = new BookingAvailabilityService(tenantDb, calendar, NO_HOLIDAYS);
        const myCalendar = new BookingMyCalendarService(tenantDb, calendar, null as never, { resolve: () => Promise.resolve({}) } as never);
        booking = new BookingService(pg.db, tenantDb, lists, fieldsSvc, availability, NO_HOLIDAYS, calendar, myCalendar, undefined, undefined, collections);
        const notify = new NotifyHub();
        notify.subscribe((e) => {
            notified.push(e);
        });
        const incidentHub = {
            report: (i: { key: string; title: string; message: string }) => incidents.push(i),
            resolve: () => undefined,
        } as unknown as IncidentHub;
        pub = new BookingPublicService(
            pg.db,
            tenantDb,
            lists,
            fieldsSvc,
            recs,
            files,
            redis as never,
            dispatcher,
            env,
            availability,
            calendar,
            rt,
            hub,
            notify,
            incidentHub,
            undefined,
            undefined,
            new MailService(env, mailbox),
            undefined,
            undefined,
            undefined,
            collections,
        );
        pub.onModuleInit();

        const [t] = await pg.db.insert(tenants).values({ slug: 'sonrisa', name: 'Clínica Sonrisa', settings: { format: { timezone: TZ, number_format: 'dot_comma' } } }).returning();
        tenantId = t!.id;
        const [ua] = await pg.db.insert(users).values({ email: 'ana@sonrisa.test', name: 'Ana Ruiz', passwordHash: 'x' }).returning();
        const [ub] = await pg.db.insert(users).values({ email: 'beto@sonrisa.test', name: 'Beto Díaz', passwordHash: 'x' }).returning();
        ana = ua!.id;
        beto = ub!.id;
        await pg.db.insert(memberships).values([
            { userId: ana, tenantId, role: 'admin' },
            { userId: beto, tenantId, role: 'viewer' },
        ]);
        listId = (await lists.create(tenantId, { name: 'Citas' })).id;
        f.inicio = await fieldsSvc.create(tenantId, 'citas', { label: 'Fecha y hora', type: 'datetime', slug: 'inicio' });
        f.profesional = await fieldsSvc.create(tenantId, 'citas', { label: 'Profesional', type: 'user', slug: 'profesional' });
        f.servicio = await fieldsSvc.create(tenantId, 'citas', { label: 'Servicio', type: 'select', slug: 'servicio', config: { options: [] } });
        f.cliente = await fieldsSvc.create(tenantId, 'citas', { label: 'Cliente', type: 'text', slug: 'cliente' });
        f.email = await fieldsSvc.create(tenantId, 'citas', { label: 'Correo', type: 'email', slug: 'email' });
        f.estado = await fieldsSvc.create(tenantId, 'citas', { label: 'Estado', type: 'select', slug: 'estado', config: { options: [] } });

        fakeMercadoPago();
        const { connection } = await connectors.connectIntegrationKey(tenantId, ana, 'admin', 'mercadopago', {
            fields: { access_token: 'APP_USR-buena' },
            visibility: 'workspace',
        });
        connId = connection.id;
        D = workday(addDaysYmd(zonedToday(TZ, new Date()), 5));
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        // Lo que sigue a una reserva (correo, calendario) corre después de responder.
        await new Promise((r) => setTimeout(r, 300));
        net.calls.length = 0;
        dispatcher.events.length = 0;
        mailbox.sent.length = 0;
        notified.length = 0;
        incidents.length = 0;
        fakeMercadoPago();
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(bookingPages).where(eq(bookingPages.tenantId, tenantId));
            await tx.delete(paymentLinks).where(eq(paymentLinks.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    it('pagar para confirmar: queda «Esperando el pago» con el horario apartado y el pago la confirma', async () => {
        await freshPage();
        const meta = await pub.meta(token);
        expect(meta.services.find((s) => s.id === 'svclimpieza')?.pay).toMatchObject({ kind: 'full', required: true });
        expect(meta.services.find((s) => s.id === 'svcvaloracion')?.pay ?? null).toBeNull();

        const res = await book({ start: at(D, 9) });
        expect(res.pay_redirect).toBe(true);
        expect(res.appointment!.status).toBe('unpaid');
        expect(res.appointment!.payment).toMatchObject({ status: 'pending', required: true, kind: 'full', provider: 'mercadopago' });
        expect(res.appointment!.payment?.url).toContain('mercadopago.com.co');
        expect(res.appointment!.payment?.amount_label).toBe('$ 80.000 COP');
        // El link: el monto lo decidió el servidor, vuelve a la página de la cita y vence con el horario.
        expect(prefs).toHaveLength(1);
        expect((prefs[0]!.items as Array<{ unit_price: number }>)[0]!.unit_price).toBe(80000);
        expect((prefs[0]!.back_urls as { success: string }).success).toContain('?pago=1');
        const [appt] = await appointments();
        expect(appt!.status).toBe('unpaid');
        expect(appt!.paymentLinkId).not.toBeNull();
        expect(appt!.paymentUntil!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
        expect(appt!.paymentUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
        expect((await linkOf(appt!.paymentLinkId!)).expiresAt?.getTime()).toBe(appt!.paymentUntil!.getTime());
        expect(await statusLabel(appt!.recordId)).toBe('Esperando el pago');
        // Nadie del equipo se entera todavía, ni sale el disparador de la agenda.
        expect(dispatcher.events.some((e) => e.trigger === 'booking_event')).toBe(false);
        expect(notified).toHaveLength(0);
        await new Promise((r) => setTimeout(r, 200));
        expect(mailbox.sent.map((m) => m.subject)).toEqual([expect.stringContaining('Completa el pago')]);

        // El horario está apartado: otra persona no lo toma.
        const slots = await pub.slots(token, nextIp(), { service: 'svclimpieza', staff: 'stfana', from: D, to: D });
        expect(slots.slots.some((s) => s.start === at(D, 9))).toBe(false);
        await expect(book({ start: at(D, 9), email: 'otra@cliente.co' })).rejects.toMatchObject({ status: 409 });

        // Paga: el aviso trae sólo el id; el estado se relee y la cita se confirma.
        mailbox.sent.length = 0;
        await pay('5001', 0);
        await waitStatus(appt!.id, 'confirmed');
        const [after] = await appointments();
        expect(after!.paymentUntil).toBeNull();
        expect(await statusLabel(after!.recordId)).toBe('Confirmada');
        expect(dispatcher.events.some((e) => e.trigger === 'booking_event' && (e as { booking?: { event?: string } }).booking?.event === 'booked')).toBe(true);
        await new Promise((r) => setTimeout(r, 300));
        expect(mailbox.sent.some((m) => /confirmad/i.test(m.subject))).toBe(true);
        // La página de la cita (al volver del checkout) lo dice.
        const st = await pub.paymentStatus(refOf(res.appointment!.manage_url), nextIp());
        expect(st.status).toBe('confirmed');
        expect(st.payment).toMatchObject({ status: 'paid', url: null });
    });

    it('vence sin pagar: se libera el horario; un pago que llega tarde lo vuelve a tomar si sigue libre', async () => {
        await freshPage();
        const res = await book({ start: at(D, 10) });
        const [appt] = await appointments();
        expect(appt!.status).toBe('unpaid');
        mailbox.sent.length = 0;

        // Antes de liberar se le pregunta al proveedor; no pagó: se libera y se le avisa.
        expect(await pub.expireUnpaid(new Date(Date.now() + 31 * 60_000))).toBe(1);
        const [gone] = await appointments();
        expect(gone!.status).toBe('cancelled');
        expect(gone!.paymentUntil).not.toBeNull();
        expect(await statusLabel(gone!.recordId)).toBe('Cancelada');
        expect((await linkOf(gone!.paymentLinkId!)).status).toBe('expired');
        await new Promise((r) => setTimeout(r, 200));
        expect(mailbox.sent.some((m) => m.subject.includes('no se confirmó'))).toBe(true);
        const slots = await pub.slots(token, nextIp(), { service: 'svclimpieza', staff: 'stfana', from: D, to: D });
        expect(slots.slots.some((s) => s.start === at(D, 10))).toBe(true);
        // Volver a barrer no hace nada.
        expect(await pub.expireUnpaid(new Date(Date.now() + 60 * 60_000))).toBe(0);

        // El pago llega tarde y el horario sigue libre: se vuelve a tomar y se confirma.
        await pay('5002', 0);
        await waitStatus(gone!.id, 'confirmed');
        expect(await statusLabel(gone!.recordId)).toBe('Confirmada');
        const st = await pub.paymentStatus(refOf(res.appointment!.manage_url), nextIp());
        expect(st.status).toBe('confirmed');
    });

    it('al volver del checkout la consulta confirma la cita en el acto, sin esperar el aviso del proveedor', async () => {
        await freshPage();
        const res = await book({ start: at(D, 13) });
        const [appt] = (await appointments()).filter((a) => a.status === 'unpaid');
        expect(appt).toBeTruthy();
        // El proveedor ya tiene el pago, pero el aviso todavía no llegó.
        payments.set('5010', {
            id: 5010,
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: 80000,
            currency_id: 'COP',
            date_approved: new Date().toISOString(),
            payment_method_id: 'pse',
            payment_type_id: 'bank_transfer',
            external_reference: prefs.at(-1)!.external_reference,
        });
        mailbox.sent.length = 0;
        const st = await pub.paymentStatus(refOf(res.appointment!.manage_url), nextIp());
        expect(st.status).toBe('confirmed');
        expect(st.payment).toMatchObject({ status: 'paid' });
        const meta = await pub.manageMeta(refOf(res.appointment!.manage_url));
        expect(meta.appointment.status).toBe('confirmed');
        // El aviso que llega después no confirma dos veces.
        await collections.handleHook(await hookToken(), {}, { type: 'payment', data: { id: '5010' } });
        await new Promise((r) => setTimeout(r, 400));
        expect(mailbox.sent.filter((m) => /confirmad/i.test(m.subject))).toHaveLength(1);
    });

    it('un pago tarde cuando el horario ya lo tomó otra persona: se avisa al equipo y al cliente', async () => {
        await freshPage();
        await book({ start: at(D, 11) });
        const [first] = await appointments();
        expect(await pub.expireUnpaid(new Date(Date.now() + 31 * 60_000))).toBe(1);
        // Otra persona toma el horario liberado (y paga).
        await book({ start: at(D, 11), email: 'otra@cliente.co', name: 'Marta Ríos' });
        await pay('5004', 1);
        const second = (await appointments()).find((a) => a.id !== first!.id)!;
        await waitStatus(second.id, 'confirmed');
        notified.length = 0;
        mailbox.sent.length = 0;

        // Llega el pago de la primera.
        await pay('5003', 0);
        for (let i = 0; i < 40 && notified.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
        const late = notified.at(-1) as Extract<NotifyEvent, { type: 'booking' }>;
        expect(late).toMatchObject({ type: 'booking', title: expect.stringContaining('Llegó el pago de Luis Gómez') });
        expect(late.userIds).toContain(ana);
        expect((await appointments()).find((a) => a.id === first!.id)!.status).toBe('cancelled');
        await new Promise((r) => setTimeout(r, 200));
        expect(mailbox.sent.some((m) => m.subject === 'Recibimos tu pago: Limpieza')).toBe(true);
    });

    it('el equipo la marca pagada a mano (pagó por otro medio); quien no aprueba, no puede', async () => {
        await freshPage();
        await book({ start: at(D, 13) });
        const [appt] = await appointments();
        const view = await pub.recordBooking(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId);
        expect(view).toMatchObject({ status: 'unpaid', can_mark_paid: true, payment: { status: 'pending' } });
        expect(view!.payment_until).not.toBeNull();
        await expect(pub.decide(tenantId, { userId: beto, role: 'viewer' }, 'citas', appt!.recordId, { decision: 'mark_paid' })).rejects.toMatchObject({ status: expect.any(Number) });

        const out = await pub.decide(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId, { decision: 'mark_paid' });
        expect(out.status).toBe('confirmed');
        expect(out.paid_marked_by_name).toBe('Ana Ruiz');
        expect(out.payment).toMatchObject({ status: 'paid', manual: true, url: null });
        expect(await statusLabel(appt!.recordId)).toBe('Confirmada');
        // El link deja de servir.
        expect((await linkOf(appt!.paymentLinkId!)).status).toBe('expired');
        // Dos veces no: ya no espera el pago.
        await expect(pub.decide(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId, { decision: 'mark_paid' })).rejects.toMatchObject({ status: 409 });
    });

    it('con aprobación: primero se paga y después queda «por confirmar»; un servicio sin cobro no pasa por el pago', async () => {
        await freshPage((c) => {
            c.approval = { ...c.approval, mode: 'all' };
        });
        const res = await book({ start: at(D, 14) });
        expect(res.appointment!.status).toBe('unpaid');
        const [appt] = await appointments();
        // Nadie aprueba todavía.
        expect(notified).toHaveLength(0);
        await pay('5005', 0);
        await waitStatus(appt!.id, 'pending');
        expect(await statusLabel(appt!.recordId)).toBe('Por confirmar');
        expect(notified.some((n) => n.type === 'booking' && n.userIds.includes(ana))).toBe(true);
        const view = await pub.recordBooking(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId);
        expect(view).toMatchObject({ status: 'pending', can_decide: true, payment: { status: 'paid' } });

        // La valoración es «sin cobro»: queda por confirmar sin link.
        const free = await book({ start: at(D, 15), service: 'svcvaloracion', email: 'gratis@cliente.co' });
        expect(free.appointment!.status).toBe('pending');
        expect(free.appointment!.payment ?? null).toBeNull();
        expect(free.pay_redirect).toBeUndefined();
        expect(prefs).toHaveLength(1);
    });

    it('confirma y paga después, con un anticipo del 30 %; sin cuenta de cobro, «pagar para confirmar» no aparta nada', async () => {
        await freshPage((c) => {
            c.payment = { ...c.payment, mode: 'optional', amount: 'deposit', deposit_kind: 'percent', deposit_value: 30, after: 'button' };
        });
        const res = await book({ start: at(D, 9, 30) });
        expect(res.appointment!.status).toBe('confirmed');
        expect(res.pay_redirect).toBeUndefined();
        expect(res.appointment!.payment).toMatchObject({ status: 'pending', kind: 'deposit', required: false, amount_label: '$ 24.000 COP' });
        expect((prefs[0]!.items as Array<{ unit_price: number }>)[0]!.unit_price).toBe(24000);
        const [appt] = await appointments();
        expect(appt!.paymentUntil).toBeNull();
        expect(dispatcher.events.some((e) => e.trigger === 'booking_event')).toBe(true);

        // La conexión deja de existir: «pagar para confirmar» rechaza la reserva (no aparta un horario que nunca se confirmaría).
        await freshPage();
        await withTenant(pg.db, tenantId, (tx) => tx.update(bookingPages).set({ config: { ...pageConfig(), payment: { ...pageConfig().payment, connection_id: 999_999 } } }).where(eq(bookingPages.id, pageId)));
        pub.forgetLists(tenantId);
        await expect(book({ start: at(D, 16) })).rejects.toMatchObject({ status: 503 });
        expect(incidents.some((i) => i.key === `booking-pay:${pageId}`)).toBe(true);
        expect((await appointments()).length).toBe(0);
    });
});
