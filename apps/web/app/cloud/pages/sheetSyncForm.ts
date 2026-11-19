import {
    SHEET_SYNC_FIELD_TYPES,
    SHEET_SYNC_ID_COLUMN,
    SHEET_SYNC_KEY_TYPES,
    type SheetColumnMap,
    type SheetPreviewColumn,
    type SheetSuggestedFieldType,
    type SheetSyncKey,
} from '@imagina-base/shared';

import { normalizeName } from './sqlSyncForm';

/**
 * Piezas puras del editor de sincronizaciones con Google Sheets (v0.1.459):
 * qué campo de la lista conviene para cada columna de la hoja y qué columna
 * conviene como clave. Se testean sin pantalla.
 */

export interface SheetFieldLike {
    id: number;
    label: string;
    slug: string;
    type: string;
    is_unique?: boolean;
}

/** Destino de una columna de la hoja: un campo existente, uno nuevo o ninguno. */
export type SheetColumnTarget = { kind: 'field'; id: number } | { kind: 'create'; type: SheetSuggestedFieldType } | { kind: 'skip' };

export function sheetKeyFields(fields: SheetFieldLike[]): SheetFieldLike[] {
    return fields.filter((f) => (SHEET_SYNC_KEY_TYPES as readonly string[]).includes(f.type));
}

export function sheetValueFields(fields: SheetFieldLike[]): SheetFieldLike[] {
    return fields.filter((f) => (SHEET_SYNC_FIELD_TYPES as readonly string[]).includes(f.type));
}

function sameName(a: string, b: string): boolean {
    const n = normalizeName(a);
    return n !== '' && n === normalizeName(b);
}

/** Valores de una columna en las filas de muestra: ¿se repite alguno? */
function repeats(rows: Array<Record<string, string | null>>, column: string): boolean {
    const seen = new Set<string>();
    for (const r of rows) {
        const v = (r[column] ?? '').trim().toLowerCase();
        if (v === '') return true;
        if (seen.has(v)) return true;
        seen.add(v);
    }
    return false;
}

/**
 * La clave sugerida: si la hoja ya tiene la columna «ID» (la escribió la app
 * antes), esa; si no, una columna que coincide por nombre con un campo «Sin
 * repetidos» de la lista y que no se repite en la muestra (un email, un NIT);
 * si no hay, la columna «ID» que agrega la app (lo más seguro).
 */
export function suggestSheetKey(
    columns: SheetPreviewColumn[],
    rows: Array<Record<string, string | null>>,
    fields: SheetFieldLike[],
): SheetSyncKey {
    const idCol = columns.find((c) => sameName(c.name, SHEET_SYNC_ID_COLUMN));
    if (idCol) return { mode: 'app_id', column: idCol.name };
    const unique = sheetKeyFields(fields).filter((f) => f.is_unique);
    for (const c of columns) {
        const f = unique.find((u) => sameName(u.label, c.name) || sameName(u.slug, c.name));
        if (f && !repeats(rows, c.name)) return { mode: 'field', column: c.name, field_id: f.id };
    }
    return { mode: 'app_id', column: SHEET_SYNC_ID_COLUMN };
}

/**
 * Destino sugerido de cada columna de la hoja (menos la clave): el campo con
 * el mismo nombre si existe y se puede sincronizar; si no, crear uno con el
 * tipo que sugieren sus valores. Lo ya elegido (al editar) manda.
 */
export function suggestSheetTargets(
    columns: SheetPreviewColumn[],
    fields: SheetFieldLike[],
    key: SheetSyncKey,
    current: SheetColumnMap[] = [],
): Record<string, SheetColumnTarget> {
    const out: Record<string, SheetColumnTarget> = {};
    const usable = sheetValueFields(fields);
    const used = new Set<number>(key.mode === 'field' ? [key.field_id] : []);
    for (const m of current) {
        if (sameName(m.column, key.column)) continue;
        out[m.column] = { kind: 'field', id: m.field_id };
        used.add(m.field_id);
    }
    for (const c of columns) {
        if (sameName(c.name, key.column) || out[c.name]) continue;
        const hit = usable.find((f) => !used.has(f.id) && (sameName(f.label, c.name) || sameName(f.slug, c.name)));
        if (hit) {
            out[c.name] = { kind: 'field', id: hit.id };
            used.add(hit.id);
        } else {
            out[c.name] = { kind: 'create', type: c.suggested_type };
        }
    }
    return out;
}

/**
 * Campos de la lista que todavía no tienen columna en la hoja (y se podrían
 * agregar como columnas nuevas al escribir en la hoja).
 */
export function fieldsWithoutColumn(fields: SheetFieldLike[], targets: Record<string, SheetColumnTarget>, key: SheetSyncKey): SheetFieldLike[] {
    const used = new Set<number>(key.mode === 'field' ? [key.field_id] : []);
    for (const t of Object.values(targets)) if (t.kind === 'field') used.add(t.id);
    return sheetValueFields(fields).filter((f) => !used.has(f.id));
}

/** El nombre de una columna nueva para un campo, sin chocar con las de la hoja. */
export function newColumnName(label: string, taken: readonly string[]): string {
    const base = label.trim() || 'Columna';
    let name = base;
    let n = 2;
    while (taken.some((t) => sameName(t, name)) || sameName(name, SHEET_SYNC_ID_COLUMN)) name = `${base} ${n++}`;
    return name;
}
