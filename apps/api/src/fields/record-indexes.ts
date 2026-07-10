import type { FieldType } from '@imagina-base/shared';

/**
 * DDL de índices de expresión por campo (PERF-01).
 *
 * Cuando un campo tiene `is_indexed=true`, se crea un índice de expresión sobre
 * `records.data ->> 'f{id}'` adecuado al tipo, para que los filtros escalares
 * (eq/gt/lt/between/in y contains) no hagan seq-scan de la lista. El toggle era
 * un no-op (`// TODO`) → un filtro selectivo sobre 100k reventaba el presupuesto
 * de §13. Los índices son parciales (`WHERE deleted_at IS NULL`) para calzar con
 * el predicado del hot path y ser más chicos.
 *
 * La clave `f{id}` se arma del id ENTERO del campo (no de input del usuario),
 * así que es seguro interpolarla en el DDL.
 */

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency'];
/** Tipos de texto libre donde `contains` (ILIKE) es común → +índice trgm. */
const TRGM_TYPES: readonly FieldType[] = ['text', 'long_text', 'email', 'url'];
/** Tipos escalares que solo necesitan btree de texto (eq/in). */
const TEXT_BTREE_TYPES: readonly FieldType[] = ['select', 'checkbox', 'user', 'file'];

const btreeName = (fieldId: number): string => `imcrm_ix_f${fieldId}`;
const trgmName = (fieldId: number): string => `imcrm_ix_f${fieldId}_trgm`;

/** Expresión tipada (btree) según el tipo del campo. */
function typedExprSql(fieldId: number, type: FieldType): string {
    const text = `(data ->> 'f${fieldId}')`;
    if (NUMERIC_TYPES.includes(type)) return `(${text}::numeric)`;
    if (type === 'date') return `(${text}::date)`;
    if (type === 'datetime') return `(${text}::timestamptz)`;
    return `(${text})`;
}

/** ¿El tipo amerita un índice de campo? (los no-data y multi_select no). */
export function isIndexableType(type: FieldType): boolean {
    if (NUMERIC_TYPES.includes(type)) return true;
    if (type === 'date' || type === 'datetime') return true;
    if (TRGM_TYPES.includes(type)) return true;
    if (TEXT_BTREE_TYPES.includes(type)) return true;
    // multi_select ya lo cubre el GIN global jsonb_path_ops sobre `data`;
    // relation/computed no son filtrables.
    return false;
}

/** Sentencias `CREATE INDEX CONCURRENTLY` para el campo (vacío si no aplica). */
export function createIndexStatements(fieldId: number, type: FieldType): string[] {
    if (!isIndexableType(type)) return [];
    const stmts: string[] = [
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${btreeName(fieldId)} ` +
            `ON records (${typedExprSql(fieldId, type)}) WHERE deleted_at IS NULL`,
    ];
    if (TRGM_TYPES.includes(type)) {
        stmts.push(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${trgmName(fieldId)} ` +
                `ON records USING gin ((data ->> 'f${fieldId}') gin_trgm_ops) WHERE deleted_at IS NULL`,
        );
    }
    return stmts;
}

/** Sentencias `DROP INDEX CONCURRENTLY` para el campo (siempre ambos, IF EXISTS). */
export function dropIndexStatements(fieldId: number): string[] {
    return [
        `DROP INDEX CONCURRENTLY IF EXISTS ${btreeName(fieldId)}`,
        `DROP INDEX CONCURRENTLY IF EXISTS ${trgmName(fieldId)}`,
    ];
}
