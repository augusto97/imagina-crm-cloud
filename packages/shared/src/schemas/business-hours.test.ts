import { describe, expect, it } from 'vitest';
import {
    addBusinessMinutes,
    businessMinutesBetween,
    businessWindowOfDay,
    computeSlaClock,
    type BusinessCalendar,
    type SlaClockInput,
} from './business-hours';

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
