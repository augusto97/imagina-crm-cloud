import { sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';

/**
 * v0.1.230 — "Los registros vinculados a ESTE registro por ESTA relación",
 * como condición SQL sobre la tabla `records` de la lista consultada. Lo usan
 * los bloques de la ficha (gráficos y tablas de vinculados), el motor de
 * agregados y el listado de registros.
 *
 *  - `reverse`: la relación vive en la lista consultada y apunta al registro
 *    (las facturas cuyo campo «Cliente» es este cliente).
 *  - `forward`: la relación vive en la lista del registro y la consultada es
 *    su destino (los contactos que ESTE negocio tiene vinculados).
 */
export interface RelatedScope {
    fieldId: number;
    recordId: number;
    direction: 'forward' | 'reverse';
}

export function relatedScopeSql(tenantId: number, scope: RelatedScope): SQL {
    if (scope.direction === 'reverse') {
        return sql`EXISTS (SELECT 1 FROM relations r WHERE r.tenant_id = ${tenantId} AND r.field_id = ${scope.fieldId} AND r.source_record_id = ${records.id} AND r.target_record_id = ${scope.recordId})`;
    }
    return sql`${records.id} IN (SELECT r.target_record_id FROM relations r WHERE r.tenant_id = ${tenantId} AND r.field_id = ${scope.fieldId} AND r.source_record_id = ${scope.recordId})`;
}
