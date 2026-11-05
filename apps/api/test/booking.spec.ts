import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    addDaysYmd,
    bookingConfigSchema,
    bookingServiceSchema,
    isColombianHoliday,
    newFormItemId,
    publicThemePresets,
    publicThemeSchema,
    ymdToMs,
    zonedInstant,
    zonedToday,
    type BookingConfig,
    type BusyInterval,
    type Field,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { NO_HOLIDAYS } from './helpers/no-holidays';
import { BookingAvailabilityService } from '../src/booking/booking-availability.service';
import { BookingMyCalendarService } from '../src/booking/booking-my-calendar.service';
import { BookingCalendarService, busyRequest, parseBusy, type CalendarEventInput, type CreatedCalendarEvent, type StaffCalendarRef } from '../src/booking/booking-calendar';
import { appointmentRecordData, sanitizeBookingConfig } from '../src/booking/booking-config';
import { bookingClientEmail } from '../src/booking/booking-email';
import { buildIcs, foldIcsLine } from '../src/booking/booking-ics';
import { renderBookingPage } from '../src/booking/booking-page';
import { BookingPublicService } from '../src/booking/booking-public.service';
import { PublicCache } from '../src/public-cache/public-cache';
import { BookingRemindersService } from '../src/booking/booking-reminders.service';
import { BookingService } from '../src/booking/booking.service';
import { BookingHolidaysService, colombianFallback, parseHolidayIcs } from '../src/booking/booking-holidays';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadEnv, type Env } from '../src/config/env';
import {
    attachments,
    bookingAppointments,
    bookingPages,
    connections,
    lists as listsTable,
    memberships,
    records,
    tenants,
    users,
    type BookingExternalEvent,
} from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
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
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

/**
 * D5 — Agenda de citas pública. Postgres y Redis reales; lo único simulado es
 * el borde: el transporte de correo y el calendario externo (Google/Outlook).
 */

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

class CapturingMailTransport implements MailTransport {
    readonly name = 'capture';
    readonly sent: MailMessage[] = [];
    send(message: MailMessage): Promise<void> {
        this.sent.push(message);
        return Promise.resolve();
    }
}

/** Google Calendar simulado: lo ocupado es lo que el test pone; los eventos se anotan. */
class FakeCalendar extends BookingCalendarService {
    busyByConn = new Map<number, BusyInterval[]>();
    created: Array<{ connectionId: number; input: CalendarEventInput }> = [];
    moved: Array<{ id: string; start: Date }> = [];
    deleted: string[] = [];
    constructor(env: Env, redis: IORedis, tenantDb: TenantDb) {
        super(tenantDb, undefined as never, redis as never, env);
    }
    override busy(_tenantId: number, ref: StaffCalendarRef | number): Promise<BusyInterval[]> {
        return Promise.resolve(this.busyByConn.get(typeof ref === 'number' ? ref : ref.connectionId) ?? []);
    }
    override createEvent(_tenantId: number, ref: StaffCalendarRef | number, input: CalendarEventInput): Promise<CreatedCalendarEvent> {
        const connectionId = typeof ref === 'number' ? ref : ref.connectionId;
        this.created.push({ connectionId, input });
        const n = this.created.length;
        return Promise.resolve({
            event: { connection_id: connectionId, provider: 'google_calendar', event_id: `ev${n}`, calendar: 'primary', start: input.start.toISOString(), end: input.end.toISOString() },
            meeting: input.meeting ? { url: `https://meet.google.com/fake-${n}`, provider: input.meeting } : null,
            meetingError: null,
        });
    }
    override moveEvent(_tenantId: number, ev: BookingExternalEvent, start: Date): Promise<void> {
        this.moved.push({ id: ev.event_id, start });
        return Promise.resolve();
    }
    override deleteEvent(_tenantId: number, ev: BookingExternalEvent): Promise<void> {
        this.deleted.push(ev.event_id);
        return Promise.resolve();
    }
}

const TZ = 'America/Bogota';
const at = (ymd: string, h: number, m = 0): string => zonedInstant(ymd, TZ, { h, m }).toISOString();
/** Un día hábil (lunes a viernes, no festivo) a partir de `fromYmd`. */
function workday(fromYmd: string): string {
    let ymd = fromYmd;
    for (;;) {
        const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (dow >= 1 && dow <= 5 && !isColombianHoliday(ymdToMs(y, m, d))) return ymd;
        ymd = addDaysYmd(ymd, 1);
    }
}

describe('D5 — agenda (puro)', () => {
    it('.ics: un evento con UID estable, texto escapado y líneas cortadas a 75 octetos', () => {
        const ics = buildIcs({
            uid: 'cita-7-1@imagina-base',
            start: new Date('2026-11-03T13:00:00Z'),
            end: new Date('2026-11-03T13:30:00Z'),
            summary: 'Consulta, primera vez; Acme',
            description: 'Línea 1\nLínea 2',
            location: 'Calle 1 # 2-3',
            sequence: 3,
            url: 'https://app.test/api/v1/public/b/manage/7.abc',
            now: new Date('2026-10-20T00:00:00Z'),
        });
        expect(ics).toContain('BEGIN:VEVENT');
        expect(ics).toContain('UID:cita-7-1@imagina-base');
        expect(ics).toContain('DTSTART:20261103T130000Z');
        expect(ics).toContain('DTEND:20261103T133000Z');
        expect(ics).toContain('SUMMARY:Consulta\\, primera vez\\; Acme');
        expect(ics).toContain('DESCRIPTION:Línea 1\\nLínea 2');
        expect(ics).toContain('SEQUENCE:3');
        expect(ics).toContain('METHOD:PUBLISH');
        expect(ics.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
        const cancelled = buildIcs({ uid: 'x', start: new Date(), end: new Date(), summary: 's', description: '', location: '', sequence: 4, cancelled: true });
        expect(cancelled).toContain('METHOD:CANCEL');
        expect(cancelled).toContain('STATUS:CANCELLED');
        expect(foldIcsLine('a'.repeat(160)).split('\r\n ').map((p) => p.length)).toEqual([75, 74, 11]);
    });

    it('correo al cliente: con la marca, el horario en SU reloj y todo escapado', () => {
        const mail = bookingClientEmail(
            { name: 'Acme <b>', color: '#0e7490', logoUrl: null },
            {
                kind: 'booked',
                clientName: 'Ana <script>',
                service: 'Consulta',
                staff: 'Dra. Ruiz',
                start: '2026-11-03T13:00:00.000Z',
                end: '2026-11-03T13:30:00.000Z',
                location: 'Calle 1',
                companyTz: TZ,
                clientTz: 'Europe/Madrid',
                timeFormat: 'h24',
                manageUrl: 'https://app.test/m/1.x',
                cancelUrl: 'https://app.test/m/1.x?accion=cancelar',
                canReschedule: true,
                canCancel: true,
            },
        );
        expect(mail.subject).toContain('Tu cita está confirmada: Consulta');
        expect(mail.html).not.toContain('<script>');
        expect(mail.html).toContain('Ana &lt;script&gt;');
        expect(mail.html).toContain('Acme &lt;b&gt;');
        // 13:00 UTC = 14:00 en Madrid (horario de invierno) y 8:00 en Bogotá.
        expect(mail.text).toMatch(/14:00/);
        expect(mail.text).toMatch(/8:00|08:00/);
        expect(mail.text).toContain('Cambiar el horario: https://app.test/m/1.x');
        expect(mail.text).toContain('Cancelar la cita: https://app.test/m/1.x?accion=cancelar');
    });

    it('lo ocupado de Google Calendar y Outlook: sólo inicio y fin, sin los libres ni los cancelados', () => {
        const g = busyRequest('google_calendar', 'https://g.test', 'tok', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z');
        expect(g.url.startsWith('https://g.test/calendar/v3/calendars/primary/events?')).toBe(true);
        expect(g.url).toContain('singleEvents=true');
        expect(g.url).toContain('fields=');
        expect(g.headers.authorization).toBe('Bearer tok');
        const gp = parseBusy(
            'google_calendar',
            JSON.stringify({
                items: [
                    { start: { dateTime: '2026-11-02T15:00:00Z' }, end: { dateTime: '2026-11-02T16:00:00Z' } },
                    { start: { dateTime: '2026-11-02T17:00:00Z' }, end: { dateTime: '2026-11-02T18:00:00Z' }, transparency: 'transparent' },
                    { start: { dateTime: '2026-11-02T19:00:00Z' }, end: { dateTime: '2026-11-02T20:00:00Z' }, status: 'cancelled' },
                ],
                nextPageToken: 'p2',
            }),
        );
        expect(gp.busy).toEqual([{ start: Date.parse('2026-11-02T15:00:00Z'), end: Date.parse('2026-11-02T16:00:00Z'), kind: 'external' }]);
        expect(gp.next).toBe('p2');
        const o = busyRequest('outlook', 'https://graph.test', 'tok', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z');
        expect(o.url.startsWith('https://graph.test/v1.0/me/calendarView?')).toBe(true);
        const op = parseBusy(
            'outlook',
            JSON.stringify({
                value: [
                    { start: { dateTime: '2026-11-02T15:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-02T16:00:00.0000000', timeZone: 'UTC' }, showAs: 'busy' },
                    { start: { dateTime: '2026-11-02T17:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-02T18:00:00.0000000', timeZone: 'UTC' }, showAs: 'free' },
                    { start: { dateTime: '2026-11-02T19:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-02T20:00:00.0000000', timeZone: 'UTC' }, isCancelled: true },
                ],
            }),
        );
        expect(op.busy).toEqual([{ start: Date.parse('2026-11-02T15:00:00Z'), end: Date.parse('2026-11-02T16:00:00Z'), kind: 'external' }]);
    });

    it('la página pública: CSP con nonce y nada de la configuración como HTML', () => {
        const html = renderBookingPage({
            nonce: 'n1',
            title: '<b>Agenda</b>',
            boot: { mode: 'book', token: 'tok', meta: { title: '</script><script>alert(1)</script>' } as never, manage: null },
            themeCss: '</style><script>alert(2)</script>',
            bodyClasses: ['ib-x', 'a"onload="x'],
        });
        // v0.1.354 — el CSS del tema no cierra su <style> y las clases van limpias.
        expect(html).not.toContain('</style><script>alert(2)');
        expect(html).toContain('<body class="ib-body ib-x aonloadx">');
        expect(html).toContain('<title>&lt;b&gt;Agenda&lt;/b&gt;</title>');
        expect(html).not.toContain('</script><script>alert(1)');
        expect(html).toContain('<script nonce="n1">');
        expect(html).toContain('imb-form-height');
    });

    it('sanear: campos de otro tipo fuera del mapeo, personas que no son del equipo afuera, preguntas mapeadas afuera', () => {
        const fields = [
            { id: 1, type: 'datetime', config: {} },
            { id: 2, type: 'text', config: {} },
            { id: 3, type: 'user', config: {} },
            { id: 4, type: 'select', config: { options: [{ value: 'confirmada', label: 'Confirmada' }] } },
        ] as unknown as Field[];
        const cfg = sanitizeBookingConfig(
            bookingConfigSchema.parse({
                mapping: { start_field_id: 2, person_field_id: 3, name_field_id: 2, status_field_id: 4, status_confirmed: 'confirmada', status_cancelled: 'no_existe' },
                staff: [
                    { id: 'stfa', kind: 'user', staff_user_id: 10 },
                    { id: 'stfb', kind: 'user', staff_user_id: 10 },
                    { id: 'stfc', kind: 'user', staff_user_id: 99 },
                ],
                questions: [
                    { id: 'qqqq1', type: 'field', field_id: 2 },
                    { id: 'qqqq2', type: 'field', field_id: 77 },
                ],
            }),
            fields,
            new Set([10]),
        );
        expect(cfg.mapping.start_field_id).toBeNull();
        expect(cfg.mapping.person_field_id).toBe(3);
        expect(cfg.mapping.status_confirmed).toBe('confirmada');
        expect(cfg.mapping.status_cancelled).toBeNull();
        expect(cfg.staff.map((s) => s.staff_user_id)).toEqual([10, null, null]);
        expect(cfg.questions).toEqual([]);
        const data = appointmentRecordData({
            config: cfg,
            fieldsById: new Map(fields.map((f) => [f.id, f])),
            service: bookingServiceSchema.parse({ id: 'svcx', name: 'Consulta', duration_min: 30 }),
            staff: cfg.staff[0]!,
            staffName: 'Ana',
            start: new Date('2026-11-03T13:00:00Z'),
            end: new Date('2026-11-03T13:30:00Z'),
            status: 'confirmed',
            client: { name: 'Luis', email: 'luis@x.co', phone: null },
        });
        expect(data).toEqual({ f3: 10, f4: 'confirmada', f2: 'Luis' });
    });
});

describe('D5 — agenda (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let files: FilesService;
    let dispatcher: CapturingDispatcher;
    let mailbox: CapturingMailTransport;
    let calendar: FakeCalendar;
    let myCalendar: BookingMyCalendarService;
    let booking: BookingService;
    let pub: BookingPublicService;
    let reminders: BookingRemindersService;
    let notified: NotifyEvent[];
    let tenantId: number;
    let otherTenant: number;
    let listId: number;
    let ana: number;
    let beto: number;
    let calId: number;
    let f: Record<string, Field>;
    let pageId: number;
    let token: string;
    let D: string;
    let E: string;
    let rt: RealtimeService;
    let hub: RecordChangeHub;
    let env: Env;
    let availability: BookingAvailabilityService;

    const IP = '203.0.113.9';
    let ipSeq = 0;
    const nextIp = (): string => `198.51.100.${(ipSeq++ % 250) + 1}`;
    const stamp = (id: number): string => {
        const ts = Date.now() - 10_000;
        return `${ts}.${files.signParts('bookstamp', id, ts)}`;
    };
    const staffWeek = (intervals: Array<{ start: string; end: string }>) => [[], intervals, intervals, intervals, intervals, intervals, []];

    function pageConfig(over: Partial<BookingConfig['rules']> = {}): BookingConfig {
        return bookingConfigSchema.parse({
            settings: { title: 'Agenda Acme', location: 'Calle 1 # 2-3', ask_phone: 'optional' },
            services: [
                { id: 'svcconsulta', name: 'Consulta', duration_min: 30 },
                { id: 'svcterapia', name: 'Terapia', duration_min: 60 },
            ],
            staff: [
                { id: 'stfana', kind: 'user', staff_user_id: ana, availability: { week: staffWeek([{ start: '08:00', end: '12:00' }]) }, connection_id: calId, read_busy: true, create_events: true },
                { id: 'stfbeto', kind: 'user', staff_user_id: beto, availability: { week: staffWeek([{ start: '14:00', end: '18:00' }]), exceptions: [{ date: D, closed: true }] } },
                { id: 'stfsala', kind: 'resource', name: 'Sala 1', services: ['svcterapia'], availability: { week: staffWeek([{ start: '08:00', end: '18:00' }]) } },
            ],
            rules: { buffer_after_min: 10, min_notice_min: 120, max_days_ahead: 60, slot_interval_min: 30, max_per_day: 2, ...over },
            mapping: {
                start_field_id: f.inicio!.id,
                duration_field_id: f.duracion!.id,
                person_field_id: f.profesional!.id,
                resource_field_id: f.sala!.id,
                service_field_id: f.servicio!.id,
                name_field_id: f.cliente!.id,
                email_field_id: f.email!.id,
                phone_field_id: f.telefono!.id,
                status_field_id: f.estado!.id,
            },
            questions: [{ id: newFormItemId(), type: 'field', field_id: f.notas!.id }],
        });
    }

    async function freshPage(over: Partial<BookingConfig['rules']> = {}): Promise<void> {
        const dto = await booking.create(tenantId, ana, 'citas', { name: 'Agenda Acme' });
        await booking.update(tenantId, 'citas', dto.id, { config: pageConfig(over) });
        const pub2 = await booking.update(tenantId, 'citas', dto.id, { enabled: true });
        pageId = pub2.id;
        token = pub2.public_path.split('/').pop()!;
        pub.forgetLists(tenantId);
    }

    async function book(input: { staff?: string; service?: string; start: string; email?: string; name?: string; ip?: string; extra?: Record<string, unknown> }) {
        return pub.book(token, input.ip ?? nextIp(), {
            service_id: input.service ?? 'svcconsulta',
            staff_id: input.staff ?? 'any',
            start: input.start,
            name: input.name ?? 'Luis Gómez',
            email: input.email ?? 'LUIS@cliente.co',
            phone: '+57 300 111 2233',
            values: { [String(f.notas!.id)]: 'Primera vez', ...(input.extra ?? {}) },
            stamp: stamp(pageId),
            time_zone: 'Europe/Madrid',
        });
    }

    const refOf = (manageUrl: string): string => manageUrl.split('/manage/')[1]!;
    const appointments = () => withTenant(pg.db, tenantId, (tx) => tx.select().from(bookingAppointments).where(eq(bookingAppointments.pageId, pageId)));

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        dispatcher = new CapturingDispatcher();
        hub = new RecordChangeHub();
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fieldsSvc,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            dispatcher,
            new RelationsRepository(),
            undefined,
            hub,
        );
        env = loadEnv({ FILES_SIGNING_SECRET: 'book-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-book-'))), env);
        mailbox = new CapturingMailTransport();
        calendar = new FakeCalendar(env, redis, tenantDb);
        availability = new BookingAvailabilityService(tenantDb, calendar, NO_HOLIDAYS);
        myCalendar = new BookingMyCalendarService(tenantDb, calendar, null as never, { resolve: () => Promise.resolve({}) } as never);
        booking = new BookingService(pg.db, tenantDb, lists, fieldsSvc, availability, NO_HOLIDAYS, calendar, myCalendar);
        const notify = new NotifyHub();
        notified = [];
        notify.subscribe((e) => {
            notified.push(e);
        });
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
            undefined,
            undefined,
            undefined,
            new MailService(env, mailbox),
            undefined,
        );
        pub.onModuleInit();
        reminders = new BookingRemindersService(env, pg.db, pub);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acmebook', name: 'Acme', settings: { format: { timezone: TZ } } }).returning();
        tenantId = t!.id;
        const [o] = await pg.db.insert(tenants).values({ slug: 'otrabook', name: 'Otra' }).returning();
        otherTenant = o!.id;
        const [ua] = await pg.db.insert(users).values({ email: 'ana@acme.local', name: 'Ana Ruiz', passwordHash: 'x' }).returning();
        const [ub] = await pg.db.insert(users).values({ email: 'beto@acme.local', name: 'Beto Díaz', passwordHash: 'x' }).returning();
        const [uc] = await pg.db.insert(users).values({ email: 'cli@acme.local', name: 'Cliente Portal', passwordHash: 'x' }).returning();
        ana = ua!.id;
        beto = ub!.id;
        await pg.db.insert(memberships).values([
            { userId: ana, tenantId, role: 'admin' },
            { userId: beto, tenantId, role: 'agent' },
            { userId: uc!.id, tenantId, role: 'client' },
        ]);
        const [cal] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(connections).values({ tenantId, provider: 'google_calendar', name: 'Calendario de Ana', authType: 'oauth2', visibility: 'private', ownerUserId: ana }).returning(),
        );
        calId = cal!.id;

        listId = (await lists.create(tenantId, { name: 'Citas' })).id;
        f = {};
        f.inicio = await fieldsSvc.create(tenantId, 'citas', { label: 'Fecha y hora', type: 'datetime', slug: 'inicio' });
        f.duracion = await fieldsSvc.create(tenantId, 'citas', { label: 'Duración', type: 'duration', slug: 'duracion' });
        f.profesional = await fieldsSvc.create(tenantId, 'citas', { label: 'Profesional', type: 'user', slug: 'profesional' });
        f.sala = await fieldsSvc.create(tenantId, 'citas', { label: 'Sala', type: 'select', slug: 'sala', config: { options: [] } });
        f.servicio = await fieldsSvc.create(tenantId, 'citas', { label: 'Servicio', type: 'select', slug: 'servicio', config: { options: [] } });
        f.cliente = await fieldsSvc.create(tenantId, 'citas', { label: 'Cliente', type: 'text', slug: 'cliente' });
        f.email = await fieldsSvc.create(tenantId, 'citas', { label: 'Correo', type: 'email', slug: 'email' });
        f.telefono = await fieldsSvc.create(tenantId, 'citas', { label: 'Teléfono', type: 'phone', slug: 'telefono' });
        f.estado = await fieldsSvc.create(tenantId, 'citas', { label: 'Estado', type: 'select', slug: 'estado', config: { options: [{ value: 'nueva', label: 'Nueva' }] } });
        f.notas = await fieldsSvc.create(tenantId, 'citas', { label: 'Motivo', type: 'long_text', slug: 'notas' });

        const today = zonedToday(TZ, new Date());
        D = workday(addDaysYmd(today, 5));
        E = workday(addDaysYmd(D, 1));
    });

    afterAll(async () => {
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        // Lo que sigue a una reserva (correo, calendario) corre después de
        // responder: se espera a que termine lo del test anterior.
        await new Promise((r) => setTimeout(r, 400));
        dispatcher.events.length = 0;
        mailbox.sent.length = 0;
        notified.length = 0;
        calendar.busyByConn.clear();
        calendar.created.length = 0;
        calendar.moved.length = 0;
        calendar.deleted.length = 0;
        await redis.flushall();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(bookingPages).where(eq(bookingPages.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
    });

    it('alta: arranca sin publicar, crea las opciones de servicios, recursos y estados; sin publicar es un 404', async () => {
        const dto = await booking.create(tenantId, ana, 'citas', { name: 'Agenda' });
        expect(dto.enabled).toBe(false);
        // El arranque adivina el mapeo por tipo y nombre, con quien la crea atendiendo.
        expect(dto.config.mapping.start_field_id).toBe(f.inicio!.id);
        expect(dto.config.mapping.person_field_id).toBe(f.profesional!.id);
        expect(dto.config.staff[0]!.staff_user_id).toBe(ana);
        const token0 = dto.public_path.split('/').pop()!;
        await expect(pub.meta(token0)).rejects.toMatchObject({ status: 404 });
        await expect(pub.meta('no-existe-este-token-de-agenda')).rejects.toMatchObject({ status: 404 });

        const updated = await booking.update(tenantId, 'citas', dto.id, { config: pageConfig() });
        const fields = await fieldsSvc.listByListId(tenantId, listId);
        const opts = (slug: string) => ((fields.find((x) => x.slug === slug)!.config as { options: Array<{ value: string; label: string }> }).options ?? []).map((o) => o.label);
        // Mientras se arma no se crea nada en la lista (renombrar un servicio no deja opciones huérfanas).
        expect(opts('servicio')).toEqual([]);
        expect(updated.config.mapping.status_cancelled).toBeNull();
        // Al publicar: las opciones de servicios, recursos y estados.
        const published = await booking.update(tenantId, 'citas', dto.id, { enabled: true });
        const fields2 = await fieldsSvc.listByListId(tenantId, listId);
        const opts2 = (slug: string) => ((fields2.find((x) => x.slug === slug)!.config as { options: Array<{ value: string; label: string }> }).options ?? []).map((o) => o.label);
        expect(opts2('servicio')).toEqual(['Consulta', 'Terapia']);
        expect(opts2('sala')).toEqual(['Sala 1']);
        expect(opts2('estado')).toEqual(['Nueva', 'Confirmada', 'Reprogramada', 'Cancelada']);
        expect(published.config.services.every((s) => s.option_value !== null)).toBe(true);
        expect(published.config.mapping.status_cancelled).toBe('cancelada');
        expect(fields.length).toBeGreaterThan(0);
        // El calendario privado de Ana se queda con Ana; se le quita a quien no es su dueño.
        expect(updated.config.staff[0]!.connection_id).toBe(calId);
        const stolen = pageConfig();
        stolen.staff[1] = { ...stolen.staff[1]!, connection_id: calId };
        const again = await booking.update(tenantId, 'citas', dto.id, { config: stolen });
        expect(again.config.staff[1]!.connection_id).toBeNull();
        // Una persona con rol cliente del portal no atiende.
        const members = await booking.editorOptions(tenantId, 'citas');
        expect(members.members.map((m) => m.name)).toEqual(['Ana Ruiz', 'Beto Díaz']);
        expect(members.time_zone).toBe(TZ);
    });

    it('no se publica a medias: sin campo de inicio dice qué falta', async () => {
        const dto = await booking.create(tenantId, ana, 'citas', { name: 'Agenda' });
        const cfg = pageConfig();
        cfg.mapping.start_field_id = null;
        await booking.update(tenantId, 'citas', dto.id, { config: cfg });
        await expect(booking.update(tenantId, 'citas', dto.id, { enabled: true })).rejects.toMatchObject({ response: { code: 'booking_incomplete' } });
    });

    it('horarios: respetan el horario de cada uno, la excepción, el margen, el aviso mínimo y lo ocupado', async () => {
        await freshPage();
        const meta = await pub.meta(token);
        expect(meta.title).toBe('Agenda Acme');
        expect(meta.time_zone).toBe(TZ);
        expect(meta.services.map((s) => s.name)).toEqual(['Consulta', 'Terapia']);
        expect(meta.staff.map((s) => s.name)).toEqual(['Ana Ruiz', 'Beto Díaz', 'Sala 1']);
        expect(meta.choose_staff).toBe(true);
        expect(JSON.stringify(meta)).not.toContain('ana@acme.local');

        // Ana: 8:00 a 12:00 (la última de 30 min empieza 11:30).
        const anaD = await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D });
        expect(anaD.slots.map((s) => s.start)).toEqual([8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5].map((h) => at(D, Math.floor(h), (h % 1) * 60)));
        // Beto: ese día cerrado (excepción); al siguiente, 14:00 a 18:00.
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfbeto', from: D, to: D })).slots).toEqual([]);
        const betoE = await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfbeto', from: E, to: E });
        expect(betoE.slots[0]!.start).toBe(at(E, 14));
        expect(betoE.slots.at(-1)!.start).toBe(at(E, 17, 30));
        // Terapia (60 min) en la sala: termina a las 18.
        const sala = await pub.slots(token, IP, { service: 'svcterapia', staff: 'stfsala', from: D, to: D });
        expect(sala.slots.at(-1)!.start).toBe(at(D, 17));
        // Beto no ofrece Terapia… pero la sala sí: con «cualquiera», sólo la sala.
        const anyTerapia = await pub.slots(token, IP, { service: 'svcterapia', staff: 'any', from: D, to: D });
        expect(anyTerapia.slots.every((s) => s.staff.includes('stfsala'))).toBe(true);

        // Una cita cargada A MANO en la tabla (sin la página) ocupa el horario de Ana con su margen.
        await recs.create(tenantId, { userId: ana, role: 'admin' }, 'citas', {
            data: { [`f${f.inicio!.id}`]: at(D, 9), [`f${f.profesional!.id}`]: ana, [`f${f.duracion!.id}`]: 30, [`f${f.cliente!.id}`]: 'A mano' },
        });
        // Su calendario de Google: ocupado de 11:00 a 11:30.
        calendar.busyByConn.set(calId, [{ start: Date.parse(at(D, 11)), end: Date.parse(at(D, 11, 30)), kind: 'external' }]);
        const after = await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D });
        // 8:30 (su limpieza pisa las 9), 9:00 y 9:30 (la de las 9 termina 9:40), 10:30 y 11:00 (Google).
        expect(after.slots.map((s) => s.start)).toEqual([at(D, 8), at(D, 10), at(D, 11, 30)]);

        // Aviso mínimo: hoy no se ofrece nada que empiece antes de 2 horas.
        const today = zonedToday(TZ, new Date());
        const todays = await pub.slots(token, IP, { service: 'svcterapia', staff: 'stfsala', from: today, to: today });
        expect(todays.slots.every((s) => Date.parse(s.start) >= Date.now() + 120 * 60_000 - 1000)).toBe(true);
        // Más allá del máximo de días: nada.
        const far = addDaysYmd(today, 70);
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'any', from: far, to: far })).slots).toEqual([]);
    });

    it('un invitado externo nunca atiende, aunque la lista se le haya compartido con edición', async () => {
        const [g] = await pg.db.insert(users).values({ email: 'invitado@fuera.local', name: 'Invitado Externo', passwordHash: 'x' }).returning();
        await pg.db.insert(memberships).values({ userId: g!.id, tenantId, role: 'guest' });
        const [before] = await pg.db.select({ settings: listsTable.settings }).from(listsTable).where(eq(listsTable.id, listId));
        const share = { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] };
        await pg.db
            .update(listsTable)
            .set({ settings: { ...(before!.settings as object), permissions: { permissions: {}, assignment_field_id: null, users: { [String(g!.id)]: share } } } })
            .where(eq(listsTable.id, listId));
        try {
            const opts = await booking.editorOptions(tenantId, 'citas');
            expect(opts.members.map((m) => m.id)).toContain(beto);
            expect(opts.members.map((m) => m.id)).not.toContain(g!.id);
            const dto = await booking.create(tenantId, ana, 'citas', { name: 'Con invitado' });
            const cfg = pageConfig();
            cfg.staff.push({ ...cfg.staff[0]!, id: 'stfguest', staff_user_id: g!.id, connection_id: null, read_busy: false, create_events: false });
            const saved = await booking.update(tenantId, 'citas', dto.id, { config: cfg });
            expect(saved.config.staff.some((s) => s.staff_user_id === g!.id)).toBe(false);
        } finally {
            await pg.db.update(listsTable).set({ settings: before!.settings }).where(eq(listsTable.id, listId));
        }
    });

    it('las citas de Ana en OTRA agenda de la empresa la ocupan aquí; con esa lista en la papelera, ya no', async () => {
        await freshPage();
        const other = await lists.create(tenantId, { name: 'Citas sede norte' });
        const inicio2 = await fieldsSvc.create(tenantId, other.slug, { label: 'Inicio', type: 'datetime', slug: 'inicio' });
        const prof2 = await fieldsSvc.create(tenantId, other.slug, { label: 'Profesional', type: 'user', slug: 'profesional' });
        const dto = await booking.create(tenantId, ana, other.slug, { name: 'Sede norte' });
        await booking.update(tenantId, other.slug, dto.id, {
            config: bookingConfigSchema.parse({
                services: [{ id: 'svcnorte', name: 'Consulta', duration_min: 30 }],
                staff: [{ id: 'stfnorte', kind: 'user', staff_user_id: ana }],
                mapping: { start_field_id: inicio2.id, person_field_id: prof2.id },
            }),
        });
        await recs.create(tenantId, { userId: ana, role: 'admin' }, other.slug, {
            data: { [`f${inicio2.id}`]: at(D, 9), [`f${prof2.id}`]: ana },
        });
        const starts = async () => (await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots.map((s) => s.start);
        expect(await starts()).not.toContain(at(D, 9));
        // Sólo la lista a la papelera (sus registros siguen vivos): la agenda de allá deja de ocupar a Ana.
        await pg.db.update(listsTable).set({ deletedAt: new Date() }).where(eq(listsTable.id, other.id));
        expect(await starts()).toContain(at(D, 9));
    });

    it('festivos de Colombia: el día no se ofrece salvo que una excepción diga otro horario', async () => {
        const today = zonedToday(TZ, new Date());
        let holiday: string | null = null;
        for (let i = 3; i < 55 && !holiday; i++) {
            const ymd = addDaysYmd(today, i);
            const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
            const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
            if (dow >= 1 && dow <= 5 && isColombianHoliday(ymdToMs(y, m, d))) holiday = ymd;
        }
        if (!holiday) return;
        await freshPage();
        expect((await pub.slots(token, IP, { service: 'svcterapia', staff: 'stfsala', from: holiday, to: holiday })).slots).toEqual([]);
        const cfg = pageConfig();
        cfg.staff[2]!.availability.exceptions = [{ date: holiday, closed: false, intervals: [{ start: '09:00', end: '10:00' }], note: '' }];
        await booking.update(tenantId, 'citas', pageId, { config: cfg });
        const open = await pub.slots(token, IP, { service: 'svcterapia', staff: 'stfsala', from: holiday, to: holiday });
        expect(open.slots.map((s) => s.start)).toEqual([at(holiday, 9)]);
    });

    it('reservar: crea el registro con los campos mapeados, avisa a quien atiende, dispara y manda el correo con el .ics', async () => {
        await freshPage();
        const res = await book({ staff: 'stfana', start: at(D, 10) });
        expect(res.ok).toBe(true);
        expect(res.appointment).toMatchObject({ service: 'Consulta', staff: 'Ana Ruiz', start: at(D, 10), status: 'confirmed', can_cancel: true, can_reschedule: true });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        const fields = await fieldsSvc.listByListId(tenantId, listId);
        const page = await booking.get(tenantId, 'citas', pageId);
        const svcValue = page.config.services[0]!.option_value;
        expect(rec!.data).toMatchObject({
            [`f${f.inicio!.id}`]: at(D, 10),
            [`f${f.duracion!.id}`]: 30,
            [`f${f.profesional!.id}`]: ana,
            [`f${f.servicio!.id}`]: svcValue,
            [`f${f.cliente!.id}`]: 'Luis Gómez',
            [`f${f.email!.id}`]: 'luis@cliente.co',
            [`f${f.telefono!.id}`]: '+573001112233',
            [`f${f.estado!.id}`]: page.config.mapping.status_confirmed,
            [`f${f.notas!.id}`]: 'Primera vez',
        });
        expect(fields.length).toBeGreaterThan(0);
        expect(rec!.createdBy).toBe(0);
        expect(page.bookings_count).toBe(1);
        expect(page.upcoming_count).toBe(1);

        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        const mail = mailbox.sent[0]!;
        expect(mail.to).toBe('luis@cliente.co');
        expect(mail.subject).toContain('Tu cita está confirmada: Consulta');
        expect(mail.attachments?.[0]?.filename).toBe('cita.ics');
        const ics = Buffer.from(mail.attachments![0]!.contentBase64, 'base64').toString('utf8');
        expect(ics).toContain(`DTSTART:${at(D, 10).replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
        expect(mail.text).toContain('/api/v1/public/b/manage/');
        // El horario en el reloj del cliente (Madrid) y en el de la empresa.
        expect(mail.text).toContain('Madrid');

        expect(dispatcher.events.map((e) => e.trigger)).toEqual(['record_created', 'booking_event']);
        await vi.waitFor(() => expect(dispatcher.events.length).toBe(2));
        expect(dispatcher.events[1]!.booking).toMatchObject({ page_id: pageId, event: 'booked', by: 'client', service: 'Consulta', staff: 'Ana Ruiz', client_email: 'luis@cliente.co' });
        expect(notified).toEqual([expect.objectContaining({ type: 'booking', userIds: [ana], kind: 'assigned', title: expect.stringContaining('Nueva cita: Luis Gómez · Consulta') })]);
        // El evento en el Google Calendar de Ana.
        await vi.waitFor(() => expect(calendar.created.length).toBe(1));
        expect(calendar.created[0]!.input.title).toBe('Consulta — Luis Gómez');
        const [appt] = await appointments();
        await vi.waitFor(async () => expect((await appointments())[0]!.externalEvent).toMatchObject({ event_id: 'ev1' }));
        expect(appt!.clientTz).toBe('Europe/Madrid');
    });

    it('robots y datos: trampa, sello reciente, obligatorios y un horario que no se ofrece', async () => {
        await freshPage();
        await expect(
            pub.book(token, IP, { service_id: 'svcconsulta', staff_id: 'stfana', start: at(D, 10), name: 'x', email: 'x@x.co', values: {}, stamp: stamp(pageId), hp: 'soy un robot' }),
        ).resolves.toEqual({ ok: true, appointment: null });
        expect(await appointments()).toEqual([]);
        const ts = Date.now();
        await expect(
            pub.book(token, IP, { service_id: 'svcconsulta', staff_id: 'stfana', start: at(D, 10), name: 'x', email: 'x@x.co', values: {}, stamp: `${ts}.${files.signParts('bookstamp', pageId, ts)}` }),
        ).rejects.toMatchObject({ response: { code: 'booking_too_fast' } });
        await expect(
            pub.book(token, IP, { service_id: 'svcconsulta', staff_id: 'stfana', start: at(D, 10), name: 'x', email: 'x@x.co', values: {}, stamp: '123.abc' }),
        ).rejects.toMatchObject({ response: { code: 'booking_stale' } });
        // A las 12:00 Ana ya no atiende: el servidor no le cree al navegador.
        await expect(book({ staff: 'stfana', start: at(D, 12) })).rejects.toMatchObject({ status: 409, response: { code: 'booking_slot_taken' } });
        // A las 10:10 tampoco: cabe, pero no es uno de los horarios que ofrece la página.
        await expect(book({ staff: 'stfana', start: at(D, 10, 10) })).rejects.toMatchObject({ status: 409 });
        await expect(book({ staff: 'stfana', start: at(D, 10) })).resolves.toMatchObject({ ok: true });
    });

    it('dos reservas del mismo horario a la vez: sólo una gana', async () => {
        await freshPage();
        const tries = await Promise.allSettled(
            Array.from({ length: 4 }, (_, i) => book({ staff: 'stfsala', service: 'svcterapia', start: at(E, 10), email: `c${i}@x.co`, name: `Cliente ${i}` })),
        );
        const ok = tries.filter((t) => t.status === 'fulfilled');
        const lost = tries.filter((t) => t.status === 'rejected') as PromiseRejectedResult[];
        expect(ok.length).toBe(1);
        expect(lost.every((l) => (l.reason as { response?: { code?: string } }).response?.code === 'booking_slot_taken')).toBe(true);
        const rows = await appointments();
        expect(rows.length).toBe(1);
        const recsRows = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect(recsRows.length).toBe(1);
        // Y el horario dejó de ofrecerse (con su limpieza: 9:30 tampoco, porque pisaría las 10).
        const free = await pub.slots(token, IP, { service: 'svcterapia', staff: 'stfsala', from: E, to: E });
        expect(free.slots.map((s) => s.start)).not.toContain(at(E, 10));
        expect(free.slots.map((s) => s.start)).not.toContain(at(E, 9, 30));
    });

    it('tope diario: con 2 citas ese día, la persona no ofrece más; «el primero disponible» reparte', async () => {
        await freshPage();
        await book({ staff: 'stfana', start: at(D, 8) });
        await book({ staff: 'stfana', start: at(D, 9) });
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots).toEqual([]);
        await expect(book({ staff: 'stfana', start: at(D, 11) })).rejects.toMatchObject({ status: 409 });
        // «El primero disponible» a las 14:00 del día siguiente: sólo Beto atiende a esa hora.
        const r = await book({ staff: 'any', start: at(E, 14) });
        expect(r.appointment!.staff).toBe('Beto Díaz');
        // Un horario donde atienden los dos (después de que Ana ya tiene citas): va a quien lleva más sin recibir.
        const cfg = pageConfig({ max_per_day: null });
        cfg.staff[1]!.availability.week = staffWeek([{ start: '08:00', end: '18:00' }]);
        await booking.update(tenantId, 'citas', pageId, { config: cfg });
        const r2 = await book({ staff: 'any', start: at(E, 8) });
        expect(r2.appointment!.staff).toBe('Ana Ruiz');
    });

    it('reprogramar y cancelar por el enlace del correo: mismo registro, sin dejar el horario ocupado', async () => {
        await freshPage();
        const res = await book({ staff: 'stfana', start: at(D, 10) });
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        const ref = refOf(res.appointment!.manage_url);
        const meta = await pub.manageMeta(ref);
        expect(meta.appointment.start).toBe(at(D, 10));
        expect(meta.service_id).toBe('svcconsulta');
        // Un enlace alterado es el mismo 404.
        await expect(pub.manageMeta(`${ref}x`)).rejects.toMatchObject({ status: 404 });
        await expect(pub.manageMeta(ref.replace(/^\d+/, '999999'))).rejects.toMatchObject({ status: 404 });

        // Los horarios para reprogramar no cuentan la propia cita.
        const free = await pub.manageSlots(ref, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D });
        expect(free.slots.map((s) => s.start)).toContain(at(D, 10));

        const moved = await pub.reschedule(ref, IP, { start: at(E, 9) });
        expect(moved).toMatchObject({ status: 'rescheduled', start: at(E, 9), staff: 'Ana Ruiz' });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        const page = await booking.get(tenantId, 'citas', pageId);
        expect((rec!.data as Record<string, unknown>)[`f${f.inicio!.id}`]).toBe(at(E, 9));
        expect((rec!.data as Record<string, unknown>)[`f${f.estado!.id}`]).toBe(page.config.mapping.status_rescheduled);
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(2));
        expect(mailbox.sent[1]!.subject).toContain('Tu cita cambió de horario');
        await vi.waitFor(() => expect(calendar.moved.length).toBe(1));
        expect(dispatcher.events.filter((e) => e.trigger === 'booking_event').map((e) => e.booking!.event)).toEqual(['booked', 'rescheduled']);
        const resch = dispatcher.events.find((e) => e.booking?.event === 'rescheduled')!.booking!;
        expect(resch.previous_start).toBe(at(D, 10));
        expect((notified.at(-1) as { title?: string }).title).toContain('Luis Gómez reprogramó su cita');
        // El horario viejo quedó libre.
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots.map((s) => s.start)).toContain(at(D, 10));

        // v0.1.353 — el enlace con el que se reprogramó ya no hace cambios; el nuevo, sí.
        const stale = await pub.manageMeta(ref);
        expect(stale.appointment).toMatchObject({ can_cancel: false, can_reschedule: false, locked_reason: expect.stringContaining('correo anterior') });
        await expect(pub.cancel(ref, IP, {})).rejects.toMatchObject({ status: 403 });
        const ref2 = refOf(moved.manage_url);
        expect(ref2).not.toBe(ref);
        expect(mailbox.sent[1]!.text).toContain(ref2);
        const cancelled = await pub.cancel(ref2, IP, { reason: 'Me salió un viaje' });
        expect(cancelled.status).toBe('cancelled');
        const [rec2] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect((rec2!.data as Record<string, unknown>)[`f${f.estado!.id}`]).toBe(page.config.mapping.status_cancelled);
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(3));
        expect(mailbox.sent[2]!.attachments![0]!.contentType).toContain('method=CANCEL');
        await vi.waitFor(() => expect(calendar.deleted).toEqual(['ev1']));
        expect((notified.at(-1) as { body?: string }).body).toContain('Motivo: Me salió un viaje');
        // Una cita cancelada no se vuelve a cancelar ni a mover.
        await expect(pub.cancel(ref2, IP, {})).rejects.toMatchObject({ status: 403 });
        await expect(pub.reschedule(ref2, IP, { start: at(E, 10) })).rejects.toMatchObject({ status: 403 });
        // Y su horario quedó libre.
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: E, to: E })).slots.map((s) => s.start)).toContain(at(E, 9));
        const ics = await pub.ics(ref2);
        expect(ics.body).toContain('STATUS:CANCELLED');
    });

    it('el equipo mueve o cancela la cita desde la app: la cita se entera y avisa', async () => {
        await freshPage();
        const res = await book({ staff: 'stfana', start: at(D, 10) });
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        dispatcher.events.length = 0;
        await recs.update(tenantId, { userId: ana, role: 'admin' }, 'citas', rec!.id, { data: { [`f${f.inicio!.id}`]: at(E, 11) } });
        await vi.waitFor(async () => expect((await appointments())[0]!.startAt.toISOString()).toBe(at(E, 11)));
        await vi.waitFor(() => expect(dispatcher.events.some((e) => e.trigger === 'booking_event' && e.booking?.event === 'rescheduled' && e.booking.by === 'team')).toBe(true));
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(2));
        expect(mailbox.sent[1]!.text).toContain('cambió el horario de tu cita');
        const page = await booking.get(tenantId, 'citas', pageId);
        await recs.update(tenantId, { userId: ana, role: 'admin' }, 'citas', rec!.id, { data: { [`f${f.estado!.id}`]: page.config.mapping.status_cancelled } });
        await vi.waitFor(async () => expect((await appointments())[0]!.status).toBe('cancelled'));
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(3));
        expect(mailbox.sent[2]!.text).toContain('canceló tu cita');
        expect(res.ok).toBe(true);
    });

    it('recordatorios: cada uno sale UNA vez, aunque el barrido corra dos veces', async () => {
        await freshPage();
        await book({ staff: 'stfana', start: at(D, 10) });
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        const start = Date.parse(at(D, 10));
        expect(await reminders.tick(new Date(start - 25 * 3600_000))).toBe(0);
        const [n1, n2] = await Promise.all([reminders.tick(new Date(start - 23 * 3600_000)), reminders.tick(new Date(start - 23 * 3600_000))]);
        expect(n1 + n2).toBe(1);
        expect(await reminders.tick(new Date(start - 22 * 3600_000))).toBe(0);
        expect(mailbox.sent.at(-1)!.subject).toContain('Recordatorio de tu cita');
        expect(mailbox.sent.at(-1)!.text).toContain('de mañana');
        expect(await reminders.tick(new Date(start - 50 * 60_000))).toBe(1);
        expect(await reminders.tick(new Date(start - 40 * 60_000))).toBe(0);
        expect(mailbox.sent.filter((m) => m.subject.startsWith('Recordatorio')).length).toBe(2);
        const [appt] = await appointments();
        expect(appt!.remindersSent).toEqual(['rem24h', 'rem1h']);
    });

    it('recordatorios por SMS (ADR-S82): salen al teléfono del registro con {{cita.*}}, junto al correo; a medio configurar no se publica', async () => {
        const calls: Array<{ tenantId: number; args: Record<string, unknown> }> = [];
        pub.setSms({
            sendNow: async (t: number, args: Record<string, unknown>) => {
                calls.push({ tenantId: t, args });
                return { ok: true, status: 'enviado', message_id: 1, provider_message_id: 'SM1', to: String(args.to), text: String(args.message), segments: 1, encoding: 'gsm7', scheduled_for: null, error: null, request: null, response: null };
            },
        } as never);
        try {
            const base = pageConfig();
            const dto = await booking.create(tenantId, ana, 'citas', { name: 'Agenda SMS' });
            // Encendido sin conexión: la agenda dice qué falta y no se publica.
            const half = await booking.update(tenantId, 'citas', dto.id, {
                config: { ...base, notifications: { ...base.notifications, sms_reminders: { enabled: true, connection_id: null, text: 'Hola', strip_accents: true } } },
            });
            expect(half.problems.join(' ')).toContain('conexión de SMS');
            await expect(booking.update(tenantId, 'citas', dto.id, { enabled: true })).rejects.toMatchObject({ status: 400 });
            await booking.update(tenantId, 'citas', dto.id, {
                config: {
                    ...base,
                    notifications: {
                        ...base.notifications,
                        sms_reminders: { enabled: true, connection_id: 999, text: 'Hola {{cita.cliente}}: {{cita.servicio}} el {{cita.inicio}}. Cambiarla: {{cita.enlace_reprogramar}}', strip_accents: true },
                    },
                },
            });
            const pub2 = await booking.update(tenantId, 'citas', dto.id, { enabled: true });
            pageId = pub2.id;
            token = pub2.public_path.split('/').pop()!;
            pub.forgetLists(tenantId);
            await book({ staff: 'stfana', start: at(D, 10) });
            await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
            const start = Date.parse(at(D, 10));
            // El recordatorio de 24 h sale por correo Y por SMS (dos envíos), una sola vez.
            expect(await reminders.tick(new Date(start - 23 * 3600_000))).toBe(2);
            expect(await reminders.tick(new Date(start - 22 * 3600_000))).toBe(0);
            expect(calls).toHaveLength(1);
            const [appt] = await appointments();
            const a = calls[0]!.args as { connectionId: number; to: string; message: string; source: string; respectHours: boolean; stripAccents: boolean; target: { recordId: number; listId: number } };
            expect(calls[0]!.tenantId).toBe(tenantId);
            expect(a).toMatchObject({ connectionId: 999, source: 'booking', respectHours: false, stripAccents: true, target: { recordId: appt!.recordId, listId } });
            expect(a.to.replace(/\D/g, '')).toBe('573001112233');
            expect(a.message).toMatch(/^Hola Luis Gómez: Consulta el .+\. Cambiarla: https?:\/\/.+\/manage\/.+/);
            expect(a.message).not.toContain('{{');
        } finally {
            pub.setSms(null);
        }
    });

    it('la empresa en solo-lectura por impago no recibe reservas; la lista en la papelera es un 404', async () => {
        await freshPage();
        await pg.db.update(tenants).set({ status: 'past_due' }).where(eq(tenants.id, tenantId));
        try {
            const meta = await pub.meta(token);
            expect(meta.closed).toBe('Esta agenda no está recibiendo reservas en este momento.');
            await expect(book({ staff: 'stfana', start: at(D, 10) })).rejects.toMatchObject({ status: 403, response: { code: 'booking_closed' } });
            expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots).toEqual([]);
        } finally {
            await pg.db.update(tenants).set({ status: 'trialing' }).where(eq(tenants.id, tenantId));
        }
        await pg.db.update(listsTable).set({ deletedAt: new Date() }).where(eq(listsTable.id, listId));
        try {
            await expect(pub.meta(token)).rejects.toMatchObject({ status: 404 });
            expect(await pub.pageInfo(token)).toBeNull();
        } finally {
            await pg.db.update(listsTable).set({ deletedAt: null }).where(eq(listsTable.id, listId));
        }
        await expect(pub.meta(token)).resolves.toMatchObject({ closed: null });
        // Una dirección nueva deja muerta la anterior.
        const regen = await booking.update(tenantId, 'citas', pageId, { regenerate_token: true });
        await expect(pub.meta(token)).rejects.toMatchObject({ status: 404 });
        await expect(pub.meta(regen.public_path.split('/').pop()!)).resolves.toBeTruthy();
    });

    it('«Probar» del disparador: arma la cita de muestra con los enlaces del registro', async () => {
        await freshPage();
        await book({ staff: 'stfana', start: at(D, 10) });
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        const info = await pub.simulatedEvent(tenantId, rec!.id, 'cancelled');
        expect(info).toMatchObject({ event: 'cancelled', page_id: pageId, staff: 'Ana Ruiz' });
        expect(info!.cancel_url).toMatch(/\/api\/v1\/public\/b\/manage\/\d+\.[A-Za-z0-9_-]+\?accion=cancelar$/);
        expect(await pub.simulatedEvent(otherTenant, rec!.id, 'booked')).toBeNull();
    });

    it('RLS: las páginas y las citas de una empresa no se ven desde otra', async () => {
        await freshPage();
        await book({ staff: 'stfana', start: at(D, 10) });
        const mine = await withTenant(pg.db, tenantId, (tx) => tx.select().from(bookingPages));
        const theirs = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(bookingPages));
        expect(mine.length).toBe(1);
        expect(theirs.length).toBe(0);
        const theirAppts = await withTenant(pg.db, otherTenant, (tx) => tx.select().from(bookingAppointments));
        expect(theirAppts.length).toBe(0);
        await expect(booking.get(otherTenant, String(listId), pageId)).rejects.toBeTruthy();
        // Escribir en otra empresa tampoco pasa la política.
        await expect(
            withTenant(pg.db, otherTenant, (tx) =>
                tx.insert(bookingPages).values({ tenantId, listId, name: 'Intrusa', token: 'tok-intrusa-123456789', config: {} }),
            ),
        ).rejects.toBeTruthy();
        const borrar = await withTenant(pg.db, otherTenant, (tx) => tx.delete(bookingAppointments).where(and(eq(bookingAppointments.pageId, pageId))).returning());
        expect(borrar.length).toBe(0);
    });

    // ─────────────────────────── v0.1.349 ───────────────────────────

    async function pageWith(mutate: (c: BookingConfig) => void, rules: Partial<BookingConfig['rules']> = {}): Promise<void> {
        const dto = await booking.create(tenantId, ana, 'citas', { name: 'Agenda Acme' });
        const cfg = pageConfig(rules);
        mutate(cfg);
        await booking.update(tenantId, 'citas', dto.id, { config: cfg });
        const p2 = await booking.update(tenantId, 'citas', dto.id, { enabled: true });
        pageId = p2.id;
        token = p2.public_path.split('/').pop()!;
        pub.forgetLists(tenantId);
    }

    it('v0.1.349 — horario grupal: hasta N reservas en el mismo horario, con los cupos a la vista', async () => {
        await pageWith((c) => {
            c.services.push(bookingServiceSchema.parse({ id: 'svcclase', name: 'Clase grupal', duration_min: 60, seats: 3 }));
        });
        const meta = await pub.meta(token);
        expect(meta.services.find((x) => x.id === 'svcclase')).toMatchObject({ seats: 3, show_seats_left: true, durations: [60] });
        const q = { service: 'svcclase', staff: 'stfana', from: D, to: D } as const;
        const before = await pub.slots(token, IP, q);
        expect(before.slots.find((x) => x.start === at(D, 9))?.seats_left).toBe(3);
        await book({ service: 'svcclase', staff: 'stfana', start: at(D, 9), email: 'a@x.co' });
        // El mismo correo no se lleva un segundo cupo de esa sesión (sin importar mayúsculas).
        await expect(book({ service: 'svcclase', staff: 'stfana', start: at(D, 9), email: 'A@X.co' })).rejects.toMatchObject({ response: { code: 'booking_duplicate' } });
        for (const email of ['b@x.co', 'c@x.co']) {
            await book({ service: 'svcclase', staff: 'stfana', start: at(D, 9), email });
        }
        const rows = await appointments();
        expect(rows.length).toBe(3);
        expect(new Set(rows.map((r) => r.startAt.toISOString()))).toEqual(new Set([at(D, 9)]));
        // Lleno: ya no se ofrece y una cuarta reserva rebota.
        expect((await pub.slots(token, IP, q)).slots.find((x) => x.start === at(D, 9))).toBeUndefined();
        await expect(book({ service: 'svcclase', staff: 'stfana', start: at(D, 9), email: 'd@x.co' })).rejects.toMatchObject({ response: { code: 'booking_slot_taken' } });
        // Una consulta individual en ese horario tampoco (el grupo lo ocupa).
        const consulta = await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D });
        expect(consulta.slots.some((x) => x.start === at(D, 9) || x.start === at(D, 9, 30))).toBe(false);
        // Con dos sesiones del grupo en un día el tope diario (2) cuenta horarios, no personas.
        await book({ service: 'svcclase', staff: 'stfana', start: at(D, 11), email: 'e@x.co' });
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots).toEqual([]);
    });

    it('v0.1.349 — varias duraciones: el cliente elige, se guarda y se conserva al reprogramar; márgenes propios del servicio', async () => {
        await pageWith((c) => {
            c.services[0] = { ...c.services[0]!, durations: [60], buffer_after_min: 0 };
        });
        const meta = await pub.meta(token);
        expect(meta.services[0]!.durations).toEqual([30, 60]);
        // De 60 min, la última de Ana empieza a las 11 (termina 12).
        const s60 = await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D, duration: 60 });
        expect(s60.slots.at(-1)!.start).toBe(at(D, 11));
        expect(s60.slots[0]!.end).toBe(at(D, 9));
        await expect(pub.book(token, nextIp(), { service_id: 'svcconsulta', staff_id: 'stfana', start: at(D, 9), duration_min: 45, name: 'X', email: 'x@x.co', values: {}, stamp: stamp(pageId) })).rejects.toMatchObject({ response: { code: 'booking_invalid' } });
        const res = await pub.book(token, nextIp(), { service_id: 'svcconsulta', staff_id: 'stfana', start: at(D, 9), duration_min: 60, name: 'Ana Cliente', email: 'dur@x.co', values: {}, stamp: stamp(pageId) });
        const [appt] = await appointments();
        expect(appt!.endAt.getTime() - appt!.startAt.getTime()).toBe(60 * 60_000);
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect((rec!.data as Record<string, unknown>)[`f${f.duracion!.id}`]).toBe(60);
        // El servicio no deja margen después (el de la página es 10): a las 10 ya se ofrece.
        const after = await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D });
        expect(after.slots.some((x) => x.start === at(D, 10))).toBe(true);
        // Reprogramar conserva los 60 min.
        const moved = await pub.reschedule(refOf(res.appointment!.manage_url), nextIp(), { start: at(E, 9) });
        expect(Date.parse(moved.end) - Date.parse(moved.start)).toBe(60 * 60_000);
    });

    it('v0.1.349 — citas activas por cliente: con el tope lleno rebota (sin importar mayúsculas); al cancelar, vuelve a poder', async () => {
        await pageWith(() => undefined, { max_active_per_client: 1, max_per_day: null });
        const first = await book({ staff: 'stfana', start: at(D, 9), email: 'Repite@Cliente.co' });
        await expect(book({ staff: 'stfana', start: at(D, 10), email: 'repite@cliente.co' })).rejects.toMatchObject({ response: { code: 'booking_client_limit' } });
        // Dos a la vez con el mismo correo en personas distintas: sólo una entra.
        await pub.cancel(refOf(first.appointment!.manage_url), nextIp(), {});
        const both = await Promise.allSettled([
            book({ staff: 'stfana', start: at(D, 10), email: 'doble@cliente.co' }),
            book({ service: 'svcterapia', staff: 'stfsala', start: at(D, 15), email: 'doble@cliente.co' }),
        ]);
        expect(both.filter((r) => r.status === 'fulfilled').length).toBe(1);
        expect(await book({ staff: 'stfana', start: at(D, 11), email: 'repite@cliente.co' })).toMatchObject({ ok: true });
    });

    it('v0.1.349 — reparto sin elegir: por prioridad y equilibrando la carga', async () => {
        const allDay = staffWeek([{ start: '08:00', end: '18:00' }]);
        await pageWith(
            (c) => {
                c.settings.choose_staff = 'auto';
                c.staff = c.staff.filter((x) => x.kind === 'user').map((x) => ({ ...x, availability: { ...x.availability, week: allDay, exceptions: [] }, connection_id: null, priority: x.id === 'stfbeto' ? 5 : 3 }));
            },
            { assign_mode: 'priority', max_per_day: null },
        );
        await book({ start: at(D, 9), email: 'p1@x.co' });
        await book({ start: at(D, 10), email: 'p2@x.co' });
        expect((await appointments()).map((r) => r.staffId)).toEqual(['stfbeto', 'stfbeto']);

        await pageWith(
            (c) => {
                c.settings.choose_staff = 'auto';
                c.staff = c.staff.filter((x) => x.kind === 'user').map((x) => ({ ...x, availability: { ...x.availability, week: allDay, exceptions: [] }, connection_id: null }));
            },
            { assign_mode: 'balance', max_per_day: null },
        );
        await book({ start: at(E, 9), email: 'b1@x.co' });
        await book({ start: at(E, 10), email: 'b2@x.co' });
        await book({ start: at(E, 11), email: 'b3@x.co' });
        const counts = (await appointments()).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.staffId]: (acc[r.staffId] ?? 0) + 1 }), {});
        expect(Object.values(counts).sort()).toEqual([1, 2]);
    });

    it('v0.1.349 — foto, cargo y descripción de quien atiende: sólo una imagen de la empresa, servida firmada', async () => {
        const [png] = await withTenant(pg.db, tenantId, (tx) => tx.insert(attachments).values({ tenantId, filename: 'ana.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/ana.png' }).returning());
        const [pdf] = await withTenant(pg.db, tenantId, (tx) => tx.insert(attachments).values({ tenantId, filename: 'cv.pdf', mime: 'application/pdf', sizeBytes: 10, storageKey: 'k/cv.pdf' }).returning());
        const [ajena] = await withTenant(pg.db, otherTenant, (tx) => tx.insert(attachments).values({ tenantId: otherTenant, filename: 'x.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/x.png' }).returning());
        await pageWith((c) => {
            c.staff[0] = { ...c.staff[0]!, photo_file_id: png!.id, title: 'Odontóloga', bio: 'Doce años de experiencia.' };
            c.staff[1] = { ...c.staff[1]!, photo_file_id: pdf!.id };
            c.staff[2] = { ...c.staff[2]!, photo_file_id: ajena!.id };
        });
        const page = await booking.get(tenantId, 'citas', pageId);
        expect(page.config.staff.map((x) => x.photo_file_id)).toEqual([png!.id, null, null]);
        const meta = await pub.meta(token);
        expect(meta.staff[0]).toMatchObject({ title: 'Odontóloga', bio: 'Doce años de experiencia.' });
        expect(meta.staff[0]!.photo_url).toMatch(new RegExp(`/files/${png!.id}/signed\\?`));
        expect(meta.staff[1]!.photo_url).toBeNull();
    });

    it('v0.1.349 — festivos de otro país (iCal oficial) y el festivo que sí se atiende', async () => {
        const ymdIcs = D.replace(/-/g, '');
        const next = addDaysYmd(D, 1).replace(/-/g, '');
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            `DTSTART;VALUE=DATE:${ymdIcs}`,
            `DTEND;VALUE=DATE:${next}`,
            'SUMMARY:Día de la Revolución',
            'DESCRIPTION:Día festivo',
            'END:VEVENT',
            'BEGIN:VEVENT',
            `DTSTART;VALUE=DATE:${E.replace(/-/g, '')}`,
            'SUMMARY:Festivo regional',
            'DESCRIPTION:Festivo en Jalisco',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\r\n');
        let hits = 0;
        const server: Server = createServer((req, res) => {
            hits++;
            if (!String(req.url).includes(encodeURIComponent('es.mexican.official#holiday'))) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/calendar' }).end(ics);
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const prev = process.env.DEV_ALLOW_PRIVATE_EGRESS;
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        try {
            const env = loadEnv({ FILES_SIGNING_SECRET: 'book-secret', HOLIDAYS_ICS_BASE: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
            const holidays = new BookingHolidaysService(redis as never, env);
            const items = await holidays.items('MX');
            expect(items?.map((h) => [h.date, h.kind])).toEqual([[D, 'national'], [E, 'regional']]);
            await holidays.items('MX');
            expect(hits).toBe(1); // en caché
            const withHol = new BookingAvailabilityService(tenantDb, calendar, holidays);
            await pageWith((c) => {
                c.staff[0] = { ...c.staff[0]!, availability: { ...c.staff[0]!.availability, holiday_country: 'MX' } };
            });
            const page = await booking.get(tenantId, 'citas', pageId);
            const ctx = { tenantId, pageId, pageName: page.name, listId, config: page.config, timeZone: TZ, fields: await fieldsSvc.listByListId(tenantId, listId), createdBy: ana };
            expect((await withHol.slots(ctx, 'svcconsulta', 'stfana', D, D)).slots).toEqual([]);
            // Lo regional se atiende salvo que se marque.
            expect((await withHol.slots(ctx, 'svcconsulta', 'stfana', E, E)).slots.length).toBeGreaterThan(0);
            const worked = { ...ctx, config: { ...ctx.config, staff: ctx.config.staff.map((x, i) => (i === 0 ? { ...x, availability: { ...x.availability, holiday_work: [D], holiday_off: [E] } } : x)) } };
            expect((await withHol.slots(worked, 'svcconsulta', 'stfana', D, D)).slots.length).toBeGreaterThan(0);
            expect((await withHol.slots(worked, 'svcconsulta', 'stfana', E, E)).slots).toEqual([]);
            // Google caído y sin nada guardado: otro país queda sin festivos; Colombia, con las reglas de la app.
            await redis.flushall();
            server.close();
            const offline = new BookingHolidaysService(redis as never, env);
            expect(await offline.items('MX')).toBeNull();
            const co = await offline.items('CO');
            expect(co?.length).toBeGreaterThan(30);
            expect(co).toEqual(expect.arrayContaining(colombianFallback(new Date().getUTCFullYear(), new Date().getUTCFullYear())));
            // Un país que no está en el catálogo no arma ninguna dirección.
            expect(await offline.items('ZZ')).toBeNull();
        } finally {
            if (prev === undefined) delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
            else process.env.DEV_ALLOW_PRIVATE_EGRESS = prev;
            server.close();
        }
    });
    it('v0.1.352 — página y horarios en caché: muchas visitas calculan una vez; reservar, un cambio del equipo o cambiar la agenda los renuevan', async () => {
        await freshPage();
        const cache = new PublicCache({ maxEntries: 200, concurrency: 4, maxQueue: 100, queueTimeoutMs: 5000 });
        const cached = new BookingPublicService(
            pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env, availability, calendar, rt, hub,
            new NotifyHub(), undefined, undefined, undefined, new MailService(env, mailbox), undefined, undefined, cache as never,
        );
        cached.onModuleInit();
        const admin = new BookingService(pg.db, tenantDb, lists, fieldsSvc, availability, NO_HOLIDAYS, calendar, myCalendar, undefined, cache as never);
        const spy = vi.spyOn(availability, 'slots');
        try {
            const q = { service: 'svcconsulta', staff: 'any', from: D, to: D } as const;
            // Veinte visitas a la vez miran la misma semana: se calcula UNA vez.
            const first = await Promise.all(Array.from({ length: 20 }, () => cached.slots(token, nextIp(), q)));
            expect(spy).toHaveBeenCalledTimes(1);
            expect(new Set(first.map((r) => JSON.stringify(r))).size).toBe(1);
            expect(first[0]!.slots.length).toBeGreaterThan(0);
            // La página no trae el sello: se pide aparte, siempre fresco.
            const info = await cached.pageInfo(token);
            expect(info!.meta.stamp).toBe('');
            expect((await cached.stamp(token)).stamp).toMatch(/^\d+\.[0-9a-f]{64}$/);
            expect((await cached.meta(token)).stamp).toMatch(/^\d+\.[0-9a-f]{64}$/);

            // Reservar el primer horario: los horarios se calculan de nuevo y ya no lo ofrecen.
            const taken = first[0]!.slots[0]!;
            const res = await cached.book(token, nextIp(), {
                service_id: 'svcconsulta', staff_id: 'any', start: taken.start, name: 'Visita 1', email: 'v1@cliente.co',
                values: {}, stamp: stamp(pageId), time_zone: TZ,
            });
            expect(res.ok).toBe(true);
            // La reserva renueva los horarios dos veces: al guardar y cuando el
            // aviso del registro nuevo llega (en segundo plano). Se espera a ambos.
            await vi.waitFor(() => expect(cache.version(`slots:${tenantId}`)).toBeGreaterThanOrEqual(2));
            // (La reserva vuelve a comprobar el horario por su cuenta: se cuentan sólo los pedidos de horarios.)
            spy.mockClear();
            const after = await cached.slots(token, nextIp(), q);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(after.slots.find((s) => s.start === taken.start)).toBeUndefined();

            // Lo guardado se usa mientras nadie cambia nada…
            await cached.slots(token, nextIp(), q);
            expect(spy).toHaveBeenCalledTimes(1);
            // …y un cambio del equipo en la lista de la agenda lo renueva.
            const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
            await recs.update(tenantId, { userId: ana, role: 'admin' }, 'citas', rec!.id, { data: { [`f${f.notas!.id}`]: 'Cambio del equipo' } });
            await vi.waitFor(async () => {
                await cached.slots(token, nextIp(), q);
                expect(spy).toHaveBeenCalledTimes(2);
            });

            // Cambiar la agenda desde el constructor: la página guardada deja de valer.
            const cfg = pageConfig();
            cfg.settings.title = 'Agenda renovada';
            await admin.update(tenantId, 'citas', pageId, { config: cfg });
            expect((await cached.pageInfo(token))!.title).toBe('Agenda renovada');
            // Despublicarla: deja de existir para el visitante en el acto.
            await admin.update(tenantId, 'citas', pageId, { enabled: false });
            expect(await cached.pageInfo(token)).toBeNull();
            await expect(cached.stamp(token)).rejects.toMatchObject({ status: 404 });
        } finally {
            spy.mockRestore();
        }
    });

    // ─────────────────────────── v0.1.353 ───────────────────────────

    const pageNow = () => booking.get(tenantId, 'citas', pageId);
    const recordOfAppt = async (recordId: number) =>
        ((await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, recordId))))[0]!.data as Record<string, unknown>);

    it('v0.1.353 — aprobación: queda por confirmar (ocupa el lugar, sin calendario ni recordatorio), se aprueba desde la ficha y sólo entonces se confirma', async () => {
        await pageWith((c) => {
            c.approval.mode = 'all';
            c.approval.hours = 12;
        });
        const page = await pageNow();
        // Al publicar con aprobación, el campo de estado gana «Por confirmar» y «Rechazada».
        expect(page.config.mapping.status_pending).toBeTruthy();
        expect(page.config.mapping.status_declined).toBeTruthy();
        const res = await book({ staff: 'stfana', start: at(D, 10) });
        expect(res.appointment).toMatchObject({ status: 'pending', meeting_url: null });
        const [appt] = await appointments();
        expect(appt!.status).toBe('pending');
        expect(appt!.pendingUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 12 * 3600_000 + 5_000);
        expect((await recordOfAppt(appt!.recordId))[`f${f.estado!.id}`]).toBe(page.config.mapping.status_pending);
        // Ocupa el lugar.
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots.map((x) => x.start)).not.toContain(at(D, 10));
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        expect(mailbox.sent[0]!.subject).toContain('Recibimos tu solicitud de cita');
        expect(mailbox.sent[0]!.attachments ?? []).toEqual([]);
        expect(calendar.created).toEqual([]);
        await vi.waitFor(() => expect(dispatcher.events.some((e) => e.booking?.event === 'requested')).toBe(true));
        // Una automatización vieja «cuando se agenda» (sin eventos elegidos) no sale todavía.
        expect(dispatcher.events.some((e) => e.booking?.event === 'booked')).toBe(false);
        expect(notified.some((n) => (n as { title?: string }).title?.startsWith('Cita por confirmar'))).toBe(true);
        // Sin recordatorio mientras espera.
        expect(await reminders.tick(new Date(Date.parse(at(D, 10)) - 3600_000))).toBe(0);

        // Beto (agente, no aprueba) no puede decidir; Ana (atiende y es admin), sí.
        const dtoBeto = await pub.recordBooking(tenantId, { userId: beto, role: 'agent' }, 'citas', appt!.recordId).catch(() => null);
        if (dtoBeto) expect(dtoBeto.can_decide).toBe(false);
        await expect(pub.decide(tenantId, { userId: beto, role: 'agent' }, 'citas', appt!.recordId, { decision: 'approve' })).rejects.toMatchObject({ status: expect.any(Number) });
        const dto = await pub.recordBooking(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId);
        expect(dto).toMatchObject({ status: 'pending', can_decide: true, on_timeout: 'decline', client_email: 'luis@cliente.co' });

        mailbox.sent.length = 0;
        dispatcher.events.length = 0;
        // Dos aprobaciones a la vez: una sola cuenta.
        const both = await Promise.allSettled([
            pub.decide(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId, { decision: 'approve' }),
            pub.decide(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId, { decision: 'approve' }),
        ]);
        expect(both.filter((b) => b.status === 'fulfilled').length).toBe(1);
        const [after] = await appointments();
        expect(after).toMatchObject({ status: 'confirmed', pendingUntil: null, decidedBy: ana });
        expect((await recordOfAppt(after!.recordId))[`f${f.estado!.id}`]).toBe(page.config.mapping.status_confirmed);
        await vi.waitFor(() => expect(calendar.created.length).toBe(1));
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        expect(mailbox.sent[0]!.subject).toContain('Tu cita está confirmada');
        expect(mailbox.sent[0]!.attachments?.[0]?.filename).toBe('cita.ics');
        await vi.waitFor(() => expect(dispatcher.events.filter((e) => e.booking?.event === 'booked').length).toBe(1));
        await expect(pub.decide(tenantId, { userId: ana, role: 'admin' }, 'citas', appt!.recordId, { decision: 'decline' })).rejects.toMatchObject({ status: 409 });
    });

    it('v0.1.353 — rechazar (desde la ficha o poniendo el estado), el plazo que vence y «sólo la primera cita de cada cliente»', async () => {
        await pageWith((c) => {
            c.approval.mode = 'new_clients';
            c.approval.approver_user_ids = [beto];
            c.approval.staff_approves = false;
        });
        const page = await pageNow();
        // Primera cita de Luis: por confirmar. Beto aprueba (es de quienes aprueban) y la rechaza con motivo.
        const r1 = await book({ staff: 'stfana', start: at(D, 8) });
        expect(r1.appointment!.status).toBe('pending');
        const [a1] = await appointments();
        expect(notified.some((n) => (n as { userIds?: number[] }).userIds?.includes(beto))).toBe(true);
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        mailbox.sent.length = 0;
        const declined = await pub.decide(tenantId, { userId: beto, role: 'viewer' }, 'citas', a1!.recordId, { decision: 'decline', reason: 'No hay cupo esa semana' });
        expect(declined).toMatchObject({ status: 'declined', decline_reason: 'No hay cupo esa semana', decided_by_name: 'Beto Díaz' });
        expect((await recordOfAppt(a1!.recordId))[`f${f.estado!.id}`]).toBe(page.config.mapping.status_declined);
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        expect(mailbox.sent[0]!.subject).toContain('Tu cita no pudo confirmarse');
        expect(mailbox.sent[0]!.text).toContain('No hay cupo esa semana');
        // El lugar quedó libre y el enlace del correo ya no deja cambios.
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: D, to: D })).slots.map((x) => x.start)).toContain(at(D, 8));
        await expect(pub.cancel(refOf(r1.appointment!.manage_url), IP, {})).rejects.toMatchObject({ status: 403 });

        // Segunda: el equipo la aprueba poniéndole «Confirmada» en la ficha.
        const r2 = await book({ staff: 'stfana', start: at(D, 9) });
        expect(r2.appointment!.status).toBe('pending');
        const a2 = (await appointments()).find((a) => a.id !== a1!.id)!;
        await recs.update(tenantId, { userId: ana, role: 'admin' }, 'citas', a2.recordId, { data: { [`f${f.estado!.id}`]: page.config.mapping.status_confirmed } });
        await vi.waitFor(async () => expect((await appointments()).find((a) => a.id === a2.id)!.status).toBe('confirmed'));
        await vi.waitFor(() => expect(calendar.created.length).toBe(1));

        // Luis ya es conocido: su próxima cita se confirma sola (sin importar mayúsculas).
        const r3 = await book({ staff: 'stfana', start: at(E, 9), email: 'luis@CLIENTE.co' });
        expect(r3.appointment!.status).toBe('confirmed');

        // Otro cliente: por confirmar; nadie decide y el plazo vence → se rechaza sola y avisa.
        const r4 = await book({ staff: 'stfana', start: at(E, 10), email: 'nuevo@cliente.co' });
        expect(r4.appointment!.status).toBe('pending');
        notified.length = 0;
        expect(await pub.expirePending(new Date(Date.now() - 60_000))).toBe(0);
        expect(await pub.expirePending(new Date(Date.parse(at(E, 10)) + 1000))).toBe(1);
        const a4 = (await appointments()).find((a) => a.clientEmail === 'nuevo@cliente.co')!;
        expect(a4.status).toBe('declined');
        expect(notified.some((n) => (n as { title?: string }).title?.startsWith('Venció el plazo'))).toBe(true);
        // Y no se vuelve a vencer.
        expect(await pub.expirePending(new Date(Date.parse(at(E, 10)) + 2000))).toBe(0);
    });

    it('v0.1.353 — seguridad: código por correo, correos temporales afuera, freno por correo y la prueba atada a la página y al correo', async () => {
        await pageWith((c) => {
            c.settings.verify_email = true;
            c.settings.block_disposable_email = true;
        });
        const meta = await pub.meta(token);
        expect(meta.verify_email).toBe(true);
        // Sin la prueba no se agenda.
        await expect(book({ staff: 'stfana', start: at(D, 10) })).rejects.toMatchObject({ response: { code: 'booking_email_unverified' } });
        // Correo temporal: ni código ni reserva.
        await expect(pub.requestCode(token, nextIp(), { email: 'x@mailinator.com', stamp: stamp(pageId) })).rejects.toMatchObject({ response: { code: 'booking_invalid' } });
        await expect(pub.requestCode(token, nextIp(), { email: 'x@sub.yopmail.com', stamp: stamp(pageId) })).rejects.toMatchObject({ status: 400 });
        // Pedir el código: llega al correo con el código en el asunto.
        await pub.requestCode(token, nextIp(), { email: 'luis@cliente.co', stamp: stamp(pageId) });
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(1));
        const code = /(\d{6}) es tu código/.exec(mailbox.sent[0]!.subject)![1]!;
        expect(mailbox.sent[0]!.to).toBe('luis@cliente.co');
        // Mal escrito: avisa cuántos intentos quedan; al quinto, hay que pedir otro.
        const wrong = code === '000000' ? '111111' : '000000';
        await expect(pub.verifyCode(token, nextIp(), { email: 'luis@cliente.co', code: wrong })).rejects.toMatchObject({ response: { code: 'booking_code_wrong' } });
        const ok = await pub.verifyCode(token, nextIp(), { email: 'LUIS@cliente.co', code });
        // El código se consume.
        await expect(pub.verifyCode(token, nextIp(), { email: 'luis@cliente.co', code })).rejects.toMatchObject({ response: { code: 'booking_code_expired' } });
        // La prueba vale para ESE correo y ESA página.
        const withProof = (email: string, proof: string) =>
            pub.book(token, nextIp(), { service_id: 'svcconsulta', staff_id: 'stfana', start: at(D, 10), name: 'Luis', email, values: {}, stamp: stamp(pageId), email_proof: proof });
        await expect(withProof('otra@cliente.co', ok.proof)).rejects.toMatchObject({ response: { code: 'booking_email_unverified' } });
        await expect(withProof('luis@cliente.co', ok.proof.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')))).rejects.toMatchObject({ response: { code: 'booking_email_unverified' } });
        await expect(withProof('luis@cliente.co', ok.proof)).resolves.toMatchObject({ ok: true });
        // Cinco intentos fallidos bloquean el código.
        await pub.requestCode(token, nextIp(), { email: 'beta@cliente.co', stamp: stamp(pageId) });
        for (let i = 0; i < 4; i++) {
            await expect(pub.verifyCode(token, nextIp(), { email: 'beta@cliente.co', code: '999999' === code ? '888888' : '999999' })).rejects.toMatchObject({ response: { code: 'booking_code_wrong' } });
        }
        await expect(pub.verifyCode(token, nextIp(), { email: 'beta@cliente.co', code: '999999' === code ? '888888' : '999999' })).rejects.toMatchObject({ response: { code: 'booking_code_locked' } });
        // Tres códigos en diez minutos por correo, aunque cambie la IP.
        await pub.requestCode(token, nextIp(), { email: 'gamma@cliente.co', stamp: stamp(pageId) });
        await pub.requestCode(token, nextIp(), { email: 'gamma@cliente.co', stamp: stamp(pageId) });
        await pub.requestCode(token, nextIp(), { email: 'gamma@cliente.co', stamp: stamp(pageId) });
        await expect(pub.requestCode(token, nextIp(), { email: 'gamma@cliente.co', stamp: stamp(pageId) })).rejects.toMatchObject({ status: 429 });
    });

    it('v0.1.353 — freno de reservas por correo (aunque cambie la IP) y correos temporales sin código', async () => {
        await pageWith((c) => {
            c.settings.block_disposable_email = true;
        }, { max_per_day: null, buffer_after_min: 0 });
        await expect(book({ staff: 'stfana', start: at(D, 10), email: 'a@10minutemail.com' })).rejects.toMatchObject({ response: { code: 'booking_invalid', data: { errors: { email: expect.stringContaining('temporales') } } } });
        const slots = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30'].map((h) => at(D, Number(h.slice(0, 2)), Number(h.slice(3))));
        for (const start of slots.slice(0, 5)) await book({ staff: 'stfana', start, email: 'mucho@cliente.co' });
        await expect(book({ staff: 'stfana', start: slots[5]!, email: 'Mucho@Cliente.co' })).rejects.toMatchObject({ status: 429 });
    });

    // ─────────────────────────── v0.1.354 ───────────────────────────

    it('v0.1.354 — diseño: la página sale con el tema y lo que se muestra; sin tema, el de siempre', async () => {
        await freshPage();
        // Sin tema: el de siempre de la agenda (pasos «Paso X de Y», 720 de ancho).
        const plain = await pub.cachedPage(token);
        expect(plain!.info.meta.theme!.progress).toBe('steps');
        expect(plain!.info.look.classes).toEqual(expect.arrayContaining(['bk-ch-list', 'bk-cal-side', 'bk-slots-grid']));
        expect(plain!.info.look.css).toContain('--ib-width:720px');

        const cards = publicThemePresets('#0e7490').find((x) => x.id === 'cards')!.theme;
        const dto = await booking.get(tenantId, 'citas', pageId);
        const cfg = structuredClone(dto.config);
        cfg.settings.theme = { ...cards, colors: { ...cards.colors, accent: '#7c3aed' } };
        cfg.settings.display = { ...cfg.settings.display, show_prices: false, show_staff_photos: false, calendar_layout: 'stacked', slot_style: 'list', week_start: 'sunday' };
        await booking.update(tenantId, 'citas', pageId, { config: cfg });
        pub.forgetPage(token, tenantId);
        const info = (await pub.cachedPage(token))!.info;
        expect(info.meta.theme!.choice_style).toBe('cards');
        expect(info.meta.display).toMatchObject({ show_prices: false, calendar_layout: 'stacked', slot_style: 'list', week_start: 'sunday' });
        // El color del diseño manda: en la página y en los correos.
        expect(info.meta.accent_color).toBe('#7c3aed');
        expect(info.look.css).toContain('#7c3aed');
        expect(info.look.classes).toEqual(expect.arrayContaining(['bk-ch-cards', 'bk-cal-stacked', 'bk-slots-list', 'bk-hide-prices', 'bk-hide-photos']));
        // La página de una cita usa el mismo diseño.
        const r = await book({ staff: 'stfana', start: at(D, 10) });
        const manage = await pub.managePage(refOf(r.appointment!.manage_url));
        expect(manage!.look.css).toContain('#7c3aed');
        expect(manage!.meta.booking.theme!.choice_style).toBe('cards');
    });

    it('v0.1.354 — diseño: el CSS propio sólo lo agrega un admin y queda limpio; las imágenes son de la empresa; nace con el tema por defecto', async () => {
        await freshPage();
        const AGENT = { isAdmin: false };
        const dto = await booking.get(tenantId, 'citas', pageId);
        const withCss = (css: string, extra: Record<string, unknown> = {}) => {
            const cfg = structuredClone(dto.config);
            cfg.settings.theme = publicThemeSchema.parse({ custom_css: css, ...extra });
            return cfg;
        };
        const css = '.ib-title{letter-spacing:2px} .ib-card{background:url(https://evil.test/x.png)}';
        await expect(booking.update(tenantId, 'citas', pageId, { config: withCss(css) }, AGENT)).rejects.toMatchObject({ response: { code: 'custom_css_admin_only' } });
        const saved = await booking.update(tenantId, 'citas', pageId, { config: withCss(css) });
        expect(saved.config.settings.theme!.custom_css).toContain('letter-spacing:2px');
        expect(saved.config.settings.theme!.custom_css).not.toContain('evil.test');
        // Un agente que cambia otra cosa conserva el CSS que puso el admin.
        const keep = structuredClone(saved.config);
        keep.settings.title = 'Otro título';
        await expect(booking.update(tenantId, 'citas', pageId, { config: keep }, AGENT)).resolves.toBeTruthy();
        // …y puede aplicar un tema guardado de la empresa aunque traiga CSS.
        const brandCss = '.ib-btn{text-transform:uppercase}';
        await pg.db
            .update(tenants)
            .set({ settings: { format: { timezone: TZ }, public_themes: [{ id: 'thmmarca', name: 'Marca', theme: publicThemeSchema.parse({ custom_css: brandCss }), created_at: new Date().toISOString() }], public_theme_default: 'thmmarca' } })
            .where(eq(tenants.id, tenantId));
        await expect(booking.update(tenantId, 'citas', pageId, { config: withCss(brandCss) }, AGENT)).resolves.toBeTruthy();

        // Imágenes: sólo de la empresa y que no ejecutan nada.
        const [png] = await withTenant(pg.db, tenantId, (tx) => tx.insert(attachments).values({ tenantId, filename: 'portada.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/portada.png' }).returning());
        const [svg] = await withTenant(pg.db, tenantId, (tx) => tx.insert(attachments).values({ tenantId, filename: 'logo.svg', mime: 'image/svg+xml', sizeBytes: 10, storageKey: 'k/logo.svg' }).returning());
        const [ajena] = await withTenant(pg.db, otherTenant, (tx) => tx.insert(attachments).values({ tenantId: otherTenant, filename: 'y.png', mime: 'image/png', sizeBytes: 10, storageKey: 'k/y.png' }).returning());
        await expect(booking.update(tenantId, 'citas', pageId, { config: withCss('', { cover: { enabled: true, file_id: svg!.id } }) })).rejects.toMatchObject({ response: { code: 'invalid_image' } });
        await expect(booking.update(tenantId, 'citas', pageId, { config: withCss('', { cover: { enabled: true, file_id: ajena!.id } }) })).rejects.toMatchObject({ response: { code: 'invalid_image' } });
        await booking.update(tenantId, 'citas', pageId, { config: withCss('', { cover: { enabled: true, file_id: png!.id } }) });
        pub.forgetPage(token, tenantId);
        const info = (await pub.cachedPage(token))!.info;
        expect(info.meta.theme!.cover).toBeTruthy();
        expect(info.look.css).toMatch(new RegExp(`/files/${png!.id}/signed\\?`));

        // Una agenda nueva nace con el tema por defecto de la empresa.
        const nueva = await booking.create(tenantId, ana, 'citas', { name: 'Otra agenda' });
        expect(nueva.config.settings.theme!.custom_css).toBe(brandCss);
    });

    // ─────────────────────────── v0.1.374 ───────────────────────────

    it('v0.1.374 — medir conversiones: el origen va a sus columnas, el valor es el precio y la página de gracias trae la cita', async () => {
        const campana = await fieldsSvc.create(tenantId, 'citas', { label: 'Campaña', type: 'text', slug: 'campana374' } as never);
        const clic = await fieldsSvc.create(tenantId, 'citas', { label: 'Clic de Google', type: 'text', slug: 'gclid374' } as never);
        const pagina = await fieldsSvc.create(tenantId, 'citas', { label: 'Página', type: 'url', slug: 'pagina374' } as never);
        await pageWith((c) => {
            c.services[0] = { ...c.services[0]!, price: 80000 };
            c.settings.redirect_url = 'https://acme.co/gracias?s={{cita.servicio}}&d={{cita.fecha}}&h={{cita.hora}}&id={{envio.id}}&c={{utm_campaign}}&e={{cita.estado}}';
            c.settings.redirect_delay = 3;
            c.settings.conversion = { ...c.settings.conversion, google_ads: 'AW-123456789/AbCdEf', meta_event: true, value: 'price', currency: 'COP', share_contact: true };
            // Una columna que la agenda ya escribe (el nombre del cliente) no sirve para el origen.
            c.settings.attribution = {
                ...c.settings.attribution,
                enabled: true,
                utm_campaign_field_id: campana.id,
                gclid_field_id: clic.id,
                page_url_field_id: pagina.id,
                utm_source_field_id: f.cliente!.id,
            };
        });
        const meta = await pub.meta(token);
        expect(meta.conversion).toEqual({ google_ads: 'AW-123456789/AbCdEf', meta_event: true, attribution: true });
        expect(meta.redirect_delay).toBe(3);
        const dto = await booking.get(tenantId, 'citas', pageId);
        expect(dto.config.settings.attribution.utm_source_field_id).toBeNull();
        expect(dto.config.settings.attribution.utm_campaign_field_id).toBe(campana.id);

        const res = await pub.book(token, nextIp(), {
            service_id: 'svcconsulta',
            staff_id: 'stfana',
            start: at(D, 9),
            name: 'Ana Ads',
            email: 'ADS@x.co',
            phone: '+57 300 111 2233',
            values: {},
            stamp: stamp(pageId),
            attribution: { utm_campaign: 'Black Friday', gclid: 'Cj0KCQ-abc_123', page_url: 'https://acme.co/agenda', fbclid: 'con espacios', otra: 'x' },
        });
        expect(res.conversion).toMatchObject({ value: 80000, currency: 'COP', user_data: { email: 'ads@x.co', phone_number: '+573001112233' } });
        expect(res.conversion!.submission_id).toMatch(/^[A-Za-z0-9_-]{12}$/);
        const u = new URL(res.redirect_url!);
        expect(u.host).toBe('acme.co');
        expect(u.searchParams.get('s')).toBe('Consulta');
        expect(u.searchParams.get('d')).toBe(D);
        expect(u.searchParams.get('h')).toBe('09:00');
        expect(u.searchParams.get('id')).toBe(res.conversion!.submission_id);
        expect(u.searchParams.get('c')).toBe('Black Friday');
        expect(u.searchParams.get('e')).toBe('confirmada');

        const appt = (await appointments()).find((a) => a.clientEmail === 'ads@x.co')!;
        const [rec] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, appt.recordId!)));
        const data = rec!.data as Record<string, unknown>;
        expect(data[`f${campana.id}`]).toBe('Black Friday');
        expect(data[`f${clic.id}`]).toBe('Cj0KCQ-abc_123');
        expect(data[`f${pagina.id}`]).toBe('https://acme.co/agenda');
        // El nombre del cliente es el de la reserva, no el origen.
        expect(data[`f${f.cliente!.id}`]).toBe('Ana Ads');

        // Sin página de gracias ni valor: igual vuelve el id de la reserva (el evento del sitio sale siempre).
        await pageWith(() => undefined);
        const plain = await book({ staff: 'stfana', start: at(D, 10), email: 'plain@x.co' });
        expect(plain.redirect_url).toBeNull();
        expect(plain.conversion).toMatchObject({ value: null, currency: null });
        expect(plain.conversion!.user_data).toBeUndefined();
    });

});

describe('v0.1.349 — iCal de festivos (puro)', () => {
    it('lee días completos, renglones continuados, escapes y eventos de varios días; ignora lo demás', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;VALUE=DATE:20261225',
            'DTEND;VALUE=DATE:20261226',
            'SUMMARY:Navidad\\, fiesta',
            'DESCRIPTION:Día festivo',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'DTSTART;VALUE=DATE:20260402',
            'DTEND;VALUE=DATE:20260404',
            'SUMMARY:Semana',
            ' Santa',
            'DESCRIPTION:Día festivo',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'DTSTART:20260101T100000Z',
            'SUMMARY:Con hora (no es un festivo de día completo)',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'DTSTART;VALUE=DATE:20261224',
            'SUMMARY:Nochebuena',
            'DESCRIPTION:Día festivo\\nEste es un festivo de medio día.',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'DTSTART;VALUE=DATE:20260707',
            'STATUS:CANCELLED',
            'SUMMARY:Cancelado',
            'END:VEVENT',
            'END:VCALENDAR',
        ].join('\r\n');
        expect(parseHolidayIcs(ics)).toEqual([
            { date: '2026-04-02', name: 'SemanaSanta', kind: 'national' },
            { date: '2026-04-03', name: 'SemanaSanta', kind: 'national' },
            { date: '2026-12-24', name: 'Nochebuena', kind: 'half' },
            { date: '2026-12-25', name: 'Navidad, fiesta', kind: 'national' },
        ]);
        expect(parseHolidayIcs('<html>nada</html>')).toEqual([]);
    });
});
