import { z } from 'zod';
import { COMPANY_HOURS_MAX_INTERVALS, hhmmMinutesOf, type CompanyHours } from './company-hours';
import { holidayCountry, type HolidayKind } from './holidays';

/**
 * v0.1.467 (E8) — Lo que se guarda al editar el horario laboral de la empresa
 * (Ajustes → Horario laboral). Estricto: un tramo que termina antes de empezar,
 * dos que se pisan o una semana sin días se rechazan con el motivo (la lectura
 * de lo guardado, en cambio, es tolerante: `readCompanyHours`).
 */
const hhmm = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Usa el formato HH:MM');

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const updateCompanyHoursSchema = z
    .object({
        week: z.array(z.array(z.object({ start: hhmm, end: hhmm })).max(COMPANY_HOURS_MAX_INTERVALS)).length(7),
        holiday_country: z.string().regex(/^[A-Z]{2}$/).nullable(),
        regional_holidays: z.boolean().default(false),
    })
    .superRefine((v, ctx) => {
        v.week.forEach((day, dow) => {
            const sorted = [...day].sort((a, b) => hhmmMinutesOf(a.start) - hhmmMinutesOf(b.start));
            for (const [i, t] of sorted.entries()) {
                if (hhmmMinutesOf(t.end) <= hhmmMinutesOf(t.start)) {
                    ctx.addIssue({ code: 'custom', path: ['week', dow], message: `El ${DAY_NAMES[dow]}: un tramo termina antes de empezar.` });
                    return;
                }
                const next = sorted[i + 1];
                if (next && hhmmMinutesOf(next.start) < hhmmMinutesOf(t.end)) {
                    ctx.addIssue({ code: 'custom', path: ['week', dow], message: `El ${DAY_NAMES[dow]}: dos tramos se pisan.` });
                    return;
                }
            }
        });
        if (v.week.every((d) => d.length === 0)) {
            ctx.addIssue({ code: 'custom', path: ['week'], message: 'Marca al menos un día laborable.' });
        }
        if (v.holiday_country !== null && !holidayCountry(v.holiday_country)) {
            ctx.addIssue({ code: 'custom', path: ['holiday_country'], message: 'No tenemos los festivos de ese país.' });
        }
    });
export type UpdateCompanyHoursInput = z.infer<typeof updateCompanyHoursSchema>;

/** Lo que devuelve `GET /workspaces/current/business-hours`. */
export interface CompanyHoursResponse {
    hours: CompanyHours;
    /** false = la empresa nunca lo guardó (se usa el de fábrica). */
    configured: boolean;
    /** La zona de la empresa (null = todavía no eligió: se usa UTC). */
    timezone: string | null;
}

/** Un festivo del año para la lista de Ajustes (con si cierra o no con lo elegido). */
export interface CompanyHolidayRow {
    date: string;
    name: string;
    kind: HolidayKind;
    /** ¿Ese día la empresa no trabaja? (los regionales, sólo si se marcaron). */
    closed: boolean;
}

/** `GET /workspaces/current/business-hours/holidays?country=&year=` */
export interface CompanyHolidaysResponse {
    country: string | null;
    year: number;
    holidays: CompanyHolidayRow[];
    /** true = no se pudieron bajar los festivos del país (se trabaja sin ellos). */
    unavailable: boolean;
}
