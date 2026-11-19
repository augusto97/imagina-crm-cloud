import type { Field } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';
import { planSheetSync, sheetKeyOf, type LinkIn, type PlanInput } from '../src/sheet-sync/sheet-sync.plan';
import { cellCanon, cellToFieldValue, fieldValueToCell, rowFingerprint, suggestSheetFieldType, wallDateTime } from '../src/sheet-sync/sheet-values';
import { batchUpdateBody, deleteRowsRequests, sheetsErrorFrom, tabRange } from '../src/sheet-sync/sheets-api';

/**
 * v0.1.459 (G3) — Las piezas puras de la sincronización con Google Sheets: el
 * plan de una corrida (sin base ni red), cómo se lee y escribe una celda, y
 * los pedidos a la API.
 */
const ctx = { timeZone: 'America/Bogota', numberFormat: 'dot_comma' as const, dateFormat: 'dmy' as const };

function field(id: number, label: string, type: string, config: Record<string, unknown> = {}): Field {
    return { id, list_id: 1, slug: label.toLowerCase(), label, type, config, is_required: false, is_unique: false, position: id } as unknown as Field;
}
const nombre = field(1, 'Nombre', 'text');
const monto = field(2, 'Monto', 'currency');
const estado = field(3, 'Estado', 'select', { options: [{ value: 'activo', label: 'Activo' }, { value: 'inactivo', label: 'Inactivo' }] });

function input(over: Partial<PlanInput>): PlanInput {
    return {
        settings: { direction: 'both', key: { mode: 'app_id', column: 'ID' }, on_sheet_delete: 'ignore', on_app_delete: 'ignore' },
        headers: ['Nombre', 'Monto', 'Estado', 'ID'],
        columns: [
            { name: 'Nombre', field: nombre },
            { name: 'Monto', field: monto },
            { name: 'Estado', field: estado },
        ],
        keyField: null,
        rows: [],
        records: [],
        links: [],
        sheetTruncated: false,
        recordsTruncated: false,
        ctx,
        ...over,
    };
}
const link = (recordId: number, s: Record<string, string>, a: Record<string, string>): LinkIn => ({
    recordId,
    rowKey: String(recordId),
    snapshot: { s, a },
    fingerprint: null,
    removed: false,
    trashed: false,
});

describe('celdas ↔ campos (v0.1.459)', () => {
    it('lee una celda como el valor del campo, con el formato de la empresa', () => {
        expect(cellToFieldValue('1.250,5', monto, ctx)).toEqual({ ok: true, value: 1250.5 });
        expect(cellToFieldValue(300, monto, ctx)).toEqual({ ok: true, value: 300 });
        expect(cellToFieldValue('Activo', estado, ctx)).toEqual({ ok: true, value: 'activo' });
        expect(cellToFieldValue(46000, field(9, 'Fecha', 'date'), ctx)).toEqual({ ok: true, value: '2025-12-09' });
        expect(cellToFieldValue(true, field(9, 'Ok', 'checkbox'), ctx)).toEqual({ ok: true, value: true });
        expect(cellToFieldValue('  ', monto, ctx)).toEqual({ ok: true, value: null });
        expect(cellToFieldValue('mucho', monto, ctx).ok).toBe(false);
    });

    it('escribe el valor como celda: la etiqueta de la opción, el número como número y la hora en la zona de la empresa', () => {
        expect(fieldValueToCell(estado, 'activo', ctx)).toBe('Activo');
        expect(fieldValueToCell(monto, 1250.5, ctx)).toBe(1250.5);
        expect(fieldValueToCell(field(9, 'Ok', 'checkbox'), true, ctx)).toBe(true);
        expect(fieldValueToCell(field(9, 'Cita', 'datetime'), '2026-07-30T14:30:00.000Z', ctx)).toBe('2026-07-30 09:30');
        expect(fieldValueToCell(nombre, '=HYPERLINK("x")', ctx)).toBe('=HYPERLINK("x")');
        expect(fieldValueToCell(nombre, null, ctx)).toBe('');
        expect(wallDateTime('no', 'UTC')).toBeNull();
        expect(cellCanon(' a\r\nb ')).toBe('a\nb');
        expect(rowFingerprint(['a', 'b'])).toHaveLength(40);
    });

    it('sugiere el tipo de una columna por sus valores', () => {
        expect(suggestSheetFieldType([1, 2.5, 3])).toBe('number');
        expect(suggestSheetFieldType([true, false])).toBe('checkbox');
        expect(suggestSheetFieldType(['a@b.co', 'c@d.co'])).toBe('email');
        expect(suggestSheetFieldType(['', null])).toBe('text');
    });

    it('la clave de una fila: en modo ID, sólo un número de registro', () => {
        expect(sheetKeyOf(12, null)).toMatchObject({ key: '12', bad: false });
        expect(sheetKeyOf('12.0', null)).toMatchObject({ key: '12', bad: false });
        expect(sheetKeyOf('abc', null)).toMatchObject({ key: '', bad: true });
        expect(sheetKeyOf('', null)).toMatchObject({ key: '', bad: false });
        expect(sheetKeyOf('  ANA@Acme.co ', field(5, 'Correo', 'email')).key).toBe(sheetKeyOf('ana@acme.co', field(5, 'Correo', 'email')).key);
    });
});

describe('el plan de una corrida (v0.1.459)', () => {
    it('primera vez: agrega la columna ID, crea los registros de la hoja y agrega a la hoja los de la app', () => {
        const plan = planSheetSync(
            input({
                headers: ['Nombre', 'Monto', 'Estado'],
                rows: [
                    { row: 2, cells: ['Acme', 100, 'Activo'] },
                    { row: 3, cells: ['', '', ''] },
                    { row: 4, cells: ['Beta', 'abc', 'Inactivo'] },
                ],
                records: [{ id: 50, data: { f1: 'Zeta', f2: 9 } }],
            }),
        );
        expect(plan.headerWrites).toEqual([{ col: 3, name: 'ID' }]);
        expect(plan.keyCol).toBe(3);
        expect(plan.creates.map((c) => [c.row, c.data, c.writeId])).toEqual([
            [2, { f1: 'Acme', f2: 100, f3: 'activo' }, true],
            [4, { f1: 'Beta', f3: 'inactivo' }, true],
        ]);
        expect(plan.errors).toEqual([{ where: 'Fila 4', message: expect.stringMatching(/«Monto».*quedó vacío/) }]);
        expect(plan.appends).toEqual([expect.objectContaining({ recordId: 50, cells: ['Zeta', 9, '', 50] })]);
    });

    it('en los dos sentidos: viaja lo que cambió de un solo lado; si cambió en los dos, gana la app y queda anotado', () => {
        const snap = { '1': 'Acme', '2': '100', '3': 'Activo' };
        const records = [
            { id: 7, data: { f1: 'Acme', f2: 100, f3: 'activo' } }, // sólo cambió la hoja
            { id: 8, data: { f1: 'Beta', f2: 250, f3: 'activo' } }, // sólo cambió la app
            { id: 9, data: { f1: 'Gama', f2: 999, f3: 'activo' } }, // los dos
        ];
        const plan = planSheetSync(
            input({
                rows: [
                    { row: 2, cells: ['Acme', 150, 'Activo', 7] },
                    { row: 3, cells: ['Beta', 100, 'Activo', 8] },
                    { row: 4, cells: ['Gama', 111, 'Activo', 9] },
                ],
                records,
                links: [link(7, snap, snap), link(8, { ...snap, '1': 'Beta' }, { ...snap, '1': 'Beta' }), link(9, { ...snap, '1': 'Gama' }, { ...snap, '1': 'Gama' })],
            }),
        );
        expect(plan.updates).toEqual([expect.objectContaining({ recordId: 7, patch: { f2: 150 } })]);
        expect(plan.writes.map((w) => [w.row, w.col, w.value, w.recordId])).toEqual([
            [3, 1, 250, 8],
            [4, 1, 999, 9],
        ]);
        expect(plan.conflicts).toEqual([{ where: 'Fila 4', field: 'Monto', kept: '999', replaced: '111' }]);
    });

    it('nada cambió desde la última vez: no se toca nada (aunque la hoja muestre otro formato)', () => {
        const snap = { '1': 'Acme', '2': '100', '3': 'Activo' };
        const plan = planSheetSync(input({ rows: [{ row: 2, cells: ['Acme', '100', 'Activo', 7] }], records: [{ id: 7, data: { f1: 'Acme', f2: 100, f3: 'activo' } }], links: [link(7, snap, snap)] }));
        expect([plan.updates.length, plan.writes.length, plan.unchanged]).toEqual([0, 0, 1]);
    });

    it('de la hoja a la app: la hoja manda y no se escribe nada en la hoja', () => {
        const plan = planSheetSync(
            input({
                settings: { direction: 'sheet_to_app', key: { mode: 'app_id', column: 'ID' }, on_sheet_delete: 'trash', on_app_delete: 'ignore' },
                rows: [{ row: 2, cells: ['Acme', 100, 'Activo', 7] }],
                records: [
                    { id: 7, data: { f1: 'Acme', f2: 500, f3: 'activo' } },
                    { id: 8, data: { f1: 'Sólo en la app' } },
                ],
                links: [link(7, {}, {}), link(8, {}, {})],
            }),
        );
        expect(plan.updates).toEqual([expect.objectContaining({ recordId: 7, patch: { f2: 100 } })]);
        expect(plan.writes).toHaveLength(0);
        expect(plan.appends).toHaveLength(0);
        // La fila del registro 8 ya no está en la hoja → a la papelera de la app.
        expect(plan.trash).toEqual([8]);
    });

    it('registro borrado en la app con «borrar la fila»: la fila se borra; ID que no es un número: error de esa fila', () => {
        const plan = planSheetSync(
            input({
                settings: { direction: 'both', key: { mode: 'app_id', column: 'ID' }, on_sheet_delete: 'ignore', on_app_delete: 'delete_row' },
                rows: [
                    { row: 2, cells: ['Acme', 100, 'Activo', 7] },
                    { row: 3, cells: ['Raro', 1, 'Activo', 'abc'] },
                ],
                records: [],
                links: [{ ...link(7, {}, {}), trashed: true }],
            }),
        );
        expect(plan.deletes).toEqual([{ row: 2, key: '7', recordId: 7 }]);
        expect(plan.errors.map((e) => e.where)).toEqual(['Fila 3']);
    });
});

describe('pedidos a la API de Sheets (v0.1.459)', () => {
    it('rangos con el título entre comillas; escribir con RAW; borrar filas de abajo hacia arriba', () => {
        expect(tabRange("Ventas de Ana's", 2, 101, 6)).toBe("'Ventas de Ana''s'!A2:F101");
        expect(batchUpdateBody('Hoja 1', [{ row: 4, col: 1, value: '=1+1' }])).toEqual({ valueInputOption: 'RAW', data: [{ range: "'Hoja 1'!B4", values: [['=1+1']] }] });
        expect(deleteRowsRequests(5, [3, 9, 3]).map((r) => (r.deleteDimension as { range: { startIndex: number } }).range.startIndex)).toEqual([8, 2]);
    });

    it('traduce los errores de Google a algo que se entiende, y dice cuáles necesitan a una persona', () => {
        const e401 = sheetsErrorFrom(401, 'x', '', 'leer la hoja');
        expect([e401.message, e401.needsUser]).toEqual([expect.stringMatching(/autorización venció/), true]);
        expect(sheetsErrorFrom(429, '', '', 'leer').needsUser).toBe(false);
        expect(sheetsErrorFrom(403, '', 'PERMISSION_DENIED', 'escribir').message).toMatch(/Compártela/);
        expect(sheetsErrorFrom(404, '', '', 'leer').message).toMatch(/ya no existe/);
        expect(sheetsErrorFrom(400, 'You are trying to edit a protected cell', '', 'escribir la columna ID').message).toMatch(/protegidas.*escribir la columna ID/);
        expect(sheetsErrorFrom(503, '', '', 'leer la hoja').needsUser).toBe(false);
    });
});
