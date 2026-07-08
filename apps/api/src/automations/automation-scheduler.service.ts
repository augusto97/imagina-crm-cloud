import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { AutomationRow } from './automations.repository';

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

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    /** Sincroniza los schedulers de una automatización según su trigger/estado. */
    async sync(tenantId: number, auto: AutomationRow): Promise<void> {
        if (!this.queue) return;
        try {
            await this.remove(auto.id); // idempotente: limpio y re-creo
            if (!auto.isActive) return;

            if (auto.trigger.type === 'scheduled') {
                await this.queue.upsertJobScheduler(
                    schedId(auto.id),
                    { pattern: auto.trigger.cron },
                    { name: 'scheduled', data: { tenantId, automationId: auto.id } },
                );
            } else if (auto.trigger.type === 'due_date_reached') {
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

    async remove(automationId: number): Promise<void> {
        if (!this.queue) return;
        await Promise.all([
            this.queue.removeJobScheduler(schedId(automationId)).catch(() => undefined),
            this.queue.removeJobScheduler(dueId(automationId)).catch(() => undefined),
        ]);
    }
}
