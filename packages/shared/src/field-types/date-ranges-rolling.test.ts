import { describe, expect, it } from 'vitest';

import { pickSwitchCase, switchCaseLabel, switchIssues } from '../schemas/automation-control';
import { conditionRuleText, describeStopUnless } from '../schemas/automation-steps';
import { cleanDocItemsFilter } from '../schemas/document-items-filter';
import { evaluateConditionOp, evaluateFilterCondition } from './conditions';
import {
    dateRangeBoundsText,
    normalizeRelativeDateValue,
    parseRollingDateRange,
    presetDateRange,
    relativeDateConditionText,
    relativeDateLabel,
    relativeDateValueIssue,
    relativeRangeFor,
    rollingDateDays,
    rollingDateLabel,
} from './date-ranges';

/** v0.1.469 — «cualquier cantidad de días» en los filtros de fecha. */

const utc = (iso: string) => ({ now: new Date(iso), timeZone: 'UTC' });
const dmy = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

describe('parseRollingDateRange', () => {
    it('lee {days, dir} y normaliza N como texto de dígitos', () => {
        expect(parseRollingDateRange({ days: 10, dir: 'next' })).toEqual({ days: 10, dir: 'next' });
        expect(parseRollingDateRange({ days: '45', dir: 'before' })).toEqual({ days: 45, dir: 'before' });
        expect(parseRollingDateRange({ days: 1, dir: 'last' })).toEqual({ days: 1, dir: 'last' });
        expect(parseRollingDateRange({ days: 3650, dir: 'after' })).toEqual({ days: 3650, dir: 'after' });
    });

    it('no es de esta forma: null (un preset, un rango fijo, otra cosa)', () => {
        expect(parseRollingDateRange('this_month')).toBeNull();
        expect(parseRollingDateRange({ from: '2026-01-01', to: '2026-01-31' })).toBeNull();
        expect(parseRollingDateRange(null)).toBeNull();
        expect(parseRollingDateRange([10, 'next'])).toBeNull();
    });

    it('la forma pero un valor que no sirve: invalid', () => {
        for (const bad of [
            { days: 0, dir: 'next' },
            { days: 3651, dir: 'next' },
            { days: -3, dir: 'last' },
            { days: 2.5, dir: 'next' },
            { days: 'diez', dir: 'next' },
            { days: 10, dir: 'ayer' },
            { days: 10 },
            { dir: 'next' },
        ]) {
            expect(parseRollingDateRange(bad)).toBe('invalid');
        }
    });
});

describe('rollingDateDays — los bordes', () => {
    const today = '2026-11-26';
    it('próximos N días: de hoy a hoy+N−1 (= next_7_days con N=7)', () => {
        expect(rollingDateDays({ days: 10, dir: 'next' }, today)).toEqual({ from: '2026-11-26', to: '2026-12-05' });
        expect(rollingDateDays({ days: 1, dir: 'next' }, today)).toEqual({ from: today, to: today });
        expect(rollingDateDays({ days: 7, dir: 'next' }, today)).toEqual(presetDateRange('next_7_days', 'date', utc('2026-11-26T12:00:00Z')));
        expect(rollingDateDays({ days: 30, dir: 'next' }, today)).toEqual(presetDateRange('next_30_days', 'date', utc('2026-11-26T12:00:00Z')));
    });

    it('últimos N días: de hoy−N+1 a hoy (= last_7_days)', () => {
        expect(rollingDateDays({ days: 10, dir: 'last' }, today)).toEqual({ from: '2026-11-17', to: today });
        expect(rollingDateDays({ days: 7, dir: 'last' }, today)).toEqual(presetDateRange('last_7_days', 'date', utc('2026-11-26T12:00:00Z')));
        expect(rollingDateDays({ days: 90, dir: 'last' }, today)).toEqual(presetDateRange('last_90_days', 'date', utc('2026-11-26T12:00:00Z')));
    });

    it('hace más de N días: hace exactamente N días NO entra', () => {
        const r = rollingDateDays({ days: 45, dir: 'before' }, today);
        // hoy − 45 = 12-oct; el último día que entra es el 11-oct.
        expect(r.to).toBe('2026-10-11');
        expect(r.from).toBe('1900-01-01');
    });

    it('dentro de más de N días: después de hoy+N', () => {
        const r = rollingDateDays({ days: 30, dir: 'after' }, today);
        // hoy + 30 = 26-dic (no entra); el primero que entra es el 27-dic.
        expect(r.from).toBe('2026-12-27');
        expect(r.to).toBe('2999-12-31');
    });

    it('cambio de mes y de año', () => {
        expect(rollingDateDays({ days: 10, dir: 'next' }, '2026-12-28')).toEqual({ from: '2026-12-28', to: '2027-01-06' });
        expect(rollingDateDays({ days: 5, dir: 'last' }, '2027-01-02')).toEqual({ from: '2026-12-29', to: '2027-01-02' });
        expect(rollingDateDays({ days: 2, dir: 'before' }, '2028-03-01').to).toBe('2028-02-27'); // año bisiesto
        expect(rollingDateDays({ days: 1, dir: 'after' }, '2026-02-27').from).toBe('2026-03-01');
    });
});

describe('relativeRangeFor — fecha, fecha y hora y la zona de la empresa', () => {
    it('una fecha: días de calendario en la zona de la empresa (no la del servidor)', () => {
        // 26-nov 03:00 UTC = todavía 25-nov en Bogotá (UTC-5).
        const now = new Date('2026-11-26T03:00:00Z');
        expect(relativeRangeFor({ days: 3, dir: 'next' }, 'date', { now, timeZone: 'America/Bogota' })).toEqual({ from: '2026-11-25', to: '2026-11-27' });
        expect(relativeRangeFor({ days: 3, dir: 'next' }, 'date', { now, timeZone: 'UTC' })).toEqual({ from: '2026-11-26', to: '2026-11-28' });
    });

    it('fecha y hora: los instantes de los días completos en la zona', () => {
        const now = new Date('2026-11-26T15:00:00Z');
        const r = relativeRangeFor({ days: 2, dir: 'next' }, 'datetime', { now, timeZone: 'America/Bogota' });
        // del 26-nov 00:00 Bogotá (05:00 UTC) al 27-nov 23:59:59.999 Bogotá.
        expect(r).toEqual({ from: '2026-11-26T05:00:00.000Z', to: '2026-11-28T04:59:59.999Z' });
        const before = relativeRangeFor({ days: 10, dir: 'before' }, 'datetime', { now, timeZone: 'America/Bogota' });
        // antes del 16-nov 00:00 Bogotá.
        expect(before?.to).toBe('2026-11-16T04:59:59.999Z');
    });

    it('un valor que no sirve: null', () => {
        expect(relativeRangeFor({ days: 0, dir: 'next' }, 'date', utc('2026-11-26T12:00:00Z'))).toBeNull();
        expect(relativeRangeFor('nada', 'date', utc('2026-11-26T12:00:00Z'))).toBeNull();
    });
});

describe('evaluadores — las mismas reglas que el SQL', () => {
    const opts = { now: new Date('2026-11-26T12:00:00Z'), timeZone: 'UTC' };

    it('filtros de la tabla (colores condicionales)', () => {
        const at = (value: unknown) => ({ type: 'date', value });
        const next10 = { op: 'between_relative', value: { days: 10, dir: 'next' } };
        expect(evaluateFilterCondition(next10, at('2026-11-26'), opts)).toBe(true);
        expect(evaluateFilterCondition(next10, at('2026-12-05'), opts)).toBe(true);
        expect(evaluateFilterCondition(next10, at('2026-12-06'), opts)).toBe(false);
        expect(evaluateFilterCondition(next10, at('2026-11-25'), opts)).toBe(false);
        const old30 = { op: 'between_relative', value: { days: 30, dir: 'before' } };
        expect(evaluateFilterCondition(old30, at('2026-10-27'), opts)).toBe(false); // hace exactamente 30
        expect(evaluateFilterCondition(old30, at('2026-10-26'), opts)).toBe(true);
        expect(evaluateFilterCondition(old30, at(null), opts)).toBe(false);
    });

    it('condiciones de las automatizaciones (por slug) y fecha y hora', () => {
        expect(evaluateConditionOp('2026-12-01', 'between_relative', { days: 10, dir: 'next' }, opts)).toBe(true);
        expect(evaluateConditionOp('2026-12-01T10:00:00Z', 'between_relative', { days: 10, dir: 'next' }, opts)).toBe(true);
        expect(evaluateConditionOp('2026-12-27', 'between_relative', { days: 30, dir: 'after' }, opts)).toBe(true);
        expect(evaluateConditionOp('2026-12-26', 'between_relative', { days: 30, dir: 'after' }, opts)).toBe(false);
        // un valor que no sirve nunca se cumple
        expect(evaluateConditionOp('2026-12-01', 'between_relative', { days: 0, dir: 'next' }, opts)).toBe(false);
    });

    it('«Según el valor de…»: una rama por rango de fechas', () => {
        const cases = [
            { label: '', op: 'between_relative' as const, value: { days: 7, dir: 'next' }, actions: [] },
            { label: '', op: 'between_relative' as const, value: { days: 30, dir: 'before' }, actions: [] },
        ];
        expect(pickSwitchCase(cases, '2026-11-29', opts).index).toBe(0);
        expect(pickSwitchCase(cases, '2026-09-01', opts).index).toBe(1);
        expect(pickSwitchCase(cases, '2026-11-20', opts).index).toBe(-1);
        expect(switchCaseLabel(cases[0]!, 0)).toBe('Próximos 7 días');
        expect(switchCaseLabel(cases[1]!, 1)).toBe('Hace más de 30 días');
        expect(switchIssues({ source_field_id: 3, cases: [{ op: 'between_relative', value: { days: 0, dir: 'next' }, actions: [] }] }, 'a')).toEqual([
            expect.objectContaining({ path: 'a.config.cases.0.value' }),
        ]);
        expect(switchIssues({ source_field_id: 3, cases }, 'a')).toEqual([]);
    });
});

describe('en palabras', () => {
    it('etiquetas', () => {
        expect(rollingDateLabel({ days: 10, dir: 'next' })).toBe('Próximos 10 días');
        expect(rollingDateLabel({ days: 1, dir: 'next' })).toBe('Próximo 1 día');
        expect(rollingDateLabel({ days: 45, dir: 'before' })).toBe('Hace más de 45 días');
        expect(rollingDateLabel({ days: 1, dir: 'after' })).toBe('Dentro de más de 1 día');
        expect(relativeDateLabel('this_month')).toBe('Este mes');
        expect(relativeDateLabel({ from: '2026-11-01', to: '2026-11-30' }, dmy)).toBe('Del 01/11/2026 al 30/11/2026');
        expect(relativeDateLabel({ days: 0, dir: 'next' })).toBeNull();
    });

    it('qué abarca: con principio y fin, abierto hacia atrás y hacia adelante', () => {
        expect(dateRangeBoundsText({ from: '2026-11-26', to: '2026-12-05' }, dmy)).toBe('del 26/11/2026 al 05/12/2026');
        expect(dateRangeBoundsText(rollingDateDays({ days: 45, dir: 'before' }, '2026-11-26'), dmy)).toBe('antes del 12/10/2026');
        expect(dateRangeBoundsText(rollingDateDays({ days: 30, dir: 'after' }, '2026-11-26'), dmy)).toBe('desde el 27/12/2026');
        expect(dateRangeBoundsText({ from: '2026-11-26', to: '2026-11-26' }, dmy)).toBe('el 26/11/2026');
    });

    it('condiciones (resúmenes de las automatizaciones y del historial)', () => {
        expect(relativeDateConditionText('Vence', { days: 10, dir: 'next' })).toBe('«Vence» está en los próximos 10 días');
        expect(relativeDateConditionText('Último contacto', { days: 45, dir: 'before' })).toBe('«Último contacto» fue hace más de 45 días');
        expect(relativeDateConditionText('Entrega', { days: 30, dir: 'after' })).toBe('«Entrega» es dentro de más de 30 días');
        expect(relativeDateConditionText('Fecha', 'this_month')).toBe('«Fecha» está en «Este mes»');
        expect(conditionRuleText('Vence', 'between_relative', '[object]', { days: 3, dir: 'last' })).toBe('«Vence» está en los últimos 3 días');
        expect(conditionRuleText('Monto', 'gt', '100')).toBe('«Monto» es mayor que «100»');
        expect(describeStopUnless([{ label: 'Vence', op: 'between_relative', valueText: '', value: { days: 10, dir: 'next' } }])).toBe(
            'Sigue sólo si «Vence» está en los próximos 10 días; si no, se detiene',
        );
    });

    it('normalizar y explicar lo que no sirve', () => {
        expect(normalizeRelativeDateValue({ days: '10', dir: 'next' })).toEqual({ days: 10, dir: 'next' });
        expect(normalizeRelativeDateValue('next_7_days')).toBe('next_7_days');
        expect(normalizeRelativeDateValue({ from: '2026-02-10', to: '2026-02-01' })).toEqual({ from: '2026-02-01', to: '2026-02-10' });
        expect(normalizeRelativeDateValue({ days: 0, dir: 'next' })).toBeNull();
        expect(relativeDateValueIssue({ days: 10, dir: 'next' })).toBeNull();
        expect(relativeDateValueIssue({ days: 5000, dir: 'next' })).toMatch(/1 a 3650/);
        expect(relativeDateValueIssue('pasado_mañana')).toMatch(/preset/);
    });
});

describe('filtro de ítems de los PDF', () => {
    const fields = [{ id: 7, slug: 'vence', label: 'Vence', type: 'date', config: {} }];
    it('acepta {days, dir} y descarta un N que no sirve con su motivo', () => {
        const ok = cleanDocItemsFilter(
            { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 7, op: 'between_relative', value: { days: '10', dir: 'next' } }] },
            fields,
        );
        expect(ok.tree?.children).toEqual([{ type: 'condition', field_id: 7, op: 'between_relative', value: { days: 10, dir: 'next' } }]);
        expect(ok.issues).toEqual([]);
        const bad = cleanDocItemsFilter(
            { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 7, op: 'between_relative', value: { days: 0, dir: 'next' } }] },
            fields,
        );
        expect(bad.tree).toBeNull();
        expect(bad.issues.map((i) => i.message).join(' ')).toMatch(/cantidad de días de 1 a 3650/);
    });
});
