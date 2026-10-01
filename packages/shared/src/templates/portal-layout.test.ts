import { describe, expect, it } from 'vitest';
import { layoutBlocks, recordLayoutV3Schema } from '../schemas/record-layout';
import {
    autoPortalLayout,
    migratePortalTemplateToV3,
    portalEditableFieldIds,
    sanitizePortalLayout,
} from './portal-layout';
import type { LayoutFieldLite } from './record-layout-builders';

const FIELDS: LayoutFieldLite[] = [
    { id: 1, slug: 'nombre', label: 'Nombre', type: 'text', is_primary: true },
    { id: 2, slug: 'email', label: 'Email', type: 'email' },
    { id: 3, slug: 'cupo', label: 'Cupo', type: 'currency' },
    { id: 4, slug: 'contrato', label: 'Contrato', type: 'file' },
    { id: 5, slug: 'socio', label: 'Socio', type: 'relation', config: { target_list_id: 30 } },
    { id: 6, slug: 'total', label: 'Total', type: 'computed', config: { operation: 'sum' } },
];

const CTX = {
    listId: 10,
    fields: FIELDS,
    otherLists: [
        // Facturas apunta a esta lista: se lee "hacia adentro".
        {
            id: 20,
            slug: 'facturas',
            fields: [
                { id: 21, slug: 'monto', label: 'Monto', type: 'currency' as const },
                { id: 22, slug: 'cliente', label: 'Cliente', type: 'relation' as const, config: { target_list_id: 10 } },
            ],
        },
        // Esta lista apunta a Socios: se lee "hacia afuera".
        { id: 30, slug: 'socios', fields: [{ id: 31, slug: 'razon', label: 'Razón', type: 'text' as const }] },
        // Sin relación: fuente `list` (el servidor la acota al cliente).
        { id: 40, slug: 'tickets', fields: [{ id: 41, slug: 'quien', label: 'Quién', type: 'user' as const }] },
    ],
};

describe('portal v3 (v0.1.233)', () => {
    it('convierte la plantilla anterior: filas a secciones, slugs a ids, fuentes por relación', () => {
        const v3 = migratePortalTemplateToV3(
            {
                page: { bg: '#f1f5f9' },
                blocks: [
                    { type: 'hero', config: { title: 'Hola', subtitle: 'Bienvenido', cta_href: 'https://acme.test', cta_label: 'Ver' } },
                    { type: 'client_data', x: 0, y: 10, w: 6, config: { visible_field_slugs: ['nombre', 'email', 'fantasma'] } },
                    { type: 'editable_form', x: 6, y: 10, w: 6, config: { editable_field_slugs: ['email', 'cupo'] } },
                    { type: 'related_records_table', config: { list_slug: 'facturas', visible_field_slugs: ['monto'] } },
                    { type: 'related_records_table', config: { list_slug: 'socios' } },
                    { type: 'related_records_table', config: { list_slug: 'tickets' } },
                    { type: 'related_records_table', config: { list_slug: 'no-existe' } },
                    { type: 'faq', config: { items: [{ question: '¿Cuándo?', answer: 'Mañana' }] } },
                ],
            },
            CTX,
        )!;
        expect(recordLayoutV3Schema.safeParse(v3).success).toBe(true);
        expect((v3 as Record<string, unknown>).page).toEqual({ bg: '#f1f5f9' });
        expect((v3.header as Record<string, unknown>).hidden).toBe(true);
        const [first, second] = v3.pages[0]!.sections;
        expect(first!.blocks[0]!.map((b) => b.type)).toEqual(['heading', 'button']);
        // Dos bloques lado a lado en la misma fila → una sección de dos columnas.
        expect(second!.columns).toEqual([6, 6]);
        expect(second!.blocks[0]![0]!.config.field_ids).toEqual([1, 2]);
        expect(second!.blocks[1]![0]!.config).toMatchObject({ field_ids: [2, 3], editable: true });
        const related = layoutBlocks(v3).filter((b) => b.type === 'related');
        expect(related.map((b) => b.config.source)).toEqual([
            { kind: 'related', field_id: 22, direction: 'reverse' },
            { kind: 'related', field_id: 5 },
            { kind: 'list', list_id: 40 },
        ]);
        expect(related[0]!.config.field_ids).toEqual([21]);
        expect(layoutBlocks(v3).at(-1)).toMatchObject({ type: 'text', config: { content: '**¿Cuándo?**\nMañana' } });
    });

    it('un grid de cifras se reparte en columnas y sin bloques no hay diseño', () => {
        const v3 = migratePortalTemplateToV3(
            [
                {
                    type: 'stats_grid',
                    config: {
                        items: [
                            { label: 'Facturas', metric: 'count', list_slug: 'facturas' },
                            { label: 'Facturado', metric: 'sum', list_slug: 'facturas', field_id: 21 },
                            { label: 'Plan', metric: 'static', value: 'Pro' },
                        ],
                    },
                },
            ],
            CTX,
        )!;
        const [section] = v3.pages[0]!.sections;
        expect(section!.columns).toEqual([4, 4, 4]);
        expect(section!.blocks[1]![0]!.config).toMatchObject({ kind: 'kpi', metric: 'sum', metric_field_id: 21 });
        expect(migratePortalTemplateToV3({ blocks: [] }, CTX)).toBeNull();
        expect(migratePortalTemplateToV3(null, CTX)).toBeNull();
    });

    it('editables: sólo bloques marcados y sólo tipos que el cliente puede escribir', () => {
        const layout = {
            pages: [
                {
                    id: 'p',
                    name: 'P',
                    sections: [
                        {
                            id: 's',
                            columns: [12],
                            blocks: [
                                [
                                    { id: 'a', type: 'fields' as const, config: { field_ids: [1, 2, 4, 6], editable: true } },
                                    { id: 'b', type: 'field' as const, config: { field_id: 3 } },
                                    { id: 'c', type: 'field' as const, config: { field_id: 3, editable: 'yes' } },
                                ],
                            ],
                        },
                    ],
                },
            ],
        };
        // Archivo y calculado no se escriben desde el portal; el resto del bloque sí.
        expect([...portalEditableFieldIds(layout, FIELDS)].sort()).toEqual([1, 2]);
    });

    it('el automático es válido y de sólo lectura; sanitize saca lo que el portal no dibuja', () => {
        const auto = autoPortalLayout(FIELDS);
        expect(recordLayoutV3Schema.safeParse(auto).success).toBe(true);
        expect(portalEditableFieldIds(auto, FIELDS).size).toBe(0);
        // v0.1.237 — el automático es «Mi cuenta» de sólo lectura: cifras + datos + archivos.
        expect(layoutBlocks(auto).map((b) => b.type)).toEqual(['field', 'fields', 'files']);
        const withAdminBlocks = {
            ...auto,
            pages: [{ id: 'p', name: 'P', sections: [{ id: 's', columns: [12], blocks: [[{ id: 'x', type: 'portal_access' as const, config: {} }, { id: 'y', type: 'heading' as const, config: {} }]] }] }],
        };
        expect(layoutBlocks(sanitizePortalLayout(withAdminBlocks)).map((b) => b.id)).toEqual(['y']);
    });
});
