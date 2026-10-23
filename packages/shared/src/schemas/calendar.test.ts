import { describe, expect, it } from 'vitest';

import {
    CALENDAR_MAIN_SOURCE,
    calendarEventSpan,
    calendarSettingsToConfig,
    calendarSourceTypesOk,
    newCalendarSourceId,
    readCalendarSettings,
    withCalendarSettings,
} from './calendar';
import { zonedDayAndMinute } from './timezone';
import { parseViewConfig } from './view';

describe('Calendario completo (B4) — config de la vista', () => {
    const full = {
        date_field_id: 7,
        calendar_end_field_id: 8,
        calendar_main_label: 'Vencimiento',
        calendar_main_color: 'red',
        calendar_sources: [{ id: 's2', start_field_id: 9, label: 'Próximo contacto', color: 'green' }],
        calendar_hidden_sources: ['s2'],
        calendar_color_by: 'field',
        calendar_color_field_id: 11,
        calendar_default_mode: 'week',
        calendar_week_start: 0,
        calendar_day_start: 8,
        calendar_day_end: 19,
        calendar_show_weekends: false,
        calendar_default_duration: 30,
    };

    it('el schema del servidor conserva todas las claves del calendario', () => {
        const cfg = parseViewConfig('calendar', full);
        for (const [k, v] of Object.entries(full)) expect(cfg[k]).toEqual(v);
        // Una vista vieja sigue valiendo y no gana claves vacías.
        const old = parseViewConfig('calendar', { date_field_id: 7 });
        expect(old.date_field_id).toBe(7);
        expect(old.calendar_sources).toBeUndefined();
    });

    it('una fuente sin inicio (un campo que no viajó) se descarta sin invalidar la vista', () => {
        const cfg = parseViewConfig('calendar', {
            date_field_id: 7,
            calendar_sources: [{ id: 's2', start_field_id: null }, { id: 's3', start_field_id: 9 }],
        });
        expect(cfg.calendar_sources).toEqual([{ id: 's3', start_field_id: 9 }]);
    });

    it('lee y vuelve a escribir lo mismo (round-trip)', () => {
        const s = readCalendarSettings(full);
        expect(s.sources).toHaveLength(2);
        expect(s.sources[0]).toEqual({ id: CALENDAR_MAIN_SOURCE, startFieldId: 7, endFieldId: 8, durationFieldId: null, label: 'Vencimiento', color: 'red', enabled: true });
        expect(s.sources[1]).toMatchObject({ id: 's2', startFieldId: 9, endFieldId: null, color: 'green', enabled: false });
        expect(s).toMatchObject({ colorBy: 'field', colorFieldId: 11, defaultMode: 'week', weekStart: 0, dayStartHour: 8, dayEndHour: 19, showWeekends: false, defaultDuration: 30 });
        expect(readCalendarSettings(calendarSettingsToConfig(s))).toEqual(s);
    });

    it('lo ausente o roto toma el default; una vista vieja no gana claves', () => {
        const s = readCalendarSettings({ date_field_id: 7, calendar_day_start: 20, calendar_day_end: 9, calendar_week_start: 3, calendar_default_duration: -5 });
        expect(s).toMatchObject({ dayStartHour: 7, dayEndHour: 21, weekStart: 1, defaultDuration: 60, defaultMode: 'month', colorBy: 'auto' });
        expect(calendarSettingsToConfig(readCalendarSettings({ date_field_id: 7 }))).toEqual({ date_field_id: 7 });
        expect(readCalendarSettings({}).sources).toEqual([]);
    });

    it('withCalendarSettings reemplaza SÓLO lo del calendario', () => {
        const base = { filter_tree: { type: 'group', logic: 'and', children: [] }, search: 'ana', ...full };
        const s = readCalendarSettings(full);
        const next = withCalendarSettings(base, { ...s, sources: s.sources.slice(0, 1), defaultMode: 'month' });
        expect(next.search).toBe('ana');
        expect(next.filter_tree).toEqual(base.filter_tree);
        expect(next.calendar_sources).toBeUndefined();
        expect(next.calendar_default_mode).toBeUndefined();
        expect(next.date_field_id).toBe(7);
    });

    it('fuentes repetidas, ids inválidos y tipos: se normalizan', () => {
        const s = readCalendarSettings({
            date_field_id: 7,
            calendar_sources: [
                { id: 's2', start_field_id: 7 },
                { id: 'main', start_field_id: 9 },
                { id: 's3', start_field_id: 9, end_field_id: 9 },
            ],
        });
        expect(s.sources.map((x) => x.id)).toEqual(['main', 's3']);
        expect(s.sources[1]!.endFieldId).toBeNull();
        expect(newCalendarSourceId(s.sources)).toBe('s2');
        expect(calendarSourceTypesOk('date', null)).toBe(true);
        expect(calendarSourceTypesOk('datetime', 'datetime')).toBe(true);
        expect(calendarSourceTypesOk('datetime', 'date')).toBe(false);
        expect(calendarSourceTypesOk('text', null)).toBe(false);
        expect(calendarSourceTypesOk('datetime', 'duration')).toBe(true);
        expect(calendarSourceTypesOk('date', 'duration')).toBe(false);
    });

    it('una duración (minutos) en vez de un fin: round-trip, y un fin explícito gana', () => {
        const s = readCalendarSettings({ date_field_id: 7, calendar_duration_field_id: 12, calendar_sources: [{ id: 's2', start_field_id: 9, duration_field_id: 13 }] });
        expect(s.sources.map((x) => [x.endFieldId, x.durationFieldId])).toEqual([[null, 12], [null, 13]]);
        expect(readCalendarSettings(calendarSettingsToConfig(s))).toEqual(s);
        expect(parseViewConfig('calendar', calendarSettingsToConfig(s)).calendar_duration_field_id).toBe(12);
        const both = readCalendarSettings({ date_field_id: 7, calendar_end_field_id: 8, calendar_duration_field_id: 12 });
        expect(both.sources[0]).toMatchObject({ endFieldId: 8, durationFieldId: null });
    });

    it('calendarEventSpan: fechas sin hora nunca se corren; un fin anterior se ignora', () => {
        const tz = 'America/Bogota';
        expect(calendarEventSpan({ startType: 'date', start: '2026-10-31', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            hasTime: false,
            inStrip: true,
            startDay: '2026-10-31',
            endDay: '2026-10-31',
            endFromField: false,
        });
        expect(calendarEventSpan({ startType: 'date', start: '2026-10-05', end: '2026-10-07', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            startDay: '2026-10-05',
            endDay: '2026-10-07',
            endFromField: true,
        });
        expect(calendarEventSpan({ startType: 'date', start: '2026-10-05', end: '2026-10-01', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            endDay: '2026-10-05',
            endFromField: false,
        });
        expect(calendarEventSpan({ startType: 'date', start: '2026-02-30', timeZone: tz, defaultDuration: 60 })).toBeNull();
        expect(calendarEventSpan({ startType: 'date', start: null, timeZone: tz, defaultDuration: 60 })).toBeNull();
    });

    it('calendarEventSpan: fecha y hora en el reloj de la empresa, con fin, duración o el default', () => {
        const tz = 'America/Bogota';
        // 03:30 UTC del 21 = 22:30 del 20 en Bogotá; sin fin, 60 min sin cruzar el día.
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-21T03:30:00.000Z', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            hasTime: true,
            inStrip: false,
            startDay: '2026-10-20',
            endDay: '2026-10-20',
            startMinute: 22 * 60 + 30,
            endMinute: 23 * 60 + 30,
            endFromField: false,
        });
        // 23:30 + 60 min: se corta a medianoche (el servidor lo cuenta sólo en su día).
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-21T04:30:00Z', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            startMinute: 23 * 60 + 30,
            endMinute: 1440,
            endDay: '2026-10-20',
        });
        // Duración 0 por defecto: «todo el día» (franja), con su hora para la etiqueta.
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-21T15:00:00Z', timeZone: tz, defaultDuration: 0 })).toMatchObject({
            inStrip: true,
            startMinute: 10 * 60,
            endMinute: 1440,
        });
        // De varios días: del 5 a las 9:00 al 7 a las 10:00 → franja (≥ 24 h).
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-05T14:00:00Z', end: '2026-10-07T15:00:00Z', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            inStrip: true,
            startDay: '2026-10-05',
            endDay: '2026-10-07',
            endMinute: 10 * 60,
            endFromField: true,
        });
        // De 00:00 del 10 a 00:00 del 11: sólo ocupa el 10.
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-10T05:00:00Z', end: '2026-10-11T05:00:00Z', timeZone: tz, defaultDuration: 60 })).toMatchObject({
            startDay: '2026-10-10',
            endDay: '2026-10-10',
            endMinute: 1440,
        });
        // Cruza la medianoche en menos de 24 h: va en la grilla de horas (dos días).
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-25T04:00:00Z', duration: 120, timeZone: tz, defaultDuration: 60 })).toMatchObject({
            inStrip: false,
            startDay: '2026-10-24',
            endDay: '2026-10-25',
            startMinute: 23 * 60,
            endMinute: 60,
            endFromField: true,
        });
        // Un fin anterior al inicio no cuenta; una duración vacía tampoco.
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-21T15:00:00Z', end: '2026-10-21T14:00:00Z', timeZone: tz, defaultDuration: 30 })).toMatchObject({
            endMinute: 10 * 60 + 30,
            endFromField: false,
        });
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-21T15:00:00Z', duration: '', timeZone: tz, defaultDuration: 30 })!.endFromField).toBe(false);
        // Un valor sin zona se toma como UTC.
        expect(calendarEventSpan({ startType: 'datetime', start: '2026-10-21 15:00:00', timeZone: tz, defaultDuration: 30 })!.startMinute).toBe(10 * 60);
        expect(calendarEventSpan({ startType: 'datetime', start: 'mañana', timeZone: tz, defaultDuration: 30 })).toBeNull();
    });

    it('zonedDayAndMinute ubica un instante en el reloj de la empresa', () => {
        // 03:30 UTC del 21 = 22:30 del 20 en Bogotá.
        expect(zonedDayAndMinute(new Date('2026-10-21T03:30:00Z'), 'America/Bogota')).toEqual({ ymd: '2026-10-20', minute: 22 * 60 + 30 });
        expect(zonedDayAndMinute(new Date('2026-10-21T03:30:00Z'), 'Europe/Madrid')).toEqual({ ymd: '2026-10-21', minute: 5 * 60 + 30 });
    });
});
