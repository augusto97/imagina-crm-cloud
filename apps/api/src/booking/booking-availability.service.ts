import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
    addDaysYmd,
    bookableWindow,
    checkBookingSlot,
    computeBookingSlots,
    jsonbKeyForField,
    pickServiceDuration,
    serviceRules,
    staffOffers,
    weekKey,
    zonedDayAndMinute,
    zonedInstant,
    BOOKING_MAX_RANGE_DAYS,
    type BookingConfig,
    type BookingRules,
    type BookingServiceItem,
    type BookingStaff,
    type BusyInterval,
    type Field,
    type PublicBookingSlots,
    type SlotServiceInput,
    type StaffSlotsInput,
} from '@imagina-base/shared';
import { and, eq, gte, isNotNull, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { bookingAppointments, bookingPages, fields as fieldsTable, lists, records } from '../db/schema';
import { IncidentHub } from '../incidents/incident-hub';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BookingCalendarService } from './booking-calendar';
import { inactiveStatusValues, readBookingConfig } from './booking-config';
import { BookingHolidaysService } from './booking-holidays';

/**
 * D5 — Lo ocupado y los horarios libres de una página de agenda. El cálculo
 * es el de `computeBookingSlots` (shared); aquí se junta lo ocupado:
 *
 *  - las CITAS de la lista (los registros que no están cancelados, de esa
 *    persona o recurso) — también las cargadas a mano en la tabla;
 *  - si la persona atiende en OTRAS páginas de agenda de la empresa, también
 *    las citas de esas listas (una persona no puede estar en dos lados);
 *  - lo ocupado de su Google Calendar u Outlook, si la empresa lo conectó y
 *    lo asoció a esa persona (sólo inicio y fin), sin los eventos que la
 *    propia agenda creó para sus citas (v0.1.349: no se cuentan dos veces);
 *  - v0.1.349: los festivos del país de cada persona (`BookingHolidaysService`).
 *
 * Cada cita ocupa con los márgenes DE SU SERVICIO y lleva su servicio (para
 * los cupos grupales); los topes cuentan horarios (`sessions`), leyendo las
 * semanas o meses enteros cuando hay topes semanales o mensuales.
 */

/** Lo que se lee FUERA de la transacción (red): el calendario y los festivos. */
export interface StaffOutside {
    external: BusyInterval[];
    holidays: Set<string> | undefined;
}

export interface PageContext {
    tenantId: number;
    pageId: number;
    pageName: string;
    listId: number;
    config: BookingConfig;
    timeZone: string;
    fields: Field[];
    createdBy: number | null;
}

/** Duración por defecto de una cita cargada a mano sin fin ni duración. */
const DEFAULT_APPOINTMENT_MIN = 30;
/** Tope de citas que se leen por persona y rango (una agenda real no llega). */
const MAX_BUSY_ROWS = 3000;

type FieldLite = Pick<Field, 'id' | 'type' | 'config'>;

interface BusySource {
    listId: number;
    config: BookingConfig;
    fields: FieldLite[];
}

function parseInstant(v: unknown): number | null {
    if (typeof v !== 'string' || v === '') return null;
    const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
    return Number.isFinite(t) ? t : null;
}

@Injectable()
export class BookingAvailabilityService {
    private readonly logger = new Logger(BookingAvailabilityService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly calendar: BookingCalendarService,
        private readonly holidays: BookingHolidaysService,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    /** Lo que el motor necesita del servicio (cupos y horario propio). */
    slotService(svc: BookingServiceItem): SlotServiceInput {
        return { id: svc.id, seats: svc.seats, hours: svc.hours };
    }

    /** Las personas o recursos que pueden atender este servicio (los elegidos o todos). */
    candidates(config: BookingConfig, serviceId: string, staffSel: string): BookingStaff[] {
        return config.staff.filter(
            (s) =>
                s.active &&
                (s.kind === 'resource' || s.staff_user_id !== null) &&
                staffOffers(s, serviceId) &&
                (staffSel === 'any' || s.id === staffSel),
        );
    }

    service(config: BookingConfig, serviceId: string): BookingServiceItem {
        const svc = config.services.find((s) => s.id === serviceId && s.active);
        if (!svc) throw new BadRequestException({ code: 'booking_service_unknown', message: 'Ese servicio ya no está disponible.', data: { status: 400 } });
        return svc;
    }

    /**
     * Horarios libres del rango (días en la zona de la empresa, recortado a lo
     * reservable). `excludeRecordId`: la cita que se está reprogramando no
     * cuenta como ocupada. `durationMin`: la duración elegida (una del servicio).
     */
    async slots(
        ctx: PageContext,
        serviceId: string,
        staffSel: string,
        fromYmd: string,
        toYmd: string,
        opts: { excludeRecordId?: number; now?: Date; durationMin?: number } = {},
    ): Promise<PublicBookingSlots> {
        const now = opts.now ?? new Date();
        const svc = this.service(ctx.config, serviceId);
        const rules = serviceRules(ctx.config.rules, svc);
        const window = bookableWindow(rules, ctx.timeZone, now);
        const from = fromYmd < window.first ? window.first : fromYmd;
        let to = toYmd > window.last ? window.last : toYmd;
        if (to > addDaysYmd(from, BOOKING_MAX_RANGE_DAYS)) to = addDaysYmd(from, BOOKING_MAX_RANGE_DAYS);
        if (from > to) return { slots: [], first_day: window.first, last_day: window.last };
        const staff = this.candidates(ctx.config, svc.id, staffSel);
        if (staff.length === 0) return { slots: [], first_day: window.first, last_day: window.last };
        const inputs = await this.staffInputs(ctx, staff, from, to, opts.excludeRecordId);
        const slots = computeBookingSlots({
            staff: inputs,
            durationMin: pickServiceDuration(svc, opts.durationMin),
            service: this.slotService(svc),
            rules,
            timeZone: ctx.timeZone,
            now,
            fromYmd: from,
            toYmd: to,
        });
        return { slots, first_day: window.first, last_day: window.last };
    }

    /** Lo ocupado de cada persona o recurso (citas de las listas + calendario externo) y sus festivos. */
    async staffInputs(ctx: PageContext, staff: BookingStaff[], fromYmd: string, toYmd: string, excludeRecordId?: number): Promise<StaffSlotsInput[]> {
        const outside = await Promise.all(staff.map((s) => this.outside(ctx, s, fromYmd, toYmd)));
        return this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const out: StaffSlotsInput[] = [];
            for (const [i, s] of staff.entries()) {
                const o = outside[i]!;
                const { busy, sessions, ownEvents } = await this.recordBusy(tx, ctx, s, fromYmd, toYmd, excludeRecordId);
                out.push({
                    id: s.id,
                    availability: s.availability,
                    busy: [...busy, ...withoutOwnEvents(o.external, ownEvents)],
                    sessions,
                    ...(o.holidays ? { holidays: o.holidays } : {}),
                });
            }
            return out;
        });
    }

    /** Lo de la red de una persona (calendario y festivos), antes de tomar cualquier candado. */
    async outside(ctx: PageContext, s: BookingStaff, fromYmd: string, toYmd: string): Promise<StaffOutside> {
        const [external, holidays] = await Promise.all([this.externalBusy(ctx, s, fromYmd, toYmd), this.staffHolidays(ctx, s)]);
        return { external, holidays };
    }

    /** Festivos de la persona; si no se pudieron saber, se sigue (el motor usa sus reglas) y se avisa. */
    async staffHolidays(ctx: PageContext, s: BookingStaff): Promise<Set<string> | undefined> {
        const key = `booking-holidays:${ctx.pageId}:${s.availability.holiday_country ?? '-'}`;
        try {
            const set = await this.holidays.blockedFor(s.availability);
            if (set === undefined && s.availability.holiday_country !== null && s.availability.holiday_country !== 'CO') {
                this.incidents?.report({
                    tenantId: ctx.tenantId,
                    key,
                    source: 'booking',
                    sourceId: ctx.pageId,
                    listId: ctx.listId,
                    ownerId: ctx.createdBy,
                    title: `La agenda «${ctx.pageName}» no pudo leer los festivos`,
                    message: `No pudimos bajar los festivos de ${s.availability.holiday_country}. Mientras tanto la página ofrece horarios también en esos días; marca los cierres puntuales en «Días especiales».`,
                });
            } else this.incidents?.resolve(ctx.tenantId, key);
            return set;
        } catch {
            return undefined;
        }
    }

    /**
     * Re-chequeo DENTRO de la transacción que tiene el candado de esa persona:
     * con las citas tal como están ahora (otra reserva pudo entrar un segundo
     * antes). `outside` = el calendario y los festivos (leídos antes del
     * candado: no se espera a la red con el candado tomado).
     */
    async checkInTx(
        tx: Tx,
        ctx: PageContext,
        staff: BookingStaff,
        service: BookingServiceItem,
        start: Date,
        outside: StaffOutside,
        opts: { excludeRecordId?: number; now?: Date; durationMin?: number } = {},
    ): Promise<string | null> {
        const { ymd } = zonedDayAndMinute(start, ctx.timeZone);
        const { busy, sessions, ownEvents } = await this.recordBusy(tx, ctx, staff, ymd, ymd, opts.excludeRecordId);
        return checkBookingSlot({
            staff: {
                id: staff.id,
                availability: staff.availability,
                busy: [...busy, ...withoutOwnEvents(outside.external, ownEvents)],
                sessions,
                ...(outside.holidays ? { holidays: outside.holidays } : {}),
            },
            durationMin: pickServiceDuration(service, opts.durationMin),
            service: this.slotService(service),
            rules: serviceRules(ctx.config.rules, service),
            timeZone: ctx.timeZone,
            now: opts.now ?? new Date(),
            start,
        });
    }

    /** Lo ocupado del calendario externo de una persona; si falla, se sigue sin él y se avisa. */
    async externalBusy(ctx: PageContext, s: BookingStaff, fromYmd: string, toYmd: string): Promise<BusyInterval[]> {
        if (s.kind !== 'user' || !s.read_busy) return [];
        const from = zonedInstant(addDaysYmd(fromYmd, -1), ctx.timeZone);
        const to = zonedInstant(addDaysYmd(toYmd, 2), ctx.timeZone);
        const key = `booking-calendar:${ctx.pageId}:${s.id}`;
        try {
            // v0.1.350 — el calendario de la persona («Mi calendario») o la
            // conexión que eligió la agenda, con los calendarios elegidos.
            const ref = await this.calendar.resolveStaff(ctx.tenantId, s);
            if (!ref) return [];
            const busy = await this.calendar.busy(ctx.tenantId, ref, from, to);
            this.incidents?.resolve(ctx.tenantId, key);
            return busy;
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Agenda ${ctx.pageId}: no se pudo leer el calendario de ${s.id}: ${reason}`);
            this.incidents?.report({
                tenantId: ctx.tenantId,
                key,
                source: 'booking',
                sourceId: ctx.pageId,
                listId: ctx.listId,
                ownerId: ctx.createdBy,
                title: `La agenda «${ctx.pageName}» no puede leer un calendario`,
                message: `${reason} Mientras tanto la página ofrece los horarios sin descontar lo ocupado de ese calendario.`,
            });
            return [];
        }
    }

    /**
     * Las citas (no canceladas) de una persona o recurso entre dos días (con un
     * día de margen a cada lado, o las semanas / meses enteros si hay topes
     * semanales o mensuales), sus inicios (para los topes) y los eventos de
     * calendario que la agenda creó para ellas. Lee las listas de TODAS las
     * páginas de agenda donde esa persona atiende.
     */
    async recordBusy(
        tx: Tx,
        ctx: PageContext,
        staff: BookingStaff,
        fromYmd: string,
        toYmd: string,
        excludeRecordId?: number,
    ): Promise<{ busy: BusyInterval[]; sessions: number[]; ownEvents: Set<string> }> {
        const sources = await this.sourcesFor(tx, ctx, staff);
        const busy: BusyInterval[] = [];
        const sessions = new Set<number>();
        const { lo, hi } = capRange(ctx.config.rules, fromYmd, toYmd);
        for (const src of sources) {
            const m = src.config.mapping;
            if (m.start_field_id === null) continue;
            const startKey = jsonbKeyForField(m.start_field_id);
            const conds: SQL[] = [
                eq(records.tenantId, ctx.tenantId),
                eq(records.listId, src.listId),
                isNull(records.deletedAt),
                sql`left(${records.data} ->> ${startKey}, 10) COLLATE "C" between ${lo} and ${hi}`,
            ];
            if (staff.kind === 'user') {
                if (m.person_field_id === null || staff.staff_user_id === null) continue;
                conds.push(sql`${records.data} -> ${jsonbKeyForField(m.person_field_id)} = ${String(staff.staff_user_id)}::jsonb`);
            } else {
                if (m.resource_field_id === null) continue;
                const f = src.fields.find((x) => x.id === m.resource_field_id);
                const value = f?.type === 'select' ? staff.option_value : staff.name.trim();
                if (!value) continue;
                conds.push(sql`${records.data} ->> ${jsonbKeyForField(m.resource_field_id)} = ${value}`);
            }
            // v0.1.353 — una cita cancelada o rechazada ya no ocupa; una «por confirmar», sí.
            const inactive = inactiveStatusValues(m);
            if (m.status_field_id !== null && inactive.length > 0) {
                conds.push(sql`coalesce(${records.data} ->> ${jsonbKeyForField(m.status_field_id)}, '') not in (${sql.join(inactive.map((v) => sql`${v}`), sql`, `)})`);
            }
            if (excludeRecordId !== undefined) conds.push(ne(records.id, excludeRecordId));
            const rows = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(...conds))
                .limit(MAX_BUSY_ROWS);
            for (const r of rows) {
                const iv = this.intervalOf(src, r.data as Record<string, unknown>);
                if (!iv) continue;
                busy.push({ ...iv, kind: 'appointment' });
                sessions.add(iv.start);
            }
        }
        // Los eventos que la agenda creó en el calendario de esta persona (para
        // no contarlos dos veces, ni que la cita que se reprograma se bloquee a sí misma).
        const ownEvents = new Set<string>();
        if (staff.kind === 'user' && staff.staff_user_id !== null) {
            const rows = await tx
                .select({ ev: bookingAppointments.externalEvent })
                .from(bookingAppointments)
                .where(
                    and(
                        eq(bookingAppointments.tenantId, ctx.tenantId),
                        eq(bookingAppointments.staffUserId, staff.staff_user_id),
                        isNotNull(bookingAppointments.externalEvent),
                        gte(bookingAppointments.startAt, zonedInstant(addDaysYmd(fromYmd, -1), ctx.timeZone)),
                        lte(bookingAppointments.startAt, zonedInstant(addDaysYmd(toYmd, 2), ctx.timeZone)),
                    ),
                )
                .limit(MAX_BUSY_ROWS);
            for (const r of rows) if (r.ev?.event_id) ownEvents.add(r.ev.event_id);
        }
        return { busy, sessions: [...sessions], ownEvents };
    }

    /**
     * Inicio, fin, servicio y márgenes de una cita de la lista: fin del campo,
     * o duración, o la del servicio, o 30 min; los márgenes, los de su servicio.
     */
    private intervalOf(src: BusySource, data: Record<string, unknown>): { start: number; end: number; serviceId: string | null; before: number; after: number } | null {
        const m = src.config.mapping;
        const start = parseInstant(m.start_field_id !== null ? data[jsonbKeyForField(m.start_field_id)] : null);
        if (start === null) return null;
        let svc: BookingServiceItem | undefined;
        if (m.service_field_id !== null) {
            const v = data[jsonbKeyForField(m.service_field_id)];
            svc = src.config.services.find((s) => (s.option_value !== null && s.option_value === v) || s.name === v);
        }
        const r = svc ? serviceRules(src.config.rules, svc) : src.config.rules;
        const margins = { serviceId: svc?.id ?? null, before: r.buffer_before_min * 60_000, after: r.buffer_after_min * 60_000 };
        const end = m.end_field_id !== null ? parseInstant(data[jsonbKeyForField(m.end_field_id)]) : null;
        if (end !== null && end > start) return { start, end, ...margins };
        let minutes: number | null = null;
        if (m.duration_field_id !== null) {
            const d = Number(data[jsonbKeyForField(m.duration_field_id)]);
            if (Number.isFinite(d) && d > 0) minutes = Math.min(d, 24 * 60);
        }
        if (minutes === null && svc) minutes = svc.duration_min;
        return { start, end: start + (minutes ?? DEFAULT_APPOINTMENT_MIN) * 60_000, ...margins };
    }

    /** La lista de esta página y, para una persona, las de las otras páginas donde atiende. */
    private async sourcesFor(tx: Tx, ctx: PageContext, staff: BookingStaff): Promise<BusySource[]> {
        const own: BusySource = { listId: ctx.listId, config: ctx.config, fields: ctx.fields };
        if (staff.kind !== 'user' || staff.staff_user_id === null) return [own];
        const pages = await tx
            .select({ id: bookingPages.id, listId: bookingPages.listId, config: bookingPages.config })
            .from(bookingPages)
            // Una agenda cuya lista está en la papelera no ocupa a nadie.
            .innerJoin(lists, and(eq(lists.id, bookingPages.listId), isNull(lists.deletedAt)))
            .where(and(eq(bookingPages.tenantId, ctx.tenantId), ne(bookingPages.id, ctx.pageId)))
            .limit(50);
        const out: BusySource[] = [own];
        const seen = new Set<string>([`${ctx.listId}:${JSON.stringify(ctx.config.mapping)}`]);
        for (const p of pages) {
            const cfg = readBookingConfig(p.config);
            if (!cfg.staff.some((s) => s.kind === 'user' && s.staff_user_id === staff.staff_user_id)) continue;
            const sig = `${p.listId}:${JSON.stringify(cfg.mapping)}`;
            if (seen.has(sig)) continue;
            seen.add(sig);
            const fields = await tx
                .select({ id: fieldsTable.id, type: fieldsTable.type, config: fieldsTable.config })
                .from(fieldsTable)
                .where(and(eq(fieldsTable.tenantId, ctx.tenantId), eq(fieldsTable.listId, p.listId), isNull(fieldsTable.deletedAt)));
            out.push({ listId: p.listId, config: cfg, fields: fields as FieldLite[] });
            if (out.length >= 10) break;
        }
        return out;
    }
}

/** Lo ocupado del calendario, sin los eventos que la agenda creó para sus citas. */
function withoutOwnEvents(external: readonly BusyInterval[], own: ReadonlySet<string>): BusyInterval[] {
    if (own.size === 0) return [...external];
    return external.filter((b) => !b.externalId || !own.has(b.externalId));
}

/** Qué días hay que leer para que los topes semanales y mensuales cuenten bien. */
export function capRange(rules: Pick<BookingRules, 'max_per_week' | 'max_per_month'>, fromYmd: string, toYmd: string): { lo: string; hi: string } {
    let lo = addDaysYmd(fromYmd, -1);
    let hi = addDaysYmd(toYmd, 1);
    if (rules.max_per_week !== null) {
        const wlo = weekKey(fromYmd);
        const whi = addDaysYmd(weekKey(toYmd), 6);
        if (wlo < lo) lo = wlo;
        if (whi > hi) hi = whi;
    }
    if (rules.max_per_month !== null) {
        const mlo = `${fromYmd.slice(0, 7)}-01`;
        const [y, mo] = toYmd.split('-').map(Number) as [number, number];
        const mhi = addDaysYmd(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`, -1);
        if (mlo < lo) lo = mlo;
        if (mhi > hi) hi = mhi;
    }
    return { lo, hi };
}
