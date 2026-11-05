import { describe, expect, it } from 'vitest';
import { COLLECTION_FIELD_TYPES, setCollectionFieldsSchema, suggestCollectionFields } from './collections';

describe('columnas de cobro (v0.1.365)', () => {
    const fields = [
        { id: 1, label: 'Cliente', type: 'text' },
        { id: 2, label: 'Link de pago', type: 'url' },
        { id: 3, label: 'Pagos recientes', type: 'date' },
        { id: 4, label: 'Fecha de Pago', type: 'date' },
        { id: 5, label: 'Estado del pago', type: 'select', config: { options: [{ value: 'si', label: 'Sí' }] } },
        { id: 6, label: 'Medio de pago', type: 'text' },
    ];

    it('usa las columnas que la lista ya tiene por nombre y tipo, sin acentos ni mayúsculas', () => {
        const s = suggestCollectionFields(fields, null);
        expect(s.link).toBe(2);
        expect(s.paid_at).toBe(4);
        expect(s.method).toBe(6);
        // Un estado en una lista de opciones sin los estados del pago no se adopta:
        // cada valor que se escribe se saltearía.
        expect(s.status).toBeNull();
        expect(s.paid_amount).toBeNull();
    });

    it('un estado que ya tiene «pendiente» y «pagado» sí se adopta', () => {
        const withOptions = fields.map((f) =>
            f.id === 5 ? { ...f, config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagado', label: 'Pagado' }] } } : f,
        );
        expect(suggestCollectionFields(withOptions, null).status).toBe(5);
    });

    it('respeta lo ya elegido, olvida columnas borradas y no usa una columna para dos datos', () => {
        const s = suggestCollectionFields(fields, { link: 99, status: null, paid_at: 3, paid_amount: null, method: null });
        expect(s.link).toBe(2); // la 99 ya no existe: se vuelve a sugerir
        expect(s.paid_at).toBe(3); // elegida a mano (no la de nombre «Fecha de Pago»)
        const one = suggestCollectionFields([{ id: 7, label: 'Link de pago', type: 'text' }], null);
        expect(one.link).toBe(7);
        expect(one.method).toBeNull();
    });

    it('los tipos que sirven y lo que se puede mandar', () => {
        expect(COLLECTION_FIELD_TYPES.paid_at).toContain('date');
        expect(COLLECTION_FIELD_TYPES.link).not.toContain('number');
        expect(setCollectionFieldsSchema.parse({ link: 2, status: 'create', paid_at: null })).toEqual({ link: 2, status: 'create', paid_at: null });
        expect(setCollectionFieldsSchema.safeParse({ link: 'otra' }).success).toBe(false);
    });
});
