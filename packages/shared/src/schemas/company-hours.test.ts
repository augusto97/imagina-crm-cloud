import { describe, expect, it } from 'vitest';

import {
    companyCalendar,
    companyClosedDates,
    companyClosesAt,
    companyWaitTarget,
    defaultCompanyHours,
    describeCompanyHolidays,
    describeCompanyStatus,
    describeCompanyWeek,
    isCompanyOpen,
    isCompanyWorkday,
    nextCompanyOpening,
    nextCompanyWorkdayStart,
    readCompanyHours,
    type CompanyHours,
} from './company-hours';
import { updateCompanyHoursSchema } from './company-hours-input';
import { describeWait, waitConfigProblem, waitResumeAt } from './automation-flow';

const BOG = 'America/Bogota'; // UTC−5, sin horario de verano.

/** Un instante a partir de la hora de Bogotá («2026-11-25 12:30»). */
const bog = (ymd: string, hhmm: string): Date => new Date(`${ymd}T${hhmm}:00-05:00`);

/** Lun a vie 8-12 y 14-18; sábado 8-12. */
const WITH_LUNCH: CompanyHours = {
    week: [
        [],
        [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
        [{ start: '08:00', end: '12:00' }],
    ],
    holiday_country: 'CO',
    regional_holidays: false,
};

describe('readCompanyHours', () => {
    it('sin configurar: lunes a viernes de 8 a 17 y los festivos del país de la zona', () => {
        const { hours, configured } = readCompanyHours(undefined, BOG);
        expect(configured).toBe(false);
        expect(hours.week[1]).toEqual([{ start: '08:00', end: '17:00' }]);
        expect(hours.week[0]).toEqual([]);
        expect(hours.week[6]).toEqual([]);
        expect(hours.holiday_country).toBe('CO');
        expect(readCompanyHours(null, 'Europe/Madrid').hours.holiday_country).toBe('ES');
        // Sin zona (o una que no dice el país): Colombia.
        expect(readCompanyHours(null, null).hours.holiday_country).toBe('CO');
    });

    it('es tolerante: tramos rotos se caen, una semana vacía vuelve a la de fábrica', () => {
        const { hours, configured } = readCompanyHours({
            week: [[], [{ start: '14:00', end: '18:00' }, { start: '08:00', end: '12:00' }, { start: '09:00', end: '10:00' }, { start: 'x', end: '1' }], [], [], [], [], []],
            holiday_country: 'ZZ',
            regional_holidays: 'sí',
        });
        expect(configured).toBe(true);
        // Ordenados y sin el que se pisa.
        expect(hours.week[1]).toEqual([{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }]);
        expect(hours.holiday_country).toBe('CO');
        expect(hours.regional_holidays).toBe(false);
        const empty = readCompanyHours({ week: [[], [], [], [], [], [], []], holiday_country: null });
        expect(empty.hours.week[1]).toEqual([{ start: '08:00', end: '17:00' }]);
        expect(empty.hours.holiday_country).toBeNull();
    });
});

describe('festivos', () => {
    it('los regionales cierran sólo si se marcan; sin país, ninguno', () => {
        const items = [
            { date: '2026-01-12', name: 'Reyes', kind: 'national' as const },
            { date: '2026-03-02', name: 'Regional', kind: 'regional' as const },
            { date: '2026-12-24', name: 'Nochebuena', kind: 'half' as const },
        ];
        expect([...companyClosedDates(items, { holiday_country: 'CO', regional_holidays: false })]).toEqual(['2026-01-12', '2026-12-24']);
        expect(companyClosedDates(items, { holiday_country: 'CO', regional_holidays: true }).has('2026-03-02')).toBe(true);
        expect(companyClosedDates(items, { holiday_country: null, regional_holidays: true }).size).toBe(0);
        expect(describeCompanyHolidays({ holiday_country: 'CO', regional_holidays: false })).toBe('Cierra los festivos de Colombia');
        expect(describeCompanyHolidays({ holiday_country: null, regional_holidays: false })).toBe('Trabaja los festivos');
    });
});

describe('horario laboral', () => {
    const cal = companyCalendar(WITH_LUNCH, BOG, new Set(['2026-01-12']));

    it('la hora del almuerzo está cerrada y abre a la tarde', () => {
        expect(isCompanyOpen(cal, bog('2026-11-25', '11:59'))).toBe(true);
        expect(isCompanyOpen(cal, bog('2026-11-25', '12:30'))).toBe(false);
        expect(nextCompanyOpening(cal, bog('2026-11-25', '12:30'))?.toISOString()).toBe(bog('2026-11-25', '14:00').toISOString());
        expect(companyClosesAt(cal, bog('2026-11-25', '10:00'))?.toISOString()).toBe(bog('2026-11-25', '12:00').toISOString());
    });

    it('llega justo al cierre: ya está cerrado y abre al otro día', () => {
        expect(isCompanyOpen(cal, bog('2026-11-25', '17:59'))).toBe(true);
        expect(isCompanyOpen(cal, bog('2026-11-25', '18:00'))).toBe(false);
        expect(nextCompanyOpening(cal, bog('2026-11-25', '18:00'))?.toISOString()).toBe(bog('2026-11-26', '08:00').toISOString());
    });

    it('el sábado hasta el mediodía; el domingo no se trabaja', () => {
        expect(isCompanyOpen(cal, bog('2026-11-28', '09:00'))).toBe(true);
        expect(isCompanyOpen(cal, bog('2026-11-28', '13:00'))).toBe(false);
        expect(nextCompanyOpening(cal, bog('2026-11-28', '13:00'))?.toISOString()).toBe(bog('2026-11-30', '08:00').toISOString());
        expect(isCompanyWorkday(cal, bog('2026-11-29', '10:00'))).toBe(false);
    });

    // Lunes a viernes (sin sábado) para los que cruzan el fin de semana.
    const weekdays = companyCalendar(defaultCompanyHours(BOG), BOG, new Set(['2026-01-12']));

    it('un festivo no abre (viernes a la noche → martes, porque el lunes es festivo)', () => {
        expect(isCompanyWorkday(cal, bog('2026-01-12', '10:00'))).toBe(false);
        // Con sábado, abre el sábado; sin sábado, el martes.
        expect(nextCompanyOpening(cal, bog('2026-01-09', '19:00'))?.toISOString()).toBe(bog('2026-01-10', '08:00').toISOString());
        expect(nextCompanyOpening(weekdays, bog('2026-01-09', '19:00'))?.toISOString()).toBe(bog('2026-01-13', '08:00').toISOString());
        expect(nextCompanyWorkdayStart(weekdays, bog('2026-01-09', '19:00'))?.toISOString()).toBe(bog('2026-01-13', '08:00').toISOString());
    });

    it('cambio de mes', () => {
        expect(nextCompanyOpening(weekdays, bog('2026-01-30', '19:00'))?.toISOString()).toBe(bog('2026-02-02', '08:00').toISOString());
        expect(nextCompanyWorkdayStart(weekdays, bog('2026-01-31', '10:00'))?.toISOString()).toBe(bog('2026-02-02', '08:00').toISOString());
        expect(nextCompanyOpening(cal, bog('2026-11-30', '19:00'))?.toISOString()).toBe(bog('2026-12-01', '08:00').toISOString());
    });

    it('en la zona de la empresa, no en UTC', () => {
        // 22:30 UTC = 17:30 en Bogotá: todavía abierto (cierra a las 18:00).
        expect(isCompanyOpen(cal, new Date('2026-11-25T22:30:00Z'))).toBe(true);
        // 23:30 UTC = 18:30 en Bogotá: cerrado; en UTC ya sería otro día.
        expect(isCompanyOpen(cal, new Date('2026-11-25T23:30:00Z'))).toBe(false);
        expect(nextCompanyOpening(cal, new Date('2026-11-25T23:30:00Z'))?.toISOString()).toBe('2026-11-26T13:00:00.000Z');
    });

    it('tramos pegados (y de un día al otro) cuentan como uno al cerrar', () => {
        const nonstop = companyCalendar(
            {
                week: [[], [{ start: '08:00', end: '12:00' }, { start: '12:00', end: '24:00' }], [{ start: '00:00', end: '06:00' }], [], [], [], []],
                holiday_country: null,
                regional_holidays: false,
            },
            BOG,
        );
        expect(companyClosesAt(nonstop, bog('2026-11-30', '09:00'))?.toISOString()).toBe(bog('2026-12-01', '06:00').toISOString());
        expect(nextCompanyOpening(nonstop, bog('2026-11-30', '09:00'))?.toISOString()).toBe(bog('2026-12-07', '08:00').toISOString());
    });

    it('«Esperar hasta el horario laboral»: ahora si está abierto, si no la próxima apertura', () => {
        expect(companyWaitTarget(cal, 'business_hours', bog('2026-11-25', '10:00'))).toEqual({ at: bog('2026-11-25', '10:00'), immediate: true });
        expect(companyWaitTarget(cal, 'business_hours', bog('2026-11-25', '12:30'))).toEqual({ at: bog('2026-11-25', '14:00'), immediate: false });
    });

    it('«Esperar hasta un día laborable»: un día laborable sigue aunque sea de noche', () => {
        expect(companyWaitTarget(cal, 'business_day', bog('2026-11-25', '22:00'))?.immediate).toBe(true);
        expect(companyWaitTarget(cal, 'business_day', bog('2026-11-29', '10:00'))).toEqual({ at: bog('2026-11-30', '08:00'), immediate: false });
        expect(companyWaitTarget(cal, 'business_day', bog('2026-11-29', '10:00'), { h: 9, m: 30 })?.at.toISOString()).toBe(bog('2026-11-30', '09:30').toISOString());
    });

    it('en palabras', () => {
        expect(describeCompanyStatus(cal, bog('2026-11-25', '10:00')).text).toBe('Ahora: abierto, cierra a las 12:00');
        expect(describeCompanyStatus(cal, bog('2026-11-25', '12:30')).text).toBe('Ahora: cerrado, abre a las 14:00');
        expect(describeCompanyStatus(cal, bog('2026-11-25', '19:00')).text).toBe('Ahora: cerrado, abre mañana a las 8:00');
        expect(describeCompanyStatus(cal, bog('2026-11-28', '13:00')).text).toBe('Ahora: cerrado, abre el lunes a las 8:00');
        expect(describeCompanyStatus(cal, bog('2026-11-28', '13:00'), 'h12').text).toBe('Ahora: cerrado, abre el lunes a las 8:00 a. m.');
        expect(describeCompanyWeek(WITH_LUNCH)).toBe('Lun a vie 8:00–12:00 y 14:00–18:00 · Sáb 8:00–12:00');
        expect(describeCompanyWeek(defaultCompanyHours())).toBe('Lun a vie 8:00–17:00');
    });
});

describe('«Esperar» con el horario laboral', () => {
    const cal = companyCalendar(WITH_LUNCH, BOG, new Set());

    it('no pide más configuración y se describe en palabras', () => {
        expect(waitConfigProblem({ mode: 'business_hours' })).toBeNull();
        expect(waitConfigProblem({ mode: 'business_day', at_time: '09:00' })).toBeNull();
        expect(describeWait({ mode: 'business_hours' })).toBe('Espera hasta el horario laboral');
        expect(describeWait({ mode: 'business_day' })).toBe('Espera hasta un día laborable');
        expect(describeWait({ mode: 'business_day', at_time: '09:00' })).toBe('Espera hasta un día laborable a las 09:00');
    });

    it('sigue en el acto si ya es horario laboral; si no, espera la apertura', () => {
        const open = waitResumeAt({ mode: 'business_hours' }, { now: bog('2026-11-25', '10:00'), timeZone: BOG, business: cal });
        expect(open).toEqual({ ok: true, at: bog('2026-11-25', '10:00'), immediate: 'open' });
        const lunch = waitResumeAt({ mode: 'business_hours' }, { now: bog('2026-11-25', '12:15'), timeZone: BOG, business: cal });
        expect(lunch).toEqual({ ok: true, at: bog('2026-11-25', '14:00') });
        const sunday = waitResumeAt({ mode: 'business_day', at_time: '09:00' }, { now: bog('2026-11-29', '10:00'), timeZone: BOG, business: cal });
        expect(sunday).toEqual({ ok: true, at: bog('2026-11-30', '09:00') });
    });

    it('un horario que nunca abre no traba la corrida en silencio', () => {
        const never = companyCalendar({ week: [[], [], [], [], [], [], []], holiday_country: null, regional_holidays: false }, BOG);
        const r = waitResumeAt({ mode: 'business_hours' }, { now: bog('2026-11-25', '10:00'), timeZone: BOG, business: never });
        expect(r).toMatchObject({ ok: false, reason: 'config' });
    });

    it('sin el horario de la empresa usa el de fábrica (lunes a viernes de 8 a 17)', () => {
        const r = waitResumeAt({ mode: 'business_hours' }, { now: bog('2026-11-25', '17:30'), timeZone: BOG });
        expect(r).toEqual({ ok: true, at: bog('2026-11-26', '08:00') });
    });
});

describe('updateCompanyHoursSchema', () => {
    const week = WITH_LUNCH.week;
    it('acepta un horario bien armado', () => {
        expect(updateCompanyHoursSchema.safeParse({ week, holiday_country: 'CO', regional_holidays: true }).success).toBe(true);
        expect(updateCompanyHoursSchema.safeParse({ week, holiday_country: null }).success).toBe(true);
    });
    it('rechaza tramos que se pisan, una semana sin días y un país sin festivos', () => {
        const overlap = week.map((d, i) => (i === 1 ? [{ start: '08:00', end: '12:00' }, { start: '11:00', end: '13:00' }] : d));
        const bad = updateCompanyHoursSchema.safeParse({ week: overlap, holiday_country: 'CO' });
        expect(bad.success).toBe(false);
        expect(JSON.stringify(bad.error?.issues)).toContain('se pisan');
        expect(updateCompanyHoursSchema.safeParse({ week: [[], [], [], [], [], [], []], holiday_country: 'CO' }).success).toBe(false);
        expect(updateCompanyHoursSchema.safeParse({ week, holiday_country: 'ZZ' }).success).toBe(false);
        expect(updateCompanyHoursSchema.safeParse({ week: week.map((d, i) => (i === 2 ? [{ start: '18:00', end: '08:00' }] : d)), holiday_country: 'CO' }).success).toBe(false);
    });
});
