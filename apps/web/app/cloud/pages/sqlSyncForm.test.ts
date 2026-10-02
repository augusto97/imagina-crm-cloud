import { describe, expect, it } from 'vitest';
import type { SqlPreviewColumn } from '@imagina-base/shared';

import { keyFields, matchField, normalizeName, suggestKeyColumn, suggestTargets } from './sqlSyncForm';

const col = (name: string, suggested_type: SqlPreviewColumn['suggested_type'] = 'text'): SqlPreviewColumn => ({ name, sql_type: 'nvarchar', suggested_type });

describe('editor de sincronización SQL (v0.1.243)', () => {
    const fields = [
        { id: 1, label: 'Número de factura', slug: 'numero_factura', type: 'text' },
        { id: 2, label: 'Cliente', slug: 'cliente', type: 'text' },
        { id: 3, label: 'Total', slug: 'total', type: 'currency' },
        { id: 4, label: 'Archivo', slug: 'archivo', type: 'file' },
        { id: 5, label: 'Estado', slug: 'estado', type: 'select' },
    ];

    it('normaliza nombres sin acentos, mayúsculas ni separadores', () => {
        expect(normalizeName('Número_Factura')).toBe('numerofactura');
        expect(matchField('NumeroFactura', fields)?.id).toBe(1);
        expect(matchField('CLIENTE', fields)?.id).toBe(2);
    });

    it('sólo ofrece como clave los tipos que pueden serlo', () => {
        expect(keyFields(fields).map((f) => f.id)).toEqual([1, 2]);
    });

    it('sugiere el campo con el mismo nombre y crea el resto; no toca la clave ni campos que no sirven', () => {
        const targets = suggestTargets([col('NumeroFactura'), col('Cliente'), col('Total', 'number'), col('Archivo'), col('Vence', 'date')], fields, 'NumeroFactura');
        expect(targets).toEqual({
            Cliente: { kind: 'field', id: 2 },
            Total: { kind: 'field', id: 3 },
            // «Archivo» existe pero es un campo de archivos: no se llena desde SQL.
            Archivo: { kind: 'create', type: 'text' },
            Vence: { kind: 'create', type: 'date' },
        });
    });

    it('al editar, lo ya elegido manda', () => {
        const targets = suggestTargets([col('Cliente'), col('Estado')], fields, 'X', [{ column: 'Cliente', field_id: 5 }]);
        expect(targets.Cliente).toEqual({ kind: 'field', id: 5 });
        // «Estado» ya está usado por «Cliente»: no se repite.
        expect(targets.Estado).toEqual({ kind: 'create', type: 'text' });
    });

    it('sugiere la columna clave por nombre', () => {
        expect(suggestKeyColumn([col('Fecha'), col('NIT'), col('Cliente')])).toBe('NIT');
        expect(suggestKeyColumn([col('Fecha'), col('NumeroFactura')])).toBe('NumeroFactura');
        expect(suggestKeyColumn([col('A'), col('B')])).toBe('A');
    });

    it('con muestra, la clave sugerida no se repite (el NIT se repite por cliente en una tabla de facturas)', () => {
        const cols = [col('NIT'), col('Cliente'), col('Folio')];
        const rows = [
            { NIT: '900', Cliente: 'Acme', Folio: 'A-1' },
            { NIT: '900', Cliente: 'Acme', Folio: 'A-2' },
            { NIT: '800', Cliente: 'Beta', Folio: 'A-3' },
        ];
        expect(suggestKeyColumn(cols, rows)).toBe('Folio');
        // Sin filas de muestra, gana el nombre.
        expect(suggestKeyColumn(cols)).toBe('NIT');
    });
});
