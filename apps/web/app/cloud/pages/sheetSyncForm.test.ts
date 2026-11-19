import { describe, expect, it } from 'vitest';
import type { SheetPreviewColumn } from '@imagina-base/shared';

import { fieldsWithoutColumn, newColumnName, suggestSheetKey, suggestSheetTargets } from './sheetSyncForm';

const col = (name: string, suggested_type: SheetPreviewColumn['suggested_type'] = 'text', letter = 'A'): SheetPreviewColumn => ({ name, letter, suggested_type });
const fields = [
    { id: 1, label: 'Nombre', slug: 'nombre', type: 'text' },
    { id: 2, label: 'Correo', slug: 'correo', type: 'email', is_unique: true },
    { id: 3, label: 'Monto', slug: 'monto', type: 'currency' },
    { id: 4, label: 'Contrato', slug: 'contrato', type: 'file' },
    { id: 5, label: 'Ciudad', slug: 'ciudad', type: 'text' },
];

describe('editor de la sincronización con Google Sheets (v0.1.459)', () => {
    it('clave: la columna ID que ya está en la hoja, un campo «Sin repetidos» que no se repite, o la columna ID nueva', () => {
        expect(suggestSheetKey([col('Nombre'), col('id')], [], fields)).toEqual({ mode: 'app_id', column: 'id' });
        const rows = [{ correo: 'a@x.co' }, { correo: 'b@x.co' }];
        expect(suggestSheetKey([col('Nombre'), col('correo', 'email')], rows, fields)).toEqual({ mode: 'field', column: 'correo', field_id: 2 });
        // Repetido en la muestra: no sirve de clave.
        expect(suggestSheetKey([col('correo', 'email')], [{ correo: 'a@x.co' }, { correo: 'A@x.co' }], fields)).toEqual({ mode: 'app_id', column: 'ID' });
        expect(suggestSheetKey([col('Nombre')], [], fields)).toEqual({ mode: 'app_id', column: 'ID' });
    });

    it('destino de cada columna: el campo del mismo nombre si se puede sincronizar; si no, crear uno con el tipo sugerido', () => {
        const t = suggestSheetTargets([col('Nombre'), col('Monto', 'number'), col('Contrato'), col('Teléfono', 'phone'), col('ID')], fields, { mode: 'app_id', column: 'ID' });
        expect(t).toEqual({
            Nombre: { kind: 'field', id: 1 },
            Monto: { kind: 'field', id: 3 },
            // «Contrato» es un campo de archivos: no viaja a una hoja.
            Contrato: { kind: 'create', type: 'text' },
            Teléfono: { kind: 'create', type: 'phone' },
        });
        // Lo ya elegido manda; la clave por campo no se repite como columna de datos.
        const kept = suggestSheetTargets([col('Nombre'), col('correo')], fields, { mode: 'field', column: 'correo', field_id: 2 }, [{ column: 'Nombre', field_id: 5 }]);
        expect(kept).toEqual({ Nombre: { kind: 'field', id: 5 } });
    });

    it('campos sin columna en la hoja y el nombre de la columna nueva', () => {
        const left = fieldsWithoutColumn(fields, { Nombre: { kind: 'field', id: 1 } }, { mode: 'field', column: 'correo', field_id: 2 });
        expect(left.map((f) => f.id)).toEqual([3, 5]);
        expect(newColumnName('Ciudad', ['ciudad', 'Ciudad 2'])).toBe('Ciudad 3');
        expect(newColumnName('Id', [])).toBe('Id 2');
    });
});
