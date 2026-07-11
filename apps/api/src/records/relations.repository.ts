import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records, relations } from '../db/schema';

/**
 * Acceso a datos de `relations` (campos tipo `relation` — CONTRACT §3).
 * Paridad con el `RelationRepository` del plugin: sync reemplaza el set
 * completo de targets de un (campo, record); las lecturas van en batch
 * (una query por página de records — regla de oro nº 8) y EXCLUYEN targets
 * soft-borrados vía JOIN a `records`.
 */
@Injectable()
export class RelationsRepository {
    /**
     * Reemplaza los targets de un campo relation en un record (delete +
     * insert ordenado). Debe correr dentro del tx de la mutación del record.
     */
    async sync(
        tx: Tx,
        tenantId: number,
        fieldId: number,
        sourceRecordId: number,
        targetIds: number[],
    ): Promise<void> {
        await tx
            .delete(relations)
            .where(
                and(
                    eq(relations.tenantId, tenantId),
                    eq(relations.fieldId, fieldId),
                    eq(relations.sourceRecordId, sourceRecordId),
                ),
            );
        if (targetIds.length === 0) return;
        await tx.insert(relations).values(
            targetIds.map((targetRecordId, position) => ({
                tenantId,
                fieldId,
                sourceRecordId,
                targetRecordId,
                position,
            })),
        );
    }

    /**
     * Targets de varios records × varios campos en UNA query.
     * Devuelve `sourceRecordId → (fieldId → targetIds ordenados)`.
     */
    async batchTargets(
        tx: Tx,
        tenantId: number,
        recordIds: number[],
        fieldIds: number[],
    ): Promise<Map<number, Map<number, number[]>>> {
        const out = new Map<number, Map<number, number[]>>();
        if (recordIds.length === 0 || fieldIds.length === 0) return out;
        const rows = await tx
            .select({
                fieldId: relations.fieldId,
                sourceRecordId: relations.sourceRecordId,
                targetRecordId: relations.targetRecordId,
            })
            .from(relations)
            .innerJoin(records, eq(records.id, relations.targetRecordId))
            .where(
                and(
                    eq(relations.tenantId, tenantId),
                    inArray(relations.sourceRecordId, recordIds),
                    inArray(relations.fieldId, fieldIds),
                    isNull(records.deletedAt),
                ),
            )
            .orderBy(asc(relations.position), asc(relations.id));
        for (const r of rows) {
            let byField = out.get(r.sourceRecordId);
            if (!byField) {
                byField = new Map();
                out.set(r.sourceRecordId, byField);
            }
            const ids = byField.get(r.fieldId) ?? [];
            ids.push(r.targetRecordId);
            byField.set(r.fieldId, ids);
        }
        return out;
    }

    /**
     * IDs (del set dado) que SÍ existen vivos en la lista destino — para
     * validar que cada target de una relación pertenece a `target_list_id`
     * del propio tenant (jamás confiar en los IDs del cliente).
     */
    async existingInList(
        tx: Tx,
        tenantId: number,
        targetListId: number,
        ids: number[],
    ): Promise<Set<number>> {
        if (ids.length === 0) return new Set();
        const rows = await tx
            .select({ id: records.id })
            .from(records)
            .where(
                and(
                    eq(records.tenantId, tenantId),
                    eq(records.listId, targetListId),
                    inArray(records.id, ids),
                    isNull(records.deletedAt),
                ),
            );
        return new Set(rows.map((r) => r.id));
    }

    /** Limpia los vínculos que SALEN de un record (al soft-borrarlo). */
    async deleteBySource(tx: Tx, tenantId: number, sourceRecordId: number): Promise<void> {
        await tx
            .delete(relations)
            .where(
                and(eq(relations.tenantId, tenantId), eq(relations.sourceRecordId, sourceRecordId)),
            );
    }
}
