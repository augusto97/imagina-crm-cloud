import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    addDaysYmd,
    bookingConfigSchema,
    integrationDef,
    integrationScopes,
    isColombianHoliday,
    ymdToMs,
    zonedInstant,
    zonedToday,
    type BookingConfig,
    type Field,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { BookingAvailabilityService } from '../src/booking/booking-availability.service';
import { BookingCalendarService, meetingFrom, parseGoogleChanges, parseGraphBatch, busyRequest } from '../src/booking/booking-calendar';
import { BookingCalendarSyncService } from '../src/booking/booking-calendar-sync.service';
import { BookingMyCalendarService } from '../src/booking/booking-my-calendar.service';
import { BookingPublicService } from '../src/booking/booking-public.service';
import { BookingService } from '../src/booking/booking.service';
import { loadEnv } from '../src/config/env';
import { bookingAppointments, bookingPages, connections, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { LocalFileStorage } from '../src/files/file-storage';
import { FilesService } from '../src/files/files.service';
import { IncidentHub, type IncidentReport } from '../src/incidents/incident-hub';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';
import { NO_HOLIDAYS } from './helpers/no-holidays';

/**
 * v0.1.350 — El calendario de cada persona, la videollamada de cada cita y la
 * sincronización de vuelta. Postgres y Redis reales y el servicio de
 * calendario REAL; lo simulado es el borde de la red: un Google Calendar y un
 * Microsoft Graph de mentira que responden como las APIs reales (`fields`,
 * `updatedMin`, `conferenceData` «pendiente», `$batch`, 404 de lo borrado).
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

interface GEvent {
    id: string;
    calendar: string;
    start: string;
    end: string;
    status: 'confirmed' | 'cancelled';
    updated: number;
    hangoutLink?: string;
}
interface OEvent {
    id: string;
    calendar: string | null;
    start: string;
    end: string;
    isCancelled: boolean;
}

/** Google Calendar + Microsoft Graph de mentira, en un puerto local. */
class FakeCalendarApi {
    server!: Server;
    base = '';
    n = 0;
    g = new Map<string, GEvent>();
    gCalendars = [
        { id: 'ana@acme.test', summary: 'Ana', primary: true, accessRole: 'owner', backgroundColor: '#4285f4' },
        { id: 'equipo@group.calendar.google.com', summary: 'Equipo', accessRole: 'writer' },
        { id: 'festivos@group.v.calendar.google.com', summary: 'Festivos', accessRole: 'reader' },
    ];
    listForbidden = false;
    conferencePending = true;
    gCreated: Array<{ calendar: string; query: string; body: Record<string, unknown> }> = [];
    o = new Map<string, OEvent>();
    oCreated: Array<{ path: string; body: Record<string, unknown> }> = [];
    teamsFails = false;
    requests: string[] = [];

    async start(): Promise<void> {
        this.server = createServer((req, res) => void this.handle(req, res));
        await new Promise<void>((ok) => this.server.listen(0, '127.0.0.1', () => ok()));
        this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    }

    stop(): Promise<void> {
        return new Promise((ok) => this.server.close(() => ok()));
    }

    reset(): void {
        this.g.clear();
        this.o.clear();
        this.gCreated.length = 0;
        this.oCreated.length = 0;
        this.requests.length = 0;
        this.listForbidden = false;
        this.conferencePending = true;
        this.teamsFails = false;
    }

    /** Un evento «de la persona» en Google (no lo creó la agenda). */
    gPut(calendar: string, start: string, end: string): string {
        const id = `gx${++this.n}`;
        this.g.set(id, { id, calendar, start, end, status: 'confirmed', updated: Date.now() });
        return id;
    }

    private send(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));
    }

    private primary(cal: string): string {
        return cal === 'primary' ? this.gCalendars.find((c) => c.primary)!.id : cal;
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const url = new URL(req.url ?? '/', 'http://x');
        const path = decodeURIComponent(url.pathname);
        this.requests.push(`${req.method} ${path}`);
        if (req.headers.authorization !== 'Bearer tok') return this.send(res, 401, { error: 'sin token' });

        // ─── Google ───
        if (path === '/calendar/v3/users/me/calendarList' && req.method === 'GET') {
            if (this.listForbidden) return this.send(res, 403, { error: { message: 'Insufficient Permission' } });
            return this.send(res, 200, { items: this.gCalendars });
        }
        let m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(path);
        if (m && req.method === 'GET') {
            const cal = this.primary(m[1]!);
            const evs = [...this.g.values()].filter((e) => e.calendar === cal);
            if (url.searchParams.has('updatedMin')) {
                const since = Date.parse(url.searchParams.get('updatedMin')!);
                const items = evs.filter((e) => e.updated >= since).map((e) => ({ id: e.id, status: e.status, start: { dateTime: e.start }, end: { dateTime: e.end } }));
                return this.send(res, 200, { items });
            }
            const from = Date.parse(url.searchParams.get('timeMin') ?? '');
            const to = Date.parse(url.searchParams.get('timeMax') ?? '');
            const items = evs
                .filter((e) => e.status === 'confirmed' && Date.parse(e.end) > from && Date.parse(e.start) < to)
                .map((e) => ({ id: e.id, status: e.status, start: { dateTime: e.start }, end: { dateTime: e.end } }));
            return this.send(res, 200, { items });
        }
        if (m && req.method === 'POST') {
            const cal = this.primary(m[1]!);
            const id = `gev${++this.n}`;
            const start = String((body.start as { dateTime: string }).dateTime);
            const end = String((body.end as { dateTime: string }).dateTime);
            const ev: GEvent = { id, calendar: cal, start: new Date(start).toISOString(), end: new Date(end).toISOString(), status: 'confirmed', updated: Date.now() };
            this.gCreated.push({ calendar: cal, query: url.search, body });
            const out: Record<string, unknown> = { id };
            if (body.conferenceData) {
                ev.hangoutLink = `https://meet.google.com/abc-${this.n}`;
                if (this.conferencePending) out.conferenceData = { createRequest: { status: { statusCode: 'pending' } } };
                else out.hangoutLink = ev.hangoutLink;
            }
            this.g.set(id, ev);
            return this.send(res, 200, out);
        }
        m = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(path);
        if (m) {
            const ev = this.g.get(m[2]!);
            if (!ev) return this.send(res, 404, { error: 'no existe' });
            if (req.method === 'GET') return this.send(res, 200, { hangoutLink: ev.hangoutLink, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: ev.hangoutLink }] } });
            if (req.method === 'PATCH') {
                ev.start = new Date(String((body.start as { dateTime: string }).dateTime)).toISOString();
                ev.end = new Date(String((body.end as { dateTime: string }).dateTime)).toISOString();
                ev.updated = Date.now();
                return this.send(res, 200, { id: ev.id });
            }
            if (req.method === 'DELETE') {
                ev.status = 'cancelled';
                ev.updated = Date.now();
                res.writeHead(204).end();
                return;
            }
        }

        // ─── Microsoft Graph ───
        if (path === '/v1.0/me/calendars' && req.method === 'GET') {
            return this.send(res, 200, {
                value: [
                    { id: 'AAMkDEF', name: 'Calendario', isDefaultCalendar: true, canEdit: true },
                    { id: 'AAMkTRAB', name: 'Trabajo', isDefaultCalendar: false, canEdit: true },
                ],
            });
        }
        if ((path === '/v1.0/me/calendarView' || /^\/v1\.0\/me\/calendars\/[^/]+\/calendarView$/.test(path)) && req.method === 'GET') {
            return this.send(res, 200, { value: [] });
        }
        m = /^\/v1\.0\/me(?:\/calendars\/([^/]+))?\/events$/.exec(path);
        if (m && req.method === 'POST') {
            if (body.isOnlineMeeting === true && this.teamsFails) {
                return this.send(res, 400, { error: { code: 'ErrorInvalidRequest', message: 'Online meeting is not supported for this account.' } });
            }
            const id = `oev${++this.n}`;
            this.oCreated.push({ path, body });
            const start = `${String((body.start as { dateTime: string }).dateTime)}Z`;
            const end = `${String((body.end as { dateTime: string }).dateTime)}Z`;
            this.o.set(id, { id, calendar: m[1] ?? null, start: new Date(start).toISOString(), end: new Date(end).toISOString(), isCancelled: false });
            return this.send(res, 201, { id, ...(body.isOnlineMeeting ? { onlineMeeting: { joinUrl: `https://teams.microsoft.com/l/meetup-join/${id}` } } : {}) });
        }
        if (path === '/v1.0/$batch' && req.method === 'POST') {
            const responses = (body.requests as Array<{ id: string; url: string }>).map((r) => {
                const id = decodeURIComponent(/\/me\/events\/([^?]+)/.exec(r.url)![1]!);
                const ev = this.o.get(id);
                if (!ev) return { id: r.id, status: 404, body: { error: { code: 'ErrorItemNotFound' } } };
                return { id: r.id, status: 200, body: { id, start: { dateTime: ev.start.replace(/Z$/, '').replace(/\.000$/, '.0000000') }, end: { dateTime: ev.end.replace(/Z$/, '') }, isCancelled: ev.isCancelled, isAllDay: false } };
            });
            return this.send(res, 200, { responses });
        }
        m = /^\/v1\.0\/me\/events\/([^/]+)$/.exec(path);
        if (m) {
            const ev = this.o.get(m[1]!);
            if (!ev) return this.send(res, 404, {});
            if (req.method === 'PATCH') {
                ev.start = new Date(`${String((body.start as { dateTime: string }).dateTime)}Z`).toISOString();
                ev.end = new Date(`${String((body.end as { dateTime: string }).dateTime)}Z`).toISOString();
                return this.send(res, 200, { id: ev.id });
            }
            if (req.method === 'DELETE') {
                this.o.delete(ev.id);
                res.writeHead(204).end();
                return;
            }
        }
        return this.send(res, 404, { error: `ruta desconocida ${req.method} ${path}` });
    }
}

const TZ = 'America/Bogota';
const at = (ymd: string, h: number, m = 0): string => zonedInstant(ymd, TZ, { h, m }).toISOString();
function workday(fromYmd: string): string {
    let ymd = fromYmd;
    for (;;) {
        const [y, mo, d] = ymd.split('-').map(Number) as [number, number, number];
        const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
        if (dow >= 1 && dow <= 5 && !isColombianHoliday(ymdToMs(y, mo, d))) return ymd;
        ymd = addDaysYmd(ymd, 1);
    }
}

describe('v0.1.350 — calendarios (puro)', () => {
    it('lo ocupado se pide al calendario elegido (Google por id, Outlook por calendario)', () => {
        const g = busyRequest('google_calendar', 'https://g.test', 'tok', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z', undefined, 'equipo@group.calendar.google.com');
        expect(g.url.startsWith('https://g.test/calendar/v3/calendars/equipo%40group.calendar.google.com/events?')).toBe(true);
        const o = busyRequest('outlook', 'https://graph.test', 'tok', '2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z', undefined, 'AAMk=');
        expect(o.url.startsWith('https://graph.test/v1.0/me/calendars/AAMk%3D/calendarView?')).toBe(true);
    });

    it('el enlace de la videollamada: Meet (o pendiente), Teams, y nunca algo que no sea https', () => {
        expect(meetingFrom('google_calendar', { hangoutLink: 'https://meet.google.com/x' })).toEqual({ url: 'https://meet.google.com/x', pending: false });
        expect(meetingFrom('google_calendar', { conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })).toEqual({ url: null, pending: true });
        expect(meetingFrom('google_calendar', { conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/y' }] } }).url).toBe('https://meet.google.com/y');
        expect(meetingFrom('outlook', { onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/z' } }).url).toBe('https://teams.microsoft.com/l/z');
        expect(meetingFrom('outlook', { onlineMeeting: { joinUrl: 'javascript:alert(1)' } }).url).toBeNull();
        expect(meetingFrom('google_calendar', { hangoutLink: 'http://meet.google.com/x' }).url).toBeNull();
    });

    it('los cambios de Google (con borrados) y las respuestas del $batch de Graph', () => {
        const g = parseGoogleChanges(
            JSON.stringify({
                items: [
                    { id: 'a', status: 'confirmed', start: { dateTime: '2026-11-10T15:00:00Z' }, end: { dateTime: '2026-11-10T15:30:00Z' } },
                    { id: 'b', status: 'cancelled' },
                    { id: 'c', status: 'confirmed', start: { date: '2026-11-10' }, end: { date: '2026-11-11' } },
                ],
                nextPageToken: 'p2',
            }),
        );
        expect(g.next).toBe('p2');
        expect(g.items).toEqual([
            { id: 'a', gone: false, start: Date.parse('2026-11-10T15:00:00Z'), end: Date.parse('2026-11-10T15:30:00Z') },
            { id: 'b', gone: true, start: null, end: null },
            { id: 'c', gone: false, start: null, end: null },
        ]);
        const o = parseGraphBatch(
            JSON.stringify({
                responses: [
                    { id: '1', status: 200, body: { start: { dateTime: '2026-11-10T15:00:00.0000000' }, end: { dateTime: '2026-11-10T15:30:00.0000000' }, isCancelled: false } },
                    { id: '2', status: 404, body: {} },
                    { id: '3', status: 429, body: {} },
                    { id: '4', status: 200, body: { start: { dateTime: '2026-11-10T15:00:00' }, end: { dateTime: '2026-11-10T15:30:00' }, isCancelled: true } },
                ],
            }),
            new Map([
                ['1', 'e1'],
                ['2', 'e2'],
                ['3', 'e3'],
                ['4', 'e4'],
            ]),
        );
        expect(o.map((x) => [x.id, x.gone])).toEqual([
            ['e1', false],
            ['e2', true],
            ['e4', true],
        ]);
        expect(o[0]!.start).toBe(Date.parse('2026-11-10T15:00:00Z'));
    });

    it('«Mi calendario» de Google pide además ver la lista de calendarios; el de Outlook, no', () => {
        const g = integrationDef('google_calendar')!;
        expect(integrationScopes(g, { purpose: 'agenda' })).toContain('calendar.calendarlist.readonly');
        expect(integrationScopes(g)).not.toContain('calendarlist');
        const o = integrationDef('outlook')!;
        expect(integrationScopes(o, { purpose: 'agenda' })).toBe(integrationScopes(o));
    });
});

describe('v0.1.350 — calendario de cada persona, videollamada y sincronización (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let api: FakeCalendarApi;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let files: FilesService;
    let dispatcher: CapturingDispatcher;
    let mailbox: CapturingMailTransport;
    let calendar: BookingCalendarService;
    let mine: BookingMyCalendarService;
    let booking: BookingService;
    let pub: BookingPublicService;
    let sync: BookingCalendarSyncService;
    let incidents: IncidentReport[];
    const connectorsStub = {
        oauthAccessToken: () => Promise.resolve('tok'),
        startIntegrationOAuth: vi.fn(() => Promise.resolve({ authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' })),
        remove: vi.fn(() => Promise.resolve()),
    };
    let tenantId: number;
    let listId: number;
    let ana: number;
    let beto: number;
    let carla: number;
    let anaCal: number;
    let betoOutlook: number;
    let f: Record<string, Field>;
    let pageId: number;
    let token: string;
    let D: string;
    let prevEgress: string | undefined;
    let ipSeq = 0;
    const nextIp = (): string => `198.51.100.${(ipSeq++ % 250) + 1}`;
    const week = (intervals: Array<{ start: string; end: string }>) => [[], intervals, intervals, intervals, intervals, intervals, []];

    function pageConfig(over: Record<string, unknown> = {}): BookingConfig {
        return bookingConfigSchema.parse({
            settings: { title: 'Asesorías', location: 'Oficina central', ask_phone: 'optional' },
            services: [
                { id: 'svcvideo', name: 'Asesoría', duration_min: 30, location: { kind: 'video', video: 'auto' } },
                { id: 'svczoom', name: 'Revisión', duration_min: 30, location: { kind: 'link', url: 'https://zoom.us/j/123' } },
            ],
            staff: [
                { id: 'stfana', kind: 'user', staff_user_id: ana, calendar_source: 'person', availability: { week: week([{ start: '08:00', end: '12:00' }]) } },
                {
                    id: 'stfbeto',
                    kind: 'user',
                    staff_user_id: beto,
                    calendar_source: 'connection',
                    connection_id: betoOutlook,
                    write_calendar: 'AAMkTRAB',
                    meeting_url: 'https://zoom.us/j/beto',
                    availability: { week: week([{ start: '14:00', end: '18:00' }]) },
                },
            ],
            rules: { min_notice_min: 120, max_days_ahead: 60, slot_interval_min: 30 },
            mapping: {
                start_field_id: f.inicio!.id,
                end_field_id: f.fin!.id,
                person_field_id: f.profesional!.id,
                service_field_id: f.servicio!.id,
                name_field_id: f.cliente!.id,
                email_field_id: f.email!.id,
                status_field_id: f.estado!.id,
                meeting_url_field_id: f.enlace!.id,
            },
            ...over,
        });
    }

    async function freshPage(over: Record<string, unknown> = {}): Promise<void> {
        const dto = await booking.create(tenantId, ana, 'asesorias', { name: 'Asesorías' });
        await booking.update(tenantId, 'asesorias', dto.id, { config: pageConfig(over) });
        const published = await booking.update(tenantId, 'asesorias', dto.id, { enabled: true });
        pageId = published.id;
        token = published.public_path.split('/').pop()!;
        pub.forgetLists(tenantId);
    }

    function book(input: { staff: string; service?: string; start: string; email?: string }) {
        const ts = Date.now() - 10_000;
        return pub.book(token, nextIp(), {
            service_id: input.service ?? 'svcvideo',
            staff_id: input.staff,
            start: input.start,
            name: 'Luis Gómez',
            email: input.email ?? 'luis@cliente.co',
            values: {},
            stamp: `${ts}.${files.signParts('bookstamp', pageId, ts)}`,
        });
    }

    const appointments = () => withTenant(pg.db, tenantId, (tx) => tx.select().from(bookingAppointments).where(eq(bookingAppointments.pageId, pageId)));
    const recordOf = async (id: number) => (await withTenant(pg.db, tenantId, (tx) => tx.select().from(records).where(eq(records.id, id))))[0]!.data as Record<string, unknown>;
    const k = (field: Field): string => `f${field.id}`;

    beforeAll(async () => {
        prevEgress = process.env.DEV_ALLOW_PRIVATE_EGRESS;
        process.env.DEV_ALLOW_PRIVATE_EGRESS = '1';
        api = new FakeCalendarApi();
        [pg, rd] = await Promise.all([startPostgres(), startRedis(), api.start()]);
        redis = new IORedis(rd.url, { maxRetriesPerRequest: 1 });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        dispatcher = new CapturingDispatcher();
        const hub = new RecordChangeHub();
        const recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, new ActivityService(tenantDb, new ActivityRepository(), lists), dispatcher, new RelationsRepository(), undefined, hub);
        const env = loadEnv({ FILES_SIGNING_SECRET: 'book-secret', APP_BASE_URL: 'https://app.test', GOOGLE_CALENDAR_API_URL: api.base, MS_GRAPH_API_URL: api.base });
        files = new FilesService(tenantDb, new LocalFileStorage(mkdtempSync(join(tmpdir(), 'imb-bcal-'))), env);
        mailbox = new CapturingMailTransport();
        calendar = new BookingCalendarService(tenantDb, connectorsStub as never, redis as never, env);
        const availability = new BookingAvailabilityService(tenantDb, calendar, NO_HOLIDAYS);
        mine = new BookingMyCalendarService(tenantDb, calendar, connectorsStub as never, { resolve: () => Promise.resolve({}) } as never);
        booking = new BookingService(pg.db, tenantDb, lists, fieldsSvc, availability, NO_HOLIDAYS, calendar, mine);
        const inc = new IncidentHub();
        incidents = [];
        inc.subscribe({ report: (r: IncidentReport) => incidents.push(r), resolve: () => undefined, resolvePrefix: () => undefined } as never);
        pub = new BookingPublicService(pg.db, tenantDb, lists, fieldsSvc, recs, files, redis as never, dispatcher, env, availability, calendar, rt, hub, new NotifyHub(), inc, undefined, undefined, new MailService(env, mailbox), undefined);
        pub.onModuleInit();
        sync = new BookingCalendarSyncService(env, pg.db, redis as never, calendar, pub, inc);

        const [t] = await pg.db.insert(tenants).values({ slug: 'acmecal', name: 'Acme', settings: { format: { timezone: TZ } } }).returning();
        tenantId = t!.id;
        const [ua] = await pg.db.insert(users).values({ email: 'ana@acme.test', name: 'Ana Ruiz', passwordHash: 'x' }).returning();
        const [ub] = await pg.db.insert(users).values({ email: 'beto@acme.test', name: 'Beto Díaz', passwordHash: 'x' }).returning();
        const [uc] = await pg.db.insert(users).values({ email: 'carla@acme.test', name: 'Carla Paz', passwordHash: 'x' }).returning();
        ana = ua!.id;
        beto = ub!.id;
        carla = uc!.id;
        await pg.db.insert(memberships).values([
            { userId: ana, tenantId, role: 'admin' },
            { userId: beto, tenantId, role: 'manager' },
            { userId: carla, tenantId, role: 'manager' },
        ]);
        const [c1] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(connections)
                .values({ tenantId, provider: 'google_calendar', name: 'Google Calendar · ana@acme.test', authType: 'oauth2', visibility: 'private', ownerUserId: ana, config: { purpose: 'agenda', account_label: 'ana@acme.test' } })
                .returning(),
        );
        anaCal = c1!.id;
        const [c2] = await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(connections).values({ tenantId, provider: 'outlook', name: 'Outlook de recepción', authType: 'oauth2', visibility: 'workspace', ownerUserId: ana }).returning(),
        );
        betoOutlook = c2!.id;

        listId = (await lists.create(tenantId, { name: 'Asesorías' })).id;
        f = {};
        f.inicio = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Inicio', type: 'datetime', slug: 'inicio' });
        f.fin = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Fin', type: 'datetime', slug: 'fin' });
        f.profesional = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Asesor', type: 'user', slug: 'profesional' });
        f.servicio = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Servicio', type: 'select', slug: 'servicio', config: { options: [] } });
        f.cliente = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Cliente', type: 'text', slug: 'cliente' });
        f.email = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Correo', type: 'email', slug: 'email' });
        f.estado = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Estado', type: 'select', slug: 'estado', config: { options: [] } });
        f.enlace = await fieldsSvc.create(tenantId, 'asesorias', { label: 'Enlace de la reunión', type: 'url', slug: 'enlace' });
        D = workday(addDaysYmd(zonedToday(TZ, new Date()), 5));
    });

    afterAll(async () => {
        if (prevEgress === undefined) delete process.env.DEV_ALLOW_PRIVATE_EGRESS;
        else process.env.DEV_ALLOW_PRIVATE_EGRESS = prevEgress;
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop(), api?.stop()]);
    });

    beforeEach(async () => {
        await new Promise((r) => setTimeout(r, 300));
        api.reset();
        dispatcher.events.length = 0;
        mailbox.sent.length = 0;
        incidents.length = 0;
        connectorsStub.startIntegrationOAuth.mockClear();
        connectorsStub.remove.mockClear();
        await redis.flushall();
        calendar.forgetResolved(tenantId);
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(bookingPages).where(eq(bookingPages.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
            await tx.update(memberships).set({ settings: {} }).where(eq(memberships.tenantId, tenantId));
        });
        // Ana ya conectó su Google Calendar desde «Mi calendario».
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(memberships)
                .set({ settings: { agenda_calendar: { connection_id: anaCal, busy_calendars: [], write_calendar: null } } })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, ana))),
        );
    });

    it('«Mi calendario»: conecta como privada para la agenda, lista los calendarios y sólo acepta los de su cuenta', async () => {
        await mine.connect(tenantId, carla, 'manager', { provider: 'google_calendar' });
        expect(connectorsStub.startIntegrationOAuth).toHaveBeenCalledWith(tenantId, carla, 'manager', 'google_calendar', { visibility: 'private', connection_id: null }, { purpose: 'agenda' });
        // Ana ya tiene uno de Google: se re-autoriza ESE, no queda otro repetido.
        await mine.connect(tenantId, ana, 'admin', { provider: 'google_calendar' });
        expect(connectorsStub.startIntegrationOAuth).toHaveBeenLastCalledWith(tenantId, ana, 'admin', 'google_calendar', { visibility: 'private', connection_id: anaCal }, { purpose: 'agenda' });

        const dto = await mine.get(tenantId, ana);
        expect(dto.connection).toMatchObject({ id: anaCal, provider: 'google_calendar', account: 'ana@acme.test', problem: null });
        expect(dto.calendars!.map((c) => [c.name, c.primary, c.can_write])).toEqual([
            ['Ana', true, true],
            ['Equipo', false, true],
            ['Festivos', false, false],
        ]);
        expect(dto.providers.every((p) => p.available)).toBe(true);

        await expect(mine.update(tenantId, ana, { busy_calendars: ['otro@x.co'] })).rejects.toMatchObject({ response: { code: 'agenda_calendar_invalid' } });
        await expect(mine.update(tenantId, ana, { write_calendar: 'festivos@group.v.calendar.google.com' })).rejects.toMatchObject({ response: { code: 'agenda_calendar_readonly' } });
        const saved = await mine.update(tenantId, ana, { busy_calendars: ['ana@acme.test', 'equipo@group.calendar.google.com'], write_calendar: 'equipo@group.calendar.google.com' });
        expect(saved.busy_calendars).toEqual(['ana@acme.test', 'equipo@group.calendar.google.com']);
        expect(saved.write_calendar).toBe('equipo@group.calendar.google.com');
        // Elegir sólo el principal se guarda como «el principal» (sigue valiendo si cambia su id).
        expect((await mine.update(tenantId, ana, { busy_calendars: ['ana@acme.test'], write_calendar: 'ana@acme.test' })).busy_calendars).toEqual([]);

        // El admin ve el estado, nunca los nombres de los calendarios.
        await mine.update(tenantId, ana, { busy_calendars: ['ana@acme.test', 'equipo@group.calendar.google.com'] });
        const states = await mine.memberCalendars(tenantId, [ana, carla]);
        expect(states.get(ana)).toEqual({ provider: 'google_calendar', account: 'ana@acme.test', busy_count: 2, problem: null });
        expect(states.has(carla)).toBe(false);

        // Sin permiso para listar: el principal, y se explica.
        api.listForbidden = true;
        const noList = await mine.get(tenantId, ana);
        expect(noList.calendars).toEqual([{ id: 'primary', name: 'Calendario principal', primary: true, can_write: true, color: null }]);
        expect(noList.calendars_error).toMatch(/vuelve a conectar/);
        expect((await mine.update(tenantId, ana, { busy_calendars: [] })).busy_calendars).toEqual([]);

        // Desconectar borra SU conexión y la agenda deja de mirarla.
        const off = await mine.disconnect(tenantId, ana, 'admin');
        expect(connectorsStub.remove).toHaveBeenCalledWith(tenantId, ana, 'admin', anaCal, true);
        expect(off.connection).toBeNull();
        expect(await calendar.personalPrefs(tenantId, ana)).toEqual({ connection_id: null, busy_calendars: [], write_calendar: null });
    });

    it('seguridad: el calendario «de la persona» tiene que ser una conexión privada SUYA', async () => {
        // Beto apunta su «Mi calendario» a la conexión privada de Ana: no se usa.
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(memberships)
                .set({ settings: { agenda_calendar: { connection_id: anaCal, busy_calendars: [], write_calendar: null } } })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, beto))),
        );
        const staff = pageConfig().staff[1]!;
        expect(await calendar.resolveStaff(tenantId, { ...staff, calendar_source: 'person' })).toBeNull();
        // Y tampoco una conexión del equipo como «suya».
        await withTenant(pg.db, tenantId, (tx) =>
            tx
                .update(memberships)
                .set({ settings: { agenda_calendar: { connection_id: betoOutlook, busy_calendars: [], write_calendar: null } } })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, beto))),
        );
        calendar.forgetResolved(tenantId);
        expect(await calendar.resolveStaff(tenantId, { ...staff, calendar_source: 'person' })).toBeNull();
        expect((await mine.get(tenantId, beto)).connection).toBeNull();
        // La de Ana, para Ana, sí.
        expect(await calendar.resolveStaff(tenantId, pageConfig().staff[0]!)).toMatchObject({ connectionId: anaCal, provider: 'google_calendar' });
    });

    it('lo ocupado sale de TODOS los calendarios que la persona eligió (y no de los demás)', async () => {
        await mine.update(tenantId, ana, { busy_calendars: ['ana@acme.test', 'equipo@group.calendar.google.com'] });
        api.gPut('ana@acme.test', at(D, 9), at(D, 9, 30));
        api.gPut('equipo@group.calendar.google.com', at(D, 10), at(D, 10, 30));
        api.gPut('festivos@group.v.calendar.google.com', at(D, 11), at(D, 11, 30));
        await freshPage();
        const slots = await pub.slots(token, nextIp(), { service: 'svcvideo', staff: 'stfana', from: D, to: D });
        const starts = slots.slots.map((s) => s.start);
        expect(starts).toContain(at(D, 8));
        expect(starts).not.toContain(at(D, 9));
        expect(starts).not.toContain(at(D, 10));
        expect(starts).toContain(at(D, 11));
    });

    it('videollamada de Google Meet: se crea en el calendario elegido, el enlace llega a la confirmación, el registro, el correo y el disparador', async () => {
        await mine.update(tenantId, ana, { busy_calendars: ['ana@acme.test'], write_calendar: 'equipo@group.calendar.google.com' });
        await freshPage();
        const res = await book({ staff: 'stfana', start: at(D, 8) });
        // Google devolvió la sala «pendiente»: la agenda volvió a preguntar y la confirmación ya trae el enlace.
        expect(res.appointment!.meeting_url).toMatch(/^https:\/\/meet\.google\.com\/abc-\d+$/);
        expect(res.appointment!.location).toBe('Videollamada por Google Meet');
        expect(api.gCreated).toHaveLength(1);
        expect(api.gCreated[0]!.calendar).toBe('equipo@group.calendar.google.com');
        expect(api.gCreated[0]!.query).toContain('conferenceDataVersion=1');
        const link = res.appointment!.meeting_url!;
        const [appt] = await appointments();
        expect(appt!.meetingUrl).toBe(link);
        expect(appt!.meetingProvider).toBe('meet');
        expect(appt!.externalEvent).toMatchObject({ connection_id: anaCal, calendar: 'equipo@group.calendar.google.com', start: at(D, 8) });
        expect((await recordOf(appt!.recordId))[k(f.enlace!)]).toBe(link);
        await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1));
        expect(mailbox.sent[0]!.html).toContain('Unirse a la videollamada');
        expect(mailbox.sent[0]!.html).toContain(link);
        expect(Buffer.from(mailbox.sent[0]!.attachments![0]!.contentBase64, 'base64').toString('utf8')).toContain(link);
        await vi.waitFor(() => expect(dispatcher.events.some((e) => e.trigger === 'booking_event')).toBe(true));
        const ev = dispatcher.events.find((e) => e.trigger === 'booking_event')!;
        expect(ev.booking).toMatchObject({ event: 'booked', meeting_url: link, location: 'Videollamada por Google Meet' });
    });

    it('enlace fijo: el del servicio se conoce al reservar; Teams que no se puede crear cae al enlace de la persona', async () => {
        await freshPage();
        const zoom = await book({ staff: 'stfana', service: 'svczoom', start: at(D, 9) });
        expect(zoom.appointment!.meeting_url).toBe('https://zoom.us/j/123');
        expect(zoom.appointment!.location_kind).toBe('link');
        // Beto: Outlook de la empresa, cuenta sin Teams → el evento se crea igual y queda su Zoom.
        api.teamsFails = true;
        const teams = await book({ staff: 'stfbeto', start: at(D, 14) });
        await vi.waitFor(async () => {
            const rows = await appointments();
            const row = rows.find((r) => r.staffId === 'stfbeto');
            expect(row?.externalEvent).toBeTruthy();
            expect(row?.meetingUrl).toBe('https://zoom.us/j/beto');
            expect(row?.meetingProvider).toBe('link');
        });
        expect(teams.appointment).toBeTruthy();
        const created = api.oCreated.find((c) => c.path === '/v1.0/me/calendars/AAMkTRAB/events')!;
        expect(created).toBeTruthy();
        expect(created.body.isOnlineMeeting).toBeUndefined();
        expect(incidents.some((i) => i.title.includes('videollamada'))).toBe(false);
    });

    it('vuelta desde Google: quien atiende mueve el evento → la cita se mueve y se avisa; lo borra → se cancela', async () => {
        await freshPage();
        await book({ staff: 'stfana', start: at(D, 8) });
        let [appt] = await appointments();
        await vi.waitFor(async () => {
            [appt] = await appointments();
            expect(appt!.externalEvent?.event_id).toBeTruthy();
        });
        await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1));
        mailbox.sent.length = 0;
        dispatcher.events.length = 0;
        // Ana la corre una hora en su Google Calendar.
        const ev = api.g.get(appt!.externalEvent!.event_id)!;
        ev.start = at(D, 9);
        ev.end = at(D, 9, 30);
        ev.updated = Date.now();
        const r1 = await sync.tick(new Date());
        expect(r1.moved).toBe(1);
        [appt] = await appointments();
        expect(appt!.startAt.toISOString()).toBe(at(D, 9));
        expect(appt!.status).toBe('rescheduled');
        expect(appt!.externalEvent!.start).toBe(at(D, 9));
        const data = await recordOf(appt!.recordId);
        expect(data[k(f.inicio!)]).toBe(at(D, 9));
        expect(data[k(f.estado!)]).toBe('reprogramada');
        await vi.waitFor(() => expect(mailbox.sent).toHaveLength(1));
        expect(mailbox.sent[0]!.subject).toMatch(/cambió de horario/);
        const dispatched = dispatcher.events.find((e) => e.trigger === 'booking_event')!;
        expect(dispatched.booking).toMatchObject({ event: 'rescheduled', by: 'calendar', previous_start: at(D, 8) });
        // Otra vuelta sin cambios: nada.
        mailbox.sent.length = 0;
        expect((await sync.tick(new Date())).moved).toBe(0);
        // Lo borra en Google: la cita se cancela y el horario vuelve a ofrecerse.
        ev.status = 'cancelled';
        ev.updated = Date.now();
        const r2 = await sync.tick(new Date());
        expect(r2.cancelled).toBe(1);
        [appt] = await appointments();
        expect(appt!.status).toBe('cancelled');
        expect(appt!.externalEvent).toBeNull();
        expect((await recordOf(appt!.recordId))[k(f.estado!)]).toBe('cancelada');
        await vi.waitFor(() => expect(mailbox.sent.some((m) => /cancelada/.test(m.subject))).toBe(true));
    });

    it('lo que mueve la propia app (el cliente reprograma) no se toma por un cambio de quien atiende', async () => {
        await freshPage();
        const res = await book({ staff: 'stfana', start: at(D, 8) });
        await vi.waitFor(async () => expect((await appointments())[0]!.externalEvent).toBeTruthy());
        const ref = res.appointment!.manage_url.split('/manage/')[1]!;
        await pub.reschedule(ref, nextIp(), { start: at(D, 10) });
        await vi.waitFor(async () => expect((await appointments())[0]!.externalEvent!.start).toBe(at(D, 10)));
        const ev = api.g.get((await appointments())[0]!.externalEvent!.event_id)!;
        expect(ev.start).toBe(at(D, 10));
        dispatcher.events.length = 0;
        const r = await sync.tick(new Date());
        expect(r).toMatchObject({ moved: 0, cancelled: 0 });
        expect(dispatcher.events).toHaveLength(0);
    });

    it('vuelta desde Outlook ($batch por id): un evento borrado cancela la cita; con «cancelar» apagado, se deja', async () => {
        await freshPage();
        await book({ staff: 'stfbeto', start: at(D, 14) });
        await vi.waitFor(async () => expect((await appointments())[0]!.externalEvent?.provider).toBe('outlook'));
        api.o.clear();
        expect((await sync.tick(new Date())).cancelled).toBe(1);
        expect((await appointments())[0]!.status).toBe('cancelled');

        // Con «si lo borran, cancelar la cita» apagado: la cita queda y se suelta el evento.
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(bookingPages).where(eq(bookingPages.tenantId, tenantId));
            await tx.delete(records).where(eq(records.listId, listId));
        });
        await freshPage({ calendar_sync: { move: true, cancel: false } });
        await book({ staff: 'stfbeto', start: at(D, 15) });
        await vi.waitFor(async () => expect((await appointments())[0]!.externalEvent?.provider).toBe('outlook'));
        api.o.clear();
        expect((await sync.tick(new Date())).cancelled).toBe(0);
        const [kept] = await appointments();
        expect(kept!.status).toBe('confirmed');
        expect(kept!.externalEvent).toBeNull();
    });

    it('no se publica una videollamada que nadie puede crear; con su calendario o un enlace fijo, sí', async () => {
        const cfg = pageConfig({
            staff: [{ id: 'stfcarla', kind: 'user', staff_user_id: carla, calendar_source: 'person', availability: { week: week([{ start: '08:00', end: '12:00' }]) } }],
        });
        const dto = await booking.create(tenantId, ana, 'asesorias', { name: 'Carla' });
        await booking.update(tenantId, 'asesorias', dto.id, { config: cfg });
        await expect(booking.update(tenantId, 'asesorias', dto.id, { enabled: true })).rejects.toMatchObject({
            response: { message: expect.stringContaining('«Carla Paz» no puede atender «Asesoría» por videollamada') },
        });
        const page = await booking.get(tenantId, 'asesorias', dto.id);
        expect(page.problems.some((p) => p.includes('Mi calendario'))).toBe(true);
        // Con un enlace fijo, se puede.
        const fixed = { ...cfg, staff: [{ ...cfg.staff[0]!, meeting_url: 'https://zoom.us/j/carla' }] };
        await booking.update(tenantId, 'asesorias', dto.id, { config: fixed });
        await expect(booking.update(tenantId, 'asesorias', dto.id, { enabled: true })).resolves.toMatchObject({ enabled: true });
        // El constructor ve el estado del calendario de cada persona (sin sus calendarios).
        const opts = await booking.editorOptions(tenantId, 'asesorias');
        expect(opts.members.find((m) => m.id === ana)!.calendar).toMatchObject({ provider: 'google_calendar', account: 'ana@acme.test' });
        expect(opts.members.find((m) => m.id === carla)!.calendar).toBeNull();
    });
});
