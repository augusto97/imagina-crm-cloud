import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    BOOKING_STATUS_LABELS,
    bookingProblems,
    defaultBookingConfig,
    holidayCountry,
    readMirrorListMarker,
    resolveTimeZone,
    slugify,
    type AgendaCalendarItem,
    type BookingConfig,
    type BookingMemberCalendar,
    type BookingPageDto,
    type BookingStaffCalendars,
    type BookingPreviewSlotsInput,
    type BookingStatus,
    type CreateBookingPageInput,
    type Field,
    type HolidayItem,
    type List,
    type PublicBookingSlots,
    type Role,
    type UpdateBookingPageInput,
} from '@imagina-base/shared';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { attachments, bookingAppointments, bookingPages, connections, memberships, tenants, users, type BookingPageRow } from '../db/schema';
import { DomainsService } from '../domains/domains.service';
import { FieldsService } from '../fields/fields.service';
import { effectivePermissions } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BookingAvailabilityService, type PageContext } from './booking-availability.service';
import { BookingCalendarService, CalendarListScopeError, isCalendarProvider } from './booking-calendar';
import { BookingMyCalendarService } from './booking-my-calendar.service';
import { newBookingToken, readBookingConfig, sanitizeBookingConfig } from './booking-config';
import { BookingHolidaysService } from './booking-holidays';

/** Cuentas que nunca atienden citas: el cliente del portal y el invitado externo. */
const NOT_STAFF_ROLES = new Set(['client', 'guest']);

/**
 * D5 — Páginas de agenda de una lista: armarlas (Ajustes de la lista →
 * Agenda). Armarlas es de quien arma la lista (`manage_lists`); verlas
 * también de quien arma automatizaciones (el disparador las elige).
 */

const notFound = () => new NotFoundException({ code: 'not_found', message: 'Esta página de agenda no existe', data: { status: 404 } });

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

/** Colores de las opciones de estado que la página crea si no existen. */
const STATUS_COLORS: Record<BookingStatus, string> = { confirmed: '#10b981', rescheduled: '#f59e0b', cancelled: '#f43f5e' };
const STATUS_MATCH: Record<BookingStatus, RegExp> = { confirmed: /confirm/i, rescheduled: /reprogram|reagend/i, cancelled: /cancel/i };

/**
 * Un calendario conectado que se puede asociar a quien atiende: uno del
 * EQUIPO a cualquiera; uno PRIVADO sólo a su dueño (es su cuenta).
 */
export interface BookingCalendarOption {
    id: number;
    name: string;
    provider: 'google_calendar' | 'outlook';
    account: string | null;
    /** null = del equipo; si no, sólo esta persona puede usarlo. */
    owner_user_id: number | null;
}

export interface BookingEditorOptions {
    /**
     * Personas del equipo que pueden atender (las que pueden editar la lista)
     * y, v0.1.350, cómo está su «Mi calendario» (sin los nombres de sus calendarios).
     */
    members: Array<{ id: number; name: string; email: string; calendar: BookingMemberCalendar | null }>;
    /** Calendarios conectados (Google Calendar u Outlook) para asociar a una persona. */
    calendars: BookingCalendarOption[];
    time_zone: string;
    time_zone_set: boolean;
}

@Injectable()
export class BookingService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly availability: BookingAvailabilityService,
        private readonly holidays: BookingHolidaysService,
        private readonly calendar: BookingCalendarService,
        private readonly myCalendar: BookingMyCalendarService,
        @Optional() private readonly domains?: DomainsService,
    ) {}

    // ─────────────────────────── DTO ───────────────────────────

    private async publicBase(tenantId: number): Promise<string | undefined> {
        if (!this.domains) return undefined;
        try {
            return await this.domains.baseUrlFor(tenantId, 'app');
        } catch {
            return undefined;
        }
    }

    private toDto(row: BookingPageRow, fields: Field[], base: string | undefined, upcoming: number, extraProblems: string[] = []): BookingPageDto {
        const config = readBookingConfig(row.config);
        const path = `/api/v1/public/b/${row.token}`;
        return {
            id: row.id,
            list_id: row.listId,
            name: row.name,
            enabled: row.enabled,
            config,
            public_path: path,
            ...(base ? { public_url: `${base}${path}`, public_origin: base } : {}),
            bookings_count: row.bookingsCount,
            last_booked_at: row.lastBookedAt ? row.lastBookedAt.toISOString() : null,
            upcoming_count: upcoming,
            problems: [...bookingProblems(config, fields), ...extraProblems],
            created_at: row.createdAt.toISOString(),
            updated_at: row.updatedAt.toISOString(),
        };
    }

    private async upcomingCounts(tenantId: number, pageIds: number[]): Promise<Map<number, number>> {
        if (pageIds.length === 0) return new Map();
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ pageId: bookingAppointments.pageId, n: sql<number>`count(*)::int` })
                .from(bookingAppointments)
                .where(
                    and(
                        eq(bookingAppointments.tenantId, tenantId),
                        inArray(bookingAppointments.pageId, pageIds),
                        ne(bookingAppointments.status, 'cancelled'),
                        gt(bookingAppointments.startAt, new Date()),
                    ),
                )
                .groupBy(bookingAppointments.pageId),
        );
        return new Map(rows.map((r) => [r.pageId, Number(r.n)]));
    }

    /** Lo que impide publicar y depende de la empresa (no sólo de la configuración). */
    private async memberProblems(tenantId: number, list: List, config: BookingConfig, fields: readonly Field[] = []): Promise<string[]> {
        const out: string[] = [];
        const ids = config.staff.filter((s) => s.active && s.kind === 'user' && s.staff_user_id !== null).map((s) => s.staff_user_id!);
        const members = ids.length > 0 ? await this.eligibleMembers(tenantId, list) : [];
        if (ids.length > 0) {
            const ok = new Set(members.map((m) => m.id));
            for (const s of config.staff) {
                if (!s.active || s.kind !== 'user' || s.staff_user_id === null) continue;
                if (!ok.has(s.staff_user_id)) out.push('Una de las personas que atiende ya no puede editar esta lista: elige a otra o dale acceso en Permisos.');
            }
        }
        // v0.1.350 — la videollamada depende del calendario de cada persona.
        if (config.services.some((s) => s.active && s.location.kind === 'video')) {
            // La persona se nombra con su nombre (la configuración guarda sólo su id).
            const names = new Map(members.map((m) => [m.id, m.name.trim() || m.email]));
            const named: BookingConfig = {
                ...config,
                staff: config.staff.map((s) => (s.name.trim() === '' && s.staff_user_id !== null && names.has(s.staff_user_id) ? { ...s, name: names.get(s.staff_user_id)! } : s)),
            };
            const base = new Set(bookingProblems(named, fields));
            const full = bookingProblems(named, fields, { staffCalendars: await this.staffCalendars(tenantId, config) });
            out.push(...full.filter((p) => !base.has(p)));
        }
        return [...new Set(out)];
    }

    /** v0.1.350 — Qué calendario tiene cada persona que atiende (para saber si puede crear la videollamada). */
    private async staffCalendars(tenantId: number, config: BookingConfig): Promise<BookingStaffCalendars> {
        const out: BookingStaffCalendars = {};
        const persons = config.staff.filter((s) => s.kind === 'user' && s.staff_user_id !== null && s.calendar_source === 'person').map((s) => s.staff_user_id!);
        const mine = await this.myCalendar.memberCalendars(tenantId, persons);
        const needConns = config.staff.some((s) => s.calendar_source === 'connection' && s.connection_id !== null);
        const conns = needConns ? new Map((await this.calendarOptions(tenantId)).map((c) => [c.id, c])) : new Map<number, BookingCalendarOption>();
        for (const s of config.staff) {
            if (s.kind !== 'user' || s.staff_user_id === null) out[s.id] = { provider: null };
            else if (s.calendar_source === 'person') out[s.id] = { provider: mine.get(s.staff_user_id)?.provider ?? null };
            else out[s.id] = { provider: s.connection_id !== null ? (conns.get(s.connection_id)?.provider ?? null) : null };
        }
        return out;
    }

    /**
     * v0.1.350 — Los calendarios de una conexión de la EMPRESA (para elegir en
     * cuáles mira lo ocupado una persona y en cuál crea las citas). Una
     * conexión privada de alguien no se lista desde aquí: sus calendarios son
     * suyos y los elige esa persona en «Mi calendario».
     */
    async connectionCalendars(tenantId: number, connectionId: number): Promise<AgendaCalendarItem[]> {
        const c = (await this.calendarOptions(tenantId)).find((x) => x.id === connectionId);
        if (!c || c.owner_user_id !== null) {
            throw new NotFoundException({ code: 'not_found', message: 'Ese calendario no es de la empresa.', data: { status: 404 } });
        }
        try {
            return await this.calendar.listCalendars(tenantId, connectionId);
        } catch (err) {
            if (err instanceof CalendarListScopeError) return [{ id: 'primary', name: 'Calendario principal', primary: true, can_write: true, color: null }];
            throw badRequest('calendar_unavailable', err instanceof Error ? err.message : String(err));
        }
    }

    // ─────────────────────────── Administración ───────────────────────────

    async list(tenantId: number, listIdOrSlug: string): Promise<BookingPageDto[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(bookingPages)
                .where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.listId, list.id)))
                .orderBy(asc(bookingPages.id)),
        );
        const fields = await this.fields.listByListId(tenantId, list.id);
        const base = await this.publicBase(tenantId);
        const upcoming = await this.upcomingCounts(tenantId, rows.map((r) => r.id));
        const out: BookingPageDto[] = [];
        for (const r of rows) {
            out.push(this.toDto(r, fields, base, upcoming.get(r.id) ?? 0, await this.memberProblems(tenantId, list, readBookingConfig(r.config), fields)));
        }
        return out;
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<BookingPageDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.load(tenantId, list.id, id);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const upcoming = await this.upcomingCounts(tenantId, [row.id]);
        return this.toDto(row, fields, await this.publicBase(tenantId), upcoming.get(row.id) ?? 0, await this.memberProblems(tenantId, list, readBookingConfig(row.config), fields));
    }

    private async load(tenantId: number, listId: number, id: number): Promise<BookingPageRow> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(bookingPages)
                .where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.listId, listId), eq(bookingPages.id, id)))
                .limit(1),
        );
        if (!row) throw notFound();
        return row;
    }

    private assertNotStore(list: List): void {
        const m = readMirrorListMarker(list.settings);
        if (m) {
            throw badRequest(
                'store_managed',
                m.source === 'store'
                    ? 'Esta lista la maneja tu tienda online: los registros nuevos llegan desde ahí, no desde una agenda.'
                    : 'Esta lista viene de tu sitio WordPress: lo nuevo se crea allá, no desde una agenda.',
            );
        }
    }

    async create(tenantId: number, userId: number, listIdOrSlug: string, input: CreateBookingPageInput): Promise<BookingPageDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        this.assertNotStore(list);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const members = new Set((await this.eligibleMembers(tenantId, list)).map((m) => m.id));
        const tz = await this.tenantTimeZone(tenantId);
        const raw = input.config ?? defaultBookingConfig({ listName: list.name, userId: members.has(userId) ? userId : null, fields, timeZone: tz.set ? tz.zone : null });
        // Las opciones de servicios, recursos y estados se crean al PUBLICAR: mientras
        // se arma la página, renombrar un servicio no deja opciones huérfanas.
        const config = await this.cleanPhotos(tenantId, await this.cleanCalendars(tenantId, sanitizeBookingConfig(raw, fields, members)));
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .insert(bookingPages)
                .values({
                    tenantId,
                    listId: list.id,
                    name: input.name,
                    token: newBookingToken(),
                    enabled: false,
                    config: config as unknown as Record<string, unknown>,
                    createdBy: userId > 0 ? userId : null,
                })
                .returning(),
        );
        return this.toDto(row!, fields, await this.publicBase(tenantId), 0, await this.memberProblems(tenantId, list, config, fields));
    }

    async update(tenantId: number, listIdOrSlug: string, id: number, input: UpdateBookingPageInput): Promise<BookingPageDto> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.load(tenantId, list.id, id);
        let fields = await this.fields.listByListId(tenantId, list.id);
        const patch: Partial<typeof bookingPages.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name;
        let config = readBookingConfig(current.config);
        if (input.config !== undefined) {
            const members = new Set((await this.eligibleMembers(tenantId, list)).map((m) => m.id));
            config = await this.cleanPhotos(tenantId, await this.cleanCalendars(tenantId, sanitizeBookingConfig(input.config, fields, members)));
            patch.config = config as unknown as Record<string, unknown>;
        }
        const willBeEnabled = input.enabled ?? current.enabled;
        if (input.enabled === true) {
            this.assertNotStore(list);
            const problems = [...bookingProblems(config, fields), ...(await this.memberProblems(tenantId, list, config, fields))];
            if (problems.length > 0) throw badRequest('booking_incomplete', `Todavía no se puede publicar: ${problems[0]}`);
        }
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        // Publicada (o al publicarla): los servicios, recursos y estados tienen
        // su opción en los campos de selección de la lista.
        if (willBeEnabled && (input.config !== undefined || input.enabled === true)) {
            ({ config, fields } = await this.ensureOptions(tenantId, list.id, config, fields));
            patch.config = config as unknown as Record<string, unknown>;
        }
        if (input.regenerate_token) patch.token = newBookingToken();
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.update(bookingPages).set(patch).where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.id, current.id))).returning(),
        );
        const upcoming = await this.upcomingCounts(tenantId, [row!.id]);
        return this.toDto(row!, fields, await this.publicBase(tenantId), upcoming.get(row!.id) ?? 0, await this.memberProblems(tenantId, list, config, fields));
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number): Promise<{ name: string }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const current = await this.load(tenantId, list.id, id);
        await this.tenantDb.withTenant(tenantId, (tx) => tx.delete(bookingPages).where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.id, current.id))));
        return { name: current.name };
    }

    /** Las páginas de una lista para el selector del disparador. */
    async summaries(tenantId: number, listId: number): Promise<Array<{ id: number; name: string; enabled: boolean }>> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: bookingPages.id, name: bookingPages.name, enabled: bookingPages.enabled })
                .from(bookingPages)
                .where(and(eq(bookingPages.tenantId, tenantId), eq(bookingPages.listId, listId)))
                .orderBy(asc(bookingPages.id)),
        );
    }

    /** Lo que el constructor necesita para armar «Quién atiende». */
    async editorOptions(tenantId: number, listIdOrSlug: string): Promise<BookingEditorOptions> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const members = await this.eligibleMembers(tenantId, list);
        const calendars = await this.calendarOptions(tenantId);
        const tz = await this.tenantTimeZone(tenantId);
        const mine = await this.myCalendar.memberCalendars(tenantId, members.map((m) => m.id));
        return { members: members.map((m) => ({ ...m, calendar: mine.get(m.id) ?? null })), calendars, time_zone: tz.zone, time_zone_set: tz.set };
    }

    /** Los calendarios conectados de la empresa (Google Calendar u Outlook). */
    async calendarOptions(tenantId: number): Promise<BookingCalendarOption[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: connections.id,
                    name: connections.name,
                    provider: connections.provider,
                    config: connections.config,
                    visibility: connections.visibility,
                    owner: connections.ownerUserId,
                })
                .from(connections)
                .where(eq(connections.tenantId, tenantId))
                .orderBy(asc(connections.name)),
        );
        return rows.flatMap((r) => {
            if (!isCalendarProvider(r.provider)) return [];
            // v0.1.350 — el «Mi calendario» de cada persona se maneja aparte (lo elige ella).
            if ((r.config as Record<string, unknown>).purpose === 'agenda') return [];
            const label = (r.config as Record<string, unknown>).account_label;
            return [
                {
                    id: r.id,
                    name: r.name,
                    provider: r.provider,
                    account: typeof label === 'string' ? label : null,
                    owner_user_id: r.visibility === 'private' ? (r.owner ?? -1) : null,
                },
            ];
        });
    }

    /**
     * El calendario de cada persona tiene que ser un calendario de la empresa
     * que esa persona puede usar (del equipo, o privado SUYO). Un recurso no
     * tiene calendario. Lo que no cumple se suelta (sin leer ni escribir).
     */
    private async cleanCalendars(tenantId: number, config: BookingConfig): Promise<BookingConfig> {
        if (!config.staff.some((s) => s.connection_id !== null)) return config;
        const cals = new Map((await this.calendarOptions(tenantId)).map((c) => [c.id, c]));
        return {
            ...config,
            staff: config.staff.map((s) => {
                if (s.connection_id === null) return s;
                // El calendario de la persona («Mi calendario») no lleva conexión en la agenda.
                if (s.calendar_source === 'person') return { ...s, connection_id: null, busy_calendars: [], write_calendar: null };
                const c = cals.get(s.connection_id);
                const ok = s.kind === 'user' && s.staff_user_id !== null && c !== undefined && (c.owner_user_id === null || c.owner_user_id === s.staff_user_id);
                return ok ? s : { ...s, connection_id: null, read_busy: false, create_events: false };
            }),
        };
    }

    /**
     * v0.1.349 — La foto de cada persona o recurso tiene que ser una IMAGEN
     * subida a esta empresa (la página pública la sirve firmada: un id de otra
     * empresa o un PDF nunca llegan a la página). Lo que no cumple se suelta.
     */
    private async cleanPhotos(tenantId: number, config: BookingConfig): Promise<BookingConfig> {
        const ids = [...new Set(config.staff.flatMap((s) => (s.photo_file_id !== null ? [s.photo_file_id] : [])))];
        if (ids.length === 0) return config;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: attachments.id, mime: attachments.mime })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, ids), isNull(attachments.pendingFormId))),
        );
        const ok = new Set(rows.filter((r) => /^image\/(png|jpe?g|webp|gif)$/i.test(r.mime)).map((r) => r.id));
        return { ...config, staff: config.staff.map((s) => (s.photo_file_id !== null && !ok.has(s.photo_file_id) ? { ...s, photo_file_id: null } : s)) };
    }

    /** v0.1.349 — Los festivos de un país para el constructor (lista de un año). */
    async holidayList(code: string, year: number): Promise<{ country: string; items: HolidayItem[]; available: boolean }> {
        const country = holidayCountry(code);
        if (!country) throw new BadRequestException({ code: 'booking_invalid', message: 'Ese país no tiene festivos disponibles.', data: { status: 400 } });
        const items = await this.holidays.items(country.code);
        const prefix = String(year);
        return { country: country.code, available: items !== null, items: (items ?? []).filter((h) => h.date.startsWith(prefix)) };
    }

    /**
     * Vista previa del constructor: los horarios con la configuración EN
     * EDICIÓN (sin guardar), con las citas y calendarios reales.
     */
    async previewSlots(tenantId: number, listIdOrSlug: string, id: number, input: BookingPreviewSlotsInput): Promise<PublicBookingSlots> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.load(tenantId, list.id, id);
        const fields = await this.fields.listByListId(tenantId, list.id);
        const config = sanitizeBookingConfig(input.config, fields);
        const tz = await this.tenantTimeZone(tenantId);
        const ctx: PageContext = { tenantId, pageId: row.id, pageName: row.name, listId: list.id, config, timeZone: tz.zone, fields, createdBy: row.createdBy };
        if (!config.services.some((s) => s.id === input.service_id && s.active)) return { slots: [], first_day: input.from, last_day: input.to };
        return this.availability.slots(ctx, input.service_id, input.staff_id, input.from, input.to, input.duration !== undefined ? { durationMin: input.duration } : {});
    }

    async tenantTimeZone(tenantId: number): Promise<{ zone: string; set: boolean }> {
        const [t] = await this.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const raw = ((t?.settings as Record<string, unknown> | null)?.format as { timezone?: unknown } | undefined)?.timezone;
        const zone = resolveTimeZone(raw);
        return { zone, set: typeof raw === 'string' && raw === zone };
    }

    /**
     * Quién puede atender en una página de esta lista: miembros activos del
     * equipo (no clientes del portal ni invitados externos) que pueden EDITAR
     * la lista (si no, no verían ni moverían sus propias citas).
     */
    async eligibleMembers(tenantId: number, list: List): Promise<Array<{ id: number; name: string; email: string }>> {
        const rows = await this.db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: memberships.role,
                // Equipos y rol propio: el acceso a la lista puede venir de ahí.
                teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
                customRoleId: memberships.customRoleId,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), isNull(users.disabledAt)))
            .orderBy(asc(users.name));
        return rows
            .filter((r) => {
                if (NOT_STAFF_ROLES.has(String(r.role))) return false;
                const teamIds = (r.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
                return effectivePermissions(list.settings, { userId: r.id, role: r.role as Role, teamIds, customRoleId: r.customRoleId ?? null }).edit !== 'none';
            })
            .map((r) => ({ id: r.id, name: r.name, email: r.email }));
    }

    // ─────────────────────────── Opciones de la lista ───────────────────────────

    /**
     * Los servicios, los recursos y los estados se guardan en campos de
     * SELECCIÓN de la lista: si una opción no existe, se crea (con la
     * etiqueta del servicio / recurso / «Confirmada»…). Una opción que ya
     * existe con la misma etiqueta se reusa.
     */
    async ensureOptions(tenantId: number, listId: number, config: BookingConfig, fields: Field[]): Promise<{ config: BookingConfig; fields: Field[] }> {
        const byId = new Map(fields.map((f) => [f.id, f]));
        const m = config.mapping;
        let changed = false;
        const optionsOf = (fieldId: number): Array<{ value: string; label: string }> => {
            const raw = (byId.get(fieldId)?.config as { options?: unknown } | undefined)?.options;
            return Array.isArray(raw)
                ? raw.flatMap((o) =>
                      o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string'
                          ? [{ value: (o as { value: string }).value, label: String((o as { label?: unknown }).label ?? (o as { value: string }).value) }]
                          : [],
                  )
                : [];
        };
        const ensure = async (fieldId: number, label: string, matcher: (o: { value: string; label: string }) => boolean, color?: string): Promise<string> => {
            const opts = optionsOf(fieldId);
            const hit = opts.find(matcher);
            if (hit) return hit.value;
            const taken = new Set(opts.map((o) => o.value));
            const base = slugify(label).slice(0, 60) || 'opcion';
            let value = base;
            for (let n = 2; taken.has(value); n++) value = `${base}_${n}`;
            const updated = await this.fields.appendOption(tenantId, String(listId), String(fieldId), { value, label, ...(color ? { color } : {}) });
            byId.set(fieldId, updated);
            changed = true;
            return value;
        };
        const sameLabel = (label: string) => (o: { value: string; label: string }) => o.label.trim().toLowerCase() === label.trim().toLowerCase();

        const serviceField = m.service_field_id !== null ? byId.get(m.service_field_id) : undefined;
        const services = [];
        for (const s of config.services) {
            if (serviceField?.type === 'select' && s.option_value === null && s.active) {
                services.push({ ...s, option_value: await ensure(serviceField.id, s.name, sameLabel(s.name)) });
            } else services.push(s);
        }
        const resourceField = m.resource_field_id !== null ? byId.get(m.resource_field_id) : undefined;
        const staff = [];
        for (const s of config.staff) {
            if (s.kind === 'resource' && resourceField?.type === 'select' && s.option_value === null && s.name.trim() !== '' && s.active) {
                staff.push({ ...s, option_value: await ensure(resourceField.id, s.name.trim(), sameLabel(s.name)) });
            } else staff.push(s);
        }
        const mapping = { ...m };
        if (m.status_field_id !== null && byId.get(m.status_field_id)?.type === 'select') {
            for (const status of ['confirmed', 'rescheduled', 'cancelled'] as const) {
                const key = `status_${status}` as const;
                if (mapping[key] !== null) continue;
                mapping[key] = await ensure(
                    m.status_field_id,
                    BOOKING_STATUS_LABELS[status],
                    (o) => STATUS_MATCH[status].test(o.label) || STATUS_MATCH[status].test(o.value),
                    STATUS_COLORS[status],
                );
            }
        }
        const next = { ...config, services, staff, mapping };
        return { config: next, fields: changed ? await this.fields.listByListId(tenantId, listId) : fields };
    }
}
