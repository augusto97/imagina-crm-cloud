import { describe, expect, it } from 'vitest';
import type { CalendarSource, StoreListMarker } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { calendarColorResolver, CALENDAR_PRIMARY, resolveColorBy } from './calendarColors';
import { calendarLockReason } from './calendarLocks';
import {
    buildEvents,
    cellsFromMoveForm,
    createPrefill,
    layoutDay,
    layoutWeek,
    monthWeeks,
    moveCells,
    moveFormFor,
    moveTargetInGrid,
    rangeFor,
    resizeCells,
    shiftMoveForm,
    shiftCursor,
    startOfWeek,
    titleFor,
    unloadedByDay,
    weekDays,
    type CalendarEvent,
} from './calendarModel';

const TZ = 'America/Bogota';
const field = (id: number, slug: string, type: string, config: Record<string, unknown> = {}): FieldEntity =>
    ({ id, slug, label: slug.charAt(0).toUpperCase() + slug.slice(1), type, config, position: id, is_required: false, is_unique: false }) as unknown as FieldEntity;
const nombre = field(1, 'nombre', 'text');
const inicio = field(2, 'inicio', 'datetime');
const fin = field(3, 'fin', 'datetime');
const vence = field(4, 'vence', 'date');
const hasta = field(5, 'hasta', 'date');
const minutos = field(6, 'minutos', 'duration');
const estado = field(7, 'estado', 'select', {
    options: [
        { value: 'abierto', label: 'Abierto', color: 'green' },
        { value: 'cerrado', label: 'Cerrado', color: '#ff0000' },
    ],
});
const fields = [nombre, inicio, fin, vence, hasta, minutos, estado];
const byId = new Map(fields.map((f) => [f.id, f]));
const rec = (id: number, values: Record<string, unknown>): RecordEntity =>
    ({ id, fields: values, relations: {}, created_at: '', updated_at: '' }) as unknown as RecordEntity;
const src = (p: Partial<CalendarSource> & Pick<CalendarSource, 'id' | 'startFieldId'>): CalendarSource => ({
    endFieldId: null,
    durationFieldId: null,
    label: null,
    color: 'blue',
    enabled: true,
    ...p,
});
const citas = src({ id: 'main', startFieldId: 2, endFieldId: 3 });
const vencimientos = src({ id: 's2', startFieldId: 4, endFieldId: 5, color: 'red' });
const conDuracion = src({ id: 's3', startFieldId: 2, durationFieldId: 6 });
const build = (records: RecordEntity[], sources: CalendarSource[] = [citas, vencimientos], defaultDuration = 60): CalendarEvent[] =>
    buildEvents(records, { sources, fieldsById: byId, timeZone: TZ, defaultDuration, titleOf: (r) => String(r.fields.nombre ?? `#${r.id}`), colorOf: () => 'red' });

describe('calendario: fechas de la grilla (B4)', () => {
    it('el mes con sus semanas completas según el primer día de la semana', () => {
        const oct = monthWeeks('2026-10-23', 1);
        expect(oct).toHaveLength(5);
        expect(oct[0]![0]).toBe('2026-09-28');
        expect(oct[4]![6]).toBe('2026-11-01');
        const sunday = monthWeeks('2026-10-23', 0);
        expect(sunday[0]![0]).toBe('2026-09-27');
        expect(startOfWeek('2026-10-23', 6)).toBe('2026-10-17');
        expect(weekDays('2026-10-23', 1)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    });

    it('el rango que se pide y la navegación por vista', () => {
        expect(rangeFor('month', '2026-10-23', 1)).toEqual({ from: '2026-09-28', to: '2026-11-01' });
        expect(rangeFor('week', '2026-10-23', 1)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
        expect(rangeFor('day', '2026-10-23', 1)).toEqual({ from: '2026-10-23', to: '2026-10-23' });
        expect(rangeFor('agenda', '2026-10-23', 1)).toEqual({ from: '2026-10-23', to: '2026-11-21' });
        expect(shiftCursor('month', '2026-01-31', 1)).toBe('2026-02-01');
        expect(shiftCursor('week', '2026-10-23', -1)).toBe('2026-10-16');
        expect(shiftCursor('day', '2026-12-31', 1)).toBe('2027-01-01');
        expect(titleFor('month', '2026-10-23', 1, '2026-10-23')).toBe('Octubre de 2026');
        expect(titleFor('week', '2026-10-23', 1, '2026-10-23')).toBe('19 – 25 de octubre de 2026');
        expect(titleFor('week', '2026-10-30', 1, '2026-10-23')).toBe('26 oct – 1 nov de 2026');
        expect(titleFor('day', '2026-10-23', 1, '2026-10-23')).toBe('Viernes 23 de octubre');
        expect(titleFor('agenda', '2026-10-23', 1, '2026-10-23')).toBe('Desde hoy');
    });
});

describe('calendario: eventos y acomodo', () => {
    const records = [
        rec(1, { nombre: 'Viaje', inicio: '2026-10-20T14:00:00Z', fin: '2026-10-22T22:00:00Z' }),
        rec(2, { nombre: 'Corta', inicio: '2026-10-21T15:00:00Z', fin: '2026-10-21T16:00:00Z', vence: '2026-10-21' }),
        rec(3, { nombre: 'Congreso', vence: '2026-10-24', hasta: '2026-10-27' }),
    ];

    it('un registro con dos fuentes da dos eventos; las fechas sin hora no se corren', () => {
        const ev = build(records);
        expect(ev.map((e) => e.key).sort()).toEqual(['main:1', 'main:2', 's2:2', 's2:3']);
        expect(ev.find((e) => e.key === 's2:3')!.span).toMatchObject({ startDay: '2026-10-24', endDay: '2026-10-27', hasTime: false });
        // Una fuente apagada no da eventos.
        expect(build(records, [citas, { ...vencimientos, enabled: false }]).map((e) => e.key).sort()).toEqual(['main:1', 'main:2']);
    });

    it('mes: barras que cruzan días en carriles, «+N más» cuando no entran, fines de semana ocultos', () => {
        const week = weekDays('2026-10-19', 1);
        const { bars, hiddenByCol } = layoutWeek(build(records), week, 2);
        const viaje = bars.find((b) => b.event.key === 'main:1')!;
        expect([viaje.startCol, viaje.endCol, viaje.lane]).toEqual([1, 3, 0]);
        // El congreso (24 → 27) sigue en la semana siguiente.
        const congreso = bars.find((b) => b.event.key === 's2:3')!;
        expect([congreso.startCol, congreso.endCol, congreso.continuesAfter]).toEqual([5, 6, true]);
        // El 21 tiene 3 eventos y 2 carriles: uno queda en «+1 más».
        expect(hiddenByCol[2]).toBe(1);
        const weekdays = week.filter((d) => !['2026-10-24', '2026-10-25'].includes(d));
        expect(layoutWeek(build(records), weekdays, 3).bars.some((b) => b.event.key === 's2:3')).toBe(false);
        // Lo que el servidor contó y no llegó.
        expect(unloadedByDay(build(records), { '2026-10-21': { n: 5 } }, ['2026-10-21']).get('2026-10-21')).toBe(2);
    });

    it('día: bloques con hora en la ventana visible, lado a lado si se pisan', () => {
        const day = [
            rec(10, { nombre: 'A', inicio: '2026-10-21T14:00:00Z', fin: '2026-10-21T16:00:00Z' }), // 9:00–11:00
            rec(11, { nombre: 'B', inicio: '2026-10-21T15:00:00Z', fin: '2026-10-21T15:30:00Z' }), // 10:00–10:30
            rec(12, { nombre: 'C', inicio: '2026-10-21T17:00:00Z', fin: '2026-10-21T18:00:00Z' }), // 12:00–13:00
            rec(13, { nombre: 'Temprano', inicio: '2026-10-21T10:00:00Z', fin: '2026-10-21T11:00:00Z' }), // 5:00–6:00
            rec(14, { nombre: 'Noche', inicio: '2026-10-22T02:00:00Z', fin: '2026-10-22T03:00:00Z' }), // 21:00–22:00
        ];
        const { blocks, before, after } = layoutDay(build(day, [citas]), '2026-10-21', 7 * 60, 21 * 60);
        const a = blocks.find((b) => b.event.record.id === 10)!;
        const b = blocks.find((x) => x.event.record.id === 11)!;
        const c = blocks.find((x) => x.event.record.id === 12)!;
        expect([a.top, a.height, a.col, a.cols]).toEqual([120, 120, 0, 2]);
        expect([b.col, b.cols]).toEqual([1, 2]);
        expect([c.col, c.cols]).toEqual([0, 1]);
        expect(before.map((e) => e.title)).toEqual(['Temprano']);
        expect(after.map((e) => e.title)).toEqual(['Noche']);
        // Un evento que cruza la medianoche se corta en cada día.
        const cruza = build([rec(20, { nombre: 'X', inicio: '2026-10-22T03:30:00Z', fin: '2026-10-22T06:00:00Z' })], [citas]);
        const d1 = layoutDay(cruza, '2026-10-21', 0, 1440).blocks[0]!;
        const d2 = layoutDay(cruza, '2026-10-22', 0, 1440).blocks[0]!;
        expect([d1.top, d1.height, d1.cutBottom]).toEqual([22 * 60 + 30, 90, true]);
        expect([d2.top, d2.height, d2.cutTop]).toEqual([0, 60, true]);
    });
});

describe('calendario: lo que se escribe al arrastrar, estirar, crear y «Mover a…»', () => {
    const viaje = build([rec(1, { nombre: 'Viaje', inicio: '2026-10-20T14:00:00Z', fin: '2026-10-22T22:00:00Z' })], [citas])[0]!;
    const congreso = build([rec(3, { nombre: 'Congreso', vence: '2026-10-24', hasta: '2026-10-27' })], [vencimientos])[0]!;
    const cita = build([rec(4, { nombre: 'Cita', inicio: '2026-10-21T15:00:00Z', minutos: 45 })], [conDuracion])[0]!;
    const sinFin = build([rec(5, { nombre: 'Suelto', vence: '2026-10-21' })], [src({ id: 's9', startFieldId: 4 })])[0]!;

    it('mover en el mes conserva la hora (en la zona de la empresa) y la duración', () => {
        const cells = moveCells(viaje, byId, { day: '2026-10-27' }, TZ)!;
        expect(cells.map((c) => [c.field.slug, c.value])).toEqual([
            ['inicio', '2026-10-27T14:00:00.000Z'],
            ['fin', '2026-10-29T22:00:00.000Z'],
        ]);
        // Una fecha sin hora corre el fin lo mismo.
        expect(moveCells(congreso, byId, { day: '2026-10-30' }, TZ)!.map((c) => c.value)).toEqual(['2026-10-30', '2026-11-02']);
        expect(moveCells(congreso, byId, { day: '2026-10-24' }, TZ)).toBeNull();
    });

    it('mover en la grilla cambia el día y la hora (encaje de 15 min, cruzando la medianoche)', () => {
        const cells = moveCells(cita, byId, { day: '2026-10-22', minute: 14 * 60 + 15 }, TZ)!;
        // 14:15 en Bogotá = 19:15 UTC; la duración (campo aparte) no cambia.
        expect(cells.map((c) => [c.field.slug, c.value])).toEqual([['inicio', '2026-10-22T19:15:00.000Z']]);
        expect(moveTargetInGrid({ startDay: '2026-10-21', startMinute: 600 }, { day: '2026-10-21', minute: 610 }, { day: '2026-10-23', minute: 653 })).toEqual({ day: '2026-10-23', minute: 645 });
        expect(moveTargetInGrid({ startDay: '2026-10-21', startMinute: 1380 }, { day: '2026-10-21', minute: 1380 }, { day: '2026-10-21', minute: 1440 + 60 })).toEqual({ day: '2026-10-22', minute: 60 });
    });

    it('estirar: el campo de fin o la duración; nunca antes del inicio; sin fin no se estira', () => {
        expect(resizeCells(viaje, byId, { day: '2026-10-25' }, TZ)!.map((c) => c.value)).toEqual(['2026-10-25T22:00:00.000Z']);
        expect(resizeCells(cita, byId, { day: '2026-10-21', minute: 11 * 60 + 30 }, TZ)!.map((c) => [c.field.slug, c.value])).toEqual([['minutos', 90]]);
        // Antes del inicio: queda en 15 minutos.
        expect(resizeCells(cita, byId, { day: '2026-10-21', minute: 8 * 60 }, TZ)!.map((c) => c.value)).toEqual([15]);
        expect(resizeCells(congreso, byId, { day: '2026-10-20' }, TZ)!.map((c) => c.value)).toEqual(['2026-10-24']);
        expect(resizeCells(sinFin, byId, { day: '2026-10-25' }, TZ)).toBeNull();
    });

    it('crear en un hueco: el inicio y el fin (o la duración) ya puestos, por slug', () => {
        expect(createPrefill(citas, byId, { day: '2026-10-21', minute: 9 * 60, endMinute: 10 * 60 + 30 }, TZ, 60)).toEqual({
            inicio: '2026-10-21T14:00:00.000Z',
            fin: '2026-10-21T15:30:00.000Z',
        });
        expect(createPrefill(conDuracion, byId, { day: '2026-10-21', minute: 9 * 60 }, TZ, 30)).toEqual({ inicio: '2026-10-21T14:00:00.000Z', minutos: 30 });
        expect(createPrefill(vencimientos, byId, { day: '2026-10-21' }, TZ, 60)).toEqual({ vence: '2026-10-21' });
    });

    it('«Mover a…»: valores actuales en el reloj de la empresa, validación y sólo lo que cambia', () => {
        const form = moveFormFor(viaje, byId, TZ);
        expect(form).toMatchObject({ startDay: '2026-10-20', startTime: '09:00', endDay: '2026-10-22', endTime: '17:00' });
        const res = cellsFromMoveForm(viaje, byId, { ...form, startDay: '2026-10-21', startTime: '08:30' }, TZ);
        expect('cells' in res && res.cells.map((c) => [c.field.slug, c.value])).toEqual([['inicio', '2026-10-21T13:30:00.000Z']]);
        expect(cellsFromMoveForm(viaje, byId, { ...form, endDay: '2026-10-19' }, TZ)).toEqual({ error: 'El fin tiene que ser posterior al inicio.' });
        expect(cellsFromMoveForm(viaje, byId, { ...form, startTime: '25:00' }, TZ)).toHaveProperty('error');
        expect(cellsFromMoveForm(cita, byId, { ...moveFormFor(cita, byId, TZ), duration: '0' }, TZ)).toHaveProperty('error');
        // Cambiar el inicio corre el fin lo mismo (la duración se conserva).
        expect(shiftMoveForm(form, { startDay: '2026-10-31', startTime: '11:30' }, true, TZ)).toMatchObject({ endDay: '2026-11-02', endTime: '19:30' });
        expect(shiftMoveForm(moveFormFor(congreso, byId, TZ), { startDay: '2026-10-25', startTime: '00:00' }, false, TZ)).toMatchObject({ endDay: '2026-10-28' });
    });
});

describe('calendario: colores', () => {
    const r = rec(1, { nombre: 'X', estado: 'cerrado', vence: '2026-10-21' });
    it('las reglas de la vista ganan; si no, la fuente, la opción del select o el primario', () => {
        const rules = [{ id: 'r1', enabled: true, condition: { type: 'condition' as const, field_id: 7, op: 'eq' as const, value: 'cerrado' }, color: 'gray' as const, target: 'row' as const }];
        const base = { fields, fieldsById: byId, timeZone: TZ };
        expect(calendarColorResolver({ ...base, settings: { colorBy: 'source', colorFieldId: null }, colorRules: rules, enabledSources: 1 })(r, vencimientos)).toBe('#6b7280');
        expect(calendarColorResolver({ ...base, settings: { colorBy: 'source', colorFieldId: null }, colorRules: [], enabledSources: 1 })(r, vencimientos)).toBe('#ef4444');
        expect(calendarColorResolver({ ...base, settings: { colorBy: 'field', colorFieldId: 7 }, colorRules: [], enabledSources: 1 })(r, vencimientos)).toBe('#ff0000');
        expect(calendarColorResolver({ ...base, settings: { colorBy: 'none', colorFieldId: null }, colorRules: [], enabledSources: 1 })(r, vencimientos)).toBe(CALENDAR_PRIMARY);
        // Automático: con varias fuentes, la fuente; con una, el primer select.
        expect(resolveColorBy({ colorBy: 'auto', colorFieldId: null }, fields, 2).by).toBe('source');
        expect(resolveColorBy({ colorBy: 'auto', colorFieldId: null }, fields, 1)).toMatchObject({ by: 'field', field: { id: 7 } });
    });
});

describe('calendario: quién mueve qué', () => {
    const ev = build([rec(1, { nombre: 'Viaje', inicio: '2026-10-20T14:00:00Z', fin: '2026-10-22T22:00:00Z' })], [citas])[0]!;
    const marker: StoreListMarker = {
        connection_id: 7,
        role: 'orders',
        store_name: 'Demo',
        store_url: 'https://tienda.test',
        write_back: true,
        // El inicio es una columna que trae la tienda y no se edita desde aquí.
        fields: { fecha: 2 },
        meta_fields: [],
        editable: null,
    };
    it('sin permiso no se mueve; un campo de la tienda dice por qué; el resto se mueve', () => {
        expect(calendarLockReason(ev, 'move', { canEdit: false, fieldsById: byId, storeRules: null })).toMatch(/permiso/);
        expect(calendarLockReason(ev, 'move', { canEdit: true, fieldsById: byId, storeRules: null })).toBeNull();
        const locked = calendarLockReason(ev, 'move', { canEdit: true, fieldsById: byId, storeRules: { marker: { source: 'store', marker }, fields } });
        expect(locked).toMatch(/WooCommerce|tienda/);
        // Estirar toca sólo el fin (una columna propia): se puede.
        expect(calendarLockReason(ev, 'resize', { canEdit: true, fieldsById: byId, storeRules: { marker: { source: 'store', marker }, fields } })).toBeNull();
    });
});
