import { describe, expect, it } from 'vitest';
import { applyBulkOperations, bulkOperationSchema, roundTo, shiftDate, type BulkField, type BulkOperationInput } from './bulk-edit';

const F = (id: number, type: BulkField['type'], extra: Partial<BulkField> = {}): BulkField => ({
    id,
    label: `Campo ${id}`,
    type,
    config: {},
    is_required: false,
    ...extra,
});

const fields = new Map<number, BulkField>([
    [1, F(1, 'currency', { label: 'Precio', config: { precision: 0 } })],
    [2, F(2, 'number', { label: 'Stock' })],
    [3, F(3, 'text', { label: 'Nombre' })],
    [4, F(4, 'multi_select', { label: 'Etiquetas', config: { options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] } })],
    [5, F(5, 'date', { label: 'Vence' })],
    [6, F(6, 'datetime', { label: 'Cita' })],
    [7, F(7, 'checkbox', { label: 'Activo' })],
    [8, F(8, 'currency', { label: 'Costo', config: { precision: 2 } })],
    [9, F(9, 'relation', { label: 'Cliente' })],
    [10, F(10, 'percent', { label: 'Avance' })],
    [11, F(11, 'select', { label: 'Estado', config: { options: [{ value: 'x' }, { value: 'y' }] }, is_required: true })],
]);

const run = (ops: BulkOperationInput[], data: Record<string, unknown>, relations: Record<number, number[]> = {}) =>
    applyBulkOperations(ops.map((o) => bulkOperationSchema.parse(o)), fields, { data, relations }, new Date('2026-09-29T15:04:05.123Z'));

describe('applyBulkOperations', () => {
    it('opera sobre el valor de cada fila y respeta los decimales del campo', () => {
        const r = run([{ op: 'percent', field_id: 1, percent: 10 }], { f1: 25_000 });
        expect(r.patch).toEqual({ f1: 27_500 });
        expect(r.changes).toEqual([{ field_id: 1, before: 25_000, after: 27_500 }]);
        // Precisión 0: 12.345 × 1,1 = 13.579,5 → 13.580.
        expect(run([{ op: 'percent', field_id: 1, percent: 10 }], { f1: 12_345 }).patch).toEqual({ f1: 13_580 });
        expect(run([{ op: 'percent', field_id: 8, percent: -15 }], { f8: 19.99 }).patch).toEqual({ f8: 16.99 });
    });

    it('sumar a un vacío parte de cero; multiplicar un vacío lo deja como está', () => {
        expect(run([{ op: 'add', field_id: 2, amount: 5 }], {}).patch).toEqual({ f2: 5 });
        expect(run([{ op: 'subtract', field_id: 2, amount: 3 }], { f2: 10 }).patch).toEqual({ f2: 7 });
        const r = run([{ op: 'multiply', field_id: 2, factor: 2 }], { f2: null });
        expect(r.patch).toEqual({});
        expect(r.errors).toEqual([]);
    });

    it('redondeo a múltiplos con ajuste (precios terminados en 900 / .99)', () => {
        expect(run([{ op: 'round', field_id: 1, multiple: 1000, mode: 'up', adjust: -100 }], { f1: 25_320 }).patch).toEqual({ f1: 25_900 });
        // Hacia arriba nunca baja: 11.000 va al PRÓXIMO terminado en 900, no a 10.900.
        expect(run([{ op: 'round', field_id: 1, multiple: 1000, mode: 'up', adjust: -100 }], { f1: 11_000 }).patch).toEqual({ f1: 11_900 });
        // Uno que ya termina en 900 queda igual (sin cambio = sin patch).
        expect(run([{ op: 'round', field_id: 1, multiple: 1000, mode: 'up', adjust: -100 }], { f1: 11_900 }).patch).toEqual({});
        expect(run([{ op: 'round', field_id: 1, multiple: 1000, mode: 'down', adjust: -100 }], { f1: 11_000 }).patch).toEqual({ f1: 10_900 });
        expect(run([{ op: 'round', field_id: 8, multiple: 1, mode: 'up', adjust: 0.99 }], { f8: 12.4 }).patch).toEqual({ f8: 12.99 });
        expect(run([{ op: 'round', field_id: 8, multiple: 1, mode: 'up', adjust: 0.99 }], { f8: 12.99 }).patch).toEqual({});
        expect(roundTo(0.3, 0.1, 'up')).toBe(0.3);
        expect(roundTo(12.5, 5, 'nearest')).toBe(15);
    });

    it('calc entre columnas, y el error cuando un operando está vacío', () => {
        const ok = run([{ op: 'calc', field_id: 1, left: { field_id: 8 }, operator: '*', right: { value: 1.3 } }], { f8: 10_000 });
        expect(ok.patch).toEqual({ f1: 13_000 });
        const bad = run([{ op: 'calc', field_id: 1, left: { field_id: 8 }, operator: '*', right: { value: 2 } }], { f1: 5 });
        expect(bad.patch).toEqual({});
        expect(bad.errors[0]?.message).toMatch(/Costo.*vacío/);
    });

    it('encadena: la segunda operación ve el resultado de la primera', () => {
        const r = run(
            [
                { op: 'set', field_id: 8, value: 100 },
                { op: 'calc', field_id: 1, left: { field_id: 8 }, operator: '+', right: { value: 50 } },
            ],
            { f8: 1 },
        );
        expect(r.patch).toEqual({ f8: 100, f1: 150 });
    });

    it('texto: prefijo, sufijo, reemplazo sin distinguir mayúsculas, mayúsculas por palabra', () => {
        expect(run([{ op: 'prepend', field_id: 3, text: 'PROMO ' }], { f3: 'Taza' }).patch).toEqual({ f3: 'PROMO Taza' });
        expect(run([{ op: 'replace', field_id: 3, find: 'TAZA', replace: 'Mug' }], { f3: 'Taza roja taza' }).patch).toEqual({
            f3: 'Mug roja Mug',
        });
        // El texto a buscar es literal (un punto no es "cualquier carácter").
        expect(run([{ op: 'replace', field_id: 3, find: '.', replace: ',' }], { f3: 'a.b' }).patch).toEqual({ f3: 'a,b' });
        expect(run([{ op: 'text_case', field_id: 3, mode: 'title' }], { f3: 'ana maría lópez' }).patch).toEqual({ f3: 'Ana María López' });
        expect(run([{ op: 'trim', field_id: 3 }], { f3: '  a   b ' }).patch).toEqual({ f3: 'a b' });
    });

    it('multi_select: agregar y quitar sin duplicar ni tocar lo demás', () => {
        expect(run([{ op: 'add_options', field_id: 4, values: ['b', 'c'] }], { f4: ['a', 'b'] }).patch).toEqual({ f4: ['a', 'b', 'c'] });
        expect(run([{ op: 'remove_options', field_id: 4, values: ['a'] }], { f4: ['a', 'b'] }).patch).toEqual({ f4: ['b'] });
        // Una opción que no existe en el campo: la fila no se escribe.
        const bad = run([{ op: 'add_options', field_id: 4, values: ['z'] }], { f4: [] });
        expect(bad.patch).toEqual({});
        expect(bad.errors).toHaveLength(1);
    });

    it('fechas: correr días/meses con fin de mes, y «hoy»', () => {
        expect(run([{ op: 'shift_date', field_id: 5, amount: 7, unit: 'days' }], { f5: '2026-09-28' }).patch).toEqual({ f5: '2026-10-05' });
        expect(shiftDate('2026-01-31', false, 1, 'months')).toBe('2026-02-28');
        expect(shiftDate('2026-01-31T10:30:00Z', true, 2, 'hours')).toBe('2026-01-31T12:30:00Z');
        expect(run([{ op: 'today', field_id: 5 }], {}).patch).toEqual({ f5: '2026-09-29' });
        expect(run([{ op: 'today', field_id: 6 }], {}).patch).toEqual({ f6: '2026-09-29T15:04:05Z' });
    });

    it('checkbox alterna; vaciar un obligatorio es un error de la fila', () => {
        expect(run([{ op: 'toggle', field_id: 7 }], { f7: true }).patch).toEqual({ f7: false });
        const r = run([{ op: 'clear', field_id: 11 }], { f11: 'x' });
        expect(r.patch).toEqual({});
        expect(r.errors[0]?.message).toMatch(/obligatorio/);
    });

    it('un error en una operación deja la FILA entera sin escribir', () => {
        const r = run(
            [
                { op: 'set', field_id: 3, value: 'Nuevo' },
                { op: 'set', field_id: 11, value: 'no-existe' },
            ],
            { f3: 'Viejo', f11: 'x' },
        );
        expect(r.patch).toEqual({});
        expect(r.errors).toHaveLength(1);
    });

    it('relaciones: agregar y quitar vínculos', () => {
        const r = run([{ op: 'add_links', field_id: 9, ids: [3, 4] }], {}, { 9: [1, 3] });
        expect(r.patch).toEqual({ f9: [1, 3, 4] });
        expect(run([{ op: 'remove_links', field_id: 9, ids: [1] }], {}, { 9: [1, 3] }).patch).toEqual({ f9: [3] });
    });

    it('sin cambios reales no hay patch; porcentajes se acotan a 0-100', () => {
        expect(run([{ op: 'set', field_id: 3, value: 'Igual' }], { f3: 'Igual' }).patch).toEqual({});
        expect(run([{ op: 'add', field_id: 10, amount: 20 }], { f10: 95 }).patch).toEqual({ f10: 100 });
    });

    it('rechaza operaciones que el tipo no admite', () => {
        const r = run([{ op: 'percent', field_id: 3, percent: 10 }], { f3: 'x' });
        expect(r.errors[0]?.message).toMatch(/no admite/);
    });

    it('copiar entre tipos convierte el valor', () => {
        expect(run([{ op: 'copy', field_id: 3, source_field_id: 1 }], { f1: 1500 }).patch).toEqual({ f3: '1500' });
        expect(run([{ op: 'copy', field_id: 5, source_field_id: 6 }], { f6: '2026-03-01T10:00:00Z' }).patch).toEqual({ f5: '2026-03-01' });
    });
});
