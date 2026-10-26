import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { Field, List } from '@imagina-base/shared';

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
    /** El cambio lo hizo el CLIENTE desde su portal (`actorId` es su usuario). */
    viaPortal?: boolean;
    /**
     * D5 — lo hizo la AGENDA (una reserva o el cliente desde el enlace de su
     * cita). La agenda avisa a quien atiende con su propio texto («Nueva
     * cita…»), así que los avisos genéricos («te asignó», «cambió») no salen.
     */
    origin?: 'booking';
    /**
     * La lista y sus campos, cuando quien emite ya los tenía cargados (la
     * edición de una persona). Los oyentes los usan en vez de volver a leerlos:
     * antes cada edición repetía esas lecturas una vez por oyente.
     */
    list?: List;
    fields?: readonly Field[];
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
