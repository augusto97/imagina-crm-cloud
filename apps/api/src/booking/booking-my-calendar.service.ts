import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
    agendaCalendarPrefsSchema,
    type AgendaCalendarItem,
    type AgendaCalendarPrefs,
    type BookingCalendarProvider,
    type BookingMemberCalendar,
    type ConnectMyAgendaCalendarInput,
    type MyAgendaCalendarDto,
    type Role,
    type UpdateMyAgendaCalendarInput,
} from '@imagina-base/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ConnectorsService } from '../connectors/connectors.service';
import { IntegrationAppsService } from '../connectors/integration-apps.service';
import { bookingPages, connections, lists, memberships } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BookingCalendarService, CalendarListScopeError, isCalendarProvider } from './booking-calendar';
import { readBookingConfig } from './booking-config';

const PROVIDER_NAMES: Record<BookingCalendarProvider, string> = { google_calendar: 'Google Calendar', outlook: 'Outlook' };
const PROVIDER_APP = { google_calendar: 'google', outlook: 'microsoft' } as const;

function badRequest(code: string, message: string): BadRequestException {
    return new BadRequestException({ code, message, data: { status: 400 } });
}

/** Por qué no se puede usar una conexión OAuth (la autorización venció o la revocaron), o null. */
function oauthProblem(config: Record<string, unknown>): string | null {
    const state = (config.oauth_state ?? {}) as { error?: unknown };
    return typeof state.error === 'string' && state.error !== '' ? `Hay que volver a conectarlo: ${state.error}` : null;
}

/**
 * v0.1.350 — «Mi calendario» (Ajustes → Cuenta): cada persona del equipo
 * conecta SU Google Calendar u Outlook para la agenda de citas, sin depender
 * del admin, y elige en qué calendarios se mira lo ocupado y en cuál se crean
 * las citas.
 *
 * La conexión es PRIVADA de la persona (`visibility = 'private'`,
 * `config.purpose = 'agenda'`): el admin no la ve ni la usa en
 * automatizaciones, y la agenda sólo lee de ella el inicio y el fin de los
 * eventos. Las preferencias viven en `memberships.settings.agenda_calendar`
 * (son suyas y por empresa).
 */
@Injectable()
export class BookingMyCalendarService {
    private readonly logger = new Logger(BookingMyCalendarService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly calendar: BookingCalendarService,
        private readonly connectors: ConnectorsService,
        private readonly apps: IntegrationAppsService,
    ) {}

    /** La conexión de «Mi calendario» si sigue siendo suya y de calendario (si no, null). */
    private async ownConnection(tenantId: number, userId: number, prefs: AgendaCalendarPrefs) {
        if (prefs.connection_id === null) return null;
        const c = await this.calendar.providerOf(tenantId, prefs.connection_id);
        return c && c.visibility === 'private' && c.owner === userId ? { id: prefs.connection_id, ...c } : null;
    }

    async get(tenantId: number, userId: number): Promise<MyAgendaCalendarDto> {
        const prefs = await this.calendar.personalPrefs(tenantId, userId);
        const conn = await this.ownConnection(tenantId, userId, prefs);
        let calendars: AgendaCalendarItem[] | null = null;
        let calendarsError: string | null = null;
        let problem: string | null = null;
        if (conn) {
            const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.select({ config: connections.config }).from(connections).where(and(eq(connections.tenantId, tenantId), eq(connections.id, conn.id))).limit(1),
            );
            problem = oauthProblem((row?.config ?? {}) as Record<string, unknown>);
            try {
                calendars = await this.calendar.listCalendars(tenantId, conn.id);
            } catch (err) {
                calendarsError = err instanceof Error ? err.message : String(err);
                if (err instanceof CalendarListScopeError) {
                    calendars = [{ id: conn.provider === 'google_calendar' ? 'primary' : '', name: 'Calendario principal', primary: true, can_write: true, color: null }];
                } else {
                    problem ??= calendarsError;
                }
            }
        }
        const providers = await Promise.all(
            (['google_calendar', 'outlook'] as const).map(async (key) => ({
                key,
                name: PROVIDER_NAMES[key],
                available: await this.apps
                    .resolve(PROVIDER_APP[key])
                    .then(() => true)
                    .catch(() => false),
            })),
        );
        return {
            connection: conn ? { id: conn.id, provider: conn.provider, name: conn.name, account: conn.account, problem } : null,
            busy_calendars: conn ? prefs.busy_calendars : [],
            write_calendar: conn ? prefs.write_calendar : null,
            calendars,
            calendars_error: calendarsError,
            providers,
            pages: await this.pagesFor(tenantId, userId),
        };
    }

    /** Las agendas donde la persona atiende con SU calendario. */
    private async pagesFor(tenantId: number, userId: number): Promise<MyAgendaCalendarDto['pages']> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: bookingPages.id, name: bookingPages.name, listId: bookingPages.listId, listName: lists.name, config: bookingPages.config })
                .from(bookingPages)
                .innerJoin(lists, eq(lists.id, bookingPages.listId))
                .where(eq(bookingPages.tenantId, tenantId))
                .limit(500),
        );
        return rows.flatMap((r) => {
            const cfg = readBookingConfig(r.config);
            const st = cfg.staff.find((s) => s.active && s.kind === 'user' && s.staff_user_id === userId && s.calendar_source === 'person');
            return st ? [{ id: r.id, name: r.name, list_id: r.listId, list_name: r.listName, read_busy: st.read_busy, create_events: st.create_events }] : [];
        });
    }

    /**
     * Arranca la autorización con Google o Microsoft. Si ya tenía un
     * calendario del MISMO proveedor, se re-autoriza ese (no queda uno
     * repetido); de otro proveedor, se conecta uno nuevo y reemplaza al anterior.
     */
    async connect(tenantId: number, userId: number, role: Role, input: ConnectMyAgendaCalendarInput): Promise<{ authorize_url: string }> {
        const prefs = await this.calendar.personalPrefs(tenantId, userId);
        const conn = await this.ownConnection(tenantId, userId, prefs);
        const reuse = conn && conn.provider === input.provider && conn.purpose === 'agenda' ? conn.id : null;
        return this.connectors.startIntegrationOAuth(tenantId, userId, role, input.provider, { visibility: 'private', connection_id: reuse }, { purpose: 'agenda' });
    }

    /** En qué calendarios mira lo ocupado y en cuál crea las citas (sólo calendarios de SU cuenta). */
    async update(tenantId: number, userId: number, input: UpdateMyAgendaCalendarInput): Promise<MyAgendaCalendarDto> {
        const prefs = await this.calendar.personalPrefs(tenantId, userId);
        const conn = await this.ownConnection(tenantId, userId, prefs);
        if (!conn) throw badRequest('agenda_calendar_missing', 'Primero conecta tu calendario.');
        let known: AgendaCalendarItem[];
        try {
            known = await this.calendar.listCalendars(tenantId, conn.id);
        } catch (err) {
            if (!(err instanceof CalendarListScopeError)) throw badRequest('agenda_calendar_unavailable', err instanceof Error ? err.message : String(err));
            // Sin permiso para listar: sólo el principal.
            known = [{ id: 'primary', name: 'Calendario principal', primary: true, can_write: true, color: null }];
        }
        const byId = new Map(known.map((c) => [c.id, c]));
        const busy = input.busy_calendars ?? prefs.busy_calendars;
        for (const id of busy) {
            if (!byId.has(id)) throw badRequest('agenda_calendar_invalid', 'Uno de los calendarios elegidos ya no está en tu cuenta. Actualiza la página y vuelve a elegir.');
        }
        const write = input.write_calendar !== undefined ? input.write_calendar : prefs.write_calendar;
        if (write !== null) {
            const c = byId.get(write);
            if (!c) throw badRequest('agenda_calendar_invalid', 'El calendario donde se crean las citas ya no está en tu cuenta.');
            if (!c.can_write) throw badRequest('agenda_calendar_readonly', `No puedes crear eventos en «${c.name}»: elige un calendario tuyo.`);
        }
        // El principal se guarda como «vacío» (sigue valiendo aunque Google cambie su id).
        const primary = known.find((c) => c.primary)?.id;
        const next = agendaCalendarPrefsSchema.parse({
            connection_id: conn.id,
            busy_calendars: busy.length === 1 && busy[0] === primary ? [] : busy,
            write_calendar: write === primary ? null : write,
        });
        await this.savePrefs(tenantId, userId, next);
        return this.get(tenantId, userId);
    }

    /** Desconecta su calendario: se borra la conexión (y su autorización) y la agenda deja de mirarlo. */
    async disconnect(tenantId: number, userId: number, role: Role): Promise<MyAgendaCalendarDto> {
        const prefs = await this.calendar.personalPrefs(tenantId, userId);
        const conn = await this.ownConnection(tenantId, userId, prefs);
        if (conn && conn.purpose === 'agenda') {
            await this.connectors.remove(tenantId, userId, role, conn.id, true).catch((err: unknown) => {
                this.logger.warn(`Mi calendario: no se pudo borrar la conexión ${conn.id}: ${String(err)}`);
                throw err;
            });
        }
        await this.savePrefs(tenantId, userId, null);
        return this.get(tenantId, userId);
    }

    private async savePrefs(tenantId: number, userId: number, prefs: AgendaCalendarPrefs | null): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(memberships)
                .set({
                    settings:
                        prefs === null
                            ? sql`coalesce(${memberships.settings}, '{}'::jsonb) - 'agenda_calendar'`
                            : sql`coalesce(${memberships.settings}, '{}'::jsonb) || jsonb_build_object('agenda_calendar', ${JSON.stringify(prefs)}::jsonb)`,
                    updatedAt: new Date(),
                })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId))),
        );
        this.calendar.forgetResolved(tenantId, userId);
    }

    /**
     * El estado del calendario de varias personas (para el constructor de la
     * agenda): proveedor, cuenta y cuántos calendarios mira. NUNCA los nombres
     * de sus calendarios: son de la persona.
     */
    async memberCalendars(tenantId: number, userIds: number[]): Promise<Map<number, BookingMemberCalendar>> {
        const out = new Map<number, BookingMemberCalendar>();
        if (userIds.length === 0) return out;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ userId: memberships.userId, settings: memberships.settings })
                .from(memberships)
                .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, userIds))),
        );
        const prefs = new Map<number, AgendaCalendarPrefs>();
        for (const r of rows) {
            const parsed = agendaCalendarPrefsSchema.safeParse(((r.settings ?? {}) as Record<string, unknown>).agenda_calendar ?? {});
            if (parsed.success && parsed.data.connection_id !== null) prefs.set(r.userId, parsed.data);
        }
        const ids = [...new Set([...prefs.values()].map((p) => p.connection_id!))];
        if (ids.length === 0) return out;
        const conns = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connections.id, provider: connections.provider, config: connections.config, visibility: connections.visibility, owner: connections.ownerUserId })
                .from(connections)
                .where(and(eq(connections.tenantId, tenantId), inArray(connections.id, ids))),
        );
        const byId = new Map(conns.map((c) => [c.id, c]));
        for (const [uid, pr] of prefs) {
            const c = byId.get(pr.connection_id!);
            if (!c || !isCalendarProvider(c.provider) || c.visibility !== 'private' || c.owner !== uid) continue;
            const cfg = (c.config ?? {}) as Record<string, unknown>;
            out.set(uid, {
                provider: c.provider,
                account: typeof cfg.account_label === 'string' && cfg.account_label !== '' ? cfg.account_label : null,
                busy_count: Math.max(1, pr.busy_calendars.length),
                problem: oauthProblem(cfg),
            });
        }
        return out;
    }
}
