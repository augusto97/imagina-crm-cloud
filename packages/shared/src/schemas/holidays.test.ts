import { describe, expect, it } from 'vitest';

import { blockedHolidayDates, classifyHoliday, holidayCountry, holidayCountryForTimeZone, holidayIcsUrl, HOLIDAY_COUNTRIES } from './holidays';

describe('v0.1.349 — festivos por país', () => {
    it('cada país tiene código ISO único y un calendario', () => {
        const codes = HOLIDAY_COUNTRIES.map((c) => c.code);
        expect(new Set(codes).size).toBe(codes.length);
        for (const c of HOLIDAY_COUNTRIES) {
            expect(c.code).toMatch(/^[A-Z]{2}$/);
            expect(c.calendar).toMatch(/^[a-z]+\.official$/);
        }
        expect(holidayCountry('co')?.name).toBe('Colombia');
        expect(holidayCountry('ZZ')).toBeNull();
    });

    it('arma la dirección del iCal público en español', () => {
        expect(holidayIcsUrl(holidayCountry('MX')!)).toBe(
            'https://calendar.google.com/calendar/ical/es.mexican.official%23holiday%40group.v.calendar.google.com/public/basic.ics',
        );
        expect(holidayIcsUrl(holidayCountry('CO')!, 'http://127.0.0.1:9/')).toMatch(/^http:\/\/127\.0\.0\.1:9\/calendar\/ical\//);
    });

    it('clasifica nacional, regional y medio día', () => {
        expect(classifyHoliday('Día festivo')).toBe('national');
        expect(classifyHoliday('Public holiday')).toBe('national');
        expect(classifyHoliday('Festivo en Distrito de Columbia, Maryland, Virginia')).toBe('regional');
        expect(classifyHoliday('Public holiday in Alberta, British Columbia')).toBe('regional');
        expect(classifyHoliday('Día festivo\\nEste es un festivo de medio día.')).toBe('half');
    });

    it('lo nacional bloquea salvo que se atienda; lo regional sólo si se marca', () => {
        const items = [
            { date: '2026-01-01', name: 'Año Nuevo', kind: 'national' as const },
            { date: '2026-03-23', name: 'San José', kind: 'national' as const },
            { date: '2026-04-20', name: 'Regional', kind: 'regional' as const },
            { date: '2026-12-24', name: 'Nochebuena', kind: 'half' as const },
        ];
        expect([...blockedHolidayDates(items, [], [])]).toEqual(['2026-01-01', '2026-03-23', '2026-12-24']);
        expect([...blockedHolidayDates(items, ['2026-03-23'], ['2026-04-20'])]).toEqual(['2026-01-01', '2026-04-20', '2026-12-24']);
    });

    it('sugiere el país por la zona horaria', () => {
        expect(holidayCountryForTimeZone('America/Bogota')).toBe('CO');
        expect(holidayCountryForTimeZone('Europe/Madrid')).toBe('ES');
        expect(holidayCountryForTimeZone('Asia/Tokyo')).toBeNull();
        expect(holidayCountryForTimeZone(null)).toBeNull();
    });
});
