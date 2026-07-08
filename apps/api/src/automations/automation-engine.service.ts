import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
    jsonbKeyForField,
    type AutomationAction,
    type AutomationRunStatus,
    type FilterNode,
} from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';
import { FieldsRepository } from '../fields/fields.repository';
import { compileFilterTree, type FilterableField } from '../records/query-builder';
import { RecordsRepository } from '../records/records.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AutomationsRepository, type AutomationRow } from './automations.repository';
import type { TriggerEvent } from './automation-dispatcher.service';

const SYSTEM_USER = 0;

/**
 * Motor de ejecución de automatizaciones (CONTRACT.md §8). Corre en el worker
 * BullMQ. Por cada evento carga las automatizaciones activas de la lista cuyo
 * trigger matchea, evalúa la condición (mismo filter tree, vía SQL sobre el
 * record) y ejecuta las acciones, registrando un run con logs.
 */
@Injectable()
export class AutomationEngine {
    private readonly logger = new Logger(AutomationEngine.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly automations: AutomationsRepository,
        private readonly fields: FieldsRepository,
        private readonly recordsRepo: RecordsRepository,
    ) {}

    async process(event: TriggerEvent): Promise<void> {
        await this.tenantDb.withTenant(event.tenantId, async (tx) => {
            const autos = await this.automations.activeByTrigger(
                tx,
                event.tenantId,
                event.listId,
                event.trigger,
            );
            if (autos.length === 0) return;

            const fieldRows = await this.fields.listByList(tx, event.tenantId, event.listId);
            const fieldsById = new Map<number, FilterableField>(
                fieldRows.map((f) => [f.id, { id: f.id, type: f.type as FilterableField['type'] }]),
            );
            const slugToKey = new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)]));

            for (const auto of autos) {
                await this.runOne(tx, event, auto, fieldsById, slugToKey);
            }
        });
    }

    private async runOne(
        tx: Tx,
        event: TriggerEvent,
        auto: AutomationRow,
        fieldsById: Map<number, FilterableField>,
        slugToKey: Map<string, string>,
    ): Promise<void> {
        const started = process.hrtime.bigint();
        const logs: string[] = [];
        let status: AutomationRunStatus = 'success';

        try {
            if (auto.condition && !(await this.matchesCondition(tx, event, auto.condition, fieldsById))) {
                status = 'skipped';
                logs.push('Condición no cumplida — omitida');
            } else {
                for (const action of auto.actions) {
                    logs.push(await this.execAction(tx, event, action, slugToKey));
                }
            }
        } catch (err) {
            status = 'failed';
            logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
            this.logger.error(`Automatización ${auto.id} falló: ${String(err)}`);
        }

        const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
        await this.automations.logRun(tx, {
            tenantId: event.tenantId,
            automationId: auto.id,
            recordId: event.recordId,
            status,
            logs,
            durationMs,
        });
    }

    /** ¿El record cumple la condición? Reusa el QueryBuilder vía un COUNT. */
    private async matchesCondition(
        tx: Tx,
        event: TriggerEvent,
        condition: FilterNode,
        fieldsById: Map<number, FilterableField>,
    ): Promise<boolean> {
        const where = compileFilterTree(fieldsById, condition, new Date());
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(records)
            .where(and(eq(records.id, event.recordId), isNull(records.deletedAt), where));
        return (row?.n ?? 0) > 0;
    }

    private async execAction(
        tx: Tx,
        event: TriggerEvent,
        action: AutomationAction,
        slugToKey: Map<string, string>,
    ): Promise<string> {
        switch (action.type) {
            case 'update_field': {
                const key = jsonbKeyForField(action.field_id);
                const merged = { ...event.after, [key]: action.value };
                await this.recordsRepo.updateData(tx, event.tenantId, event.listId, event.recordId, merged);
                return `update_field ${key} = ${JSON.stringify(action.value)}`;
            }
            case 'create_record': {
                await this.recordsRepo.insert(tx, {
                    tenantId: event.tenantId,
                    listId: action.list_id,
                    data: action.data,
                    createdBy: SYSTEM_USER,
                });
                return `create_record en lista ${action.list_id}`;
            }
            case 'call_webhook': {
                const payload = JSON.stringify({
                    record_id: event.recordId,
                    list_id: event.listId,
                    data: event.after,
                });
                const headers: Record<string, string> = { 'content-type': 'application/json' };
                if (action.secret) {
                    headers['x-imagina-signature'] =
                        'sha256=' + createHmac('sha256', action.secret).update(payload).digest('hex');
                }
                const res = await fetch(action.url, { method: 'POST', headers, body: payload });
                return `call_webhook ${action.url} → ${res.status}`;
            }
            case 'send_email': {
                // Sin SMTP en el MVP: se registra (F4 cablea el proveedor real).
                const to = resolveMergeTags(action.to, event.after, slugToKey);
                const subject = resolveMergeTags(action.subject, event.after, slugToKey);
                return `send_email (simulado) a ${to}: "${subject}"`;
            }
        }
    }
}

/** Resuelve `{{slug}}` contra los datos del record. */
function resolveMergeTags(
    template: string,
    data: Record<string, unknown>,
    slugToKey: Map<string, string>,
): string {
    return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi, (_m, slug: string) => {
        const key = slugToKey.get(slug);
        const value = key ? data[key] : undefined;
        return value === null || value === undefined ? '' : String(value);
    });
}
