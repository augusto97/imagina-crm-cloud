import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * v0.1.207 — Aviso en proceso de "una PERSONA (o una automatización) cambió
 * este registro". Lo escucha, por ahora, la edición en los dos sentidos de
 * las tiendas sincronizadas (ADR-S24 fase 3): si el registro vive en una
 * lista de la tienda, el cambio viaja a la tienda.
 *
 * Existe para no acoplar `RecordsService` a cada módulo que quiera enterarse
 * (y no armar ciclos de dependencias). La regla que evita los bucles: el
 * motor de sincronización escribe por su propio camino y NUNCA emite aquí —
 * lo que llega de la tienda no vuelve a la tienda.
 */
export interface RecordChange {
    tenantId: number;
    listId: number;
    recordId: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    /**
     * v0.1.209 — `created` para un alta (`before` vacío). Sin el campo es un
     * cambio: los oyentes viejos siguen viendo sólo cambios.
     */
    kind?: 'created' | 'updated';
    /**
     * v0.1.276 — quién lo hizo (0 = una automatización o el sistema). Lo usan
     * los avisos: no se le avisa a alguien de lo que hizo él mismo.
     */
    actorId?: number;
}

type Listener = (change: RecordChange) => void | Promise<void>;

@Injectable()
export class RecordChangeHub {
    private readonly logger = new Logger(RecordChangeHub.name);
    private readonly listeners: Listener[] = [];

    subscribe(listener: Listener): void {
        this.listeners.push(listener);
    }

    /** Fire-and-forget: un oyente que falla nunca rompe la edición de la persona. */
    emit(change: RecordChange): void {
        for (const l of this.listeners) {
            try {
                void Promise.resolve(l(change)).catch((err) =>
                    this.logger.error(`Oyente de cambios del registro ${change.recordId}: ${String(err)}`),
                );
            } catch (err) {
                this.logger.error(`Oyente de cambios del registro ${change.recordId}: ${String(err)}`);
            }
        }
    }
}

@Global()
@Module({ providers: [RecordChangeHub], exports: [RecordChangeHub] })
export class RecordChangeHubModule {}
