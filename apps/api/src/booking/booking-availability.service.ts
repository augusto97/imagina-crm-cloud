import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
    addDaysYmd,
    bookableWindow,
    checkBookingSlot,
    computeBookingSlots,
    jsonbKeyForField,
    staffOffers,
    zonedDayAndMinute,
    zonedInstant,
    BOOKING_MAX_RANGE_DAYS,
    type BookingConfig,
    type BookingServiceItem,
    type BookingStaff,
    type BusyInterval,
    type Field,
    type PublicBookingSlots,
    type StaffSlotsInput,
} from '@imagina-base/shared';
import { and, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { bookingPages, fields as fieldsTable, lists, records } from '../db/schema';
import { IncidentHub } from '../incidents/incident-hub';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BookingCalendarService } from './booking-calendar';
import { readBookingConfig } from './booking-config';

/**
 * D5 — Lo ocupado y los horarios libres de una página de agenda. El cálculo
 * es el de `computeBookingSlots` (shared); aquí se junta lo ocupado:
 *
 *  - las CITAS de la lista (los registros que no están cancelados, de esa
 *    persona o recurso) — también las cargadas a mano en la tabla;
 *  - si la persona atiende en OTRAS páginas de agenda de la empresa, también
 *    las citas de esas listas (una persona no puede estar en dos lados);
 *  - lo ocupado de su Google Calendar u Outlook, si la empresa lo conectó y
 *    lo asoció a esa persona (sólo inicio y fin).
 */

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
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

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
     * cuenta como ocupada.
     */
    async slots(
        ctx: PageContext,
        serviceId: string,
        staffSel: string,
        fromYmd: string,
        toYmd: string,
        opts: { excludeRecordId?: number; now?: Date } = {},
    ): Promise<PublicBookingSlots> {
        const now = opts.now ?? new Date();
        const svc = this.service(ctx.config, serviceId);
        const window = bookableWindow(ctx.config.rules, ctx.timeZone, now);
        const from = fromYmd < window.first ? window.first : fromYmd;
        let to = toYmd > window.last ? window.last : toYmd;
        if (to > addDaysYmd(from, BOOKING_MAX_RANGE_DAYS)) to = addDaysYmd(from, BOOKING_MAX_RANGE_DAYS);
        if (from > to) return { slots: [], first_day: window.first, last_day: window.last };
        const staff = this.candidates(ctx.config, svc.id, staffSel);
        if (staff.length === 0) return { slots: [], first_day: window.first, last_day: window.last };
        const inputs = await this.staffInputs(ctx, staff, from, to, opts.excludeRecordId);
        const slots = computeBookingSlots({
            staff: inputs,
            durationMin: svc.duration_min,
            rules: ctx.config.rules,
            timeZone: ctx.timeZone,
            now,
            fromYmd: from,
            toYmd: to,
        });
        return { slots, first_day: window.first, last_day: window.last };
    }

    /** Lo ocupado de cada persona o recurso (citas de las listas + calendario externo). */
    async staffInputs(ctx: PageContext, staff: BookingStaff[], fromYmd: string, toYmd: string, excludeRecordId?: number): Promise<StaffSlotsInput[]> {
        const external = await Promise.all(staff.map((s) => this.externalBusy(ctx, s, fromYmd, toYmd)));
        return this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            const out: StaffSlotsInput[] = [];
            for (const [i, s] of staff.entries()) {
                const { busy, dayCounts } = await this.recordBusy(tx, ctx, s, fromYmd, toYmd, excludeRecordId);
                out.push({ id: s.id, availability: s.availability, busy: [...busy, ...(external[i] ?? [])], dayCounts });
            }
            return out;
        });
    }

    /**
     * Re-chequeo DENTRO de la transacción que tiene el candado de esa persona:
     * con las citas tal como están ahora (otra reserva pudo entrar un segundo
     * antes). `external` = lo ocupado del calendario (leído antes del candado:
     * no se espera a la red con el candado tomado).
     */
    async checkInTx(
        tx: Tx,
        ctx: PageContext,
        staff: BookingStaff,
        service: BookingServiceItem,
        start: Date,
        external: BusyInterval[],
        opts: { excludeRecordId?: number; now?: Date } = {},
    ): Promise<string | null> {
        const { ymd } = zonedDayAndMinute(start, ctx.timeZone);
        const { busy, dayCounts } = await this.recordBusy(tx, ctx, staff, ymd, ymd, opts.excludeRecordId);
        return checkBookingSlot({
            staff: { id: staff.id, availability: staff.availability, busy: [...busy, ...external], dayCounts },
            durationMin: service.duration_min,
            rules: ctx.config.rules,
            timeZone: ctx.timeZone,
            now: opts.now ?? new Date(),
            start,
        });
    }

    /** Lo ocupado del calendario externo de una persona; si falla, se sigue sin él y se avisa. */
    async externalBusy(ctx: PageContext, s: BookingStaff, fromYmd: string, toYmd: string): Promise<BusyInterval[]> {
        if (s.kind !== 'user' || s.connection_id === null || !s.read_busy) return [];
        const from = zonedInstant(addDaysYmd(fromYmd, -1), ctx.timeZone);
        const to = zonedInstant(addDaysYmd(toYmd, 2), ctx.timeZone);
        const key = `booking-calendar:${ctx.pageId}:${s.id}`;
        try {
            const busy = await this.calendar.busy(ctx.tenantId, s.connection_id, from, to);
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
     * día de margen a cada lado), y cuántas tiene cada día. Lee las listas de
     * TODAS las páginas de agenda donde esa persona atiende.
     */
    async recordBusy(
        tx: Tx,
        ctx: PageContext,
        staff: BookingStaff,
        fromYmd: string,
        toYmd: string,
        excludeRecordId?: number,
    ): Promise<{ busy: BusyInterval[]; dayCounts: Map<string, number> }> {
        const sources = await this.sourcesFor(tx, ctx, staff);
        const busy: BusyInterval[] = [];
        const dayCounts = new Map<string, number>();
        const lo = addDaysYmd(fromYmd, -1);
        const hi = addDaysYmd(toYmd, 1);
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
            if (m.status_field_id !== null && m.status_cancelled !== null) {
                conds.push(sql`coalesce(${records.data} ->> ${jsonbKeyForField(m.status_field_id)}, '') <> ${m.status_cancelled}`);
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
                const day = zonedDayAndMinute(new Date(iv.start), ctx.timeZone).ymd;
                dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
            }
        }
        return { busy, dayCounts };
    }

    /** Inicio y fin de una cita de la lista: fin del campo, o duración, o la del servicio, o 30 min. */
    private intervalOf(src: BusySource, data: Record<string, unknown>): { start: number; end: number } | null {
        const m = src.config.mapping;
        const start = parseInstant(m.start_field_id !== null ? data[jsonbKeyForField(m.start_field_id)] : null);
        if (start === null) return null;
        const end = m.end_field_id !== null ? parseInstant(data[jsonbKeyForField(m.end_field_id)]) : null;
        if (end !== null && end > start) return { start, end };
        let minutes: number | null = null;
        if (m.duration_field_id !== null) {
            const d = Number(data[jsonbKeyForField(m.duration_field_id)]);
            if (Number.isFinite(d) && d > 0) minutes = Math.min(d, 24 * 60);
        }
        if (minutes === null && m.service_field_id !== null) {
            const v = data[jsonbKeyForField(m.service_field_id)];
            const svc = src.config.services.find((s) => (s.option_value !== null && s.option_value === v) || s.name === v);
            if (svc) minutes = svc.duration_min;
        }
        return { start, end: start + (minutes ?? DEFAULT_APPOINTMENT_MIN) * 60_000 };
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
