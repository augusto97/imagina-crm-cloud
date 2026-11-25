import { describe, expect, it } from 'vitest';
import { parseDocDesign } from './document-design';
import { cleanDocItemsFilter, docFilterOpsFor, docItemsFilterCount, type DocFilterField } from './document-items-filter';

const estado: DocFilterField = {
    id: 11,
    type: 'select',
    label: 'Estado',
    config: {
        options: [
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'pagada', label: 'Pagada' },
            { value: 'vencida', label: 'Vencida' },
        ],
    },
};
const saldo: DocFilterField = { id: 12, type: 'currency', label: 'Saldo' };
const vence: DocFilterField = { id: 13, type: 'date', label: 'Vence' };
const notas: DocFilterField = { id: 14, type: 'long_text', label: 'Notas' };
const boton: DocFilterField = { id: 15, type: 'button', label: 'Cobrar' };
const archivo: DocFilterField = { id: 16, type: 'file', label: 'Soporte' };
const fields = [estado, saldo, vence, notas, boton, archivo];

const group = (logic: 'and' | 'or', ...children: unknown[]) => ({ type: 'group', logic, children });
const cond = (field_id: number, op: string, value?: unknown) => ({ type: 'condition', field_id, op, ...(value === undefined ? {} : { value }) });

describe('filtro de la tabla de ítems (v0.1.468)', () => {
    it('deja pasar un filtro válido tal cual (y normaliza los valores)', () => {
        const r = cleanDocItemsFilter(
            group('and', cond(11, 'nin', ['pagada']), cond(12, 'gt', '0'), cond(13, 'between_relative', 'before_today'), cond(16, 'is_null', 'x')),
            fields,
        );
        expect(r.issues).toEqual([]);
        expect(r.tree).toEqual(
            group('and', cond(11, 'nin', ['pagada']), cond(12, 'gt', 0), cond(13, 'between_relative', 'before_today'), cond(16, 'is_null')),
        );
        expect(docItemsFilterCount(r.tree)).toBe(4);
    });

    it('una opción por su etiqueta (sin tildes ni mayúsculas) se guarda por su valor', () => {
        const r = cleanDocItemsFilter(group('or', cond(11, 'eq', 'VENCIDA'), cond(11, 'in', ['Pendiente', 'pagada', 'Anulada'])), fields);
        expect(r.tree).toEqual(group('or', cond(11, 'eq', 'vencida'), cond(11, 'in', ['pendiente', 'pagada'])));
        // «Anulada» ya no existe: se quita con un aviso, el resto queda.
        expect(r.issues).toHaveLength(1);
        expect(r.issues[0]!.reason).toBe('unknown_option');
    });

    it('lo que no se puede aplicar se ignora con un aviso y el resto sigue', () => {
        const r = cleanDocItemsFilter(
            group(
                'and',
                cond(99, 'eq', 'x'), // campo borrado
                cond(11, 'gt', 3), // comparación que no aplica a una selección
                cond(12, 'gt', 'mucho'), // número que no es número
                cond(13, 'lt', '2026-02-31'), // fecha imposible
                cond(13, 'between_relative', 'next_90_years'), // preset que no existe
                cond(15, 'eq', 'x'), // un botón no se filtra
                cond(11, 'eq', 'archivada'), // opción que ya no existe
                cond(14, 'contains', 'urgente'), // ésta sí
            ),
            fields,
        );
        expect(r.tree).toEqual(group('and', cond(14, 'contains', 'urgente')));
        expect(r.issues.map((i) => i.reason)).toEqual([
            'missing_field',
            'bad_operator',
            'bad_value',
            'bad_value',
            'bad_value',
            'not_filterable',
            'unknown_option',
        ]);
        expect(r.issues[1]!.message).toContain('«Estado»');
    });

    it('un campo que quien genera no ve no filtra', () => {
        const r = cleanDocItemsFilter(group('and', cond(11, 'eq', 'pendiente'), cond(12, 'gt', 0)), fields, { hiddenIds: [12] });
        expect(r.tree).toEqual(group('and', cond(11, 'eq', 'pendiente')));
        expect(r.issues[0]).toMatchObject({ reason: 'hidden_field', field_id: 12, field_label: 'Saldo' });
    });

    it('sin reglas válidas no hay filtro; los grupos vacíos desaparecen; nunca lanza', () => {
        expect(cleanDocItemsFilter(group('and', cond(99, 'eq', 1)), fields).tree).toBeNull();
        expect(cleanDocItemsFilter(group('and', group('or', cond(99, 'eq', 1)), cond(14, 'is_not_null')), fields).tree).toEqual(
            group('and', cond(14, 'is_not_null')),
        );
        for (const raw of [null, undefined, 'x', 42, [], { type: 'nada' }, group('and', null, 'x', { type: 'condition' })]) {
            expect(() => cleanDocItemsFilter(raw, fields)).not.toThrow();
        }
        // Una condición suelta en la raíz se lee como «todas».
        expect(cleanDocItemsFilter(cond(14, 'contains', 'a'), fields).tree).toEqual(group('and', cond(14, 'contains', 'a')));
    });

    it('el servidor puede marcar un derivado como no filtrable', () => {
        const rollup: DocFilterField = { id: 20, type: 'rollup', label: 'Abonado' };
        const r = cleanDocItemsFilter(group('and', cond(20, 'gt', 0)), [rollup], { canFilter: () => false });
        expect(r.tree).toBeNull();
        expect(r.issues[0]!.reason).toBe('not_filterable');
    });

    it('comparaciones por tipo', () => {
        expect(docFilterOpsFor(archivo)).toEqual(['is_null', 'is_not_null']);
        expect(docFilterOpsFor(vence)).toContain('between_relative');
        expect(docFilterOpsFor(boton)).toEqual([]);
    });

    it('un filtro mal armado en el diseño guardado no tira la plantilla', () => {
        const design = parseDocDesign({
            blocks: [{ id: 'items', type: 'items', filter_tree: { type: 'group', logic: 'xor', children: 'nada' } }],
        });
        expect(design).not.toBeNull();
        const items = design!.blocks[0]!;
        expect(items.type === 'items' && items.filter_tree).toBeNull();
        const ok = parseDocDesign({ blocks: [{ id: 'items', type: 'items', filter_tree: group('and', cond(11, 'eq', 'pagada')) }] })!;
        expect(ok.blocks[0]!.type === 'items' && ok.blocks[0]!.filter_tree).toEqual(group('and', cond(11, 'eq', 'pagada')));
    });
});
