import { describe, expect, it } from 'vitest';
import {
    addDaysToDateValue,
    buildGanttRows,
    dayToYmd,
    GANTT_MAX_RANGE_DAYS,
    GANTT_NULL_GROUP,
    ganttBarOf,
    ganttDraggedBar,
    ganttGroupOrder,
    ganttGrowWindow,
    ganttMovePatch,
    ganttSchedulePatch,
    ganttSettingsToConfig,
    ganttWindowAround,
    ganttTicks,
    mondayOf,
    readGanttSettings,
    withGanttSettings,
    ymdToDay,
} from './gantt';
import { resolveFieldRefs, tokenizeFieldRefs } from './list-template';
import { parseViewConfig } from './view';

describe('Gantt — config de la vista', () => {
    it('lee tolerante y vuelve a escribir sólo lo que no es default (round-trip)', () => {
        const s = readGanttSettings({
            gantt_start_field_id: 10,
            gantt_end_field_id: 11,
            gantt_group_by_field_id: 12,
            gantt_color_field_id: 12,
            gantt_columns: [{ field_id: 13, width: 140 }, { field_id: 13 }, { field_id: 'x' }],
            gantt_zoom: 'month',
            gantt_title_width: 9999,
            gantt_show_baseline: false,
        });
        expect(s).toMatchObject({
            startFieldId: 10,
            endFieldId: 11,
            groupByFieldId: 12,
            colorFieldId: 12,
            columns: [{ field_id: 13, width: 140 }],
            zoom: 'month',
            titleWidth: null,
            showBaseline: false,
            showSubtasks: true,
        });
        const back = ganttSettingsToConfig(s);
        expect(readGanttSettings(back)).toEqual(s);
        // El fin igual al inicio no existe (todo sería hito).
        expect(readGanttSettings({ gantt_start_field_id: 5, gantt_end_field_id: 5 }).endFieldId).toBeNull();
        // Mezclar no toca filtros ni el resto de la config.
        const merged = withGanttSettings({ search: 'x', gantt_zoom: 'day' }, { ...s, zoom: 'week' });
        expect(merged.search).toBe('x');
        expect(merged.gantt_zoom).toBeUndefined();
    });

    it('valida con el schema del tipo y se re-mapea en plantillas/migración', () => {
        const config = parseViewConfig('gantt', {
            gantt_start_field_id: 10,
            gantt_end_field_id: 11,
            gantt_group_by_field_id: 12,
            gantt_columns: [{ field_id: 13, width: 120 }],
        });
        const tokens = tokenizeFieldRefs(config, new Map([[10, 'inicio'], [11, 'fin'], [12, 'responsable'], [13, 'estado']]));
        expect(tokens).toMatchObject({
            gantt_start_field_id: { $field: 'inicio' },
            gantt_end_field_id: { $field: 'fin' },
            gantt_group_by_field_id: { $field: 'responsable' },
            gantt_columns: [{ field_id: { $field: 'estado' } }],
        });
        const resolved = resolveFieldRefs(tokens, new Map([['inicio', 210], ['fin', 211], ['responsable', 212], ['estado', 213]]));
        const reparsed = parseViewConfig('gantt', resolved);
        expect(reparsed).toMatchObject({
            gantt_start_field_id: 210,
            gantt_end_field_id: 211,
            gantt_group_by_field_id: 212,
            gantt_columns: [{ field_id: 213, width: 120 }],
        });
        // Sin inicio no hay Gantt.
        expect(() => parseViewConfig('gantt', {})).toThrow();
    });
});

describe('Gantt — escala del tiempo', () => {
    it('días ↔ fechas y lunes de la semana', () => {
        const d = ymdToDay('2026-07-15')!;
        expect(dayToYmd(d)).toBe('2026-07-15');
        expect(dayToYmd(mondayOf(d))).toBe('2026-07-13');
        expect(ymdToDay('nada')).toBeNull();
    });

    it('barra, hito y sin programar', () => {
        const start = { key: 'f1', type: 'date' };
        const end = { key: 'f2', type: 'date' };
        expect(ganttBarOf({ f1: '2026-07-01', f2: '2026-07-05' }, start, end)).toEqual({
            start: ymdToDay('2026-07-01'),
            end: ymdToDay('2026-07-05'),
            milestone: false,
        });
        // Una sola fecha: hito.
        expect(ganttBarOf({ f2: '2026-07-05' }, start, end)).toMatchObject({ milestone: true, start: ymdToDay('2026-07-05') });
        // Sin campo de fin: todo es hito.
        expect(ganttBarOf({ f1: '2026-07-01' }, start, null)?.milestone).toBe(true);
        // El fin antes del inicio no se pierde.
        expect(ganttBarOf({ f1: '2026-07-05', f2: '2026-07-01' }, start, end)).toMatchObject({ start: ymdToDay('2026-07-01'), end: ymdToDay('2026-07-05') });
        expect(ganttBarOf({}, start, end)).toBeNull();
    });

    it('fecha y hora en la zona pedida', () => {
        const bar = ganttBarOf({ f1: '2026-07-02T03:00:00.000Z' }, { key: 'f1', type: 'datetime' }, null, 'America/Bogota');
        // 03:00 UTC = 22:00 del día anterior en Bogotá.
        expect(dayToYmd(bar!.start)).toBe('2026-07-01');
    });

    it('correr días conserva el formato', () => {
        expect(addDaysToDateValue('date', '2026-02-27', 3)).toBe('2026-03-02');
        const moved = addDaysToDateValue('datetime', '2026-07-10T14:30:00.000Z', -2);
        expect(Date.parse(moved) - Date.parse('2026-07-10T14:30:00.000Z')).toBe(-2 * 86_400_000);
    });

    it('marcas del encabezado por zoom, en español', () => {
        const from = ymdToDay('2026-07-28')!;
        const to = ymdToDay('2026-08-04')!;
        const day = ganttTicks('day', from, to);
        expect(day.top.map((t) => t.label)).toEqual(['julio 2026', 'agosto 2026']);
        expect(day.bottom).toHaveLength(8);
        expect(day.bottom[0]).toMatchObject({ label: 'ma 28', weekend: false });
        expect(day.bottom.find((t) => t.label === 'sá 1')?.weekend).toBe(true);
        const week = ganttTicks('week', from, to);
        expect(week.bottom.map((t) => t.label)).toEqual(['27 jul', '3 ago']);
        // El primer tramo se recorta al rango pedido.
        expect(week.bottom[0]).toMatchObject({ day: from, days: 6 });
        const q = ganttTicks('quarter', ymdToDay('2026-01-01')!, ymdToDay('2026-12-31')!);
        expect(q.bottom.map((t) => t.label)).toEqual(['T1', 'T2', 'T3', 'T4']);
        expect(q.top.map((t) => t.label)).toEqual(['2026']);
        const m = ganttTicks('month', ymdToDay('2026-11-15')!, ymdToDay('2027-02-01')!);
        expect(m.bottom.map((t) => t.label)).toEqual(['nov', 'dic', 'ene', 'feb']);
    });
});

describe('Gantt — filas', () => {
    const recs = [
        { id: 1, parent: null, g: 'b' },
        { id: 2, parent: 1, g: 'a' },
        { id: 3, parent: null, g: null },
        { id: 4, parent: null, g: 'a' },
        { id: 5, parent: 9, g: 'a' },
    ];
    type Rec = (typeof recs)[number];
    const acc = { id: (r: Rec) => r.id, parent: (r: Rec) => r.parent, group: (r: Rec) => r.g };

    it('sin agrupar: cada registro y debajo sus subtareas; un padre ausente no esconde a la hija', () => {
        const rows = buildGanttRows(recs, acc, { grouped: false });
        expect(rows.map((r) => (r.kind === 'record' ? `${r.id}:${r.depth}` : r.key))).toEqual(['1:0', '2:1', '3:0', '4:0', '5:0']);
        expect(rows[0]).toMatchObject({ hasChildren: true });
        const folded = buildGanttRows(recs, acc, { grouped: false, collapsedParents: new Set([1]) });
        expect(folded.map((r) => (r.kind === 'record' ? r.id : r.key))).toEqual([1, 3, 4, 5]);
        expect(buildGanttRows(recs, acc, { grouped: false, showSubtasks: false }).map((r) => (r.kind === 'record' ? r.id : 0))).toEqual([1, 3, 4, 5]);
    });

    it('agrupado: en el orden pedido, «Sin valor» al final, la subtarea con su padre', () => {
        const rows = buildGanttRows(recs, acc, { grouped: true, groupOrder: ['a', 'b'] });
        expect(rows.map((r) => (r.kind === 'record' ? r.id : `[${r.key}:${r.count}]`))).toEqual(['[a:2]', 4, 5, '[b:2]', 1, 2, '[__null__:1]', 3]);
        const collapsed = buildGanttRows(recs, acc, { grouped: true, groupOrder: ['a', 'b'], collapsedGroups: new Set(['a']) });
        expect(collapsed.map((r) => (r.kind === 'record' ? r.id : r.key))).toEqual(['a', 'b', 1, 2, '__null__', 3]);
    });
});

describe('Gantt — orden de los grupos', () => {
    it('select por sus opciones, casilla Sí/No, personas por nombre y «Sin valor» al final', () => {
        const select = { type: 'select', config: { options: [{ value: 'b' }, { value: 'a' }, { value: 'c' }] } };
        expect(ganttGroupOrder(select, ['a', GANTT_NULL_GROUP, 'x', 'b'], (k) => k)).toEqual(['b', 'a', 'x', GANTT_NULL_GROUP]);
        expect(ganttGroupOrder({ type: 'checkbox' }, ['false', 'true'], (k) => k)).toEqual(['true', 'false']);
        const names: Record<string, string> = { '7': 'Zoe', '3': 'Ana' };
        expect(ganttGroupOrder({ type: 'user' }, ['7', '3'], (k) => names[k]!)).toEqual(['3', '7']);
    });
});

describe('Gantt — ventana de datos', () => {
    it('alcanza lo cargado: no pide nada', () => {
        const loaded = ganttWindowAround('week', 1000);
        expect(ganttGrowWindow(loaded, { from: 990, to: 1010 }, 'week')).toBeNull();
    });

    it('al acercarse a un borde la ventana CRECE (nunca se achica)', () => {
        const loaded = ganttWindowAround('week', 1000);
        const grown = ganttGrowWindow(loaded, { from: loaded.to - 30, to: loaded.to + 10 }, 'week')!;
        expect(grown.from).toBe(loaded.from);
        expect(grown.to).toBeGreaterThan(loaded.to);
        const left = ganttGrowWindow(loaded, { from: loaded.from - 5, to: loaded.from + 20 }, 'week')!;
        expect(left.to).toBe(loaded.to);
        expect(left.from).toBeLessThan(loaded.from);
    });

    it('nunca supera el rango máximo del bundle', () => {
        const loaded = { from: 0, to: GANTT_MAX_RANGE_DAYS - 10 };
        const grown = ganttGrowWindow(loaded, { from: GANTT_MAX_RANGE_DAYS + 200, to: GANTT_MAX_RANGE_DAYS + 400 }, 'quarter')!;
        expect(grown.to - grown.from + 1).toBeLessThanOrEqual(GANTT_MAX_RANGE_DAYS);
        expect(grown.from).toBeLessThanOrEqual(GANTT_MAX_RANGE_DAYS + 200);
        expect(grown.to).toBeGreaterThanOrEqual(GANTT_MAX_RANGE_DAYS + 400);
    });
});

describe('Gantt — mover y estirar', () => {
    const bar = { start: 100, end: 104, milestone: false };
    const start = { slug: 'inicio', type: 'date' };
    const end = { slug: 'fin', type: 'date' };

    it('mover corre las dos puntas; estirar sólo una y sin cruzar la otra', () => {
        expect(ganttDraggedBar(bar, 'move', 3)).toEqual({ start: 103, end: 107, milestone: false });
        expect(ganttDraggedBar(bar, 'start', -2)).toEqual({ start: 98, end: 104, milestone: false });
        expect(ganttDraggedBar(bar, 'end', -10)).toEqual({ start: 100, end: 100, milestone: false });
        expect(ganttDraggedBar(bar, 'start', 10)).toEqual({ start: 104, end: 104, milestone: false });
        // Un hito siempre se mueve entero.
        expect(ganttDraggedBar({ start: 5, end: 5, milestone: true }, 'end', 2)).toEqual({ start: 7, end: 7, milestone: true });
    });

    it('el patch cambia sólo lo que se movió y conserva el formato', () => {
        const values = { inicio: '2026-07-01', fin: '2026-07-05' };
        const b = ganttBarOf({ inicio: values.inicio, fin: values.fin }, { key: 'inicio', type: 'date' }, { key: 'fin', type: 'date' })!;
        expect(ganttMovePatch(values, start, end, b, ganttDraggedBar(b, 'move', 2))).toEqual({ inicio: '2026-07-03', fin: '2026-07-07' });
        expect(ganttMovePatch(values, start, end, b, ganttDraggedBar(b, 'end', 3))).toEqual({ fin: '2026-07-08' });
        expect(ganttMovePatch(values, start, end, b, b)).toEqual({});
        // Fecha y hora: conserva la hora.
        const dt = { inicio: '2026-07-01T14:30:00.000Z', fin: '2026-07-03T14:30:00.000Z' };
        const dtStart = { slug: 'inicio', type: 'datetime' };
        const dtEnd = { slug: 'fin', type: 'datetime' };
        const db = ganttBarOf(dt, { key: 'inicio', type: 'datetime' }, { key: 'fin', type: 'datetime' })!;
        const p = ganttMovePatch(dt, dtStart, dtEnd, db, ganttDraggedBar(db, 'move', 1));
        expect(Date.parse(p.inicio!) - Date.parse(dt.inicio)).toBe(86_400_000);
        expect(Date.parse(p.fin!) - Date.parse(dt.fin)).toBe(86_400_000);
    });

    it('un hito mueve sólo la fecha que tiene; una barra al revés estira el borde correcto', () => {
        const only = { inicio: '', fin: '2026-07-10' };
        const m = ganttBarOf(only, { key: 'inicio', type: 'date' }, { key: 'fin', type: 'date' })!;
        expect(m.milestone).toBe(true);
        expect(ganttMovePatch(only, start, end, m, ganttDraggedBar(m, 'move', -1))).toEqual({ fin: '2026-07-09' });
        // Fin antes que inicio: la izquierda es el FIN.
        const rev = { inicio: '2026-07-10', fin: '2026-07-05' };
        const rb = ganttBarOf(rev, { key: 'inicio', type: 'date' }, { key: 'fin', type: 'date' })!;
        expect(ganttMovePatch(rev, start, end, rb, ganttDraggedBar(rb, 'start', -2))).toEqual({ fin: '2026-07-03' });
    });

    it('programar un «Sin programar» en un día', () => {
        const day = ymdToDay('2026-08-03')!;
        expect(ganttSchedulePatch(start, end, day, 5)).toEqual({ inicio: '2026-08-03', fin: '2026-08-07' });
        expect(ganttSchedulePatch(start, null, day)).toEqual({ inicio: '2026-08-03' });
        const dt = ganttSchedulePatch({ slug: 'inicio', type: 'datetime' }, null, day);
        expect(new Date(dt.inicio!).getHours()).toBe(9);
    });
});
