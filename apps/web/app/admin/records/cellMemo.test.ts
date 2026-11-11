import { describe, expect, it } from 'vitest';

import type { FieldEntity } from '@/types/field';

import { editableCellPropsEqual, sameCellField } from './cellMemo';

const field = (over: Partial<FieldEntity> = {}): FieldEntity => ({
    id: 5,
    list_id: 1,
    slug: 'monto',
    label: 'Monto',
    type: 'currency',
    config: { precision: 2 },
    is_required: false,
    is_unique: false,
    is_primary: false,
    is_indexed: false,
    position: 1,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...over,
} as FieldEntity);

describe('memo de la celda — un cambio en la configuración del campo la vuelve a dibujar', () => {
    const base = { recordId: 1, listId: 1, value: 10, canEdit: true, lockedReason: null };

    it('mismo campo (misma referencia o las mismas propiedades): no se vuelve a dibujar', () => {
        const f = field();
        expect(editableCellPropsEqual({ ...base, field: f }, { ...base, field: f })).toBe(true);
        expect(sameCellField(f, { ...f })).toBe(true);
    });

    it('cambió la configuración (decimales, opciones…) con el MISMO id: se vuelve a dibujar', () => {
        const before = field();
        const after = field({ config: { precision: 0 }, updated_at: '2026-02-01T00:00:00' });
        expect(before.id).toBe(after.id);
        expect(editableCellPropsEqual({ ...base, field: before }, { ...base, field: after })).toBe(false);
    });

    it('cambió la etiqueta o pasó a obligatorio: se vuelve a dibujar', () => {
        expect(sameCellField(field(), field({ label: 'Valor' }))).toBe(false);
        expect(sameCellField(field(), field({ is_required: true }))).toBe(false);
    });

    it('el valor, el permiso y el candado siguen mandando', () => {
        const f = field();
        expect(editableCellPropsEqual({ ...base, field: f }, { ...base, field: f, value: 11 })).toBe(false);
        expect(editableCellPropsEqual({ ...base, field: f }, { ...base, field: f, canEdit: false })).toBe(false);
        expect(editableCellPropsEqual({ ...base, field: f }, { ...base, field: f, lockedReason: 'x' })).toBe(false);
    });

    it('el botón también mira la fila', () => {
        const f = field({ type: 'button' as FieldEntity['type'] });
        const row = { id: 1 };
        expect(editableCellPropsEqual({ ...base, field: f, record: row }, { ...base, field: f, record: row })).toBe(true);
        expect(editableCellPropsEqual({ ...base, field: f, record: row }, { ...base, field: f, record: { id: 1 } })).toBe(false);
    });
});
