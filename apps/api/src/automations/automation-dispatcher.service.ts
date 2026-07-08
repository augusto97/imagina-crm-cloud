import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

/** Evento de trigger que se encola para el worker de automatizaciones. */
export interface TriggerEvent {
    tenantId: number;
    listId: number;
    recordId: number;
    trigger: 'record_created' | 'record_updated';
    /** Snapshot de `data` tras la mutación (para merge tags / condición). */
    after: Record<string, unknown>;
    /** Snapshot previo (para field_changed). */
    before?: Record<string, unknown>;
}

/**
 * Encola eventos de trigger para el motor de automatizaciones. Igual patrón
 * que RealtimeService: si la cola no está seteada (tests unitarios), es no-op.
 * El dispatch NO pasa por RecordsService, así las acciones update_field/
 * create_record no re-disparan triggers (evita loops).
 */
@Injectable()
export class AutomationDispatcher {
    private readonly logger = new Logger(AutomationDispatcher.name);
    private queue: Queue | null = null;

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    dispatch(event: TriggerEvent): void {
        if (!this.queue) return;
        this.queue.add('event', event, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
            this.logger.error(`No se pudo encolar la automatización: ${String(err)}`);
        });
    }
}
