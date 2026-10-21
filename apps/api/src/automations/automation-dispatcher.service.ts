import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { IncidentHub, errorText } from '../incidents/incident-hub';

/** Evento de trigger que se encola para el worker de automatizaciones. */
export interface TriggerEvent {
    tenantId: number;
    listId: number;
    recordId: number;
    trigger: 'record_created' | 'record_updated' | 'payment_received' | 'form_submitted';
    /** Snapshot de `data` tras la mutación (para merge tags / condición). */
    after: Record<string, unknown>;
    /** Snapshot previo (para field_changed). */
    before?: Record<string, unknown>;
    /**
     * v0.1.251 — el cobro que se acaba de pagar (trigger `payment_received`):
     * lo que la automatización usa como `{{pago.*}}`.
     */
    payment?: Record<string, unknown>;
    /**
     * v0.1.275 — el formulario público que se acaba de enviar (trigger
     * `form_submitted`): `{{formulario.nombre}}` y el filtro por formulario.
     */
    form?: { id: number; name: string };
}

/** v0.1.221 — la acción «Editar en lote» de una automatización, lista para el worker. */
export interface BulkEditJob {
    tenantId: number;
    automationId: number;
    automationName: string;
    listId: number;
    filter_tree: unknown;
    search?: string;
    operations: unknown[];
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

    // v0.1.285 (ADR-S44) — un evento que no se pudo encolar se pierde: avisar.
    constructor(@Optional() private readonly incidents?: IncidentHub) {}

    private lost(tenantId: number, listId: number | null, automationId: number | null, what: string, err: unknown): void {
        this.logger.error(`No se pudo encolar ${what}: ${String(err)}`);
        this.incidents?.report({
            tenantId,
            key: automationId ? `automation:${automationId}` : `automations:list:${listId ?? 0}`,
            source: 'automation',
            sourceId: automationId,
            listId,
            title: automationId ? 'Una automatización no se pudo poner en marcha' : 'Las automatizaciones de una lista no se pudieron poner en marcha',
            message: `No se pudo encolar ${what} (la cola de tareas del servidor no responde): ${errorText(err)}`,
        });
    }

    setQueue(queue: Queue): void {
        this.queue = queue;
    }

    /** v0.1.110 — encola un disparo de webhook entrante (job 'webhook'). */
    dispatchWebhook(data: { tenantId: number; automationId: number; payload: Record<string, unknown> }): void {
        if (!this.queue) return;
        this.queue.add('webhook', data, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
            this.lost(data.tenantId, null, data.automationId, 'el webhook entrante', err);
        });
    }

    /**
     * v0.1.221 — encola la acción «Editar en lote» de una automatización
     * (job 'bulk-edit'). Corre FUERA de la transacción del motor: si no, las
     * escrituras de la edición esperarían locks que esa misma transacción
     * tiene tomados (p. ej. un «Actualizar campo» previo sobre el registro).
     * Devuelve false si no hay cola (sin Redis): la acción falla con motivo.
     */
    dispatchBulkEdit(data: BulkEditJob): boolean {
        if (!this.queue) return false;
        this.queue.add('bulk-edit', data, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
            this.lost(data.tenantId, data.listId, data.automationId, 'la edición en lote', err);
        });
        return true;
    }

    dispatch(event: TriggerEvent): void {
        if (!this.queue) return;
        this.queue.add('event', event, { removeOnComplete: 1000, removeOnFail: 1000 }).catch((err) => {
            this.lost(event.tenantId, event.listId, null, 'la automatización', err);
        });
    }
}
