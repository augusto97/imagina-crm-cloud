import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { waitResumeAt } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { automationRuns, automations } from '../db/schema';
import { IncidentHub, errorText } from '../incidents/incident-hub';
import { RecordChangeHub, type RecordChange } from '../records/record-change-hub';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';
import { AutomationDispatcher } from './automation-dispatcher.service';
import { AutomationEngine } from './automation-engine.service';

/** Cuántas esperas vencidas toma el reloj por vuelta (y cuántas vueltas por tick). */
const CLAIM_BATCH = 100;
const CLAIM_ROUNDS = 10;

/**
 * v0.1.288 — El reloj de las esperas («Esperar» en una automatización).
 *
 * Las corridas en espera viven en Postgres (`automation_runs` en `waiting`,
 * con `resume_at` y el estado para seguir): un reinicio, un deploy o un Redis
 * vaciado no las pierden. Un job scheduler de BullMQ (cada minuto, UNO por
 * disparo aunque haya varios nodos) llama a `tick`, que toma las vencidas con
 * `FOR UPDATE SKIP LOCKED` + el cambio a `running` en el mismo UPDATE: dos
 * ticks que se crucen nunca toman la misma. Cada una se reanuda como un job
 * aparte (no bloquean el tick ni entre sí).
 *
 * Además, si alguien cambia la fecha de la que depende una espera «hasta una
 * fecha», se recalcula al instante (adelantarla o atrasarla mueve la espera).
 */
@Injectable()
export class AutomationWaitsService implements OnModuleInit {
    private readonly logger = new Logger(AutomationWaitsService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly engine: AutomationEngine,
        private readonly dispatcher: AutomationDispatcher,
        @Optional() private readonly changes?: RecordChangeHub,
        @Optional() private readonly timeZones?: TenantTimeZones,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    onModuleInit(): void {
        this.changes?.subscribe((change) => this.onRecordChange(change));
    }

    /**
     * Toma las esperas vencidas (de todas las empresas) y las reanuda. Sin
     * cola (tests), las corre en el acto. Devuelve cuántas tomó.
     */
    async tick(now: Date = new Date()): Promise<number> {
        let total = 0;
        for (let round = 0; round < CLAIM_ROUNDS; round++) {
            const claimed = await this.db.execute<{ id: number | string; tenant_id: number | string }>(sql`
                UPDATE automation_runs r
                   SET status = 'running', resumed_at = now()
                 WHERE r.id IN (
                        SELECT id FROM automation_runs
                         WHERE status = 'waiting' AND resume_at <= ${now}
                         ORDER BY resume_at
                         LIMIT ${CLAIM_BATCH}
                         FOR UPDATE SKIP LOCKED)
                   AND r.status = 'waiting'
             RETURNING r.id, r.tenant_id`);
            const rows = claimed.rows.map((r) => ({ id: Number(r.id), tenantId: Number(r.tenant_id) }));
            total += rows.length;
            for (const row of rows) {
                let queued = false;
                try {
                    queued = await this.dispatcher.dispatchResume({ tenantId: row.tenantId, runId: row.id });
                } catch (err) {
                    // La cola no respondió: la corrida vuelve a esperar (el próximo tick la reintenta).
                    this.logger.warn(`No se pudo encolar la reanudación de la corrida ${row.id}: ${String(err)}`);
                    await this.db
                        .update(automationRuns)
                        .set({ status: 'waiting', resumedAt: null })
                        .where(and(eq(automationRuns.id, row.id), eq(automationRuns.status, 'running')));
                    continue;
                }
                if (!queued) await this.resume(row.tenantId, row.id);
            }
            if (rows.length < CLAIM_BATCH) break;
        }
        return total;
    }

    /** Reanuda una corrida ya tomada (el job 'resume'). Un error no la deja colgada. */
    async resume(tenantId: number, runId: number): Promise<void> {
        try {
            await this.engine.resumeRun(tenantId, runId);
        } catch (err) {
            this.logger.error(`No se pudo reanudar la corrida ${runId}: ${String(err)}`);
            const message = `No se pudo seguir después de la espera: ${errorText(err)}`;
            await this.db
                .update(automationRuns)
                .set({ status: 'failed', error: message, finishedAt: new Date(), resumeAt: null })
                .where(and(eq(automationRuns.id, runId), eq(automationRuns.status, 'running')))
                .catch(() => undefined);
            // Que no quede en silencio (ADR-S44): el problema es de esa
            // automatización (la misma clave que sus corridas fallidas, así una
            // corrida buena lo cierra).
            const [row] = await this.db
                .select({ automationId: automationRuns.automationId, recordId: automationRuns.recordId, name: automations.name, listId: automations.listId })
                .from(automationRuns)
                .innerJoin(automations, eq(automations.id, automationRuns.automationId))
                .where(eq(automationRuns.id, runId))
                .limit(1)
                .catch(() => []);
            if (row) {
                this.incidents?.report({
                    tenantId,
                    key: `automation:${row.automationId}`,
                    source: 'automation',
                    sourceId: row.automationId,
                    listId: row.listId,
                    title: `Falló la automatización «${row.name}»`,
                    message: `${message}${row.recordId !== null ? ` (registro #${row.recordId})` : ''}`,
                });
            }
        }
    }

    /**
     * Una espera «hasta la fecha de un campo» sigue a esa fecha: si alguien la
     * cambia, la hora de reanudación se recalcula (vaciarla la reanuda ya, y
     * la reanudación decide no seguir). Sólo mira los registros con alguna
     * corrida en espera (índice parcial: el resto no paga nada).
     */
    async onRecordChange(change: RecordChange): Promise<void> {
        if (change.kind === 'created') return;
        const waiting = await this.tenantDb.withTenant(change.tenantId, (tx) =>
            tx
                .select({ id: automationRuns.id, state: automationRuns.resumeState })
                .from(automationRuns)
                .where(and(eq(automationRuns.tenantId, change.tenantId), eq(automationRuns.recordId, change.recordId), eq(automationRuns.status, 'waiting'))),
        );
        if (waiting.length === 0) return;
        const tz = this.timeZones ? await this.timeZones.orUtc(change.tenantId) : undefined;
        for (const run of waiting) {
            const state = (run.state ?? {}) as { wait?: Record<string, unknown>; wait_field?: { key?: string; label?: string } | null };
            const key = state.wait_field?.key;
            if (!key || !state.wait) continue;
            if (JSON.stringify(change.before[key] ?? null) === JSON.stringify(change.after[key] ?? null)) continue;
            const target = waitResumeAt(state.wait, {
                now: new Date(),
                timeZone: tz,
                field: { label: state.wait_field?.label ?? key, value: change.after[key] },
            });
            const at = target.ok ? target.at : new Date();
            await this.tenantDb.withTenant(change.tenantId, (tx) =>
                tx
                    .update(automationRuns)
                    .set({ resumeAt: at })
                    .where(and(eq(automationRuns.tenantId, change.tenantId), eq(automationRuns.id, run.id), eq(automationRuns.status, 'waiting'))),
            );
        }
    }
}
