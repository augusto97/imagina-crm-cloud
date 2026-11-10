import type { Field } from '@imagina-base/shared';
import { sql } from 'drizzle-orm';
import { records } from '../db/schema';

/**
 * v0.1.219 / v0.1.399 — Clave para EMPAREJAR un registro por un campo: la
 * misma forma comparable en JS y en SQL. La usan «Actualizar desde un archivo»
 * y el webhook entrante («buscar el registro por un campo»).
 */
type KeyField = Pick<Field, 'id' | 'type'>;

/** La clave en una forma comparable: sin espacios ni mayúsculas; el teléfono, sólo dígitos. */
export function normalizeKey(field: KeyField | null, raw: string): string {
    const s = raw.trim();
    if (s === '') return '';
    if (!field) return /^\d+$/.test(s) ? String(Number(s)) : '';
    if (field.type === 'phone') return s.replace(/\D/g, '');
    if (field.type === 'number') {
        const n = Number(s.replace(',', '.'));
        return Number.isFinite(n) ? String(n) : s.toLowerCase();
    }
    return s.toLocaleLowerCase('es');
}

/** La misma normalización, en SQL (sobre la columna JSONB del campo). */
export function keyExpr(field: KeyField) {
    const col = sql`(${records.data} ->> ${`f${field.id}`})`;
    if (field.type === 'phone') return sql`regexp_replace(${col}, '[^0-9]', '', 'g')`;
    if (field.type === 'number') return sql`(CASE WHEN ${col} ~ '^-?[0-9.]+$' THEN ((${col})::numeric)::float8::text ELSE lower(${col}) END)`;
    return sql`lower(btrim(${col}))`;
}

