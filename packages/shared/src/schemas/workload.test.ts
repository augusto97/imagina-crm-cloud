import { describe, expect, it } from 'vitest';
import { parseViewConfig } from './view';
import {
    countWorkdays,
    readWorkloadCapacity,
    readWorkloadSettings,
    reassignWorkloadItem,
    summarizeWorkload,
    withWorkloadSettings,
    workloadBucketCapacity,
    workloadBuckets,
    workloadItemLoad,
    workloadLevel,
    workloadShiftWindow,
    workloadWeekStart,
    workloadWindow,
    WORKLOAD_DEFAULT_CAPACITY,
    WORKLOAD_UNASSIGNED,
    type WorkloadBundle,
    type WorkloadPerson,
} from './workload';

const MON_FRI = [1, 2, 3, 4, 5];

describe('Carga de trabajo — tiempo', () => {
    it('semanas de lunes a domingo y ventanas alineadas por zoom', () => {
        // 2026-10-28 es miércoles.
        expect(workloadWeekStart('2026-10-28')).toBe('2026-10-26');
        expect(workloadWeekStart('2026-11-01')).toBe('2026-10-26'); // domingo
        expect(workloadWindow('2026-10-28', 'day')).toEqual({ from: '2026-10-26', to: '2026-11-08' });
        expect(workloadWindow('2026-10-28', 'week')).toEqual({ from: '2026-10-26', to: '2026-12-20' });
        expect(workloadWindow('2026-10-28', 'month')).toEqual({ from: '2026-10-01', to: '2027-03-31' });
        expect(workloadShiftWindow('2026-10-26', 'day', 1).from).toBe('2026-11-02');
        expect(workloadShiftWindow('2026-10-26', 'week', -1).from).toBe('2026-09-28');
        expect(workloadShiftWindow('2026-10-01', 'month', 1).from).toBe('2027-01-01');
    });

    it('columnas por día, semana y mes recortadas al rango', () => {
        const weeks = workloadBuckets('2026-10-28', '2026-11-10', 'week');
        expect(weeks.map((b) => [b.key, b.days.length])).toEqual([
            ['2026-10-26', 5],
            ['2026-11-02', 7],
            ['2026-11-09', 2],
        ]);
        expect(workloadBuckets('2026-10-30', '2026-11-02', 'month').map((b) => b.key)).toEqual(['2026-10-01', '2026-11-01']);
        expect(workloadBuckets('2026-10-30', '2026-10-31', 'day')).toHaveLength(2);
    });

    it('días hábiles sin recorrer el tramo', () => {
        expect(countWorkdays('2026-10-26', '2026-11-08', MON_FRI)).toBe(10);
        expect(countWorkdays('2026-10-31', '2026-11-01', MON_FRI)).toBe(0); // sábado y domingo
        expect(countWorkdays('2026-10-31', '2026-11-01', [0, 6])).toBe(2);
        expect(countWorkdays('2000-01-01', '2099-12-31', MON_FRI)).toBe(26089);
        expect(countWorkdays('2026-10-28', '2026-10-27', MON_FRI)).toBe(0);
    });
});

describe('Carga de trabajo — reparto de un registro', () => {
    const range = { from: '2026-10-26', to: '2026-11-08' };

    it('el esfuerzo se reparte en los días hábiles del TRAMO completo', () => {
        // 40 h del lunes 26 al viernes 6 (10 días hábiles) = 4 h por día.
        const load = workloadItemLoad({ start: '2026-10-26', end: '2026-11-06', estimate_minutes: 2400 }, 'estimate', MON_FRI, range.from, range.to, 'day');
        expect(load['2026-10-26']).toBeCloseTo(240);
        expect(load['2026-10-31']).toBeUndefined(); // sábado
        expect(Object.values(load).reduce((a, b) => a + b, 0)).toBeCloseTo(2400);
        // En semanas: 20 h y 20 h.
        const weeks = workloadItemLoad({ start: '2026-10-26', end: '2026-11-06', estimate_minutes: 2400 }, 'estimate', MON_FRI, range.from, range.to, 'week');
        expect(weeks).toEqual({ '2026-10-26': 1200, '2026-11-02': 1200 });
    });

    it('lo que cae fuera del rango no se cuenta, pero sí define el reparto', () => {
        // 10 días hábiles (del 19 oct al 30 oct): sólo la segunda semana entra.
        const load = workloadItemLoad({ start: '2026-10-19', end: '2026-10-30', estimate_minutes: 600 }, 'estimate', MON_FRI, range.from, range.to, 'week');
        expect(load).toEqual({ '2026-10-26': 300 });
    });

    it('un sábado suelto se cuenta en su día; sin estimación figura con 0', () => {
        expect(workloadItemLoad({ start: '2026-10-31', end: null, estimate_minutes: 60 }, 'estimate', MON_FRI, range.from, range.to, 'day')).toEqual({ '2026-10-31': 60 });
        expect(workloadItemLoad({ start: '2026-10-27', end: '2026-10-28', estimate_minutes: null }, 'estimate', MON_FRI, range.from, range.to, 'day')).toEqual({
            '2026-10-27': 0,
            '2026-10-28': 0,
        });
    });

    it('la cantidad cuenta 1 por columna activa; el fin anterior al inicio vale como una sola fecha', () => {
        expect(workloadItemLoad({ start: '2026-10-29', end: '2026-11-03', estimate_minutes: null }, 'count', MON_FRI, range.from, range.to, 'week')).toEqual({
            '2026-10-26': 1,
            '2026-11-02': 1,
        });
        expect(workloadItemLoad({ start: '2026-10-29', end: '2026-10-01', estimate_minutes: null }, 'count', MON_FRI, range.from, range.to, 'day')).toEqual({ '2026-10-29': 1 });
        expect(workloadItemLoad({ start: null, end: null, estimate_minutes: 60 }, 'count', MON_FRI, range.from, range.to, 'day')).toEqual({});
        // Sólo fin: vale como la única fecha.
        expect(workloadItemLoad({ start: null, end: '2026-10-29', estimate_minutes: null }, 'count', MON_FRI, range.from, range.to, 'day')).toEqual({ '2026-10-29': 1 });
    });
});

describe('Carga de trabajo — capacidad y colores', () => {
    it('capacidad por columna en minutos o registros', () => {
        const days = workloadBuckets('2026-10-26', '2026-11-01', 'week')[0]!.days;
        expect(workloadBucketCapacity(WORKLOAD_DEFAULT_CAPACITY, 'estimate', days)).toBe(40 * 60);
        expect(workloadBucketCapacity(WORKLOAD_DEFAULT_CAPACITY, 'count', days)).toBe(10);
        expect(workloadBucketCapacity(WORKLOAD_DEFAULT_CAPACITY, 'time', ['2026-10-31'])).toBe(0);
        expect(workloadBucketCapacity({ hours_per_day: 6, work_days: [1, 2, 3, 4], records_per_week: 8 }, 'count', ['2026-10-26'])).toBe(2);
    });

    it('vacía, bien, cerca y pasada', () => {
        expect(workloadLevel(0, 480)).toBe('empty');
        expect(workloadLevel(240, 480)).toBe('ok');
        expect(workloadLevel(420, 480)).toBe('near');
        expect(workloadLevel(480, 480)).toBe('near');
        expect(workloadLevel(481, 480)).toBe('over');
        expect(workloadLevel(60, 0)).toBe('over');
    });

    it('lectura tolerante de la capacidad guardada', () => {
        expect(readWorkloadCapacity(undefined)).toEqual({ capacity: WORKLOAD_DEFAULT_CAPACITY, custom: false });
        expect(readWorkloadCapacity({ hours_per_day: 99 }).custom).toBe(false);
        expect(readWorkloadCapacity({ hours_per_day: 6.5, work_days: [5, 1, 1, 3], records_per_week: 4 })).toEqual({
            capacity: { hours_per_day: 6.5, work_days: [1, 3, 5], records_per_week: 4 },
            custom: true,
        });
    });
});

describe('Carga de trabajo — config de la vista', () => {
    it('lectura tolerante, ida y vuelta y sólo claves workload_*', () => {
        const s = readWorkloadSettings({
            workload_person_field_id: 7,
            workload_start_field_id: 8,
            workload_end_field_id: 8,
            workload_metric: 'estimate',
            workload_estimate_field_id: 9,
            workload_zoom: 'nope',
            workload_user_ids: [3, 3, 'x', 4],
        });
        expect(s).toMatchObject({ personFieldId: 7, startFieldId: 8, endFieldId: null, metric: 'estimate', zoom: 'week', userIds: [3, 4], hideDone: true });
        const config = withWorkloadSettings({ search: 'hola', workload_zoom: 'day' }, { ...s, zoom: 'month', showUnassigned: false });
        expect(config).toEqual({
            search: 'hola',
            workload_person_field_id: 7,
            workload_start_field_id: 8,
            workload_metric: 'estimate',
            workload_estimate_field_id: 9,
            workload_zoom: 'month',
            workload_user_ids: [3, 4],
            workload_show_unassigned: false,
        });
        expect(readWorkloadSettings(config)).toEqual({ ...s, zoom: 'month', showUnassigned: false });
        // El schema de la vista la acepta tal cual.
        expect(parseViewConfig('workload', config)).toMatchObject({ workload_person_field_id: 7, workload_user_ids: [3, 4] });
        expect(() => parseViewConfig('workload', { workload_metric: 'count' })).toThrow();
    });

    it('en «Tiempo registrado» los terminados cuentan por defecto', () => {
        expect(readWorkloadSettings({ workload_person_field_id: 1, workload_metric: 'time' }).hideDone).toBe(false);
        const s = readWorkloadSettings({ workload_person_field_id: 1, workload_metric: 'time', workload_hide_done: true });
        expect(s.hideDone).toBe(true);
        expect(withWorkloadSettings({}, s).workload_hide_done).toBe(true);
    });
});

describe('Carga de trabajo — resumen y reasignación', () => {
    const people: WorkloadPerson[] = [
        { key: '1', user_id: 1, name: 'Ana', email: null, member: true, capacity: WORKLOAD_DEFAULT_CAPACITY, capacity_custom: false },
        {
            key: '2',
            user_id: 2,
            name: 'Beto',
            email: null,
            member: true,
            capacity: { hours_per_day: 4, work_days: [1, 2, 3], records_per_week: 5 },
            capacity_custom: true,
        },
        { key: WORKLOAD_UNASSIGNED, user_id: null, name: 'Sin asignar', email: null, member: false, capacity: WORKLOAD_DEFAULT_CAPACITY, capacity_custom: false },
    ];
    const opts = { metric: 'estimate' as const, from: '2026-10-26', to: '2026-11-01', zoom: 'day' as const };

    it('grilla, totales por persona y del equipo (sin asignar aparte)', () => {
        const items = [
            { person: '1', load: workloadItemLoad({ start: '2026-10-26', end: '2026-10-30', estimate_minutes: 600 }, 'estimate', MON_FRI, opts.from, opts.to, 'day') },
            { person: '1', load: workloadItemLoad({ start: '2026-10-26', end: null, estimate_minutes: 360 }, 'estimate', MON_FRI, opts.from, opts.to, 'day') },
            { person: WORKLOAD_UNASSIGNED, load: { '2026-10-27': 30 } },
        ];
        const r = summarizeWorkload(items, people, opts);
        expect(r.grid['1']!['2026-10-26']).toBeCloseTo(480);
        expect(r.totals['1']).toEqual({ value: 960, capacity: 2400, records: 2 });
        expect(r.totals['2']!.capacity).toBe(3 * 4 * 60);
        expect(r.team).toEqual({ value: 960, capacity: 2400 + 720, records: 2, unassigned: 30 });
    });

    it('reasignar mueve la carga con los días hábiles de la persona nueva', () => {
        const item = { start: '2026-10-26', end: '2026-10-30', estimate_minutes: 600 };
        const load = workloadItemLoad(item, 'estimate', MON_FRI, opts.from, opts.to, 'day');
        const base = summarizeWorkload([{ person: '1', load }], people, opts);
        const bundle: WorkloadBundle = {
            meta: {
                from: opts.from,
                to: opts.to,
                zoom: 'day',
                metric: 'estimate',
                time_zone: 'UTC',
                person_field_id: 5,
                start_field_id: 6,
                end_field_id: 7,
                estimate_field_id: 8,
                estimate_unit_minutes: 60,
                hide_done: true,
                truncated: false,
                items_truncated: false,
                total_records: 1,
            },
            people,
            ...base,
            unscheduled: {},
            items: [{ id: 10, title: 'Diseño', person: '1', person_value: 1, done: false, editable: true, ...item, load }],
        };
        const moved = reassignWorkloadItem(bundle, 10, '2', 2);
        // Beto trabaja lunes a miércoles: 600 min en 3 días hábiles.
        expect(moved.grid['2']!['2026-10-26']).toBeCloseTo(200);
        expect(moved.grid['2']!['2026-10-30']).toBeUndefined();
        expect(moved.grid['1']).toEqual({});
        expect(moved.totals['1']).toMatchObject({ value: 0, records: 0 });
        expect(moved.totals['2']!.value).toBeCloseTo(600);
        expect(moved.items[0]).toMatchObject({ person: '2', person_value: 2 });
        // Y a «Sin asignar» sale del equipo.
        const out = reassignWorkloadItem(moved, 10, WORKLOAD_UNASSIGNED, null);
        expect(out.team.value).toBeCloseTo(0);
        expect(out.team.unassigned).toBeCloseTo(600);
    });
});
