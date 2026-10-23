import { describe, expect, it } from 'vitest';

import { exportFileName, orderExportFields, visibleExportFieldIds } from './exportFields';

const fields = [
    { id: 10, slug: 'nombre', position: 0 },
    { id: 11, slug: 'monto', position: 1 },
    { id: 12, slug: 'estado', position: 2 },
    { id: 13, slug: 'nota', position: 3 },
];

describe('columnas del export (v0.1.296)', () => {
    it('las visibles de la vista, en su orden (lo que no está en el orden sigue la posición)', () => {
        expect(visibleExportFieldIds(fields, {}, [])).toEqual([10, 11, 12, 13]);
        expect(visibleExportFieldIds(fields, { nota: false }, ['estado', 'id', 'nombre'])).toEqual([12, 10, 11]);
        expect(visibleExportFieldIds(fields, { monto: false, nombre: false }, ['monto', 'nombre'])).toEqual([12, 13]);
    });

    it('el diálogo lista primero las de la vista', () => {
        expect(orderExportFields(fields, [12, 10]).map((f) => f.id)).toEqual([12, 10, 11, 13]);
        expect(orderExportFields(fields, [99]).map((f) => f.id)).toEqual([10, 11, 12, 13]);
    });

    it('nombre del archivo: el legible con acentos si viene', () => {
        expect(exportFileName(`attachment; filename="facturas.xlsx"; filename*=UTF-8''Facturas%20-%20Por%20cobrar%20%C3%A1.xlsx`, 'x.xlsx')).toBe(
            'Facturas - Por cobrar á.xlsx',
        );
        expect(exportFileName('attachment; filename="facturas.csv"', 'x.csv')).toBe('facturas.csv');
        expect(exportFileName('', 'x.csv')).toBe('x.csv');
    });
});
