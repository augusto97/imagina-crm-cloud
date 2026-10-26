import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * C5 — Lo que una automatización sabe de una aprobación (`{{aprobacion.x}}`):
 * viaja en el evento del disparador «Cuando se aprueba o se rechaza», lo deja
 * la acción «Pedir aprobación» y lo completa «Esperar aprobación» al seguir.
 */
export interface ApprovalEventInfo {
    request_id: number;
    flow_id: number | null;
    flow_name: string;
    /** Estado de la solicitud: pending | approved | rejected | returned | cancelled. */
    status: string;
    /** El resultado en palabras (aprobada, rechazada, devuelta, cancelada, vencida; vacío si sigue pendiente). */
    resultado: string;
    motivo: string;
    decidio: string;
    solicito: string;
    nota: string;
}

/** Una solicitud dejó de estar pendiente (se aprobó, rechazó, devolvió o canceló). */
export interface ApprovalResolvedEvent {
    tenantId: number;
    listId: number;
    recordId: number;
    info: ApprovalEventInfo;
}

type Listener = (event: ApprovalResolvedEvent) => void | Promise<void>;

/**
 * C5 — Aviso en proceso de "una solicitud de aprobación se resolvió". Lo
 * escucha el reloj de las esperas: una corrida en «Esperar aprobación» sigue
 * en el acto, sin esperar a su próximo chequeo. Igual que `RecordChangeHub` y
 * `NotifyHub`: existe para no acoplar las aprobaciones al motor de
 * automatizaciones (el motor ya depende de las aprobaciones para pedir una).
 */
@Injectable()
export class ApprovalHub {
    private readonly logger = new Logger(ApprovalHub.name);
    private readonly listeners: Listener[] = [];

    subscribe(listener: Listener): void {
        this.listeners.push(listener);
    }

    /** Fire-and-forget: un oyente que falla nunca rompe la decisión de la persona. */
    emit(event: ApprovalResolvedEvent): void {
        for (const l of this.listeners) {
            try {
                void Promise.resolve(l(event)).catch((err) =>
                    this.logger.error(`Oyente de la aprobación ${event.info.request_id}: ${String(err)}`),
                );
            } catch (err) {
                this.logger.error(`Oyente de la aprobación ${event.info.request_id}: ${String(err)}`);
            }
        }
    }
}

@Global()
@Module({ providers: [ApprovalHub], exports: [ApprovalHub] })
export class ApprovalHubModule {}
