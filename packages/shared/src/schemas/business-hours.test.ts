import { describe, expect, it } from 'vitest';
import {
    addBusinessMinutes,
    businessMinutesBetween,
    businessWindowOfDay,
    businessWindowsOfDay,
    computeSlaClock,
    slaCalendarFor,
    type BusinessCalendar,
    type SlaClockInput,
} from './business-hours';
import { companyCalendar, type CompanyHours } from './company-hours';

/** Lunes a viernes de 8 a 18 en Bogotá (UTC−5), sin trabajar los festivos de Colombia. */
const CO: BusinessCalendar = { timeZone: 'America/Bogota', days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', holidays: 'co' };
const H = 60;
const at = (iso: string) => Date.parse(iso);
const out = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe('E5 — horas hábiles (puro)', () => {
    it('el tramo de un día: laborable, fin de semana y festivo (2 de noviembre de 2026 = Todos los Santos trasladado)', () => {
        expect(businessWindowOfDay('2026-10-27', CO)).toEqual([at('2026-10-27T13:00:00Z'), at('2026-10-27T23:00:00Z')]);
        expect(businessWindowOfDay('2026-10-31', CO)).toBeNull(); // sábado
        expect(businessWindowOfDay('2026-11-01', CO)).toBeNull(); // domingo
        expect(businessWindowOfDay('2026-11-02', CO)).toBeNull(); // festivo
        expect(businessWindowOfDay('2026-11-02', { ...CO, holidays: 'none' })).not.toBeNull();
    });

    it('salta la NOCHE: 4 h desde el martes 17:00 vencen el miércoles 11:00', () => {
        expect(out(addBusinessMinutes(at('2026-10-27T22:00:00Z'), 4 * H, CO))).toBe('2026-10-28T16:00:00.000Z');
    });

    it('salta el FIN DE SEMANA y el FESTIVO: 4 h desde el viernes 16:00 vencen el martes 10:00', () => {
        // viernes 30/10 16-18 (2 h) → sáb, dom → lunes 2/11 festivo → martes 3/11 08-10.
        expect(out(addBusinessMinutes(at('2026-10-30T21:00:00Z'), 4 * H, CO))).toBe('2026-11-03T15:00:00.000Z');
        // Sin festivos, el lunes cuenta.
        expect(out(addBusinessMinutes(at('2026-10-30T21:00:00Z'), 4 * H, { ...CO, holidays: 'none' }))).toBe('2026-11-02T15:00:00.000Z');
    });

    it('fuera de horario empieza a contar con el próximo tramo hábil', () => {
        // Sábado 10:00 → el lunes es festivo → martes 08:00 + 1 h.
        expect(out(addBusinessMinutes(at('2026-10-31T15:00:00Z'), H, CO))).toBe('2026-11-03T14:00:00.000Z');
        // Un objetivo de 0 vence al empezar el primer tramo.
        expect(out(addBusinessMinutes(at('2026-10-27T04:00:00Z'), 0, CO))).toBe('2026-10-27T13:00:00.000Z');
    });

    it('la PAUSA detiene el reloj: 4 h con 2 h en pausa vencen 2 h más tarde; abierta, no vence', () => {
        const start = at('2026-10-27T13:00:00Z'); // martes 08:00
        const pause = [{ from: '2026-10-27T14:00:00Z', to: '2026-10-27T16:00:00Z' }]; // 09:00-11:00
        expect(out(addBusinessMinutes(start, 4 * H, CO))).toBe('2026-10-27T17:00:00.000Z');
        expect(out(addBusinessMinutes(start, 4 * H, CO, pause))).toBe('2026-10-27T19:00:00.000Z');
        expect(addBusinessMinutes(start, 4 * H, CO, [{ from: '2026-10-27T14:00:00Z', to: null }])).toBeNull();
        expect(businessMinutesBetween(start, at('2026-10-27T19:00:00Z'), CO, pause)).toBe(4 * H);
    });

    it('la ZONA de la empresa: el mismo instante cae en otro horario en Madrid', () => {
        const start = at('2026-10-27T13:00:00Z'); // 08:00 en Bogotá, 14:00 en Madrid (CET)
        expect(out(addBusinessMinutes(start, 6 * H, CO))).toBe('2026-10-27T19:00:00.000Z');
        // Madrid: 14-18 (4 h) + miércoles 08-10 → 09:00Z.
        expect(out(addBusinessMinutes(start, 6 * H, { ...CO, timeZone: 'Europe/Madrid' }))).toBe('2026-10-28T09:00:00.000Z');
    });

    it('minutos hábiles entre dos instantes cruzando la noche y el fin de semana', () => {
        // viernes 30/10 17:00 → martes 3/11 09:00 = 1 h (vie) + 1 h (mar).
        expect(businessMinutesBetween(at('2026-10-30T22:00:00Z'), at('2026-11-03T14:00:00Z'), CO)).toBe(2 * H);
        expect(businessMinutesBetween(at('2026-11-03T14:00:00Z'), at('2026-10-30T22:00:00Z'), CO)).toBe(0);
        // Sin días laborables, el reloj nunca avanza.
        expect(addBusinessMinutes(at('2026-10-27T13:00:00Z'), H, { ...CO, days: [] })).toBeNull();
    });
});

describe('E5 — el reloj del SLA de un ticket', () => {
    const base: SlaClockInput = {
        started_at: '2026-10-27T13:00:00Z', // martes 08:00
        first_response_minutes: 4 * H,
        resolution_minutes: 16 * H,
        first_response_at: null,
        resolved_at: null,
        pauses: [],
        calendar: CO,
        at_risk_percent: 75,
    };

    it('a tiempo → en riesgo al 75 % → vencido, con la próxima revisión', () => {
        const t0 = computeSlaClock(base, new Date('2026-10-27T14:00:00Z'));
        expect(t0.status).toBe('a_tiempo');
        expect(t0.first_response.due).toBe('2026-10-27T17:00:00.000Z');
        // 75 % de 4 h = 3 h → 11:00.
        expect(t0.first_response.risk_at).toBe('2026-10-27T16:00:00.000Z');
        expect(t0.next_check_at).toBe('2026-10-27T16:00:00.000Z');
        // Resolución: 16 h hábiles = martes completo (10) + miércoles 6 → miércoles 14:00.
        expect(t0.resolution.due).toBe('2026-10-28T19:00:00.000Z');
        expect(computeSlaClock(base, new Date('2026-10-27T16:30:00Z')).status).toBe('en_riesgo');
        const late = computeSlaClock(base, new Date('2026-10-27T17:00:01Z'));
        expect(late.status).toBe('vencido');
        expect(late.first_response.state).toBe('breached');
    });

    it('la primera respuesta a tiempo la cumple; resolver a tiempo deja todo «cumplido»', () => {
        const answered = { ...base, first_response_at: '2026-10-27T15:00:00Z' };
        const r = computeSlaClock(answered, new Date('2026-10-27T18:00:00Z'));
        expect(r.first_response.state).toBe('met');
        expect(r.status).toBe('a_tiempo');
        const done = computeSlaClock({ ...answered, resolved_at: '2026-10-28T15:00:00Z' }, new Date('2026-10-29T15:00:00Z'));
        expect(done.status).toBe('cumplido');
        expect(done.next_check_at).toBeNull();
        // Resolver tarde: vencido aunque ya esté cerrado.
        const lateDone = computeSlaClock({ ...answered, resolved_at: '2026-10-29T15:00:00Z' }, new Date('2026-10-30T15:00:00Z'));
        expect(lateDone.resolution.state).toBe('breached');
        expect(lateDone.status).toBe('vencido');
    });

    it('la pausa abierta detiene el reloj («pausado») y al cerrarse corre el vencimiento', () => {
        const paused = { ...base, first_response_at: '2026-10-27T14:00:00Z', pauses: [{ from: '2026-10-27T15:00:00Z', to: null }] };
        const p = computeSlaClock(paused, new Date('2026-10-29T15:00:00Z'));
        expect(p.status).toBe('pausado');
        expect(p.paused).toBe(true);
        expect(p.resolution.due).toBeNull();
        expect(p.next_check_at).toBeNull();
        // Se reanuda el jueves 08:00 (13:00Z): se consumieron 2 h → quedan 14 h → jueves 18:00 + 4 h viernes → viernes 12:00.
        const resumed = computeSlaClock(
            { ...paused, pauses: [{ from: '2026-10-27T15:00:00Z', to: '2026-10-29T13:00:00Z' }] },
            new Date('2026-10-29T14:00:00Z'),
        );
        expect(resumed.status).toBe('a_tiempo');
        expect(resumed.resolution.due).toBe('2026-10-30T17:00:00.000Z');
    });

    it('sin objetivos no hay estado; con un solo objetivo cumplido es «cumplido»', () => {
        expect(computeSlaClock({ ...base, first_response_minutes: null, resolution_minutes: null }).status).toBeNull();
        const onlyFirst = { ...base, resolution_minutes: null, first_response_at: '2026-10-27T14:00:00Z' };
        expect(computeSlaClock(onlyFirst, new Date('2026-10-27T15:00:00Z')).status).toBe('cumplido');
    });
});

/**
 * v0.1.469 (G15) — El mismo reloj sobre el HORARIO LABORAL de la empresa:
 * varios tramos por día (el almuerzo), el sábado distinto y los festivos del
 * país elegido (llegan ya resueltos).
 */
describe('G15 — el reloj del SLA con el horario laboral de la empresa', () => {
    const lunch = [
        { start: '08:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
    ];
    /** Lunes a viernes 8–12 y 13–17, sábado 8–12. */
    const hours: CompanyHours = { week: [[], lunch, lunch, lunch, lunch, lunch, [{ start: '08:00', end: '12:00' }]], holiday_country: 'CO', regional_holidays: false };
    const noSat: CompanyHours = { ...hours, week: hours.week.map((d, i) => (i === 6 ? [] : d)) };
    /** Bogotá (UTC−5) con el festivo del 2 de noviembre de 2026 (Todos los Santos trasladado). */
    const BOG = companyCalendar(hours, 'America/Bogota', new Set(['2026-11-02']));

    it('los tramos de un día: dos con el almuerzo, uno el sábado, ninguno el domingo ni el festivo', () => {
        expect(businessWindowsOfDay('2026-10-27', BOG)).toEqual([
            [at('2026-10-27T13:00:00Z'), at('2026-10-27T17:00:00Z')],
            [at('2026-10-27T18:00:00Z'), at('2026-10-27T22:00:00Z')],
        ]);
        expect(businessWindowsOfDay('2026-10-31', BOG)).toEqual([[at('2026-10-31T13:00:00Z'), at('2026-10-31T17:00:00Z')]]);
        expect(businessWindowsOfDay('2026-11-01', BOG)).toEqual([]);
        expect(businessWindowsOfDay('2026-11-02', BOG)).toEqual([]);
        // El calendario propio es el caso de un tramo por día.
        expect(businessWindowsOfDay('2026-10-27', CO)).toEqual([businessWindowOfDay('2026-10-27', CO)]);
        expect(businessWindowsOfDay('2026-11-02', CO)).toEqual([]);
    });

    it('el ALMUERZO no cuenta: 2 h desde el martes 11:00 vencen a las 14:00', () => {
        expect(out(addBusinessMinutes(at('2026-10-27T16:00:00Z'), 2 * H, BOG))).toBe('2026-10-27T19:00:00.000Z');
        expect(businessMinutesBetween(at('2026-10-27T16:00:00Z'), at('2026-10-27T19:00:00Z'), BOG)).toBe(2 * H);
        // Llegar justo al almuerzo: cuenta desde las 13:00.
        expect(out(addBusinessMinutes(at('2026-10-27T17:00:00Z'), 30, BOG))).toBe('2026-10-27T18:30:00.000Z');
    });

    it('el viernes 16:00 con 4 h y lun–vie 8–12 / 13–17 vence el lunes a las 11:00 (cruza el fin de semana)', () => {
        // viernes 6-nov 16-17 (1 h) → sáb y dom cerrados → lunes 9-nov 8-11 (3 h).
        expect(out(addBusinessMinutes(at('2026-11-06T21:00:00Z'), 4 * H, companyCalendar(noSat, 'America/Bogota')))).toBe('2026-11-09T16:00:00.000Z');
    });

    it('el SÁBADO distinto: 4 h desde el viernes 16:00 vencen el sábado a las 11:00', () => {
        // viernes 6-nov 16-17 (1 h) → sábado 7-nov 8-11 (3 h).
        expect(out(addBusinessMinutes(at('2026-11-06T21:00:00Z'), 4 * H, BOG))).toBe('2026-11-07T16:00:00.000Z');
    });

    it('llegar JUSTO al cierre: empieza a contar con la próxima apertura; un vencimiento al cierre queda al cierre', () => {
        // Martes 17:00 en punto (cerró) + 1 h → miércoles 9:00.
        expect(out(addBusinessMinutes(at('2026-10-27T22:00:00Z'), H, BOG))).toBe('2026-10-28T14:00:00.000Z');
        // Martes 16:00 + 1 h → martes 17:00 (no el día siguiente).
        expect(out(addBusinessMinutes(at('2026-10-27T21:00:00Z'), H, BOG))).toBe('2026-10-27T22:00:00.000Z');
    });

    it('el festivo del PAÍS elegido: México, 16 de noviembre de 2026 (Revolución), en su zona', () => {
        const MX = companyCalendar(noSat, 'America/Mexico_City', new Set(['2026-11-16']));
        // Viernes 13-nov 16:00 CDMX (22:00Z) + 4 h: viernes 16-17 (1 h) → lunes festivo → martes 8-11 (3 h) → 11:00 CDMX = 17:00Z.
        expect(out(addBusinessMinutes(at('2026-11-13T22:00:00Z'), 4 * H, MX))).toBe('2026-11-17T17:00:00.000Z');
        // Sin el festivo, el lunes cuenta.
        expect(out(addBusinessMinutes(at('2026-11-13T22:00:00Z'), 4 * H, companyCalendar(noSat, 'America/Mexico_City')))).toBe('2026-11-16T17:00:00.000Z');
    });

    it('una zona con CAMBIO DE HORA: Madrid cruza el fin del horario de verano (25-oct-2026)', () => {
        const MAD = companyCalendar({ ...noSat, week: noSat.week.map((d) => (d.length ? [{ start: '09:00', end: '17:00' }] : [])) }, 'Europe/Madrid');
        // Viernes 23-oct 16:00 CEST (14:00Z) + 4 h: viernes 16-17 (1 h) → lunes 26-oct 9-12 CET (3 h) → 12:00 CET = 11:00Z.
        expect(out(addBusinessMinutes(at('2026-10-23T14:00:00Z'), 4 * H, MAD))).toBe('2026-10-26T11:00:00.000Z');
    });

    it('las pausas detienen el reloj igual; una abierta no vence; sin días laborables nunca avanza', () => {
        const start = at('2026-10-27T13:00:00Z'); // martes 8:00
        // 8-12 (4 h) con 9-10 en pausa → 3 h; falta 1 h → 13-14.
        expect(out(addBusinessMinutes(start, 4 * H, BOG, [{ from: '2026-10-27T14:00:00Z', to: '2026-10-27T15:00:00Z' }]))).toBe('2026-10-27T19:00:00.000Z');
        expect(addBusinessMinutes(start, 4 * H, BOG, [{ from: '2026-10-27T14:00:00Z', to: null }])).toBeNull();
        expect(addBusinessMinutes(start, H, companyCalendar({ ...hours, week: [[], [], [], [], [], [], []] }, 'America/Bogota'))).toBeNull();
        expect(businessMinutesBetween(start, at('2026-10-28T13:00:00Z'), companyCalendar({ ...hours, week: [[], [], [], [], [], [], []] }, 'America/Bogota'))).toBe(0);
    });

    it('el reloj de un ticket con el horario de la empresa: vencimientos, riesgo y la próxima revisión', () => {
        const input: SlaClockInput = {
            started_at: '2026-10-27T16:00:00Z', // martes 11:00
            first_response_minutes: 2 * H,
            resolution_minutes: 8 * H,
            first_response_at: null,
            resolved_at: null,
            pauses: [],
            calendar: BOG,
            at_risk_percent: 50,
        };
        const r = computeSlaClock(input, new Date('2026-10-27T16:30:00Z'));
        // 2 h: 11-12 + 13-14 → 14:00. El 50 % (1 h) → 12:00.
        expect(r.first_response.due).toBe('2026-10-27T19:00:00.000Z');
        expect(r.first_response.risk_at).toBe('2026-10-27T17:00:00.000Z');
        // 8 h: martes 11-12 (1) + 13-17 (4) → miércoles 8-11 (3) → 11:00.
        expect(r.resolution.due).toBe('2026-10-28T16:00:00.000Z');
        expect(r.status).toBe('a_tiempo');
        expect(r.next_check_at).toBe('2026-10-27T17:00:00.000Z');
    });

    it('slaCalendarFor: el de la empresa con `company`, el propio con `own` (o si el de la empresa no está a mano)', () => {
        const cfg = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', holidays: 'co' as const };
        expect(slaCalendarFor({ ...cfg, source: 'company' }, 'America/Bogota', BOG)).toBe(BOG);
        expect(slaCalendarFor({ ...cfg, source: 'own' }, 'America/Bogota', BOG)).toEqual({ ...cfg, timeZone: 'America/Bogota' });
        expect(slaCalendarFor({ ...cfg, source: 'company' }, 'America/Bogota', null)).toEqual({ ...cfg, timeZone: 'America/Bogota' });
    });
});
