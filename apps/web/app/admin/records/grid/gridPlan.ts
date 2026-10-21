import {
    coerceTextToFieldValue,
    sameBulkValue,
    validateFieldValue,
    type TextCoercionOptions,
} from '@imagina-base/shared';

import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { isCheckedValue } from '../renderCellValue';
import type { GridRect } from './selection';

/**
 * v0.1.287 — Qué escribir en la tabla al PEGAR un bloque, RELLENAR hacia
 * abajo o BORRAR un rango. Puro: devuelve los cambios celda por celda (con
 * su valor anterior, para deshacer) y las celdas que no se pudieron, con el
 * motivo. La tabla manda los cambios en UNA llamada (`PATCH …/records/batch`).
 */

/** Una columna visible de la tabla (las de ID / Actualizado no tienen campo). */
export interface GridColumnRef {
    id: string;
    field: FieldEntity | null;
}

/** Una celda que cambia. */
export interface CellChange {
    recordId: number;
    field: FieldEntity;
    before: unknown;
    after: unknown;
    row: number;
    col: number;
}

/** Una celda que no se pudo escribir. */
export interface CellIssue {
    row: number;
    col: number;
    label: string;
    reason: string;
}

export interface GridPlan {
    changes: CellChange[];
    issues: CellIssue[];
    /** Celdas que ya tenían ese valor (no viajan). */
    unchanged: number;
    /** Filas del bloque que no entraron (no hay tantas filas cargadas). */
    truncatedRows: number;
    /** Columnas del bloque que no entraron (no hay tantas columnas visibles). */
    truncatedCols: number;
}

/**
 * Por qué una celda no se puede escribir desde la tabla (o null si se puede).
 * `purpose` distingue pegar texto (relación y archivos no se leen desde
 * texto) de rellenar/borrar (copian o vacían el valor tal cual).
 */
export type LockedReason = (field: FieldEntity, record: RecordEntity) => string | null;

export function cellWriteBlock(
    field: FieldEntity | null,
    record: RecordEntity,
    purpose: 'paste' | 'fill' | 'clear',
    locked?: LockedReason,
): string | null {
    if (!field) return __('Esta columna no se edita');
    switch (field.type) {
        case 'computed':
        case 'lookup':
        case 'rollup':
            return __('Se calcula sola');
        case 'ai':
            return __('La completa la IA');
        case 'file':
            if (purpose !== 'clear') return __('Los archivos se suben desde la ficha');
            break;
        case 'relation':
            if (purpose === 'paste') return __('Los vínculos se eligen desde la celda');
            break;
        default:
            break;
    }
    return locked?.(field, record) ?? null;
}

/** El valor de una celda tal como lo guarda el registro. */
export function cellValue(record: RecordEntity, field: FieldEntity): unknown {
    return field.type === 'relation' ? record.relations?.[field.slug] ?? [] : record.fields[field.slug];
}

/** ¿El valor nuevo es el mismo que el actual? (vacío = vacío; casilla vacía = desmarcada). */
export function sameCellValue(field: FieldEntity, a: unknown, b: unknown): boolean {
    if (field.type === 'checkbox') return isCheckedValue(a) === isCheckedValue(b);
    return sameBulkValue(a, b, field.type === 'multi_select' || field.type === 'relation');
}

/** El valor "vacío" de un tipo (lo que deja Supr). */
export function emptyValueFor(field: FieldEntity): unknown {
    if (field.type === 'multi_select' || field.type === 'relation' || field.type === 'file') return [];
    if (field.type === 'checkbox') return false;
    return null;
}

/**
 * PEGAR: el bloque (TSV ya partido) a partir de la esquina superior
 * izquierda de `target`. Si el bloque es UNA celda y el destino es un rango,
 * esa celda llena todo el rango (como Excel). Cada texto se convierte al tipo
 * del campo destino con la misma conversión que el import CSV y se valida
 * con el validador compartido: lo que no sirve queda en `issues` con el
 * motivo, y el resto se pega igual.
 */
export function planPaste(args: {
    block: string[][];
    target: GridRect;
    rows: RecordEntity[];
    columns: GridColumnRef[];
    coercion: TextCoercionOptions;
    locked?: LockedReason;
}): GridPlan {
    const { block, target, rows, columns } = args;
    const plan: GridPlan = { changes: [], issues: [], unchanged: 0, truncatedRows: 0, truncatedCols: 0 };
    const width = Math.max(0, ...block.map((r) => r.length));
    if (block.length === 0 || width === 0) return plan;
    const single = block.length === 1 && width === 1;
    const fillRange = single && (target.bottom > target.top || target.right > target.left);
    const height = fillRange ? target.bottom - target.top + 1 : block.length;
    const cols = fillRange ? target.right - target.left + 1 : width;

    for (let dr = 0; dr < height; dr++) {
        const row = target.top + dr;
        const record = rows[row];
        if (!record) {
            plan.truncatedRows = height - dr;
            break;
        }
        for (let dc = 0; dc < cols; dc++) {
            const col = target.left + dc;
            const column = columns[col];
            if (!column) {
                if (dr === 0) plan.truncatedCols = cols - dc;
                break;
            }
            const raw = fillRange ? block[0]![0]! : block[dr]?.[dc] ?? '';
            const field = column.field;
            const label = field?.label ?? column.id;
            const blocked = cellWriteBlock(field, record, 'paste', args.locked);
            if (blocked !== null || !field) {
                plan.issues.push({ row, col, label, reason: blocked ?? '' });
                continue;
            }
            const coerced = coerceTextToFieldValue(raw, field, args.coercion);
            const valid = validateFieldValue({ type: field.type, config: field.config, is_required: field.is_required }, coerced);
            if (!valid.ok) {
                plan.issues.push({ row, col, label, reason: valid.error });
                continue;
            }
            const before = cellValue(record, field);
            if (sameCellValue(field, before, valid.value)) {
                plan.unchanged++;
                continue;
            }
            plan.changes.push({ recordId: record.id, field, before, after: valid.value, row, col });
        }
    }
    return plan;
}

/**
 * RELLENAR: copia los valores de las filas `sourceTop..sourceBottom` a las
 * filas `targetTop..targetBottom` (repitiendo el patrón si son varias, como
 * el asa de Excel), en las columnas `left..right`. Los valores viajan tal
 * cual (mismo campo): no hay conversión.
 */
export function planFill(args: {
    rows: RecordEntity[];
    columns: GridColumnRef[];
    left: number;
    right: number;
    sourceTop: number;
    sourceBottom: number;
    targetTop: number;
    targetBottom: number;
    locked?: LockedReason;
}): GridPlan {
    const plan: GridPlan = { changes: [], issues: [], unchanged: 0, truncatedRows: 0, truncatedCols: 0 };
    const span = args.sourceBottom - args.sourceTop + 1;
    if (span <= 0) return plan;
    for (let row = args.targetTop; row <= args.targetBottom; row++) {
        const record = args.rows[row];
        const source = args.rows[args.sourceTop + ((row - args.targetTop) % span)];
        if (!record || !source) continue;
        for (let col = args.left; col <= args.right; col++) {
            const column = args.columns[col];
            if (!column) continue;
            const field = column.field;
            const blocked = cellWriteBlock(field, record, 'fill', args.locked);
            if (blocked !== null || !field) {
                plan.issues.push({ row, col, label: field?.label ?? column.id, reason: blocked ?? '' });
                continue;
            }
            const before = cellValue(record, field);
            const after = cellValue(source, field);
            if (sameCellValue(field, before, after)) {
                plan.unchanged++;
                continue;
            }
            plan.changes.push({ recordId: record.id, field, before, after: after ?? null, row, col });
        }
    }
    return plan;
}

/** BORRAR (Supr): vacía las celdas escribibles del rango. */
export function planClear(args: { rows: RecordEntity[]; columns: GridColumnRef[]; rect: GridRect; locked?: LockedReason }): GridPlan {
    const plan: GridPlan = { changes: [], issues: [], unchanged: 0, truncatedRows: 0, truncatedCols: 0 };
    for (let row = args.rect.top; row <= args.rect.bottom; row++) {
        const record = args.rows[row];
        if (!record) continue;
        for (let col = args.rect.left; col <= args.rect.right; col++) {
            const column = args.columns[col];
            if (!column) continue;
            const field = column.field;
            const blocked = cellWriteBlock(field, record, 'clear', args.locked);
            if (blocked !== null || !field) {
                plan.issues.push({ row, col, label: field?.label ?? column.id, reason: blocked ?? '' });
                continue;
            }
            const before = cellValue(record, field);
            const after = emptyValueFor(field);
            if (sameCellValue(field, before, after)) {
                plan.unchanged++;
                continue;
            }
            plan.changes.push({ recordId: record.id, field, before, after, row, col });
        }
    }
    return plan;
}

/**
 * Los motivos de las celdas que no se pudieron, resumidos para el aviso:
 * «Estado (fila 3): Opción no válida…», agrupados por columna y motivo.
 */
export function summarizeIssues(issues: CellIssue[], max = 3): string[] {
    const groups = new Map<string, { label: string; reason: string; rows: number[] }>();
    for (const i of issues) {
        const k = `${i.label}\u0000${i.reason}`;
        const g = groups.get(k) ?? { label: i.label, reason: i.reason, rows: [] };
        g.rows.push(i.row + 1);
        groups.set(k, g);
    }
    const out: string[] = [];
    for (const g of groups.values()) {
        const rows = g.rows.length === 1 ? `${__('fila')} ${g.rows[0]}` : `${g.rows.length} ${__('filas')}`;
        out.push(`«${g.label}» (${rows}): ${g.reason}`);
    }
    return out.slice(0, max).concat(out.length > max ? [`… ${out.length - max} ${__('más')}`] : []);
}
