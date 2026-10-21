import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';

import { computeColumnSums, type EditableRow } from './EditableRelatedTable';

const field = (id: number, slug: string, type: string): FieldEntity => ({ id, slug, label: slug, type }) as unknown as FieldEntity;
const precio = field(1, 'precio', 'currency');
const cantidad = field(2, 'cantidad', 'number');
const nombre = field(3, 'nombre', 'text');
const row = (id: number, values: Record<string, unknown>): EditableRow => ({ id, value: (f) => values[f.slug] });

describe('tabla editable — fila de totales', () => {
    it('suma las filas cuando llegaron todas, ignora vacíos y columnas no numéricas', () => {
        const sums = computeColumnSums({
            totalIds: [1, 2, 3],
            columns: [nombre, cantidad, precio],
            rows: [row(1, { precio: 1000, cantidad: '2' }), row(2, { precio: null, cantidad: 1.5 }), row(3, { precio: '250.5' })],
            total: 3,
        });
        expect(sums.get(1)).toBe(1250.5);
        expect(sums.get(2)).toBe(3.5);
        expect(sums.has(3)).toBe(false);
    });

    it('usa la suma del servidor y, sin ella, no suma una página incompleta', () => {
        const rows = [row(1, { precio: 10 })];
        expect(computeColumnSums({ totalIds: [1], columns: [precio], rows, total: 30, totals: { '1': 900 } }).get(1)).toBe(900);
        expect(computeColumnSums({ totalIds: [1], columns: [precio], rows, total: 30 }).get(1)).toBeNull();
    });

    it('sin ítems el total es 0 y sin valores en ninguna fila queda vacío', () => {
        expect(computeColumnSums({ totalIds: [1], columns: [precio], rows: [], total: 0 }).get(1)).toBe(0);
        expect(computeColumnSums({ totalIds: [1], columns: [precio], rows: [row(1, {})], total: 1 }).get(1)).toBeNull();
    });
});
