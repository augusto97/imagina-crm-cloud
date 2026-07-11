import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { recurrences } from '../db/schema';

export type RecurrenceRow = typeof recurrences.$inferSelect;

/** Payload del upsert (columnas configurables — sin id/timestamps/lastFiredAt). */
export interface RecurrenceUpsertValues {
    tenantId: number;
    listId: number;
    recordId: number;
    dateFieldId: number;
    frequency: string;
    intervalN: number;
    monthlyPattern: string | null;
    triggerType: string;
    triggerStatusFieldId: number | null;
    triggerStatusValue: string | null;
    actionType: string;
    updateStatusFieldId: number | null;
    updateStatusValue: string | null;
    repeatUntil: string | null;
}

/**
 * Acceso a datos de `recurrences`, tenant-scoped (RLS + tenant_id explícito).
 * Paridad con `RecurrenceRepository` del plugin: el UNIQUE (tenant, record,
 * date_field) garantiza una recurrencia por celda — el upsert reemplaza.
 */
@Injectable()
export class RecurrencesRepository {
    /** Upsert por (tenant, record, campo de fecha): reemplaza la config en su lugar. */
    async upsert(tx: Tx, values: RecurrenceUpsertValues): Promise<RecurrenceRow> {
        const [row] = await tx
            .insert(recurrences)
            .values(values)
            .onConflictDoUpdate({
                target: [recurrences.tenantId, recurrences.recordId, recurrences.dateFieldId],
                set: {
                    frequency: values.frequency,
                    intervalN: values.intervalN,
                    monthlyPattern: values.monthlyPattern,
                    triggerType: values.triggerType,
                    triggerStatusFieldId: values.triggerStatusFieldId,
                    triggerStatusValue: values.triggerStatusValue,
                    actionType: values.actionType,
                    updateStatusFieldId: values.updateStatusFieldId,
                    updateStatusValue: values.updateStatusValue,
                    repeatUntil: values.repeatUntil,
                    updatedAt: sql`now()`,
                },
            })
            .returning();
        if (!row) throw new Error('Upsert de recurrencia no devolvió fila');
        return row;
    }

    async findById(tx: Tx, tenantId: number, id: number): Promise<RecurrenceRow | null> {
        const [row] = await tx
            .select()
            .from(recurrences)
            .where(and(eq(recurrences.tenantId, tenantId), eq(recurrences.id, id)))
            .limit(1);
        return row ?? null;
    }

    /** Recurrencias de un record (puede tener varias: una por campo de fecha). */
    async listForRecord(tx: Tx, tenantId: number, recordId: number): Promise<RecurrenceRow[]> {
        return tx
            .select()
            .from(recurrences)
            .where(and(eq(recurrences.tenantId, tenantId), eq(recurrences.recordId, recordId)))
            .orderBy(asc(recurrences.id));
    }

    /** Recurrencias de N records en UNA query (regla de oro nº 8 — sin N+1). */
    async batchForRecords(
        tx: Tx,
        tenantId: number,
        listId: number,
        recordIds: number[],
    ): Promise<RecurrenceRow[]> {
        if (recordIds.length === 0) return [];
        return tx
            .select()
            .from(recurrences)
            .where(
                and(
                    eq(recurrences.tenantId, tenantId),
                    eq(recurrences.listId, listId),
                    inArray(recurrences.recordId, recordIds),
                ),
            )
            .orderBy(asc(recurrences.id));
    }

    /** Marca la recurrencia como disparada (last_fired_at = now naive UTC). */
    async markFired(tx: Tx, tenantId: number, id: number, firedAt: string): Promise<void> {
        await tx
            .update(recurrences)
            .set({ lastFiredAt: firedAt, updatedAt: sql`now()` })
            .where(and(eq(recurrences.tenantId, tenantId), eq(recurrences.id, id)));
    }

    async delete(tx: Tx, tenantId: number, recordId: number, id: number): Promise<boolean> {
        const rows = await tx
            .delete(recurrences)
            .where(
                and(
                    eq(recurrences.tenantId, tenantId),
                    eq(recurrences.recordId, recordId),
                    eq(recurrences.id, id),
                ),
            )
            .returning({ id: recurrences.id });
        return rows.length > 0;
    }

    /**
     * TODAS las recurrencias trigger=schedule, cross-tenant, para el tick
     * global. Usa la conexión BASE (owner → bypass RLS) porque un job de
     * plataforma no tiene tenant: sólo enumera (id + tenant_id); las lecturas
     * y mutaciones de records que siguen SIEMPRE van dentro de
     * `withTenant(rec.tenantId)` (mismo patrón que el módulo platform).
     */
    async allScheduled(db: Db): Promise<RecurrenceRow[]> {
        return db
            .select()
            .from(recurrences)
            .where(eq(recurrences.triggerType, 'schedule'))
            .orderBy(asc(recurrences.tenantId), asc(recurrences.id));
    }
}
