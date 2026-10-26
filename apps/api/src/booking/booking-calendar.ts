import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BusyInterval } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import { buildIntegrationRequest, type IntegrationRequest } from '../connectors/integration-calls';
import { connections } from '../db/schema';
import type { BookingExternalEvent } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * D5 — El calendario de quien atiende (Google Calendar u Outlook, la conexión
 * de Ajustes → Integraciones asociada a esa persona en la página de agenda).
 *
 * LEER lo ocupado entra en el permiso que la app ya pide:
 *  - Google `calendar.events` («ver y editar los eventos de tus calendarios»)
 *    alcanza para `events.list`. Se piden SÓLO `start`, `end`, `status` y
 *    `transparency` con el parámetro `fields`: títulos, invitados y
 *    descripciones nunca salen de Google.
 *  - Microsoft `Calendars.ReadWrite` alcanza para `calendarView`; se piden
 *    sólo `start`, `end`, `showAs` e `isCancelled` con `$select`.
 * Los eventos «libres» (transparentes, «disponible») no ocupan.
 *
 * CREAR el evento de cada cita reusa el armado de la acción «Crear evento»
 * de las integraciones (`buildIntegrationRequest`); moverlo y borrarlo, las
 * llamadas equivalentes de cada API.
 */

const GOOGLE_DEFAULT = 'https://www.googleapis.com';
const GRAPH_DEFAULT = 'https://graph.microsoft.com';
/** Lo ocupado se guarda poco: una reserva nueva en el calendario tiene que verse pronto. */
const BUSY_CACHE_S = 90;
const MAX_PAGES = 4;

export type CalendarProvider = 'google_calendar' | 'outlook';

export function isCalendarProvider(p: string): p is CalendarProvider {
    return p === 'google_calendar' || p === 'outlook';
}

/** El pedido de lo ocupado (sólo inicio y fin). */
export function busyRequest(provider: CalendarProvider, base: string, token: string, fromIso: string, toIso: string, pageToken?: string): IntegrationRequest {
    if (provider === 'google_calendar') {
        const q = new URLSearchParams({
            timeMin: fromIso,
            timeMax: toIso,
            singleEvents: 'true',
            maxResults: '250',
            fields: 'items(start,end,status,transparency),nextPageToken',
            ...(pageToken ? { pageToken } : {}),
        });
        return { url: `${base}/calendar/v3/calendars/primary/events?${q.toString()}`, method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` } };
    }
    const q = new URLSearchParams({
        startDateTime: fromIso,
        endDateTime: toIso,
        $select: 'start,end,showAs,isCancelled,isAllDay',
        $top: '250',
    });
    return {
        url: pageToken ?? `${base}/v1.0/me/calendarView?${q.toString()}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' },
    };
}

interface ParsedBusy {
    busy: BusyInterval[];
    next: string | null;
}

/** Lo ocupado de una respuesta: sólo inicio y fin de lo que no está libre ni cancelado. */
export function parseBusy(provider: CalendarProvider, body: string): ParsedBusy {
    let json: Record<string, unknown>;
    try {
        json = JSON.parse(body) as Record<string, unknown>;
    } catch {
        return { busy: [], next: null };
    }
    const out: BusyInterval[] = [];
    if (provider === 'google_calendar') {
        for (const raw of Array.isArray(json.items) ? (json.items as Array<Record<string, unknown>>) : []) {
            if (raw.status === 'cancelled' || raw.transparency === 'transparent') continue;
            const s = (raw.start ?? {}) as { dateTime?: string; date?: string };
            const e = (raw.end ?? {}) as { dateTime?: string; date?: string };
            // Un evento de todo el día ocupa ese día entero (en UTC: la persona lo marcó ocupado).
            const start = Date.parse(s.dateTime ?? (s.date ? `${s.date}T00:00:00Z` : ''));
            const end = Date.parse(e.dateTime ?? (e.date ? `${e.date}T00:00:00Z` : ''));
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end, kind: 'external' });
        }
        return { busy: out, next: typeof json.nextPageToken === 'string' ? json.nextPageToken : null };
    }
    for (const raw of Array.isArray(json.value) ? (json.value as Array<Record<string, unknown>>) : []) {
        if (raw.isCancelled === true) continue;
        const show = String(raw.showAs ?? 'busy');
        if (show === 'free' || show === 'workingElsewhere') continue;
        const s = (raw.start ?? {}) as { dateTime?: string };
        const e = (raw.end ?? {}) as { dateTime?: string };
        const z = (v: string | undefined): number => (v ? Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`) : NaN);
        const start = z(s.dateTime);
        const end = z(e.dateTime);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end, kind: 'external' });
    }
    const next = json['@odata.nextLink'];
    return { busy: out, next: typeof next === 'string' ? next : null };
}

/** Mover el evento (sólo inicio y fin). */
export function moveEventRequest(ev: BookingExternalEvent, base: { google: string; graph: string }, token: string, start: Date, end: Date): { url: string; method: 'PATCH'; headers: Record<string, string>; body: string } {
    if (ev.provider === 'google_calendar') {
        return {
            url: `${base.google}/calendar/v3/calendars/${encodeURIComponent(ev.calendar || 'primary')}/events/${encodeURIComponent(ev.event_id)}`,
            method: 'PATCH',
            headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ start: { dateTime: start.toISOString(), timeZone: 'UTC' }, end: { dateTime: end.toISOString(), timeZone: 'UTC' } }),
        };
    }
    return {
        url: `${base.graph}/v1.0/me/events/${encodeURIComponent(ev.event_id)}`,
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
            start: { dateTime: start.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
            end: { dateTime: end.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
        }),
    };
}

export function deleteEventRequest(ev: BookingExternalEvent, base: { google: string; graph: string }, token: string): IntegrationRequest {
    const url =
        ev.provider === 'google_calendar'
            ? `${base.google}/calendar/v3/calendars/${encodeURIComponent(ev.calendar || 'primary')}/events/${encodeURIComponent(ev.event_id)}`
            : `${base.graph}/v1.0/me/events/${encodeURIComponent(ev.event_id)}`;
    return { url, method: 'DELETE', headers: { accept: 'application/json', authorization: `Bearer ${token}` } };
}

/** Cambia el origen de un pedido armado contra la API real (para el entorno de pruebas). */
function rebase(url: string, real: string, base: string): string {
    return base !== real && url.startsWith(real) ? `${base}${url.slice(real.length)}` : url;
}

export interface CalendarEventInput {
    title: string;
    start: Date;
    end: Date;
    timeZone: string;
    description: string;
}

@Injectable()
export class BookingCalendarService {
    private readonly logger = new Logger(BookingCalendarService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly connectors: ConnectorsService,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
    ) {}

    private get bases(): { google: string; graph: string } {
        return {
            google: (this.env.GOOGLE_CALENDAR_API_URL || GOOGLE_DEFAULT).replace(/\/+$/, ''),
            graph: (this.env.MS_GRAPH_API_URL || GRAPH_DEFAULT).replace(/\/+$/, ''),
        };
    }

    /** Proveedor de una conexión de calendario de la empresa (null si no es de calendario o no existe). */
    async providerOf(tenantId: number, connectionId: number): Promise<{ provider: CalendarProvider; name: string } | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ provider: connections.provider, name: connections.name })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1),
        );
        return row && isCalendarProvider(row.provider) ? { provider: row.provider, name: row.name } : null;
    }

    /**
     * Lo ocupado entre dos instantes. Lanza con el motivo si no se pudo leer
     * (el que llama decide: la agenda sigue con lo que sabe y avisa).
     */
    async busy(tenantId: number, connectionId: number, from: Date, to: Date): Promise<BusyInterval[]> {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const cacheKey = `bookbusy:${tenantId}:${connectionId}:${fromIso.slice(0, 13)}:${toIso.slice(0, 13)}`;
        try {
            const hit = await this.redis.get(cacheKey);
            if (hit) return JSON.parse(hit) as BusyInterval[];
        } catch {
            /* sin caché: se pide */
        }
        const conn = await this.providerOf(tenantId, connectionId);
        if (!conn) throw new Error('La conexión de calendario ya no existe.');
        const token = await this.connectors.oauthAccessToken(tenantId, connectionId);
        const base = conn.provider === 'google_calendar' ? this.bases.google : this.bases.graph;
        const all: BusyInterval[] = [];
        let next: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
            const req = busyRequest(conn.provider, base, token, fromIso, toIso, next);
            const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, maxCaptureBytes: 512 * 1024, timeoutMs: 8000 });
            if (res.status === 401 || res.status === 403) throw new Error(`«${conn.name}» no tiene acceso al calendario: reconéctala en Ajustes → Integraciones.`);
            if (res.status >= 400) throw new Error(`El calendario de «${conn.name}» respondió ${res.status}.`);
            const parsed = parseBusy(conn.provider, res.body ?? '');
            all.push(...parsed.busy);
            if (!parsed.next) break;
            next = parsed.next;
        }
        await this.redis.set(cacheKey, JSON.stringify(all), 'EX', BUSY_CACHE_S).catch(() => undefined);
        return all;
    }

    /** Olvida lo ocupado guardado de esa conexión (después de crear o mover un evento). */
    async forget(tenantId: number, connectionId: number): Promise<void> {
        try {
            const keys = await this.redis.keys(`bookbusy:${tenantId}:${connectionId}:*`);
            if (keys.length > 0) await this.redis.del(...keys);
        } catch {
            /* vence sola en segundos */
        }
    }

    /** Crea el evento de la cita en el calendario de quien atiende. */
    async createEvent(tenantId: number, connectionId: number, input: CalendarEventInput): Promise<BookingExternalEvent> {
        const conn = await this.providerOf(tenantId, connectionId);
        if (!conn) throw new Error('La conexión de calendario ya no existe.');
        const token = await this.connectors.oauthAccessToken(tenantId, connectionId);
        const minutes = Math.max(1, Math.round((input.end.getTime() - input.start.getTime()) / 60_000));
        const req = buildIntegrationRequest(
            conn.provider,
            'create_event',
            {
                values: {
                    title: input.title,
                    date: input.start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
                    time: '',
                    duration: String(minutes),
                    timezone: input.timeZone,
                    description: input.description,
                    attendees: '',
                },
                lines: {},
            },
            { secret: '', accessToken: token, fields: {}, signingSecret: '' },
        );
        const url = rebase(rebase(req.url, GOOGLE_DEFAULT, this.bases.google), GRAPH_DEFAULT, this.bases.graph);
        const res = await safeWebhookFetch(url, { method: req.method, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}), captureBody: true, timeoutMs: 10_000 });
        if (res.status >= 400) throw new Error(`El calendario de «${conn.name}» rechazó el evento (${res.status}).`);
        let id = '';
        try {
            id = String((JSON.parse(res.body ?? '{}') as { id?: unknown }).id ?? '');
        } catch {
            id = '';
        }
        if (id === '') throw new Error(`El calendario de «${conn.name}» no devolvió el evento creado.`);
        await this.forget(tenantId, connectionId);
        return { connection_id: connectionId, provider: conn.provider, event_id: id, calendar: conn.provider === 'google_calendar' ? 'primary' : null };
    }

    async moveEvent(tenantId: number, ev: BookingExternalEvent, start: Date, end: Date): Promise<void> {
        const token = await this.connectors.oauthAccessToken(tenantId, ev.connection_id);
        const req = moveEventRequest(ev, this.bases, token, start, end);
        const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, body: req.body, captureBody: true, timeoutMs: 10_000 });
        if (res.status >= 400) throw new Error(`No se pudo mover el evento del calendario (${res.status}).`);
        await this.forget(tenantId, ev.connection_id);
    }

    async deleteEvent(tenantId: number, ev: BookingExternalEvent): Promise<void> {
        const token = await this.connectors.oauthAccessToken(tenantId, ev.connection_id);
        const req = deleteEventRequest(ev, this.bases, token);
        const res = await safeWebhookFetch(req.url, { method: 'DELETE', headers: req.headers, captureBody: true, timeoutMs: 10_000 });
        // Ya borrado del otro lado: está bien.
        if (res.status >= 400 && res.status !== 404 && res.status !== 410) throw new Error(`No se pudo borrar el evento del calendario (${res.status}).`);
        await this.forget(tenantId, ev.connection_id);
    }
}
