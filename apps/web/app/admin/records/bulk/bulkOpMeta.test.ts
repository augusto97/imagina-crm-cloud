import { describe, expect, it } from 'vitest';

import { draftToOperation, parseNumberInput } from './bulkOpMeta';

describe('parseNumberInput', () => {
    it('respeta los separadores de la empresa', () => {
        expect(parseNumberInput('12.500', 'dot_comma')).toBe(12_500);
        expect(parseNumberInput('12,5', 'dot_comma')).toBe(12.5);
        expect(parseNumberInput('1.234.567,89', 'dot_comma')).toBe(1_234_567.89);
        // Un punto que no agrupa de a tres es decimal aunque la empresa use coma.
        expect(parseNumberInput('0.5', 'dot_comma')).toBe(0.5);
        expect(parseNumberInput('12,500', 'comma_dot')).toBe(12_500);
        expect(parseNumberInput('12.5', 'comma_dot')).toBe(12.5);
        expect(parseNumberInput('-3', 'comma_dot')).toBe(-3);
        expect(parseNumberInput('$ 25.000', 'dot_comma')).toBe(25_000);
        expect(parseNumberInput('', 'comma_dot')).toBeNull();
        expect(parseNumberInput('abc', 'comma_dot')).toBeNull();
    });
});

describe('draftToOperation', () => {
    it('porcentaje: el selector decide el signo', () => {
        const up = draftToOperation({ key: 'a', field_id: 1, op: 'percent', amount: '10', mode: 'up' }, 'comma_dot');
        expect(up).toEqual({ ok: true, operation: { op: 'percent', field_id: 1, percent: 10 } });
        const down = draftToOperation({ key: 'a', field_id: 1, op: 'percent', amount: '15', mode: 'down' }, 'comma_dot');
        expect(down.ok && down.operation).toEqual({ op: 'percent', field_id: 1, percent: -15 });
    });

    it('redondeo con ajuste, calc con columna y número', () => {
        const r = draftToOperation({ key: 'a', field_id: 1, op: 'round', amount: '1.000', mode: 'up', adjust: '-100' }, 'dot_comma');
        expect(r.ok && r.operation).toEqual({ op: 'round', field_id: 1, multiple: 1000, mode: 'up', adjust: -100 });
        const c = draftToOperation(
            { key: 'a', field_id: 1, op: 'calc', left: { field_id: 2 }, right: { value: '1,3' }, operator: '*' },
            'dot_comma',
        );
        expect(c.ok && c.operation).toEqual({ op: 'calc', field_id: 1, left: { field_id: 2 }, operator: '*', right: { value: 1.3 } });
    });

    it('explica lo que falta', () => {
        expect(draftToOperation({ key: 'a', field_id: null, op: null })).toMatchObject({ ok: false });
        expect(draftToOperation({ key: 'a', field_id: 1, op: 'add', amount: '' }, 'comma_dot')).toMatchObject({ ok: false });
        expect(draftToOperation({ key: 'a', field_id: 1, op: 'add_options', values: [] })).toMatchObject({ ok: false });
        expect(draftToOperation({ key: 'a', field_id: 1, op: 'divide', amount: '0' }, 'comma_dot')).toMatchObject({ ok: false });
    });

    it('correr fecha hacia atrás', () => {
        const r = draftToOperation({ key: 'a', field_id: 1, op: 'shift_date', amount: '3', unit: 'months', mode: 'back' }, 'comma_dot');
        expect(r.ok && r.operation).toEqual({ op: 'shift_date', field_id: 1, amount: -3, unit: 'months' });
    });
});
