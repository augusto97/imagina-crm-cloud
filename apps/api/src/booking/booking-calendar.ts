import { Inject, Injectable, Logger } from '@nestjs/common';
import { agendaCalendarPrefsSchema, type AgendaCalendarItem, type BookingStaff, type BusyInterval } from '@imagina-base/shared';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { ConnectorsService } from '../connectors/connectors.service';
import { buildIntegrationRequest, type IntegrationRequest } from '../connectors/integration-calls';
import { connections, memberships } from '../db/schema';
import type { BookingExternalEvent } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * D5 — El calendario de quien atiende (Google Calendar u Outlook).
 *
 * v0.1.350 — De dónde sale: el que la persona conectó ella misma en «Mi
 * calendario» (Ajustes → Cuenta, una conexión privada suya con
 * `config.purpose = 'agenda'`), o una conexión que eligió quien arma la
 * agenda. En los dos casos se elige EN QUÉ calendarios de la cuenta se mira lo
 * ocupado y en cuál se crean las citas.
 *
 * LEER lo ocupado entra en el permiso que la app ya pide:
 *  - Google `calendar.events` alcanza para `events.list` de cualquier
 *    calendario de la cuenta. Se piden SÓLO `id`, `start`, `end`, `status` y
 *    `transparency` con el parámetro `fields`: títulos, invitados y
 *    descripciones nunca salen de Google. LISTAR los calendarios pide además
 *    `calendar.calendarlist.readonly` (sólo «Mi calendario» lo pide); sin él
 *    se usa el principal.
 *  - Microsoft `Calendars.ReadWrite` alcanza para `calendarView` y para
 *    listar los calendarios; se piden sólo `id`, `start`, `end`, `showAs` e
 *    `isCancelled` con `$select`.
 * Los eventos «libres» (transparentes, «disponible») no ocupan.
 *
 * CREAR el evento de cada cita reusa el armado de la acción «Crear evento»
 * de las integraciones (`buildIntegrationRequest`), con la videollamada de
 * Meet o Teams si el servicio la pide; moverlo y borrarlo, las llamadas
 * equivalentes de cada API.
 *
 * VOLVER (sincronización en los dos sentidos): Google responde qué cambió
 * desde un instante (`updatedMin`, con los borrados incluidos); Microsoft no
 * tiene eso sin traer los eventos enteros, así que se preguntan los eventos
 * de las citas por id, de a 20 en un `$batch`.
 */

const GOOGLE_DEFAULT = 'https://www.googleapis.com';
const GRAPH_DEFAULT = 'https://graph.microsoft.com';
/** Lo ocupado se guarda poco: una reserva nueva en el calendario tiene que verse pronto. */
const BUSY_CACHE_S = 90;
const MAX_PAGES = 4;
/** Cuánto se recuerda de dónde sale el calendario de una persona (cambia poco y se lee en cada consulta de horarios). */
const RESOLVE_CACHE_MS = 15_000;

export type CalendarProvider = 'google_calendar' | 'outlook';

export function isCalendarProvider(p: string): p is CalendarProvider {
    return p === 'google_calendar' || p === 'outlook';
}

/** El calendario de una persona, ya resuelto: con qué conexión y qué calendarios. */
export interface StaffCalendarRef {
    connectionId: number;
    provider: CalendarProvider;
    name: string;
    account: string | null;
    /** En cuáles mira lo ocupado (vacío = el principal). */
    busyCalendars: string[];
    /** En cuál crea las citas (null = el principal). */
    writeCalendar: string | null;
}

/** El pedido de lo ocupado de UN calendario (sólo inicio y fin). `calendar` null = el principal. */
export function busyRequest(
    provider: CalendarProvider,
    base: string,
    token: string,
    fromIso: string,
    toIso: string,
    pageToken?: string,
    calendar: string | null = null,
): IntegrationRequest {
    if (provider === 'google_calendar') {
        const q = new URLSearchParams({
            timeMin: fromIso,
            timeMax: toIso,
            singleEvents: 'true',
            maxResults: '250',
            fields: 'items(id,start,end,status,transparency),nextPageToken',
            ...(pageToken ? { pageToken } : {}),
        });
        return {
            url: `${base}/calendar/v3/calendars/${encodeURIComponent(calendar ?? 'primary')}/events?${q.toString()}`,
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        };
    }
    const q = new URLSearchParams({
        startDateTime: fromIso,
        endDateTime: toIso,
        $select: 'id,start,end,showAs,isCancelled,isAllDay',
        $top: '250',
    });
    const path = calendar ? `/v1.0/me/calendars/${encodeURIComponent(calendar)}/calendarView` : '/v1.0/me/calendarView';
    return {
        url: pageToken ?? `${base}${path}?${q.toString()}`,
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' },
    };
}

function externalId(raw: unknown): { externalId?: string } {
    return typeof raw === 'string' && raw.length > 0 && raw.length <= 1024 ? { externalId: raw } : {};
}

interface ParsedBusy {
    busy: BusyInterval[];
    next: string | null;
}

/** Un instante de Graph: sin zona viene en UTC (lo pedimos así con `Prefer`). */
function graphInstant(v: string | undefined): number {
    return v ? Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`) : NaN;
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
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end, kind: 'external', ...externalId(raw.id) });
        }
        return { busy: out, next: typeof json.nextPageToken === 'string' ? json.nextPageToken : null };
    }
    for (const raw of Array.isArray(json.value) ? (json.value as Array<Record<string, unknown>>) : []) {
        if (raw.isCancelled === true) continue;
        const show = String(raw.showAs ?? 'busy');
        if (show === 'free' || show === 'workingElsewhere') continue;
        const s = (raw.start ?? {}) as { dateTime?: string };
        const e = (raw.end ?? {}) as { dateTime?: string };
        const start = graphInstant(s.dateTime);
        const end = graphInstant(e.dateTime);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end, kind: 'external', ...externalId(raw.id) });
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

function json(body: string | null | undefined): Record<string, unknown> {
    try {
        const v = JSON.parse(body ?? '{}') as unknown;
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** Sólo un enlace https se le muestra al cliente (lo que venga del proveedor también se revisa). */
function httpsOrNull(v: unknown): string | null {
    return typeof v === 'string' && /^https:\/\/[^\s<>"]+$/i.test(v) && v.length <= 1000 ? v : null;
}

/** El enlace de la videollamada de un evento recién creado (o null si no tiene, o si Google todavía la está creando). */
export function meetingFrom(provider: CalendarProvider, body: Record<string, unknown>): { url: string | null; pending: boolean } {
    if (provider === 'google_calendar') {
        const conf = (body.conferenceData ?? {}) as { entryPoints?: Array<{ entryPointType?: string; uri?: string }>; createRequest?: { status?: { statusCode?: string } } };
        const video = (conf.entryPoints ?? []).find((e) => e.entryPointType === 'video')?.uri;
        const url = httpsOrNull(body.hangoutLink) ?? httpsOrNull(video);
        return { url, pending: url === null && conf.createRequest?.status?.statusCode === 'pending' };
    }
    const online = (body.onlineMeeting ?? {}) as { joinUrl?: string };
    return { url: httpsOrNull(online.joinUrl) ?? httpsOrNull(body.onlineMeetingUrl), pending: false };
}

/** Un cambio del evento visto desde el calendario (para la sincronización de vuelta). */
export interface ExternalEventState {
    id: string;
    /** Lo borraron o lo cancelaron. */
    gone: boolean;
    /** Inicio y fin actuales (null en un evento de todo el día o sin hora: se ignora). */
    start: number | null;
    end: number | null;
}

/** Los eventos de una página de `events.list?updatedMin` de Google. */
export function parseGoogleChanges(body: string): { items: ExternalEventState[]; next: string | null } {
    const j = json(body);
    const items: ExternalEventState[] = [];
    for (const raw of Array.isArray(j.items) ? (j.items as Array<Record<string, unknown>>) : []) {
        if (typeof raw.id !== 'string') continue;
        const s = (raw.start ?? {}) as { dateTime?: string };
        const e = (raw.end ?? {}) as { dateTime?: string };
        const start = s.dateTime ? Date.parse(s.dateTime) : NaN;
        const end = e.dateTime ? Date.parse(e.dateTime) : NaN;
        items.push({
            id: raw.id,
            gone: raw.status === 'cancelled',
            start: Number.isFinite(start) ? start : null,
            end: Number.isFinite(end) ? end : null,
        });
    }
    return { items, next: typeof j.nextPageToken === 'string' ? j.nextPageToken : null };
}

/** Las respuestas de un `$batch` de Graph por id de evento (404 = borrado). */
export function parseGraphBatch(body: string, idsByRequest: Map<string, string>): ExternalEventState[] {
    const j = json(body);
    const out: ExternalEventState[] = [];
    for (const r of Array.isArray(j.responses) ? (j.responses as Array<Record<string, unknown>>) : []) {
        const eventId = idsByRequest.get(String(r.id));
        if (!eventId) continue;
        const status = Number(r.status);
        if (status === 404 || status === 410) {
            out.push({ id: eventId, gone: true, start: null, end: null });
            continue;
        }
        if (status < 200 || status >= 300) continue; // otro error: se reintenta en la próxima vuelta
        const b = (r.body ?? {}) as Record<string, unknown>;
        const s = (b.start ?? {}) as { dateTime?: string };
        const e = (b.end ?? {}) as { dateTime?: string };
        const start = graphInstant(s.dateTime);
        const end = graphInstant(e.dateTime);
        out.push({
            id: eventId,
            gone: b.isCancelled === true,
            start: b.isAllDay === true || !Number.isFinite(start) ? null : start,
            end: b.isAllDay === true || !Number.isFinite(end) ? null : end,
        });
    }
    return out;
}

export interface CalendarEventInput {
    title: string;
    start: Date;
    end: Date;
    timeZone: string;
    description: string;
    /** v0.1.350 — Dónde es («En persona · Cra. 7»); vacío = sin lugar. */
    location?: string;
    /** v0.1.350 — La videollamada que se genera en el evento. */
    meeting?: 'meet' | 'teams' | null;
}

export interface CreatedCalendarEvent {
    event: BookingExternalEvent;
    meeting: { url: string; provider: 'meet' | 'teams' } | null;
    /** Por qué no salió la videollamada que se pidió (el evento igual se creó). */
    meetingError: string | null;
}

/** Un error de permiso al listar los calendarios de Google (falta `calendar.calendarlist.readonly`). */
export class CalendarListScopeError extends Error {}

@Injectable()
export class BookingCalendarService {
    private readonly logger = new Logger(BookingCalendarService.name);
    private readonly resolved = new Map<string, { at: number; ref: StaffCalendarRef | null }>();

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
    async providerOf(tenantId: number, connectionId: number): Promise<{ provider: CalendarProvider; name: string; account: string | null; visibility: string; owner: number | null; purpose: string | null } | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ provider: connections.provider, name: connections.name, config: connections.config, visibility: connections.visibility, owner: connections.ownerUserId })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), eq(connections.id, connectionId)))
                .limit(1),
        );
        if (!row || !isCalendarProvider(row.provider)) return null;
        const cfg = (row.config ?? {}) as Record<string, unknown>;
        return {
            provider: row.provider,
            name: row.name,
            account: typeof cfg.account_label === 'string' && cfg.account_label !== '' ? cfg.account_label : null,
            visibility: row.visibility,
            owner: row.owner,
            purpose: typeof cfg.purpose === 'string' ? cfg.purpose : null,
        };
    }

    /** Las preferencias de «Mi calendario» de una persona en una empresa. */
    async personalPrefs(tenantId: number, userId: number): Promise<ReturnType<typeof agendaCalendarPrefsSchema.parse>> {
        const [m] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
                .limit(1),
        );
        const parsed = agendaCalendarPrefsSchema.safeParse(((m?.settings ?? {}) as Record<string, unknown>).agenda_calendar ?? {});
        return parsed.success ? parsed.data : agendaCalendarPrefsSchema.parse({});
    }

    /**
     * De dónde sale el calendario de quien atiende (null = no tiene). El de la
     * persona tiene que ser una conexión PRIVADA suya; la de la agenda, una
     * del equipo o una privada de esa persona. Se recuerda unos segundos.
     */
    async resolveStaff(tenantId: number, staff: Pick<BookingStaff, 'id' | 'kind' | 'staff_user_id' | 'calendar_source' | 'connection_id' | 'busy_calendars' | 'write_calendar'>): Promise<StaffCalendarRef | null> {
        if (staff.kind !== 'user' || staff.staff_user_id === null) return null;
        const key = `${tenantId}:${staff.staff_user_id}:${staff.calendar_source}:${staff.connection_id ?? ''}:${staff.busy_calendars.join(',')}:${staff.write_calendar ?? ''}`;
        const hit = this.resolved.get(key);
        if (hit && Date.now() - hit.at < RESOLVE_CACHE_MS) return hit.ref;
        let ref: StaffCalendarRef | null = null;
        if (staff.calendar_source === 'person') {
            const prefs = await this.personalPrefs(tenantId, staff.staff_user_id);
            if (prefs.connection_id !== null) {
                const c = await this.providerOf(tenantId, prefs.connection_id);
                if (c && c.visibility === 'private' && c.owner === staff.staff_user_id) {
                    ref = { connectionId: prefs.connection_id, provider: c.provider, name: c.name, account: c.account, busyCalendars: prefs.busy_calendars, writeCalendar: prefs.write_calendar };
                }
            }
        } else if (staff.connection_id !== null) {
            const c = await this.providerOf(tenantId, staff.connection_id);
            if (c && (c.visibility !== 'private' || c.owner === staff.staff_user_id)) {
                ref = { connectionId: staff.connection_id, provider: c.provider, name: c.name, account: c.account, busyCalendars: staff.busy_calendars, writeCalendar: staff.write_calendar };
            }
        }
        this.resolved.set(key, { at: Date.now(), ref });
        if (this.resolved.size > 2000) this.resolved.clear();
        return ref;
    }

    /** Olvida lo resuelto de una persona (cambió su «Mi calendario»). */
    forgetResolved(tenantId: number, userId?: number): void {
        for (const k of [...this.resolved.keys()]) {
            if (k.startsWith(`${tenantId}:${userId === undefined ? '' : `${userId}:`}`)) this.resolved.delete(k);
        }
    }

    /** Los calendarios de una cuenta conectada (sólo nombre, si es el principal y si se puede escribir). */
    async listCalendars(tenantId: number, connectionId: number): Promise<AgendaCalendarItem[]> {
        const conn = await this.providerOf(tenantId, connectionId);
        if (!conn) throw new Error('La conexión de calendario ya no existe.');
        const token = await this.connectors.oauthAccessToken(tenantId, connectionId);
        if (conn.provider === 'google_calendar') {
            const q = new URLSearchParams({
                minAccessRole: 'reader',
                maxResults: '250',
                fields: 'items(id,summary,summaryOverride,primary,accessRole,backgroundColor)',
            });
            const res = await safeWebhookFetch(`${this.bases.google}/calendar/v3/users/me/calendarList?${q.toString()}`, {
                method: 'GET',
                headers: { accept: 'application/json', authorization: `Bearer ${token}` },
                captureBody: true,
                maxCaptureBytes: 256 * 1024,
                timeoutMs: 8000,
            });
            if (res.status === 403) {
                throw new CalendarListScopeError(
                    'Google no deja ver la lista de tus calendarios con el permiso que diste. Se usa tu calendario principal; para elegir otros, vuelve a conectar tu calendario.',
                );
            }
            if (res.status === 401) throw new Error(`«${conn.name}» ya no tiene acceso: vuelve a conectarlo.`);
            if (res.status >= 400) throw new Error(`Google respondió ${res.status} al pedir tus calendarios.`);
            const items = Array.isArray(json(res.body).items) ? (json(res.body).items as Array<Record<string, unknown>>) : [];
            return items
                .filter((c) => typeof c.id === 'string')
                .slice(0, 100)
                .map((c) => ({
                    id: String(c.id),
                    name: String(c.summaryOverride ?? c.summary ?? c.id).slice(0, 200),
                    primary: c.primary === true,
                    can_write: c.accessRole === 'owner' || c.accessRole === 'writer',
                    color: typeof c.backgroundColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.backgroundColor) ? c.backgroundColor : null,
                }))
                .sort((a, b) => Number(b.primary) - Number(a.primary));
        }
        const res = await safeWebhookFetch(`${this.bases.graph}/v1.0/me/calendars?$select=id,name,isDefaultCalendar,canEdit,hexColor&$top=100`, {
            method: 'GET',
            headers: { accept: 'application/json', authorization: `Bearer ${token}` },
            captureBody: true,
            maxCaptureBytes: 256 * 1024,
            timeoutMs: 8000,
        });
        if (res.status === 401 || res.status === 403) throw new Error(`«${conn.name}» ya no tiene acceso: vuelve a conectarlo.`);
        if (res.status >= 400) throw new Error(`Microsoft respondió ${res.status} al pedir tus calendarios.`);
        const items = Array.isArray(json(res.body).value) ? (json(res.body).value as Array<Record<string, unknown>>) : [];
        return items
            .filter((c) => typeof c.id === 'string')
            .map((c) => ({
                id: String(c.id),
                name: String(c.name ?? 'Calendario').slice(0, 200),
                primary: c.isDefaultCalendar === true,
                can_write: c.canEdit !== false,
                color: typeof c.hexColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.hexColor) ? c.hexColor : null,
            }))
            .sort((a, b) => Number(b.primary) - Number(a.primary));
    }

    /**
     * Lo ocupado entre dos instantes en los calendarios que mira esa persona.
     * Lanza con el motivo si no se pudo leer (el que llama decide: la agenda
     * sigue con lo que sabe y avisa). Un calendario que ya no existe se salta.
     */
    async busy(tenantId: number, ref: StaffCalendarRef | number, from: Date, to: Date): Promise<BusyInterval[]> {
        const r: StaffCalendarRef | null =
            typeof ref === 'number'
                ? await this.providerOf(tenantId, ref).then((c) => (c ? { connectionId: ref, provider: c.provider, name: c.name, account: c.account, busyCalendars: [], writeCalendar: null } : null))
                : ref;
        if (!r) throw new Error('La conexión de calendario ya no existe.');
        const calendars: Array<string | null> = r.busyCalendars.length > 0 ? r.busyCalendars : [null];
        const all: BusyInterval[] = [];
        let token: string | null = null;
        for (const cal of calendars) {
            const fromIso = from.toISOString();
            const toIso = to.toISOString();
            const calKey = cal === null ? 'main' : createHash('sha1').update(cal).digest('hex').slice(0, 12);
            const cacheKey = `bookbusy:${tenantId}:${r.connectionId}:${calKey}:${fromIso.slice(0, 13)}:${toIso.slice(0, 13)}`;
            try {
                const hit = await this.redis.get(cacheKey);
                if (hit) {
                    all.push(...(JSON.parse(hit) as BusyInterval[]));
                    continue;
                }
            } catch {
                /* sin caché: se pide */
            }
            token ??= await this.connectors.oauthAccessToken(tenantId, r.connectionId);
            const base = r.provider === 'google_calendar' ? this.bases.google : this.bases.graph;
            const got: BusyInterval[] = [];
            let next: string | undefined;
            let missing = false;
            for (let page = 0; page < MAX_PAGES; page++) {
                const req = busyRequest(r.provider, base, token, fromIso, toIso, next, cal);
                const res = await safeWebhookFetch(req.url, { method: req.method, headers: req.headers, captureBody: true, maxCaptureBytes: 512 * 1024, timeoutMs: 8000 });
                if (res.status === 401 || res.status === 403) throw new Error(`«${r.name}» no tiene acceso al calendario: reconéctala.`);
                if (res.status === 404 && cal !== null) {
                    // Borraron ese calendario (o dejaron de compartirlo): se sigue con los demás.
                    missing = true;
                    break;
                }
                if (res.status >= 400) throw new Error(`El calendario de «${r.name}» respondió ${res.status}.`);
                const parsed = parseBusy(r.provider, res.body ?? '');
                got.push(...parsed.busy);
                if (!parsed.next) break;
                next = parsed.next;
            }
            if (missing) {
                this.logger.warn(`Calendario ${calKey} de la conexión ${r.connectionId}: ya no existe; se salta.`);
                continue;
            }
            all.push(...got);
            await this.redis.set(cacheKey, JSON.stringify(got), 'EX', BUSY_CACHE_S).catch(() => undefined);
        }
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

    /**
     * Crea el evento de la cita en el calendario de quien atiende, con la
     * videollamada que pide el servicio. Si la videollamada no se puede (una
     * cuenta personal de Microsoft no tiene Teams), el evento se crea igual
     * sin ella y se dice por qué.
     */
    async createEvent(tenantId: number, ref: StaffCalendarRef | number, input: CalendarEventInput): Promise<CreatedCalendarEvent> {
        const r: StaffCalendarRef | null =
            typeof ref === 'number'
                ? await this.providerOf(tenantId, ref).then((c) => (c ? { connectionId: ref, provider: c.provider, name: c.name, account: c.account, busyCalendars: [], writeCalendar: null } : null))
                : ref;
        if (!r) throw new Error('La conexión de calendario ya no existe.');
        const token = await this.connectors.oauthAccessToken(tenantId, r.connectionId);
        const want = input.meeting === 'meet' && r.provider === 'google_calendar' ? 'meet' : input.meeting === 'teams' && r.provider === 'outlook' ? 'teams' : null;

        const attempt = async (withMeeting: boolean): Promise<{ status: number; body: Record<string, unknown>; raw: string }> => {
            const minutes = Math.max(1, Math.round((input.end.getTime() - input.start.getTime()) / 60_000));
            const req = buildIntegrationRequest(
                r.provider,
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
                        calendar: r.provider === 'google_calendar' ? (r.writeCalendar ?? '') : '',
                        meet: withMeeting && want === 'meet' ? 'true' : 'false',
                        teams_meeting: withMeeting && want === 'teams' ? 'true' : 'false',
                    },
                    lines: {},
                },
                { secret: '', accessToken: token, fields: {}, signingSecret: '' },
            );
            let url = rebase(rebase(req.url, GOOGLE_DEFAULT, this.bases.google), GRAPH_DEFAULT, this.bases.graph);
            if (r.provider === 'outlook' && r.writeCalendar) url = `${this.bases.graph}/v1.0/me/calendars/${encodeURIComponent(r.writeCalendar)}/events`;
            const body = json(req.body ?? '{}');
            const where = (input.location ?? '').trim();
            if (where !== '') {
                if (r.provider === 'google_calendar') body.location = where.slice(0, 1000);
                else body.location = { displayName: where.slice(0, 250) };
            }
            // El evento creado vuelve COMPLETO (con la reunión de Teams, Outlook
            // devuelve el cuerpo HTML de la invitación): con el tope de 8 KB
            // llegaba cortado y el id no se podía leer.
            const res = await safeWebhookFetch(url, { method: req.method, headers: req.headers, body: JSON.stringify(body), captureBody: true, maxCaptureBytes: 256 * 1024, timeoutMs: 12_000 });
            return { status: res.status, body: json(res.body), raw: res.body ?? '' };
        };

        let meetingError: string | null = null;
        let res = await attempt(want !== null);
        if (res.status >= 400 && want !== null) {
            // La cuenta no puede crear la videollamada (Teams en una cuenta
            // personal de Microsoft): el evento se crea igual, sin ella.
            meetingError =
                want === 'teams'
                    ? 'La cuenta de Microsoft de quien atiende no puede crear reuniones de Teams (sólo las cuentas de trabajo o estudiantiles pueden).'
                    : 'Google no dejó crear la videollamada de Meet en ese calendario.';
            this.logger.warn(`Calendario ${r.connectionId}: la videollamada falló (${res.status}): ${res.raw.slice(0, 300)}`);
            res = await attempt(false);
        }
        if (res.status >= 400) throw new Error(`El calendario de «${r.name}» rechazó el evento (${res.status}).`);
        const id = typeof res.body.id === 'string' ? res.body.id : '';
        if (id === '') throw new Error(`El calendario de «${r.name}» no devolvió el evento creado.`);
        const calendar = r.provider === 'google_calendar' ? (r.writeCalendar ?? 'primary') : r.writeCalendar;
        const event: BookingExternalEvent = { connection_id: r.connectionId, provider: r.provider, event_id: id, calendar, start: input.start.toISOString(), end: input.end.toISOString() };

        let meeting: CreatedCalendarEvent['meeting'] = null;
        if (want !== null && meetingError === null) {
            let found = meetingFrom(r.provider, res.body);
            // Google a veces devuelve la sala «pendiente»: se pregunta de nuevo un par de veces.
            for (let i = 0; i < 3 && found.url === null && found.pending; i++) {
                await new Promise((ok) => setTimeout(ok, 1200));
                const again = await safeWebhookFetch(
                    `${this.bases.google}/calendar/v3/calendars/${encodeURIComponent(calendar ?? 'primary')}/events/${encodeURIComponent(id)}?fields=hangoutLink,conferenceData`,
                    { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` }, captureBody: true, maxCaptureBytes: 64 * 1024, timeoutMs: 8000 },
                ).catch(() => null);
                if (!again || again.status >= 400) break;
                found = meetingFrom(r.provider, json(again.body));
            }
            if (found.url) meeting = { url: found.url, provider: want };
            else meetingError = 'El calendario creó el evento pero no devolvió el enlace de la videollamada.';
        }
        await this.forget(tenantId, r.connectionId);
        return { event, meeting, meetingError };
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

    /**
     * v0.1.350 — Qué eventos de un calendario de Google cambiaron desde un
     * instante (los borrados incluidos). Sólo `id`, estado, inicio y fin.
     */
    async googleChanges(tenantId: number, connectionId: number, calendar: string, since: Date): Promise<ExternalEventState[]> {
        const token = await this.connectors.oauthAccessToken(tenantId, connectionId);
        const out: ExternalEventState[] = [];
        let next: string | null = null;
        for (let page = 0; page < 8; page++) {
            const q = new URLSearchParams({
                updatedMin: since.toISOString(),
                showDeleted: 'true',
                singleEvents: 'true',
                maxResults: '250',
                fields: 'items(id,status,start,end),nextPageToken',
                ...(next ? { pageToken: next } : {}),
            });
            const res = await safeWebhookFetch(`${this.bases.google}/calendar/v3/calendars/${encodeURIComponent(calendar || 'primary')}/events?${q.toString()}`, {
                method: 'GET',
                headers: { accept: 'application/json', authorization: `Bearer ${token}` },
                captureBody: true,
                maxCaptureBytes: 512 * 1024,
                timeoutMs: 10_000,
            });
            if (res.status === 401 || res.status === 403) throw new Error('El calendario ya no tiene acceso: hay que volver a conectarlo.');
            if (res.status >= 400) throw new Error(`Google respondió ${res.status} al pedir los cambios del calendario.`);
            const parsed = parseGoogleChanges(res.body ?? '');
            out.push(...parsed.items);
            if (!parsed.next) break;
            next = parsed.next;
        }
        return out;
    }

    /** v0.1.350 — El estado de varios eventos de Outlook por id (de a 20 en un `$batch`). */
    async graphEvents(tenantId: number, connectionId: number, eventIds: string[]): Promise<ExternalEventState[]> {
        if (eventIds.length === 0) return [];
        const token = await this.connectors.oauthAccessToken(tenantId, connectionId);
        const out: ExternalEventState[] = [];
        for (let i = 0; i < eventIds.length; i += 20) {
            const chunk = eventIds.slice(i, i + 20);
            const ids = new Map(chunk.map((id, n) => [String(n + 1), id]));
            const body = {
                requests: chunk.map((id, n) => ({
                    id: String(n + 1),
                    method: 'GET',
                    url: `/me/events/${encodeURIComponent(id)}?$select=id,start,end,isCancelled,isAllDay`,
                    headers: { Prefer: 'outlook.timezone="UTC"' },
                })),
            };
            const res = await safeWebhookFetch(`${this.bases.graph}/v1.0/$batch`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
                captureBody: true,
                maxCaptureBytes: 512 * 1024,
                timeoutMs: 12_000,
            });
            if (res.status === 401 || res.status === 403) throw new Error('El calendario ya no tiene acceso: hay que volver a conectarlo.');
            if (res.status >= 400) throw new Error(`Microsoft respondió ${res.status} al pedir los eventos del calendario.`);
            out.push(...parseGraphBatch(res.body ?? '', ids));
        }
        return out;
    }
}
