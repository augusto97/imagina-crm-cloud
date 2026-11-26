import { describe, expect, it } from 'vitest';

import { readLayoutHints } from './layout-hints';
import { readRecordLayoutV3 } from './record-layout';
import { placedLayoutFieldIds, readShowUnplacedFields, readUnplacedFieldsOpen, unplacedLayoutFields } from './record-layout-unplaced';

const F = (id: number, slug: string, type = 'text', is_primary = false) => ({ id, slug, type, is_primary });

const FIELDS = [
    F(1, 'nombre', 'text', true),
    F(2, 'estado', 'select'),
    F(3, 'empresa'),
    F(4, 'responsable', 'user'),
    F(5, 'monto', 'currency'),
    F(6, 'notas', 'long_text'),
    F(7, 'contrato', 'file'),
    F(8, 'web', 'url'),
    F(9, 'costo', 'currency'),
    F(10, 'creado', 'created_at'),
    F(11, 'logo', 'url'),
];

const layout = (extra: Record<string, unknown> = {}) => ({
    v: 3,
    header: { subtitle_field_ids: [3], chip_field_ids: [4], stages_field_id: 2, cover: { kind: 'image', image_field_id: 11 } },
    pages: [
        { id: 'p1', name: 'Resumen', sections: [{ id: 's1', columns: [12], blocks: [[{ id: 'b1', type: 'field', config: { field_id: 5 } }]] }] },
        {
            id: 'p2',
            name: 'Más',
            sections: [
                { id: 's2', columns: [6, 6], blocks: [[{ id: 'b2', type: 'files', config: {} }], [{ id: 'b3', type: 'button', config: { target_field_id: 8 } }]] },
            ],
        },
    ],
    ...extra,
});

describe('campos sin ubicar en la ficha', () => {
    it('cabecera, chips, etapas, varias pestañas, archivos y botones cuentan como ubicados', () => {
        const placed = placedLayoutFieldIds(layout(), FIELDS);
        for (const id of [2, 3, 4, 5, 7, 8, 10, 11]) expect(placed.has(id), String(id)).toBe(true);
        // El título nunca se cuenta: va arriba de todo.
        expect(unplacedLayoutFields(layout(), FIELDS).map((f) => f.id)).toEqual([6, 9]);
    });

    it('lo oculto para quien mira no aparece', () => {
        expect(unplacedLayoutFields(layout(), FIELDS, { hiddenSlugs: ['costo'] }).map((f) => f.slug)).toEqual(['notas']);
    });

    it('el título del diseño manda sobre el de la lista', () => {
        const withTitle = layout({ header: { title_field_id: 6 } });
        // «nombre» deja de ser el título y aparece; «creado» sigue en la
        // cabecera (creado y actualizado) y los archivos y la web en sus bloques.
        expect(unplacedLayoutFields(withTitle, FIELDS).map((f) => f.id)).toEqual([1, 2, 3, 4, 9, 11]);
    });

    it('sin creado y actualizado en la cabecera, las fechas de sistema son un campo más', () => {
        const noMeta = layout({ header: { show_meta: false, subtitle_field_ids: [3], chip_field_ids: [4], stages_field_id: 2 } });
        expect(unplacedLayoutFields(noMeta, FIELDS).map((f) => f.id)).toEqual([6, 9, 10, 11]);
    });

    it('apagada, no hay nada (salvo que se pida para el editor)', () => {
        const off = layout({ show_unplaced_fields: false });
        expect(unplacedLayoutFields(off, FIELDS)).toEqual([]);
        expect(unplacedLayoutFields(off, FIELDS, { ignoreSetting: true }).map((f) => f.id)).toEqual([6, 9]);
        expect(unplacedLayoutFields(null, FIELDS)).toEqual([]);
    });

    it('lectura tolerante: sin el dato, se muestra y empieza plegada', () => {
        expect(readShowUnplacedFields({})).toBe(true);
        expect(readShowUnplacedFields(null)).toBe(true);
        expect(readShowUnplacedFields({ show_unplaced_fields: 'no' })).toBe(true);
        expect(readShowUnplacedFields({ show_unplaced_fields: false })).toBe(false);
        expect(readUnplacedFieldsOpen({})).toBe(false);
        expect(readUnplacedFieldsOpen(undefined)).toBe(false);
        expect(readUnplacedFieldsOpen({ unplaced_fields_open: 'yes' })).toBe(false);
        expect(readUnplacedFieldsOpen({ unplaced_fields_open: true })).toBe(true);
    });

    it('un valor raro guardado no tumba el diseño', () => {
        const parsed = readRecordLayoutV3({ record_layout_v3: layout({ show_unplaced_fields: 'raro', unplaced_fields_open: 3 }) });
        expect(parsed).not.toBeNull();
        expect(readShowUnplacedFields(parsed)).toBe(true);
        expect(readUnplacedFieldsOpen(parsed)).toBe(false);
        const open = readRecordLayoutV3({ record_layout_v3: layout({ show_unplaced_fields: true, unplaced_fields_open: true }) });
        expect(readUnplacedFieldsOpen(open)).toBe(true);
    });

    it('lo descartado de la tarjeta se lee con tolerancia', () => {
        expect(readLayoutHints(undefined)).toEqual({ dismissed_lists: [] });
        expect(readLayoutHints({ dismissed_lists: [3, 'x', 4] })).toEqual({ dismissed_lists: [3, 4] });
        expect(readLayoutHints({ dismissed_lists: [5] })).toEqual({ dismissed_lists: [5] });
    });
});
