// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { setTenantFormat } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { editDraftFor, parseCellDraft } from '../EditableCell';
import { clearCut, clipForText, getCutKeys, getGridClip, setGridClip, toHtmlTable } from './clipboard';
import { GridEditStore } from './editStore';
import { fillValues } from './fillSeries';
import { planClear, planFill, planNewRows, planPaste, type GridColumnRef } from './gridPlan';
import { computePaste, pasteNeedsReview, type PasteInputs } from './pasteFlow';

function field(id: number, slug: string, type: string, config: Record<string, unknown> = {}, extra: Partial<FieldEntity> = {}): FieldEntity {
    return {
        id,
        list_id: 1,
        slug,
        label: slug.charAt(0).toUpperCase() + slug.slice(1),
        type,
        config,
        is_required: false,
        is_unique: false,
        is_indexed: false,
        is_primary: false,
        position: id,
        ...extra,
    } as unknown as FieldEntity;
}

function rec(id: number, fields: Record<string, unknown>, relations: Record<string, number[]> = {}): RecordEntity {
    return { id, list_id: 1, fields, relations, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' } as unknown as RecordEntity;
}

const nombre = field(1, 'nombre', 'text', {}, { is_required: true });
const monto = field(2, 'monto', 'currency', { precision: 0 });
const estado = field(3, 'estado', 'select', { options: [{ value: 'pendiente', label: 'Pendiente' }, { value: 'pagado', label: 'Pagado' }] });
const cliente = field(4, 'cliente', 'relation', { target_list_id: 9 });
const codigo = field(5, 'codigo', 'text', {}, { is_unique: true });
const fecha = field(6, 'fecha', 'date');
const total = field(7, 'total', 'computed', { operation: 'sum', inputs: [2] });

const cols = (fs: Array<FieldEntity | null>): GridColumnRef[] => fs.map((f, i) => ({ id: f?.slug ?? (i === 0 ? 'id' : 'updated_at'), field: f }));
const rows = [
    rec(10, { nombre: 'Acme', monto: 100, estado: 'pendiente', codigo: 'C-1' }, { cliente: [] }),
    rec(11, { nombre: 'Globex', monto: null, estado: null, codigo: 'C-2' }, { cliente: [] }),
];

afterEach(() => {
    setTenantFormat(null);
    setGridClip(null);
});

describe('v0.1.294 — pegar con validación clara', () => {
    it('un valor que no es opción se explica y se ofrece crear', () => {
        const plan = planPaste({ block: [['Urgente']], target: { top: 0, bottom: 0, left: 0, right: 0 }, rows, columns: cols([estado]), coercion: {} });
        expect(plan.changes).toHaveLength(0);
        expect(plan.issues[0]!.reason).toBe('«Urgente» no es una opción de «Estado»');
        expect(plan.issues[0]!.optionFieldId).toBe(3);
        expect(plan.unknownOptions).toEqual([{ field: estado, labels: ['Urgente'] }]);
    });

    it('números y fechas inválidos dicen qué pasó (y cómo escribirlo)', () => {
        const plan = planPaste({
            block: [['mucho', '31/02/2026']],
            target: { top: 0, bottom: 0, left: 0, right: 0 },
            rows,
            columns: cols([monto, fecha]),
            coercion: { dateFormat: 'dmy' },
        });
        expect(plan.issues.map((i) => i.reason)).toEqual(['«mucho» no es un número', '«31/02/2026» no es una fecha (escríbela como DD/MM/AAAA)']);
    });

    it('vínculos por título, por #id y valores reales del portapapeles interno', () => {
        const relationIds = new Map([[4, new Map<string, number | null>([['acme sa', 501], ['repetida', null]])]]);
        const ok = planPaste({ block: [['Acme SA, #77']], target: { top: 0, bottom: 0, left: 0, right: 0 }, rows, columns: cols([cliente]), coercion: {}, relationIds });
        expect(ok.changes[0]!.after).toEqual([501, 77]);
        const bad = planPaste({ block: [['Nadie'], ['Repetida']], target: { top: 0, bottom: 0, left: 0, right: 0 }, rows, columns: cols([cliente]), coercion: {}, relationIds });
        expect(bad.issues.map((i) => i.reason)).toEqual([
            'No se encontró «Nadie» en la lista vinculada',
            'Hay varios registros llamados «Repetida»: elige el correcto en la celda',
        ]);
        const internal = planPaste({
            block: [['Cualquier título']],
            internal: [[{ recordId: 1, fieldId: 4, fieldType: 'relation', value: [9, 9, 8], text: 'Cualquier título' }]],
            target: { top: 1, bottom: 1, left: 0, right: 0 },
            rows,
            columns: cols([cliente]),
            coercion: {},
        });
        expect(internal.changes[0]!.after).toEqual([9, 8]);
    });

    it('filas enteras copiadas de la tabla: ID y calculadas se saltean sin aviso', () => {
        const plan = planPaste({
            block: [['10', 'Acme', '100']],
            internal: [[
                { recordId: 10, fieldId: null, fieldType: null, value: null, text: '10' },
                { recordId: 10, fieldId: 1, fieldType: 'text', value: 'Acme', text: 'Acme' },
                { recordId: 10, fieldId: 7, fieldType: 'computed', value: 100, text: '100' },
            ]],
            target: { top: 1, bottom: 1, left: 0, right: 0 },
            rows,
            columns: cols([null, nombre, total]),
            coercion: {},
        });
        expect(plan.issues).toEqual([]);
        expect(plan.skipped).toBe(2);
        expect(plan.changes.map((c) => c.after)).toEqual(['Acme']);
    });

    it('«Sin repetidos»: contra otra fila cargada y dentro del mismo bloque', () => {
        const other = planPaste({ block: [['c-1']], target: { top: 1, bottom: 1, left: 0, right: 0 }, rows, columns: cols([codigo]), coercion: {} });
        expect(other.changes).toHaveLength(0);
        expect(other.issues[0]!.reason).toContain('ya está en otro registro');
        const rowsMore = [...rows, rec(12, { codigo: null })];
        const dup = planPaste({ block: [['X-1'], ['x-1 ']], target: { top: 1, bottom: 1, left: 0, right: 0 }, rows: rowsMore, columns: cols([codigo]), coercion: {} });
        expect(dup.changes).toHaveLength(1);
        expect(dup.issues[0]!.reason).toContain('se repite en lo que pegaste');
    });

    it('lo que no entra hacia abajo queda para crear filas nuevas (con obligatorios y opciones)', () => {
        const plan = planPaste({
            block: [['A', 'Pendiente'], ['B', 'Pagado'], ['', 'Pagado'], ['C', 'Nueva']],
            target: { top: 1, bottom: 1, left: 0, right: 0 },
            rows,
            columns: cols([nombre, estado]),
            coercion: {},
        });
        expect(plan.changes).toHaveLength(2);
        expect(plan.truncatedRows).toBe(3);
        const created = planNewRows({ overflow: plan.overflow, columns: cols([nombre, estado]), allFields: [nombre, estado], coercion: {}, rowsLoaded: 2 });
        expect(created.rows.map((r) => r.data)).toEqual([{ f1: 'B', f3: 'pagado' }]);
        expect(created.issues.map((i) => [i.newRow, i.reason])).toEqual([
            [2, 'Falta «Nombre», que es obligatorio: la fila nueva no se crea'],
            [3, '«Nueva» no es una opción de «Estado»'],
        ]);
        expect(created.unknownOptions[0]!.labels).toEqual(['Nueva']);
    });

    it('cortar y pegar: el origen se vacía (lo que no pisa el destino) y pide revisión si algo falla', () => {
        setGridClip({
            listId: 1,
            text: 'Pendiente',
            cut: true,
            cells: [[{ recordId: 10, fieldId: 3, fieldType: 'select', value: 'pendiente', text: 'Pendiente' }]],
        });
        expect(getCutKeys().has('10:3')).toBe(true);
        const inputs: PasteInputs = {
            block: [['Pendiente']],
            internal: getGridClip()!.cells,
            target: { top: 1, bottom: 1, left: 0, right: 0 },
            coercion: {},
            relationIds: new Map(),
            clip: getGridClip(),
        };
        const out = computePaste(inputs, { rows, columns: cols([estado]), allFields: [estado], listId: 1 });
        expect(out.plan.changes.map((c) => [c.recordId, c.after])).toEqual([[11, 'pendiente']]);
        expect(out.cutClears.map((c) => [c.recordId, c.after])).toEqual([[10, null]]);
        expect(pasteNeedsReview(out)).toBe(false);
        clearCut();
        expect(getCutKeys().size).toBe(0);
    });

    it('Supr no vacía un campo obligatorio', () => {
        const plan = planClear({ rows, columns: cols([nombre, monto]), rect: { top: 0, bottom: 0, left: 0, right: 1 } });
        expect(plan.changes.map((c) => c.field.slug)).toEqual(['monto']);
        expect(plan.issues[0]!.reason).toBe('Es obligatorio: no puede quedar vacío');
    });
});

describe('v0.1.294 — rellenar continúa series', () => {
    it('números, fechas por día y por mes, y textos con número', () => {
        expect(fillValues('number', [1, 2], 3)).toEqual([3, 4, 5]);
        expect(fillValues('currency', [0.1, 0.2], 2)).toEqual([0.3, 0.4]);
        expect(fillValues('date', ['2026-01-30', '2026-01-31'], 2)).toEqual(['2026-02-01', '2026-02-02']);
        expect(fillValues('date', ['2026-01-31', '2026-02-28'], 2)).toEqual(['2026-03-31', '2026-04-30']); // fin de mes
        expect(fillValues('date', ['2026-01-15', '2026-02-15'], 2)).toEqual(['2026-03-15', '2026-04-15']);
        expect(fillValues('text', ['Cuota 01', 'Cuota 02'], 2)).toEqual(['Cuota 03', 'Cuota 04']);
        expect(fillValues('number', [5], 2)).toEqual([5, 5]);
        expect(fillValues('select', ['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
    });

    it('el relleno valida (una serie que se pasa del máximo no se escribe)', () => {
        const pct = field(8, 'avance', 'percent');
        const rs = [rec(1, { avance: 80 }), rec(2, { avance: 90 }), rec(3, {}), rec(4, {})];
        const plan = planFill({ rows: rs, columns: cols([pct]), left: 0, right: 0, sourceTop: 0, sourceBottom: 1, targetTop: 2, targetBottom: 3 });
        expect(plan.changes.map((c) => c.after)).toEqual([100]);
        expect(plan.issues[0]!.reason).toContain('0 a 100');
    });
});

describe('v0.1.294 — portapapeles interno y edición', () => {
    it('reconoce lo que copió la tabla aunque el sistema cambie los saltos de línea', () => {
        setGridClip({ listId: 1, text: 'a\tb\nc\td', cut: false, cells: [] });
        expect(clipForText('a\tb\r\nc\td\r\n')).not.toBeNull();
        expect(clipForText('otra cosa')).toBeNull();
        expect(toHtmlTable([['<b>', 'x\ny']])).toContain('<td>&lt;b&gt;</td><td>x<br>y</td>');
    });

    it('el almacén de edición avisa a una sola celda y cuando termina', () => {
        const store = new GridEditStore();
        const ended: string[] = [];
        store.onEnd = (key, reason) => ended.push(`${key}:${reason}`);
        store.request('10:2', '5');
        expect(store.get()).toMatchObject({ key: '10:2', seed: '5' });
        store.end('10:2', 'enter');
        expect(store.get()).toBeNull();
        expect(ended).toEqual(['10:2:enter']);
    });

    it('los números se editan y se leen con el formato de la empresa', () => {
        setTenantFormat({ number_format: 'dot_comma', date_format: 'dmy' });
        expect(editDraftFor(monto, 1500.5)).toBe('1500,5');
        expect(parseCellDraft(monto, '1.500.000')).toEqual({ ok: true, value: 1500000 });
        expect(parseCellDraft(monto, '1,5')).toEqual({ ok: true, value: 1.5 });
        expect(parseCellDraft(field(8, 'avance', 'percent'), '45%')).toEqual({ ok: true, value: 45 });
        expect(parseCellDraft(monto, 'mucho')).toEqual({ ok: false, error: '«mucho» no es un número' });
        expect(parseCellDraft(field(9, 'dur', 'duration'), '1h 30m')).toEqual({ ok: true, value: 90 });
        expect(parseCellDraft(nombre, '   ').ok).toBe(false);
        expect(parseCellDraft(cliente, [1, 2])).toEqual({ ok: true, value: [1, 2] });
    });
});
