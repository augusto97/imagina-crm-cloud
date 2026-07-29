import { describe, expect, it } from 'vitest';

import { titleFieldOf } from './recordTitle';
import type { FieldEntity } from '@/types/field';

function f(partial: Partial<FieldEntity> & { id: number; type: FieldEntity['type'] }): FieldEntity {
    return {
        list_id: 1,
        slug: `f${partial.id}`,
        label: `F${partial.id}`,
        config: {},
        is_required: false,
        is_unique: false,
        is_indexed: false,
        is_primary: false,
        position: partial.id,
        ...partial,
    } as FieldEntity;
}

describe('campo de título del registro (v0.1.136)', () => {
    it('usa el campo marcado por el backend, no el primero de texto', () => {
        const fields = [
            f({ id: 1, type: 'text' }),
            f({ id: 2, type: 'long_text', is_primary: true }),
        ];
        expect(titleFieldOf(fields)?.id).toBe(2);
    });

    it('sin marca, cae al primer campo de texto', () => {
        const fields = [f({ id: 1, type: 'number' }), f({ id: 2, type: 'text' })];
        expect(titleFieldOf(fields)?.id).toBe(2);
    });

    it('ignora una marca sobre un campo que no es de texto', () => {
        const fields = [
            f({ id: 1, type: 'currency', is_primary: true }),
            f({ id: 2, type: 'text' }),
        ];
        expect(titleFieldOf(fields)?.id).toBe(2);
    });

    it('sin campos de texto no hay título editable', () => {
        expect(titleFieldOf([f({ id: 1, type: 'date' })])).toBeUndefined();
        expect(titleFieldOf(undefined)).toBeUndefined();
    });
});
