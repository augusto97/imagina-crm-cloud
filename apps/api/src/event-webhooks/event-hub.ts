import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { WebhookEvent } from '@imagina-base/shared';

/**
 * v0.1.442 (ADR-S105) — Aviso en proceso de «pasó algo que un webhook de
 * eventos puede querer saber». Lo emiten el despachador de automatizaciones
 * (alta, cambio, formulario y pago: lo mismo que dispara automatizaciones) y
 * el borrado de registros; lo escucha el módulo de webhooks. Existe para no
 * acoplar esos módulos entre sí (y no armar ciclos de dependencias).
 */
export interface OutgoingEvent {
    tenantId: number;
    event: WebhookEvent;
    listId: number;
    recordId: number;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    form?: Record<string, unknown>;
    payment?: Record<string, unknown>;
    /** Sólo en `record.deleted`: quién lo creó y sus datos al borrarse (para el alcance). */
    row?: { createdBy: number; data: Record<string, unknown> };
}

type Listener = (e: OutgoingEvent) => void | Promise<void>;

@Injectable()
export class EventWebhookHub {
    private readonly logger = new Logger(EventWebhookHub.name);
    private readonly listeners: Listener[] = [];

    subscribe(listener: Listener): void {
        this.listeners.push(listener);
    }

    /** Fire-and-forget: un oyente que falla nunca rompe lo que hizo la persona. */
    emit(e: OutgoingEvent): void {
        for (const l of this.listeners) {
            try {
                void Promise.resolve(l(e)).catch((err) => this.logger.error(`Webhooks de eventos (${e.event} #${e.recordId}): ${String(err)}`));
            } catch (err) {
                this.logger.error(`Webhooks de eventos (${e.event} #${e.recordId}): ${String(err)}`);
            }
        }
    }
}

@Global()
@Module({ providers: [EventWebhookHub], exports: [EventWebhookHub] })
export class EventWebhookHubModule {}
