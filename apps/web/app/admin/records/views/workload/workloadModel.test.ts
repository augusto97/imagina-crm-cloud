import { describe, expect, it } from 'vitest';
import { WORKLOAD_DEFAULT_CAPACITY, WORKLOAD_UNASSIGNED, workloadBuckets, type WorkloadBundle } from '@imagina-base/shared';

import { workloadBundleParams } from '@/hooks/useWorkload';

import { bucketLabel, cellState, formatUsage, formatWorkloadValue, initials, rangeLabel, usagePercent, workDaysLabel } from './workloadModel';

describe('Carga de trabajo — presentación', () => {
    it('registros enteros y horas con un decimal (minutos si es menos de una hora)', () => {
        expect(formatWorkloadValue(3, 'count')).toBe('3');
        expect(formatWorkloadValue(480, 'estimate')).toBe('8 h');
        expect(formatWorkloadValue(390, 'time')).toBe('6.5 h');
        expect(formatWorkloadValue(45, 'estimate')).toBe('45 min');
        expect(formatWorkloadValue(0, 'estimate')).toBe('0 h');
        expect(formatUsage(360, 480, 'estimate')).toBe('6 h de 8 h');
        expect(formatUsage(3, 10, 'count')).toBe('3 de 10 registros');
        expect(usagePercent(600, 480)).toBe(125);
        expect(usagePercent(60, 0)).toBe(999);
    });

    it('etiquetas de columnas y del rango', () => {
        expect(bucketLabel({ key: '2026-10-26', start: '2026-10-26' }, 'day')).toEqual({ top: 'lu', bottom: '26' });
        expect(bucketLabel({ key: '2026-10-26', start: '2026-10-26' }, 'week')).toEqual({ top: 'Semana', bottom: '26 oct' });
        expect(bucketLabel({ key: '2026-10-01', start: '2026-10-01' }, 'month')).toEqual({ top: '2026', bottom: 'oct' });
        expect(rangeLabel('2026-10-26', '2026-11-08')).toBe('26 oct – 8 nov 2026');
        expect(rangeLabel('2026-12-28', '2027-01-10')).toBe('28 dic 2026 – 10 ene 2027');
        expect(initials('Ana María Pérez')).toBe('AP');
        expect(workDaysLabel([5, 1, 2, 3, 4])).toBe('lunes a viernes');
        expect(workDaysLabel([1, 3, 5])).toBe('lunes, miércoles y viernes');
        expect(workDaysLabel([])).toBe('ningún día');
    });

    it('estado de una celda: capacidad del período y nivel; «Sin asignar» no tiene capacidad', () => {
        const [day] = workloadBuckets('2026-10-28', '2026-10-28', 'day');
        const bundle = {
            meta: { metric: 'estimate' } as WorkloadBundle['meta'],
            grid: { '7': { '2026-10-28': 600 }, [WORKLOAD_UNASSIGNED]: { '2026-10-28': 30 } },
        } as Pick<WorkloadBundle, 'grid' | 'meta'>;
        expect(cellState(bundle, { key: '7', capacity: WORKLOAD_DEFAULT_CAPACITY }, day!, WORKLOAD_UNASSIGNED)).toEqual({ value: 600, capacity: 480, level: 'over' });
        expect(cellState(bundle, { key: WORKLOAD_UNASSIGNED, capacity: WORKLOAD_DEFAULT_CAPACITY }, day!, WORKLOAD_UNASSIGNED)).toEqual({ value: 30, capacity: 0, level: 'ok' });
        expect(cellState(bundle, { key: '8', capacity: WORKLOAD_DEFAULT_CAPACITY }, day!, WORKLOAD_UNASSIGNED).level).toBe('empty');
    });

    it('parámetros del bundle estables (personas ordenadas, sin estimación fuera de «Esfuerzo»)', () => {
        const base = {
            listId: 3,
            from: '2026-10-26',
            to: '2026-11-08',
            zoom: 'day' as const,
            metric: 'count' as const,
            personFieldId: 5,
            startFieldId: 6,
            endFieldId: null,
            estimateFieldId: 9,
            estimateUnit: 'hours' as const,
            hideDone: true,
            userIds: [7, 3],
            showUnassigned: false,
        };
        expect(workloadBundleParams(base)).toEqual({
            from: '2026-10-26',
            to: '2026-11-08',
            zoom: 'day',
            metric: 'count',
            person_field_id: 5,
            hide_done: 1,
            start_field_id: 6,
            users: '3,7',
            unassigned: 0,
        });
        expect(workloadBundleParams({ ...base, metric: 'estimate', userIds: null, showUnassigned: true, search: ' web ' })).toMatchObject({
            estimate_field_id: 9,
            unit: 'hours',
            search: 'web',
        });
        // C1 — el equipo viaja como `team` (lo resuelve el servidor).
        expect(workloadBundleParams({ ...base, teamId: 4 })).toMatchObject({ team: 4 });
        expect(workloadBundleParams({ ...base, teamId: null })).not.toHaveProperty('team');
    });
});
