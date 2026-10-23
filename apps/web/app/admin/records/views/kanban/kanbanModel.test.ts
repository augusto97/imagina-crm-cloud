import { describe, expect, it } from 'vitest';
import { DEFAULT_KANBAN_SETTINGS, type KanbanSettings } from '@imagina-base/shared';

import type { KanbanBundleResponse } from '@/hooks/useKanbanBundle';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { buildBoard, cellAt, formatKanbanValue, isValueCandidate, planMove, prefillFor } from './kanbanModel';

const field = (id: number, slug: string, type: string, config: Record<string, unknown> = {}): FieldEntity =>
    ({ id, slug, label: slug.charAt(0).toUpperCase() + slug.slice(1), type, config, position: id, is_required: false, is_unique: false }) as unknown as FieldEntity;

const etapa = field(2, 'etapa', 'select', {
    options: [
        { value: 'prospecto', label: 'Prospecto', color: 'slate' },
        { value: 'ganado', label: 'Ganado', color: 'green' },
        { value: 'perdido', label: 'Perdido', color: 'red' },
    ],
});
const monto = field(3, 'monto', 'currency', { currency: 'COP', precision: 0 });
const vendedor = field(4, 'vendedor', 'user');
const motivo = field(6, 'motivo', 'text');
const nombre = field(1, 'nombre', 'text');
const fields = [nombre, etapa, monto, vendedor, motivo];

const rec = (id: number, values: Record<string, unknown>): RecordEntity =>
    ({ id, fields: values, relations: {}, created_at: '', updated_at: '' }) as unknown as RecordEntity;

const settings = (p: Partial<KanbanSettings> = {}): KanbanSettings => ({ ...DEFAULT_KANBAN_SETTINGS, ...p });

const bundle: KanbanBundleResponse = {
    meta: {
        group_by_field_id: 2,
        group_by_slug: 'etapa',
        group_by_type: 'select',
        value_field_id: 3,
        value_metric: 'sum',
        total_records: 4,
        total_value: 600,
        per_cell: 25,
        hidden_columns: 0,
        hidden_lanes: 0,
    },
    columns: [
        { value: 'prospecto', count: 3, total: 500 },
        { value: null, count: 1, total: 100 },
    ],
    cells: {
        prospecto: {
            count: 3,
            total: 500,
            has_more: true,
            records: [rec(1, { nombre: 'A', etapa: 'prospecto', monto: 300 }), rec(2, { nombre: 'B', etapa: 'prospecto', monto: 150 })],
        },
        __null__: { count: 1, total: 100, has_more: false, records: [rec(3, { nombre: 'C', monto: 100 })] },
    },
};

describe('kanban — el tablero a partir del bundle', () => {
    it('columnas en el orden del catálogo (aunque estén vacías), «Sin valor» al final, totales del servidor', () => {
        const b = buildBoard({ groupField: etapa, laneField: null, valueField: monto, settings: settings(), bundle });
        expect(b.columns.map((c) => [c.key, c.label, c.count, c.total])).toEqual([
            ['prospecto', 'Prospecto', 3, 500],
            ['ganado', 'Ganado', 0, 0],
            ['perdido', 'Perdido', 0, 0],
            ['__null__', 'Sin valor', 1, 100],
        ]);
        expect(b.columns[1]!.color).toBe('green');
        const pros = cellAt(b, null, 'prospecto');
        expect(pros.records).toHaveLength(2);
        expect(pros.hasMore).toBe(true);
        expect(b.totalCount).toBe(4);
        expect(b.totalValue).toBe(600);
    });

    it('ocultas, vacías ocultas, plegadas, límites y reglas por columna', () => {
        const b = buildBoard({
            groupField: etapa,
            laneField: null,
            valueField: null,
            settings: settings({
                hiddenColumns: ['__null__'],
                hideEmpty: true,
                collapsedColumns: ['prospecto'],
                wipLimits: { prospecto: 2 },
                moveRules: { prospecto: [6] },
            }),
            bundle,
        });
        expect(b.columns.map((c) => c.key)).toEqual(['prospecto']);
        expect(b.hiddenColumns).toEqual([{ key: '__null__', label: 'Sin valor' }]);
        expect(b.columns[0]).toMatchObject({ collapsed: true, wip: 2, requiredFieldIds: [6], total: null });
    });

    it('optimista: una tarjeta cuyo valor ya cambió aparece en su columna nueva y los conteos se corrigen', () => {
        const moved: KanbanBundleResponse = {
            ...bundle,
            cells: {
                ...bundle.cells,
                prospecto: {
                    ...bundle.cells.prospecto!,
                    records: [rec(1, { nombre: 'A', etapa: 'ganado', monto: 300 }), rec(2, { nombre: 'B', etapa: 'prospecto', monto: 150 })],
                },
            },
        };
        const b = buildBoard({ groupField: etapa, laneField: null, valueField: monto, settings: settings(), bundle: moved });
        const col = (k: string) => b.columns.find((c) => c.key === k)!;
        expect(col('prospecto')).toMatchObject({ count: 2, total: 200 });
        expect(col('ganado')).toMatchObject({ count: 1, total: 300 });
        expect(cellAt(b, null, 'ganado').records!.map((r) => r.id)).toEqual([1]);
        expect(cellAt(b, null, 'prospecto').records!.map((r) => r.id)).toEqual([2]);
    });

    it('con carriles: celdas por (carril, columna), carriles con nombre de persona', () => {
        const withLanes: KanbanBundleResponse = {
            ...bundle,
            meta: { ...bundle.meta, lane_field_id: 4 },
            lanes: [
                { value: '7', count: 2, total: 450 },
                { value: null, count: 2, total: 150 },
            ],
            cells: {
                '["7","prospecto"]': { count: 2, total: 450, has_more: false, records: [rec(1, { etapa: 'prospecto', vendedor: 7, monto: 300 }), rec(2, { etapa: 'prospecto', vendedor: 7, monto: 150 })] },
                '["__null__","prospecto"]': { count: 1, total: 50, has_more: true, records: [] },
                '["__null__","__null__"]': { count: 1, total: 100, has_more: false, records: [rec(3, { monto: 100 })] },
            },
        };
        const b = buildBoard({
            groupField: etapa,
            laneField: vendedor,
            valueField: monto,
            settings: settings({ laneFieldId: 4 }),
            bundle: withLanes,
            userNames: new Map([[7, 'Ana Ruiz']]),
        });
        expect(b.lanes!.map((l) => [l.key, l.label, l.count])).toEqual([
            ['7', 'Ana Ruiz', 2],
            ['__null__', 'Sin valor', 2],
        ]);
        expect(cellAt(b, '7', 'prospecto').records).toHaveLength(2);
        expect(cellAt(b, '__null__', 'prospecto').hasMore).toBe(true);
        expect(cellAt(b, '7', 'ganado').count).toBe(0);
    });
});

describe('kanban — mover una tarjeta', () => {
    const base = {
        groupField: etapa,
        laneField: null,
        fields,
        settings: settings({ moveRules: { perdido: [6] } }),
    };

    it('misma columna: nada; otra columna: el valor de la opción', () => {
        const r = rec(1, { etapa: 'prospecto' });
        expect(planMove({ ...base, record: r, fromColumn: 'prospecto', fromLane: null, toColumn: 'prospecto', toLane: null })).toEqual({ kind: 'noop' });
        expect(planMove({ ...base, record: r, fromColumn: 'prospecto', fromLane: null, toColumn: 'ganado', toLane: null })).toEqual({
            kind: 'move',
            values: { etapa: 'ganado' },
        });
        // «Sin valor» vacía el campo.
        expect(planMove({ ...base, record: r, fromColumn: 'prospecto', fromLane: null, toColumn: '__null__', toLane: null })).toEqual({
            kind: 'move',
            values: { etapa: null },
        });
    });

    it('regla al mover: pide los campos vacíos; si ya están completos, mueve directo', () => {
        const empty = planMove({ ...base, record: rec(1, { etapa: 'prospecto' }), fromColumn: 'prospecto', fromLane: null, toColumn: 'perdido', toLane: null });
        expect(empty.kind).toBe('ask');
        if (empty.kind === 'ask') {
            expect(empty.required.map((f) => f.slug)).toEqual(['motivo']);
            expect(empty.values).toEqual({ etapa: 'perdido' });
        }
        const filled = planMove({ ...base, record: rec(1, { etapa: 'prospecto', motivo: 'Precio' }), fromColumn: 'prospecto', fromLane: null, toColumn: 'perdido', toLane: null });
        expect(filled.kind).toBe('move');
    });

    it('entre carriles cambia los dos campos; una columna bloqueada por la tienda no se mueve', () => {
        const r = rec(1, { etapa: 'prospecto', vendedor: 7 });
        expect(
            planMove({ ...base, laneField: vendedor, record: r, fromColumn: 'prospecto', fromLane: '7', toColumn: 'ganado', toLane: '9' }),
        ).toEqual({ kind: 'move', values: { etapa: 'ganado', vendedor: 9 } });
        // Sólo el carril: no se piden las reglas de la columna (no se ENTRA a otra columna).
        expect(
            planMove({ ...base, laneField: vendedor, record: r, fromColumn: 'perdido', fromLane: '7', toColumn: 'perdido', toLane: '__null__' }),
        ).toEqual({ kind: 'move', values: { vendedor: null } });
        const locked = planMove({
            ...base,
            record: r,
            fromColumn: 'prospecto',
            fromLane: null,
            toColumn: 'ganado',
            toLane: null,
            lockedReason: (f) => (f.slug === 'etapa' ? 'Viene de la tienda.' : null),
        });
        expect(locked).toEqual({ kind: 'blocked', reason: 'Viene de la tienda.' });
    });

    it('crear dentro de una columna y carril pre-carga los dos valores', () => {
        expect(prefillFor(etapa, 'ganado', vendedor, '7')).toEqual({ etapa: 'ganado', vendedor: 7 });
        expect(prefillFor(etapa, '__null__', null, null)).toEqual({});
    });
});

describe('kanban — totales', () => {
    it('moneda con su código y campos que se pueden sumar', () => {
        expect(formatKanbanValue(monto, 1500000)).toMatch(/1,500,000/);
        expect(formatKanbanValue(field(9, 'avance', 'percent'), 42.5)).toBe('42.5 %');
        expect(isValueCandidate(monto)).toBe(true);
        expect(isValueCandidate(nombre)).toBe(false);
        expect(isValueCandidate(field(10, 'total', 'computed', { operation: 'concat' }))).toBe(false);
        expect(isValueCandidate(field(11, 'total', 'computed', { operation: 'product' }))).toBe(true);
    });
});
