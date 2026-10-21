import { afterEach, describe, expect, it } from 'vitest';
import type { ViewColorRule } from '@imagina-base/shared';

import { setTenantFormat } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { cellToText } from './cellText';
import { evaluateRowColors } from './colorRules';
import { computeFrozen } from './frozen';
import { cellWriteBlock, planClear, planFill, planPaste, summarizeIssues, type GridColumnRef } from './gridPlan';
import { cellSelectionShadows, clampRange, extendFocus, isRangeFill, rectOf } from './selection';
import { parseTsv, toTsv } from './tsv';

function field(id: number, slug: string, type: string, config: Record<string, unknown> = {}): FieldEntity {
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
    } as unknown as FieldEntity;
}

function rec(id: number, fields: Record<string, unknown>): RecordEntity {
    return { id, list_id: 1, fields, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' } as unknown as RecordEntity;
}

const estado = field(1, 'estado', 'select', {
    options: [
        { value: 'pendiente_pago', label: 'Pendiente de pago', color: 'amber' },
        { value: 'pagada', label: 'Pagada', color: 'green' },
    ],
});
const monto = field(2, 'monto', 'currency', { precision: 0 });
const fecha = field(3, 'fecha', 'date');
const total = field(4, 'total', 'computed', { operation: 'sum', inputs: [2] });
const nota = field(5, 'nota', 'text');
const activo = field(6, 'activo', 'checkbox');

const columns: GridColumnRef[] = [estado, monto, fecha, total, nota, activo].map((f) => ({ id: f.slug, field: f }));
const rows = [
    rec(10, { estado: 'pagada', monto: 1000, fecha: '2026-01-05', nota: 'a', activo: true }),
    rec(11, { estado: null, monto: null, fecha: null, nota: 'b', activo: false }),
    rec(12, { estado: 'pendiente_pago', monto: 3, fecha: null, nota: '', activo: false }),
];

afterEach(() => setTenantFormat(null));

describe('TSV (Excel/Sheets)', () => {
    it('lee filas, tabulaciones, comillas y el salto final', () => {
        expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
        expect(parseTsv('"dice ""hola"""\t"dos\nlíneas"')).toEqual([['dice "hola"', 'dos\nlíneas']]);
        expect(parseTsv('x')).toEqual([['x']]);
        expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
    });

    it('ida y vuelta sin perder nada', () => {
        const m = [['uno', 'con\ttab'], ['"comillas"', 'fin']];
        expect(parseTsv(toTsv(m))).toEqual(m);
    });
});

describe('rango de celdas', () => {
    it('normaliza, recorta y extiende con Mayús+flechas', () => {
        const r = { anchor: { row: 3, col: 2 }, focus: { row: 1, col: 4 } };
        expect(rectOf(r)).toEqual({ top: 1, bottom: 3, left: 2, right: 4 });
        expect(clampRange(r, 2, 3)).toEqual({ anchor: { row: 1, col: 2 }, focus: { row: 1, col: 2 } });
        expect(extendFocus({ row: 0, col: 0 }, 'ArrowDown', 5, 5)).toEqual({ row: 1, col: 0 });
        expect(extendFocus({ row: 4, col: 0 }, 'ArrowDown', 5, 5)).toEqual({ row: 4, col: 0 });
        expect(extendFocus({ row: 0, col: 0 }, 'x', 5, 5)).toBeNull();
    });

    it('dibuja el borde del rectángulo, la celda activa y el velo', () => {
        const rect = { top: 0, bottom: 1, left: 0, right: 1 };
        const active = { row: 0, col: 0 };
        expect(cellSelectionShadows(rect, active, 0, 0)).toHaveLength(3);
        expect(cellSelectionShadows(rect, active, 1, 1)).toHaveLength(2);
        expect(cellSelectionShadows(rect, active, 2, 2)).toHaveLength(0);
        expect(isRangeFill(rect, active, 1, 0)).toBe(true);
        expect(isRangeFill(rect, active, 0, 0)).toBe(false);
    });
});

describe('copiar: el texto legible de cada celda', () => {
    const ctx = { userName: (id: number) => (id === 7 ? 'Ana García' : null), relationTitle: () => 'Acme', fileName: () => 'factura.pdf' };

    it('etiqueta de la opción, número con separadores, fecha y Sí/No en el formato de la empresa', () => {
        setTenantFormat({ number_format: 'dot_comma', date_format: 'dmy' });
        expect(cellToText(estado, 'pendiente_pago', ctx)).toBe('Pendiente de pago');
        expect(cellToText(monto, 1250000, ctx)).toBe('1.250.000');
        expect(cellToText(fecha, '2026-07-30', ctx)).toBe('30/07/2026');
        expect(cellToText(activo, true, ctx)).toBe('Sí');
        expect(cellToText(activo, null, ctx)).toBe('No');
        expect(cellToText(field(8, 'resp', 'user'), 7, ctx)).toBe('Ana García');
        expect(cellToText(field(9, 'cliente', 'relation'), [3], ctx)).toBe('Acme');
    });
});

describe('pegar un bloque', () => {
    it('convierte con el formato de la empresa (etiquetas, dd/mm/aaaa, punto de miles)', () => {
        setTenantFormat({ number_format: 'dot_comma', date_format: 'dmy' });
        const plan = planPaste({
            block: parseTsv('Pendiente de pago\t1.250.000\t30/07/2026\nPagada\t26.000\t01/08/2026'),
            target: { top: 0, bottom: 0, left: 0, right: 0 },
            rows,
            columns,
            coercion: { numberFormat: 'dot_comma', dateFormat: 'dmy', strictBoolean: true },
        });
        expect(plan.issues).toEqual([]);
        const byKey = new Map(plan.changes.map((c) => [`${c.recordId}:${c.field.slug}`, c.after]));
        expect(byKey.get('10:estado')).toBe('pendiente_pago');
        expect(byKey.get('10:monto')).toBe(1250000);
        expect(byKey.get('10:fecha')).toBe('2026-07-30');
        expect(byKey.get('11:estado')).toBe('pagada');
        expect(byKey.get('11:monto')).toBe(26000);
        expect(byKey.get('11:fecha')).toBe('2026-08-01');
    });

    it('saltea lo que no se escribe, reporta lo inválido y lo que no entra', () => {
        const plan = planPaste({
            block: parseTsv('x\ty\nno-es-opción\t5\nPagada\t1\nPagada\t1'),
            target: { top: 1, bottom: 1, left: 3, right: 3 },
            rows,
            columns,
            coercion: {},
        });
        // Columna "total" (calculada): no se pega. "nota" sí.
        expect(plan.issues.some((i) => i.label === 'Total' && i.reason === 'Se calcula sola')).toBe(true);
        expect(plan.changes.every((c) => c.field.slug === 'nota')).toBe(true);
        expect(plan.truncatedRows).toBe(2);
    });

    it('una sola celda copiada llena todo el rango elegido', () => {
        const plan = planPaste({
            block: [['b']],
            target: { top: 0, bottom: 2, left: 4, right: 4 },
            rows,
            columns,
            coercion: {},
        });
        expect(plan.changes.map((c) => c.recordId)).toEqual([10, 12]);
        expect(plan.unchanged).toBe(1);
    });

    it('respeta lo que la tienda bloquea, con el motivo', () => {
        expect(cellWriteBlock(nota, rows[0]!, 'paste', () => 'Lo maneja la tienda')).toBe('Lo maneja la tienda');
        expect(cellWriteBlock(field(9, 'cliente', 'relation'), rows[0]!, 'paste')).not.toBeNull();
        expect(cellWriteBlock(field(9, 'cliente', 'relation'), rows[0]!, 'fill')).toBeNull();
    });
});

describe('rellenar y borrar', () => {
    it('Ctrl+D / asa: copia la primera fila hacia abajo (repite el patrón)', () => {
        const plan = planFill({ rows, columns, left: 0, right: 1, sourceTop: 0, sourceBottom: 0, targetTop: 1, targetBottom: 2 });
        expect(plan.changes.map((c) => [c.recordId, c.field.slug, c.after])).toEqual([
            [11, 'estado', 'pagada'],
            [11, 'monto', 1000],
            [12, 'estado', 'pagada'],
            [12, 'monto', 1000],
        ]);
    });

    it('Supr vacía lo escribible y deja la calculada', () => {
        const plan = planClear({ rows, columns, rect: { top: 0, bottom: 0, left: 0, right: 5 } });
        expect(plan.changes.map((c) => c.field.slug)).toEqual(['estado', 'monto', 'fecha', 'nota', 'activo']);
        expect(plan.issues.map((i) => i.label)).toEqual(['Total']);
    });

    it('resume los motivos agrupados por columna', () => {
        const out = summarizeIssues([
            { row: 0, col: 3, label: 'Total', reason: 'Se calcula sola' },
            { row: 1, col: 3, label: 'Total', reason: 'Se calcula sola' },
            { row: 2, col: 0, label: 'Estado', reason: 'Opción no válida' },
        ]);
        expect(out).toEqual(['«Total» (2 filas): Se calcula sola', '«Estado» (fila 3): Opción no válida']);
    });
});

describe('colores condicionales', () => {
    const fieldsById = new Map([estado, monto, fecha, nota].map((f) => [f.id, f]));
    const rule = (id: string, cond: ViewColorRule['condition'], color: ViewColorRule['color'], extra: Partial<ViewColorRule> = {}): ViewColorRule => ({
        id,
        enabled: true,
        condition: cond,
        color,
        target: 'row',
        ...extra,
    });

    it('gana la primera regla que se cumple y la celda puede tener la suya', () => {
        const rules = [
            rule('a', { type: 'condition', field_id: 1, op: 'eq', value: 'pagada' }, 'green'),
            rule('b', { type: 'condition', field_id: 2, op: 'gt', value: 100 }, 'red'),
            rule('c', { type: 'condition', field_id: 2, op: 'gt', value: 100 }, 'amber', { target: 'cell', cell_field_id: 2 }),
        ];
        const c = evaluateRowColors(rules, rows[0]!, fieldsById);
        expect(c.row).toBe('green');
        expect(c.cells.get(2)).toBe('amber');
        expect(evaluateRowColors(rules, rows[2]!, fieldsById).row).toBeNull();
    });

    it('una regla apagada o sobre un campo borrado no pinta', () => {
        const rules = [
            rule('a', { type: 'condition', field_id: 1, op: 'eq', value: 'pagada' }, 'green', { enabled: false }),
            rule('b', { type: 'condition', field_id: 99, op: 'is_null' }, 'red'),
        ];
        expect(evaluateRowColors(rules, rows[0]!, fieldsById).row).toBeNull();
    });

    it('"hoy" se cuenta en el reloj de la empresa', () => {
        const today = rec(20, { fecha: '2026-03-10' });
        const rules = [rule('a', { type: 'condition', field_id: 3, op: 'between_relative', value: 'today' }, 'blue')];
        // 2026-03-10 03:00 UTC: en Bogotá todavía es el 9; en Madrid ya es el 10.
        const now = new Date('2026-03-10T03:00:00Z');
        expect(evaluateRowColors(rules, today, fieldsById, { timeZone: 'Europe/Madrid', now }).row).toBe('blue');
        expect(evaluateRowColors(rules, today, fieldsById, { timeZone: 'America/Bogota', now }).row).toBeNull();
    });
});

describe('columnas fijas', () => {
    const cols = [
        { id: 'a', width: 200 },
        { id: 'b', width: 150 },
        { id: 'c', width: 100 },
    ];

    it('acumula el `left` de cada columna fija', () => {
        const f = computeFrozen(cols, 2, 1200);
        expect([...f.left]).toEqual([['a', 0], ['b', 200]]);
        expect(f.lastId).toBe('b');
        expect(f.count).toBe(2);
    });

    it('en una pantalla angosta (más del 60 % fijado) fija sólo la primera', () => {
        const f = computeFrozen(cols, 3, 390);
        expect(f.count).toBe(1);
        expect(f.lastId).toBe('a');
    });
});
