import {
    SQL_SYNC_FIELD_TYPES,
    SQL_SYNC_KEY_TYPES,
    type SqlColumnMap,
    type SqlPreviewColumn,
    type SqlSuggestedFieldType,
} from '@imagina-base/shared';

/**
 * Piezas puras del editor de sincronizaciones SQL (v0.1.243): qué campo de la
 * lista conviene para cada columna del resultado. Se testean sin pantalla.
 */

export interface FieldLike {
    id: number;
    label: string;
    slug: string;
    type: string;
}

/** Destino de una columna: un campo existente, uno nuevo o ninguno. */
export type ColumnTarget = { kind: 'field'; id: number } | { kind: 'create'; type: SqlSuggestedFieldType } | { kind: 'skip' };

export const FIELD_TYPE_LABEL: Record<string, string> = {
    text: 'Texto',
    long_text: 'Texto largo',
    email: 'Email',
    url: 'Enlace',
    phone: 'Teléfono',
    number: 'Número',
    currency: 'Moneda',
    percent: 'Porcentaje',
    rating: 'Calificación',
    duration: 'Duración',
    checkbox: 'Sí / No',
    date: 'Fecha',
    datetime: 'Fecha y hora',
    select: 'Selección',
    multi_select: 'Selección múltiple',
};

/** «Número_Factura», «numero factura» y «NumeroFactura» son el mismo nombre. */
export function normalizeName(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

export function keyFields(fields: FieldLike[]): FieldLike[] {
    return fields.filter((f) => (SQL_SYNC_KEY_TYPES as readonly string[]).includes(f.type));
}

export function valueFields(fields: FieldLike[]): FieldLike[] {
    return fields.filter((f) => (SQL_SYNC_FIELD_TYPES as readonly string[]).includes(f.type));
}

/** El campo de la lista con el mismo nombre que la columna (si es de un tipo que sirve). */
export function matchField(column: string, fields: FieldLike[]): FieldLike | null {
    const n = normalizeName(column);
    if (n === '') return null;
    return fields.find((f) => normalizeName(f.label) === n || normalizeName(f.slug) === n) ?? null;
}

/**
 * Destino sugerido de cada columna (menos la clave): el campo con el mismo
 * nombre si existe; si no, crear uno con el tipo que sugiere SQL. Lo que ya
 * estaba elegido (al editar) manda sobre la sugerencia.
 */
export function suggestTargets(
    columns: SqlPreviewColumn[],
    fields: FieldLike[],
    keyColumn: string,
    current: SqlColumnMap[] = [],
): Record<string, ColumnTarget> {
    const out: Record<string, ColumnTarget> = {};
    const usable = valueFields(fields);
    const used = new Set<number>();
    const lowerKey = keyColumn.toLowerCase();
    for (const m of current) {
        out[m.column] = { kind: 'field', id: m.field_id };
        used.add(m.field_id);
    }
    for (const c of columns) {
        if (c.name.toLowerCase() === lowerKey || out[c.name]) continue;
        const hit = matchField(c.name, usable.filter((f) => !used.has(f.id)));
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
 * Columna clave sugerida: la que se llama como «nit», «id», «numero»,
 * «codigo», «factura»… y, si hay filas de muestra, sólo entre las que NO se
 * repiten en ellas — en una tabla de facturas el NIT se repite por cliente, y
 * usarlo como clave fusionaría facturas distintas en un solo registro.
 */
export function suggestKeyColumn(columns: SqlPreviewColumn[], rows: Array<Record<string, string | null>> = []): string {
    const unique = (name: string): boolean => {
        if (rows.length < 2) return true;
        const seen = new Set<string>();
        for (const r of rows) {
            const v = (r[name] ?? '').trim().toLowerCase();
            if (v === '' || seen.has(v)) return false;
            seen.add(v);
        }
        return true;
    };
    const candidates = columns.filter((c) => unique(c.name));
    const pool = candidates.length > 0 ? candidates : columns;
    const prefer = ['numerofactura', 'nofactura', 'factura', 'nit', 'numero', 'codigo', 'id', 'documento', 'sku'];
    for (const p of prefer) {
        const hit = pool.find((c) => normalizeName(c.name) === p);
        if (hit) return hit.name;
    }
    for (const p of prefer) {
        const hit = pool.find((c) => normalizeName(c.name).includes(p));
        if (hit) return hit.name;
    }
    return pool[0]?.name ?? '';
}

/** Zona horaria de este navegador (para las fechas sin zona y el horario diario). */
export function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}
