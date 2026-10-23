import { describe, expect, it } from 'vitest';

import { addBusinessDaysMs, colombianHolidays, easterSundayMs, isBusinessDay, msToYmd, ymdToMs } from './dates';

const days = (year: number): string[] => [...colombianHolidays(year)].sort((a, b) => a - b).map(msToYmd);

/**
 * Festivos de Colombia CALCULADOS (Ley Emiliani + Semana Santa): se comparan
 * con los calendarios oficiales publicados de varios años.
 */
describe('festivos de Colombia', () => {
    it('la Pascua sale bien', () => {
        expect(msToYmd(easterSundayMs(2025))).toBe('2025-04-20');
        expect(msToYmd(easterSundayMs(2026))).toBe('2026-04-05');
        expect(msToYmd(easterSundayMs(2027))).toBe('2027-03-28');
        expect(msToYmd(easterSundayMs(2038))).toBe('2038-04-25');
    });

    it('2026 completo', () => {
        expect(days(2026)).toEqual([
            '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18',
            '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12',
            '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
        ]);
    });

    it('2025: San Pedro y el Sagrado Corazón caen el mismo lunes', () => {
        const d = days(2025);
        expect(d).toContain('2025-03-24');
        expect(d).toContain('2025-04-17');
        expect(d).toContain('2025-06-02');
        expect(d).toContain('2025-06-23');
        expect(d).toContain('2025-06-30');
        expect(d).toContain('2025-10-13');
        expect(d).toContain('2025-11-17');
        expect(d).toHaveLength(17);
    });

    it('2027', () => {
        const d = days(2027);
        expect(d).toContain('2027-03-25'); // Jueves Santo
        expect(d).toContain('2027-03-26'); // Viernes Santo
        expect(d).toContain('2027-05-10'); // Ascensión
        expect(d).toContain('2027-05-31'); // Corpus Christi
        expect(d).toContain('2027-06-07'); // Sagrado Corazón
        expect(d).toContain('2027-01-11'); // Reyes (6 ene, miércoles → lunes 11)
    });

    it('días hábiles', () => {
        expect(isBusinessDay(ymdToMs(2026, 10, 12))).toBe(false); // festivo
        expect(isBusinessDay(ymdToMs(2026, 10, 17))).toBe(false); // sábado
        expect(isBusinessDay(ymdToMs(2026, 10, 13))).toBe(true);
        // 10 días hábiles desde el viernes 18 de diciembre de 2026 (pasa por el 25 y el 1 de enero).
        expect(msToYmd(addBusinessDaysMs(ymdToMs(2026, 12, 18), 10))).toBe('2027-01-05');
    });
});
