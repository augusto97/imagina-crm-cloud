import { describe, expect, it } from 'vitest';
import {
    createSqlSyncSchema,
    describeSqlSchedule,
    nextSqlSyncRun,
    readSqlListMarker,
    sqlSourceSchema,
    zonedToUtc,
} from './sql-sync';

describe('sincronización SQL (v0.1.243)', () => {
    it('intervalo: suma los minutos', () => {
        const from = new Date('2026-10-02T10:00:00Z');
        expect(nextSqlSyncRun({ kind: 'interval', minutes: 60 }, from).toISOString()).toBe('2026-10-02T11:00:00.000Z');
    });

    it('diaria: la próxima vez que el reloj de la zona marca esa hora', () => {
        // 07:30 en Bogotá (UTC−5) = 12:30 UTC.
        const sched = { kind: 'daily' as const, time: '07:30', timezone: 'America/Bogota' };
        expect(nextSqlSyncRun(sched, new Date('2026-10-02T10:00:00Z')).toISOString()).toBe('2026-10-02T12:30:00.000Z');
        // Ya pasó hoy → mañana.
        expect(nextSqlSyncRun(sched, new Date('2026-10-02T13:00:00Z')).toISOString()).toBe('2026-10-03T12:30:00.000Z');
        // Justo a la hora → la de mañana (no se repite en el mismo instante).
        expect(nextSqlSyncRun(sched, new Date('2026-10-02T12:30:00Z')).toISOString()).toBe('2026-10-03T12:30:00.000Z');
    });

    it('diaria con horario de verano y zona desconocida', () => {
        // Madrid en julio es UTC+2: 08:00 local = 06:00 UTC.
        const madrid = nextSqlSyncRun({ kind: 'daily', time: '08:00', timezone: 'Europe/Madrid' }, new Date('2026-07-10T00:00:00Z'));
        expect(madrid.toISOString()).toBe('2026-07-10T06:00:00.000Z');
        // Zona inválida → UTC, sin tirar.
        const bad = nextSqlSyncRun({ kind: 'daily', time: '08:00', timezone: 'Marte/Olympus' }, new Date('2026-07-10T00:00:00Z'));
        expect(bad.toISOString()).toBe('2026-07-10T08:00:00.000Z');
    });

    it('zonedToUtc convierte la hora de pared a UTC', () => {
        expect(zonedToUtc(2026, 3, 15, 14, 5, 'America/Bogota').toISOString()).toBe('2026-03-15T19:05:00.000Z');
        expect(zonedToUtc(2026, 3, 15, 14, 5, 'UTC').toISOString()).toBe('2026-03-15T14:05:00.000Z');
    });

    it('valida el origen: consulta o procedimiento con un nombre razonable', () => {
        expect(sqlSourceSchema.safeParse({ kind: 'query', sql: 'SELECT 1' }).success).toBe(true);
        expect(sqlSourceSchema.safeParse({ kind: 'query', sql: '   ' }).success).toBe(false);
        for (const name of ['uspFacturas', 'dbo.uspFacturas', '[dbo].[usp Facturas]', 'Ventas.dbo.usp_x']) {
            expect(sqlSourceSchema.safeParse({ kind: 'procedure', name }).success, name).toBe(true);
        }
        for (const name of ['usp; DROP TABLE x', 'a.b.c.d', "x'--"]) {
            expect(sqlSourceSchema.safeParse({ kind: 'procedure', name }).success, name).toBe(false);
        }
        const withParams = sqlSourceSchema.safeParse({
            kind: 'procedure',
            name: 'usp',
            params: [{ name: '@desde', value: '{{ultima_sincronizacion}}' }],
        });
        expect(withParams.success).toBe(true);
        expect(sqlSourceSchema.safeParse({ kind: 'procedure', name: 'usp', params: [{ name: 'a b', value: '' }] }).success).toBe(false);
    });

    it('los valores por defecto son los acordados', () => {
        const parsed = createSqlSyncSchema.parse({
            name: 'Facturas',
            list_id: 1,
            source: { kind: 'query', sql: 'SELECT 1' },
            key_column: 'NumeroFactura',
            key_field_id: 2,
        });
        expect(parsed).toMatchObject({
            create_missing: true,
            null_clears: true,
            on_missing: 'ignore',
            flag_field_id: null,
            schedule: { kind: 'interval', minutes: 60 },
            timeout_seconds: 60,
            enabled: true,
        });
        expect(describeSqlSchedule(parsed.schedule)).toBe('cada hora');
        expect(describeSqlSchedule({ kind: 'daily', time: '07:30', timezone: 'America/Bogota' })).toContain('07:30');
    });

    it('lee la marca de la lista con tolerancia', () => {
        expect(readSqlListMarker({})).toBeNull();
        expect(readSqlListMarker({ sql_sync: { syncs: [] } })).toBeNull();
        expect(
            readSqlListMarker({ sql_sync: { syncs: [{ sync_id: 3, connection_id: 9, name: 'F', key_field_id: 4, field_ids: [4, '5', 'x'] }, { sync_id: 'no' }] } }),
        ).toEqual({ syncs: [{ sync_id: 3, connection_id: 9, name: 'F', key_field_id: 4, field_ids: [4, 5] }] });
    });
});
