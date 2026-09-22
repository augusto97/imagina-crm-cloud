import { describe, expect, it } from 'vitest';

import { isMultiValueOperator, toValueList, valueForOperator } from './filterValue';
import { operatorsForType } from './operators';

describe('valueForOperator (v0.1.191) — el valor cambia de forma con el operador', () => {
    it('es → es alguno de: el escalar elegido pasa a lista', () => {
        expect(valueForOperator('in', 'pendiente')).toEqual(['pendiente']);
        expect(valueForOperator('nin', 7)).toEqual([7]);
    });

    it('sin valor previo la lista arranca vacía y una lista se conserva', () => {
        expect(valueForOperator('in', '')).toEqual([]);
        expect(valueForOperator('in', undefined)).toEqual([]);
        expect(valueForOperator('nin', ['a', 'b'])).toEqual(['a', 'b']);
    });

    it('es alguno de → es: se queda con la primera opción de la lista', () => {
        expect(valueForOperator('eq', ['pendiente', 'pagada'])).toBe('pendiente');
        expect(valueForOperator('neq', [])).toBe('');
        expect(valueForOperator('eq', 'x')).toBe('x');
    });

    it('nulos y rango relativo', () => {
        expect(valueForOperator('is_null', ['a'])).toBeNull();
        expect(valueForOperator('between_relative', '2026-01-01')).toBe('this_month');
        expect(valueForOperator('between_relative', 'last_week')).toBe('last_week');
    });

    it('isMultiValueOperator / toValueList (tolera el CSV viejo)', () => {
        expect(isMultiValueOperator('in')).toBe(true);
        expect(isMultiValueOperator('eq')).toBe(false);
        expect(toValueList('al_dia, vencido')).toEqual(['al_dia', 'vencido']);
        expect(toValueList(['a', '', null, 3])).toEqual(['a', '3']);
        expect(toValueList(undefined)).toEqual([]);
    });
});

describe('operatorsForType (v0.1.191)', () => {
    it('file sólo admite tiene / no tiene archivos', () => {
        expect(operatorsForType('file').map((o) => o.op)).toEqual(['is_not_null', 'is_null']);
    });

    it('user y select/multi_select ofrecen "es alguno de"', () => {
        for (const t of ['user', 'select', 'multi_select'] as const) {
            expect(operatorsForType(t).map((o) => o.op)).toEqual(expect.arrayContaining(['in', 'nin']));
        }
    });

    it('multi_select habla de "incluye" (eq escalar = contiene)', () => {
        expect(operatorsForType('multi_select').find((o) => o.op === 'eq')?.label).toBe('incluye');
    });
});

describe('operatorsForType — campos derivados (v0.1.200)', () => {
    const through = (targetType: string) => ({
        through: {
            direction: 'forward' as const,
            relation_label: 'Cliente',
            other_list_id: 2,
            other_list_name: 'Clientes',
            target_field: { id: 9, label: 'Ciudad', type: targetType as never, config: {} },
        },
    });

    it('un lookup se filtra como TEXTO (su valor viaja como cadena)', () => {
        const ops = operatorsForType('lookup', through('select')).map((o) => o.op);
        // Aunque el destino sea un select, el backend compara la cadena que
        // une los vinculados: contiene / empieza con son los que sirven.
        expect(ops).toEqual(expect.arrayContaining(['eq', 'contains']));
    });

    it('un lookup numérico también se compara como texto, no como número', () => {
        const ops = operatorsForType('lookup', through('currency')).map((o) => o.op);
        expect(ops).toContain('contains');
    });

    it('un lookup hacia un `computed` no se filtra: no hay SQL que lo exprese', () => {
        expect(operatorsForType('lookup', through('computed'))).toEqual([]);
        // Sin la relación resuelta tampoco.
        expect(operatorsForType('lookup', { through: null })).toEqual([]);
        expect(operatorsForType('lookup')).toEqual([]);
    });

    it('un rollup sigue comparándose como número', () => {
        expect(operatorsForType('rollup').map((o) => o.op)).toEqual(expect.arrayContaining(['gt', 'lt']));
    });
});
