import { BadRequestException, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
    colombianHolidays,
    companyCalendar,
    companyClosedDates,
    describeCompanyHolidays,
    describeCompanyHours,
    describeCompanyWeek,
    holidayBlocksByDefault,
    holidayCountry,
    msToYmd,
    readCompanyHours,
    type CompanyCalendar,
    type CompanyHolidaysResponse,
    type CompanyHours,
    type CompanyHoursResponse,
    type HolidayItem,
    type UpdateCompanyHoursInput,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { BookingHolidaysService } from '../booking/booking-holidays';
import type { Tx } from '../db/client';
import { tenants } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

const TTL_MS = 30_000;

/** El horario de una empresa ya armado para calcular (con sus festivos). */
export interface CompanyCalendarInfo {
    calendar: CompanyCalendar;
    hours: CompanyHours;
    /** true = no se pudieron saber los festivos del país: se calcula sin ellos. */
    holidaysUnavailable: boolean;
}

/**
 * v0.1.467 (E8) — El horario laboral de la empresa (`tenants.settings.
 * business_hours`): lo lee el motor de automatizaciones («Esperar hasta un día
 * laborable / el horario laboral»), lo muestra Ajustes y lo editan los admins.
 *
 * Los festivos salen del MISMO servicio de la agenda (calendario oficial de
 * Google por país, con caché y respaldo para Colombia). Si no se pueden saber,
 * se calcula sin ellos y quien llama lo anota: nunca se traba una corrida.
 *
 * Quien depende del horario (las esperas en curso) se entera de un cambio por
 * `onChange`; también cuando cambia la zona de la empresa (las aperturas se
 * mueven con ella).
 */
@Injectable()
export class CompanyHoursService implements OnModuleInit {
    private readonly logger = new Logger(CompanyHoursService.name);
    private readonly cache = new Map<number, { value: CompanyHoursResponse; at: number }>();
    private readonly listeners: Array<(tenantId: number) => Promise<void> | void> = [];

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly timeZones: TenantTimeZones,
        private readonly audit: AuditService,
        @Optional() private readonly holidays?: BookingHolidaysService,
    ) {}

    onModuleInit(): void {
        // La zona mueve las aperturas: las esperas se recalculan igual.
        this.timeZones.onChange((tenantId) => this.changed(tenantId));
    }

    /** El horario guardado (o el de fábrica) con la zona de la empresa. */
    async get(tenantId: number, tx?: Tx, opts: { fresh?: boolean } = {}): Promise<CompanyHoursResponse> {
        const hit = this.cache.get(tenantId);
        if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
        const read = (t: Tx) => t.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        const [row] = tx ? await read(tx) : await this.tenantDb.withTenant(tenantId, read);
        const timezone = await this.timeZones.get(tenantId, tx);
        const settings = (row?.settings ?? {}) as Record<string, unknown>;
        const { hours, configured } = readCompanyHours(settings.business_hours, timezone);
        const value: CompanyHoursResponse = { hours, configured, timezone };
        this.cache.set(tenantId, { value, at: Date.now() });
        return value;
    }

    /**
     * El horario en una línea para los prompts de la IA («Lun a vie 8:00–17:00
     * · Festivos de Colombia»). null si no se pudo leer: el prompt sigue sin él.
     */
    async summaryLine(tenantId: number): Promise<string | null> {
        try {
            return describeCompanyHours((await this.get(tenantId)).hours);
        } catch {
            return null;
        }
    }

    /** Los festivos conocidos de un país (null = no se pudieron saber). */
    private async holidayItems(country: string): Promise<HolidayItem[] | null> {
        if (this.holidays) return this.holidays.items(country).catch(() => null);
        // Sin el servicio de festivos (tests): Colombia con las reglas de la app.
        if (country !== 'CO') return null;
        const y = new Date().getUTCFullYear();
        const out: HolidayItem[] = [];
        for (let year = y - 1; year <= y + 2; year++) for (const ms of colombianHolidays(year)) out.push({ date: msToYmd(ms), name: 'Festivo', kind: 'national' });
        return out;
    }

    /**
     * El horario de la empresa listo para calcular («¿es horario laboral?»,
     * «¿cuándo abre?»), con los festivos de su país ya resueltos. `fresh`
     * salta la caché (al reanudar una espera: con dos procesos, el que corre
     * los trabajos no se entera al instante de un cambio hecho en el otro).
     */
    async calendar(tenantId: number, tx?: Tx, opts: { fresh?: boolean } = {}): Promise<CompanyCalendarInfo> {
        const { hours, timezone } = await this.get(tenantId, tx, opts);
        let closed = new Set<string>();
        let holidaysUnavailable = false;
        if (hours.holiday_country) {
            const items = await this.holidayItems(hours.holiday_country);
            if (items) closed = companyClosedDates(items, hours);
            else {
                holidaysUnavailable = true;
                this.logger.warn(`Horario laboral de la empresa ${tenantId}: no se pudieron saber los festivos de ${hours.holiday_country}; se calcula sin ellos.`);
            }
        }
        return { calendar: companyCalendar(hours, timezone, closed), hours, holidaysUnavailable };
    }

    /** Los festivos de un año (para la lista de Ajustes), con si cierran o no. */
    async holidaysOf(country: string | null, year: number, regional: boolean): Promise<CompanyHolidaysResponse> {
        const c = country ? holidayCountry(country) : null;
        if (country && !c) {
            throw new BadRequestException({ code: 'invalid_country', message: 'No tenemos los festivos de ese país.', data: { status: 400 } });
        }
        if (!c) return { country: null, year, holidays: [], unavailable: false };
        const items = await this.holidayItems(c.code);
        if (!items) return { country: c.code, year, holidays: [], unavailable: true };
        const prefix = `${year}-`;
        return {
            country: c.code,
            year,
            holidays: items
                .filter((h) => h.date.startsWith(prefix))
                .map((h) => ({ date: h.date, name: h.name, kind: h.kind, closed: holidayBlocksByDefault(h.kind) || regional })),
            unavailable: false,
        };
    }

    /**
     * Guarda el horario (sólo el admin, lo decide el controller). Bajo un
     * `FOR UPDATE` de la empresa: dos guardados a la vez no se pisan a medias.
     */
    async update(tenantId: number, input: UpdateCompanyHoursInput, userId: number | null): Promise<CompanyHoursResponse> {
        const hours: CompanyHours = {
            week: input.week.map((d) => [...d].sort((a, b) => a.start.localeCompare(b.start)).map((i) => ({ start: i.start, end: i.end }))),
            holiday_country: input.holiday_country,
            regional_holidays: input.regional_holidays,
        };
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [row] = await tx
                .select({ settings: tenants.settings })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .for('update')
                .limit(1);
            const settings = { ...((row?.settings ?? {}) as Record<string, unknown>), business_hours: hours };
            await tx.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'workspace.business_hours_change',
                targetType: 'workspace',
                targetLabel: describeCompanyWeek(hours),
                meta: { week: describeCompanyWeek(hours), holidays: describeCompanyHolidays(hours) },
            });
        });
        await this.changed(tenantId);
        return this.get(tenantId);
    }

    /** Quien depende del horario (las esperas en curso) se entera por aquí. */
    onChange(listener: (tenantId: number) => Promise<void> | void): void {
        this.listeners.push(listener);
    }

    /** Cambió el horario (o la zona): limpia la caché y avisa. */
    async changed(tenantId: number): Promise<void> {
        this.cache.delete(tenantId);
        for (const l of this.listeners) {
            try {
                await l(tenantId);
            } catch (err) {
                // Un listener que falla no frena el guardado.
                this.logger.warn(`Aviso de horario laboral: ${String(err)}`);
            }
        }
    }

    /** Tests: olvidar lo leído. */
    invalidate(tenantId: number): void {
        this.cache.delete(tenantId);
    }
}
