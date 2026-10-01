import { describe, expect, it } from 'vitest';
import { layoutBlocks, recordLayoutV3Schema, type RecordLayoutV3 } from '../schemas/record-layout';
import { autoPortalLayout, portalEditableFieldIds } from './portal-layout';
import {
    PORTAL_TEMPLATE_KINDS,
    portalLinkedColumns,
    portalTemplateFit,
    portalTemplateLayout,
    suggestPortalLinked,
    type PortalLinkedList,
} from './portal-templates';
import type { LayoutFieldLite } from './record-layout-builders';

const STATUS_OPTS = { options: [{ value: 'activo', label: 'Activo' }, { value: 'en_pausa', label: 'En pausa' }, { value: 'cerrado', label: 'Cerrado' }] };

const CLIENT: LayoutFieldLite[] = [
    { id: 1, slug: 'nombre', label: 'Nombre', type: 'text', is_primary: true },
    { id: 2, slug: 'email', label: 'Email', type: 'email' },
    { id: 3, slug: 'whatsapp', label: 'WhatsApp', type: 'phone' },
    { id: 4, slug: 'plan', label: 'Plan', type: 'select', config: { options: [{ value: 'basico', label: 'Básico' }] } },
    { id: 5, slug: 'cuota', label: 'Cuota mensual', type: 'currency' },
    { id: 6, slug: 'proximo_cobro', label: 'Próximo cobro', type: 'date' },
    { id: 7, slug: 'contrato', label: 'Contrato', type: 'file' },
    { id: 8, slug: 'asesor', label: 'Asesor', type: 'user' },
    { id: 9, slug: 'costo_interno', label: 'Costo interno', type: 'currency' },
    { id: 10, slug: 'saldo', label: 'Saldo', type: 'rollup' },
    { id: 11, slug: 'notas_internas', label: 'Notas internas', type: 'long_text' },
    { id: 12, slug: 'direccion', label: 'Dirección', type: 'text' },
];

const INVOICES: PortalLinkedList = {
    key: 'rel:52:reverse',
    list_id: 50,
    name: 'Facturas',
    source: { kind: 'related', field_id: 52, direction: 'reverse' },
    fields: [
        { id: 51, slug: 'numero', label: 'Número', type: 'text', is_primary: true },
        { id: 52, slug: 'cliente', label: 'Cliente', type: 'relation', config: { target_list_id: 10 } },
        { id: 53, slug: 'estado', label: 'Estado', type: 'select', config: { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'vencida', label: 'Vencida' }, { value: 'pagada', label: 'Pagada' }] } },
        { id: 54, slug: 'total', label: 'Total', type: 'currency' },
        { id: 55, slug: 'vence', label: 'Vencimiento', type: 'date' },
        { id: 56, slug: 'pdf', label: 'PDF', type: 'file' },
        { id: 57, slug: 'margen', label: 'Margen', type: 'currency' },
    ],
};

const TICKETS: PortalLinkedList = {
    key: 'list:60',
    list_id: 60,
    name: 'Tickets',
    source: { kind: 'list', list_id: 60 },
    fields: [
        { id: 61, slug: 'asunto', label: 'Asunto', type: 'text', is_primary: true },
        { id: 62, slug: 'estado', label: 'Estado', type: 'select', config: { options: [{ value: 'abierto', label: 'Abierto' }, { value: 'en_curso', label: 'En curso' }, { value: 'resuelto', label: 'Resuelto' }] } },
        { id: 63, slug: 'prioridad', label: 'Prioridad', type: 'select' },
        { id: 64, slug: 'quien', label: 'Quién', type: 'user' },
    ],
};

const COMMISSIONS: PortalLinkedList = {
    key: 'rel:72:reverse',
    list_id: 70,
    name: 'Comisiones',
    source: { kind: 'related', field_id: 72, direction: 'reverse' },
    fields: [
        { id: 71, slug: 'vendedor', label: 'Vendedor', type: 'text', is_primary: true },
        { id: 73, slug: 'valor', label: 'Valor', type: 'currency' },
    ],
};

/** Los ids de campo que usa un diseño (propios y de otras listas). */
function referenced(layout: RecordLayoutV3): number[] {
    const out: number[] = [];
    const h = layout.header;
    out.push(...h.subtitle_field_ids, ...h.chip_field_ids);
    if (h.stages_field_id) out.push(h.stages_field_id);
    for (const b of layoutBlocks(layout)) {
        const c = b.config as Record<string, unknown>;
        for (const k of ['field_id', 'metric_field_id', 'group_by_field_id', 'group_field_id', 'sort_field_id']) if (typeof c[k] === 'number') out.push(c[k] as number);
        if (Array.isArray(c.field_ids)) out.push(...(c.field_ids as number[]));
    }
    return out;
}

const signature = (l: RecordLayoutV3): string =>
    l.pages[0]!.sections.map((s) => `${s.id}:${s.columns.join('-')}:${s.blocks.flat().map((b) => b.type).join(',')}`).join('|');

describe('plantillas del portal (v0.1.237)', () => {
    const linked = [INVOICES, TICKETS];
    const all = PORTAL_TEMPLATE_KINDS.map((k) => portalTemplateLayout(k, { fields: CLIENT, linked }));

    it('las cinco son válidas, distintas y con el nombre de su página', () => {
        for (const l of all) expect(recordLayoutV3Schema.safeParse(l).success).toBe(true);
        expect(new Set(all.map(signature)).size).toBe(5);
        expect(all.map((l) => l.pages[0]!.name)).toEqual(['Mi cuenta', 'Estado de cuenta', 'Mi proyecto', 'Mis solicitudes', 'Mi pedido']);
        // Usan el color de la marca: ninguna fija un acento propio.
        for (const l of all) expect(l.theme.accent).toBeUndefined();
        expect(all.every((l) => l.header.show_meta === false)).toBe(true);
    });

    it('nunca muestran personas, relaciones, calculados ni lo que suena interno', () => {
        const forbidden = [8, 9, 10, 11, 52, 57, 64];
        for (const l of all) {
            const ids = referenced(l);
            expect(ids.filter((id) => forbidden.includes(id))).toEqual([]);
        }
        expect(layoutBlocks(all[0]!).some((b) => b.type === 'description' || b.type === 'record_stats' || b.type === 'portal_access')).toBe(false);
    });

    it('«Mi cuenta»: sólo los datos de contacto son editables; el automático, nada', () => {
        const account = all[0]!;
        expect([...portalEditableFieldIds(account, CLIENT)].sort((a, b) => a - b)).toEqual([2, 3, 12]);
        expect(layoutBlocks(account).some((b) => b.type === 'comments')).toBe(true);
        const linkedBlocks = layoutBlocks(account).filter((b) => b.type === 'related');
        expect(linkedBlocks.map((b) => (b.config as { view: string }).view)).toEqual(['cards', 'list']);

        const auto = autoPortalLayout(CLIENT);
        expect(recordLayoutV3Schema.safeParse(auto).success).toBe(true);
        expect(portalEditableFieldIds(auto, CLIENT).size).toBe(0);
        expect(layoutBlocks(auto).some((b) => b.type === 'comments' || b.type === 'related')).toBe(false);
    });

    it('«Estado de cuenta»: saldo pendiente y pagado por estado, y la tabla con el comprobante', () => {
        const st = all[1]!;
        const blocks = layoutBlocks(st);
        const pending = blocks.find((b) => b.id === 'kpi-pending')!.config as Record<string, unknown>;
        expect(pending).toMatchObject({ metric: 'sum', metric_field_id: 54 });
        expect((pending.filter_tree as { children: Array<{ value: string[] }> }).children[0]!.value).toEqual(['pendiente', 'vencida']);
        const paid = blocks.find((b) => b.id === 'kpi-paid')!.config as { filter_tree: { children: Array<{ value: string[] }> } };
        expect(paid.filter_tree.children[0]!.value).toEqual(['pagada']);
        expect(blocks.find((b) => b.id === 'card-countdown-6')).toBeTruthy();
        const table = blocks.find((b) => b.id === 'invoices')!.config as { view: string; field_ids: number[]; source: unknown };
        expect(table.view).toBe('table');
        expect(table.field_ids).toEqual([51, 55, 54, 53, 56]);
        expect(table.source).toEqual(INVOICES.source);
        expect(st.pages[0]!.sections[0]!.style).toEqual({ tone: 'accent' });
        expect(st.theme.surface).toBe('outlined');
    });

    it('«Mis solicitudes»: abiertas = no cerradas, y el tablero por estado', () => {
        const sup = all[3]!;
        const open = layoutBlocks(sup).find((b) => b.id === 'kpi-open')!.config as { filter_tree: { children: Array<{ op: string; value: string[] }> } };
        expect(open.filter_tree.children[0]).toMatchObject({ op: 'nin', value: ['resuelto'] });
        const board = layoutBlocks(sup).find((b) => b.id === 'cases')!.config as { view: string; group_field_id: number };
        expect(board).toMatchObject({ view: 'board', group_field_id: 62 });
        expect(sup.pages[0]!.sections[0]!.style).toEqual({ tone: 'muted' });
    });

    it('«Mi proyecto» y «Mi pedido» llevan las etapas en la cabecera cuando el registro las tiene', () => {
        const project: LayoutFieldLite[] = [
            { id: 1, slug: 'nombre', label: 'Proyecto', type: 'text', is_primary: true },
            { id: 2, slug: 'estado', label: 'Estado', type: 'select', config: STATUS_OPTS },
            { id: 3, slug: 'avance', label: 'Avance', type: 'percent' },
            { id: 4, slug: 'entrega', label: 'Fecha de entrega', type: 'date' },
            { id: 5, slug: 'total', label: 'Total', type: 'currency' },
        ];
        const p = portalTemplateLayout('project', { fields: project });
        expect(p.header.stages_field_id).toBe(2);
        expect(layoutBlocks(p).filter((b) => b.type === 'field').map((b) => (b.config as { display: string }).display)).toEqual(['ring', 'countdown', 'big']);

        const lines: PortalLinkedList = {
            key: 'rel:82:reverse',
            list_id: 80,
            name: 'Líneas del pedido',
            source: { kind: 'related', field_id: 82, direction: 'reverse' },
            fields: [
                { id: 81, slug: 'producto', label: 'Producto', type: 'text', is_primary: true },
                { id: 83, slug: 'cantidad', label: 'Cantidad', type: 'number' },
                { id: 84, slug: 'precio', label: 'Precio', type: 'currency' },
            ],
        };
        const o = portalTemplateLayout('order', { fields: project, linked: [lines] });
        expect(o.header.stages_field_id).toBe(2);
        expect(o.header.avatar).toEqual({ kind: 'none' });
        const table = layoutBlocks(o).find((b) => b.id === 'lines')!.config as { field_ids: number[] };
        expect(table.field_ids).toEqual([81, 83, 84]);
    });

    it('qué marcar de entrada y cuándo una plantilla no aplica', () => {
        const linked3 = [INVOICES, TICKETS, COMMISSIONS];
        // Lo central de la plantilla + lo que el admin ya habilitó; Comisiones no.
        expect(suggestPortalLinked('statement', linked3)).toEqual(['rel:52:reverse']);
        expect(suggestPortalLinked('support', linked3, [50])).toEqual(['list:60']);
        expect(suggestPortalLinked('account', linked3)).toEqual([]);
        expect(suggestPortalLinked('account', linked3, [50, 70])).toEqual(['rel:52:reverse', 'rel:72:reverse']);
        expect(portalTemplateFit('statement', { fields: CLIENT, linked: [TICKETS] }).ok).toBe(false);
        expect(portalTemplateFit('statement', { fields: CLIENT, linked: [INVOICES] }).ok).toBe(true);
        expect(portalTemplateFit('support', { fields: CLIENT }).ok).toBe(false);
        expect(portalLinkedColumns(INVOICES).map((f) => f.slug)).toEqual(['numero', 'vence', 'total', 'estado']);
    });
});
