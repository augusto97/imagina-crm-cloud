import type { FieldType } from '@imagina-base/shared';

/**
 * DDL de índices de expresión por campo (PERF-01).
 *
 * Cuando un campo tiene `is_indexed=true`, se crea un índice de expresión sobre
 * `records.data ->> 'f{id}'` adecuado al tipo, para que los filtros escalares
 * (eq/gt/lt/between/in y contains) no hagan seq-scan de la lista. El toggle era
 * un no-op (`// TODO`) → un filtro selectivo sobre 100k reventaba el presupuesto
 * de §13. Los índices son parciales (`WHERE deleted_at IS NULL AND list_id = N`):
 * calzan con el predicado del hot path y, sobre todo, cubren SÓLO la lista del
 * campo — sin el `list_id` cada índice indexaba la tabla COMPARTIDA entera (los
 * registros de todas las empresas) y cada INSERT de cualquiera lo actualizaba
 * (auditoría v0.1.252: 1.968 kB vs 616 kB para una lista de 20k).
 *
 * La clave `f{id}` se arma del id ENTERO del campo (no de input del usuario),
 * así que es seguro interpolarla en el DDL.
 */

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'rating', 'percent', 'duration'];
/** Tipos de texto libre donde `contains` (ILIKE) es común → +índice trgm. */
const TRGM_TYPES: readonly FieldType[] = ['text', 'long_text', 'email', 'url', 'phone'];
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
    // multi_select se filtra con containment sobre `data -> 'fN'`, que un btree
    // no acelera; relation/computed/lookup/rollup no viven en `data`.
    return false;
}

/** Sentencias `CREATE INDEX CONCURRENTLY` para el campo (vacío si no aplica). */
export function createIndexStatements(fieldId: number, type: FieldType, listId: number): string[] {
    if (!isIndexableType(type)) return [];
    // Ids ENTEROS (no input de usuario): seguros de interpolar en el DDL.
    const where = `WHERE deleted_at IS NULL AND list_id = ${Math.trunc(listId)}`;
    const stmts: string[] = [
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${btreeName(fieldId)} ` +
            `ON records (${typedExprSql(fieldId, type)}) ${where}`,
    ];
    if (TRGM_TYPES.includes(type)) {
        stmts.push(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${trgmName(fieldId)} ` +
                `ON records USING gin ((data ->> 'f${fieldId}') gin_trgm_ops) ${where}`,
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
