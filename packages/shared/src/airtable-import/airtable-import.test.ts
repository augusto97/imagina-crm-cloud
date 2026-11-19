import { describe, expect, it } from 'vitest';
import { validateFieldValue } from '../field-types/validate';
import {
    airtableColor,
    airtableCurrency,
    airtableDateOnly,
    convertAirtableValue,
    describeAirtableField,
    pairAirtableLinks,
    type AirtableCellTarget,
} from './mapping';
import { airtableDescribeContext, airtableOptions, buildAirtableDraftPlan, resolveAirtablePlan } from './resolve';
import { airtablePlanSchema, type AirtableTableScan, type AirtableTableSchema } from './schema';

const clientes: AirtableTableSchema = {
    id: 'tblClientes000001',
    name: 'Clientes',
    primaryFieldId: 'fldCliNombre00001',
    fields: [
        { id: 'fldCliNombre00001', name: 'Nombre', type: 'singleLineText' },
        {
            id: 'fldCliSegmento001',
            name: 'Segmento',
            type: 'singleSelect',
            options: {
                choices: [
                    { id: 'sel1', name: 'Pyme', color: 'blueLight2' },
                    { id: 'sel2', name: 'Corporativo', color: 'purpleBright' },
                    { id: 'sel3', name: 'Gobierno', color: 'greenLight1' },
                ],
            },
        },
        { id: 'fldCliProyectos01', name: 'Proyectos', type: 'multipleRecordLinks', options: { linkedTableId: 'tblProyectos00001', inverseLinkFieldId: 'fldProCliente0001', prefersSingleRecordLink: false } },
        { id: 'fldCliEjecutivo01', name: 'Ejecutivo', type: 'singleCollaborator' },
    ],
};

const proyectos: AirtableTableSchema = {
    id: 'tblProyectos00001',
    name: 'Proyectos',
    primaryFieldId: 'fldProNombre00001',
    fields: [
        { id: 'fldProNombre00001', name: 'Nombre', type: 'singleLineText' },
        { id: 'fldProCliente0001', name: 'Cliente', type: 'multipleRecordLinks', options: { linkedTableId: 'tblClientes000001', inverseLinkFieldId: 'fldCliProyectos01', prefersSingleRecordLink: true } },
        { id: 'fldProCodigo00001', name: 'Código', type: 'autoNumber' },
        { id: 'fldProPresupuest1', name: 'Presupuesto', type: 'currency', options: { symbol: '$', precision: 0 } },
        { id: 'fldProAvance00001', name: 'Avance', type: 'percent', options: { precision: 0 } },
        { id: 'fldProEntrega0001', name: 'Entrega', type: 'dateTime', options: { timeZone: 'America/Bogota' } },
        { id: 'fldProMargen00001', name: 'Margen', type: 'formula', options: { result: { type: 'currency', options: { symbol: '€', precision: 2 } } } },
        { id: 'fldProLider000001', name: 'Líder', type: 'singleCollaborator' },
        { id: 'fldProBoton000001', name: 'Abrir', type: 'button' },
        { id: 'fldProNuevo000001', name: 'Raro', type: 'someFutureType' },
        { id: 'fldProArchivos001', name: 'Archivos', type: 'multipleAttachments' },
    ],
};

const tables = [clientes, proyectos];

const scan: AirtableTableScan[] = [
    {
        table_id: clientes.id,
        records: 8,
        truncated: false,
        attachments: {},
        people: { fldCliEjecutivo01: [{ email: 'ana@empresa.test', name: 'Ana', member: true }] },
        autonumber_max: {},
    },
    {
        table_id: proyectos.id,
        records: 12,
        truncated: false,
        attachments: { fldProArchivos001: { files: 3, bytes: 3000, too_big: 1 } },
        people: {
            fldProLider000001: [
                { email: 'ana@empresa.test', name: 'Ana', member: true },
                { email: null, name: 'Luis Freelance', member: false },
            ],
        },
        autonumber_max: { fldProCodigo00001: 12 },
    },
];

const ctxAll = () => airtableDescribeContext(tables, scan, [clientes.id, proyectos.id], true);

describe('vínculos de Airtable', () => {
    it('un vínculo de dos caras queda en UN solo lado: el que apunta a un solo registro', () => {
        const links = pairAirtableLinks(tables);
        expect(links.get('fldProCliente0001')?.side).toBe('relation');
        expect(links.get('fldProCliente0001')?.target_table_id).toBe(clientes.id);
        expect(links.get('fldCliProyectos01')?.side).toBe('inverse');
        const info = describeAirtableField(clientes.fields[2]!, clientes, ctxAll());
        expect(info.locked).toBe(true);
        expect(info.reason).toContain('otra cara del vínculo');
    });

    it('si ninguno apunta a un solo registro, se crea el primero y un vínculo de una cara siempre se crea', () => {
        const a: AirtableTableSchema = {
            id: 'tblAaaaaaaaaaaa1',
            name: 'A',
            primaryFieldId: 'fldAName00000001',
            fields: [
                { id: 'fldAName00000001', name: 'N', type: 'singleLineText' },
                { id: 'fldALinkB0000001', name: 'B', type: 'multipleRecordLinks', options: { linkedTableId: 'tblBbbbbbbbbbbb1', inverseLinkFieldId: 'fldBLinkA0000001' } },
                { id: 'fldASolo00000001', name: 'Solo', type: 'multipleRecordLinks', options: { linkedTableId: 'tblBbbbbbbbbbbb1' } },
            ],
        };
        const b: AirtableTableSchema = {
            id: 'tblBbbbbbbbbbbb1',
            name: 'B',
            primaryFieldId: 'fldBName00000001',
            fields: [
                { id: 'fldBName00000001', name: 'N', type: 'singleLineText' },
                { id: 'fldBLinkA0000001', name: 'A', type: 'multipleRecordLinks', options: { linkedTableId: 'tblAaaaaaaaaaaa1', inverseLinkFieldId: 'fldALinkB0000001' } },
            ],
        };
        const links = pairAirtableLinks([a, b]);
        expect(links.get('fldALinkB0000001')?.side).toBe('relation');
        expect(links.get('fldBLinkA0000001')?.side).toBe('inverse');
        expect(links.get('fldASolo00000001')?.side).toBe('relation');
    });

    it('un vínculo hacia una tabla que no se importa no se puede crear', () => {
        const ctx = airtableDescribeContext(tables, scan, [proyectos.id], true);
        const info = describeAirtableField(proyectos.fields[1]!, proyectos, ctx);
        expect(info.type).toBeNull();
        expect(info.reason).toContain('«Clientes» no se importa');
    });
});

describe('tipos de Airtable → tipos de la app', () => {
    const d = (fieldId: string) => describeAirtableField(proyectos.fields.find((f) => f.id === fieldId)!, proyectos, ctxAll());

    it('lo calculado se trae como dato fijo del tipo de su resultado', () => {
        const info = d('fldProMargen00001');
        expect(info.type).toBe('currency');
        expect(info.fixed).toBe(true);
        expect(info.reason).toContain('no se recalcula');
    });

    it('botones y tipos desconocidos quedan fuera con el motivo', () => {
        expect(d('fldProBoton000001')).toMatchObject({ type: null, locked: true });
        const raro = d('fldProNuevo000001');
        expect(raro.locked).toBe(true);
        expect(raro.reason).toContain('someFutureType');
    });

    it('colaboradores: Persona si todos son del equipo; si no, texto con el nombre', () => {
        expect(describeAirtableField(clientes.fields[3]!, clientes, ctxAll()).type).toBe('user');
        const lider = d('fldProLider000001');
        expect(lider.type).toBe('text');
        expect(lider.alternatives).toContain('user');
        expect(lider.reason).toContain('Luis Freelance');
    });

    it('los adjuntos sólo se ofrecen si se bajan', () => {
        expect(d('fldProArchivos001').type).toBe('file');
        expect(d('fldProArchivos001').reason).toContain('más de 15 MB');
        const off = airtableDescribeContext(tables, scan, [clientes.id, proyectos.id], false);
        expect(describeAirtableField(proyectos.fields[10]!, proyectos, off)).toMatchObject({ type: null, locked: true });
    });

    it('un campo principal que no es texto queda como texto (es el título)', () => {
        const t: AirtableTableSchema = { id: 'tblNumeros000001', name: 'N', primaryFieldId: 'fldNum0000000001', fields: [{ id: 'fldNum0000000001', name: 'Número', type: 'number' }] };
        const info = describeAirtableField(t.fields[0]!, t, airtableDescribeContext([t], [], [t.id], true));
        expect(info.type).toBe('text');
        expect(info.reason).toContain('título');
    });

    it('colores y moneda', () => {
        expect(airtableColor('blueLight2')).toBe('blue');
        expect(airtableColor('purpleBright')).toBe('violet');
        expect(airtableColor('nada')).toBeUndefined();
        expect(airtableCurrency('$', 'COP')).toBe('COP');
        expect(airtableCurrency('$', 'EUR')).toBe('USD');
        expect(airtableCurrency('€', 'COP')).toBe('EUR');
        expect(airtableCurrency('R$', 'COP')).toBe('BRL');
    });
});

describe('valores de Airtable', () => {
    const t = (type: AirtableCellTarget['type'], source: string, extra: Partial<AirtableCellTarget> = {}): AirtableCellTarget => ({ label: 'Campo', type, source, ...extra });

    it('porcentaje, duración y moneda', () => {
        expect(convertAirtableValue(t('percent', 'percent'), 0.375)).toEqual({ kind: 'value', value: 37.5 });
        expect(convertAirtableValue(t('duration', 'duration'), 5400)).toEqual({ kind: 'value', value: 90 });
        expect(convertAirtableValue(t('currency', 'currency'), 1500000)).toEqual({ kind: 'value', value: 1500000 });
        expect(convertAirtableValue(t('text', 'percent'), 0.5)).toEqual({ kind: 'value', value: '50 %' });
    });

    it('selecciones por nombre (con y sin acentos) y las que no existen avisan', () => {
        const { options, map } = airtableOptions(clientes.fields[1]!);
        expect(options).toEqual([
            { label: 'Pyme', value: 'pyme', color: 'blue' },
            { label: 'Corporativo', value: 'corporativo', color: 'violet' },
            { label: 'Gobierno', value: 'gobierno', color: 'green' },
        ]);
        const target = t('select', 'singleSelect', { option_map: map });
        expect(convertAirtableValue(target, 'Pyme')).toEqual({ kind: 'value', value: 'pyme' });
        expect(convertAirtableValue(t('multi_select', 'multipleSelects', { option_map: map }), ['Pyme', 'GOBIERNO'])).toEqual({ kind: 'value', value: ['pyme', 'gobierno'] });
        expect(convertAirtableValue(target, 'Otra').kind).toBe('warn');
    });

    it('fechas: la de una fórmula a medianoche UTC conserva su día; la fecha y hora queda en ISO', () => {
        expect(airtableDateOnly('2026-03-05T00:00:00.000Z')).toBe('2026-03-05');
        expect(airtableDateOnly('2026-03-05T03:00:00.000Z', 'America/Bogota')).toBe('2026-03-04');
        const dt = convertAirtableValue(t('datetime', 'dateTime'), '2026-03-05T15:30:00.000Z');
        expect(dt).toEqual({ kind: 'value', value: '2026-03-05T15:30:00.000Z' });
        expect(validateFieldValue({ type: 'datetime', config: {}, is_required: false }, (dt as { value: string }).value).ok).toBe(true);
        expect(convertAirtableValue(t('date', 'dateTime', { time_zone: 'America/Bogota' }), '2026-03-05T03:00:00.000Z')).toEqual({ kind: 'value', value: '2026-03-04' });
    });

    it('personas: un miembro queda como Persona; alguien de afuera deja la celda vacía con aviso', () => {
        const members = new Map([['ana@empresa.test', 7]]);
        const target = t('user', 'singleCollaborator');
        expect(convertAirtableValue(target, { email: 'ANA@empresa.test', name: 'Ana' }, { memberIdByEmail: members })).toEqual({ kind: 'value', value: 7 });
        expect(convertAirtableValue(target, { email: 'luis@freelance.test', name: 'Luis' }, { memberIdByEmail: members }).kind).toBe('warn');
        expect(convertAirtableValue(t('text', 'singleCollaborator'), { email: 'luis@freelance.test', name: 'Luis' })).toEqual({ kind: 'value', value: 'Luis' });
        expect(convertAirtableValue(t('text', 'multipleCollaborators'), [{ name: 'Ana' }, { name: 'Luis' }])).toEqual({ kind: 'value', value: 'Ana, Luis' });
    });

    it('vínculos, adjuntos, errores de cálculo y número automático', () => {
        expect(convertAirtableValue(t('relation', 'multipleRecordLinks'), ['recAAAAAAAAAAAAAA'])).toEqual({ kind: 'links', ids: ['recAAAAAAAAAAAAAA'] });
        const files = convertAirtableValue(t('file', 'multipleAttachments'), [{ id: 'att1', url: 'https://x/a.png', filename: 'a.png', size: 10, type: 'image/png' }]);
        expect(files).toMatchObject({ kind: 'files', files: [{ filename: 'a.png', size: 10 }] });
        expect(convertAirtableValue(t('currency', 'currency'), { specialValue: 'NaN' }).kind).toBe('warn');
        expect(convertAirtableValue(t('autonumber', 'autoNumber'), 42)).toEqual({ kind: 'value', value: '42' });
        expect(convertAirtableValue(t('checkbox', 'checkbox'), true)).toEqual({ kind: 'value', value: true });
        expect(convertAirtableValue(t('text', 'singleLineText'), '')).toEqual({ kind: 'empty' });
        expect(convertAirtableValue(t('text', 'lookup'), { valuesByLinkedRecordId: { recA: ['uno@x.co'], recB: ['dos@x.co'] } })).toEqual({ kind: 'value', value: 'uno@x.co, dos@x.co' });
    });
});

describe('el plan', () => {
    const rctx = { currency: 'COP', country: 'CO' };

    it('el borrador es válido y se resuelve: una relación por vínculo, opciones con color, título primero', () => {
        const draft = buildAirtableDraftPlan(tables, scan, { baseName: 'Agencia Creativa' });
        expect(airtablePlanSchema.safeParse(draft).success).toBe(true);
        const r = resolveAirtablePlan(draft, tables, scan, rctx);
        expect(r.errors).toEqual([]);
        expect(r.records).toBe(20);
        expect(r.files).toBe(3);
        expect(r.folder_name).toBe('Agencia Creativa');
        const cli = r.lists.find((l) => l.table_id === clientes.id)!;
        const pro = r.lists.find((l) => l.table_id === proyectos.id)!;
        expect(cli.fields.some((f) => f.type === 'relation')).toBe(false);
        const rel = pro.fields.filter((f) => f.type === 'relation');
        expect(rel).toHaveLength(1);
        expect(rel[0]!.relation_to).toBe(clientes.id);
        expect(cli.fields[0]!.slug).toBe(cli.title_slug);
        expect(cli.fields.find((f) => f.label === 'Segmento')!.options![1]).toEqual({ label: 'Corporativo', value: 'corporativo', color: 'violet' });
        expect(pro.fields.find((f) => f.label === 'Presupuesto')!.currency).toBe('COP');
        expect(pro.fields.find((f) => f.label === 'Margen')).toMatchObject({ type: 'currency', currency: 'EUR', fixed: true });
        expect(pro.fields.find((f) => f.label === 'Código')).toMatchObject({ type: 'autonumber', autonumber_max: 12 });
        expect(pro.fields.find((f) => f.label === 'Entrega')!.time_zone).toBe('America/Bogota');
        expect(pro.fields.some((f) => f.label === 'Abrir' || f.label === 'Raro')).toBe(false);
        expect(r.notes.join(' ')).toContain('calculado');
    });

    it('rechaza el título fuera, un tipo que no corresponde y dos listas con el mismo nombre', () => {
        const draft = buildAirtableDraftPlan(tables, scan);
        const bad = structuredClone(draft);
        bad.tables[0]!.fields[0]!.include = false;
        bad.tables[1]!.name = 'Clientes';
        bad.tables[1]!.fields.find((f) => f.field_id === 'fldProAvance00001')!.type = 'relation';
        const r = resolveAirtablePlan(bad, tables, scan, rctx);
        expect(r.errors.join(' ')).toContain('título');
        expect(r.errors.join(' ')).toContain('Dos listas se llamarían «Clientes»');
        expect(r.errors.join(' ')).toContain('no se puede convertir');
    });

    it('sin adjuntos no hay archivos y el campo no se crea', () => {
        const draft = buildAirtableDraftPlan(tables, scan, { attachments: false });
        const r = resolveAirtablePlan(draft, tables, scan, rctx);
        expect(r.files).toBe(0);
        expect(r.lists[1]!.fields.some((f) => f.type === 'file')).toBe(false);
    });
});
