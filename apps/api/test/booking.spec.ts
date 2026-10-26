import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    addDaysYmd,
    bookingConfigSchema,
    isColombianHoliday,
    newFormItemId,
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
import { BookingAvailabilityService } from '../src/booking/booking-availability.service';
import { BookingCalendarService, busyRequest, parseBusy, type CalendarEventInput } from '../src/booking/booking-calendar';
import { appointmentRecordData, sanitizeBookingConfig } from '../src/booking/booking-config';
import { bookingClientEmail } from '../src/booking/booking-email';
import { buildIcs, foldIcsLine } from '../src/booking/booking-ics';
import { renderBookingPage } from '../src/booking/booking-page';
import { BookingPublicService } from '../src/booking/booking-public.service';
import { BookingRemindersService } from '../src/booking/booking-reminders.service';
import { BookingService } from '../src/booking/booking.service';
import { loadEnv, type Env } from '../src/config/env';
import {
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
    override busy(_tenantId: number, connectionId: number): Promise<BusyInterval[]> {
        return Promise.resolve(this.busyByConn.get(connectionId) ?? []);
    }
    override createEvent(_tenantId: number, connectionId: number, input: CalendarEventInput): Promise<BookingExternalEvent> {
        this.created.push({ connectionId, input });
        return Promise.resolve({ connection_id: connectionId, provider: 'google_calendar', event_id: `ev${this.created.length}`, calendar: 'primary' });
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
        });
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
            service: { id: 'svcx', name: 'Consulta', duration_min: 30, description: '', price: null, option_value: null, active: true },
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
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        dispatcher = new CapturingDispatcher();
        const hub = new RecordChangeHub();
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
        const env = loadEnv({ FILES_SIGNING_SECRET: 'book-secret', APP_BASE_URL: 'https://app.test' });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-book-'))), env);
        mailbox = new CapturingMailTransport();
        calendar = new FakeCalendar(env, redis, tenantDb);
        const availability = new BookingAvailabilityService(tenantDb, calendar);
        booking = new BookingService(pg.db, tenantDb, lists, fieldsSvc, availability);
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

        const cancelled = await pub.cancel(ref, IP, { reason: 'Me salió un viaje' });
        expect(cancelled.status).toBe('cancelled');
        const [rec2] = await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.listId, listId)));
        expect((rec2!.data as Record<string, unknown>)[`f${f.estado!.id}`]).toBe(page.config.mapping.status_cancelled);
        await vi.waitFor(() => expect(mailbox.sent.length).toBe(3));
        expect(mailbox.sent[2]!.attachments![0]!.contentType).toContain('method=CANCEL');
        await vi.waitFor(() => expect(calendar.deleted).toEqual(['ev1']));
        expect((notified.at(-1) as { body?: string }).body).toContain('Motivo: Me salió un viaje');
        // Una cita cancelada no se vuelve a cancelar ni a mover.
        await expect(pub.cancel(ref, IP, {})).rejects.toMatchObject({ status: 403 });
        await expect(pub.reschedule(ref, IP, { start: at(E, 10) })).rejects.toMatchObject({ status: 403 });
        // Y su horario quedó libre.
        expect((await pub.slots(token, IP, { service: 'svcconsulta', staff: 'stfana', from: E, to: E })).slots.map((s) => s.start)).toContain(at(E, 9));
        const ics = await pub.ics(ref);
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
});
