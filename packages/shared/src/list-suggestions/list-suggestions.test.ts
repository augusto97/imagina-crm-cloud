import { describe, expect, it } from 'vitest';
import { buildRuleSuggestions, dueField, moneyField } from './rules';
import { detectStatusField, isPersonalTextField, listFingerprint, maskTextExample, profileForAi, profileListRecords, type ListProfile, type SuggestFieldInput, type SuggestRowInput } from './profile';
import { listSuggestionsResponseSchema, updateListSuggestionsSettingsSchema } from './schema';

const FIELDS: SuggestFieldInput[] = [
    { id: 1, slug: 'cliente', label: 'Cliente', type: 'text' },
    { id: 2, slug: 'estado', label: 'Estado', type: 'select', options: [
        { value: 'pendiente', label: 'Pendiente' },
        { value: 'pagada', label: 'Pagada' },
        { value: 'vencida', label: 'Vencida' },
    ] },
    { id: 3, slug: 'vencimiento', label: 'Fecha de vencimiento', type: 'date' },
    { id: 4, slug: 'monto', label: 'Monto', type: 'currency' },
    { id: 5, slug: 'ciudad', label: 'Ciudad', type: 'text' },
    { id: 6, slug: 'email', label: 'Email', type: 'email' },
    { id: 7, slug: 'notas', label: 'Notas internas', type: 'long_text', created_at: '2026-01-01T00:00:00Z' },
];

function rows(n: number): SuggestRowInput[] {
    const cities = ['Bogotá', 'Medellín', 'Cali'];
    return Array.from({ length: n }, (_, i) => ({
        data: {
            f1: `Cliente ${i}`,
            f2: i % 3 === 0 ? 'pagada' : 'pendiente',
            f3: i < 10 ? '2026-09-01' : '2026-11-15',
            f4: 1000 * (i + 1),
            f5: cities[i % 3],
            f6: i < 4 ? 'repetido@acme.co' : `c${i}@acme.co`,
        },
        created_at: '2026-10-20T10:00:00Z',
        updated_at: '2026-10-25T10:00:00Z',
    }));
}

function profileOf(n: number, extra: Partial<ListProfile> = {}): ListProfile {
    const res = profileListRecords(FIELDS, rows(n), { today: '2026-10-31', now: new Date('2026-10-31T12:00:00Z') });
    return {
        list: { id: 9, slug: 'facturas', name: 'Facturas', title_field_id: 1 },
        total: n,
        sampled: n,
        created_30d: res.created_30d,
        updated_30d: res.updated_30d,
        today: '2026-10-31',
        status: res.status,
        fields: res.fields,
        views: [],
        automations: [],
        dashboards: [],
        forms: 0,
        portal_enabled: false,
        mirror: false,
        linked: [],
        ...extra,
    };
}

describe('perfil de la lista', () => {
    it('detecta el estado y sus opciones terminadas', () => {
        expect(detectStatusField(FIELDS)).toEqual({ fieldId: 2, doneValues: ['pagada'] });
    });

    it('cuenta llenos, distintos, fechas vencidas sin cerrar y repetidos', () => {
        const p = profileOf(30);
        const estado = p.fields.find((f) => f.slug === 'estado')!;
        expect(estado.options?.map((o) => o.count)).toEqual([20, 10, 0]);
        const venc = p.fields.find((f) => f.slug === 'vencimiento')!;
        // 10 registros con fecha pasada; de esos, los i%3==0 están pagados (0,3,6,9) → 6 abiertos.
        expect(venc.date).toMatchObject({ past: 10, past_open: 6, next30: 20 });
        const ciudad = p.fields.find((f) => f.slug === 'ciudad')!;
        expect(ciudad.distinct).toBe(3);
        const email = p.fields.find((f) => f.slug === 'email')!;
        expect(email.dupes).toMatchObject({ values: 1, records: 4, top_count: 4 });
        const monto = p.fields.find((f) => f.slug === 'monto')!;
        expect(monto.num?.sum).toBe(465000);
        expect(p.created_30d).toBe(30);
    });

    it('a la IA no le llega ningún valor de texto, correo ni persona', () => {
        const ai = JSON.stringify(profileForAi(profileOf(30), { purpose: 'Cobrar a mis clientes' }));
        expect(ai).not.toContain('Bogotá');
        expect(ai).not.toContain('repetido@acme.co');
        expect(ai).not.toContain('Cliente 3');
        expect(ai).toContain('Pagada');
        expect(ai).toContain('Cobrar a mis clientes');
    });

    it('con ejemplos: sólo campos de texto que no son de personas, enmascarados', () => {
        const p = profileOf(30);
        const notas = p.fields.find((f) => f.slug === 'notas')!;
        notas.examples = ['Llamar a Ana María López al 310 555 1234', 'Enviar propuesta a ana@acme.co'];
        const ai = profileForAi(p, { examples: true }) as { campos: Array<{ slug: string; ejemplos?: string[] }> };
        const by = (slug: string) => ai.campos.find((c) => c.slug === slug)!;
        expect(by('ciudad').ejemplos).toEqual(['Bogotá', 'Medellín', 'Cali']);
        expect(by('notas').ejemplos).toEqual(['Llamar a [nombre] al [número]', 'Enviar propuesta a [correo]']);
        // «Cliente» guarda nombres: ni enmascarados viajan.
        expect(by('cliente').ejemplos).toBeUndefined();
        expect(by('email').ejemplos).toBeUndefined();
        // Sin la casilla, ningún ejemplo.
        expect(JSON.stringify(profileForAi(p))).not.toContain('ejemplos');
    });

    it('la máscara tapa correos, enlaces, números largos y nombres propios, y corta', () => {
        expect(maskTextExample('Pagó la factura 12345678 por transferencia')).toBe('Pagó la factura [número] por transferencia');
        expect(maskTextExample('Visita https://acme.co/precios o www.acme.co')).toBe('Visita [web] o [web]');
        expect(maskTextExample('Reunión con Pedro de la Torre el martes')).toBe('Reunión con [nombre] el martes');
        expect(maskTextExample('Cuota 2 de 6, sede Medellín')).toBe('Cuota 2 de 6, sede Medellín');
        expect(maskTextExample('x'.repeat(100), 20)).toBe(`${'x'.repeat(20)}…`);
        expect(isPersonalTextField('Razón social')).toBe(true);
        expect(isPersonalTextField('Nº de documento')).toBe(true);
        expect(isPersonalTextField('Descripción del servicio')).toBe(false);
    });

    it('la huella cambia con los campos, el orden de magnitud o el propósito, no con un registro más', () => {
        const a = listFingerprint(profileOf(30));
        expect(listFingerprint(profileOf(29))).toBe(a);
        expect(listFingerprint(profileOf(80))).not.toBe(a);
        expect(listFingerprint(profileOf(30), 'otra cosa')).not.toBe(a);
        // Con o sin ejemplos de texto son análisis distintos.
        expect(listFingerprint(profileOf(30), null, true)).not.toBe(a);
    });
});

describe('sugerencias por reglas', () => {
    it('propone tablero, calendario, vencidos, tablero de resumen, selección, repetidos y formulario', () => {
        const keys = buildRuleSuggestions(profileOf(30)).map((s) => s.key);
        expect(keys).toEqual([
            'view.kanban.f2',
            'view.calendar.f3',
            'view.overdue.f3',
            'dashboard.summary',
            'field.select.f5',
            'quality.dupes.f6',
            'quality.empty.f7',
            'share.form',
        ]);
    });

    it('cada vista sale con la entrada exacta de la herramienta y la evidencia en el porqué', () => {
        const s = buildRuleSuggestions(profileOf(30));
        const kanban = s.find((x) => x.key === 'view.kanban.f2')!;
        expect(kanban.action).toMatchObject({ type: 'tool', tool: 'propose_create_view', input: { list: 'facturas', view: { type: 'kanban', group_by: 'estado', value_field: 'monto' } } });
        expect(kanban.why).toContain('30 registros');
        const overdue = s.find((x) => x.key === 'view.overdue.f3')!;
        expect(overdue.why).toContain('6 registros');
        expect(overdue.action).toMatchObject({
            input: { view: { filters: [{ field: 'vencimiento', op: 'between_relative', value: 'before_today' }, { field: 'estado', op: 'nin', value: ['pagada'] }] } },
        });
        const dash = s.find((x) => x.key === 'dashboard.summary')!;
        expect(dash.preview?.widgets.map((w) => w.title)).toEqual(['Registros', 'Total monto', 'Vencidos', 'Por estado', 'Por mes']);
    });

    it('no repite lo que la lista ya tiene', () => {
        const p = profileOf(30, {
            views: [
                { name: 'Por estado', type: 'kanban', group_by_field_id: 2, date_field_id: null, start_field_id: null, end_field_id: null, person_field_id: null, filter_field_ids: [] },
                { name: 'Calendario', type: 'calendar', group_by_field_id: null, date_field_id: 3, start_field_id: null, end_field_id: null, person_field_id: null, filter_field_ids: [] },
            ],
            dashboards: [{ name: 'Cartera' }],
            forms: 1,
        });
        const keys = buildRuleSuggestions(p).map((s) => s.key);
        expect(keys).not.toContain('view.kanban.f2');
        expect(keys).not.toContain('view.calendar.f3');
        expect(keys).not.toContain('dashboard.summary');
        expect(keys).not.toContain('share.form');
    });

    it('una lista recién creada recibe vistas y tablero por sus campos; una espejo no convierte campos', () => {
        const fresh = buildRuleSuggestions(profileOf(0)).map((s) => s.key);
        expect(fresh).toEqual(['view.kanban.f2', 'view.calendar.f3', 'dashboard.summary', 'share.form']);
        const mirror = buildRuleSuggestions(profileOf(30, { mirror: true })).map((s) => s.key);
        expect(mirror).not.toContain('field.select.f5');
        expect(mirror).not.toContain('share.form');
    });

    it('elige bien la fecha y el dinero', () => {
        const p = profileOf(5);
        expect(dueField(p.fields)?.slug).toBe('vencimiento');
        expect(moneyField(p.fields)?.slug).toBe('monto');
    });
});

describe('esquema', () => {
    it('la respuesta valida y el ajuste exige algo', () => {
        expect(updateListSuggestionsSettingsSchema.safeParse({}).success).toBe(false);
        expect(updateListSuggestionsSettingsSchema.safeParse({ hidden_for_me: true }).success).toBe(true);
        const ok = listSuggestionsResponseSchema.safeParse({
            enabled: true,
            mode: 'all',
            hidden_for_me: false,
            can_configure: true,
            new_count: 0,
            suggestions: [],
            ai: { available: false, reason: 'x', remaining: 0, limit: 5, state: 'idle', stage: null, error: null, analyzed_at: null, can_reanalyze: true, reanalyze_hint: null, purpose: null, ask_purpose: true },
            sample: { total: 0, sampled: 0 },
        });
        expect(ok.success).toBe(true);
    });
});
