import { describe, expect, it } from 'vitest';
import { cleanDocItemsFilter, docItemsFilterCount, isClosedStatusOption, pendingItemsFilter } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';

import { docFilterFields } from './ItemsFilterEditor';

const field = (over: Partial<FieldEntity> & Pick<FieldEntity, 'id' | 'type' | 'slug' | 'label'>): FieldEntity =>
    ({ list_id: 2, config: {}, ...over }) as FieldEntity;

const ESTADO = field({
    id: 11,
    type: 'select',
    slug: 'estado',
    label: 'Estado',
    config: {
        options: [
            { value: 'pendiente', label: 'Pendiente' },
            { value: 'pagada', label: 'Pagada' },
            { value: 'anulada', label: 'Anulada' },
        ],
    },
});
const SALDO = field({ id: 12, type: 'formula', slug: 'saldo', label: 'Saldo', formula: { result_type: 'currency' } as FieldEntity['formula'] });

describe('filtro de la tabla de ítems (v0.1.468)', () => {
    it('los campos de la lista se leen como los lee el servidor (la fórmula con su tipo)', () => {
        const out = docFilterFields([ESTADO, SALDO]);
        expect(out[0]).toMatchObject({ id: 11, type: 'select', slug: 'estado' });
        expect(out[1]).toMatchObject({ id: 12, type: 'formula', formula: { result_type: 'currency' } });
        // Una fórmula numérica se puede filtrar por «mayor que».
        const { tree, issues } = cleanDocItemsFilter({ type: 'group', logic: 'and', children: [{ type: 'condition', field_id: 12, op: 'gt', value: 0 }] }, out);
        expect(issues).toEqual([]);
        expect(docItemsFilterCount(tree)).toBe(1);
    });

    it('una opción borrada se avisa y la regla con un campo que ya no está se ignora', () => {
        const fields = docFilterFields([ESTADO]);
        const { tree, issues } = cleanDocItemsFilter(
            {
                type: 'group',
                logic: 'and',
                children: [
                    { type: 'condition', field_id: 11, op: 'nin', value: ['pagada', 'archivada'] },
                    { type: 'condition', field_id: 99, op: 'eq', value: 'x' },
                ],
            },
            fields,
        );
        expect(issues.map((i) => i.reason).sort()).toEqual(['missing_field', 'unknown_option']);
        expect(tree?.children).toEqual([{ type: 'condition', field_id: 11, op: 'nin', value: ['pagada'] }]);
    });

    it('el estado de cuenta muestra lo que NO está pagado ni anulado', () => {
        const options = docFilterFields([ESTADO])[0]!;
        expect(['pendiente', 'pagada', 'anulada'].filter((v) => isClosedStatusOption({ value: v, label: v }))).toEqual(['pagada', 'anulada']);
        expect(pendingItemsFilter(options, null)).toEqual({
            type: 'group',
            logic: 'and',
            children: [{ type: 'condition', field_id: 11, op: 'nin', value: ['pagada', 'anulada'] }],
        });
    });
});
