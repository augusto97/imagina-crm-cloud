import { describe, expect, it } from 'vitest';
import { buildDraftPlan, profileSheet, type DashboardTemplateSummary } from '@imagina-base/shared';

import { buildRecommendations, type RecList } from './recommendations';
import { keepUserEdits, patchEntity, patchField, patchList, previewCell } from './planEdit';

const H = ['Nombre', 'Correo', 'Estado', 'Vence', 'Valor'];
const ROWS = Array.from({ length: 12 }, (_, i) => [`Cliente ${i}`, `c${i}@x.co`, i % 2 ? 'Pagada' : 'Pendiente', `0${(i % 9) + 1}/03/2026`, String(1000 * (i + 1))]);

function setup() {
    const profile = profileSheet(0, '', H, ROWS, { numberFormat: 'dot_comma', dateFormat: 'dmy' });
    profile.preview = ROWS.slice(0, 5);
    const plan = buildDraftPlan([{ profile, rows: ROWS }], { fileName: 'cartera.xlsx' });
    return { profile, plan };
}

describe('v0.1.339 — editar el plan', () => {
    it('cambiar el tipo rearma lo que el tipo necesita (opciones desde el perfil)', () => {
        const { profile, plan } = setup();
        expect(plan.lists[0]!.fields[2]!.type).toBe('select');
        const asText = patchField(plan, [profile], 0, 2, { type: 'text' }, { currency: 'COP', country: 'CO' });
        expect(asText.lists[0]!.fields[2]).toMatchObject({ type: 'text' });
        expect(asText.lists[0]!.fields[2]!.options).toBeUndefined();
        const back = patchField(asText, [profile], 0, 2, { type: 'select' }, { currency: 'COP', country: 'CO' });
        expect(back.lists[0]!.fields[2]!.options!.map((o) => o.label).sort()).toEqual(['Pagada', 'Pendiente']);
        expect(plan.lists[0]!.fields[4]!.type).toBe('currency');
        const asNumber = patchField(plan, [profile], 0, 4, { type: 'number' }, { currency: 'MXN', country: 'MX' });
        const money = patchField(asNumber, [profile], 0, 4, { type: 'currency' }, { currency: 'MXN', country: 'MX' });
        expect(money.lists[0]!.fields[4]).toMatchObject({ type: 'currency', currency: 'MXN' });
    });

    it('renombrar recalcula el nombre interno sin chocar con otro', () => {
        const { profile, plan } = setup();
        const p = patchField(plan, [profile], 0, 1, { label: 'Nombre' }, { currency: 'COP', country: 'CO' });
        expect(p.lists[0]!.fields[1]!.slug).toBe('nombre_2');
    });

    it('elegir otro título lo incluye y apaga una separación que se lo llevaría', () => {
        const { plan } = setup();
        const withEntity = { ...plan, entities: [{ key: 'x', name: 'X', sheet: 0, key_column: 1, columns: [2], include: true, link_label: 'X', link_slug: 'x', records: 3 }] };
        const off = patchField(withEntity, [], 0, 1, { include: false }, { currency: 'COP', country: 'CO' });
        const p = patchList(off, 0, { title_column: 1 });
        expect(p.lists[0]!.title_column).toBe(1);
        expect(p.lists[0]!.fields[1]!.include).toBe(true);
        expect(p.entities[0]!.include).toBe(false);
        expect(patchEntity(p, 0, 1, { include: true }).entities[0]!.include).toBe(true);
    });

    it('la vista previa muestra el valor como va a quedar y marca lo que no encaja', () => {
        const { plan } = setup();
        const f = plan.lists[0]!.fields;
        expect(previewCell(f[2]!, 'PAGADA')).toEqual({ text: 'Pagada', ok: true });
        expect(previewCell(f[3]!, '05/03/2026')).toEqual({ text: '2026-03-05', ok: true });
        expect(previewCell(f[4]!, '$ 1.500')).toEqual({ text: '1500', ok: true });
        expect(previewCell(f[4]!, 'mucho')).toEqual({ text: 'mucho', ok: false });
        expect(previewCell(f[1]!, 'no-es-correo').ok).toBe(false);
    });
});

describe('v0.1.339 — la mejora con IA respeta lo editado a mano', () => {
    it('lo que la persona cambió se queda; lo que no tocó toma la propuesta de la IA', () => {
        const { profile, plan: base } = setup();
        const opts = { currency: 'COP', country: 'CO' };
        // La persona renombra la lista y una columna, y descarta el correo.
        let ours = patchList(base, 0, { name: 'Mi cartera' });
        ours = patchField(ours, [profile], 0, 0, { label: 'Cliente' }, opts);
        ours = patchField(ours, [profile], 0, 1, { include: false }, opts);
        // La IA propone otros nombres para la lista, el nombre y el estado.
        const theirs = {
            ...base,
            ai_used: true,
            lists: base.lists.map((l) => ({
                ...l,
                name: 'Facturas',
                fields: l.fields.map((f) => (f.column === 0 ? { ...f, label: 'Razón social', slug: 'razon_social' } : f.column === 2 ? { ...f, label: 'Estado de pago', slug: 'cliente' } : f)),
            })),
        };
        const merged = keepUserEdits(base, ours, theirs);
        const l = merged.lists[0]!;
        expect(merged.ai_used).toBe(true);
        expect(l.name).toBe('Mi cartera');
        expect(l.fields[0]!.label).toBe('Cliente');
        expect(l.fields[1]!.include).toBe(false);
        expect(l.fields[2]!.label).toBe('Estado de pago');
        // El nombre interno que eligió la IA chocaba con el de la persona: se vuelve único.
        expect(new Set(l.fields.map((f) => f.slug)).size).toBe(l.fields.length);
    });
});

describe('v0.1.339 — recomendaciones', () => {
    const list: RecList = {
        id: 7,
        slug: 'cartera',
        name: 'Cartera',
        fields: [
            { id: 1, slug: 'nombre', label: 'Nombre', type: 'text' },
            { id: 2, slug: 'estado', label: 'Estado', type: 'select' },
            { id: 5, slug: 'fecha', label: 'Fecha', type: 'date' },
            { id: 3, slug: 'vence', label: 'Vence', type: 'date' },
            { id: 4, slug: 'valor', label: 'Valor', type: 'currency' },
        ],
    };
    const template: DashboardTemplateSummary = {
        id: 'sys:cartera',
        source: 'system',
        name: 'Cartera y cobros',
        description: null,
        category: 'finanzas',
        icon: null,
        color: null,
        lists: [
            {
                key: 'facturas',
                label: 'Facturas',
                fields: [
                    { key: 'estado', label: 'Estado', types: ['select'], required: true },
                    { key: 'monto', label: 'Monto', types: ['currency', 'number'], required: true },
                ],
            },
        ],
        widgets: [],
        created_at: null,
    };

    it('kanban por estado, calendario por vencimiento, tablero que encaja e invitar', () => {
        const recs = buildRecommendations({ lists: [list], kind: 'invoices', templates: [template], ideas: [], canManageDashboards: true, canManageAutomations: true, canInvite: true });
        expect(recs.map((r) => r.kind)).toEqual(['view_kanban', 'view_calendar', 'dashboard', 'invite']);
        const cal = recs.find((r) => r.kind === 'view_calendar');
        expect(cal?.kind === 'view_calendar' && cal.field.label).toBe('Vence');
        const dash = recs.find((r) => r.kind === 'dashboard')!;
        expect(dash.kind === 'dashboard' && dash.mapping).toEqual({ facturas: { list_id: 7, fields: { estado: 2, monto: 4 } } });
    });

    it('las ideas de automatización son de la categoría de los datos (facturas → cobros)', () => {
        const recs = buildRecommendations({ lists: [list], kind: 'invoices', templates: [], canManageDashboards: false, canManageAutomations: true, canInvite: false });
        const ideas = recs.filter((r): r is Extract<typeof r, { kind: 'idea' }> => r.kind === 'idea');
        expect(ideas.length).toBeGreaterThan(0);
        expect(ideas.every((r) => ['cobros', 'ventas'].includes(r.idea.category) && r.idea.plan.kind === 'automations')).toBe(true);
        expect(ideas[0]!.idea.category).toBe('cobros');
    });

    it('sin permisos no recomienda tableros ni automatizaciones; un tablero que no encaja no aparece', () => {
        const recs = buildRecommendations({ lists: [{ ...list, fields: list.fields.slice(0, 1) }], kind: 'contacts', templates: [template], ideas: [], canManageDashboards: true, canManageAutomations: false, canInvite: false });
        expect(recs.map((r) => r.kind)).toEqual(['form']);
    });
});
