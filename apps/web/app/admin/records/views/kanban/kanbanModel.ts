import {
    formatDuration,
    isKanbanEmptyValue,
    KANBAN_NULL_KEY,
    kanbanBucketKeyOf,
    kanbanBucketValue,
    kanbanCellKey,
    kanbanRawKey,
    type DurationFormat,
    type FieldType,
    type KanbanSettings,
} from '@imagina-base/shared';

import { fieldPrecision, formatFieldNumber } from '@/lib/fieldNumberFormat';
import { __ } from '@/lib/i18n';
import { formatDateStr, formatNumber, numberFormatLocale } from '@/lib/tenantFormat';
import { rollupDisplayField } from '@/lib/throughFields';
import type { KanbanBundleResponse } from '@/hooks/useKanbanBundle';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { extractFieldOptions } from '../../fieldOptions';

/**
 * v0.1.297 — Kanban para ventas (B5): el MODELO del tablero, puro y testeable.
 * Arma columnas, carriles y celdas a partir del bundle del servidor y de los
 * ajustes de la vista, y decide qué pasa cuando se suelta una tarjeta.
 *
 * El optimista: `useUpdateRecord` parcha el VALOR del registro en el cache
 * del bundle (`patchRecordInCache`, rama `cells`). Aquí cada tarjeta se ubica
 * por su valor ACTUAL (con las mismas reglas de clave que el servidor), así
 * una tarjeta movida aparece en su columna nueva al instante y los conteos se
 * corrigen en el acto; el refetch después confirma.
 */

export interface BoardColumn {
    key: string;
    raw: string | null;
    label: string;
    color?: string;
    count: number;
    total: number | null;
    collapsed: boolean;
    wip: number | null;
    requiredFieldIds: number[];
}

export interface BoardLane {
    key: string;
    raw: string | null;
    label: string;
    color?: string;
    count: number;
    total: number | null;
    collapsed: boolean;
}

export interface BoardCell {
    key: string;
    columnKey: string;
    laneKey: string | null;
    count: number;
    total: number | null;
    /** null = no se cargó (columna o carril plegado). */
    records: RecordEntity[] | null;
    hasMore: boolean;
}

export interface Board {
    columns: BoardColumn[];
    /** null = sin carriles. */
    lanes: BoardLane[] | null;
    cells: Map<string, BoardCell>;
    totalCount: number;
    totalValue: number | null;
    /** Columnas que el usuario ocultó (para ofrecer volver a mostrarlas). */
    hiddenColumns: Array<{ key: string; label: string }>;
}

export interface BoardInput {
    groupField: FieldEntity;
    laneField: FieldEntity | null;
    valueField: FieldEntity | null;
    settings: KanbanSettings;
    bundle: KanbanBundleResponse | undefined;
    /** Nombres de personas (columnas o carriles por un campo persona). */
    userNames?: Map<number, string>;
}

const NULL = KANBAN_NULL_KEY;

/** Etiqueta visible de un grupo (columna o carril). */
export function bucketLabel(field: FieldEntity, raw: string | null, userNames?: Map<number, string>): string {
    if (raw === null) return __('Sin valor');
    if (field.type === 'select' || field.type === 'multi_select') {
        const options = extractFieldOptions(field);
        const label = (v: string): string => options.find((o) => o.value === v)?.label ?? v;
        if (field.type === 'multi_select') {
            const v = kanbanBucketValue('multi_select', raw);
            return v.ok && Array.isArray(v.value) ? (v.value as string[]).map(label).join(' + ') : raw;
        }
        return label(raw);
    }
    if (field.type === 'user') {
        const id = Number(raw);
        return userNames?.get(id) ?? `#${raw}`;
    }
    if (field.type === 'checkbox') return raw === 'true' || raw === '1' ? __('Sí') : __('No');
    if (field.type === 'date' || field.type === 'datetime') return formatDateStr(raw);
    return raw;
}

function optionColor(field: FieldEntity, raw: string | null): string | undefined {
    if (raw === null || field.type !== 'select') return undefined;
    return extractFieldOptions(field).find((o) => o.value === raw)?.color;
}

/**
 * Las claves de los grupos en el orden en que se dibujan: el catálogo de
 * opciones de un select (aunque no tengan tarjetas, salvo «ocultar vacías»),
 * después los valores que aparecen y no están en el catálogo, y «Sin valor»
 * al final sólo si tiene tarjetas. Una persona se ordena por su nombre.
 */
function groupKeys(
    field: FieldEntity,
    present: Array<{ value: string | null; count: number }>,
    opts: { hideEmpty: boolean; userNames?: Map<number, string> },
): Array<string | null> {
    const count = new Map(present.map((p) => [p.value, p.count]));
    const out: Array<string | null> = [];
    if (field.type === 'select') {
        for (const o of extractFieldOptions(field)) {
            if (!opts.hideEmpty || (count.get(o.value) ?? 0) > 0) out.push(o.value);
        }
    } else if (field.type === 'checkbox') {
        for (const v of ['true', 'false']) if (!opts.hideEmpty || (count.get(v) ?? 0) > 0) out.push(v);
    }
    const extras = present.filter((p) => p.value !== null && !out.includes(p.value) && p.count > 0).map((p) => p.value as string);
    if (field.type === 'user') {
        const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
        extras.sort((a, b) => collator.compare(bucketLabel(field, a, opts.userNames), bucketLabel(field, b, opts.userNames)));
    }
    out.push(...extras);
    if ((count.get(null) ?? 0) > 0) out.push(null);
    return out;
}

/** Clave de grupo de una tarjeta según su valor ACTUAL (undefined = la del servidor). */
function currentKey(field: FieldEntity, record: RecordEntity): string | undefined {
    const k = kanbanBucketKeyOf(field.type as FieldType, record.fields[field.slug]);
    return k === undefined ? undefined : (k ?? NULL);
}

function numericValue(record: RecordEntity, field: FieldEntity | null): number {
    if (!field) return 0;
    const v = record.fields[field.slug];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

export function buildBoard(input: BoardInput): Board {
    const { groupField, laneField, valueField, settings, bundle, userNames } = input;
    const lanesOn = laneField !== null && bundle?.lanes !== undefined;
    const additive = settings.valueMetric === 'sum' && valueField !== null;

    // Celdas del servidor + reubicación optimista por el valor actual.
    const cells = new Map<string, BoardCell>();
    const colAdj = new Map<string, { count: number; total: number }>();
    const laneAdj = new Map<string, { count: number; total: number }>();
    const bump = (m: Map<string, { count: number; total: number }>, k: string, c: number, t: number): void => {
        const cur = m.get(k) ?? { count: 0, total: 0 };
        m.set(k, { count: cur.count + c, total: cur.total + t });
    };
    const cellOf = (laneKey: string | null, columnKey: string): BoardCell => {
        const key = lanesOn ? kanbanCellKey(laneKey ?? NULL, kanbanRawKey(columnKey)) : columnKey;
        let cell = cells.get(key);
        if (!cell) {
            cell = { key, columnKey, laneKey: lanesOn ? laneKey ?? NULL : null, count: 0, total: null, records: [], hasMore: false };
            cells.set(key, cell);
        }
        return cell;
    };
    for (const [key, c] of Object.entries(bundle?.cells ?? {})) {
        let columnKey = key;
        let laneKey: string | null = null;
        if (lanesOn) {
            try {
                const pair = JSON.parse(key) as [string, string];
                laneKey = pair[0];
                columnKey = pair[1];
            } catch {
                continue;
            }
        }
        const cell = cellOf(laneKey, columnKey);
        cell.count += c.count;
        cell.total = c.total;
        cell.records = c.records === null ? null : [...(cell.records ?? []), ...c.records];
    }
    // Tarjetas que su valor ya ubica en otra celda (movidas, aún sin refetch).
    const moves: Array<{ record: RecordEntity; from: BoardCell; to: BoardCell }> = [];
    for (const cell of cells.values()) {
        for (const record of cell.records ?? []) {
            const col = currentKey(groupField, record) ?? cell.columnKey;
            const lane = lanesOn && laneField ? currentKey(laneField, record) ?? cell.laneKey : null;
            if (col === cell.columnKey && lane === cell.laneKey) continue;
            moves.push({ record, from: cell, to: cellOf(lane, col) });
        }
    }
    for (const { record, from, to } of moves) {
        const v = numericValue(record, valueField);
        from.records = (from.records ?? []).filter((r) => r.id !== record.id);
        from.count = Math.max(0, from.count - 1);
        if (to.records !== null) to.records = [record, ...to.records.filter((r) => r.id !== record.id)];
        to.count += 1;
        if (additive) {
            from.total = (from.total ?? 0) - v;
            to.total = (to.total ?? 0) + v;
        }
        if (from.columnKey !== to.columnKey) {
            bump(colAdj, from.columnKey, -1, -v);
            bump(colAdj, to.columnKey, 1, v);
        }
        if (lanesOn && from.laneKey !== to.laneKey) {
            bump(laneAdj, from.laneKey ?? NULL, -1, -v);
            bump(laneAdj, to.laneKey ?? NULL, 1, v);
        }
    }
    for (const cell of cells.values()) {
        cell.hasMore = cell.records !== null && cell.count > cell.records.length;
    }

    // Columnas.
    const serverCols = new Map((bundle?.columns ?? []).map((c) => [c.value ?? NULL, c]));
    const presentCols = [...serverCols.values()].map((c) => {
        const adj = colAdj.get(c.value ?? NULL);
        return { value: c.value, count: c.count + (adj?.count ?? 0) };
    });
    // Una columna que sólo existe por una tarjeta movida (valor nuevo) también cuenta.
    for (const [k, adj] of colAdj) {
        if (!serverCols.has(k) && adj.count > 0) presentCols.push({ value: kanbanRawKey(k), count: adj.count });
    }
    const hidden = new Set(settings.hiddenColumns);
    const allKeys = groupKeys(groupField, presentCols, { hideEmpty: settings.hideEmpty, userNames });
    const columns: BoardColumn[] = [];
    const hiddenColumns: Board['hiddenColumns'] = [];
    for (const raw of allKeys) {
        const key = raw ?? NULL;
        const label = bucketLabel(groupField, raw, userNames);
        if (hidden.has(key)) {
            hiddenColumns.push({ key, label });
            continue;
        }
        const server = serverCols.get(key);
        const adj = colAdj.get(key);
        columns.push({
            key,
            raw,
            label,
            color: optionColor(groupField, raw),
            count: (server?.count ?? 0) + (adj?.count ?? 0),
            total: valueField === null ? null : additive ? (server?.total ?? 0) + (adj?.total ?? 0) : server?.total ?? null,
            collapsed: settings.collapsedColumns.includes(key),
            wip: settings.wipLimits[key] ?? null,
            requiredFieldIds: settings.moveRules[key] ?? [],
        });
    }

    // Carriles.
    let lanes: BoardLane[] | null = null;
    if (lanesOn && laneField) {
        const serverLanes = new Map((bundle?.lanes ?? []).map((l) => [l.value ?? NULL, l]));
        const presentLanes = [...serverLanes.values()].map((l) => ({
            value: l.value,
            count: l.count + (laneAdj.get(l.value ?? NULL)?.count ?? 0),
        }));
        for (const [k, adj] of laneAdj) {
            if (!serverLanes.has(k) && adj.count > 0) presentLanes.push({ value: kanbanRawKey(k), count: adj.count });
        }
        lanes = groupKeys(laneField, presentLanes, { hideEmpty: settings.hideEmpty, userNames }).map((raw) => {
            const key = raw ?? NULL;
            const server = serverLanes.get(key);
            const adj = laneAdj.get(key);
            return {
                key,
                raw,
                label: bucketLabel(laneField, raw, userNames),
                color: optionColor(laneField, raw),
                count: (server?.count ?? 0) + (adj?.count ?? 0),
                total: valueField === null ? null : additive ? (server?.total ?? 0) + (adj?.total ?? 0) : server?.total ?? null,
                collapsed: settings.collapsedLanes.includes(key),
            };
        });
    }

    return {
        columns,
        lanes,
        cells,
        totalCount: bundle?.meta.total_records ?? 0,
        totalValue: valueField === null ? null : bundle?.meta.total_value ?? null,
        hiddenColumns,
    };
}

/** La celda (o una vacía) de un carril y una columna. */
export function cellAt(board: Board, laneKey: string | null, columnKey: string): BoardCell {
    const key = board.lanes !== null ? kanbanCellKey(laneKey ?? NULL, kanbanRawKey(columnKey)) : columnKey;
    return (
        board.cells.get(key) ?? {
            key,
            columnKey,
            laneKey: board.lanes !== null ? laneKey ?? NULL : null,
            count: 0,
            total: null,
            records: [],
            hasMore: false,
        }
    );
}

// ─── Mover una tarjeta ────────────────────────────────────────────────

export type MovePlan =
    | { kind: 'noop' }
    | { kind: 'blocked'; reason: string }
    | { kind: 'move'; values: Record<string, unknown> }
    /** Faltan campos que la columna destino pide: se abre el diálogo. */
    | { kind: 'ask'; values: Record<string, unknown>; required: FieldEntity[] };

export interface MoveInput {
    record: RecordEntity;
    fromColumn: string;
    fromLane: string | null;
    toColumn: string;
    toLane: string | null;
    groupField: FieldEntity;
    laneField: FieldEntity | null;
    fields: FieldEntity[];
    settings: KanbanSettings;
    /** Por qué un campo no se puede cambiar en ESTE registro (tienda), o null. */
    lockedReason?: (field: FieldEntity, record: RecordEntity) => string | null;
}

/** Tipos que no se escriben a mano (no se piden al mover). */
const NOT_WRITABLE: readonly string[] = ['lookup', 'rollup', 'computed', 'formula', 'ai', 'time_tracked', 'approval', 'checklist_progress', 'relation', 'file'];

export function planMove(input: MoveInput): MovePlan {
    const { record, groupField, laneField, settings } = input;
    const columnChanges = input.toColumn !== input.fromColumn;
    const laneChanges = laneField !== null && input.toLane !== null && input.toLane !== input.fromLane;
    if (!columnChanges && !laneChanges) return { kind: 'noop' };

    const values: Record<string, unknown> = {};
    const assign = (field: FieldEntity, key: string): string | null => {
        const locked = input.lockedReason?.(field, record) ?? null;
        if (locked) return locked;
        const v = kanbanBucketValue(field.type as FieldType, kanbanRawKey(key));
        if (!v.ok) return `«${field.label}» se calcula solo: no se puede cambiar arrastrando.`;
        values[field.slug] = v.value;
        return null;
    };
    if (columnChanges) {
        const err = assign(groupField, input.toColumn);
        if (err) return { kind: 'blocked', reason: err };
    }
    if (laneChanges && laneField) {
        const err = assign(laneField, input.toLane!);
        if (err) return { kind: 'blocked', reason: err };
    }
    if (!columnChanges) return { kind: 'move', values };

    const byId = new Map(input.fields.map((f) => [f.id, f]));
    const required = (settings.moveRules[input.toColumn] ?? [])
        .map((id) => byId.get(id))
        .filter((f): f is FieldEntity => f !== undefined && !NOT_WRITABLE.includes(f.type) && f.id !== groupField.id && f.id !== laneField?.id);
    const missing = required.filter((f) => isKanbanEmptyValue(record.fields[f.slug]));
    return missing.length > 0 ? { kind: 'ask', values, required } : { kind: 'move', values };
}

/** Los campos de la regla que siguen vacíos en el formulario del diálogo. */
export function missingRequired(required: FieldEntity[], values: Record<string, unknown>): string[] {
    return required.filter((f) => isKanbanEmptyValue(values[f.slug])).map((f) => f.slug);
}

/** Valores para crear una tarjeta DENTRO de una columna (y carril). */
export function prefillFor(
    groupField: FieldEntity,
    columnKey: string,
    laneField: FieldEntity | null,
    laneKey: string | null,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const col = kanbanBucketValue(groupField.type as FieldType, kanbanRawKey(columnKey));
    if (col.ok && col.value !== null) out[groupField.slug] = col.value;
    if (laneField && laneKey !== null) {
        const lane = kanbanBucketValue(laneField.type as FieldType, kanbanRawKey(laneKey));
        if (lane.ok && lane.value !== null) out[laneField.slug] = lane.value;
    }
    return out;
}

// ─── Formato de los totales ───────────────────────────────────────────

/** El total de una columna con el formato del campo (moneda con su símbolo). */
export function formatKanbanValue(field: FieldEntity, n: number): string {
    if (field.type === 'rollup') return formatKanbanValue(rollupDisplayField(field), n);
    if (field.type === 'duration' || field.type === 'time_tracked') {
        return formatDuration(Math.round(n), (field.config as { format?: DurationFormat }).format) || '0m';
    }
    if (field.type === 'percent' || field.type === 'checklist_progress') return `${formatNumber(n, { maxFrac: 1 })} %`;
    if (field.type === 'currency') {
        const currency = (field.config as { currency?: string }).currency || 'COP';
        const decimals = fieldPrecision(field);
        try {
            return new Intl.NumberFormat(numberFormatLocale(), {
                style: 'currency',
                currency,
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            }).format(n);
        } catch {
            return formatFieldNumber(field, n);
        }
    }
    if (field.type === 'computed') return formatNumber(n, { maxFrac: 2 });
    return formatFieldNumber(field, n);
}

/** ¿El tipo puede ser campo de valor (suma/promedio)? */
export function isValueCandidate(field: FieldEntity): boolean {
    if (['number', 'currency', 'percent', 'rating', 'duration'].includes(field.type)) return true;
    // Un rollup o computed numérico (los de texto/fecha no se suman).
    if (field.type === 'rollup') {
        const display = rollupDisplayField(field);
        return display.type !== 'date' && display.type !== 'datetime';
    }
    if (field.type === 'computed') {
        const op = (field.config as { operation?: string }).operation;
        return op === 'sum' || op === 'product' || op === 'subtract' || op === 'divide' || op === 'abs';
    }
    return false;
}

/** El orden de las tarjetas de la vista (`config.sort`) en el formato del endpoint. */
export function sortParam(sort: Array<{ field_id: number; dir: 'asc' | 'desc' }> | undefined): string | undefined {
    if (!sort || sort.length === 0) return undefined;
    return sort.map((s) => `field_${s.field_id}:${s.dir}`).join(',');
}
