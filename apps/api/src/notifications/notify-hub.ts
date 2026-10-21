import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * v0.1.276 (ADR-S40) — Aviso en proceso de "pasó algo que alguien puede
 * querer saber" (un comentario, una mención en la descripción). Igual que
 * `RecordChangeHub`: existe para no acoplar comentarios y registros al
 * módulo de avisos (y no armar ciclos de dependencias). Los cambios de
 * CAMPOS llegan por `RecordChangeHub`.
 */
export type NotifyEvent =
    | {
          type: 'comment';
          tenantId: number;
          listId: number;
          recordId: number;
          actorId: number;
          body: string;
          /** Ya mencionados en ESE comentario (reciben `mention`, no `comment`). */
          mentioned: number[];
          commentId?: number;
          /** `client` = el cliente del portal también lo ve. */
          visibility?: 'internal' | 'client';
          /**
           * Lo escribió el CLIENTE desde su portal (no un miembro del equipo):
           * el aviso dice «El cliente comentó…» y a él no se lo pone a seguir.
           */
          fromClient?: boolean;
          /** Nombre del cliente que comentó (si `fromClient`). */
          clientName?: string;
      }
    | {
          type: 'description_mention';
          tenantId: number;
          listId: number;
          recordId: number;
          actorId: number;
          /** Sólo los que se sumaron en este guardado. */
          userIds: number[];
          snippet: string;
      };

type Listener = (event: NotifyEvent) => void | Promise<void>;

@Injectable()
export class NotifyHub {
    private readonly logger = new Logger(NotifyHub.name);
    private readonly listeners: Listener[] = [];

    subscribe(listener: Listener): void {
        this.listeners.push(listener);
    }

    /** Fire-and-forget: un aviso que falla nunca rompe la acción de la persona. */
    emit(event: NotifyEvent): void {
        for (const l of this.listeners) {
            try {
                void Promise.resolve(l(event)).catch((err) => this.logger.error(`Aviso (${event.type}): ${String(err)}`));
            } catch (err) {
                this.logger.error(`Aviso (${event.type}): ${String(err)}`);
            }
        }
    }
}

@Global()
@Module({ providers: [NotifyHub], exports: [NotifyHub] })
export class NotifyHubModule {}
