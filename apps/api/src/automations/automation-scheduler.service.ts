import { Injectable, Logger, Optional } from '@nestjs/common';
import { scheduleCron, scheduleTimeZone } from '@imagina-base/shared';
import type { Queue } from 'bullmq';
import type { AutomationRow } from './automations.repository';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

/** Cada N minutos se re-escanean los records vencidos (due_date_reached). */
const DUE_SCAN_PATTERN = '*/5 * * * *';

const schedId = (id: number) => `sched:${id}`;
const dueId = (id: number) => `due:${id}`;

/**
 * Registra los jobs repeatable de BullMQ para los triggers temporales
 * (`scheduled` con cron; `due_date_reached` con un escaneo periódico). Los job
 * schedulers viven en Redis → sobreviven reinicios sin re-enumerar (evita el
 * problema de RLS cross-tenant). No-op si la cola no está seteada (tests).
 */
@Injectable()
export class AutomationScheduler {
    private readonly logger = new Logger(AutomationScheduler.name);
    private queue: Queue | null = null;

    constructor(@Optional() private readonly timeZones?: TenantTimeZones) {}

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    /** Sincroniza los schedulers de una automatización según su trigger/estado. */
    async sync(tenantId: number, auto: AutomationRow): Promise<void> {
        if (!this.queue) return;
        try {
            await this.remove(auto.id); // idempotente: limpio y re-creo
            if (!auto.isActive) return;

            if (auto.triggerType === 'scheduled') {
                // v0.1.221 — la UI guarda frecuencia + hora + zona horaria y el
                // scheduler sólo leía `cron`: una automatización programada
                // desde el editor NUNCA corría. `scheduleCron` (shared) es la
                // única traducción.
                // v0.1.263 — la zona: la propia de la automatización o, si no
                // tiene (asistente/MCP, API, plantillas, guardadas antes de
                // v0.1.221), la de la EMPRESA. Antes caía a UTC y «las 8» en
                // Colombia salía a las 3 de la mañana. UTC queda sólo como
                // último recurso, y explícito (no la hora del servidor).
                const cron = scheduleCron(auto.triggerConfig);
                const tenantTz = this.timeZones ? await this.timeZones.get(tenantId) : null;
                const { tz } = scheduleTimeZone(auto.triggerConfig, tenantTz);
                await this.queue.upsertJobScheduler(
                    schedId(auto.id),
                    { pattern: cron, tz },
                    { name: 'scheduled', data: { tenantId, automationId: auto.id } },
                );
            } else if (auto.triggerType === 'due_date_reached') {
                await this.queue.upsertJobScheduler(
                    dueId(auto.id),
                    { pattern: DUE_SCAN_PATTERN },
                    { name: 'due', data: { tenantId, automationId: auto.id } },
                );
            }
        } catch (err) {
            this.logger.error(`No se pudo sincronizar el scheduler de ${auto.id}: ${String(err)}`);
        }
    }

    /**
     * v0.1.221 — «Ejecutar ahora» de una automatización programada: encola la
     * misma corrida que dispararía el horario. false si no hay cola (Redis).
     */
    async runNow(tenantId: number, automationId: number): Promise<boolean> {
        if (!this.queue) return false;
        await this.queue.add('scheduled', { tenantId, automationId }, { removeOnComplete: 1000, removeOnFail: 1000 });
        return true;
    }

    async remove(automationId: number): Promise<void> {
        if (!this.queue) return;
        await Promise.all([
            this.queue.removeJobScheduler(schedId(automationId)).catch(() => undefined),
            this.queue.removeJobScheduler(dueId(automationId)).catch(() => undefined),
        ]);
    }
}
