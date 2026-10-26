import {
    coerceTextToFieldValue,
    foldSearchText,
    sameBulkValue,
    validateFieldValue,
    type TextCoercionOptions,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { extractFieldOptions } from '../fieldOptions';
import { isCheckedValue } from '../renderCellValue';
import type { ClipCell } from './clipboard';
import { fillValues } from './fillSeries';
import type { GridRect } from './selection';

/**
 * v0.1.287 / v0.1.294 — Qué escribir en la tabla al PEGAR un bloque,
 * RELLENAR hacia abajo o BORRAR un rango. Puro: devuelve los cambios celda por
 * celda (con su valor anterior, para deshacer) y las celdas que no se
 * pudieron, con un motivo que se entiende («"abc" no es un número»). La tabla
 * manda los cambios en UNA llamada (`PATCH …/records/batch`).
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
    /** El registro (null en una fila NUEVA del pegado). */
    recordId?: number | null;
    /** En una fila nueva: su número (1, 2, …). */
    newRow?: number;
    /** Lo que se pegó en esa celda. */
    text?: string;
    /** El problema es una opción que no existe en ESTE campo (se resuelve creándola). */
    optionFieldId?: number;
}

/** Opciones que el texto pegado nombra y el campo todavía no tiene. */
export interface UnknownOptions {
    field: FieldEntity;
    labels: string[];
}

/** Una fila del bloque que no entró en la tabla (se puede crear como registro nuevo). */
export interface OverflowRow {
    cells: Array<{ col: number; raw: string; internal?: ClipCell }>;
}

export interface GridPlan {
    changes: CellChange[];
    issues: CellIssue[];
    /** Celdas que ya tenían ese valor (no viajan). */
    unchanged: number;
    /**
     * Celdas que se saltean SIN aviso: pegar filas copiadas de la propia tabla
     * trae las columnas ID, Actualizado o calculadas, que vuelven a su misma
     * columna — no es un problema que haya que explicar.
     */
    skipped: number;
    /** Filas del bloque que no entraron (no hay tantas filas cargadas). */
    truncatedRows: number;
    /** Columnas del bloque que no entraron (no hay tantas columnas visibles). */
    truncatedCols: number;
    unknownOptions: UnknownOptions[];
    /** Las filas que no entraron, para crearlas como registros nuevos. */
    overflow: OverflowRow[];
}

export function emptyPlan(): GridPlan {
    return { changes: [], issues: [], unchanged: 0, skipped: 0, truncatedRows: 0, truncatedCols: 0, unknownOptions: [], overflow: [] };
}

/**
 * Por qué una celda no se puede escribir desde la tabla (o null si se puede).
 * `purpose` distingue pegar (archivos no se leen desde texto) de rellenar y
 * borrar (copian o vacían el valor tal cual).
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
        case 'formula':
        case 'lookup':
        case 'rollup':
        case 'time_tracked':
            return __('Se calcula sola');
        case 'checklist_progress':
            return __('Sale de los checklists del registro');
        case 'ai':
            return __('La completa la IA');
        // C5 — el estado lo escribe el flujo de aprobación.
        case 'approval':
            return __('Lo pone el flujo de aprobación');
        // v0.1.300 — los pone la app (al crear o modificar el registro).
        case 'autonumber':
            return __('El ID lo asigna la app');
        case 'created_at':
        case 'updated_at':
        case 'created_by':
        case 'updated_by':
            return __('Lo completa la app');
        // Campo «Botón»: no tiene valor (se presiona).
        case 'button':
            return __('Es un botón: se presiona, no se escribe');
        case 'file':
            if (purpose !== 'clear') return __('Los archivos se suben desde la celda o la ficha');
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

function isEmptyValue(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Títulos de registros de la lista vinculada → id, por campo relation (los
 * busca la tabla antes de armar el plan). `null` = hay varios con ese título.
 */
export type RelationTitleIndex = ReadonlyMap<number, ReadonlyMap<string, number | null>>;

export interface PasteValueContext {
    coercion: TextCoercionOptions;
    relationIds?: RelationTitleIndex;
}

type ValueResult = { ok: true; value: unknown } | { ok: false; reason: string; unknown?: string[] };

const DATE_HINT: Record<string, string> = { dmy: 'DD/MM/AAAA', mdy: 'MM/DD/AAAA', ymd: 'AAAA-MM-DD' };

/** Separa «Acme, Globex» o líneas en los nombres de una relación / multi. */
function splitList(raw: string): string[] {
    return raw
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter((t) => t !== '');
}

/**
 * El valor que queda en una celda a partir de lo pegado. Si lo pegado salió
 * de la propia tabla y vuelve a su MISMO campo, se usa el valor real (sin
 * convertir desde el texto: no se pierde nada). Si no, se lee el texto con las
 * mismas reglas que el import (formato de la empresa) y se valida con el
 * validador compartido; un error se explica en lenguaje claro.
 */
export function resolvePastedValue(
    raw: string,
    internal: ClipCell | undefined,
    field: FieldEntity,
    ctx: PasteValueContext,
): ValueResult {
    const spec = { type: field.type, config: field.config, is_required: field.is_required };
    const shown = raw.trim().length > 40 ? `${raw.trim().slice(0, 40)}…` : raw.trim();

    if (internal && internal.fieldId === field.id) {
        if (field.type === 'relation') {
            const ids = Array.isArray(internal.value) ? internal.value.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
            return { ok: true, value: [...new Set(ids)] };
        }
        const valid = validateFieldValue(spec, internal.value);
        return valid.ok ? { ok: true, value: valid.value } : { ok: false, reason: valid.error };
    }

    if (field.type === 'relation') {
        const index = ctx.relationIds?.get(field.id);
        const ids: number[] = [];
        for (const token of splitList(raw)) {
            const byId = /^#(\d+)$/.exec(token);
            if (byId) {
                ids.push(Number(byId[1]));
                continue;
            }
            const hit = index?.get(foldSearchText(token));
            if (hit === undefined) return { ok: false, reason: sprintf(__('No se encontró «%s» en la lista vinculada'), token) };
            if (hit === null) return { ok: false, reason: sprintf(__('Hay varios registros llamados «%s»: elige el correcto en la celda'), token) };
            ids.push(hit);
        }
        if (ids.length === 0 && field.is_required) return { ok: false, reason: __('Es obligatorio: no puede quedar vacío') };
        return { ok: true, value: [...new Set(ids)] };
    }

    const coerced = coerceTextToFieldValue(raw, field, ctx.coercion);

    if (field.type === 'select' && typeof coerced === 'string' && coerced !== '') {
        const values = new Set(extractFieldOptions(field).map((o) => o.value));
        if (values.size > 0 && !values.has(coerced)) {
            return { ok: false, reason: sprintf(__('«%1$s» no es una opción de «%2$s»'), shown, field.label), unknown: [raw.trim()] };
        }
    }
    if (field.type === 'multi_select' && Array.isArray(coerced)) {
        const values = new Set(extractFieldOptions(field).map((o) => o.value));
        const unknown = values.size > 0 ? (coerced as unknown[]).map(String).filter((v) => !values.has(v)) : [];
        if (unknown.length > 0) {
            return {
                ok: false,
                reason: sprintf(__('«%1$s» no es una opción de «%2$s»'), unknown.join(', '), field.label),
                unknown,
            };
        }
    }
    if (field.type === 'team' && Array.isArray(coerced)) {
        const missing = (coerced as unknown[]).filter((v) => typeof v === 'string');
        if (missing.length > 0) {
            return { ok: false, reason: sprintf(__('No se encontró el equipo «%s»'), missing.map(String).join(', ')) };
        }
    }
    if (field.type === 'user' && typeof coerced === 'string' && coerced.trim() !== '') {
        return { ok: false, reason: sprintf(__('No se encontró a «%s» entre las personas de la empresa'), shown) };
    }

    const valid = validateFieldValue(spec, coerced);
    if (valid.ok) return { ok: true, value: valid.value };
    if (isEmptyValue(coerced) && field.is_required) return { ok: false, reason: __('Es obligatorio: no puede quedar vacío') };
    switch (field.type) {
        case 'number':
        case 'currency':
            return { ok: false, reason: sprintf(__('«%s» no es un número'), shown) };
        case 'percent':
            return { ok: false, reason: typeof coerced === 'number' ? valid.error : sprintf(__('«%s» no es un porcentaje'), shown) };
        case 'date':
        case 'datetime':
            return {
                ok: false,
                reason: sprintf(__('«%1$s» no es una fecha (escríbela como %2$s)'), shown, DATE_HINT[ctx.coercion.dateFormat ?? 'dmy'] ?? 'DD/MM/AAAA'),
            };
        case 'checkbox':
            return { ok: false, reason: sprintf(__('«%s» no es Sí o No'), shown) };
        case 'email':
            return { ok: false, reason: sprintf(__('«%s» no es un correo válido'), shown) };
        case 'url':
            return { ok: false, reason: sprintf(__('«%s» no es un enlace válido'), shown) };
        default:
            return { ok: false, reason: valid.error };
    }
}

export function addUnknown(plan: Pick<GridPlan, 'unknownOptions'>, field: FieldEntity, labels: string[] | undefined): void {
    if (!labels || labels.length === 0) return;
    let entry = plan.unknownOptions.find((u) => u.field.id === field.id);
    if (!entry) {
        entry = { field, labels: [] };
        plan.unknownOptions.push(entry);
    }
    for (const l of labels) {
        if (!entry.labels.some((x) => foldSearchText(x) === foldSearchText(l))) entry.labels.push(l);
    }
}

/**
 * PEGAR: el bloque (TSV ya partido) a partir de la esquina superior
 * izquierda de `target`. Si el bloque es UNA celda y el destino es un rango,
 * esa celda llena todo el rango (como Excel). Lo que no entra hacia abajo
 * queda en `overflow` (la tabla ofrece crear esas filas).
 */
export function planPaste(args: {
    block: string[][];
    /** El portapapeles interno alineado con `block` (si lo pegado salió de la tabla). */
    internal?: ClipCell[][] | null;
    target: GridRect;
    rows: RecordEntity[];
    columns: GridColumnRef[];
    coercion: TextCoercionOptions;
    relationIds?: RelationTitleIndex;
    locked?: LockedReason;
}): GridPlan {
    const { block, target, rows, columns } = args;
    const plan = emptyPlan();
    const width = Math.max(0, ...block.map((r) => r.length));
    if (block.length === 0 || width === 0) return plan;
    const single = block.length === 1 && width === 1;
    const fillRange = single && (target.bottom > target.top || target.right > target.left);
    const height = fillRange ? target.bottom - target.top + 1 : block.length;
    const cols = fillRange ? target.right - target.left + 1 : width;
    const ctx: PasteValueContext = { coercion: args.coercion, relationIds: args.relationIds };
    const internalAt = (dr: number, dc: number): ClipCell | undefined =>
        fillRange ? args.internal?.[0]?.[0] : args.internal?.[dr]?.[dc];

    if (target.left + cols > columns.length) plan.truncatedCols = target.left + cols - columns.length;

    for (let dr = 0; dr < height; dr++) {
        const row = target.top + dr;
        const record = rows[row];
        if (!record) {
            // Lo que no entra hacia abajo: candidatos a filas nuevas.
            plan.truncatedRows = height - dr;
            for (let k = dr; k < height; k++) {
                const cells: OverflowRow['cells'] = [];
                for (let dc = 0; dc < cols; dc++) {
                    const col = target.left + dc;
                    if (!columns[col]) break;
                    cells.push({ col, raw: block[k]?.[dc] ?? '', internal: internalAt(k, dc) });
                }
                plan.overflow.push({ cells });
            }
            break;
        }
        for (let dc = 0; dc < cols; dc++) {
            const col = target.left + dc;
            const column = columns[col];
            if (!column) break;
            const raw = fillRange ? block[0]![0]! : block[dr]?.[dc] ?? '';
            const field = column.field;
            const label = field?.label ?? column.id;
            const blocked = cellWriteBlock(field, record, 'paste', args.locked);
            if (blocked !== null || !field) {
                const internal = internalAt(dr, dc);
                // ID / Actualizado, o una columna calculada que vuelve a sí
                // misma (se copiaron filas enteras de la tabla): se saltea.
                const sameColumn = internal !== undefined && (field ? internal.fieldId === field.id : internal.fieldId === null);
                if (!field || sameColumn || raw.trim() === '') {
                    plan.skipped++;
                    continue;
                }
                plan.issues.push({ row, col, label, reason: blocked ?? '', recordId: record.id, text: raw });
                continue;
            }
            const res = resolvePastedValue(raw, internalAt(dr, dc), field, ctx);
            if (!res.ok) {
                plan.issues.push({ row, col, label, reason: res.reason, recordId: record.id, text: raw, ...(res.unknown ? { optionFieldId: field.id } : {}) });
                if (field.type === 'select' || field.type === 'multi_select') addUnknown(plan, field, res.unknown);
                continue;
            }
            const before = cellValue(record, field);
            if (sameCellValue(field, before, res.value)) {
                plan.unchanged++;
                continue;
            }
            plan.changes.push({ recordId: record.id, field, before, after: res.value, row, col });
        }
    }
    checkUnique(plan, rows);
    return plan;
}

/**
 * RELLENAR: los valores de las filas `sourceTop..sourceBottom` a las filas
 * `targetTop..targetBottom`, en las columnas `left..right`. Un solo valor de
 * origen se copia; dos o más que forman una serie la continúan (ver
 * `fillSeries`). Cada valor se valida (una serie puede pasarse del máximo).
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
    const plan = emptyPlan();
    const span = args.sourceBottom - args.sourceTop + 1;
    const count = args.targetBottom - args.targetTop + 1;
    if (span <= 0 || count <= 0) return plan;
    for (let col = args.left; col <= args.right; col++) {
        const column = args.columns[col];
        if (!column) continue;
        const field = column.field;
        const sources = field
            ? Array.from({ length: span }, (_, i) => {
                  const r = args.rows[args.sourceTop + i];
                  return r ? cellValue(r, field) : null;
              })
            : [];
        const values = field ? fillValues(field.type, sources, count) : [];
        for (let i = 0; i < count; i++) {
            const row = args.targetTop + i;
            const record = args.rows[row];
            if (!record) continue;
            const blocked = cellWriteBlock(field, record, 'fill', args.locked);
            if (blocked !== null || !field) {
                plan.issues.push({ row, col, label: field?.label ?? column.id, reason: blocked ?? '', recordId: record.id });
                continue;
            }
            let after: unknown = values[i] ?? null;
            if (field.type !== 'relation') {
                const valid = validateFieldValue({ type: field.type, config: field.config, is_required: field.is_required }, after);
                if (!valid.ok) {
                    plan.issues.push({ row, col, label: field.label, reason: valid.error, recordId: record.id });
                    continue;
                }
                after = valid.value;
            }
            const before = cellValue(record, field);
            if (sameCellValue(field, before, after)) {
                plan.unchanged++;
                continue;
            }
            plan.changes.push({ recordId: record.id, field, before, after, row, col });
        }
    }
    plan.changes.sort((a, b) => a.row - b.row || a.col - b.col);
    checkUnique(plan, args.rows);
    return plan;
}

/** BORRAR (Supr): vacía las celdas escribibles del rango (las obligatorias, no). */
export function planClear(args: { rows: RecordEntity[]; columns: GridColumnRef[]; rect: GridRect; locked?: LockedReason }): GridPlan {
    const plan = emptyPlan();
    for (let row = args.rect.top; row <= args.rect.bottom; row++) {
        const record = args.rows[row];
        if (!record) continue;
        for (let col = args.rect.left; col <= args.rect.right; col++) {
            const column = args.columns[col];
            if (!column) continue;
            const field = column.field;
            const blocked = cellWriteBlock(field, record, 'clear', args.locked);
            if (blocked !== null || !field) {
                plan.issues.push({ row, col, label: field?.label ?? column.id, reason: blocked ?? '', recordId: record.id });
                continue;
            }
            const before = cellValue(record, field);
            const after = emptyValueFor(field);
            if (sameCellValue(field, before, after)) {
                plan.unchanged++;
                continue;
            }
            if (field.is_required && field.type !== 'checkbox') {
                plan.issues.push({ row, col, label: field.label, reason: __('Es obligatorio: no puede quedar vacío'), recordId: record.id });
                continue;
            }
            plan.changes.push({ recordId: record.id, field, before, after, row, col });
        }
    }
    return plan;
}

/** Clave para comparar valores de un campo «Sin repetidos» (igual que el servidor). */
function uniqueKey(v: unknown): string | null {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        return t === '' ? null : t;
    }
    return null;
}

/**
 * «Sin repetidos» (`is_unique`): un valor que ya tiene OTRA fila cargada, o
 * que se repite dentro de lo que se pega, sale del plan con su motivo. El
 * servidor vuelve a verificar contra la lista entera (las filas que no están
 * cargadas en pantalla).
 */
function checkUnique(plan: GridPlan, rows: RecordEntity[]): void {
    const uniqueFields = new Map<number, FieldEntity>();
    for (const c of plan.changes) if (c.field.is_unique) uniqueFields.set(c.field.id, c.field);
    if (uniqueFields.size === 0) return;
    const dropped = new Set<CellChange>();
    for (const field of uniqueFields.values()) {
        const changing = new Set(plan.changes.filter((c) => c.field.id === field.id).map((c) => c.recordId));
        const taken = new Set<string>();
        for (const r of rows) {
            if (changing.has(r.id)) continue;
            const k = uniqueKey(cellValue(r, field));
            if (k !== null) taken.add(k);
        }
        const seen = new Set<string>();
        for (const c of plan.changes) {
            if (c.field.id !== field.id) continue;
            const k = uniqueKey(c.after);
            if (k === null) continue;
            const shown = String(c.after).trim();
            if (taken.has(k)) {
                plan.issues.push({ row: c.row, col: c.col, label: field.label, reason: sprintf(__('«%1$s» ya está en otro registro: «%2$s» no admite valores repetidos'), shown, field.label), recordId: c.recordId, text: shown });
                dropped.add(c);
            } else if (seen.has(k)) {
                plan.issues.push({ row: c.row, col: c.col, label: field.label, reason: sprintf(__('«%1$s» se repite en lo que pegaste: «%2$s» no admite valores repetidos'), shown, field.label), recordId: c.recordId, text: shown });
                dropped.add(c);
            } else {
                seen.add(k);
            }
        }
    }
    if (dropped.size > 0) plan.changes = plan.changes.filter((c) => !dropped.has(c));
}

/** Una fila nueva del pegado, lista para crear. */
export interface NewRowPlan {
    /** Número de la fila nueva (1, 2, …). */
    index: number;
    /** `f{id}` → valor. */
    data: Record<string, unknown>;
    /** Lo mismo, por campo (para deshacer / mostrar). */
    cells: Array<{ field: FieldEntity; value: unknown }>;
}

/**
 * Las filas que no entraron en la tabla, como registros NUEVOS: cada celda con
 * la misma conversión que el pegado. Una fila con alguna celda inválida, o sin
 * un campo obligatorio, no se crea (queda en `issues` con el motivo).
 */
export function planNewRows(args: {
    overflow: OverflowRow[];
    columns: GridColumnRef[];
    /** Todos los campos de la lista (para avisar los obligatorios que faltan). */
    allFields: FieldEntity[];
    coercion: TextCoercionOptions;
    relationIds?: RelationTitleIndex;
    rowsLoaded: number;
}): { rows: NewRowPlan[]; issues: CellIssue[]; unknownOptions: UnknownOptions[] } {
    const ctx: PasteValueContext = { coercion: args.coercion, relationIds: args.relationIds };
    const out: NewRowPlan[] = [];
    const issues: CellIssue[] = [];
    const unknownHolder: Pick<GridPlan, 'unknownOptions'> = { unknownOptions: [] };
    args.overflow.forEach((o, i) => {
        const index = i + 1;
        const row = args.rowsLoaded + i;
        const data: Record<string, unknown> = {};
        const cells: NewRowPlan['cells'] = [];
        let ok = true;
        for (const cell of o.cells) {
            const column = args.columns[cell.col];
            const field = column?.field ?? null;
            if (!field) continue;
            if (cell.raw.trim() === '' && !(cell.internal && cell.internal.fieldId === field.id)) continue;
            const blocked = cellWriteBlock(field, {} as RecordEntity, 'paste');
            if (blocked !== null) continue;
            const res = resolvePastedValue(cell.raw, cell.internal, field, ctx);
            if (!res.ok) {
                issues.push({ row, col: cell.col, label: field.label, reason: res.reason, recordId: null, newRow: index, text: cell.raw, ...(res.unknown ? { optionFieldId: field.id } : {}) });
                if (field.type === 'select' || field.type === 'multi_select') addUnknown(unknownHolder, field, res.unknown);
                ok = false;
                continue;
            }
            if (isEmptyValue(res.value) && field.type !== 'checkbox') continue;
            data[`f${field.id}`] = res.value;
            cells.push({ field, value: res.value });
        }
        if (!ok) return;
        if (cells.length === 0) return; // fila vacía: nada que crear
        const missing = args.allFields.filter(
            (f) => f.is_required && f.type !== 'checkbox' && !(`f${f.id}` in data) && cellWriteBlock(f, {} as RecordEntity, 'paste') === null,
        );
        if (missing.length > 0) {
            issues.push({
                row,
                col: o.cells[0]?.col ?? 0,
                label: missing.map((f) => f.label).join(', '),
                reason: sprintf(__('Falta «%s», que es obligatorio: la fila nueva no se crea'), missing.map((f) => f.label).join('», «')),
                recordId: null,
                newRow: index,
            });
            return;
        }
        out.push({ index, data, cells });
    });
    // «Sin repetidos» entre las filas nuevas.
    const seenByField = new Map<number, Set<string>>();
    const kept: NewRowPlan[] = [];
    for (const r of out) {
        let dup: { field: FieldEntity; value: unknown } | null = null;
        for (const c of r.cells) {
            if (!c.field.is_unique) continue;
            const k = uniqueKey(c.value);
            if (k === null) continue;
            const set = seenByField.get(c.field.id) ?? new Set<string>();
            if (set.has(k)) dup = c;
            set.add(k);
            seenByField.set(c.field.id, set);
        }
        if (dup) {
            issues.push({
                row: args.rowsLoaded + r.index - 1,
                col: 0,
                label: dup.field.label,
                reason: sprintf(__('«%1$s» se repite en lo que pegaste: «%2$s» no admite valores repetidos'), String(dup.value), dup.field.label),
                recordId: null,
                newRow: r.index,
            });
        } else {
            kept.push(r);
        }
    }
    return { rows: kept, issues, unknownOptions: unknownHolder.unknownOptions };
}

/**
 * Los motivos de las celdas que no se pudieron, resumidos para un aviso corto:
 * «Estado» (fila 3): Opción no válida…, agrupados por columna y motivo.
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
