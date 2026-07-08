import { createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
    jsonbKeyForField,
    type AutomationAction,
    type AutomationRunStatus,
    type FilterNode,
} from '@imagina-base/shared';
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { automationRuns, records } from '../db/schema';
import { FieldsRepository } from '../fields/fields.repository';
import { compileFilterTree, fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { RecordsRepository } from '../records/records.repository';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AutomationsRepository, type AutomationRow } from './automations.repository';
import type { TriggerEvent } from './automation-dispatcher.service';

const SYSTEM_USER = 0;

/** Contexto de ejecución: con record (triggers de record/due) o sin él (scheduled). */
interface RunContext {
    tenantId: number;
    listId: number;
    recordId: number | null;
    data: Record<string, unknown>;
}

/**
 * Motor de ejecución de automatizaciones (CONTRACT.md §8). Corre en el worker
 * BullMQ. Soporta triggers de record (created/updated), programados (cron) y
 * por vencimiento de fecha (due_date_reached).
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

    /** Trigger de record (record_created / record_updated). */
    async process(event: TriggerEvent): Promise<void> {
        await this.tenantDb.withTenant(event.tenantId, async (tx) => {
            const autos = await this.automations.activeByTrigger(
                tx,
                event.tenantId,
                event.listId,
                event.trigger,
            );
            if (autos.length === 0) return;
            const { fieldsById, slugToKey } = await this.fieldMaps(tx, event.tenantId, event.listId);
            const ctx: RunContext = {
                tenantId: event.tenantId,
                listId: event.listId,
                recordId: event.recordId,
                data: event.after,
            };
            for (const auto of autos) {
                await this.runOne(tx, ctx, auto, fieldsById, slugToKey);
            }
        });
    }

    /** Trigger `scheduled` (cron): corre una automatización sin record. */
    async runScheduled(tenantId: number, automationId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive) return;
            const { fieldsById, slugToKey } = await this.fieldMaps(tx, tenantId, auto.listId);
            const ctx: RunContext = { tenantId, listId: auto.listId, recordId: null, data: {} };
            await this.runOne(tx, ctx, auto, fieldsById, slugToKey);
        });
    }

    /**
     * Trigger `due_date_reached`: para cada record cuyo campo fecha ya venció
     * (valor + offset ≤ now) y que la automatización NO corrió aún, ejecuta las
     * acciones. La dedup por `automation_runs` evita re-disparar (sin estado de
     * ventana). Pensado para ser llamado por un job repeatable cada N minutos.
     */
    async runDueDate(tenantId: number, automationId: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const auto = await this.automations.findById(tx, tenantId, automationId);
            if (!auto || !auto.isActive || auto.trigger.type !== 'due_date_reached') return;
            const fieldId = auto.trigger.field_id;
            const offset = auto.trigger.offset_minutes;
            const { fieldsById, slugToKey } = await this.fieldMaps(tx, tenantId, auto.listId);
            const field = fieldsById.get(fieldId);
            if (!field) return;

            const dueExpr = fieldTypedExpr(field); // ::timestamptz o ::date
            const threshold = sql`now() - make_interval(mins => ${offset})`;
            const alreadyRan = sql`exists (select 1 from ${automationRuns} ar
                where ar.tenant_id = ${tenantId} and ar.automation_id = ${auto.id}
                  and ar.record_id = ${records.id} and ar.status <> 'failed')`;

            const due = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(
                    and(
                        eq(records.tenantId, tenantId),
                        eq(records.listId, auto.listId),
                        isNull(records.deletedAt),
                        lte(dueExpr, threshold),
                        sql`not ${alreadyRan}`,
                    ),
                )
                .limit(500);

            for (const rec of due) {
                const ctx: RunContext = {
                    tenantId,
                    listId: auto.listId,
                    recordId: rec.id,
                    data: rec.data,
                };
                await this.runOne(tx, ctx, auto, fieldsById, slugToKey);
            }
        });
    }

    private async fieldMaps(
        tx: Tx,
        tenantId: number,
        listId: number,
    ): Promise<{ fieldsById: Map<number, FilterableField>; slugToKey: Map<string, string> }> {
        const fieldRows = await this.fields.listByList(tx, tenantId, listId);
        return {
            fieldsById: new Map(
                fieldRows.map((f) => [f.id, { id: f.id, type: f.type as FilterableField['type'] }]),
            ),
            slugToKey: new Map(fieldRows.map((f) => [f.slug, jsonbKeyForField(f.id)])),
        };
    }

    private async runOne(
        tx: Tx,
        ctx: RunContext,
        auto: AutomationRow,
        fieldsById: Map<number, FilterableField>,
        slugToKey: Map<string, string>,
    ): Promise<void> {
        const started = process.hrtime.bigint();
        const logs: string[] = [];
        let status: AutomationRunStatus = 'success';

        try {
            // La condición sólo aplica cuando hay record.
            if (
                ctx.recordId !== null &&
                auto.condition &&
                !(await this.matchesCondition(tx, ctx.recordId, auto.condition, fieldsById))
            ) {
                status = 'skipped';
                logs.push('Condición no cumplida — omitida');
            } else {
                for (const action of auto.actions) {
                    logs.push(await this.execAction(tx, ctx, action, slugToKey));
                }
            }
        } catch (err) {
            status = 'failed';
            logs.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
            this.logger.error(`Automatización ${auto.id} falló: ${String(err)}`);
        }

        const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
        await this.automations.logRun(tx, {
            tenantId: ctx.tenantId,
            automationId: auto.id,
            recordId: ctx.recordId,
            status,
            logs,
            durationMs,
        });
    }

    /** ¿El record cumple la condición? Reusa el QueryBuilder vía un COUNT. */
    private async matchesCondition(
        tx: Tx,
        recordId: number,
        condition: FilterNode,
        fieldsById: Map<number, FilterableField>,
    ): Promise<boolean> {
        const where = compileFilterTree(fieldsById, condition, new Date());
        const [row] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(records)
            .where(and(eq(records.id, recordId), isNull(records.deletedAt), where));
        return (row?.n ?? 0) > 0;
    }

    private async execAction(
        tx: Tx,
        ctx: RunContext,
        action: AutomationAction,
        slugToKey: Map<string, string>,
    ): Promise<string> {
        switch (action.type) {
            case 'update_field': {
                if (ctx.recordId === null) return 'update_field omitido (sin record)';
                const key = jsonbKeyForField(action.field_id);
                const merged = { ...ctx.data, [key]: action.value };
                await this.recordsRepo.updateData(tx, ctx.tenantId, ctx.listId, ctx.recordId, merged);
                return `update_field ${key} = ${JSON.stringify(action.value)}`;
            }
            case 'create_record': {
                await this.recordsRepo.insert(tx, {
                    tenantId: ctx.tenantId,
                    listId: action.list_id,
                    data: action.data,
                    createdBy: SYSTEM_USER,
                });
                return `create_record en lista ${action.list_id}`;
            }
            case 'call_webhook': {
                const payload = JSON.stringify({
                    record_id: ctx.recordId,
                    list_id: ctx.listId,
                    data: ctx.data,
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
                if (ctx.recordId === null) return 'send_email omitido (sin record)';
                const to = resolveMergeTags(action.to, ctx.data, slugToKey);
                const subject = resolveMergeTags(action.subject, ctx.data, slugToKey);
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
