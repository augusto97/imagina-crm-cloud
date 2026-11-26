import { describe, expect, it } from 'vitest';

import { layoutDataBlocks, layoutDataSig } from './record-layout-data-blocks';
import { autoRecordLayout, type LayoutFieldLite } from './record-layout-builders';
import {
    INTEGRATED_LAYOUT_RELATIONS,
    integratedLayoutFlavor,
    integratedRecordLayout,
    toLayoutFieldLite,
    type LayoutRelationPathLite,
} from './record-layout-integrated';

const field = (id: number, label: string, type: LayoutFieldLite['type'], config?: Record<string, unknown>): LayoutFieldLite => ({
    id,
    slug: label.toLowerCase(),
    label,
    type,
    config,
});

const clientes = [field(1, 'Nombre', 'text'), field(2, 'Correo', 'email'), field(3, 'Ciudad', 'text')];
const facturas = [
    field(10, 'Número', 'text'),
    field(11, 'Valor', 'currency', { currency: 'COP' }),
    field(12, 'Estado', 'select', { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagada', label: 'Pagada' }] }),
    field(13, 'Fecha', 'date'),
];
const path = (id: number, other: number, name: string): LayoutRelationPathLite => ({
    relation_field_id: id,
    direction: 'reverse',
    relation_label: 'Cliente',
    other_list_id: other,
    other_list_name: name,
});

describe('integratedLayoutFlavor', () => {
    it('la plantilla elegida, «auto» si no hay una conocida y null para el editor anterior', () => {
        expect(integratedLayoutFlavor({ crm_template_id: 'deal' })).toBe('deal');
        expect(integratedLayoutFlavor({ crm_template_id: 'support' })).toBe('support');
        expect(integratedLayoutFlavor({ crm_template_id: 'raro' })).toBe('auto');
        expect(integratedLayoutFlavor({})).toBe('auto');
        expect(integratedLayoutFlavor(null)).toBe('auto');
        expect(integratedLayoutFlavor({ crm_template_id: 'custom' })).toBeNull();
        // «Probar» manda sobre lo guardado.
        expect(integratedLayoutFlavor({ crm_template_id: 'custom' }, 'task')).toBe('task');
    });
});

describe('integratedRecordLayout', () => {
    it('es la ficha automática con los campos de cada lista del otro lado', () => {
        const layout = integratedRecordLayout({
            flavor: 'contact',
            fields: clientes,
            paths: [path(20, 7, 'Facturas')],
            otherFields: (id) => (id === 7 ? facturas : []),
        });
        const direct = autoRecordLayout({
            fields: clientes,
            flavor: 'contact',
            relations: [
                { relation_field_id: 20, direction: 'reverse', relation_label: 'Cliente', other_list_name: 'Facturas', other_fields: facturas },
            ],
        });
        expect(layout).toEqual(direct);
        // Hay bloques con datos del servidor (gráficos y vinculados de las facturas).
        expect(layoutDataBlocks(layout).length).toBeGreaterThan(0);
    });

    it(`mira las primeras ${INTEGRATED_LAYOUT_RELATIONS} relaciones, como el bundle de la ficha`, () => {
        const asked: number[] = [];
        integratedRecordLayout({
            flavor: 'auto',
            fields: clientes,
            paths: [1, 2, 3, 4, 5, 6].map((i) => path(100 + i, i, `Lista ${i}`)),
            otherFields: (id) => {
                asked.push(id);
                return facturas;
            },
        });
        expect(asked).toEqual([1, 2, 3, 4]);
    });

    it('arma lo mismo el navegador y el servidor: la firma de los bloques coincide', () => {
        const mk = () =>
            layoutDataSig(
                layoutDataBlocks(
                    integratedRecordLayout({
                        flavor: 'deal',
                        fields: clientes.map((f) => toLayoutFieldLite({ ...f, is_primary: f.id === 1 })),
                        paths: [path(20, 7, 'Facturas')],
                        otherFields: () => facturas,
                    }),
                ),
            );
        expect(mk()).toBe(mk());
    });
});

describe('layoutDataBlocks', () => {
    it('sólo los gráficos y los vinculados, sin el resto de los bloques', () => {
        const blocks = layoutDataBlocks(
            integratedRecordLayout({ flavor: 'contact', fields: clientes, paths: [path(20, 7, 'Facturas')], otherFields: () => facturas }),
        );
        expect(blocks.every((b) => b.type === 'chart' || b.type === 'related')).toBe(true);
        expect(blocks.every((b) => typeof b.id === 'string' && b.id.length > 0)).toBe(true);
    });
});
