import { describe, expect, it } from 'vitest';
import { evaluateComputed, type ComputedFieldLike } from './computed';

const f = (id: number, type: string, config: Record<string, unknown> = {}): ComputedFieldLike => ({
    id,
    type,
    config,
});

describe('evaluateComputed (paridad ComputedFieldEvaluator del plugin)', () => {
    const values: Record<number, unknown> = {
        1: 10,
        2: 4,
        3: '2026-01-15',
        4: '2026-07-11',
        5: 'Hola',
        6: 'Mundo',
        7: '',
    };
    const getValue = (id: number) => values[id] ?? null;

    it('sum/product/subtract/divide/abs con nulls y strings numéricos', () => {
        const fields = [f(1, 'number'), f(2, 'number'), f(7, 'text')];
        expect(evaluateComputed(f(9, 'computed', { operation: 'sum', inputs: [1, 2, 7] }), fields, getValue)).toBe(14);
        expect(evaluateComputed(f(9, 'computed', { operation: 'product', inputs: [1, 2] }), fields, getValue)).toBe(40);
        expect(evaluateComputed(f(9, 'computed', { operation: 'subtract', inputs: [1, 2] }), fields, getValue)).toBe(6);
        expect(evaluateComputed(f(9, 'computed', { operation: 'divide', inputs: [1, 2] }), fields, getValue)).toBe(2.5);
        expect(evaluateComputed(f(9, 'computed', { operation: 'abs', inputs: [2] }), fields, getValue)).toBe(4);
        // División por cero → null (no throw).
        const withZero = (id: number) => (id === 2 ? 0 : values[id] ?? null);
        expect(evaluateComputed(f(9, 'computed', { operation: 'divide', inputs: [1, 2] }), fields, withZero)).toBeNull();
        // Sin inputs numéricos → null.
        expect(evaluateComputed(f(9, 'computed', { operation: 'sum', inputs: [7] }), fields, getValue)).toBeNull();
    });

    it('date_diff_months cruza años; date_diff_days hace floor', () => {
        const fields = [f(3, 'date'), f(4, 'date')];
        expect(
            evaluateComputed(f(9, 'computed', { operation: 'date_diff_months', inputs: [3, 4] }), fields, getValue),
        ).toBe(6);
        expect(
            evaluateComputed(f(9, 'computed', { operation: 'date_diff_days', inputs: [3, 4] }), fields, getValue),
        ).toBe(177);
        // dic 2025 → ene 2026 = 1 mes.
        const gv = (id: number) => (id === 3 ? '2025-12-31' : '2026-01-01');
        expect(
            evaluateComputed(f(9, 'computed', { operation: 'date_diff_months', inputs: [3, 4] }), fields, gv),
        ).toBe(1);
    });

    it('concat con separator, salteando vacíos', () => {
        const fields = [f(5, 'text'), f(6, 'text'), f(7, 'text')];
        expect(
            evaluateComputed(f(9, 'computed', { operation: 'concat', inputs: [5, 7, 6], separator: ', ' }), fields, getValue),
        ).toBe('Hola, Mundo');
    });

    it('encadenado computed→computed y guard de ciclos', () => {
        const chain = [
            f(1, 'number'),
            f(2, 'number'),
            f(10, 'computed', { operation: 'sum', inputs: [1, 2] }), // 14
            f(11, 'computed', { operation: 'product', inputs: [10, 1] }), // 140
        ];
        expect(evaluateComputed(chain[3]!, chain, getValue)).toBe(140);

        // Ciclo directo → null, sin stack overflow.
        const cyc = [
            f(20, 'computed', { operation: 'sum', inputs: [21] }),
            f(21, 'computed', { operation: 'sum', inputs: [20] }),
        ];
        expect(evaluateComputed(cyc[0]!, cyc, getValue)).toBeNull();
    });

    it('operación inválida o input inexistente → null', () => {
        const fields = [f(1, 'number')];
        expect(evaluateComputed(f(9, 'computed', { operation: 'nope', inputs: [1] }), fields, getValue)).toBeNull();
        expect(evaluateComputed(f(9, 'computed', { operation: 'sum', inputs: [999] }), fields, getValue)).toBeNull();
    });
});
