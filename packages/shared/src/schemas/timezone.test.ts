import { describe, expect, it } from 'vitest';
import { addDaysYmd, isValidTimeZone, resolveTimeZone, zonedInstant, zonedNowNaive, zonedToday } from './timezone';
import { scheduleTimeZone } from './automation';
import { tenantFormatSchema, updateTenantFormatSchema } from './tenant';

describe('zona horaria de la empresa (v0.1.263)', () => {
    it('reconoce zonas IANA y descarta basura', () => {
        expect(isValidTimeZone('America/Bogota')).toBe(true);
        expect(isValidTimeZone('UTC')).toBe(true);
        expect(isValidTimeZone('Marte/Olympus')).toBe(false);
        expect(isValidTimeZone('')).toBe(false);
        expect(isValidTimeZone(null)).toBe(false);
        expect(resolveTimeZone(null, 'Marte/Olympus', 'America/Lima')).toBe('America/Lima');
        expect(resolveTimeZone(undefined)).toBe('UTC');
    });

    it('"hoy" depende del reloj: a las 02:00 UTC en Bogotá todavía es ayer', () => {
        const at = new Date('2026-10-08T02:00:00Z');
        expect(zonedToday('UTC', at)).toBe('2026-10-08');
        expect(zonedToday('America/Bogota', at)).toBe('2026-10-07');
        expect(zonedNowNaive('America/Bogota', at)).toBe('2026-10-07 21:00:00');
        expect(zonedToday('Asia/Tokyo', at)).toBe('2026-10-08');
    });

    it('el instante de una hora local, también en días con cambio de horario', () => {
        expect(zonedInstant('2026-10-07', 'America/Bogota').toISOString()).toBe('2026-10-07T05:00:00.000Z');
        expect(zonedInstant('2026-10-07', 'America/Bogota', { h: 8 }).toISOString()).toBe('2026-10-07T13:00:00.000Z');
        // Madrid: horario de verano (+2) en julio, de invierno (+1) en enero.
        expect(zonedInstant('2026-07-01', 'Europe/Madrid').toISOString()).toBe('2026-06-30T22:00:00.000Z');
        expect(zonedInstant('2026-01-15', 'Europe/Madrid').toISOString()).toBe('2026-01-14T23:00:00.000Z');
        // Día del cambio (29-03-2026 en Madrid): las 12:00 ya son +2.
        expect(zonedInstant('2026-03-29', 'Europe/Madrid', { h: 12 }).toISOString()).toBe('2026-03-29T10:00:00.000Z');
        expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('la automatización usa su zona, si no la de la empresa, si no UTC (y lo dice)', () => {
        expect(scheduleTimeZone({ tz: 'Europe/Madrid' }, 'America/Bogota')).toEqual({ tz: 'Europe/Madrid', source: 'own' });
        expect(scheduleTimeZone({}, 'America/Bogota')).toEqual({ tz: 'America/Bogota', source: 'tenant' });
        expect(scheduleTimeZone({ tz: 'Marte/Olympus' }, null)).toEqual({ tz: 'UTC', source: 'fallback' });
    });

    it('el formato regional guarda la zona sólo si es válida', () => {
        expect(tenantFormatSchema.parse({}).timezone).toBeNull();
        expect(tenantFormatSchema.parse({ timezone: 'America/Bogota' }).timezone).toBe('America/Bogota');
        // Un valor viejo corrupto no rompe la lectura: queda sin zona.
        expect(tenantFormatSchema.parse({ timezone: 'Marte/Olympus' }).timezone).toBeNull();
        expect(updateTenantFormatSchema.safeParse({ timezone: 'Marte/Olympus' }).success).toBe(false);
        expect(updateTenantFormatSchema.parse({ timezone: null }).timezone).toBeNull();
    });
});
