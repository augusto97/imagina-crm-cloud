import { describe, expect, it } from 'vitest';
import { evaluateCondition, evaluateFilterCondition, evaluateFilterNode, type FilterFieldValue } from './conditions';
import type { FilterNode } from '../schemas/filter';

const at = (type: string, value: unknown): FilterFieldValue => ({ type, value });

describe('evaluateFilterCondition — semántica del SQL por tipo', () => {
    it('texto: subcadena sin distinguir mayúsculas; «es» exacto; vacío', () => {
        expect(evaluateFilterCondition({ op: 'contains', value: 'ACME' }, at('text', 'Grupo Acme S.A.'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'not_contains', value: 'acme' }, at('text', 'Globex'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'not_contains', value: 'acme' }, at('text', null))).toBe(true);
        expect(evaluateFilterCondition({ op: 'starts_with', value: 'gru' }, at('text', 'Grupo'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: 'Grupo' }, at('text', 'Grupo'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'is_null' }, at('text', ''))).toBe(true);
        expect(evaluateFilterCondition({ op: 'is_not_null' }, at('text', 'x'))).toBe(true);
        // Sin valor que buscar, la condición no aplica (el SQL la descarta).
        expect(evaluateFilterCondition({ op: 'contains', value: '' }, at('text', 'x'))).toBeNull();
    });

    it('números: comparan como números (no como texto: 9 < 10)', () => {
        expect(evaluateFilterCondition({ op: 'gt', value: 10 }, at('currency', 9))).toBe(false);
        expect(evaluateFilterCondition({ op: 'lt', value: '10' }, at('number', 9))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: '1500000' }, at('currency', 1500000))).toBe(true);
        expect(evaluateFilterCondition({ op: 'gte', value: 3 }, at('rating', 4))).toBe(true);
        expect(evaluateFilterCondition({ op: 'gt', value: 'x' }, at('number', 4))).toBeNull();
    });

    it('select y persona: «es / es alguno de»', () => {
        expect(evaluateFilterCondition({ op: 'eq', value: 'pendiente' }, at('select', 'pendiente'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'in', value: ['pagada', 'vencida'] }, at('select', 'vencida'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'nin', value: ['pagada'] }, at('select', 'vencida'))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: 3 }, at('user', 3))).toBe(true);
    });

    it('multi_select: incluye, conjunto exacto con lista, alguno/ninguno', () => {
        const tags = at('multi_select', ['vip', 'promo']);
        expect(evaluateFilterCondition({ op: 'eq', value: 'vip' }, tags)).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: ['promo', 'vip'] }, tags)).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: ['vip'] }, tags)).toBe(false);
        expect(evaluateFilterCondition({ op: 'in', value: ['otro', 'promo'] }, tags)).toBe(true);
        expect(evaluateFilterCondition({ op: 'nin', value: ['otro'] }, tags)).toBe(true);
        expect(evaluateFilterCondition({ op: 'is_null' }, at('multi_select', []))).toBe(true);
    });

    it('casilla: sin valor cuenta como desmarcada', () => {
        expect(evaluateFilterCondition({ op: 'eq', value: true }, at('checkbox', true))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: false }, at('checkbox', null))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: 'true' }, at('checkbox', false))).toBe(false);
    });

    it('relación y archivos', () => {
        expect(evaluateFilterCondition({ op: 'is_null' }, at('relation', []))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: 5 }, at('relation', [4, 5]))).toBe(true);
        expect(evaluateFilterCondition({ op: 'nin', value: [5] }, at('relation', [4]))).toBe(true);
        expect(evaluateFilterCondition({ op: 'is_not_null' }, at('file', [12]))).toBe(true);
        expect(evaluateFilterCondition({ op: 'eq', value: 12 }, at('file', [12]))).toBeNull();
    });

    it('fechas: «hoy» y «este mes» en el reloj de la EMPRESA', () => {
        // 21-oct-2026 03:00 UTC = todavía 20-oct en Bogotá (UTC-5).
        const now = new Date('2026-10-21T03:00:00Z');
        const bogota = { now, timeZone: 'America/Bogota' };
        expect(evaluateFilterCondition({ op: 'between_relative', value: 'today' }, at('date', '2026-10-20'), bogota)).toBe(true);
        expect(evaluateFilterCondition({ op: 'between_relative', value: 'today' }, at('date', '2026-10-21'), bogota)).toBe(false);
        expect(evaluateFilterCondition({ op: 'between_relative', value: 'today' }, at('date', '2026-10-21'), { now, timeZone: 'UTC' })).toBe(true);
        // Un fecha-hora del 20 a las 23:30 en Bogotá es "hoy" allá.
        expect(evaluateFilterCondition({ op: 'between_relative', value: 'today' }, at('datetime', '2026-10-21T04:30:00Z'), bogota)).toBe(true);
        expect(evaluateFilterCondition({ op: 'lt', value: '2026-10-21' }, at('date', '2026-10-20'))).toBe(true);
        // «es» en un fecha-hora abarca el día entero en la zona de la empresa.
        expect(evaluateFilterCondition({ op: 'eq', value: '2026-10-20' }, at('datetime', '2026-10-21T04:30:00Z'), bogota)).toBe(true);
        expect(evaluateFilterCondition({ op: 'between_relative', value: 'nada' }, at('date', '2026-10-20'), bogota)).toBe(false);
    });

    it('campo desconocido: no aplica', () => {
        expect(evaluateFilterCondition({ op: 'eq', value: 'x' }, undefined)).toBeNull();
    });
});

describe('evaluateFilterNode — grupos AND/OR', () => {
    const row: Record<number, FilterFieldValue> = {
        1: at('select', 'pendiente'),
        2: at('currency', 120000),
        3: at('text', 'Acme'),
    };
    const fieldOf = (id: number): FilterFieldValue | undefined => row[id];

    it('AND / OR anidados', () => {
        const tree: FilterNode = {
            type: 'group',
            logic: 'and',
            children: [
                { type: 'condition', field_id: 1, op: 'eq', value: 'pendiente' },
                {
                    type: 'group',
                    logic: 'or',
                    children: [
                        { type: 'condition', field_id: 2, op: 'gt', value: 500000 },
                        { type: 'condition', field_id: 3, op: 'contains', value: 'acm' },
                    ],
                },
            ],
        };
        expect(evaluateFilterNode(tree, fieldOf)).toBe(true);
        const miss: FilterNode = { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 2, op: 'gt', value: 500000 }] };
        expect(evaluateFilterNode(miss, fieldOf)).toBe(false);
    });

    it('las condiciones que no aplican se ignoran (como el SQL)', () => {
        const tree: FilterNode = {
            type: 'group',
            logic: 'and',
            children: [
                { type: 'condition', field_id: 99, op: 'eq', value: 'x' },
                { type: 'condition', field_id: 1, op: 'eq', value: 'pendiente' },
            ],
        };
        expect(evaluateFilterNode(tree, fieldOf)).toBe(true);
    });
});

describe('evaluateCondition — automatizaciones (por slug, sin cambios)', () => {
    it('reglas AND por slug y shape legacy', () => {
        const values: Record<string, unknown> = { estado: 'pendiente', monto: 100 };
        expect(evaluateCondition([{ field: 'estado', op: 'eq', value: 'pendiente' }], (s) => values[s])).toBe(true);
        expect(evaluateCondition([{ slug: 'monto', op: 'gt', value: 200 }], (s) => values[s])).toBe(false);
        expect(evaluateCondition({ estado: 'pendiente' }, (s) => values[s])).toBe(true);
    });
});
