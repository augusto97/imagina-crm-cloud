import { describe, expect, it } from 'vitest';
import { sameBulkValue, summarizeBulkOperations, summarizeStoreBulkOperations } from './bulk-history';

describe('historial de ediciones masivas (v0.1.218)', () => {
    it('resume las operaciones en criollo, con el nombre de cada columna', () => {
        const labels: Record<number, string> = { 1: 'Precio', 2: 'Costo', 3: 'Etiquetas', 4: 'Vence' };
        const txt = summarizeBulkOperations(
            [
                { op: 'percent', field_id: 1, percent: 10 },
                { op: 'round', field_id: 1, multiple: 1000, mode: 'up', adjust: -100 },
                { op: 'calc', field_id: 1, left: { field_id: 2 }, operator: '*', right: { value: 1.3 } },
                { op: 'add_options', field_id: 3, values: ['vip'] },
                { op: 'shift_date', field_id: 4, amount: -2, unit: 'days' },
            ],
            (id) => labels[id] ?? '?',
        );
        expect(txt).toBe('Precio: subir 10 % · Precio: redondear a 1000 ↑ (−100) · Precio: = «Costo» × 1.3 · Etiquetas: agregar vip · Vence: correr −2 días');
    });

    it('resume las de la tienda (booleanos como Sí/No)', () => {
        expect(
            summarizeStoreBulkOperations([
                { op: 'regular_price', change: { kind: 'percent', amount: -15 } },
                { op: 'featured', value: true },
                { op: 'categories', mode: 'remove', values: ['Ofertas'] },
            ]),
        ).toBe('Precio normal: bajar 15 % · Destacado: Sí · Categorías: quitar Ofertas');
    });

    it('compara valores guardados: claves reordenadas, vacíos equivalentes, conjuntos', () => {
        expect(sameBulkValue({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
        expect(sameBulkValue(null, '')).toBe(true);
        expect(sameBulkValue(undefined, [])).toBe(true);
        expect(sameBulkValue(11000, 11000)).toBe(true);
        expect(sameBulkValue(11000, 11001)).toBe(false);
        expect(sameBulkValue([3, 1, 2], [1, 2, 3])).toBe(false);
        expect(sameBulkValue([3, 1, 2], [1, 2, 3], true)).toBe(true);
        expect(sameBulkValue(['a'], ['a', 'b'], true)).toBe(false);
    });
});
