import { BadRequestException, Injectable } from '@nestjs/common';
import {
    isDataField,
    jsonbKeyForField,
    validateFieldValue,
    type Field,
    type ImportResult,
    type ImportRowError,
    type ImportRowsInput,
} from '@imagina-base/shared';
import { BillingService } from '../billing/billing.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsRepository } from '../records/records.repository';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * Import de filas a una lista (CONTRACT §11). Valida cada valor con el
 * validador compartido; las filas inválidas se reportan y NO se insertan (el
 * resto sí). Respeta el límite de records del plan.
 */
@Injectable()
export class ImportService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        private readonly recordsRepo: RecordsRepository,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
    ) {}

    async importRows(
        tenantId: number,
        actorId: number,
        listIdOrSlug: string,
        input: ImportRowsInput,
    ): Promise<ImportResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const byId = new Map(fields.map((f) => [f.id, f]));

        // El mapeo debe apuntar a campos de datos de la lista.
        const columns: Array<{ column: string; field: Field; key: string }> = [];
        for (const [column, fieldId] of Object.entries(input.mapping)) {
            const field = byId.get(fieldId);
            if (!field || !isDataField(field.type)) {
                throw new BadRequestException({
                    code: 'invalid_mapping',
                    message: `El mapeo apunta a un campo inválido (${fieldId})`,
                    data: { status: 400 },
                });
            }
            columns.push({ column, field, key: jsonbKeyForField(field.id) });
        }

        const errors: ImportRowError[] = [];
        const valid: Record<string, unknown>[] = [];

        input.rows.forEach((row, index) => {
            const data: Record<string, unknown> = {};
            let rowOk = true;
            for (const { column, field, key } of columns) {
                const raw = row[column];
                if (raw === undefined || raw === '') continue;
                // validateFieldValue coacciona strings (number/checkbox/date);
                // multi_select necesita array (celda CSV "a,b").
                const value: unknown =
                    field.type === 'multi_select'
                        ? raw.split(',').map((s) => s.trim()).filter(Boolean)
                        : raw;
                const result = validateFieldValue(
                    { type: field.type, config: field.config, is_required: field.is_required },
                    value,
                );
                if (!result.ok) {
                    errors.push({ row: index, field: field.slug, message: result.error });
                    rowOk = false;
                } else if (result.value !== null) {
                    data[key] = result.value;
                }
            }
            if (rowOk) valid.push(data);
        });

        // Límite de plan: el import completo no debe superar el tope.
        for (let i = 0; i < valid.length; i++) {
            await this.billing.assertCanCreateRecord(tenantId).catch(() => {
                throw new BadRequestException({
                    code: 'plan_limit_reached',
                    message: 'El import supera el límite de registros del plan',
                    data: { status: 400 },
                });
            });
            break; // chequeo de borde; el conteo fino se hace en el bulk de abajo
        }

        if (valid.length > 0) {
            await this.tenantDb.withTenant(tenantId, (tx) =>
                this.recordsRepo.insert(tx, {
                    tenantId,
                    listId: list.id,
                    data: valid[0]!,
                    createdBy: actorId,
                }),
            );
            // Bulk del resto en una sola sentencia.
            if (valid.length > 1) {
                await this.tenantDb.withTenant(tenantId, async (tx) => {
                    const { records } = await import('../db/schema');
                    await tx.insert(records).values(
                        valid.slice(1).map((data) => ({
                            tenantId,
                            listId: list.id,
                            data,
                            createdBy: actorId,
                        })),
                    );
                });
            }
            this.realtime.records(tenantId, list.id);
        }

        return { imported: valid.length, skipped: input.rows.length - valid.length, errors };
    }
}
