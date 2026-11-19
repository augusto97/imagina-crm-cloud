import { describe, expect, it } from 'vitest';

import {
    alignComparedSeries,
    bucketKeyOf,
    bucketKeysInRange,
    compareDelta,
    compareLabels,
    comparisonWindows,
    effectiveCompare,
    formatDeltaPct,
    formatYmdRange,
    parseCompareOverride,
    readCompareConfig,
    shiftMonthsClamp,
} from './compare';
import { resolveStageProbabilities, stageKind, suggestStageProbabilities, weightForecast } from './forecast';

const prev = { mode: 'previous' as const, to_date: true };
const prevFull = { mode: 'previous' as const, to_date: false };
const lastYear = { mode: 'last_year' as const, to_date: true };

describe('comparisonWindows — período anterior', () => {
    it('un mes completo se corre UN mes aunque tengan distinto largo', () => {
        const w = comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, prevFull, { today: '2026-12-05' })!;
        expect(w.previous).toEqual({ from: '2026-10-01', to: '2026-10-31' });
        expect(w.previousToDate).toBeNull();
        expect(w.shift).toBe('months');
    });

    it('marzo → febrero (bisiesto y no bisiesto)', () => {
        expect(comparisonWindows({ from: '2028-03-01', to: '2028-03-31' }, prevFull, { today: '2028-05-01' })!.previous).toEqual({ from: '2028-02-01', to: '2028-02-29' });
        expect(comparisonWindows({ from: '2027-03-01', to: '2027-03-31' }, prevFull, { today: '2027-05-01' })!.previous).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    });

    it('un trimestre se corre tres meses y un año, doce', () => {
        expect(comparisonWindows({ from: '2026-10-01', to: '2026-12-31' }, prevFull, { today: '2027-01-02' })!.previous).toEqual({ from: '2026-07-01', to: '2026-09-30' });
        expect(comparisonWindows({ from: '2026-01-01', to: '2026-12-31' }, prevFull, { today: '2027-01-02' })!.previous).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    });

    it('una ventana de días se corre su largo', () => {
        const w = comparisonWindows({ from: '2026-11-13', to: '2026-11-19' }, prev, { today: '2026-11-19', preset: 'last_7_days' })!;
        expect(w.previous).toEqual({ from: '2026-11-06', to: '2026-11-12' });
        // Termina hoy: no hay nada que cortar.
        expect(w.previousToDate).toBeNull();
        expect(w.shift).toBe('days');
    });

    it('«hasta el mismo día»: hoy es 19 → el 1–19 del mes anterior', () => {
        const w = comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, prev, { today: '2026-11-19', preset: 'this_month' })!;
        expect(w.previous).toEqual({ from: '2026-10-01', to: '2026-10-31' });
        expect(w.previousToDate).toEqual({ from: '2026-10-01', to: '2026-10-19' });
    });

    it('«hasta el mismo día» con el día recortado (31 de marzo → 28 de febrero)', () => {
        const w = comparisonWindows({ from: '2027-03-01', to: '2027-03-31' }, prev, { today: '2027-03-30', preset: 'this_month' })!;
        expect(w.previousToDate).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    });

    it('«hasta el mismo día» en un trimestre y en una semana', () => {
        const q = comparisonWindows({ from: '2026-10-01', to: '2026-12-31' }, prev, { today: '2026-11-19', preset: 'this_quarter' })!;
        expect(q.previousToDate).toEqual({ from: '2026-07-01', to: '2026-08-19' });
        // Semana del lunes 16 al domingo 22; hoy jueves 19 → lunes 9 a jueves 12.
        const w = comparisonWindows({ from: '2026-11-16', to: '2026-11-22' }, prev, { today: '2026-11-19', preset: 'this_week' })!;
        expect(w.previous).toEqual({ from: '2026-11-09', to: '2026-11-15' });
        expect(w.previousToDate).toEqual({ from: '2026-11-09', to: '2026-11-12' });
    });

    it('lo que mira hacia adelante no se corta', () => {
        const w = comparisonWindows({ from: '2026-11-19', to: '2026-11-25' }, prev, { today: '2026-11-19', preset: 'next_7_days' })!;
        expect(w.previousToDate).toBeNull();
    });

    it('«de hoy en adelante» o «antes de hoy» no son ventanas', () => {
        expect(comparisonWindows({ from: '2026-11-19', to: '2999-12-31' }, prev, { today: '2026-11-19' })).toBeNull();
        expect(comparisonWindows({ from: '1900-01-01', to: '2026-11-18' }, prev, { today: '2026-11-19' })).toBeNull();
    });
});

describe('comparisonWindows — mismo período del año pasado', () => {
    it('febrero de un año bisiesto se compara con el febrero completo del anterior', () => {
        const w = comparisonWindows({ from: '2028-02-01', to: '2028-02-29' }, { ...lastYear, to_date: false }, { today: '2028-05-01' })!;
        expect(w.previous).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    });

    it('el 29 de febrero cae el 28', () => {
        const w = comparisonWindows({ from: '2028-02-29', to: '2028-02-29' }, lastYear, { today: '2028-03-01', preset: 'yesterday' })!;
        expect(w.previous).toEqual({ from: '2027-02-28', to: '2027-02-28' });
    });

    it('hasta el mismo día del año pasado', () => {
        const w = comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, lastYear, { today: '2026-11-19', preset: 'this_month' })!;
        expect(w.previous).toEqual({ from: '2025-11-01', to: '2025-11-30' });
        expect(w.previousToDate).toEqual({ from: '2025-11-01', to: '2025-11-19' });
    });
});

describe('comparisonWindows — rango elegido', () => {
    it('compara con el rango elegido, sin cortes', () => {
        const spec = readCompareConfig({ mode: 'custom', from: '2026-01-15', to: '2026-01-01' })!;
        expect(spec).toEqual({ mode: 'custom', from: '2026-01-01', to: '2026-01-15', to_date: false });
        const w = comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, spec, { today: '2026-11-19' })!;
        expect(w.previous).toEqual({ from: '2026-01-01', to: '2026-01-15' });
        expect(w.previousToDate).toBeNull();
    });

    it('un rango con una fecha que no existe se ignora', () => {
        expect(readCompareConfig({ mode: 'custom', from: '2026-02-30', to: '2026-03-01' })).toBeNull();
    });
});

describe('lectura de la configuración', () => {
    it('tolera basura y entiende la comparación del tablero', () => {
        expect(readCompareConfig(null)).toBeNull();
        expect(readCompareConfig({ mode: 'bogus' })).toBeNull();
        expect(readCompareConfig({ mode: 'previous' })).toEqual({ mode: 'previous', to_date: true });
        expect(parseCompareOverride('')).toBeNull();
        expect(parseCompareOverride('none')).toBe('none');
        expect(parseCompareOverride('last_year')).toEqual({ mode: 'last_year', to_date: true });
        expect(parseCompareOverride('custom:2026-01-01:2026-01-31')).toEqual({ mode: 'custom', from: '2026-01-01', to: '2026-01-31', to_date: false });
        expect(parseCompareOverride('drop table')).toBeUndefined();
    });

    it('la del tablero pisa la del widget pero respeta su «hasta el mismo día»', () => {
        expect(effectiveCompare({ compare: { mode: 'previous', to_date: false } }, { mode: 'last_year', to_date: true })).toEqual({ mode: 'last_year', to_date: false });
        expect(effectiveCompare({ compare: { mode: 'previous' } }, 'none')).toBeNull();
        expect(effectiveCompare({ compare: { mode: 'previous' } }, null)).toEqual({ mode: 'previous', to_date: true });
    });
});

describe('etiquetas', () => {
    it('dice qué se compara con qué', () => {
        const w = comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, prev, { today: '2026-11-19', preset: 'this_month' })!;
        const l = compareLabels(prev, w, 'this_month');
        expect(l.label).toBe('Este mes vs. mes anterior');
        expect(l.short).toBe('vs. mes anterior');
        expect(l.detail).toBe('1–19 nov 2026 vs. 1–19 oct 2026');
        const y = comparisonWindows({ from: '2026-01-01', to: '2026-12-31' }, lastYear, { today: '2026-11-19', preset: 'this_year' })!;
        expect(compareLabels(lastYear, y, 'this_year').label).toBe('2026 vs. 2025');
        const m = comparisonWindows({ from: '2026-11-01', to: '2026-11-30' }, lastYear, { today: '2026-11-19', preset: 'this_month' })!;
        expect(compareLabels(lastYear, m, 'this_month').label).toBe('Noviembre 2026 vs. noviembre 2025');
        const d = comparisonWindows({ from: '2026-11-13', to: '2026-11-19' }, prev, { today: '2026-11-19', preset: 'last_7_days' })!;
        expect(compareLabels(prev, d, 'last_7_days').label).toBe('Últimos 7 días vs. los 7 anteriores');
    });

    it('rangos legibles', () => {
        expect(formatYmdRange({ from: '2026-11-01', to: '2026-11-19' })).toBe('1–19 nov 2026');
        expect(formatYmdRange({ from: '2026-10-01', to: '2026-11-15' })).toBe('1 oct – 15 nov 2026');
        expect(formatYmdRange({ from: '2025-12-28', to: '2026-01-03' })).toBe('28 dic 2025 – 3 ene 2026');
        expect(formatYmdRange({ from: '2026-01-01', to: '2026-12-31' })).toBe('2026');
        expect(formatYmdRange({ from: '2026-07-01', to: '2026-09-30' })).toBe('jul – sept 2026');
    });
});

describe('variación', () => {
    it('porcentaje, dirección y tono', () => {
        expect(compareDelta(112, 100)).toEqual({ pct: 12, diff: 12, direction: 'up', tone: 'good' });
        expect(compareDelta(90, 100, true)).toEqual({ pct: -10, diff: -10, direction: 'down', tone: 'good' });
        expect(compareDelta(5, 0)!.pct).toBeNull();
        expect(compareDelta(0, 0)!.direction).toBe('flat');
        expect(compareDelta(null, 3)).toBeNull();
        expect(formatDeltaPct(compareDelta(112, 100))).toBe('+12 %');
        expect(formatDeltaPct(compareDelta(96.5, 100), 'dot_comma')).toBe('−3,5 %');
        expect(formatDeltaPct(compareDelta(5, 0))).toBe('Nuevo');
    });
});

describe('series de tiempo alineadas por posición', () => {
    it('claves de bucket iguales a las del SQL', () => {
        expect(bucketKeyOf('2026-11-19', 'week')).toBe('2026-W47');
        expect(bucketKeyOf('2027-01-01', 'week')).toBe('2026-W53');
        expect(bucketKeyOf('2026-11-19', 'quarter')).toBe('2026-Q4');
        expect(bucketKeysInRange({ from: '2026-10-01', to: '2026-12-31' }, 'month')).toEqual(['2026-10', '2026-11', '2026-12']);
        expect(bucketKeysInRange({ from: '2026-11-01', to: '2026-11-30' }, 'day')).toHaveLength(30);
        expect(bucketKeysInRange({ from: '2026-11-04', to: '2026-11-17' }, 'week')).toEqual(['2026-W45', '2026-W46', '2026-W47']);
        expect(shiftMonthsClamp('2026-01-31', 1)).toBe('2026-02-28');
    });

    it('el día 1 con el día 1; el actual llega hasta hoy y el anterior va completo', () => {
        const currentKeys = bucketKeysInRange({ from: '2026-11-01', to: '2026-11-30' }, 'day');
        const previousKeys = bucketKeysInRange({ from: '2026-10-01', to: '2026-10-31' }, 'day');
        const points = alignComparedSeries({
            current: [{ label: '2026-11-02', value: 3 }],
            previous: [{ label: '2026-10-02', value: 5 }, { label: '2026-10-31', value: 1 }],
            currentKeys,
            previousKeys,
            todayKey: '2026-11-19',
            zeroFill: true,
        });
        expect(points).toHaveLength(31);
        expect(points[1]).toEqual({ label: '2026-11-02', prev_label: '2026-10-02', value: 3, previous: 5 });
        expect(points[18]!.label).toBe('2026-11-19');
        expect(points[19]!.label).toBeNull();
        expect(points[30]).toEqual({ label: null, prev_label: '2026-10-31', value: null, previous: 1 });
    });

    it('con fechas futuras el actual llega hasta su último dato; sin cero, null', () => {
        const points = alignComparedSeries({
            current: [{ label: '2026-12', value: 7 }],
            previous: [],
            currentKeys: ['2026-10', '2026-11', '2026-12'],
            previousKeys: ['2026-07', '2026-08', '2026-09'],
            todayKey: '2026-11',
            zeroFill: false,
        });
        expect(points.map((p) => p.value)).toEqual([null, null, 7]);
        expect(points.map((p) => p.previous)).toEqual([null, null, null]);
    });
});

describe('pronóstico', () => {
    const stages = [
        { value: 'nuevo', label: 'Nuevo' },
        { value: 'calificado', label: 'Calificado' },
        { value: 'propuesta', label: 'Propuesta enviada' },
        { value: 'negociacion', label: 'Negociación' },
        { value: 'ganado', label: 'Ganado' },
        { value: 'perdido', label: 'Cerrado perdido' },
    ];

    it('sugiere por el nombre: ganado 100, perdido 0, las abiertas repartidas', () => {
        expect(stageKind({ value: 'x', label: 'Organizar evento' })).toBe('open');
        expect(suggestStageProbabilities(stages)).toEqual({ nuevo: 20, calificado: 40, propuesta: 60, negociacion: 80, ganado: 100, perdido: 0 });
        expect(resolveStageProbabilities(stages, { propuesta: 50, raro: 'x', ganado: 140 })).toMatchObject({ propuesta: 50, ganado: 100 });
    });

    it('pondera: monto × probabilidad, ganado entero, perdido fuera', () => {
        const p = { nuevo: 10, propuesta: 50, ganado: 100, perdido: 0 };
        const r = weightForecast([
            { bucket: '2026-11', stage: 'nuevo', amount: 1000 },
            { bucket: '2026-11', stage: 'propuesta', amount: 400 },
            { bucket: '2026-11', stage: 'ganado', amount: 300 },
            { bucket: '2026-12', stage: 'perdido', amount: 900 },
            { bucket: '2026-12', stage: 'propuesta', amount: 200 },
            { bucket: null, stage: 'propuesta', amount: 100 },
            { bucket: '2026-12', stage: null, amount: 50 },
        ], p);
        // Nov: abierto 1400, ponderado 100 + 200 = 300, ganado 300 → pronóstico 600.
        expect(r.buckets[0]).toEqual({ key: '2026-11', won: 300, weighted: 300, open: 1400, lost: 0, forecast: 600, unassigned: 0 });
        expect(r.buckets[1]).toEqual({ key: '2026-12', won: 0, weighted: 100, open: 200, lost: 900, forecast: 100, unassigned: 50 });
        expect(r.buckets[2]!.key).toBe('');
        expect(r.totals).toEqual({ won: 300, weighted: 450, open: 1700, lost: 900, forecast: 750, unassigned: 50 });
    });
});
