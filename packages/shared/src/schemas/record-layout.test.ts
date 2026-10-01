import { describe, expect, it } from 'vitest';
import {
    autoRecordLayout,
    migrateCrmV2ToV3,
    normalizeWidths,
    type LayoutFieldLite,
} from '../templates/record-layout-builders';
import {
    FIELD_DISPLAYS,
    layoutBlocks,
    readRecordLayoutV3,
    recordLayoutV3Schema,
    resolveDisplay,
} from './record-layout';
import { FIELD_TYPES } from './field';

const F = (id: number, slug: string, type: LayoutFieldLite['type'], extra: Partial<LayoutFieldLite> = {}): LayoutFieldLite => ({
    id,
    slug,
    label: slug.replace(/_/g, ' '),
    type,
    ...extra,
});

const options = (n: number) => ({ options: Array.from({ length: n }, (_, i) => ({ value: `o${i}`, label: `O${i}` })) });

describe('plantillas v3 de la ficha', () => {
    it('todo tipo de campo tiene al menos una forma de mostrarse', () => {
        for (const t of FIELD_TYPES) expect(FIELD_DISPLAYS[t].length).toBeGreaterThan(0);
        expect(resolveDisplay('percent', 'ring')).toBe('ring');
        // Una forma que el tipo no admite cae a la de siempre.
        expect(resolveDisplay('text', 'ring')).toBe('text');
        expect(resolveDisplay('date', undefined)).toBe('date');
    });

    it('las columnas de una sección tienen que sumar 12', () => {
        const base = { v: 3, pages: [{ id: 'p', name: 'P', sections: [{ id: 's', columns: [8, 4], blocks: [[], []] }] }] };
        expect(recordLayoutV3Schema.safeParse(base).success).toBe(true);
        const bad = structuredClone(base);
        bad.pages[0]!.sections[0]!.columns = [8, 3];
        expect(recordLayoutV3Schema.safeParse(bad).success).toBe(false);
        const missing = structuredClone(base);
        missing.pages[0]!.sections[0]!.blocks = [[]];
        expect(recordLayoutV3Schema.safeParse(missing).success).toBe(false);
        expect(readRecordLayoutV3({ record_layout_v3: bad })).toBeNull();
        expect(readRecordLayoutV3({ record_layout_v3: base })?.pages).toHaveLength(1);
    });

    it('normaliza anchos a 12 respetando la proporción', () => {
        expect(normalizeWidths([6, 6])).toEqual([6, 6]);
        expect(normalizeWidths([4, 4])).toEqual([6, 6]);
        expect(normalizeWidths([8])).toEqual([12]);
        expect(normalizeWidths([12, 12, 12]).reduce((a, b) => a + b, 0)).toBe(12);
    });

    it('convierte una plantilla v2 sin perder bloques y traduce slugs a ids', () => {
        const fields = [F(1, 'nombre', 'text'), F(2, 'estado', 'select'), F(3, 'email', 'email'), F(4, 'facturas', 'relation'), F(5, 'monto', 'currency')];
        const v3 = migrateCrmV2ToV3(
            {
                header: { title_field_slug: 'nombre', status_field_slugs: ['estado'], quick_action_field_slugs: ['email'] },
                blocks: [
                    { id: 'h', type: 'header', x: 0, y: 0, w: 12, config: {} },
                    { id: 'g', type: 'properties_group', x: 0, y: 1, w: 8, pos: 0, config: { label: 'Datos', field_slugs: ['email', 'no_existe'] } },
                    { id: 't', type: 'timeline', x: 0, y: 1, w: 8, pos: 1, config: {} },
                    { id: 'k', type: 'kpi', x: 8, y: 1, w: 4, config: { field_slug: 'monto', goal_value: 1000 } },
                    { id: 'c', type: 'chart', x: 0, y: 2, w: 6, config: { relation_field_slug: 'facturas', group_by_field_slug: 'estado_factura' } },
                    { id: 'r', type: 'related', x: 6, y: 2, w: 6, config: { field_slug: 'facturas' } },
                    { id: 'n', type: 'nested_section', x: 0, y: 3, w: 12, config: { columns: [{ blocks: [{ id: 'd', type: 'divider', config: { label: 'x' } }] }] } },
                ],
            },
            fields,
        );
        expect(recordLayoutV3Schema.safeParse(v3).success).toBe(true);
        expect(v3.header.title_field_id).toBe(1);
        expect(v3.header.chip_field_ids).toEqual([2, 3]);
        const sections = v3.pages[0]!.sections;
        expect(sections.map((s) => s.columns)).toEqual([[8, 4], [6, 6], [12]]);
        expect(sections[0]!.blocks[0]!.map((b) => b.type)).toEqual(['fields', 'activity']);
        expect(sections[0]!.blocks[0]![0]!.config.field_ids).toEqual([3]);
        expect(sections[0]!.blocks[1]![0]).toMatchObject({ type: 'field', config: { field_id: 5, display: 'bar', goal: 1000 } });
        expect(sections[1]!.blocks[0]![0]!.config).toMatchObject({ source: { kind: 'related', field_id: 4 }, group_by_field_slug: 'estado_factura' });
        // La sub-sección se aplana en su columna; la cabecera no es un bloque.
        expect(sections[2]!.blocks[0]![0]!.type).toBe('divider');
        expect(layoutBlocks(v3).some((b) => (b.type as string) === 'header')).toBe(false);
    });

    it('cada plantilla integrada tiene su propia composición y su estilo (v0.1.235)', () => {
        const fields = [
            F(1, 'nombre', 'text', { is_primary: true }),
            F(2, 'monto', 'number'),
            F(3, 'total', 'currency'),
            F(4, 'inicio', 'date'),
            F(5, 'fin', 'date'),
            F(6, 'entrega', 'date'),
            F(7, 'email', 'email'),
            F(8, 'ciudad', 'text'),
            F(9, 'whatsapp', 'text'),
            F(10, 'etiquetas', 'multi_select', { config: options(2) }),
            F(11, 'renovacion', 'date'),
            F(12, 'activo', 'checkbox'),
            F(13, 'responsable', 'user'),
        ];
        const ids = (l: ReturnType<typeof autoRecordLayout>) => layoutBlocks(l).map((b) => b.id);
        const main = (l: ReturnType<typeof autoRecordLayout>) => l.pages[0]!.sections.find((x) => x.id === 'main')!;
        const all = (['auto', 'contact', 'deal', 'task', 'support'] as const).map((flavor) => autoRecordLayout({ fields, flavor }));
        const [auto, contact, deal, task, support] = all as [typeof all[0], typeof all[0], typeof all[0], typeof all[0], typeof all[0]];
        for (const l of all) expect(recordLayoutV3Schema.safeParse(l).success).toBe(true);
        // Elegir una u otra SE NOTA: ninguna composición se repite y cada una trae su tema.
        const signatures = all.map((l) => JSON.stringify(l.pages[0]!.sections.map((x) => [x.columns, x.blocks.map((c) => c.map((b) => b.id))])));
        expect(new Set(signatures).size).toBe(5);
        expect(all.map((l) => l.theme.preset)).toEqual(['default', 'fresh', 'corporate', 'minimal', 'warm']);

        // Automática: cifras con el dinero primero, sin el «Resumen» de contadores.
        expect(auto.pages[0]!.sections[0]!.blocks.flat().map((b) => b.config.field_id)).toEqual([3, 2]);
        expect(ids(auto)).not.toContain('stats');
        expect(auto.header.chip_field_ids).toContain(10);
        expect(main(auto).columns).toEqual([8, 4]);

        // Contacto: datos a la izquierda, la conversación al centro, sin cifras arriba.
        expect(main(contact).columns).toEqual([4, 8]);
        expect(main(contact).blocks[1]!.map((b) => b.id)).toEqual(['description', 'activity']);
        expect(contact.pages[0]!.sections).toHaveLength(1);
        expect(contact.header.subtitle_field_ids[0]).toBe(7);

        // Venta: el monto a media fila y el cierre como cuenta regresiva.
        const dealKpis = deal.pages[0]!.sections[0]!;
        expect(dealKpis.columns[0]).toBe(6);
        expect(dealKpis.blocks[0]![0]!.config).toMatchObject({ field_id: 3, display: 'big' });
        expect(layoutBlocks(deal).find((b) => b.config.display === 'countdown')?.config.field_id).toBe(5);

        // Tarea: plana, sin portada ni avatar, la persona como primera propiedad.
        expect(task.header.cover).toEqual({ kind: 'none' });
        expect(task.header.avatar).toEqual({ kind: 'none' });
        expect(task.header.chip_field_ids[0]).toBe(13);
        expect(main(task).blocks[1]![0]!.config.display).toBe('countdown');

        // Soporte: la conversación primero.
        expect(main(support).blocks[0]![0]!.type).toBe('activity');
    });

    it('la ficha automática arma cabecera, cifras, detalles y una pestaña por relación', () => {
        const fields = [
            F(1, 'nombre', 'text', { is_primary: true }),
            F(2, 'estado', 'select', { config: options(4) }),
            F(3, 'responsable', 'user'),
            F(4, 'vence', 'date'),
            F(5, 'monto', 'currency'),
            F(6, 'avance', 'percent'),
            F(7, 'email', 'email'),
            F(8, 'notas', 'long_text'),
            F(9, 'ciudad', 'text'),
            F(10, 'contrato', 'file'),
        ];
        const layout = autoRecordLayout({
            fields,
            relations: [
                {
                    relation_field_id: 50,
                    direction: 'reverse',
                    relation_label: 'Cliente',
                    other_list_name: 'Facturas',
                    other_fields: [F(51, 'numero', 'text', { is_primary: true }), F(52, 'total', 'currency'), F(53, 'estado', 'select', { config: options(3) }), F(54, 'fecha', 'date')],
                },
            ],
        });
        expect(recordLayoutV3Schema.safeParse(layout).success).toBe(true);
        expect(layout.header).toMatchObject({ title_field_id: 1, stages_field_id: 2 });
        expect(layout.header.chip_field_ids).toEqual([3, 4]);
        expect(layout.pages.map((p) => p.name)).toEqual(['Resumen', 'Facturas']);
        const summary = layout.pages[0]!;
        expect(summary.sections[0]!.blocks.flat().map((b) => b.config.display)).toEqual(['big', 'ring']);
        const rel = layoutBlocks({ pages: [layout.pages[1]!] });
        expect(rel.map((b) => `${b.type}:${String(b.config.kind ?? b.config.view)}`)).toEqual([
            'chart:kpi',
            'chart:kpi',
            'chart:pie',
            'chart:area',
            'related:table',
        ]);
        // Toda la pestaña lee de la relación, en el sentido correcto.
        for (const b of rel) expect(b.config.source).toEqual({ kind: 'related', field_id: 50, direction: 'reverse' });
        // Ningún campo aparece dos veces en el Resumen.
        const ids = layoutBlocks({ pages: [summary] }).flatMap((b) =>
            b.type === 'field' ? [b.config.field_id] : ((b.config.field_ids as number[] | undefined) ?? []),
        );
        expect(new Set(ids).size).toBe(ids.length);
    });
});
